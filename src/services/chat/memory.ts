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
  source: 'auto' | 'refine' | 'manual' | 'bulk'
  /** 已归档：被提炼结果取代，或超出卡片/字数上限；不再注入，仍在面板可见，文本不删除 */
  superseded?: boolean
  /** 置顶：每轮必注入，优先占用预算 */
  pinned?: boolean
  /** 这条记忆发生的轮次，用于面板与时间线阅读；旧卡片可能没有 */
  turnIndex?: number
  /** 记录当时的关系阶段快照，例如「刚认识」「恋人」 */
  relationship?: string
}

/** 注入上限：卡片条数与字符总量；字符预算可由设置页调整，默认 1,000,000 */
export const MEMORY_MAX_CARDS = 60
export const MEMORY_MAX_CHARS = 1_000_000
/** 注入配额：置顶、最近、与当前发言相关的旧卡片各自的上限 */
export const MEMORY_PINNED_MAX = 8
export const MEMORY_RECENT_INJECT = 12
export const MEMORY_RELEVANT_INJECT = 12

/** 时间锚点：把本地时间写成模型和人都能读的短格式 */
export const formatMemoryStamp = (value: number) => {
  const date = new Date(value)
  const pad = (input: number) => String(input).padStart(2, '0')
  const week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} 周${week} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

const addDays = (value: number, days: number) => {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return startOfDay(date)
}

/** 周一为一周起点，周日是第 6 天 */
const weekdayIndex = (label: string) => {
  const map: Record<string, number> = {
    一: 0,
    二: 1,
    三: 2,
    四: 3,
    五: 4,
    六: 5,
    日: 6,
    天: 6,
  }
  return map[label]
}

const weekStart = (value: number) => {
  const date = new Date(value)
  const weekday = (date.getDay() + 6) % 7
  return addDays(value, -weekday)
}

type MemoryTimeRange = { start: number; end: number }

/**
 * 从玩家这句话里识别“上周三、昨天、上个月、去年、11月18日”这类时间锚点。
 * 只用于本地召回排序，不做自然语言理解；认不出来的说法会退回关键词匹配。
 */
