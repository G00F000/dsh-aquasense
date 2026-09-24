/**
 * 策略层单元测试(analysis-policy.ts)
 *
 * 覆盖:
 *  - evaluateDataCompleteness:完整性三态边界
 *  - applyMissedDiagnosisGuard:防漏诊降级(partial+normal→unknown,字段改写)
 *  - decideNextSteps:各 cls 组合的 pushAlert/retrieve/medication
 *  - canRecordLedger:放行/阻断条件与报错文案
 */

import { describe, it, expect } from 'vitest'
import {
  evaluateDataCompleteness,
  applyMissedDiagnosisGuard,
  decideNextSteps,
  canRecordLedger
} from './analysis-policy.js'
import type { AnalysisResult } from '../tools/analyze-image.js'

// ========== 辅助 ==========

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    abnormal: false,
    cls: 'normal',
    symptoms: [],
    severity: 'low',
    confidence: 0.9,
    scene_hint: 'inspection',
    organs: [],
    ...overrides
  }
}

// ========== evaluateDataCompleteness ==========

describe('evaluateDataCompleteness', () => {
  it('receivedCount=0 时返回 empty', () => {
    expect(evaluateDataCompleteness(5, 0)).toBe('empty')
    expect(evaluateDataCompleteness(undefined, 0)).toBe('empty')
    expect(evaluateDataCompleteness(1, 0)).toBe('empty')
  })

  it('receivedCount < expectedCount 时返回 partial', () => {
    expect(evaluateDataCompleteness(5, 3)).toBe('partial')
    expect(evaluateDataCompleteness(2, 1)).toBe('partial')
    expect(evaluateDataCompleteness(10, 9)).toBe('partial')
  })

  it('receivedCount >= expectedCount 时返回 complete', () => {
    expect(evaluateDataCompleteness(3, 3)).toBe('complete')
    expect(evaluateDataCompleteness(3, 5)).toBe('complete')
  })

  it('expectedCount=undefined 且 receivedCount>0 时返回 complete', () => {
    expect(evaluateDataCompleteness(undefined, 1)).toBe('complete')
    expect(evaluateDataCompleteness(undefined, 10)).toBe('complete')
  })
})

// ========== applyMissedDiagnosisGuard ==========

describe('applyMissedDiagnosisGuard', () => {
  it('partial + normal → 降级为 unknown,字段改写正确', () => {
    const analysis = makeAnalysis({
      cls: 'normal',
      abnormal: false,
      symptoms: ['无异常'],
      severity: 'low',
      confidence: 0.95,
      image_count: 2,
      expected_image_count: 5
    })

    const result = applyMissedDiagnosisGuard(analysis, 'partial')

    expect(result.downgraded).toBe(true)
    expect(result.reason).toContain('防漏诊')
    expect(result.analysis.cls).toBe('unknown')
    expect(result.analysis.abnormal).toBe(false)
    expect(result.analysis.severity).toBe('low')
    expect(result.analysis.confidence).toBe(0.3)
    expect(result.analysis.symptoms).toEqual([
      '图片不完整:工人发送 5 张,仅获取 2 张',
      '部分图片可能包含关键病灶信息,当前结论不可靠',
      '请人工现场复核后决定是否落表'
    ])
  })

  it('complete + normal → 不降级', () => {
    const analysis = makeAnalysis({ cls: 'normal', confidence: 0.95 })
    const result = applyMissedDiagnosisGuard(analysis, 'complete')

    expect(result.downgraded).toBe(false)
    expect(result.analysis).toBe(analysis) // 同一引用,未修改
    expect(result.analysis.cls).toBe('normal')
  })

  it('partial + disease → 不降级(仅 normal 触发)', () => {
    const analysis = makeAnalysis({
      cls: 'disease',
      abnormal: true,
      symptoms: ['烂鳃'],
      severity: 'high',
      confidence: 0.85,
      image_count: 2,
      expected_image_count: 5
    })

    const result = applyMissedDiagnosisGuard(analysis, 'partial')

    expect(result.downgraded).toBe(false)
    expect(result.analysis.cls).toBe('disease')
    expect(result.analysis.symptoms).toEqual(['烂鳃'])
  })

  it('partial + early → 不降级', () => {
    const analysis = makeAnalysis({
      cls: 'early',
      abnormal: true,
      symptoms: ['离群独游'],
      image_count: 1,
      expected_image_count: 3
    })

    const result = applyMissedDiagnosisGuard(analysis, 'partial')

    expect(result.downgraded).toBe(false)
    expect(result.analysis.cls).toBe('early')
  })

  it('empty + normal → 不降级(仅 partial 触发)', () => {
    const analysis = makeAnalysis({ cls: 'normal' })
    const result = applyMissedDiagnosisGuard(analysis, 'empty')

    expect(result.downgraded).toBe(false)
    expect(result.analysis.cls).toBe('normal')
  })

  it('降级后保留 scene_hint 和 organs 等其他字段', () => {
    const analysis = makeAnalysis({
      cls: 'normal',
      scene_hint: 'dissection',
      organs: ['鳃', '肝'],
      image_count: 1,
      expected_image_count: 2
    })

    const result = applyMissedDiagnosisGuard(analysis, 'partial')

    expect(result.downgraded).toBe(true)
    expect(result.analysis.scene_hint).toBe('dissection')
    expect(result.analysis.organs).toEqual(['鳃', '肝'])
  })
})

