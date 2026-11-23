import { getVisibleMessages } from './branches.js'
import { summarizeSessionUsage } from '../tokenUsage.js'
import type { AssistantMessage, Session } from './types.js'

/** 50000 → 50K，1000000 → 1M，其余原样带千分位 */
export const formatTokenCount = (tokens: number) => {
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000
    return `${Number.isInteger(value) ? value : value.toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    const value = tokens / 1_000
    return `${Number.isInteger(value) ? value : value.toFixed(1)}K`
  }
  return String(Math.max(0, Math.round(tokens)))
}

/**
 * 当前分支的接口实际用量：只累加助手回复里的 usage / usageHistory。
 * 没有 usage 的回复不参与，未产生请求时返回 0，不做本地分词估算。
 */
export const sessionActualUsage = (session: Session) => {
  const assistants = getVisibleMessages(session).filter(
    (message): message is AssistantMessage => message.role === 'assistant'
  )
  return summarizeSessionUsage(assistants).totals.total
}
