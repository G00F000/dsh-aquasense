/**
 * parse-daily-report 单元测试
 *
 * 测试重点:
 *  - 多场景日报文本拆分(水温+喂食+用药)
 *  - 池号归一化(口语→配置格式,全塘→全部池)
 *  - "暂无"药品跳过
 *  - 上下文备注提取(拌药第N天)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseDailyReport } from './parse-daily-report.js'

// mock getPoolIds:固定返回 4 池,避免依赖磁盘配置
vi.mock('../config/aqua-settings.js', () => ({
  getPoolIds: () => ['池1', '池2', '池3', '池4'],
  getValidPoolIds: () => new Set(['池1', '池2', '池3', '池4']),
  formatPoolIds: (pools?: string[]) => (pools ?? ['池1', '池2', '池3', '池4']).join('/'),
}))

const POOLS = ['池1', '池2', '池3', '池4']

describe('parseDailyReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── 完整日报拆分 ──

  describe('完整日报文本', () => {
    it('应将包含水温+喂食+用药的日报拆分为 10 条记录', () => {
      const text = `水温：23℃

喂食：1号池3.2kg   2号池2.6kg， 3号池2.7kg， 4号池1.6kg，
吃食情况: 秒光

拌药情况：1.金莲清毒康:280g
2.肝胆康:240g
3.五黄粉:240g
4.胆汁酸:40g
5.恩诺沙星:200g
6.硫酸新霉素:暂无

拌药的第三天`

      const { entries, warnings } = parseDailyReport(text, POOLS)

      expect(warnings).toHaveLength(0)
      // 水温 4 条(全塘展开) + 喂食 4 条 + 用药 5 条(硫酸新霉素暂无跳过) = 13 条
      expect(entries).toHaveLength(13)

      // 验证水温记录
      const temps = entries.filter(e => e.scene === 'temperature')
      expect(temps).toHaveLength(4)
      temps.forEach(e => {
        expect(e.fields['水温(℃)']).toBe(23)
      })
      expect(temps.map(e => e.fields['池号']).sort()).toEqual(['池1', '池2', '池3', '池4'])

      // 验证喂食记录
      const feeds = entries.filter(e => e.scene === 'feeding')
      expect(feeds).toHaveLength(4)
      const poolAmounts = Object.fromEntries(feeds.map(e => [e.fields['池号'], e.fields['投喂量(kg)']]))
      expect(poolAmounts['池1']).toBe(3.2)
      expect(poolAmounts['池2']).toBe(2.6)
      expect(poolAmounts['池3']).toBe(2.7)
      expect(poolAmounts['池4']).toBe(1.6)
      feeds.forEach(e => {
        expect(e.fields['摄食情况']).toBe('秒光')
      })

      // 验证用药记录(硫酸新霉素暂无已跳过)
      const meds = entries.filter(e => e.scene === 'medication')
      expect(meds).toHaveLength(5)
      const medNames = meds.map(e => e.fields['药品名称'])
      expect(medNames).toContain('金莲清毒康')
      expect(medNames).toContain('肝胆康')
      expect(medNames).toContain('五黄粉')
      expect(medNames).toContain('胆汁酸')
      expect(medNames).toContain('恩诺沙星')
      expect(medNames).not.toContain('硫酸新霉素')

      // 验证用药记录:池号=全塘,用药方式=拌料
      meds.forEach(e => {
        expect(e.fields['池号']).toBe('全塘')
        expect(e.fields['用药方式']).toBe('拌料')
      })

      // 验证备注:拌药第三天
      meds.forEach(e => {
        expect(e.fields['备注']).toBe('拌药第3天')
      })
    })
  })

  // ── 水温解析 ──

  describe('水温场景', () => {
    it('应解析全塘水温', () => {
      const text = '水温：23℃'
      const { entries } = parseDailyReport(text, POOLS)

      expect(entries).toHaveLength(4)
      entries.forEach(e => {
        expect(e.scene).toBe('temperature')
        expect(e.fields['水温(℃)']).toBe(23)
      })
    })

    it('应解析带小数的水温', () => {
      const text = '水温：23.5度'
      const { entries } = parseDailyReport(text, POOLS)

      expect(entries).toHaveLength(4)
      expect(entries[0].fields['水温(℃)']).toBe(23.5)
    })

    it('应解析指定池号的水温', () => {
      const text = '池3水温：25℃'
      const { entries } = parseDailyReport(text, POOLS)

      expect(entries).toHaveLength(1)
      expect(entries[0].fields['池号']).toBe('池3')
      expect(entries[0].fields['水温(℃)']).toBe(25)
    })

    it('水温关键词不匹配时应无记录', () => {
      const text = '今天天气不错'
      const { entries } = parseDailyReport(text, POOLS)

      expect(entries).toHaveLength(0)
    })
  })

  // ── 喂食解析 ──

  describe('喂食场景', () => {
    it('应解析多池喂食数据', () => {
      const text = `喂食：1号池3.2kg 2号池2.6kg 3号池2.7kg 4号池1.6kg
吃食情况：秒光`

      const { entries } = parseDailyReport(text, POOLS)

      expect(entries).toHaveLength(4)
      entries.forEach(e => {
        expect(e.scene).toBe('feeding')
        expect(e.fields['摄食情况']).toBe('秒光')
      })
    })

    it('应解析"池X"格式的池号', () => {
      const text = '投喂：池1 5kg'
      const { entries } = parseDailyReport(text, POOLS)

      expect(entries).toHaveLength(1)
      expect(entries[0].fields['池号']).toBe('池1')
      expect(entries[0].fields['投喂量(kg)']).toBe(5)
    })

    it('无摄食情况时应省略该字段', () => {
      const text = '喂食：池1 3.2kg'
      const { entries } = parseDailyReport(text, POOLS)

      expect(entries).toHaveLength(1)
      expect(entries[0].fields['摄食情况']).toBeUndefined()
    })
  })

  // ── 用药解析 ──

  describe('用药场景', () => {
    it('应解析拌药列表', () => {
      const text = `拌药情况：
1.金莲清毒康:280g
2.肝胆康:240g
3.五黄粉:240g
4.胆汁酸:40g
5.恩诺沙星:200g`

      const { entries } = parseDailyReport(text, POOLS)

      expect(entries).toHaveLength(5)
      entries.forEach(e => {
        expect(e.scene).toBe('medication')
        expect(e.fields['池号']).toBe('全塘')
        expect(e.fields['用药方式']).toBe('拌料')
      })
    })

    it('应跳过"暂无"的药品', () => {
      const text = `拌药情况：
1.金莲清毒康:280g
2.硫酸新霉素:暂无`

      const { entries } = parseDailyReport(text, POOLS)

      expect(entries).toHaveLength(1)
      expect(entries[0].fields['药品名称']).toBe('金莲清毒康')
    })

    it('应提取"第N天"作为备注', () => {
      const text = `拌药情况：
1.金莲清毒康:280g
拌药的第三天`

      const { entries } = parseDailyReport(text, POOLS)

      expect(entries).toHaveLength(1)
      expect(entries[0].fields['备注']).toBe('拌药第3天')
    })

    it('药品前导标点应被清理', () => {
      const text = `拌药情况：
.金莲清毒康:280g
.肝胆康:240g`

      const { entries } = parseDailyReport(text, POOLS)

      expect(entries).toHaveLength(2)
      expect(entries[0].fields['药品名称']).toBe('金莲清毒康')
      expect(entries[1].fields['药品名称']).toBe('肝胆康')
    })
  })

  // ── 池号归一化 ──

  describe('池号归一化', () => {
    it('应将"1号池"映射为"池1"', () => {
      const text = '喂食：1号池3.2kg'
      const { entries } = parseDailyReport(text, POOLS)

      expect(entries[0].fields['池号']).toBe('池1')
    })

    it('应将"二号池"映射为"池2"', () => {
      const text = '喂食：二号池3.2kg'
      const { entries } = parseDailyReport(text, POOLS)

      expect(entries[0].fields['池号']).toBe('池2')
    })
  })

  // ── 边界情况 ──

  describe('边界情况', () => {
    it('空文本应返回空结果', () => {
      const { entries, warnings } = parseDailyReport('', POOLS)
      expect(entries).toHaveLength(0)
      expect(warnings.length).toBeGreaterThan(0)
    })

    it('不支持的场景应产生警告', () => {
      const text = '水质检测：pH 7.2'
      const { entries, warnings } = parseDailyReport(text, POOLS)

      expect(entries).toHaveLength(0)
      expect(warnings.length).toBeGreaterThan(0)
    })

    it('自定义池号配置应被正确使用', () => {
      const customPools = ['A池', 'B池']
      const text = '水温：23℃'
      const { entries } = parseDailyReport(text, customPools)

      expect(entries).toHaveLength(2)
      expect(entries.map(e => e.fields['池号']).sort()).toEqual(['A池', 'B池'])
    })
  })
})
