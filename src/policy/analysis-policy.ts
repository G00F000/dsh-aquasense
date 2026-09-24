/**
 * 集中式分析策略层(纯程序逻辑,无副作用,无 AI 调用)
 *
 * 将散落在 analyze-image / record-ledger / report-handler / generate-advice 中的
 * "基于 AI 分析结果(cls/completeness)决定后续流程"的判断收敛为单一事实源。
 *
 * 设计原则:AI 管判断,程序管流程。本模块仅封装确定性程序规则。
 */

import type { AnalysisResult } from '../tools/analyze-image.js'

// ========== 类型 ==========

/** 数据完整性三态 */
export type DataCompleteness = 'complete' | 'partial' | 'empty'

/** 防漏诊降级结果 */
export interface MissedDiagnosisGuardResult {
  analysis: AnalysisResult
  downgraded: boolean
  reason?: string
}

/** 后续动作决策 */
export interface NextSteps {
  pushAlert: boolean
  retrieve: boolean
  /** 是否给出用药建议(仅 disease 时) */
  medication: boolean
}

/** 落表前置校验结果 */
export interface LedgerGuardResult {
  allowed: boolean
  reason?: string
}

// ========== 策略函数 ==========

/**
 * 统一图片完整性判定
 * (迁移自 analyze-image.ts execute 函数内 lines 150-159 的完整性计算逻辑)
 *
 * @param expectedCount 工人发送的图片总数(可为 undefined 表示未声明期望数)
 * @param receivedCount 实际获取到的图片数
 */
export function evaluateDataCompleteness(
  expectedCount: number | undefined,
  receivedCount: number
): DataCompleteness {
  if (receivedCount === 0) {
    return 'empty'
  } else if (expectedCount !== undefined && receivedCount < expectedCount) {
    return 'partial'
  } else {
    return 'complete'
  }
}

/**
 * 防漏诊降级:图片不齐全时,如果视觉模型给出 normal 结论,降级为 unknown 并注入警告。
 * (迁移自 analyze-image.ts lines 190-201)
 *
 * 理由:仅看到部分图片就下"正常"结论是危险的——遗漏的图可能包含病灶。
 *
 * @param analysis 视觉模型解析后的分析结果(已设置 image_count/expected_image_count)
 * @param completeness 数据完整性标记
 */
export function applyMissedDiagnosisGuard(
  analysis: AnalysisResult,
  completeness: DataCompleteness
): MissedDiagnosisGuardResult {
  if (completeness === 'partial' && analysis.cls === 'normal') {
    const receivedCount = analysis.image_count ?? 0
    const expectedCount = analysis.expected_image_count ?? '?'
    const reason = `防漏诊:仅收到 ${receivedCount}/${expectedCount} 张图,视觉模型判定 normal — 降级为 unknown 防止台账记录错误结论`

    const downgraded: AnalysisResult = {
      ...analysis,
      cls: 'unknown',
      abnormal: false,
      symptoms: [
        `图片不完整:工人发送 ${expectedCount} 张,仅获取 ${receivedCount} 张`,
        '部分图片可能包含关键病灶信息,当前结论不可靠',
        '请人工现场复核后决定是否落表'
      ],
      severity: 'low',
      confidence: 0.3
    }
    return { analysis: downgraded, downgraded: true, reason }
  }

  return { analysis, downgraded: false }
}

/**
 * 基于 cls 的后续动作判断(单一事实源)
 * (迁移自 report-handler.ts lines 510-555 与 analyze-image.ts lines 205-212)
 *
 * - pushAlert: cls 为 early/disease 时触发异常预警
 * - retrieve:  cls 为 early/disease 时执行知识库检索与处置建议
 * - medication: cls 为 disease 时给出用药建议(generate-advice.ts line 239)
 */
export function decideNextSteps(analysis: { cls: string; abnormal?: boolean }): NextSteps {
  const isAbnormalCls = analysis.cls === 'early' || analysis.cls === 'disease'
  return {
    pushAlert: isAbnormalCls,
    retrieve: isAbnormalCls,
    medication: analysis.cls === 'disease'
  }
}

/**
 * 落表前置校验(inspection 场景)
 * (迁移自 record-ledger.ts lines 507-523)
 *
 * 阻断条件:
 *  1. analysis 缺失或 cls 为 unknown
 *  2. data_completeness 为 partial 或 empty
 *
 * @param analysis 分析结果(可为 undefined/null 表示未提供)
 * @param completeness 数据完整性标记(通常从 analysis.data_completeness 获取)
 */
export function canRecordLedger(
  analysis: { cls?: string; image_count?: number; expected_image_count?: number } | undefined | null,
  completeness: DataCompleteness | undefined
): LedgerGuardResult {
  if (!analysis || analysis.cls === 'unknown') {
    return {
      allowed: false,
      reason: 'inspection 场景缺少有效 AI 分析结果(analysis.cls 为 unknown 或未提供),无法写入台账。请先调用 aquasense_analyze 获取分析结果。'
    }
  }

  if (completeness === 'partial' || completeness === 'empty') {
    const received = analysis.image_count ?? 0
    const expected = analysis.expected_image_count ?? '?'
    return {
      allowed: false,
      reason: `图片数据不完整(获取 ${received}/${expected} 张),无法给出可靠的诊断结论。当前基于部分图片的分析结果不可作为落表依据。请等待图片补全或人工现场复核后再落表。`
    }
  }

  return { allowed: true }
}
