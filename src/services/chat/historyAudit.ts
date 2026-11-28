/* ============================================================================
 * 功能区：会话与角色核心 / historyAudit · 历史会话结算
 * 职责：历史会话结算：从首条到末条逐条统计字符、分词 Token 与接口实际用量，分片让出主线程。
 * 分区：01 类型、常量与依赖；02 逐条统计与分片调度；03 缓存与对外入口
 * 关联：依赖 services/chat/branches、services/chat/context、services/chat/reply、services/chat/types、services/tokenUsage；
 *    被 services/chat/store 引用。
 * 导出：HistoryAuditStats、auditSessionHistory、cachedHistoryAudit、forgetHistoryAudit
 * 边界：只读会话数据，不写数据库、不发请求；结果只用于界面展示。
 * ========================================================================== */

import { getVisibleMessages } from './branches.js'
import { WINDOW_TOKENS } from './context.js'
import { estimateTextTokens } from './tokenEstimator.js'
import { getReplyText } from './reply.js'
import { summarizeSessionUsage, type UsageTotals } from '../tokenUsage.js'
import type { AssistantMessage, Message, Session } from './types.js'

/* ---- 01 类型、常量与依赖 ---- */
/** 每批统计的消息数；批间让出事件循环，避免新对话切页时被整段历史占住主线程。 */
const AUDIT_CHUNK = 24
/** 每条消息的协议开销（角色标记、分隔符）近似值。 */
const MESSAGE_OVERHEAD_TOKENS = 8
/** 思考块的开销近似值。 */
const THINKING_OVERHEAD_TOKENS = 4
const HEAVIEST_LIMIT = 5
const CACHE_LIMIT = 8

export type HistoryAuditHeavy = {
  index: number
  role: 'user' | 'assistant'
  chars: number
  tokens: number
  preview: string
}

export type HistoryAuditStats = {
  sessionId: string
  title: string
  createdAt: number
  updatedAt: number
  /** 会话里实际存储的消息数（含旁支版本） */
  storedMessages: number
  /** 当前分支上的消息数 */
  messages: number
  userMessages: number
  assistantMessages: number
  /** 一问一答记一轮，末条用户消息没有回复时也算一轮 */
  turns: number
  userChars: number
  assistantChars: number
  thinkingChars: number
  totalChars: number
  userTokens: number
  assistantTokens: number
  thinkingTokens: number
  /** 按分词逐条累加的总量，含每条消息的协议开销 */
  totalTokens: number
  /** 接口实际记录的用量；导入会话通常为 0 次请求 */
  usage: UsageTotals & { requests: number; replies: number; legacyReplies: number }
  /** 分词总量占默认上下文窗口的比例 */
  contextShare: number
  heaviest: HistoryAuditHeavy[]
}

/* ---- 02 逐条统计与分片调度 ---- */
const textOf = (message: Message): string =>
  message.role === 'assistant' ? getReplyText(message) : message.content

const thinkingOf = (message: Message): string => {
  if (message.role !== 'assistant') {
    return ''
  }
  const parts: string[] = []
  for (const block of message.blocks) {
    if (block.type === 'thinking' && block.thinking.trim()) {
      parts.push(block.thinking)
    }
  }
  return parts.join('\n')
}

const previewOf = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)

const emptyUsage = (): HistoryAuditStats['usage'] => ({
  input: 0,
  output: 0,
  total: 0,
  cacheRead: 0,
  cacheMiss: 0,
  cacheWrite: 0,
  cacheFieldMissing: 0,
  requests: 0,
  replies: 0,
  legacyReplies: 0,
})

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * 结算一条会话：首条到末条的全部可见消息，逐条计字符与分词 Token，
 * 再叠加接口记录的 usage。统计按批次让出事件循环，调用方可以边显示进度边等待。
 */
