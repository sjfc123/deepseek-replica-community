/* ============================================================================
 * 功能区：会话与角色核心 / memory · 长期记忆数据层
 * 职责：长期记忆数据层：卡片生成、时间锚点、分类、预算与注入格式化。
 * 分区：01 类型、常量与模块依赖；02 注入配额与上限；03 回合记忆生成；04 可见与生效卡片筛选；05 注入优先级与预算；
 *    06 system 记忆块格式化；07 卡片创建与回合归档；08 普通记忆逐条建档
 * 关联：依赖 services/chat/types、utils/id；
 *    被 scripts/test-memory-layers、components/memory/MemoryPanel、components/messages/MessageList、components/session/SessionView 等 12 个模块 引用。
 * 导出：MemoryMode、MemoryPool、NormalMemoryKind、CharacterMemoryKind、MemoryOwner、MEMORY_OWNERS、MemoryNames、memoryOwnerLabel、memorySpeakerName、CHARACTER_MEMORY_KINDS、characterMemoryLabel、getCharacterMemoryKind 等 53 项
 * 边界：只处理记忆卡、预算、注入文本与时间锚点；不维护面板筛选与 UI 状态。
 * ========================================================================== */

import type { Message, Session } from './types.js'
import { createId } from '../../utils/id.js'

/* ---- 01 类型、常量与模块依赖 ---- */
/** 记忆模式：关闭 / 每轮整段记录 / 每轮记录后用模型提炼合并 */
export type MemoryMode = 'off' | 'turn' | 'refine'

/** 顶层分类：普通记忆用于开发、问答与代码检索；角色记忆用于角色扮演剧情 */
export type MemoryPool = 'character' | 'normal'

/** 普通记忆子分类：对话 / 代码 / 用户原话 / AI 原话 */
export type NormalMemoryKind = 'dialogue' | 'code' | 'user' | 'ai'

/** 角色记忆类型：完整回合 / 重要场景 / 关键事实；旧卡没有该字段时按回合处理 */
export type CharacterMemoryKind = 'turn' | 'scene' | 'fact'

/** 记忆归属：角色自己的经历与信息 / 玩家自己的经历与信息 / 双方共同经历 */
export type MemoryOwner = 'character' | 'user' | 'shared'

export const MEMORY_OWNERS: MemoryOwner[] = ['shared', 'character', 'user']

export type MemoryNames = {
  user?: string
  character?: string
}

const PLACEHOLDER_NAMES = ['用户', '本地用户', '玩家', '角色', 'ai', 'deepseek', 'assistant']

/** 去掉昵称里的冒号与换行，避免拼进记忆行时破坏「名字：正文」结构。 */
const cleanMemoryName = (value: string | undefined) => {
  const name = (value ?? '').replace(/[:：\r\n]+/g, ' ').trim()
  return name && !PLACEHOLDER_NAMES.includes(name.toLowerCase()) ? name : ''
}

/** 面板标签优先显示当时记录的名字；没有名字或仍是占位名时回退到归属说明。 */
export const memoryOwnerLabel = (owner: MemoryOwner, names?: MemoryNames) => {
  if (owner === 'character') {
    return cleanMemoryName(names?.character) || '角色本人'
  }
  if (owner === 'user') {
    return cleanMemoryName(names?.user) || '玩家本人'
  }
  return '共同经历'
}

/** 自动记忆正文里的说话人：有名字用名字，没有名字用玩家 / 角色，不再写泛称「用户」。 */
export const memorySpeakerName = (value: string | undefined, defaultSpeaker: '玩家' | '角色') =>
  cleanMemoryName(value) || defaultSpeaker

export const CHARACTER_MEMORY_KINDS: CharacterMemoryKind[] = ['turn', 'scene', 'fact']

export const characterMemoryLabel = (kind: CharacterMemoryKind) => {
  if (kind === 'scene') {
    return '重要场景'
  }
  if (kind === 'fact') {
    return '关键事实'
  }
  return '整轮回合'
}

/** 缺省与旧卡都按整轮回合；重要场景与关键事实属于玩家明确标记的核心记忆 */
export const getCharacterMemoryKind = (card: MemoryCard): CharacterMemoryKind =>
  card.pool === 'normal' ? 'turn' : (card.memoryKind ?? 'turn')

