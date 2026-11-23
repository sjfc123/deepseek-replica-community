import type { Message, Session } from './types.js'
import { createId } from '../../utils/id.js'

/** 记忆模式：关闭 / 每轮整段记录 / 每轮记录后用模型提炼合并 */
export type MemoryMode = 'off' | 'turn' | 'refine'

/**
 * 一条长期记忆。挂在产生它的消息上，跟随分支：切换版本时看不到另一条分支的记忆，
 * 从某条消息分叉出来的新分支则天然继承祖先链上的全部卡片。
 */
export type MemoryCard = {
  id: string
  text: string
  createdAt: number
  /** 关掉后不再注入 system，但卡片保留 */
  enabled: boolean
  source: 'auto' | 'refine' | 'manual'
  /** 被后续提炼结果取代的旧卡片：只隐藏注入，仍在面板里可见 */
  superseded?: boolean
  /** 置顶：每轮必注入，优先占用预算 */
  pinned?: boolean
}

/** 注入上限：卡片条数与字符总量；字符预算可由设置页调整，默认 1,000,000 */
export const MEMORY_MAX_CARDS = 60
export const MEMORY_MAX_CHARS = 1_000_000
/** 注入配额：置顶、最近、与当前发言相关的旧卡片各自的上限 */
export const MEMORY_PINNED_MAX = 8
export const MEMORY_RECENT_INJECT = 12
export const MEMORY_RELEVANT_INJECT = 12

/** 一轮记忆里用户与角色各自的截断长度 */
const TURN_USER_CHARS = 120
const TURN_ROLE_CHARS = 180

const clip = (text: string, limit: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : flat
}

