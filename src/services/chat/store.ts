import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { translate } from '../../i18n/index.js'
import { DEFAULT_CHAT_MODEL } from '../api/chatConfig.js'
import { ApiError, streamChatMessage } from '../api/client.js'
import type { CreateMessageRequest, MessageParam } from '../api/types.js'
import {
  extractFileIds,
  getFileErrorCode,
  getRejectedImagePosition,
  isContextOverflow,
  isRetryableApiError,
} from '../api/errors.js'
import {
  cancelUpload,
  describeUploadError,
  uploadAttachment,
  useUploads,
  type AttachmentUpload,
} from '../attachments.js'
import { MANY_IMAGES_COUNT, MANY_IMAGES_MAX_EDGE, MAX_IMAGE_EDGE } from '../imageUpload.js'
import { parseCustomHeaders } from '../api/headers.js'
import { composeSystemPrompt } from './systemPrompt.js'
import { applyPlaceholders } from './placeholders.js'
import {
  formatCharacterCard,
  formatSceneBlock,
  formatWorldbookBlock,
  parseSceneUpdate,
  selectWorldbookEntries,
  WORLDBOOK_INJECT_MAX,
  findActiveCharacterCard,
} from './roleplay.js'
import {
  activeMemoryCards,
  activeMemoryChars,
  buildConversationMemoryCards,
  buildNormalMemoryCards,
  buildRefinePrompt,
  buildTurnMemoryText,
  createMemoryCard,
  detectCodeBlock,
  detectCodeLanguage,
  filterCharacterMemoryForInjection,
  formatMemoryBlock,
  formatNormalMemoryBlock,
  getMemoryPool,
  overflowMemoryCards,
  overflowMemoryCardsByChars,
  parseRefinedCards,
  replyPlainText,
  selectMemoryCardsForInjection,
  selectNormalMemoryCardsForInjection,
  type MemoryCard,
  type MemoryPool,
  type NormalMemoryKind,
} from './memory.js'
import {
  resolveUserName,
  matchRefusalKeyword,
  replaceScene,
  setPinnedSessions,
  useSettings,
} from '../settings.js'
import {
  activateBranch,
  appendBranch,
  getVisibleMessages,
  normalizeSession,
  selectVersion,
} from './branches.js'
import type { ImportArchiveResult } from './history/importArchive.js'
import {
  contextBudget,
  estimateBranchScale,
  estimatePrefixTokens,
  estimateQuestionTokens,
  estimateTextTokens,
  prepareHistoryContext,
  resolveMaxOutputTokens,
  saveContextCheckpoint,
  WINDOW_TOKENS,
  type HistoryContext,
} from './context.js'
import {
  createContextSummarizer,
  includeContextSummary,
  summarizeCurrentInput,
} from './contextSummary.js'
import { prepareCustomAttachments } from './customAttachments.js'
import * as db from './db.js'
import {
  cancelMessageEdit,
  clearAllDrafts,
  clearDraft,
  clearSentDraft,
  clearSentEdit,
  getDraft,
  prepareDraftMessage,
  type DraftFilePayload,
} from './drafts.js'
import { createLatestReminder } from './latestReminder.js'
import {
  CONTINUATION_GUARD,
  createContinuationEchoFilter,
  filterContinuationEcho,
} from './continuation.js'
import {
  applyEvent,
  canContinueReply,
  getContextRounds,
  getReplyText,
  settleReply,
  toRequestMessages,
} from './reply.js'
import {
  toSessionSummary,
  type AssistantMessage,
  type FileAttachment,
  type Message,
  type Session,
  type SessionSummary,
  type UserMessage,
} from './types.js'

/** DeepSeek Flash 和 Pro 的官方最大输出预算（384K，含思考）。 */
const MAX_OUTPUT_TOKENS = 393_216
/** 长上下文下的最小输出保底（5% 窗口），与 5% 安全缓冲配合对齐 90% 触发线。 */
const MIN_OUTPUT_RESERVE = 52_428
const PROMPT_OVERHEAD_TOKENS = 256
const CUSTOM_OUTPUT_TOKENS = 4_096
const CUSTOM_CONTEXT_WINDOW = 128 * 1024
/** 官方对纯算术首条保留原文标题，不进入服务端摘要通道。 */
const SIMPLE_ARITHMETIC =
  /^\s*\d+(?:\.\d+)?(?:\s*[+\-*/×÷]\s*\d+(?:\.\d+)?)+(?:\s*(?:=|等于|\?|？))?\s*$/
/** 保留最近打开的详情；当前会话、生成中及尚未成功保存的会话不淘汰。 */
const SESSION_CACHE_LIMIT = 5
/** 首次请求开启高级内容审核。 */
const SAFETY_CHECK = { level: 'high' } as const
/** 同一轮请求因 file_id 失效而重发的最多次数（不含首次请求） */
const FILE_RETRY_LIMIT = 2
/** 退避基数，第 n 次重试等待 2^n 倍；连续失败达到上限就放弃，把原始报错展示出来 */
const FILE_RETRY_BASE_DELAY = 1000
/** 限制一次聊天轮次内自动压缩的历史请求数，已成功的批次留给下轮接着处理。 */
const HISTORY_SUMMARY_LIMIT = 6
const HISTORY_OVERFLOW_RETRIES = 3

/** 阅读链接始终开启，智能搜索开关控制是否另行声明搜索工具（含边想边搜）。 */
const serverTools = (search: boolean) => {
  const tools: NonNullable<CreateMessageRequest['tools']> = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}

/** 允许自动补标题的请求；手动重命名后取消本轮标题写入，包含主动清空标题的情况。 */
const titleRequests = new Set<AbortController>()

export type PendingMessageJump = {
  sessionId: string
  messageId: string
  nonce: number
}

type ChatState = {
  ready: boolean
  initError: boolean
  /** 历史导入或全部删除期间锁定交互，提交成功前仍展示原有记录。 */
  importingHistory: boolean
  /** 仅列表元数据，按 updatedAt 降序；流式消息更新不会改变此数组。 */
  sessions: SessionSummary[]
  sessionCache: Record<string, Session>
  sessionLoadErrors: Record<string, boolean>
  sessionSaveErrors: Record<string, boolean>
  /** null 表示新对话（欢迎页） */
  activeId: string | null
  /** 搜索点击某条消息后待消费的定位目标；进入对应会话并完成滚动定位后清除 */
  pendingJump: PendingMessageJump | null
  /** 正在生成回复的会话 */
  streaming: Record<string, AbortController>
}

export const useChatStore = create<ChatState>(() => ({
  ready: false,
  initError: false,
  importingHistory: false,
  sessions: [],
  sessionCache: {},
  sessionLoadErrors: {},
  sessionSaveErrors: {},
  activeId: null,
  pendingJump: null,
  streaming: {},
}))

const { getState: get, setState: set } = useChatStore

const sortSessions = (sessions: SessionSummary[]) =>
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

const getSession = (id: string) => {
  const cache = get().sessionCache
  return Object.hasOwn(cache, id) ? cache[id] : undefined
}

const getStreamController = (id: string) => {
  const streams = get().streaming
  return Object.hasOwn(streams, id) ? streams[id] : undefined
}

const sameSummary = (a: SessionSummary, b: SessionSummary) =>
  a.title === b.title && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt

const sessionAccess = new Map<string, number>()
const unsavedSessions = new Set<string>()
/** 保存失败时保留原件，重试成功后才释放。 */
const pendingFiles = new Map<string, db.StoredFile[]>()
const loadOriginalFile = async (sessionId: string, id: string) =>
  pendingFiles.get(sessionId)?.find((file) => file.id === id)?.blob ?? db.loadFile(id)
const deletingSessions = new Set<string>()
const deletionTasks = new Set<Promise<boolean>>()
const streamFlushes = new Map<string, () => void>()
let accessSequence = 0
let jumpSequence = 0
let historyEpoch = 0
let initTask: Promise<void> | undefined
const sessionLoads = new Map<string, { promise: Promise<void> }>()

const touchSession = (id: string) => sessionAccess.set(id, ++accessSequence)

const trimSessionCache = () => {
  const state = get()
  const ids = Object.keys(state.sessionCache)
  if (ids.length <= SESSION_CACHE_LIMIT) {
    return
  }
  const removable = ids
    .filter(
      (id) =>
        id !== state.activeId &&
        !Object.hasOwn(state.streaming, id) &&
        !unsavedSessions.has(id) &&
        !deletingSessions.has(id)
    )
    .sort((a, b) => (sessionAccess.get(a) ?? 0) - (sessionAccess.get(b) ?? 0))
  const evicted = new Set(removable.slice(0, ids.length - SESSION_CACHE_LIMIT))
  for (const id of evicted) {
    sessionAccess.delete(id)
  }
  if (evicted.size > 0) {
    set({
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !evicted.has(id))
      ),
    })
  }
}

const updateSession = (id: string, update: (session: Session) => Session) =>
  set((state) => {
    const previous = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    if (!previous) {
      return state
    }
    const session = update(previous)
    if (session === previous) {
      return state
    }
    return {
      sessionCache: { ...state.sessionCache, [id]: session },
      sessions: sameSummary(previous, session)
        ? state.sessions
        : sortSessions(
            state.sessions.map((summary) =>
              summary.id === id ? toSessionSummary(session) : summary
            )
          ),
    }
  })

const updateReply = (sessionId: string, reply: AssistantMessage) =>
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === reply.id
        ? { ...reply, parentId: message.parentId, selectedChildId: message.selectedChildId }
        : message
    ),
  }))

const persist = (sessionId: string) => {
  const session = getSession(sessionId)
  if (session) {
    unsavedSessions.add(sessionId)
    if (deletingSessions.has(sessionId)) {
      return
    }
    const epoch = historyEpoch
    const files = pendingFiles.get(sessionId)
    void db
      .saveSession(session, files)
      .then(() => {
        if (epoch !== historyEpoch || !getSession(sessionId)) {
          return
        }
        if (pendingFiles.get(sessionId) === files) {
          pendingFiles.delete(sessionId)
        }
        if (getSession(sessionId) === session) {
          unsavedSessions.delete(sessionId)
          set((state) => ({
            sessionSaveErrors: Object.fromEntries(
              Object.entries(state.sessionSaveErrors).filter(([id]) => id !== sessionId)
            ),
          }))
          trimSessionCache()
        }
      })
      .catch((error: unknown) => {
        db.reportStorageError('save session')(error)
        if (epoch === historyEpoch && getSession(sessionId)) {
          set((state) => ({
            sessionSaveErrors: { ...state.sessionSaveErrors, [sessionId]: true },
          }))
        }
      })
  }
}