/** 缺省与旧卡都按共同经历；手动卡由玩家显式改归属。 */
export const getMemoryOwner = (card: MemoryCard): MemoryOwner => card.owner ?? 'shared'

/** 核心记忆不参与自动配额淘汰：重要场景与关键事实由玩家主动挑出，文本必须长期保留 */
export const isCoreMemory = (card: MemoryCard) =>
  getMemoryPool(card) === 'character' &&
  (getCharacterMemoryKind(card) === 'scene' || getCharacterMemoryKind(card) === 'fact')

export const NORMAL_MEMORY_KINDS: NormalMemoryKind[] = ['dialogue', 'code', 'user', 'ai']

export const normalMemoryLabel = (kind: NormalMemoryKind) => {
  if (kind === 'code') {
    return '代码'
  }
  if (kind === 'user') {
    return '用户原话'
  }
  if (kind === 'ai') {
    return 'AI 原话'
  }
  return '对话'
}

/** 旧卡片没有 pool 字段，一律视为角色记忆，保证存量时间线与注入不被破坏 */
export const getMemoryPool = (card: MemoryCard): MemoryPool =>
  card.pool === 'normal' ? 'normal' : 'character'

export const getNormalMemoryKind = (card: MemoryCard): NormalMemoryKind =>
  card.pool === 'normal' && card.category ? card.category : 'dialogue'

