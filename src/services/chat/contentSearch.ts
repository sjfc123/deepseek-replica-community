import type { Locale } from '../settings.js'
import { buildMessageVersions, getReachableMessageIds, normalizeSession } from './branches.js'
import { scanSessions } from './db.js'
import type { AssistantMessage, Session, SessionSummary } from './types.js'

export type HighlightRange = {
  start: number
  end: number
}

export type SessionSearchResult = {
  key: string
  kind: 'session'
  sessionId: string
  title: string
  timestamp: number
}

export type MessageSearchResult = {
  key: string
  kind: 'message'
  sessionId: string
  messageId: string
  title: string
  role: 'user' | 'assistant'
  timestamp: number
  /** 该消息在同父节点下存在多个版本时显示，例如 "1/3" */
  branchLabel: string | null
  snippet: string
  highlights: HighlightRange[]
}

export type ContentSearchResult = SessionSearchResult | MessageSearchResult

type RankedResult = {
  item: ContentSearchResult
  sessionOrder: number
  /** 同会话内消息顺序；标题命中为 -1（同时间戳时排在更早消息之前、更晚消息之后） */
  messageOrder: number
}

const DAY = 86_400_000
const SNIPPET_LEAD = 10
const SNIPPET_DIRECT_START_LIMIT = 14
const SNIPPET_MAX_CHARS = 96

const normalizeInlineText = (value: string) => value.replace(/\s+/g, ' ').trim()

const normalizeQuery = (query: string) => normalizeInlineText(query).toLocaleLowerCase()

const isAsciiWordChar = (char: string | undefined) =>
  char !== undefined && /[A-Za-z0-9_]/.test(char)

const clampSurrogateStart = (text: string, index: number) => {
  if (index <= 0 || index >= text.length) {
    return Math.max(0, Math.min(text.length, index))
  }
  const code = text.charCodeAt(index)
  return code >= 0xdc00 && code <= 0xdfff ? index - 1 : index
}

const clampSurrogateEnd = (text: string, index: number) => {
  if (index <= 0 || index >= text.length) {
    return Math.max(0, Math.min(text.length, index))
  }
  const code = text.charCodeAt(index - 1)
  return code >= 0xd800 && code <= 0xdbff ? index - 1 : index
}

/**
 * 构建单行上下文片段并标注所有命中区间。
 * 命中靠前时直接从头展示；靠后时在命中前保留少量上下文并加前置省略号。
 */
export const buildSearchSnippet = (
  rawText: string,
  normalizedTerm: string
): { snippet: string; highlights: HighlightRange[] } | null => {
  if (!normalizedTerm) {
    return null
  }
  const text = normalizeInlineText(rawText)
  if (!text) {
    return null
  }
  const lower = text.toLocaleLowerCase()
  const firstMatch = lower.indexOf(normalizedTerm)
  if (firstMatch === -1) {
    return null
  }

  let start = 0
  let prefix = ''
  if (firstMatch > SNIPPET_DIRECT_START_LIMIT) {
    let candidate = clampSurrogateStart(text, Math.max(0, firstMatch - SNIPPET_LEAD))
    // 落在英文单词中间时，优先向左扩展少量字符保留完整单词，否则向右跳过半截单词。
    if (candidate > 0 && isAsciiWordChar(text[candidate - 1]) && isAsciiWordChar(text[candidate])) {
      let wordStart = candidate
      const lookbehindLimit = Math.max(0, candidate - 6)
      while (wordStart > lookbehindLimit && isAsciiWordChar(text[wordStart - 1])) {
        wordStart -= 1
      }
      if (wordStart === 0 || !isAsciiWordChar(text[wordStart - 1])) {
        candidate = wordStart
      } else {
        const lookaheadLimit = Math.min(firstMatch, candidate + 6)
        for (let cursor = candidate + 1; cursor < lookaheadLimit; cursor += 1) {
          if (!isAsciiWordChar(text[cursor])) {
            candidate = cursor
            break
          }
        }
      }
    }
    while (candidate < firstMatch && text[candidate] === ' ') {
      candidate += 1
    }
    start = candidate
    if (start > 0) {
      prefix = '...'
    }
  }

  const rawEnd = Math.min(
    text.length,
    Math.max(start + SNIPPET_MAX_CHARS, firstMatch + normalizedTerm.length + 24)
  )
  const end = clampSurrogateEnd(text, rawEnd)
  const body = text.slice(start, end)
  const suffix = end < text.length ? '...' : ''
  const snippet = `${prefix}${body}${suffix}`

  const highlights: HighlightRange[] = []
  const bodyLower = body.toLocaleLowerCase()
  const termLength = normalizedTerm.length
  let searchFrom = 0
  while (searchFrom <= bodyLower.length - termLength) {
    const found = bodyLower.indexOf(normalizedTerm, searchFrom)
    if (found === -1) {
      break
    }
    highlights.push({
      start: prefix.length + found,
      end: prefix.length + found + termLength,
    })
    searchFrom = found + termLength
  }

  return { snippet, highlights }
}