export const retrySaveSessions = () => {
  if (!get().importingHistory) {
    unsavedSessions.forEach(persist)
  }
}

/** 离开前先合并尚未绘制的增量；隐藏期间浏览器可能暂停动画帧。 */
export const bindChatPersistence = () => {
  const save = () => {
    if (get().importingHistory) {
      return
    }
    for (const [id, flush] of streamFlushes) {
      flush()
      persist(id)
    }
    for (const id of unsavedSessions) {
      if (!streamFlushes.has(id)) {
        persist(id)
      }
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      save()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', save)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', save)
  }
}

/**
 * 命中本地拒答关键词时不请求接口：直接写入模板文案并标记 refusal，
 * 与「被安全拒绝」走同一套展示路径，拒绝话术可自定义。
 */
const refuseLocally = (sessionId: string, reply: AssistantMessage) => {
  const text = useSettings.getState().refusalMessage.trim() || translate('replyRefused')
  const refused: AssistantMessage = {
    ...reply,
    status: 'done',
    stopReason: 'refusal',
    blocks: [{ type: 'text', text, isTemplate: true }],
  }
  updateReply(sessionId, refused)
  persist(sessionId)
}

/** 按当前开关创建回复：深度思考对应 thinking，智能搜索控制 deepseek_web_search。 */
const createReply = (): AssistantMessage => {
  const { thinking, search, chatConfig } = useSettings.getState()
  const customEndpoint = Boolean(chatConfig.endpoint)
  return {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: chatConfig.model || DEFAULT_CHAT_MODEL,
    thinking: !customEndpoint && thinking,
    search: !customEndpoint && search,
    prefix: !customEndpoint && chatConfig.format === 'messages',
    status: 'pending',
    blocks: [],
  }
}

/** 仍在生成中的回复（页面关闭或导出时未结束）按「已停止」处理 */
const settleInterrupted = (session: Session): Session => {
  if (
    !session.messages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  ) {
    return session
  }
  return {
    ...session,
    messages: session.messages.map((m) =>
      m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
        ? settleReply(m, 'stopped', session.updatedAt)
        : m
    ),
  }
}

export const initChat = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  const epoch = historyEpoch
  set({ initError: false })
  initTask = (async () => {
    try {
      const summaries = await db.loadSessionSummaries()
      if (epoch === historyEpoch) {
        set({ ready: true, sessions: sortSessions(summaries) })
      }
    } catch (error) {
      if (epoch === historyEpoch) {
        set({ initError: true })
        db.reportStorageError('read local sessions')(error)
      }
    } finally {
      if (epoch === historyEpoch) {
        initTask = undefined
      }
    }
  })()
  return initTask
}

/** 同一会话合并并发读取；切换只改变 activeId，旧请求不会把界面切回去。 */
const ensureSessionLoaded = (id: string): Promise<void> => {
  if (getSession(id)) {
    return Promise.resolve()
  }
  const pending = sessionLoads.get(id)
  if (pending) {
    return pending.promise
  }
  const epoch = historyEpoch
  set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: false } }))
  const load = { promise: Promise.resolve() }
  sessionLoads.set(id, load)
  load.promise = (async () => {
    try {
      const stored = await db.loadSession(id)
      if (epoch !== historyEpoch || sessionLoads.get(id) !== load) {
        return
      }
      const summary = get().sessions.find((session) => session.id === id)
      if (!summary) {
        return
      }
      if (!stored) {
        throw new Error(`Session ${id} is missing from local storage`)
      }
      const settled = settleInterrupted(normalizeSession(stored))
      // 读取期间列表内可能已重命名：保留最新元数据，避免旧读取结果覆盖。
      const synced = sameSummary(settled, summary) ? settled : { ...settled, ...summary }
      const pendingJump = get().pendingJump
      const session =
        pendingJump?.sessionId === id && !getStreamController(id)
          ? activateBranch(synced, pendingJump.messageId)
          : synced
      touchSession(id)
      set((state) => ({ sessionCache: { ...state.sessionCache, [id]: session } }))
      if (session !== stored) {
        persist(id)
      }
      trimSessionCache()
    } catch (error) {
      if (epoch === historyEpoch && sessionLoads.get(id) === load) {
        set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: true } }))
        db.reportStorageError('read session')(error)
      }
    } finally {
      if (sessionLoads.get(id) === load) {
        sessionLoads.delete(id)
      }
    }
  })()
  return load.promise
}

/** 等所有回复的收尾（落盘）完成 */
const waitForIdle = (sessionId?: string) =>
  new Promise<void>((resolve) => {
    const isIdle = (state: ChatState) =>
      sessionId === undefined
        ? Object.keys(state.streaming).length === 0
        : !Object.hasOwn(state.streaming, sessionId)
    if (isIdle(get())) {
      resolve()
      return
    }
    const unsubscribe = useChatStore.subscribe((state) => {
      if (isIdle(state)) {
        unsubscribe()
        resolve()
      }
    })
  })

let replacingHistory = false

const dedupePinned = (ids: Iterable<string>, validIds: ReadonlySet<string>): string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ids) {
    if (validIds.has(id) && !seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  return result
}

export type MergeHistorySummary = {
  added: number
  merged: number
  unchanged: number
}

/** 先写入暂存。校验通过后暂停会话修改、停止生成，再原子替换历史。 */
export const replaceHistory = async (
  write: (importId: string) => Promise<ImportArchiveResult>,
  {
    onCommit,
    clearInBackground = false,
  }: { onCommit?: () => void; clearInBackground?: boolean } = {}
): Promise<number> => {
  if (replacingHistory) {
    throw new Error('History replacement is already in progress')
  }
  replacingHistory = true
  let staging: db.HistoryStaging | undefined
  try {
    staging = await db.beginStaging()
    const { summaries, pinnedIds } = await write(staging.importId)
    onCommit?.()
    set({ importingHistory: true })
    for (const controller of Object.values(get().streaming)) {
      controller.abort()
    }
    // 已开始的单条删除先同步到内存，避免本次替换失败后列表残留已被删除的记录。
    await Promise.all(deletionTasks)
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    await waitForIdle()
    await staging.commit(clearInBackground)
    sessionAccess.clear()
    unsavedSessions.clear()
    pendingFiles.clear()
    clearAllDrafts()
    const validIds = new Set(summaries.map((item) => item.id))
    setPinnedSessions(dedupePinned(pinnedIds, validIds))
    set({
      ready: true,
      initError: false,
      sessions: sortSessions(summaries),
      sessionCache: {},
      sessionLoadErrors: {},
      sessionSaveErrors: {},
      activeId: null,
      pendingJump: null,
    })
    return summaries.length
  } catch (error) {
    await staging?.discard().catch(db.reportStorageError('clear unfinished history replacement'))
    throw error
  } finally {
    replacingHistory = false
    if (get().importingHistory) {
      set({ importingHistory: false })
      retrySaveSessions()
      const { activeId, ready } = get()
      // 提交失败时恢复被取消的详情读取。
      if (activeId !== null) {
        void ensureSessionLoaded(activeId)
      } else if (!ready) {
        void initChat()
      }
    }
  }
}

/** 先写入暂存。校验通过后暂停写入与生成，对重叠会话按树与消息语义合并提交，不清空草稿或重置当前会话。 */
export const mergeHistory = async (
  write: (importId: string) => Promise<ImportArchiveResult>,
  {
    onCommit,
    clearInBackground = true,
  }: { onCommit?: () => void; clearInBackground?: boolean } = {}
): Promise<MergeHistorySummary> => {
  if (replacingHistory) {
    throw new Error('History replacement is already in progress')
  }
  replacingHistory = true
  let staging: db.HistoryStaging | undefined
  try {
    staging = await db.beginStaging()
    const { pinnedIds } = await write(staging.importId)
    onCommit?.()
    set({ importingHistory: true })
    for (const controller of Object.values(get().streaming)) {
      controller.abort()
    }
    await Promise.all(deletionTasks)
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    await waitForIdle()

    const localOverrides = new Map<string, { session: Session; files?: db.StoredFile[] }>()
    for (const id of unsavedSessions) {
      const session = getSession(id)
      if (session) {
        localOverrides.set(id, { session, files: pendingFiles.get(id) })
      }
    }

    const result = await staging.commitMerge({ localOverrides, clearInBackground })
    const { activeId, sessionCache, sessionLoadErrors, sessionSaveErrors } = get()
    const refreshedCache = { ...sessionCache }
    const updatedSet = new Set(result.updatedIds)

    for (const id of result.updatedIds) {
      unsavedSessions.delete(id)
      pendingFiles.delete(id)
      if (Object.hasOwn(refreshedCache, id) || id === activeId) {
        const refreshed = await db.loadSession(id)
        if (refreshed) {
          touchSession(id)
          refreshedCache[id] = refreshed
        }
      }
    }

    const validIds = new Set(result.summaries.map((item) => item.id))
    setPinnedSessions(
      dedupePinned([...useSettings.getState().pinnedSessions, ...pinnedIds], validIds)
    )
    set({
      ready: true,
      initError: false,
      sessions: sortSessions(result.summaries),
      sessionCache: refreshedCache,
      sessionLoadErrors: Object.fromEntries(
        Object.entries(sessionLoadErrors).filter(([id]) => !updatedSet.has(id))
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(sessionSaveErrors).filter(([id]) => !updatedSet.has(id))
      ),
    })
    trimSessionCache()
    return { added: result.added, merged: result.merged, unchanged: result.unchanged }
  } catch (error) {
    await staging?.discard().catch(db.reportStorageError('clear unfinished history merge'))
    throw error
  } finally {
    replacingHistory = false
    if (get().importingHistory) {
      set({ importingHistory: false })
      retrySaveSessions()
      const { activeId, ready } = get()
      if (activeId !== null) {
        void ensureSessionLoaded(activeId)
      } else if (!ready) {
        void initChat()
      }
    }
  }
}

export const newChat = () => {
  if (!get().importingHistory) {
    cancelMessageEdit()
    set({ activeId: null, pendingJump: null })
    trimSessionCache()
  }
}

/**
 * 把当前分支整段复制成一个新对话，两边各自继续，互不影响。
 * 消息 ID 全部换新，避免之后合并历史时被当成同一条消息；记忆卡片、附件引用、分支结构原样带过去。
 */
export const forkSession = async (sessionId: string): Promise<string | null> => {
  if (get().importingHistory || deletingSessions.has(sessionId) || getStreamController(sessionId)) {
    return null
  }
  const cached = getSession(sessionId)
  const source = cached ?? (await db.loadSession(sessionId))
  if (!source) {
    return null
  }
  const path = getVisibleMessages(source)
  if (path.length === 0) {
    return null
  }
  const idMap = new Map<string, string>()
  path.forEach((message) => idMap.set(message.id, createId()))
  const now = Date.now()
  const messages = path.map((message, index) => ({
    ...message,
    id: idMap.get(message.id)!,
    parentId: index === 0 ? null : (idMap.get(path[index - 1].id) ?? null),
    selectedChildId: index === path.length - 1 ? undefined : idMap.get(path[index + 1].id),
    memories: message.memories ? message.memories.map((card) => ({ ...card })) : undefined,
  }))
  const next: Session = {
    id: createId(),
    title: `${source.title || translate('untitledChat')} · ${translate('sessionForkSuffix')}`,
    createdAt: now,
    updatedAt: now,
    messages,
    rootMessageId: messages[0].id,
    contextCheckpoints: source.contextCheckpoints
      ? source.contextCheckpoints.map((checkpoint) => ({ ...checkpoint }))
      : undefined,
  }
  touchSession(next.id)
  set((state) => ({
    sessions: [toSessionSummary(next), ...state.sessions],
    sessionCache: { ...state.sessionCache, [next.id]: next },
    activeId: next.id,
    pendingJump: null,
  }))
  persist(next.id)
  return next.id
}

export const selectSession = (id: string) => {
  if (!get().importingHistory && get().sessions.some((session) => session.id === id)) {
    cancelMessageEdit()
    touchSession(id)
    set({ activeId: id, pendingJump: null })
    void ensureSessionLoaded(id)
    trimSessionCache()
  }
}

/** 从搜索结果跳转到指定会话的指定消息：若目标消息在非当前分支，自动激活通往该消息的分支路径。 */
export const selectSessionMessage = (sessionId: string, messageId: string) => {
  if (
    get().importingHistory ||
    deletingSessions.has(sessionId) ||
    !get().sessions.some((session) => session.id === sessionId)
  ) {
    return
  }
  cancelMessageEdit()
  touchSession(sessionId)
  const nonce = ++jumpSequence
  const cached = getSession(sessionId)
  if (cached && !getStreamController(sessionId)) {
    const activated = activateBranch(cached, messageId)
    if (activated !== cached) {
      set((state) => ({
        activeId: sessionId,
        pendingJump: { sessionId, messageId, nonce },
        sessionCache: { ...state.sessionCache, [sessionId]: activated },
      }))
      persist(sessionId)
      trimSessionCache()
      return
    }
  }
  set({ activeId: sessionId, pendingJump: { sessionId, messageId, nonce } })
  void ensureSessionLoaded(sessionId)
  trimSessionCache()
}

export const clearPendingJump = (nonce?: number) => {
  set((state) =>
    state.pendingJump && (nonce === undefined || state.pendingJump.nonce === nonce)
      ? { pendingJump: null }
      : state
  )
}

export const renameSession = (id: string, title: string) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  const controller = getStreamController(id)
  if (controller) {
    titleRequests.delete(controller)
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, title }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session
      ),
    }))
    void db.renameSession(id, title).catch(db.reportStorageError('rename session'))
  }
}

