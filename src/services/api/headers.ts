/* ============================================================================
 * 功能区：模型接口 / headers 开始
 * 职责：headers 服务实现，负责模型与语音接口的协议分发、请求头、流式解析、SSE 与错误归一化中的该子能力。
 * 导出：parseCustomHeaders、hasCustomHeaders。
 * ========================================================================== */

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
