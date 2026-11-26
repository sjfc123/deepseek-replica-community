/* ============================================================================
 * 功能区：模型接口 / headers · 自定义请求头
 * 职责：自定义请求头：校验名称与值、过滤禁用头并生成请求头对象，不拼接协议体。
 * 分区：01 类型、契约与依赖；02 核心实现：collect、parseCustomHeaders、hasCustomHeaders
 * 关联：无内部依赖；被 components/settings/AndroidSettings、services/chat/store 引用。
 * 导出：parseCustomHeaders、hasCustomHeaders
 * 边界：只处理 HTTP 协议、请求头、流式帧与错误归一化；不维护会话状态、不渲染视图、不写业务数据库。
 * ========================================================================== */

/* ---- 01 类型、契约与依赖 ---- */
/**
 * 自定义请求头：DeepChat 的「自定义请求头」支持 JSON 对象或每行 `Key: Value`。
 * 统一解析为 Record，供 fetch 与原生传输使用；非法条目直接丢弃，不阻断请求。
 */

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** 只接受不含 CR/LF 的头部值，避免被拼进请求行 */
const safeValue = (value: string) => !/[\r\n]/.test(value)

const collect = (pairs: [unknown, unknown][]) => {
  const headers: Record<string, string> = {}
  for (const [rawName, rawValue] of pairs) {
    if (typeof rawName !== 'string' || typeof rawValue !== 'string') {
      continue
    }
    const name = rawName.trim()
    const value = rawValue.trim()
    if (name && HEADER_NAME.test(name) && safeValue(value)) {
      headers[name] = value
    }
  }
  return headers
}

/* ---- 02 核心实现：collect、parseCustomHeaders、hasCustomHeaders ---- */
export const parseCustomHeaders = (raw: string): Record<string, string> => {
  const text = raw.trim()
  if (!text) {
    return {}
  }
  if (text.startsWith('{')) {
    try {
      const value: unknown = JSON.parse(text)
      return typeof value === 'object' && value !== null
        ? collect(Object.entries(value as Record<string, unknown>))
        : {}
    } catch {
      return {}
    }
  }
  return collect(
    text
      .split(/\r?\n/)
      .map((line) => {
        const index = line.indexOf(':')
        return index < 0 ? null : [line.slice(0, index), line.slice(index + 1)]
      })
      .filter((pair): pair is [string, string] => pair !== null)
  )
}

export const hasCustomHeaders = (headers: Record<string, string>) => Object.keys(headers).length > 0

/* ============================================================================
 * 功能区：模型接口 / headers 结束
 * ========================================================================== */
