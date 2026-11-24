import type { MessageUsage } from './api/types.js'
import type { AssistantMessage } from './chat/types.js'

export type UsageTotals = {
  /** 输入总量 = 未命中 + 缓存命中 + 缓存写入 */
  input: number
  output: number
  /** 输入 + 输出 */
  total: number
  /** 缓存命中读取 */
  cacheRead: number
  /** 未命中缓存的输入 */
  cacheMiss: number
  /** 写入缓存的输入 */
  cacheWrite: number
}

export type SessionUsageSummary = {
  totals: UsageTotals
  /** 参与统计的接口请求次数 */
  requests: number
  /** 带 usage 的助手回复条数 */
  replies: number
  /** 其中使用单条 usage 兜底的旧回复条数 */
  legacyReplies: number
}

const emptyTotals = (): UsageTotals => ({
  input: 0,
  output: 0,
  total: 0,
  cacheRead: 0,
  cacheMiss: 0,
  cacheWrite: 0,
})

const usageEntries = (message: AssistantMessage): MessageUsage[] => {
  if (message.usageHistory?.length) {
    return message.usageHistory
  }
  return message.usage ? [message.usage] : []
}

const addUsage = (totals: UsageTotals, usage: MessageUsage) => {
  const cacheMiss = Math.max(0, usage.input_tokens || 0)
  const cacheWrite = Math.max(0, usage.cache_creation_input_tokens || 0)
  const cacheRead = Math.max(0, usage.cache_read_input_tokens || 0)
  const output = Math.max(0, usage.output_tokens || 0)
  const input = cacheMiss + cacheWrite + cacheRead

  totals.input += input
  totals.output += output
  totals.total += input + output
  totals.cacheRead += cacheRead
  totals.cacheMiss += cacheMiss
  totals.cacheWrite += cacheWrite
}

/**
 * 汇总一个会话里所有助手回复的接口 usage。
 * 会话消息包含分支与重新生成产生的全部请求，正好对应实际消耗。
 */
export const summarizeSessionUsage = (
  messages: AssistantMessage[]
): SessionUsageSummary => {
  const totals = emptyTotals()
  let requests = 0
  let replies = 0
  let legacyReplies = 0

  for (const message of messages) {
    const entries = usageEntries(message)
    if (entries.length === 0) {
      continue
    }
    replies += 1
    if (!message.usageHistory?.length) {
      legacyReplies += 1
    }
    for (const usage of entries) {
      addUsage(totals, usage)
      requests += 1
    }
  }

  return { totals, requests, replies, legacyReplies }
}