/**
 * 删除会话；本地原件仅在无其他会话引用时清理。远端文件不删除：
 * 导入、编辑与重新生成均复用同一附件，同一服务端文件可能被多个会话引用，此处不维护引用计数。
 */
export const removeSession = (id: string): Promise<boolean> => {
  const task = removeSessionData(id).finally(() => deletionTasks.delete(task))
  deletionTasks.add(task)
  return task
}

const removeSessionData = async (id: string): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return false
  }
  const epoch = historyEpoch
  deletingSessions.add(id)
  try {
    getStreamController(id)?.abort()
    // 等本会话的流收尾，避免删除之后又被收尾保存写回来。
    await waitForIdle(id)
    if (epoch !== historyEpoch) {
      return false
    }
    await db.deleteSession(id)
    if (epoch !== historyEpoch) {
      return true
    }
    sessionLoads.delete(id)
    sessionAccess.delete(id)
    unsavedSessions.delete(id)
    pendingFiles.delete(id)
    clearDraft(id)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => key !== id)
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => key !== id)
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => key !== id)
      ),
      activeId: state.activeId === id ? null : state.activeId,
      pendingJump: state.pendingJump?.sessionId === id ? null : state.pendingJump,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete session')(error)
    return false
  } finally {
    deletingSessions.delete(id)
    // 删除失败时保留会话，并保存停止生成后的最新状态。
    if (getSession(id)) {
      if (get().importingHistory) {
        unsavedSessions.add(id)
      } else {
        persist(id)
      }
    }
  }
}

export const stopReply = (sessionId: string) => getStreamController(sessionId)?.abort()

const stripFileBlobs = (files: readonly DraftFilePayload[]): FileAttachment[] =>
  files.map(({ id, serverId, serverImage, name, size, isImage, mimeType }) => ({
    id,
    serverId,
    serverImage,
    name,
    size,
    isImage,
    mimeType,
  }))

const appendPendingFiles = (sessionId: string, files: readonly DraftFilePayload[]) => {
  const added = files.flatMap((file) => (file.blob ? [{ id: file.id, blob: file.blob }] : []))
  if (added.length > 0) {
    pendingFiles.set(sessionId, [...(pendingFiles.get(sessionId) ?? []), ...added])
  }
}

/**
 * 提交指定会话的最新草稿；null 表示新建会话。
 * 同步接收成功才清空草稿，附件原件由会话接管；保存失败仍通过保存入口重试。
 */
export const sendMessage = (targetSessionId: string | null) => {
  if (get().importingHistory || !get().ready) {
    return false
  }
  const customEndpoint = Boolean(useSettings.getState().chatConfig.endpoint)
  const prepared = prepareDraftMessage(
    getDraft(targetSessionId),
    useUploads.getState().tasks,
    customEndpoint
  )
  if (!prepared) {
    return false
  }
  const { text, files } = prepared
  const now = Date.now()
  let sessionId = targetSessionId
  if (
    sessionId !== null &&
    (deletingSessions.has(sessionId) || getStreamController(sessionId) || !getSession(sessionId))
  ) {
    return false
  }
  if (sessionId === null) {
    const session: Session = {
      id: createId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [],
      rootMessageId: null,
    }
    sessionId = session.id
    touchSession(session.id)
    set((state) => ({
      sessions: [toSessionSummary(session), ...state.sessions],
      sessionCache: { ...state.sessionCache, [session.id]: session },
      activeId: session.id,
    }))
  }
  const current = getSession(sessionId)
  if (!current) {
    return false
  }
  const history = getVisibleMessages(current)
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: stripFileBlobs(files),
    createdAt: now,
  }
  const reply = createReply()
  cancelMessageEdit()
  updateSession(sessionId, (session) => ({
    ...appendBranch(session, history.at(-1)?.id ?? null, [question, reply]),
    title: session.title || (files.length === 0 && SIMPLE_ARITHMETIC.test(text) ? text.trim() : ''),
    updatedAt: now,
  }))
  appendPendingFiles(sessionId, files)
  persist(sessionId)
  clearSentDraft(targetSessionId, customEndpoint)
  if (matchRefusalKeyword(text)) {
    refuseLocally(sessionId, reply)
    return true
  }
  void streamReply(sessionId, reply, { history, question })
  return true
}

/**
 * 语音通话专用提交：文本直接来自 ASR，不读草稿、不占草稿状态。
 * 返回新建会话与回复的 id，通话界面据此订阅流式正文。
 */
/**
 * 启用带开场白的角色卡时调用：把开场白作为一条已完成的助手消息写入会话。
 * 当前会话已有历史时新建会话，避免开场白插进旧对话；返回写入的会话 id。
 */
export const startCharacterIntro = (greeting: string, characterName: string): string | null => {
  const text = greeting.trim()
  if (!text || get().importingHistory || !get().ready) {
    return null
  }
  const now = Date.now()
  let sessionId = get().activeId
  const current = sessionId ? getSession(sessionId) : null
  if (
    !sessionId ||
    !current ||
    current.messages.length > 0 ||
    deletingSessions.has(sessionId) ||
    getStreamController(sessionId)
  ) {
    const session: Session = {
      id: createId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [],
      rootMessageId: null,
    }
    touchSession(session.id)
    set((state) => ({
      sessions: [toSessionSummary(session), ...state.sessions],
      sessionCache: { ...state.sessionCache, [session.id]: session },
      activeId: session.id,
    }))
    sessionId = session.id
  }
  const target = sessionId ? getSession(sessionId) : null
  if (!sessionId || !target) {
    return null
  }
  const { chatConfig } = useSettings.getState()
  const intro: AssistantMessage = {
    id: createId(),
    role: 'assistant',
    createdAt: now,
    model: chatConfig.model || DEFAULT_CHAT_MODEL,
    prefix: false,
    status: 'done',
    blocks: [{ type: 'text', text }],
  }
  updateSession(sessionId, (session) => ({
    ...session,
    title: session.title || characterName.trim(),
    messages: [intro],
    rootMessageId: intro.id,
    updatedAt: now,
  }))
  persist(sessionId)
  return sessionId
}

export const sendVoicePrompt = (
  targetSessionId: string | null,
  content: string
): { sessionId: string; replyId: string } | null => {
  const text = content.trim()
  if (!text || get().importingHistory || !get().ready) {
    return null
  }
  const now = Date.now()
  let sessionId = targetSessionId
  if (
    sessionId !== null &&
    (deletingSessions.has(sessionId) || getStreamController(sessionId) || !getSession(sessionId))
  ) {
    return null
  }
  if (sessionId === null) {
    const session: Session = {
      id: createId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [],
      rootMessageId: null,
    }
    sessionId = session.id
    touchSession(session.id)
    set((state) => ({
      sessions: [toSessionSummary(session), ...state.sessions],
      sessionCache: { ...state.sessionCache, [session.id]: session },
      activeId: session.id,
    }))
  }
  const current = getSession(sessionId)
  if (!current) {
    return null
  }
  const history = getVisibleMessages(current)
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: [],
    createdAt: now,
  }
  const reply = createReply()
  updateSession(sessionId, (session) => ({
    ...appendBranch(session, history.at(-1)?.id ?? null, [question, reply]),
    title: session.title || text.split(/\r?\n/, 1)[0].slice(0, 40),
    updatedAt: now,
  }))
  persist(sessionId)
  if (matchRefusalKeyword(text)) {
    refuseLocally(sessionId, reply)
  } else {
    void streamReply(sessionId, reply, { history, question })
  }
  return { sessionId, replyId: reply.id }
}