/** 回复正文（不含思考块），用于生成记忆与提炼材料 */
export const replyPlainText = (message: Message): string => {
  if (message.role !== 'assistant') {
    return message.content
  }
  const parts: string[] = []
  for (const block of message.blocks) {
    if (block.type === 'text' && block.text.trim()) {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/** 一轮对话压成一张卡片：用户说了什么、角色如何回应 */
export const buildTurnMemoryText = (question: string, answer: string) => {
  const asked = clip(question, TURN_USER_CHARS)
  const replied = clip(answer, TURN_ROLE_CHARS)
  if (!asked && !replied) {
    return ''
  }
  return replied ? `用户：${asked}\n角色：${replied}` : `用户：${asked}`
}

/** 当前可见路径上的所有卡片（含被取代、被关闭的，供面板展示） */
export const collectVisibleMemories = (_session: Session, messages: Message[]) =>
  messages.flatMap((message) =>
    (message.memories ?? []).map((card) => ({ card, messageId: message.id }))
  )

/** 实际注入 system 的卡片：启用、未被取代，按时间先后；limit 为保留上限 */
export const activeMemoryCards = (
  session: Session,
  messages: Message[],
  limit = MEMORY_MAX_CARDS
) =>
  collectVisibleMemories(session, messages)
    .filter(({ card }) => card.enabled && !card.superseded)
    .sort((a, b) => a.card.createdAt - b.card.createdAt)
    .slice(-Math.max(1, limit))

/**
 * 超出保留上限的自动卡片（手动卡片不占配额）。
 * 返回最早的那批，由 store 标成归档：不删除、可在面板查看，只是不再注入。
 */
export const overflowMemoryCards = (
  session: Session,
  messages: Message[],
  limit: number
) => {
  const auto = collectVisibleMemories(session, messages)
    .filter(({ card }) => card.source !== 'manual' && !card.superseded)
    .sort((a, b) => a.card.createdAt - b.card.createdAt)
  const excess = auto.length - Math.max(1, limit)
  return excess > 0 ? auto.slice(0, excess) : []
}

/**
 * 拼成 system 前缀。放在角色设定之前，作为「既定事实」层；
 * 文案明确要求模型不要复述本段，避免把记忆说成设定说明。
 */
const STOP_TERMS = new Set(['用户', '角色', '什么', '怎么', '就是', '这个', '那个', '不是', '没有'])

/** 从最新一句用户发言里取 2–6 字词块，用于和旧卡片做本地重合度匹配 */
const queryTerms = (query: string) => {
  const terms = new Set<string>()
  for (const raw of query.toLowerCase().split(/[^\p{Script=Han}a-z0-9]+/u)) {
    if (raw.length < 2 || STOP_TERMS.has(raw)) {
      continue
    }
    if (raw.length <= 6) {
      terms.add(raw)
      continue
    }
    for (let size = 2; size <= 6; size++) {
      for (let start = 0; start + size <= raw.length; start++) {
        terms.add(raw.slice(start, start + size))
      }
    }
  }
  return [...terms]
}

/**
 * 每轮真正注入的卡片：置顶 → 最近几轮 → 与当前发言重合的旧卡。
 * 最近优先保证新记忆不被字符预算挤掉；旧卡靠关键词命中补回来。
 */
export const selectMemoryCardsForInjection = (
  session: Session,
  messages: Message[],
  limit: number,
  query: string
) => {
  const active = collectVisibleMemories(session, messages)
    .filter(({ card }) => card.enabled && !card.superseded)
    .sort((a, b) => a.card.createdAt - b.card.createdAt)
    .slice(-Math.max(1, limit))
  const pinned = active.filter(({ card }) => card.pinned).slice(-MEMORY_PINNED_MAX)
  const pinnedIds = new Set(pinned.map(({ card }) => card.id))
  const unpinned = active.filter(({ card }) => !pinnedIds.has(card.id))
  const recent = unpinned.slice(-MEMORY_RECENT_INJECT)
  const older = unpinned.slice(0, Math.max(0, unpinned.length - MEMORY_RECENT_INJECT))
  const terms = queryTerms(query)
  const relevant =
    terms.length === 0
      ? []
      : older
          .map((entry) => {
            const text = entry.card.text.toLowerCase()
            let score = 0
            for (const term of terms) {
              if (text.includes(term)) {
                score += term.length
              }
            }
            return { entry, score }
          })
          .filter((item) => item.score > 3)
          .sort((a, b) => b.score - a.score)
          .slice(0, MEMORY_RELEVANT_INJECT)
          .map((item) => item.entry)
  const chosen = [...pinned, ...[...recent].reverse(), ...relevant]
  const seen = new Set<string>()
  return chosen.filter(({ card }) => {
    if (seen.has(card.id)) {
      return false
    }
    seen.add(card.id)
    return true
  })
}

export const formatMemoryBlock = (
  cards: MemoryCard[],
  limit = MEMORY_MAX_CARDS,
  chars = MEMORY_MAX_CHARS
) => {
  if (cards.length === 0) {
    return ''
  }
  const lines: string[] = []
  let used = 0
  for (const card of cards.slice(0, limit)) {
    const line = `- ${card.text.replace(/\n/g, ' / ')}`
    if (used + line.length > Math.max(1, chars)) {
      break
    }
    lines.push(line)
    used += line.length
  }
  if (lines.length === 0) {
    return ''
  }
  return (
    '【长期记忆 · 最高优先级】\n' +
    '以下是你与{{user}}此前对话沉淀下来的记忆，属于已经发生的事实。' +
    '当它们与角色设定、其他说明冲突时，以本段记忆为准；回答时自然沿用其中的称呼、关系、偏好与约定。' +
    '不要向{{user}}复述本段，也不要提到「记忆」「卡片」「设定」这类词。\n' +
    lines.join('\n')
  )
}

/** 提炼用的材料：现有卡片 + 最新一轮 */
export const buildRefinePrompt = (
  cards: MemoryCard[],
  question: string,
  answer: string,
  userName: string
) => {
  const existing =
    cards.length > 0
      ? cards.map((card, index) => `${index + 1}. ${card.text.replace(/\n/g, ' / ')}`).join('\n')
      : '（暂无）'
  return (
    `用户名字：${userName}\n\n【已有记忆】\n${existing}\n\n` +
    `【最新一轮】\n用户：${clip(question, 240)}\n角色：${clip(answer, 320)}\n\n` +
    '请把最新一轮并入已有记忆，输出合并后的记忆清单。'
  )
}

/** 提炼结果按行拆成卡片，过滤空行与序号 */
export const parseRefinedCards = (text: string, limit = MEMORY_MAX_CARDS) =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s\-•·*]+/, '').replace(/^\d+[.、)]\s*/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('【'))
    .slice(0, limit)

/** 新建一张卡片；调用方负责挂到具体消息上 */
export const createMemoryCard = (
  text: string,
  source: MemoryCard['source'],
  createdAt = Date.now()
): MemoryCard => ({
  id: createId(),
  text: text.trim(),
  createdAt,
  enabled: true,
  source,
})
