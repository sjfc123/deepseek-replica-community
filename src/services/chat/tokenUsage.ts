/* ============================================================================
 * 功能区：会话与角色核心 / tokenUsage · 会话用量汇总
 * 职责：会话用量汇总：按消息 usage 聚合输入、输出、缓存与费用条目。
 * 分区：01 类型、契约与依赖
 * 关联：依赖 services/chat/branches、services/chat/types、services/tokenUsage；
 *    被 components/messages/AssistantMessage、components/messages/MessageList、components/messages/TokenLimitDialog、components/messages/TokenUsageChip 等 5 个模块 引用。
 * 导出：formatTokenCount、sessionActualUsage
 * 边界：只处理聊天领域的数据、状态转换与提示词装配；不直接渲染视图，不发起职责外的网络请求。
 * ========================================================================== */

import { getVisibleMessages } from './branches.js'
import { summarizeSessionUsage } from '../tokenUsage.js'
import type { AssistantMessage, Session } from './types.js'

/* ---- 01 类型、契约与依赖 ---- */
/**
 * 1,000,000 以下显示完整数字并带千分位，保留一位小数（有小数时）；
 * 达到 1,000,000 才切成 1M / 1.1M 这类缩写，方便一眼看出量级。
 */
export const formatTokenCount = (tokens: number) => {
  const value = Math.max(0, tokens)
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  const rounded = Math.round(value * 10) / 10
  return rounded.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
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

/* ============================================================================
 * 功能区：会话与角色核心 / tokenUsage 结束
 * ========================================================================== */