export const parseMemoryTimeHints = (query: string, now = new Date()): MemoryTimeRange[] => {
  const text = query.replace(/\s+/g, '')
  const ranges: MemoryTimeRange[] = []
  const push = (start: number, end: number) => {
    if (end > start) {
      ranges.push({ start, end })
    }
  }
  const today = startOfDay(now)
  const yesterday = addDays(today, -1)
  const beforeYesterday = addDays(today, -2)
  const beforeThreeDays = addDays(today, -3)
  const hasExactDate = /(?:去年|前年|\d{4}年)?\d{1,2}月\d{1,2}[日号]/.test(text)

  if (/大前天/.test(text)) {
    push(beforeThreeDays, addDays(beforeThreeDays, 1))
  } else if (/前天/.test(text)) {
    push(beforeYesterday, yesterday)
  } else if (/昨天/.test(text)) {
    push(yesterday, today)
  } else if (/今天|今日/.test(text)) {
    push(today, addDays(today, 1))
  }

  const lastWeek = weekStart(today) - 7 * 86400000
  const currentWeek = weekStart(today)
  const weekMatch =
    text.match(/上上周([一二三四五六日天])?/) ?? text.match(/上周([一二三四五六日天])?/)
  if (weekMatch) {
    const base = weekMatch[0].startsWith('上上周') ? lastWeek - 7 * 86400000 : lastWeek
    const day = weekMatch[1] ? weekdayIndex(weekMatch[1]) : null
    if (day === null) {
      push(base, base + 7 * 86400000)
    } else {
      push(base + day * 86400000, base + (day + 1) * 86400000)
    }
  } else {
    const weeklyText = text.replace(
      /上上周(?:[一二三四五六日天])?|上周(?:[一二三四五六日天])?/g,
      ''
    )
    const thisWeekMatch = weeklyText.match(/周([一二三四五六日天])/)
    if (thisWeekMatch) {
      const day = weekdayIndex(thisWeekMatch[1])
      push(currentWeek + day * 86400000, currentWeek + (day + 1) * 86400000)
    } else if (/这周|本周/.test(text)) {
      push(currentWeek, currentWeek + 7 * 86400000)
    }
  }

  if (/前几天/.test(text)) {
    push(addDays(today, -7), today)
  } else if (/前阵子|前段时间/.test(text)) {
    push(addDays(today, -30), today)
  }

  if (!hasExactDate) {
    if (/上个月|上月/.test(text)) {
      const month = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
      const next = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      push(month, next)
    } else if (/这个月|本月/.test(text)) {
      const month = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
      push(month, next)
    }

    if (/前年/.test(text)) {
      push(
        new Date(now.getFullYear() - 2, 0, 1).getTime(),
        new Date(now.getFullYear() - 1, 0, 1).getTime()
      )
    } else if (/去年/.test(text)) {
      const year = new Date(now.getFullYear() - 1, 0, 1).getTime()
      push(year, new Date(now.getFullYear(), 0, 1).getTime())
    } else if (/今年/.test(text)) {
      push(
        new Date(now.getFullYear(), 0, 1).getTime(),
        new Date(now.getFullYear() + 1, 0, 1).getTime()
      )
    }
  }

  const exact = text.match(/(?:(去年)|(前年)|(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]/)
  if (exact) {
    const year = exact[1]
      ? now.getFullYear() - 1
      : exact[2]
        ? now.getFullYear() - 2
        : exact[3]
          ? Number(exact[3])
          : now.getFullYear()
    const month = Number(exact[4]) - 1
    const day = Number(exact[5])
    let start = new Date(year, month, day).getTime()
    // 只写了“X月X日”而且落在未来，按记忆语境回退到去年；明确写了年份的不回退
    if (!exact[1] && !exact[2] && !exact[3] && start > now.getTime()) {
      start = new Date(year - 1, month, day).getTime()
    }
    if (Number.isFinite(start)) {
      push(start, addDays(start, 1))
    }
  }

  return ranges
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

/** 一轮对话写成一张完整记忆卡：时间锚点、用户原话、角色回应 */
export const buildTurnMemoryText = (
  question: string,
  answer: string,
  meta: { at?: number; turnIndex?: number; relationship?: string } = {}
) => {
  const asked = question.trim()
  const replied = answer.trim()
  if (!asked && !replied) {
    return ''
  }
  const head = meta.at
    ? `【${formatMemoryStamp(meta.at)}${meta.turnIndex ? ` · 第${meta.turnIndex}轮` : ''}${meta.relationship ? ` · 关系：${meta.relationship}` : ''}】`
    : ''
  return [head, asked ? `用户：${asked}` : '', replied ? `角色：${replied}` : '']
    .filter(Boolean)
    .join('\n')
}

/** 当前可见路径上的所有卡片（含被取代、被关闭的，供面板展示） */
export const collectVisibleMemories = (_session: Session, messages: Message[]) =>
  messages.flatMap((message) =>
    (message.memories ?? []).map((card) => ({ card, messageId: message.id }))
  )

/** 实际注入 system 的卡片：启用、未被取代，按时间先后；limit 为保留上限 */
export const activeMemoryCards = (session: Session, messages: Message[], limit?: number) => {
  const active = collectVisibleMemories(session, messages)
    .filter(({ card }) => card.enabled && !card.superseded)
    .sort((a, b) => a.card.createdAt - b.card.createdAt)
  return limit && limit > 0 ? active.slice(-limit) : active
}

/**
 * 超出保留上限的自动卡片（手动卡片不占配额）。
 * 返回最早的那批，由 store 标成归档：不删除、可在面板查看，只是不再注入。
 */
export const overflowMemoryCards = (session: Session, messages: Message[], limit: number) => {
  const auto = collectVisibleMemories(session, messages)
    .filter(({ card }) => card.source !== 'manual' && !card.pinned && !card.superseded)
    .sort((a, b) => a.card.createdAt - b.card.createdAt)
  const excess = auto.length - Math.max(1, limit)
  return excess > 0 ? auto.slice(0, excess) : []
}

/** 已启用、未归档、真正参与注入的卡片总字数 */
export const activeMemoryChars = (session: Session, messages: Message[]) =>
  collectVisibleMemories(session, messages)
    .filter(({ card }) => card.enabled && !card.superseded)
    .reduce((total, entry) => total + entry.card.text.length, 0)

/**
 * 超出字数上限时归档最早的自动卡片；手动卡片和置顶卡片不动。
 * 返回被归档的卡片，由 store 标记 superseded，不删除文本。
 */
export const overflowMemoryCardsByChars = (
  session: Session,
  messages: Message[],
  limit: number
) => {
  const active = collectVisibleMemories(session, messages)
    .filter(({ card }) => card.enabled && !card.superseded)
    .sort((a, b) => a.card.createdAt - b.card.createdAt)
  const total = active.reduce((sum, entry) => sum + entry.card.text.length, 0)
  const excess = total - Math.max(1, limit)
  if (excess <= 0) {
    return []
  }
  const archived = []
  let remaining = excess
  for (const entry of active) {
    if (remaining <= 0) {
      break
    }
    if (entry.card.source === 'manual' || entry.card.pinned) {
      continue
    }
    archived.push(entry)
    remaining -= entry.card.text.length
  }
  return archived
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
 * 每轮真正注入的卡片：置顶 → 最近几轮 → 与当前发言相关或落在同一时间段的旧卡。
 * 最近优先保证新记忆不被字符预算挤掉；旧卡靠关键词与时间锚点补回来。
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
  const pinned = active.filter(({ card }) => card.pinned).slice(-MEMORY_PINNED_MAX)
  const pinnedIds = new Set(pinned.map(({ card }) => card.id))
  const unpinned = active.filter(({ card }) => !pinnedIds.has(card.id)).slice(-Math.max(1, limit))
  const recent = unpinned.slice(-MEMORY_RECENT_INJECT)
  const older = unpinned.slice(0, Math.max(0, unpinned.length - MEMORY_RECENT_INJECT))
  const terms = queryTerms(query)
  const timeHints = parseMemoryTimeHints(query)
  const relevant =
    terms.length === 0 && timeHints.length === 0
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
            const timeHit = timeHints.some(
              (range) => entry.card.createdAt >= range.start && entry.card.createdAt < range.end
            )
            if (timeHit) {
              // 时间锚点比普通词更强：玩家问“上周三”，优先把那天的经历带回来
              score += 80
            }
            return { entry, score, timeHit }
          })
          .filter((item) => item.score > 3 || item.timeHit)
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
      if (lines.length === 0) {
        lines.push(line.slice(0, Math.max(1, chars)))
        used = chars
      }
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
    '以下是你与{{user}}共同经历的记忆片段：置顶在前，其后是最近和相关经历，都是已经发生的事实。' +
    '每条开头的时间、轮次和关系阶段是当时的锚点。\n' +
    '回应的规则：\n' +
    '1. 当{{user}}提到某个时间、地点、物品、约定或经历时，先在下面的记忆里找对应片段，再依据那段经历回应；找不到就如实说不确定，不要编造。\n' +
    '2. 记住你们的关系阶段、称呼、偏好、承诺和共同经历；不要把已经发生过的事当成第一次听说，也不要重置好感。\n' +
    '3. 当{{user}}的行动和记忆里的习惯、承诺、时间线或关系阶段有关时，先按那段记忆判断角色会怎么反应，再继续演出。\n' +
    '4. 如果记忆与当前场景冲突，以时间更近的记忆和当前场景为准；不确定时保留模糊，不要替{{user}}补完事实。\n' +
    '5. 不要向{{user}}复述本段，也不要提到「记忆」「卡片」「设定」这类词。\n' +
    lines.join('\n')
  )
}

