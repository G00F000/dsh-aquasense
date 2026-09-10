#!/usr/bin/env node
/**
 * 知识库正文层批量预热脚本(PDF + 笔记)
 *
 * 遍历 IMA 知识库全部条目,按媒体类型预热正文缓存:
 *  - PDF(media_type=1):下载 → unpdf 提取文本层 → 按 media_id 落盘
 *  - 笔记(media_type=11):notes 接口读纯文本 → 按 media_id 落盘
 * 已缓存条目自动跳过,可重复执行(增量);建议部署后或知识库更新后各跑一次。
 *
 * 启动方式:
 *   npm run kb:warm                 # 全量预热(已缓存自动跳过)
 *   npm run kb:warm -- --limit 10   # 只处理前 10 份正文(PDF+笔记,抽样探测覆盖率)
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
  const limited = limitIndex >= 0
  const limit = limited ? Number(process.argv[limitIndex + 1]) : Number.POSITIVE_INFINITY

  const kbId = await resolveKnowledgeBaseId()
  if (!kbId) {
    console.error('[kb:warm] 未找到"水产养殖"知识库,请检查 IMA 凭证与知识库名称')
    process.exitCode = 1
    return
  }
  console.log(`[kb:warm] 知识库 ID:${kbId},开始遍历条目...`)

  const files = await collectFiles(kbId)
  console.log(`[kb:warm] 共 ${files.length} 个文件条目,开始探测媒体类型(PDF/笔记参与正文预热)...`)

  let processed = 0
  let pdfTotal = 0
  let pdfOk = 0
  let scannedCount = 0
  let oversizedCount = 0
  let noteTotal = 0
  let noteOk = 0
  let noteUnreadable = 0
  let skipped = 0
  const failures: string[] = []

  for (const file of files) {
    if (limited && processed >= limit) break
    const mediaId = file.mediaId
    if (!mediaId) continue
    try {
      const info = await getMediaInfo(mediaId)
      const mediaType = info?.media_type
      if (mediaType !== 1 && mediaType !== 11) {
        skipped++
        continue
      }
      processed++
      const text = await getMediaContent(mediaId)
      if (mediaType === 1) {
        pdfTotal++
        if (text.startsWith('[扫描件')) {
          scannedCount++
          console.warn(`[kb:warm] PDF 扫描件(需 OCR):${file.title}`)
        } else if (text.startsWith('[PDF 超限')) {
          oversizedCount++
          console.warn(`[kb:warm] PDF 超限跳过:${file.title}`)
        } else {
          pdfOk++
          console.log(`[kb:warm] PDF OK ${file.title}(${text.length} 字)`)
        }
      } else {
        noteTotal++
        if (text.startsWith('[笔记无法读取')) {
          noteUnreadable++
          console.warn(`[kb:warm] 笔记不可读:${file.title}`)
        } else {
          noteOk++
          console.log(`[kb:warm] 笔记 OK ${file.title}(${text.length} 字)`)
        }
      }
    } catch (error) {
      failures.push(`${file.title}: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`[kb:warm] 失败:${file.title}`, error)
    }
    await sleep(SLEEP_MS)
  }

  console.log('')
  console.log('[kb:warm] ===== 汇总 =====')
  console.log(`[kb:warm] 文件条目 ${files.length}(其他类型跳过 ${skipped}),处理 ${processed}(PDF ${pdfTotal} + 笔记 ${noteTotal})`)
  console.log(`[kb:warm] PDF:成功 ${pdfOk},扫描件 ${scannedCount},超限 ${oversizedCount}`)
  console.log(`[kb:warm] 笔记:成功 ${noteOk},不可读 ${noteUnreadable}`)
  console.log(`[kb:warm] 失败 ${failures.length}`)
  if (failures.length > 0) {
    console.log('[kb:warm] 失败清单:')
    for (const item of failures) {
      console.log(`  - ${item}`)
    }
  }
  if (scannedCount > 0) {
    console.log('[kb:warm] 提示:扫描件无文本层,接入 OCR 兜底后覆写对应缓存文件即可生效')
  }
  if (noteUnreadable > 0) {
    console.log('[kb:warm] 提示:不可读笔记(非本人/已删除/共享无权限)已写入标记缓存,如需正文请在 IMA 客户端确认归属')
  }
}

main().catch((error) => {
  console.error('[kb:warm] 执行失败:', error)
  process.exit(1)
})
