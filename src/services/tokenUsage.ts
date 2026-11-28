/* ============================================================================
 * 功能区：本地服务 / tokenUsage · 用量聚合
 * 职责：用量聚合：请求级 usage 汇总、缓存命中与会话统计。
 * 分区：01 类型、契约与依赖；02 核心实现：usageEntries、addUsage、summarizeSessionUsage；
 *    03 对外入口与收尾
 * 关联：依赖 services/api/types、services/chat/types；
 *    被 scripts/test-cache-diagnostics、components/settings/TokenUsagePanel、services/chat/tokenUsage 引用。
 * 导出：UsageTotals、SessionUsageSummary、summarizeSessionUsage
 * 边界：只处理本机存储、设置、迁移与数据版本；不实现界面控件，不直接请求模型。
 * ========================================================================== */

import type { MessageUsage } from './api/types.js'
import type { AssistantMessage } from './chat/types.js'

/* ---- 01 类型、契约与依赖 ---- */
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
  /** 上游明确没有返回缓存字段的请求数；用于区分“真实 0 命中”和“字段缺失” */
  cacheFieldMissing: number
  /** 深度思考 Token；只累加上游明确返回的数值 */
  reasoning: number
  /** 安全审核 Token；只累加上游明确返回的数值 */
  safety: number
}

export type SessionUsageSummary = {
  totals: UsageTotals
  /** 参与统计的接口请求次数 */
  requests: number
  /** 带 usage 的助手回复条数 */
  replies: number
  /** 其中使用单条 usage 补算的旧回复条数 */
  legacyReplies: number
}

const emptyTotals = (): UsageTotals => ({
  input: 0,
  output: 0,
  total: 0,
  cacheRead: 0,
  cacheMiss: 0,
  cacheWrite: 0,
  cacheFieldMissing: 0,
  reasoning: 0,
  safety: 0,
})

/* ---- 02 核心实现：usageEntries、addUsage、summarizeSessionUsage ---- */
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
  if (usage.cache_fields_present === false) {
    totals.cacheFieldMissing += 1
  }
  totals.reasoning += Math.max(0, usage.reasoning_tokens ?? 0)
  totals.safety += Math.max(0, usage.safety_tokens ?? 0)
}

/* ---- 03 对外入口与收尾 ---- */
/**
 * 汇总一个会话里所有助手回复的接口 usage。
 * 会话消息包含分支与重新生成产生的全部请求，正好对应实际消耗。
 */
export const summarizeSessionUsage = (messages: AssistantMessage[]): SessionUsageSummary => {
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

/* ============================================================================
 * 功能区：本地服务 / tokenUsage 结束
 * ========================================================================== */