/** 重新生成当前路径上的回答：在原问题下新增版本，不覆盖旧回答和后续对话。 */
export const regenerateReply = (sessionId: string, messageId?: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index =
    messageId === undefined ? path.length - 1 : path.findIndex((m) => m.id === messageId)
  const question = path[index - 1]
  if (question?.role !== 'user' || path[index]?.role !== 'assistant') {
    return
  }
  cancelMessageEdit()
  const history = path.slice(0, index - 1)
  const reply = createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, question.id, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history, question })
}

/** 编辑提问后新增同父版本；未显式传入文件列表时保留原消息附件。 */
export const editMessage = (
  sessionId: string,
  messageId: string,
  content: string,
  nextFiles?: DraftFilePayload[]
): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const previous = path[index]
  if (previous?.role !== 'user') {
    return false
  }
  const text = content.trim()
  const files = nextFiles ?? previous.files
  if (!text && files.length === 0) {
    return false
  }
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: stripFileBlobs(files),
    createdAt: Date.now(),
  }
  const reply = createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, path[index - 1]?.id ?? null, [question, reply]),
    updatedAt: Date.now(),
  }))
  appendPendingFiles(sessionId, files)
  persist(sessionId)
  clearSentEdit(sessionId, messageId, Boolean(useSettings.getState().chatConfig.endpoint))
  void streamReply(sessionId, reply, { history: path.slice(0, index), question })
  return true
}

/**
 * 编辑助手回复：内容没变就直接返回 false，不做任何写入；
 * 改了则复制成一条新的回答版本挂到同一个提问下，旧回复保留，可在分支切换里回看。
 */
export const editAssistantMessage = (
  sessionId: string,
  messageId: string,
  content: string
): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const target = path[index]
  if (target?.role !== 'assistant') {
    return false
  }
  const text = content.trim()
  if (!text) {
    return false
  }
  const original = target.blocks
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('\n\n')
    .trim()
  if (text === original) {
    return false
  }
  const edited: AssistantMessage = {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: target.model,
    thinking: target.thinking,
    search: target.search,
    latestReminder: target.latestReminder,
    prefix: target.prefix,
    status: 'done',
    blocks: [{ type: 'text', text }],
  }
  updateSession(sessionId, (current) => ({
    ...appendBranch(current, target.parentId ?? null, [edited]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  return true
}

/**
 * 删除助手回复：这条回复和它后面接着的问答一起删，提问本身保留。
 * 若同一个提问下还有别的回答版本，删完自动落到剩下的那一版。
 */
export const deleteMessage = (sessionId: string, messageId: string): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const path = getVisibleMessages(session)
  if (!path.some((message) => message.id === messageId)) {
    return false
  }
  updateSession(sessionId, (current) => {
    const base = normalizeSession(current)
    const doomed = new Set<string>([messageId])
    let grew = true
    while (grew) {
      grew = false
      for (const message of base.messages) {
        if (message.parentId && doomed.has(message.parentId) && !doomed.has(message.id)) {
          doomed.add(message.id)
          grew = true
        }
      }
    }
    const parentId = base.messages.find((message) => message.id === messageId)?.parentId ?? null
    const kept = base.messages.filter((message) => !doomed.has(message.id))
    const sibling = kept.find((message) => (message.parentId ?? null) === parentId)
    return {
      ...base,
      messages: kept.map((message) =>
        message.id === parentId ? { ...message, selectedChildId: sibling?.id } : message
      ),
      rootMessageId: messageId === base.rootMessageId ? (sibling?.id ?? null) : base.rootMessageId,
      updatedAt: Date.now(),
    }
  })
  persist(sessionId)
  return true
}

export const selectMessageVersion = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  if (getStreamController(sessionId)) {
    return
  }
  cancelMessageEdit()
  updateSession(sessionId, (session) => selectVersion(session, messageId))
  persist(sessionId)
}

/** 继续最后一条未完成的回答：保留原消息与开关，仅将新流的内容追加到原块之后。 */
export const continueReply = (sessionId: string, messageId: string) => {
  const { chatConfig } = useSettings.getState()
  if (
    get().importingHistory ||
    deletingSessions.has(sessionId) ||
    chatConfig.endpoint ||
    chatConfig.format !== 'messages'
  ) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const question = path.at(-2)
  const previous = path.at(-1)
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.id !== messageId ||
    !canContinueReply(previous)
  ) {
    return
  }
  const { thinking, search } = useSettings.getState()
  const reply: AssistantMessage = {
    ...previous,
    // 旧回复只有最近一次 usage，续写前先把它当成第一条历史，避免覆盖后丢掉上一轮消耗。
    usageHistory: previous.usageHistory ?? (previous.usage ? [previous.usage] : undefined),
    // 本次请求还没有拿到 usage，清空快照，失败时不会把上一轮重复记进账本。
    usage: undefined,
    // 未记录请求配置的回复，续写时使用默认模型和当前开关。
    model: previous.model ?? (chatConfig.model || DEFAULT_CHAT_MODEL),
    thinking: previous.thinking ?? thinking,
    search: previous.search ?? search,
    status: 'pending',
    stopReason: undefined,
    stopDetails: undefined,
    error: undefined,
  }
  updateReply(sessionId, reply)
  updateSession(sessionId, (s) => ({ ...s, updatedAt: Date.now() }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, -2), question, prefix: previous })
}

/** 附件补传失败后重试：保留原回答位置，重新补传并请求 */
/** 提炼请求的固定提示：只输出清单，每行一条，便于解析 */
const MEMORY_REFINE_SYSTEM =
  '你是长期记忆整理助手。把已有记忆与最新一轮对话合并成一份简洁的长期记忆清单，每行一条，' +
  '去掉重复、寒暄和一次性内容，保留称呼、关系、偏好、约定与关键事件。' +
  '只输出清单本身，不要编号以外的任何解释。'

/** 将卡片挂载到生成它的消息上；无法挂载则丢弃，不影响其他轮次 */
const attachMemories = (sessionId: string, messageId: string, cards: MemoryCard[]) => {
  if (cards.length === 0) {
    return false
  }
  let attached = false
  updateSession(sessionId, (session) => {
    if (!session.messages.some((message) => message.id === messageId)) {
      return session
    }
    attached = true
    return {
      ...session,
      messages: session.messages.map((message) =>
        message.id === messageId
          ? { ...message, memories: [...(message.memories ?? []), ...cards] }
          : message
      ),
    }
  })
  persist(sessionId)
  return attached
}

/** 批量挂载：整段保存时一次写入，避免每轮都写一次 IndexedDB */
const attachMemoriesBatch = (
  sessionId: string,
  drafts: Array<{ messageId: string; card: MemoryCard }>
) => {
  if (drafts.length === 0) {
    return false
  }
  const byMessage = new Map<string, MemoryCard[]>()
  for (const draft of drafts) {
    const list = byMessage.get(draft.messageId)
    if (list) {
      list.push(draft.card)
    } else {
      byMessage.set(draft.messageId, [draft.card])
    }
  }
  let attached = false
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) => {
      const cards = byMessage.get(message.id)
      if (!cards) {
        return message
      }
      attached = true
      // 同一轮旧的自动截断卡、提炼汇总卡让位给完整卡；手动卡与置顶卡保留
      const archived = (message.memories ?? []).map((card) =>
        (card.source === 'auto' || card.source === 'refine') && !card.pinned && !card.superseded
          ? { ...card, superseded: true }
          : card
      )
      return { ...message, memories: [...archived, ...cards] }
    }),
  }))
  if (attached) {
    persist(sessionId)
  }
  return attached
}

/** 通知界面：这一轮/这条记忆已经真正写进去了 */
const notifyMemoryAdded = (sessionId: string, kind: 'turn' | 'refine' | 'manual' | 'bulk') => {
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  const count = activeMemoryCards(session, getVisibleMessages(session)).length
  window.dispatchEvent(new CustomEvent('replica:memory-added', { detail: { kind, count } }))
}

/** 一轮结束后用模型把记忆合并重写；失败就保留整轮记录，不影响聊天 */
const refineMemories = async (
  sessionId: string,
  targetMessageId: string,
  question: string,
  answer: string
) => {
  const { chatConfig, apiKey: key, customHeaders } = useSettings.getState()
  const apiKey = key ?? ''
  if (!apiKey && !chatConfig.endpoint) {
    return
  }
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  const visibleIds = new Set(getVisibleMessages(session).map((message) => message.id))
  const cards = activeMemoryCards(session, getVisibleMessages(session), 60, 'character')
    .filter(
      (entry) =>
        entry.card.source !== 'manual' && entry.card.source !== 'bulk' && !entry.card.pinned
    )
    .map((entry) => entry.card)
    .slice(-30)
  let text = ''
  try {
    const events = streamChatMessage(
      chatConfig,
      apiKey,
      {
        model: chatConfig.model || DEFAULT_CHAT_MODEL,
        max_tokens: 800,
        system: MEMORY_REFINE_SYSTEM,
        messages: [
          {
            role: 'user',
            content: buildRefinePrompt(cards, question, answer, resolveUserName()),
          },
        ],
        thinking: { type: 'disabled' },
      },
      new AbortController().signal,
      parseCustomHeaders(customHeaders)
    )
    for await (const event of events) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
        if (text.length > 8000) {
          break
        }
      }
    }
  } catch {
    return
  }
  const lines = parseRefinedCards(text, useSettings.getState().memoryLimit)
  if (lines.length === 0) {
    return
  }
  const refined = lines.map((line) => createMemoryCard(line, 'refine'))
  updateSession(sessionId, (current) => ({
    ...current,
    messages: current.messages.map((message) => {
      if (!visibleIds.has(message.id)) {
        return message
      }
      // 手写卡片、整段保存的完整卡、置顶卡和普通记忆都由用户自己维护，不参与角色提炼替换
      const archived = (message.memories ?? []).map((card) =>
        card.superseded ||
        card.source === 'manual' ||
        card.source === 'bulk' ||
        card.pinned ||
        getMemoryPool(card) !== 'character'
          ? card
          : { ...card, superseded: true }
      )
      if (message.id !== targetMessageId) {
        return archived.length > 0 ? { ...message, memories: archived } : message
      }
      return { ...message, memories: [...archived, ...refined] }
    }),
  }))
  persist(sessionId)
  enforceMemoryLimit(sessionId)
  notifyMemoryAdded(sessionId, 'refine')
}