export const auditSessionHistory = async (
  session: Session,
  onProgress?: (done: number, total: number) => void
): Promise<HistoryAuditStats> => {
  const messages = getVisibleMessages(session)
  let userMessages = 0
  let assistantMessages = 0
  let userChars = 0
  let assistantChars = 0
  let thinkingChars = 0
  let userTokens = 0
  let assistantTokens = 0
  let thinkingTokens = 0
  const heaviest: HistoryAuditHeavy[] = []

  for (let start = 0; start < messages.length; start += AUDIT_CHUNK) {
    const end = Math.min(messages.length, start + AUDIT_CHUNK)
    for (let index = start; index < end; index++) {
      const message = messages[index]
      const text = textOf(message)
      const thinking = thinkingOf(message)
      const textTokens = estimateTextTokens(text) + MESSAGE_OVERHEAD_TOKENS
      const thoughtTokens = thinking
        ? estimateTextTokens(thinking) + THINKING_OVERHEAD_TOKENS
        : 0
      const chars = text.length + thinking.length
      const tokens = textTokens + thoughtTokens
      if (message.role === 'user') {
        userMessages += 1
        userChars += text.length
        userTokens += textTokens
      } else {
        assistantMessages += 1
        assistantChars += text.length
        thinkingChars += thinking.length
        assistantTokens += textTokens
        thinkingTokens += thoughtTokens
      }
      if (tokens > 0 && (heaviest.length < HEAVIEST_LIMIT || tokens > heaviest[heaviest.length - 1].tokens)) {
        heaviest.push({
          index,
          role: message.role,
          chars,
          tokens,
          preview: previewOf(text || thinking),
        })
        heaviest.sort((a, b) => b.tokens - a.tokens)
        if (heaviest.length > HEAVIEST_LIMIT) {
          heaviest.pop()
        }
      }
    }
    onProgress?.(end, messages.length)
    if (end < messages.length) {
      await nextFrame()
    }
  }

  // 三段互不重叠：用户正文、助手正文、思考块；总量是三者相加。
  const totalTokens = userTokens + assistantTokens + thinkingTokens
  const totalChars = userChars + assistantChars + thinkingChars
  const turns = userMessages
  const assistants = messages.filter(
    (message): message is AssistantMessage => message.role === 'assistant'
  )
  const summary = summarizeSessionUsage(assistants)
  const usage = { ...emptyUsage(), ...summary.totals, requests: summary.requests, replies: summary.replies, legacyReplies: summary.legacyReplies }

  const stats: HistoryAuditStats = {
    sessionId: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    storedMessages: session.messages.length,
    messages: messages.length,
    userMessages,
    assistantMessages,
    turns,
    userChars,
    assistantChars,
    thinkingChars,
    totalChars,
    userTokens,
    assistantTokens,
    thinkingTokens,
    totalTokens,
    usage,
    contextShare: WINDOW_TOKENS > 0 ? totalTokens / WINDOW_TOKENS : 0,
    heaviest,
  }
  rememberHistoryAudit(stats)
  return stats
}

/* ---- 03 缓存与对外入口 ---- */
const cache = new Map<string, HistoryAuditStats>()
const auditKey = (session: Session) =>
  `${session.id}|${session.updatedAt}|${session.messages.length}`

/** 同一版本会话的结算结果可直接复用；会话更新或消息增减后自动失效。 */
export const cachedHistoryAudit = (session: Session) => cache.get(auditKey(session))

/** 删除或合并会话后丢掉对应缓存，避免下次点新对话拿到旧数字。 */
export const forgetHistoryAudit = (sessionId: string) => {
  for (const key of cache.keys()) {
    if (key.startsWith(`${sessionId}|`)) {
      cache.delete(key)
    }
  }
}

export const rememberHistoryAudit = (stats: HistoryAuditStats) => {
  cache.set(`${stats.sessionId}|${stats.updatedAt}|${stats.storedMessages}`, stats)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (!oldest) {
      break
    }
    cache.delete(oldest)
  }
}

/* ============================================================================
 * 功能区：会话与角色核心 / historyAudit 结束
 * ========================================================================== */
