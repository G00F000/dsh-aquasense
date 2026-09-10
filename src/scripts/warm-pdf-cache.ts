#!/usr/bin/env node
/**
 * 知识库 PDF 正文层批量预热脚本
 *
 * 遍历 IMA 知识库全部条目,对 PDF(media_type=1)执行
 * "下载 → unpdf 提取文本层 → 按 media_id 落盘缓存",输出统计与失败清单。
 * 已缓存条目自动跳过,可重复执行(增量);建议部署后或知识库更新后各跑一次。
 *
 * 启动方式:
 *   npm run kb:warm                 # 全量预热(已缓存自动跳过)
 *   npm run kb:warm -- --limit 10   # 只处理前 10 份 PDF(抽样探测文本层覆盖率)
 */

import {
  resolveKnowledgeBaseId,
  listKnowledge,
  getMediaInfo,
  getMediaContent,
  type KnowledgeListItem
} from '../ima/ima-api.js'

const SLEEP_MS = 300 // 条目间请求间隔,规避 IMA 频控(110021)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 逐级遍历知识库文件夹,收集全部文件条目 */
async function collectFiles(kbId: string): Promise<KnowledgeListItem[]> {
  const files: KnowledgeListItem[] = []
  const folderQueue: Array<string | undefined> = [undefined] // undefined 表示根目录

  while (folderQueue.length > 0) {
    const folderId = folderQueue.shift()
    let cursor = ''
    for (;;) {
      const page = await listKnowledge(kbId, cursor, folderId)
      for (const item of page.items) {
        if (item.kind === 'folder' && item.folderId) {
          folderQueue.push(item.folderId)
        } else if (item.mediaId) {
          files.push(item)
        }
      }
      if (page.isEnd) break
      cursor = page.nextCursor
      await sleep(SLEEP_MS)
    }
  }

  return files
}

async function main(): Promise<void> {
  const limitIndex = process.argv.indexOf('--limit')
  const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : Number.POSITIVE_INFINITY

  const kbId = await resolveKnowledgeBaseId()
  if (!kbId) {
    console.error('[kb:warm] 未找到"水产养殖"知识库,请检查 IMA 凭证与知识库名称')
    process.exitCode = 1
    return
  }
  console.log(`[kb:warm] 知识库 ID:${kbId},开始遍历条目...`)

  const files = await collectFiles(kbId)
  console.log(`[kb:warm] 共 ${files.length} 个文件条目,开始探测媒体类型(仅 PDF 参与解析)...`)

  let pdfTotal = 0
  let okCount = 0
  let scannedCount = 0
  let oversizedCount = 0
  let skipped = 0
  const failures: string[] = []

  for (const file of files) {
    if (pdfTotal >= limit) break
    const mediaId = file.mediaId
    if (!mediaId) continue
    try {
      const info = await getMediaInfo(mediaId)
      if (info?.media_type !== 1) {
        skipped++
        continue
      }
      pdfTotal++
      const text = await getMediaContent(mediaId)
      if (text.startsWith('[扫描件')) {
        scannedCount++
        console.warn(`[kb:warm] 扫描件(需 OCR):${file.title}`)
      } else if (text.startsWith('[PDF 超限')) {
        oversizedCount++
        console.warn(`[kb:warm] 超限跳过:${file.title}`)
      } else {
        okCount++
        console.log(`[kb:warm] OK ${file.title}(${text.length} 字)`)
      }
    } catch (error) {
      failures.push(`${file.title}: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`[kb:warm] 失败:${file.title}`, error)
    }
    await sleep(SLEEP_MS)
  }

  console.log('')
  console.log('[kb:warm] ===== 汇总 =====')
  console.log(`[kb:warm] 文件条目 ${files.length}(非 PDF 跳过 ${skipped}),处理 PDF ${pdfTotal}`)
  console.log(`[kb:warm] 成功 ${okCount},扫描件 ${scannedCount},超限 ${oversizedCount},失败 ${failures.length}`)
  if (failures.length > 0) {
    console.log('[kb:warm] 失败清单:')
    for (const item of failures) {
      console.log(`  - ${item}`)
    }
  }
  if (scannedCount > 0) {
    console.log('[kb:warm] 提示:扫描件无文本层,接入 OCR 兜底后覆写对应缓存文件即可生效')
  }
}

main().catch((error) => {
  console.error('[kb:warm] 执行失败:', error)
  process.exit(1)
})
