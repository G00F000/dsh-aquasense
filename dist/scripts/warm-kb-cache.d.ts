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
export {};