/** 超出上限时把最早的自动卡片标为归档；手动卡片不动，也不删除任何文本 */
const enforceMemoryLimit = (sessionId: string, pool: MemoryPool = 'character') => {
  const settings = useSettings.getState()
  const limit = pool === 'normal' ? settings.normalMemoryLimit : settings.memoryLimit
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  const overflow = overflowMemoryCards(
    session,
    getVisibleMessages(session),
    limit,
    pool
  )
  if (overflow.length === 0) {
    return
  }
  const ids = new Set(overflow.map((entry) => entry.card.id))
  updateSession(sessionId, (current) => ({
    ...current,
    messages: current.messages.map((message) =>
      message.memories?.some((card) => ids.has(card.id))
        ? {
            ...message,
            memories: message.memories.map((card) =>
              ids.has(card.id) ? { ...card, superseded: true } : card
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/** 超出字数上限时把最早的自动卡片标为归档；手动/置顶卡片保留 */
const enforceMemoryChars = (sessionId: string, pool: MemoryPool = 'character') => {
  const settings = useSettings.getState()
  const limit = pool === 'normal' ? settings.normalMemoryChars : settings.memoryChars
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  const overflow = overflowMemoryCardsByChars(
    session,
    getVisibleMessages(session),
    limit,
    pool
  )
  if (overflow.length === 0) {
    return
  }
  const ids = new Set(overflow.map((entry) => entry.card.id))
  updateSession(sessionId, (current) => ({
    ...current,
    messages: current.messages.map((message) =>
      message.memories?.some((card) => ids.has(card.id))
        ? {
            ...message,
            memories: message.memories.map((card) =>
              ids.has(card.id) ? { ...card, superseded: true } : card
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
}

const SCENE_UPDATE_SYSTEM = `你负责维护角色扮演的场景状态。根据最近一轮对话，判断时间、地点、穿着、心情、关系阶段是否发生变化。
只输出下面五行，没有变化的字段写“不变”：
时间：...
地点：...
穿着：...
心情：...
关系阶段：...
不要解释，不要写分析，不要用列表符号，不要编造对话里没有的信息。`

/** 自动场景更新：多发一次很小的请求；失败就保持原场景，不影响聊天 */
const updateSceneFromTurn = async (question: string, answer: string) => {
  const { chatConfig, apiKey: key, customHeaders, scene } = useSettings.getState()
  const apiKey = key ?? ''
  if (!apiKey && !chatConfig.endpoint) {
    return
  }
  let text = ''
  try {
    const events = streamChatMessage(
      chatConfig,
      apiKey,
      {
        model: chatConfig.model || DEFAULT_CHAT_MODEL,
        max_tokens: 220,
        system: SCENE_UPDATE_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `【当前场景】\n时间：${scene.time || '未记录'}\n地点：${scene.place || '未记录'}\n穿着：${scene.outfit || '未记录'}\n心情：${scene.mood || '未记录'}\n关系阶段：${scene.relationship || '未记录'}\n\n【最近一轮】\n用户：${question}\n角色：${answer.slice(0, 1200)}`,
          },
        ],
        thinking: { type: 'disabled' },
      },
      new AbortController().signal,
      parseCustomHeaders(customHeaders)
    )
    for await (const event of events) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
        if (text.length > 1200) {
          break
        }
      }
    }
  } catch {
    return
  }
  const current = useSettings.getState().scene
  const next = parseSceneUpdate(text, current)
  if (next === current) {
    return
  }
  replaceScene(next)
  window.dispatchEvent(new CustomEvent('replica:scene-updated', { detail: next }))
}

/** 自动记忆入口：整轮记录先落盘，提炼模式下再异步重写这一份 */
const recordTurnMemory = (
  sessionId: string,
  targetMessageId: string,
  question: string,
  answer: string,
  mode: 'off' | 'turn' | 'refine'
) => {
  if (mode === 'off') {
    return
  }
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  const visible = getVisibleMessages(session)
  let target = targetMessageId
  if (!session.messages.some((message) => message.id === target)) {
    // 回复消息可能在生成期间被切走/淘汰，退回到当前分支最后一条，避免这一轮静默丢失
    const last = visible.at(-1)
    if (!last) {
      return
    }
    target = last.id
  }
  const targetMessage = visible.find((message) => message.id === target)
  const at = targetMessage?.createdAt ?? Date.now()
  const turnIndex = visible.filter((message) => message.role === 'assistant').length
  const relationship = useSettings.getState().scene.relationship.trim()
  const text = buildTurnMemoryText(question, answer, {
    at,
    turnIndex: turnIndex > 0 ? turnIndex : undefined,
    relationship: relationship || undefined,
  })
  if (!text) {
    return
  }
  if (!attachMemories(sessionId, target, [createMemoryCard(text, 'auto', at)])) {
    return
  }
  enforceMemoryLimit(sessionId)
  enforceMemoryChars(sessionId)
  if (mode === 'refine') {
    void refineMemories(sessionId, target, question, answer)
  } else {
    notifyMemoryAdded(sessionId, 'turn')
  }
}

/**
 * 角色扮演开启且角色卡真实存在时，记忆写入锁在角色池：
 * 代码、开发日志和整轮剧情都不允许意外落进普通记忆。
 */
const roleplayMemoryLocked = () => {
  const settings = useSettings.getState()
  return settings.roleplayEnabled && Boolean(
    findActiveCharacterCard(settings.characterCards, settings.activeCharacterId)
  )
}

/**
 * 普通代码记忆自动入库：回复里出现三连反引号代码块时自动存一张普通-代码卡。
 * 只在非角色扮演场景生效；同一条回复只记一次，用户仍可在保存弹窗里手动选择其它分类。
 */
const recordNormalCodeMemory = (sessionId: string, targetMessageId: string, answer: string) => {
  if (
    roleplayMemoryLocked() ||
    !useSettings.getState().normalMemoryEnabled ||
    !detectCodeBlock(answer)
  ) {
    return
  }
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  const target = session.messages.find((message) => message.id === targetMessageId)
  if (!target) {
    return
  }
  const exists = (target.memories ?? []).some(
    (card) =>
      getMemoryPool(card) === 'normal' &&
      card.category === 'code' &&
      !card.superseded
  )
  if (exists) {
    return
  }
  if (
    attachMemories(sessionId, target.id, [
      createMemoryCard(answer, 'auto', target.createdAt, {
        pool: 'normal',
        category: 'code',
        language: detectCodeLanguage(answer),
      }),
    ])
  ) {
    enforceMemoryLimit(sessionId, 'normal')
    enforceMemoryChars(sessionId, 'normal')
    notifyMemoryAdded(sessionId, 'turn')
  }
}

/** 面板里手动加一条：挂到当前分支最后一条消息上 */
export const addManualMemory = (
  sessionId: string,
  text: string,
  target: { pool?: MemoryPool; category?: NormalMemoryKind } = {}
) => {
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  const last = getVisibleMessages(session).at(-1)
  if (!last || !text.trim()) {
    return
  }
  const pool: MemoryPool = roleplayMemoryLocked()
    ? 'character'
    : target.pool === 'normal'
      ? 'normal'
      : 'character'
  const category = pool === 'normal' ? target.category ?? 'dialogue' : undefined
  const language =
    pool === 'normal' && category === 'code' ? detectCodeLanguage(text) : undefined
  if (
    attachMemories(sessionId, last.id, [
      createMemoryCard(text, 'manual', undefined, { pool, category, language }),
    ])
  ) {
    enforceMemoryChars(sessionId, pool)
    notifyMemoryAdded(sessionId, 'manual')
  }
}

export type SaveConversationMemoryResult = {
  /** 本次写入的完整回合卡片数 */
  created: number
  /** 已经存在整段卡片的轮次，跳过不重复写 */
  skipped: number
  /** 写完后仍在生效的卡片数 */
  active: number
  /** 写完后仍在生效的总字数 */
  chars: number
}

export type MemorySaveTarget =
  | { pool: 'character' }
  | { pool: 'normal'; category?: NormalMemoryKind | 'auto' }

/**
 * 把选中的消息保存为记忆卡。
 * 角色记忆按轮生成完整回合卡；普通记忆每条消息一张，按分类或自动识别代码/用户/AI。
 * 先全部写入，再按对应分类的卡片上限和字数上限归档最早卡片；超出不会丢内容，也不会让保存失败。
 */
export const saveMessagesAsMemory = (
  sessionId: string,
  messageIds: string[],
  target: MemorySaveTarget = { pool: 'character' }
): SaveConversationMemoryResult => {
  const empty: SaveConversationMemoryResult = { created: 0, skipped: 0, active: 0, chars: 0 }
  const pool: MemoryPool = roleplayMemoryLocked() ? 'character' : target.pool
  const session = getSession(sessionId)
  if (!session) {
    return empty
  }
  const messages = getVisibleMessages(session)
  const selected = new Set(messageIds)
  const picked = messages.filter((message) => selected.has(message.id))
  if (picked.length === 0) {
    return {
      ...empty,
      active: activeMemoryCards(session, messages, undefined, pool).length,
      chars: activeMemoryChars(session, messages, pool),
    }
  }
  const firstIndex = messages.findIndex((message) => selected.has(message.id))
  const startTurn = messages
    .slice(0, Math.max(0, firstIndex))
    .filter((message) => message.role === 'assistant').length
  const indexById = new Map(messages.map((message, index) => [message.id, index]))
  const drafts =
    pool === 'normal'
      ? buildNormalMemoryCards(
          picked,
          target.pool === 'normal' ? target.category ?? 'auto' : 'auto'
        )
      : buildConversationMemoryCards(
          picked,
          startTurn,
          (user, assistant) => indexById.get(assistant.id) === (indexById.get(user.id) ?? -2) + 1
        )
  const alreadyBulk = new Set(
    session.messages
      .filter((message) =>
        (message.memories ?? []).some(
          (card) => card.source === 'bulk' && getMemoryPool(card) === pool
        )
      )
      .map((message) => message.id)
  )
  const fresh = drafts.filter((draft) => !alreadyBulk.has(draft.messageId))
  const skipped = drafts.length - fresh.length
  if (fresh.length === 0) {
    return {
      ...empty,
      skipped,
      active: activeMemoryCards(session, messages, undefined, pool).length,
      chars: activeMemoryChars(session, messages, pool),
    }
  }
  if (!attachMemoriesBatch(sessionId, fresh)) {
    return { ...empty, skipped }
  }
  enforceMemoryLimit(sessionId, pool)
  enforceMemoryChars(sessionId, pool)
  notifyMemoryAdded(sessionId, 'bulk')
  const next = getSession(sessionId)
  return {
    created: fresh.length,
    skipped,
    active: next ? activeMemoryCards(next, getVisibleMessages(next), undefined, pool).length : 0,
    chars: next ? activeMemoryChars(next, getVisibleMessages(next), pool) : 0,
  }
}

/** 全选当前分支的全部对话；面板里的整段保存仍走这里 */
export const saveConversationAsMemory = (sessionId: string): SaveConversationMemoryResult => {
  const session = getSession(sessionId)
  if (!session) {
    return { created: 0, skipped: 0, active: 0, chars: 0 }
  }
  return saveMessagesAsMemory(
    sessionId,
    getVisibleMessages(session).map((message) => message.id)
  )
}

/** 置顶开关：置顶卡片每轮必进注入名单，最多 8 张 */
export const setMemoryPinned = (
  sessionId: string,
  messageId: string,
  cardId: string,
  pinned: boolean
) => {
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            memories: (message.memories ?? []).map((card) =>
              card.id === cardId ? { ...card, pinned } : card
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/** 面板编辑：只改文本；勾选状态走 setMemoryEnabled */
export const updateMemoryText = (
  sessionId: string,
  messageId: string,
  cardId: string,
  text: string
) => {
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            memories: (message.memories ?? []).map((card) =>
              card.id === cardId ? { ...card, text: text.trim() } : card
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
  enforceMemoryChars(sessionId)
}

export const setMemoryEnabled = (
  sessionId: string,
  messageId: string,
  cardId: string,
  enabled: boolean
) => {
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            memories: (message.memories ?? []).map((card) =>
              card.id === cardId ? { ...card, enabled } : card
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
  enforceMemoryChars(sessionId)
}

export const deleteMemoryCard = (sessionId: string, messageId: string, cardId: string) => {
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            memories: (message.memories ?? []).filter((card) => card.id !== cardId),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/** 清空当前会话（当前分支上）的全部记忆；传 pool 时只清空对应分类 */
export const clearMemories = (sessionId: string, pool?: MemoryPool) => {
  updateSession(sessionId, (session) => {
    const visibleIds = new Set(getVisibleMessages(session).map((message) => message.id))
    return {
      ...session,
      messages: session.messages.map((message) =>
        visibleIds.has(message.id) && message.memories
          ? {
              ...message,
              memories: pool
                ? message.memories.filter((card) => getMemoryPool(card) !== pool)
                : [],
            }
          : message
      ),
    }
  })
  persist(sessionId)
}

export const retryUpload = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const question = path[index - 1]
  const previous = path[index]
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.error?.kind !== 'upload'
  ) {
    return
  }
  const reply: AssistantMessage = { ...previous, status: 'pending', error: undefined }
  updateReply(sessionId, reply)
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index - 1), question })
}

type Request = { history: Message[]; question: UserMessage; prefix?: AssistantMessage }

/** 把补传得到的 serverId 写回会话里所有引用同一附件的消息（编辑、重新生成会共用附件） */
const saveUploadedFiles = (sessionId: string, uploads: Map<string, AttachmentUpload>) => {
  if (uploads.size === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.role === 'user' && message.files.some((file) => uploads.has(file.id))
        ? {
            ...message,
            files: message.files.map((file) => {
              const result = uploads.get(file.id)
              return result ? { ...file, ...result } : file
            }),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/**
 * 附件的服务端 id：已有直接用；正在上传的等待同一任务；否则读取本地原件补传。
 * 本地也没有原件（导入的文档附件只有元数据）时返回 null，该附件只展示、不进入请求。
 */
const ensureServerId = async (
  apiKey: string,
  file: FileAttachment
): Promise<AttachmentUpload | null> => {
  if (file.serverId) {
    return { serverId: file.serverId, serverImage: file.serverImage }
  }
  const task = useUploads.getState().tasks[file.id]
  if (task?.status === 'done') {
    return { serverId: task.serverId, serverImage: task.serverImage }
  }
  const blob = await db.loadFile(file.id)
  if (!blob) {
    return null
  }
  return uploadAttachment(apiKey, file.id, blob, file.name, file.isImage)
}

/** 以会话中的最新消息替换请求快照：重传前会重置附件 serverId，快照需同步更新 */
const refreshRequest = (sessionId: string, request: Request): Request => {
  const session = getSession(sessionId)
  if (!session) {
    return request
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const pick = <T extends Message>(message: T): T =>
    (byId.get(message.id) as T | undefined) ?? message
  return {
    history: request.history.map(pick),
    question: pick(request.question),
    prefix: request.prefix,
  }
}

/**
 * 发送前补齐附件的 serverId。
 * - 本轮提问的附件并行补齐，任一失败则整体失败，已成功的照常写回，重试时复用成功结果；
 * - 历史轮次（仅进入上下文的）中没有 serverId 的附件，多为导入的图片：从最新的消息往前逐张补传，
 *   失败静默跳过，该附件不进入本次请求，下次发送时再试。
 */
const prepareFiles = async (sessionId: string, request: Request, signal: AbortSignal) => {
  const epoch = historyEpoch
  // 服务端判定 file_id 失效时会清掉会话里的 serverId，先用最新消息替换请求快照，
  // 否则快照仍持有旧 id，补传会直接复用该值。
  request = refreshRequest(sessionId, request)
  const apiKey = useSettings.getState().apiKey ?? ''
  const resultsById = new Map<string, AttachmentUpload>()
  // 停止生成立即生效；上传本身不取消（输入框与其他消息可能共用同一任务），完成后照常写回 serverId
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const uploads = Promise.allSettled(
    request.question.files.map(async (file) => {
      const result = await ensureServerId(apiKey, file)
      if (result) {
        resultsById.set(file.id, result)
      }
    })
  )
  void uploads.then(() => {
    if (epoch === historyEpoch) {
      saveUploadedFiles(sessionId, resultsById)
    }
  })
  const results = await Promise.race([uploads, aborted])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) {
    throw failed.reason
  }

  const pending = new Map<string, FileAttachment>()
  for (const [user] of [...getContextRounds(request.history)].reverse()) {
    for (const file of user.files) {
      if (!file.serverId && !resultsById.has(file.id) && !pending.has(file.id)) {
        pending.set(file.id, file)
      }
    }
  }
  for (const file of pending.values()) {
    signal.throwIfAborted()
    try {
      const result = await Promise.race([ensureServerId(apiKey, file), aborted])
      if (result) {
        saveUploadedFiles(sessionId, new Map([[file.id, result]]))
      }
    } catch {
      signal.throwIfAborted()
    }
  }

  const prepared = refreshRequest(sessionId, request)
  const images = getRequestImages(prepared)
  if (images.length < MANY_IMAGES_COUNT) {
    return prepared
  }

  // API 根据请求里的图片总数降低尺寸限制，历史轮次也计入。
  const oversized = new Map(
    images
      .filter((file) => (file.serverImage?.maxEdge ?? 0) > MANY_IMAGES_MAX_EDGE)
      .map((file) => [file.id, file])
  )
  const constrained = Promise.allSettled(
    [...oversized.values()].map(async (file) => {
      const result = await uploadRequestImage(sessionId, apiKey, file, MANY_IMAGES_MAX_EDGE, signal)
      if (result && epoch === historyEpoch) {
        saveUploadedFiles(sessionId, new Map([[file.id, result]]))
      }
    })
  )
  const constrainedResults = await Promise.race([constrained, aborted])
  const constraintFailure = constrainedResults.find((result) => result.status === 'rejected')
  if (constraintFailure) {
    throw constraintFailure.reason
  }
  return refreshRequest(sessionId, prepared)
}

const getRequestImages = (request: Request) =>
  [request.question, ...getContextRounds(request.history).map(([user]) => user)].flatMap(
    ({ files }) => files.filter((file) => file.isImage && file.serverId)
  )

const uploadRequestImage = async (
  sessionId: string,
  apiKey: string,
  file: FileAttachment,
  maxEdge: number,
  signal: AbortSignal
) => {
  const task = useUploads.getState().tasks[file.id]
  if (
    task?.status === 'done' &&
    task.serverId !== file.serverId &&
    task.serverImage?.converted &&
    task.serverImage.maxEdge <= maxEdge
  ) {
    return { serverId: task.serverId, serverImage: task.serverImage }
  }
  const blob = await loadOriginalFile(sessionId, file.id)
  signal.throwIfAborted()
  if (!blob) {
    return null
  }
  const options = { maxEdge, forceConversion: true }
  const result = await uploadAttachment(apiKey, file.id, blob, file.name, true, options)
  // 同一附件可能有另一轮上传正在进行，复用它之前先核对图片尺寸和格式。
  if (result.serverImage?.converted && result.serverImage.maxEdge <= maxEdge) {
    return result
  }
  signal.throwIfAborted()
  return uploadAttachment(apiKey, file.id, blob, file.name, true, options)
}

/** 旧附件或原始格式被 Messages API 拒绝时，按实际发送的消息和块索引只修复那一张。 */
const repairRejectedImage = async (
  sessionId: string,
  request: Request,
  messages: MessageParam[],
  error: unknown,
  signal: AbortSignal
): Promise<boolean> => {
  const position = getRejectedImagePosition(error)
  if (!position) {
    return false
  }
  const message = messages[position.message]
  if (message?.role !== 'user' || !Array.isArray(message.content)) {
    return false
  }
  const block = message.content[position.block]
  if (block?.type !== 'image' || block.source.type !== 'file') {
    return false
  }
  const { file_id: fileId } = block.source
  const images = getRequestImages(refreshRequest(sessionId, request))
  const file = images.find(({ serverId }) => serverId === fileId)
  const maxEdge = images.length >= MANY_IMAGES_COUNT ? MANY_IMAGES_MAX_EDGE : MAX_IMAGE_EDGE
  if (!file || (file.serverImage?.converted && file.serverImage.maxEdge <= maxEdge)) {
    return false
  }
  const epoch = historyEpoch
  const apiKey = useSettings.getState().apiKey ?? ''
  const result = await uploadRequestImage(sessionId, apiKey, file, maxEdge, signal)
  if (!result || signal.aborted || epoch !== historyEpoch) {
    return false
  }
  saveUploadedFiles(sessionId, new Map([[file.id, result]]))
  return true
}

/** 本次请求实际会用到的服务端 file_id */
const collectServerFileIds = (request: Request): Set<string> => {
  const ids = new Set<string>()
  const add = (files: FileAttachment[]) => {
    for (const file of files) {
      if (file.serverId) {
        ids.add(file.serverId)
      }
    }
  }
  add(request.question.files)
  for (const [user] of getContextRounds(request.history)) {
    add(user.files)
  }
  return ids
}

/**
 * 服务端判定 file_id 失效时，清掉对应附件的 serverId 并丢弃旧的上传任务，
 * 下一次补齐会重新读取本地原件上传。报错里点名了 file_id 就只重置这些，
 * 没点名（如 invalid file_id）则重置本次请求用到的全部附件。
 */
const reuploadInvalidatedFiles = (sessionId: string, request: Request, error: unknown): boolean => {
  if (!(error instanceof ApiError) || !getFileErrorCode(error)) {
    return false
  }
  const mentioned = extractFileIds(error.message)
  // 重试时原始快照里还是上一轮已被清掉的 serverId，先换成会话里的最新消息
  const targets =
    mentioned.length > 0
      ? new Set(mentioned)
      : collectServerFileIds(refreshRequest(sessionId, request))
  const session = getSession(sessionId)
  if (targets.size === 0 || !session) {
    return false
  }
  const localIds: string[] = []
  const messages = session.messages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    let changed = false
    const files = message.files.map((file) => {
      if (!file.serverId || !targets.has(file.serverId)) {
        return file
      }
      localIds.push(file.id)
      changed = true
      return { ...file, serverId: null, serverImage: undefined }
    })
    return changed ? { ...message, files } : message
  })
  if (localIds.length === 0) {
    return false
  }
  updateSession(sessionId, (current) => ({ ...current, messages }))
  // 上传任务可能持有同一个失效 serverId：清除后 ensureServerId 才会重新上传。
  localIds.forEach(cancelUpload)
  persist(sessionId)
  return true
}

/** 重传前的退避等待；停止生成时立即返回，由调用方按已停止收尾 */
const waitForRetry = (attempt: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      FILE_RETRY_BASE_DELAY * 2 ** attempt
    )
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * 请求并消费流：先补齐附件的 serverId，再发请求；流式增量按动画帧刷新内存，完成、失败或停止后落盘。
 * 补传失败时回复记为 upload 错误，可重试。
 * 服务端拒绝附件时尝试重新补传后重发。失效的 file_id 退避重试，图片按报错中指明的位置修复。
 */
const streamReply = async (sessionId: string, initial: AssistantMessage, request: Request) => {
  const {
    apiKey: storedKey,
    chatConfig,
    systemPrompt,
    temperature,
    topP,
    maxTokens,
    rpTemperature,
    rpTopP,
    rpMaxTokens,
    keepRefusedContent,
    autoCompact,
    thinkingEffort,
    customHeaders,
    safetyCheck,
    sendLatestReminder,
    autoTitle,
    suppressMetaTalk,
    memoryMode,
    memoryLimit,
    memoryChars,
    normalMemoryEnabled,
    normalMemoryLimit,
    normalMemoryChars,
    characterCards,
    activeCharacterId,
    characterName,
    roleplayEnabled,
    worldbook,
    worldbookInject,
    scene,
    sceneAutoUpdate,
  } = useSettings.getState()
  const apiKey = storedKey ?? ''
  const custom = Boolean(chatConfig.endpoint)
  // 角色设定必须随每次请求下发：自定义网关同样需要 system 字段，缺失时模型无人物设定。
  // 没改过默认提示词时，自定义网关改用中性提示，避免把「DeepSeek 助手」身份塞进角色扮演。
  // 角色设定必须随每次请求下发：手写文本原样使用，`{{user}}` 只在发请求时换成账号名字，
  // 打开出戏压制时再在后面追加演出规则；本地保存的提示词不会被改写。
  const sessionForMemory = getSession(sessionId)
  const visibleForRoleplay = sessionForMemory ? getVisibleMessages(sessionForMemory) : []
  const activeCard = findActiveCharacterCard(characterCards, activeCharacterId)
  // 关闭角色扮演后完全不使用启用卡：身份、关系、说话方式、世界书、场景与角色记忆都不注入
  const roleplayActive = roleplayEnabled && Boolean(activeCard)
  const selectedMemoryEntries =
    memoryMode === 'off' || !sessionForMemory
      ? []
      : selectMemoryCardsForInjection(
          sessionForMemory,
          visibleForRoleplay,
          memoryLimit,
          request.question.content
        )
  // 角色记忆属于角色剧情；关闭扮演后整段停用，普通对话只保留普通记忆与手写提示词
  const memoryCards = roleplayActive
    ? filterCharacterMemoryForInjection(selectedMemoryEntries, true).map((entry) => entry.card)
    : []
  // 普通记忆只用于开发、排错与问答；角色扮演开启时不注入，避免代码和开发日志污染人设
  const normalCards =
    normalMemoryEnabled && sessionForMemory && !roleplayActive
      ? selectNormalMemoryCardsForInjection(
          sessionForMemory,
          visibleForRoleplay,
          normalMemoryLimit,
          request.question.content
        ).map((entry) => entry.card)
      : []
  const rpActive = roleplayActive
  const effectiveTemperature = rpActive ? (rpTemperature ?? temperature) : temperature
  const effectiveTopP = rpActive ? (rpTopP ?? topP) : topP
  const effectiveMaxTokens = rpActive ? (rpMaxTokens ?? maxTokens) : maxTokens
  const recentText = [
    request.question.content,
    ...visibleForRoleplay
      .slice(-5)
      .map((message) => (message.role === 'assistant' ? replyPlainText(message) : message.content)),
  ]
    .filter(Boolean)
    .join('\n')
  const worldEntries =
    worldbookInject && roleplayActive
      ? selectWorldbookEntries(
          worldbook,
          recentText,
          WORLDBOOK_INJECT_MAX,
          useSettings.getState().worldbookChars,
          activeCard?.id ?? null
        )
      : []
  const userName = resolveUserName()
  // 插入位置分两段：默认贴人物设定之前当背景，标了 tail 的接在提示词之后，离当前发言最近
  const worldBefore = worldEntries.filter((entry) => entry.position !== 'tail')
  const worldAfter = worldEntries.filter((entry) => entry.position === 'tail')
  // system 只放跨轮稳定的内容。缓存按完整前缀命中，system 里哪怕只变一张记忆卡，
  // 后面的全部历史都会失效；记忆、场景和按关键词挑出的世界书因此统一挪到本轮末尾。
  // 卡内开场白也固定在 system：不按消息条数删，是否重复由卡内“只用一次”的文案约束。
  const baseSystem = [
    roleplayActive && activeCard
      ? formatCharacterCard(activeCard, userName)
      : '',
    composeSystemPrompt({
      savedPrompt: systemPrompt,
      custom,
      suppressMetaTalk: suppressMetaTalk && roleplayActive,
      userName,
    }),
  ]
    .filter(Boolean)
    .join('\n\n')
  // 续写是请求级操作，不是新设定：只在本次请求的非空 system 末尾临时追加接写约束。
  // 普通轮次不携带这段，清空提示词时也不因为续写重新造出一段 system。
  const baseSystemForRequest =
    baseSystem && request.prefix ? `${baseSystem}\n\n${CONTINUATION_GUARD}` : baseSystem
  // 统一替换占位符：手写提示词、角色卡字段、世界书与记忆都走这一处
  // 没有可用的手写名或卡名时用 AI 兜底，避免 {{char}} 原样漏进 system 或背景资料
  const promptCharName = (roleplayActive ? activeCard?.name : characterName)?.trim() || 'AI'
  const baseSystemResolved = applyPlaceholders(baseSystemForRequest, {
    userName,
    charName: promptCharName,
  })
  const dynamicContext = [
    formatNormalMemoryBlock(normalCards, normalCards.length, normalMemoryChars),
    formatMemoryBlock(memoryCards, memoryCards.length, memoryChars),
    roleplayActive ? formatSceneBlock(scene) : '',
    formatWorldbookBlock(worldBefore),
    formatWorldbookBlock(worldAfter),
  ]
    .filter(Boolean)
    .join('\n\n')
  const turnContext = dynamicContext
    ? [
        '（以下是这一轮附带的背景资料，不是对方新说的话，也不属于对话正文；回答仍按最后一条发言继续。）',
        applyPlaceholders(dynamicContext, { userName, charName: promptCharName }),
      ].join('\n')
    : ''
  const settleLocal = (
    target: AssistantMessage,
    status: Parameters<typeof settleReply>[1],
    error?: AssistantMessage['error']
  ) => {
    const settled =
      target.usage === undefined
        ? target
        : {
            ...target,
            usageHistory: [...(target.usageHistory ?? []), target.usage],
          }
    return settleReply(settled, status, Date.now(), error, keepRefusedContent)
  }
  const outputCap = (requested: number) =>
    effectiveMaxTokens !== null ? Math.min(requested, effectiveMaxTokens) : requested
  const controller = new AbortController()
  const stopped = new Promise<false>((resolve) => {
    controller.signal.addEventListener('abort', () => resolve(false), { once: true })
  })
  if (!getSession(sessionId)?.title) {
    titleRequests.add(controller)
  }
  set((state) => ({ streaming: { ...state.streaming, [sessionId]: controller } }))
  let reply = custom
    ? {
        ...initial,
        model: chatConfig.model || DEFAULT_CHAT_MODEL,
        thinking: false,
        search: false,
        prefix: false,
      }
    : initial
  let frame = 0
  const flush = () => {
    cancelAnimationFrame(frame)
    frame = 0
    updateReply(sessionId, reply)
  }
  streamFlushes.set(sessionId, flush)

  const signal = controller.signal
  const summarize = createContextSummarizer(apiKey, signal, chatConfig)
  const extraHeaders = parseCustomHeaders(customHeaders)
  const requestModel = reply.model ?? DEFAULT_CHAT_MODEL
  const initialOutputTokens =
    effectiveMaxTokens ?? (custom ? CUSTOM_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS)
  const minOutputReserve = custom ? CUSTOM_OUTPUT_TOKENS : MIN_OUTPUT_RESERVE
  const fallbackOutputTokens = custom ? 1_024 : initial.thinking ? 32_768 : 8_192
  const window = custom ? CUSTOM_CONTEXT_WINDOW : undefined
  const windowLimit = window ?? WINDOW_TOKENS
  const tokenScale = estimateBranchScale(
    request.history,
    requestModel,
    getSession(sessionId)?.contextCheckpoints
  )
  const scaleEstimate = (tokens: number) =>
    tokenScale === 1 ? tokens : Math.ceil(tokens * tokenScale)
  // system 固定参与前缀缓存，本轮背景只影响尾部；两者都占输入窗口，预算里必须算进去。
  const fixedInputTokens =
    scaleEstimate(estimateTextTokens(baseSystemResolved)) +
    scaleEstimate(estimateTextTokens(turnContext))
  const budget = contextBudget(minOutputReserve, window)
  let historyBudget = Math.max(
    0,
    budget.input -
      scaleEstimate(
        estimateQuestionTokens(request.question) + estimatePrefixTokens(request.prefix)
      ) -
      fixedInputTokens -
      PROMPT_OVERHEAD_TOKENS
  )
  let historyRetries = 0
  let historySummaryRequests = 0
  let context: HistoryContext | undefined
  let maxOutputTokens = initialOutputTokens
  let reduceInput = false
  let reducedInput: Awaited<ReturnType<typeof summarizeCurrentInput>> = null
  let invalidatedRetries = 0
  try {
    for (;;) {
      /** 附件补齐前出错属于上传失败，请求还没有发出 */
      let preparing = false
      let receivedContent = false
      let messages: MessageParam[] = []
      let attempt = request
      let estimatedInput = 0
      let requestMaxOutput = maxOutputTokens
      try {
        context ??= await prepareHistoryContext({
          history: request.history,
          checkpoints: getSession(sessionId)?.contextCheckpoints,
          budget: historyBudget,
          recentBudget: budget.recent,
          scale: tokenScale,
          summarize: (input) =>
            autoCompact && historySummaryRequests++ < HISTORY_SUMMARY_LIMIT
              ? summarize(input)
              : Promise.resolve(null),
          save: (checkpoint) => {
            updateSession(sessionId, (session) => ({
              ...session,
              contextCheckpoints: saveContextCheckpoint(session.contextCheckpoints, checkpoint),
            }))
            persist(sessionId)
          },
          signal,
        })
        signal.throwIfAborted()
        attempt = { ...request, history: context.history }
        let prepared = attempt
        if (!custom) {
          preparing = true
          prepared = await prepareFiles(sessionId, attempt, signal)
          preparing = false
        }
        const inlineFiles = custom
          ? await prepareCustomAttachments(
              chatConfig.format,
              prepared.history,
              reducedInput?.question ?? prepared.question,
              (id) => loadOriginalFile(sessionId, id),
              signal
            )
          : undefined
        if (reduceInput && !reducedInput) {
          reducedInput = await summarizeCurrentInput({
            apiKey,
            question: prepared.question,
            prefix: prepared.prefix,
            summarize,
            loadFile: (id) => loadOriginalFile(sessionId, id),
            signal,
            inlineFiles: inlineFiles?.get(prepared.question.id),
          })
          if (!reducedInput) {
            throw new ApiError('protocol', { key: 'replyInputTooLong' })
          }
          historyBudget = Math.max(
            0,
            Math.min(
              budget.recent,
              contextBudget(Math.min(minOutputReserve, maxOutputTokens), window).input -
                scaleEstimate(
                  estimateQuestionTokens(reducedInput.question) +
                    estimatePrefixTokens(reducedInput.prefix)
                ) -
                fixedInputTokens -
                PROMPT_OVERHEAD_TOKENS
            )
          )
          context = undefined
          continue
        }
        // 附件就绪后获取本轮信息；续写沿用原回答快照，重新生成的快照独立保存。
        // 第三方接口默认不附带快照，可用「发送上下文提醒」开关显式打开。
        const latestReminder =
          custom || !sendLatestReminder
            ? undefined
            : prepared.prefix
              ? prepared.prefix.latestReminder
              : createLatestReminder(useSettings.getState())
        reply = { ...reply, latestReminder }
        updateReply(sessionId, reply)
        persist(sessionId)
        const activeQuestion = reducedInput?.question ?? prepared.question
        const activePrefix = reducedInput ? reducedInput.prefix : prepared.prefix
        messages = toRequestMessages(
          prepared.history,
          activeQuestion,
          activePrefix,
          initial.thinking ?? false,
          latestReminder,
          inlineFiles,
          turnContext
        )
        includeContextSummary(messages, context.summary)
        estimatedInput =
          context.tokens +
          scaleEstimate(
            estimateQuestionTokens(activeQuestion) + estimatePrefixTokens(activePrefix)
          ) +
          fixedInputTokens +
          PROMPT_OVERHEAD_TOKENS
        requestMaxOutput = resolveMaxOutputTokens(
          maxOutputTokens,
          estimatedInput,
          Math.min(minOutputReserve, maxOutputTokens),
          window
        )
        const body: CreateMessageRequest = {
          model: requestModel,
          max_tokens: outputCap(requestMaxOutput),
          system: baseSystemResolved,
          messages,
          thinking: { type: initial.thinking ? 'enabled' : 'disabled' },
          ...(safetyCheck ? { safety_check: SAFETY_CHECK } : {}),
          tools: serverTools(initial.search ?? false),
          ...(effectiveTemperature !== null ? { temperature: effectiveTemperature } : {}),
          ...(effectiveTopP !== null ? { top_p: effectiveTopP } : {}),
          ...(thinkingEffort && chatConfig.format !== 'messages'
            ? { reasoning_effort: thinkingEffort }
            : {}),
          ...(autoTitle && titleRequests.has(controller) ? { title: { enabled: true } } : {}),
        }
        const events = streamChatMessage(chatConfig, apiKey, body, signal, extraHeaders)
        const blockIndexes = new Map<number, number>()
        const continuationBlockStart = reply.blocks.length
        const continuationPrefix = request.prefix ? getReplyText(request.prefix) : ''
        let continuationEcho =
          continuationPrefix.length > 0
            ? createContinuationEchoFilter(continuationPrefix)
            : null
        for await (const event of events) {
          receivedContent ||= event.type === 'content_block_start'
          if (
            event.type === 'message_delta' &&
            (event.delta.stop_reason === 'end_turn' || event.delta.stop_reason === 'max_tokens') &&
            event.delta.title?.trim() &&
            titleRequests.has(controller) &&
            !controller.signal.aborted &&
            !get().importingHistory
          ) {
            const title = event.delta.title.trim()
            updateSession(sessionId, (session) => (session.title ? session : { ...session, title }))
            titleRequests.delete(controller)
          }
          let eventToApply = event
          if (continuationEcho) {
            const filtered = filterContinuationEcho(continuationEcho, event)
            continuationEcho = filtered.filter
            if (!filtered.event) {
              continue
            }
            eventToApply = filtered.event
          }
          reply = applyEvent(reply, eventToApply, Date.now(), blockIndexes)
          if (document.visibilityState === 'hidden') {
            flush()
          } else {
            frame ||= requestAnimationFrame(flush)
          }
        }
        if (continuationEcho) {
          // 上游只回放了原文、没有新内容时，不留下一个空文本块。
          reply = {
            ...reply,
            blocks: reply.blocks.filter(
              (block, index) =>
                index < continuationBlockStart || block.type !== 'text' || block.text.trim() !== ''
            ),
          }
        }
        reply = settleLocal(reply, 'done')
        if (
          (custom || chatConfig.format !== 'messages') &&
          titleRequests.has(controller) &&
          !get().importingHistory
        ) {
          const title =
            request.question.content.trim().split(/\r?\n/, 1)[0] || request.question.files[0]?.name
          if (title) {
            const preview = Array.from(title).slice(0, 64).join('')
            updateSession(sessionId, (session) =>
              session.title ? session : { ...session, title: preview }
            )
          }
        }
        break
      } catch (error) {
        if (controller.signal.aborted) {
          reply = settleLocal(reply, 'stopped')
          break
        }
        if (preparing) {
          reply = settleLocal(reply, 'error', {
            kind: 'upload',
            message: '',
            localMessage: describeUploadError(error),
            retryable: isRetryableApiError(error),
          })
          break
        }
        // 收到过内容块（含丢弃的客户端工具）后不自动重发。
        if (!receivedContent) {
          if (isContextOverflow(error)) {
            if (
              requestMaxOutput > fallbackOutputTokens &&
              estimatedInput + requestMaxOutput >= Math.floor(windowLimit * 0.85)
            ) {
              // 高输入场景下因 max_tokens 占满窗口导致的溢出，优先缩小输出预算，不误砍历史。
              maxOutputTokens = fallbackOutputTokens
              continue
            }
            if (context?.tokens) {
              // 每次严格收紧历史预算。最后一次保留本轮输入，验证是否是输入本身过长。
              historyBudget =
                ++historyRetries < HISTORY_OVERFLOW_RETRIES ? Math.floor(context.tokens / 2) : 0
              context = undefined
              continue
            }
            if (maxOutputTokens > fallbackOutputTokens) {
              maxOutputTokens = fallbackOutputTokens
              continue
            }
            if (!reduceInput) {
              reduceInput = true
              continue
            }
            reply = settleLocal(reply, 'error', {
              kind: error.kind,
              message: error.message,
              localMessage: { key: 'replyInputTooLong' },
            })
            break
          }
          if (!custom) {
            if (
              invalidatedRetries < FILE_RETRY_LIMIT &&
              reuploadInvalidatedFiles(sessionId, attempt, error)
            ) {
              await waitForRetry(invalidatedRetries++, controller.signal)
              if (!controller.signal.aborted) {
                continue
              }
            } else if (chatConfig.format === 'messages') {
              const repaired = await Promise.race([
                stopped,
                repairRejectedImage(sessionId, attempt, messages, error, signal).catch(() => false),
              ])
              if (repaired) {
                continue
              }
            }
          }
        }
        if (controller.signal.aborted) {
          reply = settleLocal(reply, 'stopped')
          break
        }
        if (receivedContent && isContextOverflow(error)) {
          reply = settleLocal(reply, 'stopped')
        } else if (error instanceof ApiError && error.kind === 'interrupted' && reply.stopReason) {
          // 已收到 message_delta 的结束原因，只是缺了结尾的 message_stop
          reply = settleLocal(reply, 'done')
        } else if (error instanceof ApiError) {
          reply = settleLocal(reply, 'error', {
            kind: error.kind,
            message: error.message,
            status: error.status,
            localMessage: error.localMessage,
          })
        } else {
          reply = settleLocal(reply, 'error', {
            kind: 'protocol',
            message: error instanceof Error ? error.message : String(error),
          })
        }
        break
      }
    }
  } finally {
    titleRequests.delete(controller)
    streamFlushes.delete(sessionId)
    cancelAnimationFrame(frame)
    updateReply(sessionId, reply)
    set((state) => ({
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(([id]) => id !== sessionId)
      ),
    }))
    persist(sessionId)
    // 记忆在收尾时写入：正常完成和「内容已出来但被停止」都算一轮，报错不记
    const answerText = replyPlainText(reply)
    if ((reply.status === 'done' || reply.status === 'stopped') && answerText.trim()) {
      recordTurnMemory(sessionId, reply.id, request.question.content, answerText, memoryMode)
      if (!roleplayActive) {
        recordNormalCodeMemory(sessionId, reply.id, answerText)
      }
      if (sceneAutoUpdate && roleplayActive) {
        void updateSceneFromTurn(request.question.content, answerText)
      }
    }
  }
}