const getAssistantSearchCandidates = (message: AssistantMessage): string[] => {
  if (message.stopReason === 'refusal') {
    const templates = message.blocks
      .filter((block) => block.type === 'text' && block.isTemplate && block.text)
      .map((block) => (block.type === 'text' ? block.text : ''))
    return templates.length ? [templates.join('\n')] : []
  }

  const answerParts: string[] = []
  const thinkingParts: string[] = []
  for (const block of message.blocks) {
    if (block.type === 'text' && block.text) {
      answerParts.push(block.text)
    } else if (block.type === 'thinking' && block.thinking) {
      thinkingParts.push(block.thinking)
    }
  }
  const candidates: string[] = []
  if (answerParts.length > 0) {
    candidates.push(answerParts.join('\n'))
  }
  if (thinkingParts.length > 0) {
    candidates.push(thinkingParts.join('\n'))
  }
  return candidates
}

const collectSessionMatches = (
  session: Session,
  normalizedTerm: string,
  {
    sessionOrder = 0,
    titleOverride,
    updatedAtOverride,
  }: { sessionOrder?: number; titleOverride?: string; updatedAtOverride?: number } = {}
): RankedResult[] => {
  const results: RankedResult[] = []
  const title = titleOverride ?? session.title
  const updatedAt = updatedAtOverride ?? session.updatedAt
  const normalizedTitle = normalizeInlineText(title)

  if (normalizedTitle && normalizedTitle.toLocaleLowerCase().includes(normalizedTerm)) {
    results.push({
      item: {
        key: `session:${session.id}`,
        kind: 'session',
        sessionId: session.id,
        title: normalizedTitle,
        timestamp: updatedAt,
      },
      sessionOrder,
      messageOrder: -1,
    })
  }

  if (session.messages.length === 0) {
    return results
  }

  const normalized = normalizeSession(session)
  const reachable = getReachableMessageIds(normalized)
  const versions = buildMessageVersions(normalized, new Map())

  normalized.messages.forEach((message, index) => {
    if (!reachable.has(message.id)) {
      return
    }
    let matched: { snippet: string; highlights: HighlightRange[] } | null = null
    if (message.role === 'user') {
      matched = buildSearchSnippet(message.content, normalizedTerm)
    } else {
      for (const candidate of getAssistantSearchCandidates(message)) {
        matched = buildSearchSnippet(candidate, normalizedTerm)
        if (matched) {
          break
        }
      }
    }
    if (!matched) {
      return
    }
    const version = versions.get(message.id)
    const branchLabel =
      version && version.ids.length > 1 ? `${version.index + 1}/${version.ids.length}` : null
    results.push({
      item: {
        key: `message:${session.id}:${message.id}`,
        kind: 'message',
        sessionId: session.id,
        messageId: message.id,
        title: normalizedTitle,
        role: message.role,
        timestamp: message.createdAt,
        branchLabel,
        snippet: matched.snippet,
        highlights: matched.highlights,
      },
      sessionOrder,
      messageOrder: index,
    })
  })

  return results
}

