/**
 * JSON 无损序列化工具(共享)
 *
 * 背景:DSH 的 lossless-JSON 校验器(@deepseek-ai/dsh-session 的 walkJsonValue)
 * 会遍历工具返回对象的每一个 enumerable own property,只要有一个值为 `undefined`
 * 就判定为 "value is not lossless JSON",触发上层 ToolOutputError。
 * JSON 本身无法表示 undefined,因此可选字段缺省时必须"省略键"而非"赋 undefined"。
 *
 * 本模块提供递归剥离 undefined 字段的兜底函数,供各工具在返回前调用,
 * 即使未来新增了未做条件展开的可选字段也不会重蹈覆辙。
 */

/**
 * 递归剥离对象/数组中所有值为 `undefined` 的键,返回可被 lossless JSON 无损序列化的新值。
 *
 * - 普通对象:跳过值为 undefined 的键,其余键递归处理
 * - 数组:逐元素递归处理(保留索引与长度,不删除元素)
 * - 原始值/null:原样返回
 *
 * 不修改入参,始终返回新对象(与 deepFreeze 冻结入参的场景兼容)。
 *
 * @param value 任意工具产出值
 * @returns 去除所有 undefined 字段后的等价新值(类型保持不变)
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === undefined) continue
      out[key] = stripUndefinedDeep(val)
    }
    return out as unknown as T
  }
  return value
}
