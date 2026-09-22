import { describe, it, expect, vi } from 'vitest'
vi.mock('../config/aqua-settings.js', () => ({
  getPoolIds: () => ['池1', '池2', '池3', '池4'],
}))
import { parseDailyReport } from './parse-daily-report.js'

describe('debug', () => {
  it('feeding appetite', () => {
    const text = '喂食：1号池3.2kg 2号池2.6kg\n吃食情况：秒光'
    const result = parseDailyReport(text, ['池1','池2','池3','池4'])
    console.log('DEBUG entries:', JSON.stringify(result.entries))
    expect(result.entries[0].fields['摄食情况']).toBe('秒光')
  })
  it('medication day', () => {
    const text = '拌药情况：\n1.金莲清毒康:280g\n拌药的第三天'
    const result = parseDailyReport(text, ['池1','池2','池3','池4'])
    console.log('DEBUG med:', JSON.stringify(result.entries))
    expect(result.entries[0].fields['备注']).toBe('拌药第3天')
  })
})