const compareRanked = (a: RankedResult, b: RankedResult): number => {
  if (a.item.timestamp !== b.item.timestamp) {
    return b.item.timestamp - a.item.timestamp
  }
  if (a.sessionOrder !== b.sessionOrder) {
    return a.sessionOrder - b.sessionOrder
  }
  // 同一会话内同时间戳时：标题命中靠前，其次较晚创建的消息靠前。
  if (a.item.kind !== b.item.kind) {
    return a.item.kind === 'session' ? -1 : 1
  }
  return b.messageOrder - a.messageOrder
}

/** 对单个会话执行标题与逐消息（含全部可达分支、思考与正文）搜索。 */
export const searchSessionContent = (
  session: Session,
  query: string,
  options?: { sessionOrder?: number; titleOverride?: string; updatedAtOverride?: number }
): ContentSearchResult[] => {
  const normalizedTerm = normalizeQuery(query)
  if (!normalizedTerm) {
    return []
  }
  return collectSessionMatches(session, normalizedTerm, options)
    .sort(compareRanked)
    .map((entry) => entry.item)
}

/**
 * 扫描全部本地会话（内存缓存优先，其余单事务游标流式读取），返回按时间降序排列的标题与逐消息命中。
 */
export const searchLocalHistory = async (
  query: string,
  summaries: readonly SessionSummary[],
  sessionCache: Readonly<Record<string, Session>>,
  signal?: AbortSignal
): Promise<ContentSearchResult[]> => {
  const normalizedTerm = normalizeQuery(query)
  if (!normalizedTerm || summaries.length === 0 || signal?.aborted) {
    return []
  }

  const summaryMeta = new Map<string, { summary: SessionSummary; order: number }>()
  summaries.forEach((summary, order) => {
    summaryMeta.set(summary.id, { summary, order })
  })

  const ranked: RankedResult[] = []
  const scannedIds = new Set<string>()

  for (let order = 0; order < summaries.length; order += 1) {
    if (signal?.aborted) {
      return []
    }
    const summary = summaries[order]
    const cached = Object.hasOwn(sessionCache, summary.id) ? sessionCache[summary.id] : undefined
    if (!cached) {
      continue
    }
    scannedIds.add(summary.id)
    ranked.push(
      ...collectSessionMatches(cached, normalizedTerm, {
        sessionOrder: order,
        titleOverride: summary.title,
        updatedAtOverride: summary.updatedAt,
      })
    )
  }

  if (scannedIds.size < summaries.length) {
    await scanSessions((session) => {
      if (signal?.aborted) {
        return false
      }
      const meta = summaryMeta.get(session.id)
      if (!meta) {
        return true
      }
      ranked.push(
        ...collectSessionMatches(session, normalizedTerm, {
          sessionOrder: meta.order,
          titleOverride: meta.summary.title,
          updatedAtOverride: meta.summary.updatedAt,
        })
      )
      return true
    }, scannedIds)
  }

  if (signal?.aborted) {
    return []
  }

  ranked.sort(compareRanked)
  return ranked.map((entry) => entry.item)
}

const enMonthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const enMonthDayYear = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const startOfLocalDay = (time: number) => new Date(time).setHours(0, 0, 0, 0)

/** 对标官方 2.8.0 搜索结果日期：今天 / 昨天 / 同年 M月D日（MMM D）/ 跨年 YYYY年M月D日（MMM D, YYYY） */
export const formatSearchDate = (timestamp: number, now: number, locale: Locale): string => {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const nowDate = new Date(now)
  const dayDiff = Math.round((startOfLocalDay(now) - startOfLocalDay(timestamp)) / DAY)
  if (dayDiff === 0) {
    return locale === 'zh-CN' ? '今天' : 'Today'
  }
  if (dayDiff === 1) {
    return locale === 'zh-CN' ? '昨天' : 'Yesterday'
  }
  if (date.getFullYear() === nowDate.getFullYear()) {
    return locale === 'zh-CN'
      ? `${date.getMonth() + 1}月${date.getDate()}日`
      : enMonthDay.format(date)
  }
  return locale === 'zh-CN'
    ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
    : enMonthDayYear.format(date)
}
