/**
 * 池号配置模型测试(见 src/config/aqua-settings.ts)
 *
 * 覆盖:归一化口径、环境变量回退、文件读写往返、白名单查询。
 * 每个用例使用独立 AQUASENSE_CACHE_DIR,避免模块缓存串扰。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_POOLS,
  formatPoolIds,
  getAquaSettings,
  getPoolIds,
  getValidPoolIds,
  MAX_POOL_LENGTH,
  MAX_POOLS,
  sanitizePools,
  saveAquaSettings
} from './aqua-settings.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aquasense-settings-'))
  process.env.AQUASENSE_CACHE_DIR = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.AQUASENSE_CACHE_DIR
  delete process.env.AQUA_POOLS
})

describe('sanitizePools', () => {
  it('非数组 → 默认 4 池', () => {
    expect(sanitizePools(undefined)).toEqual(DEFAULT_POOLS)
    expect(sanitizePools('池1')).toEqual(DEFAULT_POOLS)
    expect(sanitizePools({ 0: '池1' })).toEqual(DEFAULT_POOLS)
  })

  it('trim/去空/去重/过滤非字符串', () => {
    expect(sanitizePools([' 池1 ', '', '池1', 3, null, '池2'])).toEqual(['池1', '池2'])
  })

  it('超长项跳过,数量封顶 MAX_POOLS', () => {
    const long = '池'.repeat(MAX_POOL_LENGTH + 1)
    expect(sanitizePools([long, '池1'])).toEqual(['池1'])
    const many = Array.from({ length: MAX_POOLS + 5 }, (_, i) => `池${i + 1}`)
    expect(sanitizePools(many)).toHaveLength(MAX_POOLS)
  })

  it('全部非法 → 回退默认', () => {
    expect(sanitizePools(['', '   '])).toEqual(DEFAULT_POOLS)
  })
})

describe('getAquaSettings / saveAquaSettings', () => {
  it('无文件无环境变量 → 默认 4 池', () => {
    expect(getAquaSettings()).toEqual({ pools: DEFAULT_POOLS })
  })

  it('环境变量 AQUA_POOLS 回退(合法 JSON)', () => {
    process.env.AQUA_POOLS = JSON.stringify(['池1', '池5', '池9'])
    expect(getAquaSettings()).toEqual({ pools: ['池1', '池5', '池9'] })
  })

  it('环境变量非法 JSON → 静默回退默认', () => {
    process.env.AQUA_POOLS = '池1,池2'
    expect(getAquaSettings()).toEqual({ pools: DEFAULT_POOLS })
  })

  it('保存 → 文件落盘且读回一致(sanitize 后)', () => {
    saveAquaSettings({ pools: [' 池3 ', '池1', '池3', '池2'] })
    const file = JSON.parse(readFileSync(join(dir, 'aqua', 'settings.json'), 'utf8'))
    expect(file).toEqual({ pools: ['池3', '池1', '池2'] })
    expect(getAquaSettings()).toEqual({ pools: ['池3', '池1', '池2'] })
  })

  it('配置文件优先级高于环境变量', () => {
    process.env.AQUA_POOLS = JSON.stringify(['池8'])
    saveAquaSettings({ pools: ['池2', '池4'] })
    expect(getAquaSettings()).toEqual({ pools: ['池2', '池4'] })
  })

  it('文件被外部修改后重新读取(每次读盘)', () => {
    saveAquaSettings({ pools: ['池1'] })
    expect(getAquaSettings()).toEqual({ pools: ['池1'] })
    // 绕过 saveAquaSettings 直接改文件(模拟外部修改)
    const path = join(dir, 'aqua', 'settings.json')
    writeFileSync(path, JSON.stringify({ pools: ['池6'] }), 'utf8')
    expect(getAquaSettings()).toEqual({ pools: ['池6'] })
  })

  it('文件解析失败 → 回退环境变量', () => {
    mkdirSync(join(dir, 'aqua'), { recursive: true })
    writeFileSync(join(dir, 'aqua', 'settings.json'), '{broken', 'utf8')
    process.env.AQUA_POOLS = JSON.stringify(['池A'])
    expect(getAquaSettings()).toEqual({ pools: ['池A'] })
  })
})

describe('业务消费辅助', () => {
  it('getPoolIds 返回数组快照', () => {
    saveAquaSettings({ pools: ['池1', '池2'] })
    expect(getPoolIds()).toEqual(['池1', '池2'])
  })

  it('getValidPoolIds 白名单查询', () => {
    saveAquaSettings({ pools: ['池1', '池3'] })
    const valid = getValidPoolIds()
    expect(valid.has('池1')).toBe(true)
    expect(valid.has('池2')).toBe(false)
    expect(valid.has('池3')).toBe(true)
  })

  it('formatPoolIds 文案(默认/自定义)', () => {
    expect(formatPoolIds(DEFAULT_POOLS)).toBe('池1/池2/池3/池4')
    saveAquaSettings({ pools: ['池1', '池5'] })
    expect(formatPoolIds()).toBe('池1/池5')
  })
})