/** 三连反引号才算代码块；单行单反引号、普通引用不算 */
export const detectCodeBlock = (text: string) => /(^|\n)\s*```/.test(text)

/** 从代码块开头提取语言标记，例如 ```java → java */
export const detectCodeLanguage = (text: string): string | undefined => {
  const match = text.match(/(?:^|\n)\s*```([a-zA-Z0-9_+#.-]+)/)
  return match?.[1]?.toLowerCase()
}

/**
 * 普通记忆的子分类推荐：只做预选，用户可以在保存弹窗里改。
 * 代码块优先；其余按消息角色区分用户原话与 AI 原话。
 */
export const detectNormalMemoryKind = (text: string, role?: Message['role']): NormalMemoryKind => {
  if (detectCodeBlock(text)) {
    return 'code'
  }
  if (role === 'user') {
    return 'user'
  }
  if (role === 'assistant') {
    return 'ai'
  }
  return 'dialogue'
}

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
  /** 顶层分类；缺省视为 character（旧卡兼容） */
  pool?: MemoryPool
  /** 普通记忆子分类；角色记忆不使用 */
  category?: NormalMemoryKind
  /** 角色记忆类型；缺省视为完整回合，普通记忆不写该字段 */
  memoryKind?: CharacterMemoryKind
  /** 记忆归属；缺省视为共同经历，避免旧卡被误判成角色或玩家单方 */
  owner?: MemoryOwner
  /** 生成这张卡时的说话人名字；旧卡没有该字段，面板回退到归属说明 */
  speaker?: string
  /** 玩家提到这些词、动作或地点时，角色更容易想起这张卡；只作触发线索，不朗读 */
  trigger?: string
  /** 允许角色在气氛合适时主动提起，不必等玩家问到 */
  proactive?: boolean
  /** 代码块语言标记，便于搜索；只对普通-代码卡片有意义 */
  language?: string
  /** 已归档：被提炼结果取代，或超出卡片/字数上限；不再注入，仍在面板可见，文本不删除 */
  superseded?: boolean
  /** 置顶：每轮必注入，优先占用预算 */
  pinned?: boolean
  /** 这条记忆发生的轮次，用于面板与时间线阅读；旧卡片可能没有 */
  turnIndex?: number
  /** 记录当时的关系阶段快照，例如「刚认识」「恋人」 */
  relationship?: string
}

/* ---- 02 注入配额与上限 ---- */
/** 注入上限：卡片条数与字符总量；字符预算可由设置页调整，默认 1,000,000 */
export const MEMORY_MAX_CARDS = 60
export const MEMORY_MAX_CHARS = 1_000_000
/** 普通记忆独立配额默认值：默认 300 张、20 万字，避免和角色剧情互相挤占 */
export const NORMAL_MEMORY_MAX_CARDS = 300
export const NORMAL_MEMORY_MAX_CHARS = 200_000
/** 注入配额：置顶、最近、与当前发言相关的旧卡片各自的上限 */
export const MEMORY_PINNED_MAX = 8
export const MEMORY_RECENT_INJECT = 12
export const MEMORY_RELEVANT_INJECT = 12
/** 重要场景与关键事实每轮固定带回的条数；它们不需要等关键词命中 */
export const MEMORY_SCENE_INJECT = 6
export const MEMORY_FACT_INJECT = 6

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

/* ---- 03 回合记忆生成 ---- */
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

/**
 * 一轮对话拆成两张归属明确的记忆卡：玩家提问归「玩家本人」，角色回应归「角色本人」。
 * 两张卡共享同一时间锚点与轮次；不把双方原话塞进同一段，避免注入时把谁说的搞混。
 */
export const buildTurnMemoryCards = (
  question: string,
  answer: string,
  meta: {
    at?: number
    turnIndex?: number
    relationship?: string
    userName?: string
    characterName?: string
  } = {}
): Array<{ text: string; owner: MemoryOwner; speaker?: string }> => {
  const asked = question.trim()
  const replied = answer.trim()
  const head = meta.at
    ? `【${formatMemoryStamp(meta.at)}${meta.turnIndex ? ` · 第${meta.turnIndex}轮` : ''}${meta.relationship ? ` · 关系：${meta.relationship}` : ''}】`
    : ''
  // 有名字时写成「阿澈：… / 小明：…」；同一名字加身份后缀，避免两句话看起来是同一个人说的。
  const named = Boolean(cleanMemoryName(meta.userName) || cleanMemoryName(meta.characterName))
  const userSpeaker = memorySpeakerName(meta.userName, '玩家')
  const characterSpeaker = memorySpeakerName(meta.characterName, '角色')
  const sameSpeaker = named && userSpeaker === characterSpeaker
  const userPrefix = named
    ? `${sameSpeaker ? `${userSpeaker}（玩家）` : userSpeaker}：`
    : '玩家提问：'
  const characterPrefix = named
    ? `${sameSpeaker ? `${characterSpeaker}（角色）` : characterSpeaker}：`
    : '角色回应：'
  const cards: Array<{ text: string; owner: MemoryOwner; speaker?: string }> = []
  if (asked) {
    cards.push({
      text: [head, `${userPrefix}${asked}`].filter(Boolean).join('\n'),
      owner: 'user',
      ...(named ? { speaker: sameSpeaker ? `${userSpeaker}（玩家）` : userSpeaker } : {}),
    })
  }
  if (replied) {
    cards.push({
      text: [head, `${characterPrefix}${replied}`].filter(Boolean).join('\n'),
      owner: 'character',
      ...(named
        ? { speaker: sameSpeaker ? `${characterSpeaker}（角色）` : characterSpeaker }
        : {}),
    })
  }
  return cards
}

/**
 * 重要场景 / 关键事实卡：从选中的对话里拆出一段独立记忆。
 * 保存时可在弹窗里继续删改，不强行截断；卡片仍挂到最后一轮消息上以跟随分支。
 * 场景卡不做“用户/角色”逐行解析，而是以场景叙述为主体，避免和完整回合卡重复。
 */
export const buildImportantMemoryCards = (
  messages: Message[],
  kind: Exclude<CharacterMemoryKind, 'turn'>,
  content?: string
): ConversationMemoryDraft[] => {
  const picked = messages.filter((message) => {
    const body = message.role === 'assistant' ? replyPlainText(message) : message.content
    return Boolean(body.trim())
  })
  if (picked.length === 0) {
    return []
  }
  const last = picked[picked.length - 1]
  const joinedTranscript = picked
    .map((message) => {
      const body = message.role === 'assistant' ? replyPlainText(message) : message.content
      return body.trim()
    })
    .filter(Boolean)
    .join('\n')
  const body = (content ?? joinedTranscript).trim()
  if (!body) {
    return []
  }
  const head = `【${formatMemoryStamp(last.createdAt)}】`
  return [
    {
      messageId: last.id,
      card: createMemoryCard(`${head}\n${body}`, 'bulk', last.createdAt, {
        pool: 'character',
        memoryKind: kind,
      }),
    },
  ]
}

/* ---- 04 可见与生效卡片筛选 ---- */
/** 当前可见路径上的所有卡片（含被取代、被关闭的，供面板展示） */
export const collectVisibleMemories = (_session: Session, messages: Message[]) =>
  messages.flatMap((message) =>
    (message.memories ?? []).map((card) => ({ card, messageId: message.id }))
  )

/** 实际注入 system 的卡片：启用、未被取代，按时间先后；limit 为保留上限 */
export const activeMemoryCards = (
  session: Session,
  messages: Message[],
  limit?: number,
  pool?: MemoryPool
) => {
  const active = collectVisibleMemories(session, messages)
    .filter(
      ({ card }) => card.enabled && !card.superseded && (!pool || getMemoryPool(card) === pool)
    )
    .sort((a, b) => a.card.createdAt - b.card.createdAt)
  return limit && limit > 0 ? active.slice(-limit) : active
}

/**
 * 超出保留上限的自动卡片（手动卡片不占配额）。
 * 返回最早的那批，由 store 标成归档：不删除、可在面板查看，只是不再注入。
 * pool 只统计对应分类，普通记忆与角色记忆各自独立。
 */
export const overflowMemoryCards = (
  session: Session,
  messages: Message[],
  limit: number,
  pool?: MemoryPool
) => {
  const auto = collectVisibleMemories(session, messages)
    .filter(
      ({ card }) =>
        card.source !== 'manual' &&
        !card.pinned &&
        !isCoreMemory(card) &&
        !card.superseded &&
        (!pool || getMemoryPool(card) === pool)
    )
    .sort((a, b) => a.card.createdAt - b.card.createdAt)
  const excess = auto.length - Math.max(1, limit)
  return excess > 0 ? auto.slice(0, excess) : []
}

/** 已启用、未归档、真正参与注入的卡片总字数；pool 可只统计普通或角色记忆 */
export const activeMemoryChars = (session: Session, messages: Message[], pool?: MemoryPool) =>
  collectVisibleMemories(session, messages)
    .filter(
      ({ card }) => card.enabled && !card.superseded && (!pool || getMemoryPool(card) === pool)
    )
    .reduce((total, entry) => total + entry.card.text.length, 0)

/**
 * 超出字数上限时归档最早的自动卡片；手动卡片和置顶卡片不动。
 * 返回被归档的卡片，由 store 标记 superseded，不删除文本。
 */
export const overflowMemoryCardsByChars = (
  session: Session,
  messages: Message[],
  limit: number,
  pool?: MemoryPool
) => {
  const active = collectVisibleMemories(session, messages)
    .filter(
      ({ card }) => card.enabled && !card.superseded && (!pool || getMemoryPool(card) === pool)
    )
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
    if (entry.card.source === 'manual' || entry.card.pinned || isCoreMemory(entry.card)) {
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

/* ---- 05 注入优先级与预算 ---- */
/**
 * 每轮真正注入的卡片：手动记录 → 置顶 → 最近几轮 → 与当前发言相关或落在同一时间段的旧卡。
 * 手动卡是玩家明确要求角色记住的偏好、姓名和经历，不参与“最近 12 张”的竞争，优先占预算；
 * 最近优先保证新记忆不被字符预算挤掉；旧卡靠关键词与时间锚点补回来。
 */
export const selectMemoryCardsForInjection = (
  session: Session,
  messages: Message[],
  limit: number,
  query: string
) => {
  const active = collectVisibleMemories(session, messages)
    .filter(({ card }) => card.enabled && !card.superseded && getMemoryPool(card) === 'character')
    .sort((a, b) => a.card.createdAt - b.card.createdAt)
  const manual = active.filter(({ card }) => card.source === 'manual')
  const manualIds = new Set(manual.map(({ card }) => card.id))
  const pinned = active
    .filter(({ card }) => card.pinned && !manualIds.has(card.id))
    .slice(-MEMORY_PINNED_MAX)
  const pinnedIds = new Set(pinned.map(({ card }) => card.id))
  // 重要场景与关键事实是玩家明确挑出的“核心记忆”，不等关键词命中，也不被最近 12 张挤掉。
  const scenes = active
    .filter(({ card }) => getCharacterMemoryKind(card) === 'scene')
    .slice(-MEMORY_SCENE_INJECT)
  const facts = active
    .filter(({ card }) => getCharacterMemoryKind(card) === 'fact')
    .slice(-MEMORY_FACT_INJECT)
  const coreIds = new Set([...scenes, ...facts].map(({ card }) => card.id))
  const unpinned = active.filter(
    ({ card }) =>
      !manualIds.has(card.id) && !pinnedIds.has(card.id) && !coreIds.has(card.id)
  )
  // 最近窗口与“候选总数”分开算：limit 很小时也要保留更早的卡给触发词和时间锚点召回，不能提前截断。
  const recentCount = Math.min(MEMORY_RECENT_INJECT, Math.max(1, limit))
  const recent = unpinned.slice(-recentCount)
  const older = unpinned.slice(0, Math.max(0, unpinned.length - recent.length))
  const terms = queryTerms(query)
  const timeHints = parseMemoryTimeHints(query)
  const relevant =
    terms.length === 0 && timeHints.length === 0
      ? []
      : older
          .map((entry) => {
            const text = entry.card.text.toLowerCase()
            const trigger = entry.card.trigger?.toLowerCase() ?? ''
            let score = 0
            for (const term of terms) {
              if (text.includes(term)) {
                score += term.length
              }
              // 触发词是玩家写下的召回锚点，命中后比正文关键词更强，避免旧卡永远沉在最近 12 张之外。
              if (trigger.includes(term)) {
                score += term.length * 2 + 8
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
  const chosen = [
    ...manual,
    ...pinned,
    ...scenes,
    ...facts,
    ...[...recent].reverse(),
    ...relevant,
  ]
  const seen = new Set<string>()
  return chosen.filter(({ card }) => {
    if (seen.has(card.id)) {
      return false
    }
    seen.add(card.id)
    return true
  })
}

/**
 * 角色记忆进普通对话时的过滤：角色扮演关闭后，带三连反引号代码块的角色卡不再注入，
 * 避免角色剧情里顺手写出的命令、代码和开发日志污染普通对话；剧情与关系卡保持原样。
 */
export const filterCharacterMemoryForInjection = <T extends { card: MemoryCard }>(
  entries: T[],
  roleplayActive: boolean
): T[] => (roleplayActive ? entries : entries.filter(({ card }) => !detectCodeBlock(card.text)))

/**
 * 普通记忆注入：不做时间线、好感或关系召回，只按关键词命中取卡片。
 * 手动卡与置顶卡优先；其余按与当前问题的词块重合度排序，没有关键词时取最近几张。
 */
export const selectNormalMemoryCardsForInjection = (
  session: Session,
  messages: Message[],
  limit: number,
  query: string
) => {
  const active = collectVisibleMemories(session, messages)
    .filter(({ card }) => card.enabled && !card.superseded && getMemoryPool(card) === 'normal')
    .sort((a, b) => a.card.createdAt - b.card.createdAt)
  const manual = active.filter(({ card }) => card.source === 'manual')
  const manualIds = new Set(manual.map(({ card }) => card.id))
  const pinned = active
    .filter(({ card }) => card.pinned && !manualIds.has(card.id))
    .slice(-MEMORY_PINNED_MAX)
  const pinnedIds = new Set(pinned.map(({ card }) => card.id))
  const rest = active.filter(({ card }) => !manualIds.has(card.id) && !pinnedIds.has(card.id))
  const terms = queryTerms(query)
  const relevant =
    terms.length === 0
      ? rest.slice(-Math.max(1, Math.min(8, limit)))
      : rest
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
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, Math.max(1, limit))
          .map((item) => item.entry)
  const chosen = [...manual, ...pinned, ...relevant]
  const seen = new Set<string>()
  return chosen
    .filter(({ card }) => {
      if (seen.has(card.id)) {
        return false
      }
      seen.add(card.id)
      return true
    })
    .slice(0, Math.max(1, limit))
}

/* ---- 06 system 记忆块格式化 ---- */
/** 普通记忆的 system 块：只作开发/问答参考，不携带角色剧情规则 */
export const formatNormalMemoryBlock = (
  cards: MemoryCard[],
  limit = MEMORY_MAX_CARDS,
  chars = MEMORY_MAX_CHARS
) => {
  const normal = cards.filter(
    (card) => getMemoryPool(card) === 'normal' && card.enabled && !card.superseded
  )
  if (normal.length === 0) {
    return ''
  }
  const lines: string[] = []
  let used = 0
  for (const card of normal.slice(0, limit)) {
    const kind = getNormalMemoryKind(card)
    const label =
      kind === 'code' && card.language ? `代码 · ${card.language}` : normalMemoryLabel(kind)
    const body = kind === 'code' ? card.text : card.text.replace(/\n/g, ' / ')
    const line = `- 【${label}】${body}`
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
    '【普通记忆 · 开发与问答参考】\n' +
    '以下内容来自玩家保存的普通记忆，只用于开发、排错、问答与代码查阅，不属于角色剧情。\n' +
    '回应规则：\n' +
    '1. 当前问题涉及代码、报错、配置、命令或实现方案时，优先参考下面的代码卡片；引用时保持原变量名、路径和命令不变，不要凭印象改写。\n' +
    '2. 当前问题问的是以前聊过的事实、结论或操作步骤时，先查下面的对话与用户/AI 原话卡片；有明确记录就按记录回答，找不到就说不确定。\n' +
    '3. 这些卡片不参与角色扮演；不要因为它们改变角色人设、关系阶段或剧情走向。\n' +
    '4. 不要向玩家复述“普通记忆”“卡片”这类词，直接使用其中的信息。\n' +
    lines.join('\n')
  )
}

export const formatMemoryBlock = (
  cards: MemoryCard[],
  limit = MEMORY_MAX_CARDS,
  chars = MEMORY_MAX_CHARS
) => {
  const character = cards.filter((card) => getMemoryPool(card) === 'character')
  if (character.length === 0) {
    return ''
  }
  const visible = character.slice(0, limit)
  const groups: Array<{ kind: CharacterMemoryKind; label: string; hint: string }> = [
    { kind: 'scene', label: '重要场景', hint: '先当作角色亲身经历过的背景锚点' },
    { kind: 'fact', label: '关键事实', hint: '姓名、关系、偏好、承诺等稳定设定' },
    { kind: 'turn', label: '对话经历', hint: '按时间顺序保留的原话与回合' },
  ]
  const sections: string[] = []
  let used = 0
  for (const group of groups) {
    const items = visible.filter((card) => getCharacterMemoryKind(card) === group.kind)
    if (items.length === 0) {
      continue
    }
    const lines: string[] = []
    for (const card of items) {
      const owner = getMemoryOwner(card)
      const ownerTag = card.speaker
        ? `（${card.speaker}）`
        : owner === 'character'
          ? '（角色本人）'
          : owner === 'user'
            ? '（玩家本人）'
            : ''
      const triggerTag = card.trigger ? `（回忆触发：${card.trigger}）` : ''
      const proactiveTag = card.proactive ? '（可主动提起）' : ''
      const line = `- ${ownerTag}${triggerTag}${proactiveTag}${card.text.replace(/\n/g, ' / ')}`
      if (used + line.length > Math.max(1, chars)) {
        if (used === 0) {
          lines.push(line.slice(0, Math.max(1, chars)))
          used = chars
        }
        break
      }
      lines.push(line)
      used += line.length
    }
    if (lines.length > 0) {
      sections.push(`【${group.label} · ${group.hint}】\n${lines.join('\n')}`)
    }
    if (used >= chars) {
      break
    }
  }
  if (sections.length === 0) {
    return ''
  }
  return (
    '【长期记忆 · 最高优先级】\n' +
    '以下是你与{{user}}共同经历过的既定事实，不是可选的参考资料。' +
    '每条开头的时间、轮次和关系阶段是当时的锚点；重要场景与关键事实优先于一般闲聊。\n' +
    '回应的规则：\n' +
    '1. 当{{user}}提到某个时间、地点、物品、人物、约定或经历时，先在这些记忆里找对应片段，再依据那段经历回应；不要凭印象另编一段。\n' +
    '2. 重要场景是角色在场经历过的背景：地点、天气、气氛、在场人物、发生过什么，都以场景卡为准；不要把它只当成摘要复述。\n' +
    '3. 关键事实是稳定设定：姓名、称呼、关系阶段、喜好、承诺和边界不能前后矛盾；不要把已经发生过的事当成第一次听说，也不要重置好感。\n' +
    '4. 对话经历保留原话和时间线；引用细节时以记录为准，不要把{{user}}没说过的话塞给{{user}}，也不要把角色说过的话记成{{user}}说的。\n' +
    '5. 如果记忆与当前场景冲突，按“{{user}}当前明确说法 → 时间更近的记忆 → 更早的记忆”的顺序判断；不确定时保留模糊，不替{{user}}补完事实。\n' +
    '6. 记忆里没有明确记录，不等于事情没发生过。{{user}}当前说出的新事实要当作真的接住，不要用“没有记录”“我不记得”否认{{user}}；只有与更近的明确记忆直接冲突时，才温和地保留差异。\n' +
    '7. 不要向{{user}}复述本段，也不要提到「记忆」「卡片」「设定」这类词；被问到“你还记得吗”时，用角色的视角自然回答记得什么，不要回答成“我是 AI，没有记忆”。\n' +
    '8. 记忆里出现「{{user}}」、玩家自己填写的名字或「用户」时，都指当前玩家；出现角色名、「角色」或「你」时，都指你。称呼不同不代表换人。\n' +
    '9. 当{{user}}询问自己或角色的姓名、喜好、习惯、经历、关系这类已知信息时，先查下面的记忆再回答；有明确记录就当成既定事实，直接给出记录中的答案。\n' +
    '10. 标了「角色本人」或角色名的是角色自己的经历、喜好、习惯或承诺；标了「玩家本人」或玩家名的是玩家告诉角色的关于玩家的事。不要把玩家的事实说成角色自己的，也不要把角色的事塞给玩家。\n' +
    '11. 「回忆触发」只用来判断什么时候想起：玩家说到相关词、做出相关动作或走到相关地点时，再自然提起；不要把“触发”“记忆卡”这类词念出来。标了「可主动提起」的卡片不要只等玩家问：话题靠近、气氛停顿，或角色有理由想起时，用一句具体的话主动带出来（例如“上次你说……我后来一直记着”），不要每轮重复，也不要一次把几张卡全倒出来。\n' +
    sections.join('\n\n')
  )
}

/** 提炼用的材料：现有卡片 + 最新一轮；保留原文，不再按 240/320 字截断 */
export const buildRefinePrompt = (
  cards: MemoryCard[],
  question: string,
  answer: string,
  userName: string,
  characterName = ''
) => {
  const existing =
    cards.length > 0
      ? cards
          .map((card, index) => {
            const owner = card.speaker || memoryOwnerLabel(getMemoryOwner(card))
            return `${index + 1}. [${owner}] ${card.text.replace(/\n/g, ' / ')}`
          })
          .join('\n')
      : '（暂无）'
  return (
    `用户名字：${memorySpeakerName(userName, '玩家')}\n` +
    `${characterName ? `角色名字：${memorySpeakerName(characterName, '角色')}\n` : ''}` +
    `\n【已有记忆】\n${existing}\n\n` +
    `【最新一轮】\n[玩家本人] ${memorySpeakerName(userName, '玩家')}：${question.trim()}\n` +
    `[角色本人] ${memorySpeakerName(characterName, '角色')}：${answer.trim()}\n\n` +
    '请把最新一轮并入已有记忆，输出合并后的记忆清单。每行开头必须标归属：' +
    '[玩家本人] 只写玩家自己的经历、喜好、说法和承诺；[角色本人] 只写角色自己的经历、反应和承诺；' +
    '[共同经历] 只写双方一起经历、约定或关系变化。' +
    '保留关系阶段、称呼、承诺、共同经历、核心场景和关键事实；只压缩重复与寒暄，不要删掉具体事件。'
  )
}

/** 提炼结果按行拆成卡片，过滤空行与序号 */
export const parseRefinedCards = (
  text: string,
  limit = MEMORY_MAX_CARDS
): Array<{ text: string; owner: MemoryOwner }> =>
  text
    .split(/\r?\n/)
    .map((line) => {
      const cleaned = line
        .replace(/^[\s\-•·*]+/, '')
        .replace(/^\d+[.、)]\s*/, '')
        .trim()
      const matched = /^(?:\[|【)\s*(玩家本人|角色本人|共同经历|共同)\s*(?:\]|】)\s*[：:|｜]?\s*/.exec(cleaned)
      const owner: MemoryOwner =
        matched?.[1] === '玩家本人' ? 'user' : matched?.[1] === '角色本人' ? 'character' : 'shared'
      const body = matched ? cleaned.slice(matched[0].length).trim() : cleaned
      return { text: body, owner }
    })
    .filter((line) => line.text.length > 0 && !/^【[^】]{1,10}】$/.test(line.text))
    .slice(0, limit)

/* ---- 07 卡片创建与回合归档 ---- */
/** 新建一张卡片；调用方负责挂到具体消息上 */
export const createMemoryCard = (
  text: string,
  source: MemoryCard['source'],
  createdAt = Date.now(),
  options: Pick<
    MemoryCard,
    | 'pool'
    | 'category'
    | 'language'
    | 'memoryKind'
    | 'owner'
    | 'speaker'
    | 'trigger'
    | 'proactive'
    | 'pinned'
  > = {}
): MemoryCard => ({
  id: createId(),
  text: text.trim(),
  createdAt,
  enabled: true,
  source,
  ...(options.pool ? { pool: options.pool } : {}),
  ...(options.category ? { category: options.category } : {}),
  ...(options.language ? { language: options.language } : {}),
  ...(options.memoryKind ? { memoryKind: options.memoryKind } : {}),
  ...(options.owner ? { owner: options.owner } : {}),
  ...(options.speaker ? { speaker: options.speaker } : {}),
  ...(options.trigger?.trim() ? { trigger: options.trigger.trim() } : {}),
  ...(options.proactive ? { proactive: true } : {}),
  ...(options.pinned ? { pinned: true } : {}),
})

export type ConversationMemoryDraft = {
  /** 卡片挂到哪条消息上 */
  messageId: string
  card: MemoryCard
}

/**
 * 把当前分支的可见消息按“用户一句 + 角色一句”配对，生成完整回合记忆卡。
 * 角色池默认拆成两张：玩家提问一张、角色回应一张，各自带 owner；
 * 普通池仍合成一张对话卡，避免开发问答被拆成两半。
 */
export const buildConversationMemoryCards = (
  messages: Message[],
  startTurn = 0,
  pairAdjacent?: (user: Message, assistant: Message) => boolean,
  options: { split?: boolean; userName?: string; characterName?: string } = {}
): ConversationMemoryDraft[] => {
  const drafts: ConversationMemoryDraft[] = []
  let pendingUser: Message | null = null
  let turn = startTurn
  const push = (target: Message, question: string, answer: string) => {
    if (!question.trim() && !answer.trim()) {
      return
    }
    const meta = {
      at: target.createdAt,
      turnIndex: turn + 1,
      userName: options.userName,
      characterName: options.characterName,
    }
    turn += 1
    if (options.split) {
      for (const part of buildTurnMemoryCards(question, answer, meta)) {
        drafts.push({
          messageId: target.id,
          card: createMemoryCard(part.text, 'bulk', target.createdAt, {
            owner: part.owner,
            speaker: part.speaker,
          }),
        })
      }
      return
    }
    const text = buildTurnMemoryText(question, answer, meta)
    if (!text) {
      return
    }
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

/* ---- 08 普通记忆逐条建档 ---- */
/**
 * 普通记忆按“每条消息一张卡”保存，不把用户与角色强行合成回合。
 * 指定 category 时全部归入该子分类；auto 时逐条识别代码 / 用户原话 / AI 原话。
 */
export const buildNormalMemoryCards = (
  messages: Message[],
  category: NormalMemoryKind | 'auto' = 'auto'
): ConversationMemoryDraft[] =>
  messages
    .map((message) => {
      const body = message.role === 'assistant' ? replyPlainText(message) : message.content
      if (!body.trim()) {
        return null
      }
      const kind = category === 'auto' ? detectNormalMemoryKind(body, message.role) : category
      const prefix = message.role === 'user' ? '用户：' : 'AI：'
      const text = `${prefix}${body.trim()}`
      return {
        messageId: message.id,
        card: createMemoryCard(text, 'bulk', message.createdAt, {
          pool: 'normal',
          category: kind,
          language: kind === 'code' ? detectCodeLanguage(body) : undefined,
        }),
      }
    })
    .filter((draft): draft is ConversationMemoryDraft => draft !== null)

/* ============================================================================
 * 功能区：会话与角色核心 / memory 结束
 * ========================================================================== */