/** 提炼用的材料：现有卡片 + 最新一轮；保留原文，不再按 240/320 字截断 */
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
    `【最新一轮】\n用户：${question.trim()}\n角色：${answer.trim()}\n\n` +
    '请把最新一轮并入已有记忆，输出合并后的记忆清单。' +
    '保留关系阶段、称呼、承诺、共同经历和时间线；只压缩重复与寒暄，不要删掉具体事件。'
  )
}

/** 提炼结果按行拆成卡片，过滤空行与序号 */
export const parseRefinedCards = (text: string, limit = MEMORY_MAX_CARDS) =>
  text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^[\s\-•·*]+/, '')
        .replace(/^\d+[.、)]\s*/, '')
        .trim()
    )
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

export type ConversationMemoryDraft = {
  /** 卡片挂到哪条消息上 */
  messageId: string
  card: MemoryCard
}

/**
 * 把当前分支的可见消息按“用户一句 + 角色一句”配对，生成完整回合记忆卡。
 * 不截断正文；时间锚点使用消息自己的时间，保存后仍按原来的先后顺序阅读。
 * 传入 pairAdjacent 时只配对原对话里真正相邻的用户消息与角色回复，避免手动多选时跨轮硬配。
 */
export const buildConversationMemoryCards = (
  messages: Message[],
  startTurn = 0,
  pairAdjacent?: (user: Message, assistant: Message) => boolean
): ConversationMemoryDraft[] => {
  const drafts: ConversationMemoryDraft[] = []
  let pendingUser: Message | null = null
  let turn = startTurn
  const push = (target: Message, question: string, answer: string) => {
    const text = buildTurnMemoryText(question, answer, {
      at: target.createdAt,
      turnIndex: turn + 1,
    })
    if (!text) {
      return
    }
    turn += 1
    drafts.push({
      messageId: target.id,
      card: createMemoryCard(text, 'bulk', target.createdAt),
    })
  }

  for (const message of messages) {
    if (message.role === 'user') {
      if (pendingUser) {
        push(pendingUser, pendingUser.content, '')
      }
      pendingUser = message
      continue
    }
    if (pendingUser && pairAdjacent && !pairAdjacent(pendingUser, message)) {
      push(pendingUser, pendingUser.content, '')
      pendingUser = null
    }
    push(message, pendingUser?.content ?? '', replyPlainText(message))
    pendingUser = null
  }
  if (pendingUser) {
    push(pendingUser, pendingUser.content, '')
  }
  return drafts
}
