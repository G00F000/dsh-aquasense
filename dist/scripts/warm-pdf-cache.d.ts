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
export {};