// ========== decideNextSteps ==========

describe('decideNextSteps', () => {
  it('cls=disease → pushAlert/retrieve/medication 全 true', () => {
    const steps = decideNextSteps({ cls: 'disease', abnormal: true })
    expect(steps).toEqual({ pushAlert: true, retrieve: true, medication: true })
  })

  it('cls=early → pushAlert/retrieve true, medication false', () => {
    const steps = decideNextSteps({ cls: 'early', abnormal: true })
    expect(steps).toEqual({ pushAlert: true, retrieve: true, medication: false })
  })

  it('cls=normal → 全 false', () => {
    const steps = decideNextSteps({ cls: 'normal', abnormal: false })
    expect(steps).toEqual({ pushAlert: false, retrieve: false, medication: false })
  })

  it('cls=unknown → 全 false', () => {
    const steps = decideNextSteps({ cls: 'unknown', abnormal: false })
    expect(steps).toEqual({ pushAlert: false, retrieve: false, medication: false })
  })

  it('abnormal 字段不影响结果(基于 cls 判断)', () => {
    // 即使 abnormal=false 但 cls=disease,仍触发(与 report-handler.ts 行为一致)
    const steps = decideNextSteps({ cls: 'disease', abnormal: false })
    expect(steps.pushAlert).toBe(true)
    expect(steps.medication).toBe(true)
  })
})

// ========== canRecordLedger ==========

describe('canRecordLedger', () => {
  it('analysis=undefined → 阻断,报错文案匹配', () => {
    const result = canRecordLedger(undefined, undefined)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe(
      'inspection 场景缺少有效 AI 分析结果(analysis.cls 为 unknown 或未提供),无法写入台账。请先调用 aquasense_analyze 获取分析结果。'
    )
  })

  it('analysis=null → 阻断', () => {
    const result = canRecordLedger(null, 'complete')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('analysis.cls 为 unknown 或未提供')
  })

  it('cls=unknown → 阻断', () => {
    const result = canRecordLedger({ cls: 'unknown' }, 'complete')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe(
      'inspection 场景缺少有效 AI 分析结果(analysis.cls 为 unknown 或未提供),无法写入台账。请先调用 aquasense_analyze 获取分析结果。'
    )
  })

  it('cls=normal + completeness=partial → 阻断(数据不完整)', () => {
    const result = canRecordLedger(
      { cls: 'normal', image_count: 2, expected_image_count: 5 },
      'partial'
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe(
      '图片数据不完整(获取 2/5 张),无法给出可靠的诊断结论。当前基于部分图片的分析结果不可作为落表依据。请等待图片补全或人工现场复核后再落表。'
    )
  })

  it('cls=disease + completeness=empty → 阻断', () => {
    const result = canRecordLedger(
      { cls: 'disease', image_count: 0, expected_image_count: 3 },
      'empty'
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('图片数据不完整(获取 0/3 张)')
  })

  it('cls=normal + completeness=complete → 放行', () => {
    const result = canRecordLedger({ cls: 'normal', image_count: 3, expected_image_count: 3 }, 'complete')
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('cls=disease + completeness=complete → 放行', () => {
    const result = canRecordLedger({ cls: 'disease', image_count: 1 }, 'complete')
    expect(result.allowed).toBe(true)
  })

  it('cls=early + completeness=complete → 放行', () => {
    const result = canRecordLedger({ cls: 'early', image_count: 2, expected_image_count: 2 }, 'complete')
    expect(result.allowed).toBe(true)
  })

  it('completeness=undefined + cls 有效 → 放行(未标记完整性时不阻断)', () => {
    const result = canRecordLedger({ cls: 'normal' }, undefined)
    expect(result.allowed).toBe(true)
  })

  it('image_count/expected_image_count 缺失时使用默认值', () => {
    const result = canRecordLedger({ cls: 'normal' }, 'partial')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('获取 0/? 张')
  })
})
