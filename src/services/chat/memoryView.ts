/* ============================================================================
 * 功能区：会话与角色核心 / memoryView 开始
 * 职责：记忆面板的纯视图逻辑：置顶排序、发言拆分、状态/时间/关键词筛选。
 * 导出：MemoryListEntry、MemoryStatusFilter、MemorySpeechFilter、MemoryTimeFilter、
 *      sortMemoryEntries、getMemorySpeech、memoryTextForView、filterMemoryEntries。
 * ========================================================================== */

import { getCharacterMemoryKind, type MemoryCard } from './memory.js'

export type MemoryListEntry = { card: MemoryCard; messageId: string }
export type MemoryStatusFilter =
  | 'all'
  | 'pinned'
  | 'active'
  | 'auto'
  | 'refine'
  | 'manual'
  | 'bulk'
  | 'scene'
  | 'fact'
  | 'archived'
export type MemorySpeechFilter = 'all' | 'user' | 'character' | 'scene'
export type MemoryTimeFilter = 'all' | 'today' | 'week' | 'older'

type MemorySpeech = {
  user: string[]
  character: string[]
  summary: string[]
}

/**
 * 自动记忆现在是「林默：」「凯伊：」这类具体说话人，旧卡与早期自动卡还可能是
 * 「玩家提问：」「角色回应：」「用户：」「角色：」。带 owner 的卡按归属收行，
 * 没有 owner 时才靠这些前缀拆分，且允许时间戳头与正文同处一行。
 */
const USER_LINE = /^\s*(?:用户|玩家|user)(?:提问|发言|说|问)?\s*[：:]\s*(.*)$/i
const CHARACTER_LINE =
  /^\s*(?:角色|助手|AI|assistant)(?:回应|回答|发言|说|答)?\s*[：:]\s*(.*)$/i
const HEADER_PREFIX = /^\s*【[^】]*】\s*/

const memoryPool = (card: MemoryCard) => (card.pool === 'normal' ? 'normal' : 'character')

const isPinnedActive = (card: MemoryCard) => Boolean(card.pinned && !card.superseded)

/** 置顶且未归档的卡片排最前；其余仍按时间倒序，保证新卡先看到 */
export const sortMemoryEntries = (entries: MemoryListEntry[]): MemoryListEntry[] =>
  entries.slice().sort((a, b) => {
    const pinDiff = Number(isPinnedActive(b.card)) - Number(isPinnedActive(a.card))
    return pinDiff !== 0 ? pinDiff : b.card.createdAt - a.card.createdAt
  })

/**
 * 把一轮卡片拆成用户发言、角色发言和剧情摘要。
 * 自动卡按「玩家提问：… / 角色回应：…」拆分，同时兼容旧卡的「用户：/ 角色：」；
 * 同一条发言跨多行时，直到下一条发言前缀出现前都归当前发言。
 * 普通记忆没有前缀时按 category 兜底，避免用户原话 / AI 原话筛选失效。
 */
export const getMemorySpeech = (card: MemoryCard): MemorySpeech => {
  const speech: MemorySpeech = { user: [], character: [], summary: [] }
  // 自动卡带 owner：整张卡都属于该发言，后续无前缀行不能被当成剧情摘要。
  let current: keyof MemorySpeech | null =
    card.owner === 'user' || card.owner === 'character' ? card.owner : null
  let continuation = false
  for (const line of card.text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    // 时间戳头可能单独一行，也可能与「玩家提问/角色回应」挤在同一行。
    const body = trimmed.replace(HEADER_PREFIX, '').trim()
    if (!body) {
      continue
    }
    const user = body.match(USER_LINE)
    if (user) {
      current = 'user'
      continuation = !user[1]
      if (user[1]) {
        speech.user.push(user[1])
      }
      continue
    }
    const character = body.match(CHARACTER_LINE)
    if (character) {
      current = 'character'
      continuation = !character[1]
      if (character[1]) {
        speech.character.push(character[1])
      }
      continue
    }
    const target: keyof MemorySpeech =
      current && (card.owner === current || continuation) ? current : 'summary'
    speech[target].push(body)
    current = target
    continuation = false
  }
  if (memoryPool(card) === 'normal' && speech.user.length === 0 && speech.character.length === 0) {
    if (card.category === 'user') {
      speech.user.push(card.text)
    } else if (card.category === 'ai') {
      speech.character.push(card.text)
    }
  }
  return speech
}

/** 当前发言分类下真正显示的文字；all 保持原卡全文 */
export const memoryTextForView = (card: MemoryCard, speech: MemorySpeechFilter): string => {
  if (speech === 'all') {
    return card.text
  }
  const parts = getMemorySpeech(card)
  if (speech === 'user') {
    return parts.user.join('\n')
  }
  if (speech === 'character') {
    return parts.character.join('\n')
  }
  return parts.summary.join('\n')
}

const statusMatches = (card: MemoryCard, status: MemoryStatusFilter) => {
  if (status === 'all') {
    return true
  }
  if (status === 'pinned') {
    return isPinnedActive(card)
  }
  if (status === 'active') {
    return Boolean(card.enabled && !card.superseded)
  }
  if (status === 'archived') {
    return Boolean(card.superseded)
  }
  if (status === 'scene' || status === 'fact') {
    return memoryPool(card) === 'character' && getCharacterMemoryKind(card) === status
  }
  return card.source === status
}

const speechMatches = (card: MemoryCard, speech: MemorySpeechFilter) => {
  if (speech === 'all') {
    return true
  }
  const parts = getMemorySpeech(card)
  if (speech === 'user') {
    return parts.user.length > 0
  }
  if (speech === 'character') {
    return parts.character.length > 0
  }
  return parts.summary.length > 0
}

const timeMatches = (card: MemoryCard, range: MemoryTimeFilter, now: number) => {
  if (range === 'all') {
    return true
  }
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const todayStart = today.getTime()
  const weekStart = todayStart - 6 * 86400000
  if (range === 'today') {
    return card.createdAt >= todayStart
  }
  if (range === 'week') {
    return card.createdAt >= weekStart
  }
  return card.createdAt < weekStart
}

/**
 * 面板筛选的唯一入口。有搜索词时跨分类检索；没有搜索词时只浏览当前顶层分类。
 * 发言筛选同时收窄搜索范围，避免在“角色的话”里被用户台词命中。
 */
export const filterMemoryEntries = (
  entries: MemoryListEntry[],
  options: {
    pool: 'character' | 'normal'
    status: MemoryStatusFilter
    speech: MemorySpeechFilter
    time: MemoryTimeFilter
    query: string
    now?: number
  }
): MemoryListEntry[] => {
  const needle = options.query.trim().toLowerCase()
  const searching = needle.length > 0
  const now = options.now ?? Date.now()
  return entries.filter(({ card }) => {
    if (!searching && memoryPool(card) !== options.pool) {
      return false
    }
    if (!statusMatches(card, options.status) || !timeMatches(card, options.time, now)) {
      return false
    }
    if (!speechMatches(card, options.speech)) {
      return false
    }
    if (!needle) {
      return true
    }
    return memoryTextForView(card, options.speech).toLowerCase().includes(needle)
  })
}

/* ============================================================================
 * 功能区：会话与角色核心 / memoryView 结束
 * ========================================================================== */
