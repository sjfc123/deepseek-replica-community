/* ============================================================================
 * 功能区：会话与角色核心 / store · 聊天状态机
 * 职责：聊天状态机：会话加载、请求流、历史替换、记忆写入与持久化。
 * 分区：01 状态模型与持久化基础设施；02 会话装载与历史替换；03 会话选择、分叉与增删改；04 消息发送、生成与编辑；
 *    05 记忆写入、分类与配额；06 附件上传、请求组装与流式执行
 * 关联：依赖 i18n/index、services/api/chatConfig、services/api/client、services/api/errors 等 30 个模块；
 *    被 scripts/test-content-search、scripts/test-context-compaction、scripts/test-history-merge、app/App 等 26 个模块 引用。
 * 导出：PendingMessageJump、useChatStore、setSessionSceneField、replaceSessionScene、clearSessionScene、retrySaveSessions、bindChatPersistence、initChat、MergeHistorySummary、replaceHistory、mergeHistory、newChat 等 38 项
 * 边界：只维护聊天状态机与请求生命周期；协议解析、Markdown AST 与视图样式不在本文件。
 * ========================================================================== */

import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { translate } from '../../i18n/index.js'
import { showToast } from '../../components/base/toastState.js'
import { markDataChanged } from '../dataRevision.js'
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
import {
  basicRoleplayActive,
  composeSystemPrompt,
  DEFAULT_SUPPRESSION_PERSONA,
  DEFAULT_SUPPRESSION_PERSONA_NAME,
  FALLBACK_PERSONA,
  ROLEPLAY_VIEWPOINT_REMINDER,
  SYSTEM_PROMPT,
} from './systemPrompt.js'
import { replaceUserNickname } from './nickname.js'
import { containsUrl, hasExplicitSearchRequest } from './searchIntent.js'
import {
  formatCharacterIdentity,
  formatCharacterProfile,
  resolveSystemCharacterName,
  shouldInjectCharacterProfile,
} from './characterProfile.js'
import { applyPlaceholders } from './placeholders.js'
import {
  formatCharacterCard,
  formatSceneBlock,
  formatWorldbookBlock,
  findActiveCharacterCard,
  parseSceneUpdate,
  EMPTY_SCENE,
  normalizeScene,
  sceneHasContent,
  SCENE_FIELDS,
  SCENE_LIMITS,
  selectWorldbookEntries,
  WORLDBOOK_INJECT_MAX,
  resolveTurnCharacterCard,
  type CharacterCard,
  type SceneField,
  type SceneState,
} from './roleplay.js'
import {
  activeMemoryCards,
  activeMemoryChars,
  buildConversationMemoryCards,
  buildImportantMemoryCards,
  buildNormalMemoryCards,
  buildRefinePrompt,
  buildTurnMemoryCards,
  buildTurnMemoryText,
  createMemoryCard,
  detectCodeBlock,
  detectCodeLanguage,
  filterCharacterMemoryForInjection,
  formatMemoryBlock,
  formatNormalMemoryBlock,
  getCharacterMemoryKind,
  getMemoryPool,
  isCoreMemory,
  overflowMemoryCards,
  overflowMemoryCardsByChars,
  parseRefinedCards,
  replyPlainText,
  selectMemoryCardsForInjection,
  selectNormalMemoryCardsForInjection,
  type CharacterMemoryKind,
  type ConversationMemoryDraft,
  type MemoryOwner,
  type MemoryCard,
  type MemoryPool,
  type NormalMemoryKind,
} from './memory.js'
import { removeMemoryCards, type MemoryRemovalTarget } from './memoryPrune.js'
import { memoryPoolForDisplayName, resolveMemoryDisplayName } from './memoryRouting.js'
import {
  resolveUserName,
  matchRefusalKeyword,
  clearScene,
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
  auditSessionHistory,
  cachedHistoryAudit,
  type HistoryAuditStats,
} from './historyAudit.js'
import {
  cachedTextTokens,
  contextBudget,
  estimateBranchScale,
  estimateQuestionTokens,
  prepareHistoryContext,
  resolveContextWindow,
  resolveMaxOutputTokens,
  saveContextCheckpoint,
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
  auditSystemText,
  buildPromptConfigFingerprint,
  fingerprintRequestMessages,
  fingerprintWireRequest,
  hashPromptText,
  recordPromptCacheSample,
  type SystemAudit,
} from './cacheDiagnostics.js'
import {
  advanceStoryClock,
  confirmStoryClueFromQuestion,
  createStoryState,
  detectStoryEnd,
  formatStoryTurnBlock,
  isStoryLocked,
  limitStoryAsides,
  stripStoryMarkers,
} from './story.js'
import { applyEvent, getContextRounds, settleReply, toRequestMessages } from './reply.js'
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
/** 长上下文下的最小输出下限（5% 窗口），与 5% 安全缓冲配合对齐 90% 触发线。 */
const MIN_OUTPUT_RESERVE = 52_428
const PROMPT_OVERHEAD_TOKENS = 256
const CUSTOM_OUTPUT_TOKENS = 4_096
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
/** 流式正文合帧间隔：约 15fps，兼顾观感与主线程空闲，避免每帧复制整段会话。 */
const STREAM_UI_INTERVAL_MS = 66

/** 只有明确检索才声明搜索工具；只有消息里带链接才声明读链接工具。 */
/* ---- 01 状态模型与持久化基础设施 ---- */
const serverTools = (search: boolean, readUrl: boolean) => {
  const tools: NonNullable<CreateMessageRequest['tools']> = []
  if (readUrl) {
    tools.push({ type: 'deepseek_read_url', name: 'deepseek_read_url' })
  }
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
  /** 点新对话时对上一段会话做的整段结算；running 时先显示进度，完成后填入 stats */
  historyAudit: {
    sessionId: string
    title: string
    progress: number
    stats?: HistoryAuditStats
  } | null
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
  historyAudit: null,
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
/** 已成功写入 IndexedDB 的会话对象；对象不变时重复 persist 直接跳过。 */
const persistedSessions = new WeakSet<Session>()
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
    // 同一份会话对象连续保存（例如发送前写快照后又立刻落盘）只写一次，避免大历史被重复结构化克隆。
    const files = pendingFiles.get(sessionId)
    if (persistedSessions.has(session) && !files?.length) {
      return
    }
    markDataChanged()
    unsavedSessions.add(sessionId)
    if (deletingSessions.has(sessionId)) {
      return
    }
    const epoch = historyEpoch
    void db
      .saveSession(session, files)
      .then(() => {
        if (epoch !== historyEpoch || !getSession(sessionId)) {
          return
        }
        persistedSessions.add(session)
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

/** 场景编辑只写当前会话；没有打开的会话时返回 false，不落到全局设置。 */
export const setSessionSceneField = (
  sessionId: string,
  field: SceneField,
  value: string
): boolean => {
  const session = getSession(sessionId)
  if (!session) {
    return false
  }
  const scene = normalizeScene(session.scene)
  scene[field] = value.slice(0, SCENE_LIMITS[field])
  scene.updatedAt = Date.now()
  updateSession(sessionId, (current) => ({ ...current, scene }))
  persist(sessionId)
  return true
}

/** 整体替换当前会话场景：设定存档恢复场景时使用，不写全局设置。 */
export const replaceSessionScene = (sessionId: string, scene: SceneState): boolean => {
  if (!getSession(sessionId)) {
    return false
  }
  updateSession(sessionId, (session) => ({ ...session, scene: normalizeScene(scene) }))
  persist(sessionId)
  return true
}

/** 清空当前会话场景，不影响其他会话。 */
export const clearSessionScene = (sessionId: string): boolean => {
  if (!getSession(sessionId)) {
    return false
  }
  updateSession(sessionId, (session) => ({ ...session, scene: { ...EMPTY_SCENE } }))
  persist(sessionId)
  return true
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

/* ---- 02 会话装载与历史替换 ---- */
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
    // 深度思考按用户开关透传；智能搜索仍只对默认端点开放，自定义端点不注入 DeepSeek 专用工具。
    thinking,
    search: !customEndpoint && search,
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
      const loaded = await db.loadSessionSummaries()
      const summaries = [...loaded]
      // 功能区：会话与角色核心 / 旧摘要角色回填。只按卡名筛候选，最终仍以完整会话的
      // characterId 为准，标题相同但未绑卡的普通会话不会被误分组。
      const cardNames = useSettings
        .getState()
        .characterCards.map((card) => card.name.trim())
        .filter(Boolean)
      const candidates = loaded.filter((summary) => {
        if (summary.characterId || !summary.title) {
          return false
        }
        const title = summary.title.trim()
        return cardNames.some((name) => title === name || title.startsWith(`${name} ·`))
      })
      for (const summary of candidates) {
        try {
          const session = await db.loadSession(summary.id)
          const characterId = session?.characterId
          if (!characterId) {
            continue
          }
          const index = summaries.findIndex((item) => item.id === summary.id)
          if (index < 0 || summaries[index].characterId === characterId) {
            continue
          }
          summaries[index] = { ...summaries[index], characterId }
          void db
            .saveSession(session)
            .catch(db.reportStorageError('repair session character binding'))
        } catch (error) {
          db.reportStorageError('read session for character repair')(error)
        }
      }
      // 升级兼容：旧版只有一份全局场景。把它挂到最近一条有消息的旧会话上再清空全局草稿，
      // 这样旧对话还能接上原来的时间与物件，新对话仍然是空白。
      const legacyScene = useSettings.getState().scene
      if (sceneHasContent(legacyScene)) {
        let legacySceneMoved = false
        const ordered = [...summaries].sort((a, b) => b.updatedAt - a.updatedAt)
        for (const summary of ordered.slice(0, 5)) {
          if (epoch !== historyEpoch) {
            break
          }
          try {
            const candidate = await db.loadSession(summary.id)
            if (!candidate) {
              continue
            }
            // 已经带会话场景的会话说明新版已经写过，旧全局草稿属于历史残留，直接丢弃。
            if (candidate.scene) {
              legacySceneMoved = true
              break
            }
            if (candidate.messages.length === 0) {
              continue
            }
            await db.saveSession({ ...candidate, scene: normalizeScene(legacyScene) })
            legacySceneMoved = true
            break
          } catch (error) {
            db.reportStorageError('migrate legacy scene')(error)
          }
        }
        // 写盘成功才清全局；失败时保留草稿，下次启动再试，也不会被新会话读取。
        if (legacySceneMoved && epoch === historyEpoch) {
          clearScene()
        }
      }
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
      const nextSummary = toSessionSummary(session)
      set((state) => ({
        sessionCache: { ...state.sessionCache, [id]: session },
        // 旧版摘要没有 characterId；打开会话时顺手补回，侧栏之后就能进入对应角色分组。
        sessions: state.sessions.map((item) =>
          item.id === id && item.characterId !== nextSummary.characterId ? nextSummary : item
        ),
      }))
      if (session !== stored || summary.characterId !== nextSummary.characterId) {
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
    markDataChanged()
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
      // 提交失败时恢复之前取消的详情读取，避免界面停在空详情。
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
    markDataChanged()
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


/* ---- 03 会话选择、分叉与增删改 ---- */
/** 上一段会话的整段结算：结果按会话版本缓存，重复点新对话不重复遍历。 */
const startHistoryAudit = (session: Session) => {
  if (getVisibleMessages(session).length === 0) {
    return
  }
  const cached = cachedHistoryAudit(session)
  if (cached) {
    set({
      historyAudit: { sessionId: session.id, title: session.title, progress: 1, stats: cached },
    })
    return
  }
  set({ historyAudit: { sessionId: session.id, title: session.title, progress: 0 } })
  void auditSessionHistory(session, (done, total) => {
    set((state) =>
      state.historyAudit?.sessionId === session.id
        ? {
            historyAudit: {
              ...state.historyAudit,
              progress: total > 0 ? done / total : 1,
            },
          }
        : state
    )
  })
    .then((stats) => {
      set((state) =>
        state.historyAudit?.sessionId === session.id
          ? { historyAudit: { ...state.historyAudit, progress: 1, stats } }
          : state
      )
    })
    .catch(() => {
      set((state) => (state.historyAudit?.sessionId === session.id ? { historyAudit: null } : state))
    })
}

/** 关闭历史结算面板；只影响展示，不影响会话数据。 */
export const dismissHistoryAudit = () => set({ historyAudit: null })

export const newChat = () => {
  if (get().importingHistory) {
    return
  }
  cancelMessageEdit()
  // 先在切走前抓住当前会话：结算要覆盖首条到末条，切到欢迎页后再读就拿不到完整快照了。
  const outgoing = get().activeId ? getSession(get().activeId as string) : undefined
  // 场景跟随会话：新对话从空白开始，先把旧版全局场景草稿清掉，避免上一段的物件和关系被带进来。
  clearScene()
  // 开启角色卡时，“开启新对话”也走开场流程：新会话立即绑定该卡并写入剧情说明与开场白。
  // 否则直接从新对话发第一条，会绕过 startCharacterIntro，推理卡只剩半截剧情。
  const settings = useSettings.getState()
  const card = settings.roleplayEnabled
    ? findActiveCharacterCard(settings.characterCards, settings.activeCharacterId)
    : undefined
  if (card) {
    const created = startCharacterIntro(card)
    if (created) {
      set({ pendingJump: null })
      trimSessionCache()
      showToast({ key: 'newChatWithCard', params: { name: card.name } })
      if (outgoing) {
        startHistoryAudit(outgoing)
      }
      return
    }
  }
  set({ activeId: null, pendingJump: null })
  trimSessionCache()
  if (outgoing) {
    startHistoryAudit(outgoing)
  }
}

/**
 * 把当前分支整段复制成一个新对话，两边各自继续，互不影响。
 * 消息 ID 全部换新，避免之后合并历史时被当成同一条消息；记忆卡片、附件引用、分支结构原样带过去。
 */
export const forkSession = async (sessionId: string, title?: string): Promise<string | null> => {
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
  const messages = path.map((message, index) => {
    const id = idMap.get(message.id)
    if (!id) {
      throw new Error('复制会话失败：消息 ID 映射缺失')
    }
    return {
      ...message,
      id,
      parentId: index === 0 ? null : (idMap.get(path[index - 1].id) ?? null),
      selectedChildId: index === path.length - 1 ? undefined : idMap.get(path[index + 1].id),
      memories: message.memories ? message.memories.map((card) => ({ ...card })) : undefined,
    }
  })
  const next: Session = {
    id: createId(),
    // 用户填了名字就用原名；留空沿用旧规则，在原会话名后追加分支后缀。
    title:
      title?.trim() ||
      `${source.title || translate('untitledChat')} · ${translate('sessionForkSuffix')}`,
    createdAt: now,
    updatedAt: now,
    messages,
    rootMessageId: messages[0].id,
    characterId: source.characterId,
    scene: source.scene ? normalizeScene(source.scene) : { ...EMPTY_SCENE },
    storyClockMinute: source.storyClockMinute,
    storyState: source.storyState,
    storyFinalTurn: source.storyFinalTurn,
    storyClueIds: source.storyClueIds ? [...source.storyClueIds] : undefined,
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

/** 玩家看过线索链弹窗后清掉一次性提示；线索本身仍保留在 storyClueIds 里。 */
export const acknowledgeStoryClue = (sessionId: string) => {
  const current = getSession(sessionId)
  if (!current?.storyClueNotice) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    storyClueNotice: undefined,
    updatedAt: Date.now(),
  }))
  persist(sessionId)
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
    markDataChanged()
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

/* ---- 04 消息发送、生成与编辑 ---- */
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
      scene: { ...EMPTY_SCENE },
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
  const settingsNow = useSettings.getState()
  const turnCard = resolveTurnCharacterCard(
    settingsNow.characterCards,
    current,
    settingsNow.activeCharacterId,
    settingsNow.roleplayEnabled
  )
  const history = getVisibleMessages(current)
  // 结局已定就锁死发送；停在 00:00 但没有收到结束标记的会话也在下一次发送时补齐失败态。
  if (turnCard?.story) {
    if (isStoryLocked(current)) {
      return false
    }
    if (
      (current.storyState === 'active' || current.storyState === undefined) &&
      (current.storyClockMinute ?? turnCard.story.startMinute) >= turnCard.story.deadlineMinute
    ) {
      updateSession(sessionId, (session) => ({
        ...session,
        storyState: 'bad_end',
        storyFinalTurn: false,
        updatedAt: now,
      }))
      persist(sessionId)
      return false
    }
  }
  const storyFields =
    turnCard?.story && current.storyState !== 'bad_end' && current.storyState !== 'good_end'
      ? current.storyState === 'active'
        ? advanceStoryClock(turnCard.story, current)
        : {
            ...createStoryState(turnCard.story),
            ...advanceStoryClock(turnCard.story, {
              ...current,
              ...createStoryState(turnCard.story),
            }),
          }
      : {}
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
    characterId: turnCard?.id ?? session.characterId,
    ...storyFields,
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
 * 启用带开场白的角色卡时调用：把开场白作为一条已完成的助手消息写入会话，
 * 并把 card.id 写入会话绑定。当前会话已有历史时新建会话，避免开场白插进旧对话。
 */
export const startCharacterIntro = (
  card: Pick<CharacterCard, 'id' | 'name' | 'greeting' | 'story'>
): string | null => {
  const text = card.greeting.trim()
  const name = card.name.trim()
  if (!text || !name || get().importingHistory || !get().ready) {
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
      characterId: card.id,
      scene: { ...EMPTY_SCENE },
      ...(card.story ? createStoryState(card.story) : {}),
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
  const opener: AssistantMessage = {
    id: createId(),
    role: 'assistant',
    createdAt: now,
    model: chatConfig.model || DEFAULT_CHAT_MODEL,
    status: 'done',
    blocks: [{ type: 'text', text }],
  }
  // 限时推理卡把剧情说明放成模板旁白：只展示一次、不进上下文，随后才是妹妹的第一条消息。
  const introText = card.story?.intro.trim()
  const intro: AssistantMessage | null = introText
    ? {
        id: createId(),
        role: 'assistant',
        createdAt: now,
        model: chatConfig.model || DEFAULT_CHAT_MODEL,
        status: 'done',
        blocks: [{ type: 'text', text: introText, isTemplate: true }],
        selectedChildId: opener.id,
      }
    : null
  if (intro) {
    opener.parentId = intro.id
  }
  updateSession(sessionId, (session) => ({
    ...session,
    title: session.title || name,
    messages: intro ? [intro, opener] : [opener],
    rootMessageId: intro ? intro.id : opener.id,
    updatedAt: now,
    characterId: card.id,
    scene: { ...EMPTY_SCENE },
    ...(card.story ? createStoryState(card.story) : {}),
  }))
  persist(sessionId)
  return sessionId
}

/**
 * 语音通话专用提交：文本直接来自 ASR，不读草稿、不占草稿状态。
 * 返回新建会话与回复的 id，通话界面据此订阅流式正文。
 */
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
      scene: { ...EMPTY_SCENE },
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
  const settingsNow = useSettings.getState()
  const turnCard = resolveTurnCharacterCard(
    settingsNow.characterCards,
    current,
    settingsNow.activeCharacterId,
    settingsNow.roleplayEnabled
  )
  const history = getVisibleMessages(current)
  if (turnCard?.story) {
    if (isStoryLocked(current)) {
      return null
    }
    if (
      (current.storyState === 'active' || current.storyState === undefined) &&
      (current.storyClockMinute ?? turnCard.story.startMinute) >= turnCard.story.deadlineMinute
    ) {
      updateSession(sessionId, (session) => ({
        ...session,
        storyState: 'bad_end',
        storyFinalTurn: false,
        updatedAt: now,
      }))
      persist(sessionId)
      return null
    }
  }
  const storyFields =
    turnCard?.story && current.storyState !== 'bad_end' && current.storyState !== 'good_end'
      ? current.storyState === 'active'
        ? advanceStoryClock(turnCard.story, current)
        : {
            ...createStoryState(turnCard.story),
            ...advanceStoryClock(turnCard.story, {
              ...current,
              ...createStoryState(turnCard.story),
            }),
          }
      : {}
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
    characterId: turnCard?.id ?? session.characterId,
    ...storyFields,
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
  if (!session || getStreamController(sessionId) || isStoryLocked(session)) {
    return
  }
  const path = getVisibleMessages(session)
  const index =
    messageId === undefined ? path.length - 1 : path.findIndex((m) => m.id === messageId)
  const question = path[index - 1]
  const target = path[index]
  if (question?.role !== 'user' || target?.role !== 'assistant') {
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
  // 重新生成必须复用原回答的信息快照，不能重新取当前时间/地点，
  // 否则同一条问题在跨日或切换定位后会产生不同的请求前缀，缓存从提醒处断开。
  void streamReply(sessionId, reply, {
    history,
    question,
    latestReminder: target.latestReminder,
    reuseLatestReminder: true,
  })
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
  if (!session || getStreamController(sessionId) || isStoryLocked(session)) {
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
 * 删除助手回复时级联删除该回复之后的问答对，保留触发本次回复的用户提问。
 * 同一提问下若仍有其他回答版本，删除后自动切换到剩余版本。
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

/** 附件补传失败后重试：保留原回答位置，重新补传并请求 */
/** 提炼请求的固定提示：只输出清单，每行一条，便于解析 */
const MEMORY_REFINE_SYSTEM =
  '你是长期记忆整理助手。把已有记忆与最新一轮对话合并成一份简洁的长期记忆清单，每行一条，' +
  '去掉重复、寒暄和一次性内容，保留称呼、关系、偏好、约定与关键事件。' +
  '只输出清单本身，不要编号以外的任何解释。'

/** 将卡片挂载到生成它的消息上；无法挂载则丢弃，不影响其他轮次 */

/* ---- 05 记忆写入、分类与配额 ---- */
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
      // 完整回合卡会让同一轮旧的自动截断卡、提炼汇总卡让位；场景/事实摘录不动原回合。
      const keepsTurn = cards.some((card) => !isCoreMemory(card))
      const archived = (message.memories ?? []).map((card) =>
        keepsTurn &&
        (card.source === 'auto' || card.source === 'refine') &&
        !card.pinned &&
        !card.superseded
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

/**
 * 记忆正文的说话人名字：玩家用账号名，角色优先用当前会话卡名；
 * 两者都没有时回退到内置青梅竹马或「玩家 / 角色」，避免长期记忆继续写泛称「用户」。
 */
const memoryNames = (sessionId: string): { userName: string; characterName: string } => {
  const settings = useSettings.getState()
  const session = getSession(sessionId)
  const card = resolveTurnCharacterCard(
    settings.characterCards,
    session,
    settings.activeCharacterId,
    settings.roleplayEnabled
  )
  const displayName = resolveMemoryDisplayName({
    cardName: card?.name,
    characterName: settings.characterName,
    custom: Boolean(settings.chatConfig.endpoint),
  })
  return {
    userName: resolveUserName(),
    characterName:
      memoryPoolForDisplayName(displayName) === 'character'
        ? displayName
        : DEFAULT_SUPPRESSION_PERSONA_NAME,
  }
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
        entry.card.source !== 'manual' &&
        entry.card.source !== 'bulk' &&
        !entry.card.pinned &&
        !isCoreMemory(entry.card)
    )
    .map((entry) => entry.card)
    .slice(-30)
  let text = ''
  const names = memoryNames(sessionId)
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
            content: buildRefinePrompt(
              cards,
              question,
              answer,
              names.userName,
              names.characterName
            ),
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
  const refined = lines.map((line) =>
    createMemoryCard(line.text, 'refine', undefined, {
      owner: line.owner,
    })
  )
  updateSession(sessionId, (current) => ({
    ...current,
    messages: current.messages.map((message) => {
      if (!visibleIds.has(message.id)) {
        return message
      }
      // 手写卡、整段保存的完整卡、置顶卡、重要场景/关键事实和普通记忆都由用户自己维护，
      // 自动提炼只能替换普通自动回合卡，不能把 scene/fact 一起标成 superseded。
      const archived = (message.memories ?? []).map((card) =>
        card.superseded ||
        card.source === 'manual' ||
        card.source === 'bulk' ||
        card.pinned ||
        isCoreMemory(card) ||
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
  const overflow = overflowMemoryCards(session, getVisibleMessages(session), limit, pool)
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
  const overflow = overflowMemoryCardsByChars(session, getVisibleMessages(session), limit, pool)
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

const SCENE_UPDATE_SYSTEM = `你负责维护角色扮演的场景状态。根据最近一轮对话，判断下面这些字段是否发生变化。
只输出字段行，没有变化的字段写“不变”；不要解释，不要写分析，不要用列表符号，不要编造对话里没有的信息。
${SCENE_FIELDS.map((field) => `${field.label}：...`).join('\n')}`

/** 把当前场景按字段摊平，空值写“未记录”，供自动更新请求使用 */
const sceneUpdateSnapshot = (scene: SceneState) =>
  SCENE_FIELDS.map((field) => `${field.label}：${scene[field.key].trim() || '未记录'}`).join('\n')

/** 自动场景更新：多发一次很小的请求；失败就保持原场景，不影响聊天 */
const updateSceneFromTurn = async (sessionId: string, question: string, answer: string) => {
  const { chatConfig, apiKey: key, customHeaders } = useSettings.getState()
  const apiKey = key ?? ''
  if (!apiKey && !chatConfig.endpoint) {
    return
  }
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  const scene = session.scene ? normalizeScene(session.scene) : { ...EMPTY_SCENE }
  let text = ''
  try {
    const events = streamChatMessage(
      chatConfig,
      apiKey,
      {
        model: chatConfig.model || DEFAULT_CHAT_MODEL,
        max_tokens: 360,
        system: SCENE_UPDATE_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `【当前场景】\n${sceneUpdateSnapshot(scene)}\n\n【最近一轮】\n用户：${question}\n角色：${answer.slice(0, 1200)}`,
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
        if (text.length > 2400) {
          break
        }
      }
    }
  } catch {
    return
  }
  const latest = getSession(sessionId)
  if (!latest) {
    return
  }
  const current = latest.scene ? normalizeScene(latest.scene) : { ...EMPTY_SCENE }
  const next = parseSceneUpdate(text, current)
  if (next === current) {
    return
  }
  updateSession(sessionId, (target) => ({ ...target, scene: next }))
  persist(sessionId)
  window.dispatchEvent(new CustomEvent('replica:scene-updated', { detail: next }))
}

/** 自动记忆入口：整轮记录先落盘，提炼模式下再异步重写这一份 */
const recordTurnMemory = (
  sessionId: string,
  targetMessageId: string,
  question: string,
  answer: string,
  mode: 'off' | 'turn' | 'refine',
  pool: MemoryPool
) => {
  if (mode === 'off') {
    return
  }
  // 普通记忆总开关关闭时不再写普通池，避免面板显示“已关闭”却持续产生新卡。
  if (pool === 'normal' && !useSettings.getState().normalMemoryEnabled) {
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
  const relationship = session.scene?.relationship.trim() || ''
  const meta = {
    at,
    turnIndex: turnIndex > 0 ? turnIndex : undefined,
    relationship: relationship || undefined,
  }
  // 角色池把这一轮拆成玩家提问与角色回应两张，各自带归属；普通池仍是一张对话卡。
  const names = memoryNames(sessionId)
  const cards =
    pool === 'character'
      ? buildTurnMemoryCards(question, answer, { ...meta, ...names }).map((part) =>
          createMemoryCard(part.text, 'auto', at, {
            owner: part.owner,
            speaker: part.speaker,
          })
        )
      : (() => {
          const text = buildTurnMemoryText(question, answer, meta)
          if (!text) {
            return []
          }
          const category = detectCodeBlock(answer) ? 'code' : 'dialogue'
          return [
            createMemoryCard(text, 'auto', at, {
              category,
              ...(category === 'code' ? { language: detectCodeLanguage(answer) } : {}),
            }),
          ]
        })()
  if (!attachMemories(sessionId, target, cards)) {
    return
  }
  enforceMemoryLimit(sessionId, pool)
  enforceMemoryChars(sessionId, pool)
  if (pool === 'character' && mode === 'refine') {
    void refineMemories(sessionId, target, question, answer)
  } else {
    notifyMemoryAdded(sessionId, 'turn')
  }
}

/**
 * 记忆落池只看当前显示名：AI / DeepSeek 走普通池，角色名走角色池。
 * 角色卡名优先，其次手写档案名；提示词清空时回到官方助手，一律写普通池。
 * 这样会话绑定卡、只填档案名和普通问答都不会再被默认写成角色记忆。
 */
const usesCharacterMemory = (sessionId?: string) => {
  const settings = useSettings.getState()
  const prompt = settings.systemPrompt.trim()
  const session = sessionId ? getSession(sessionId) : null
  const promptBound =
    settings.promptSessionIds === null || settings.promptSessionIds.includes(sessionId ?? '')
  const personaBound =
    settings.personaSessionIds === null || settings.personaSessionIds.includes(sessionId ?? '')
  // 系统提示词只在被选中的会话生效；开关关闭或未绑定时视同空提示词，与主请求装配保持同一口径。
  const handwrittenActive = settings.systemPromptEnabled && Boolean(prompt) && promptBound
  const promptEmpty = !handwrittenActive
  const promptDefault = prompt === SYSTEM_PROMPT
  const card = resolveTurnCharacterCard(
    settings.characterCards,
    session,
    settings.activeCharacterId,
    settings.roleplayEnabled
  )
  const sessionHasMessages = (session?.messages.length ?? 0) > 0
  const personaConfigured = Boolean(
    settings.suppressionPersonaEnabled &&
      settings.basicRoleplayEnabled &&
      settings.suppressionPersona.trim()
  )
  const personaExplicit = settings.personaSessionIds !== null
  const personaActive = (personaExplicit || !sessionHasMessages) && personaBound && personaConfigured && !card
  // 空提示词或默认提示词 + 基础扮演模式：没有角色卡也按基础角色扮演写角色记忆。
  const suppressionActive =
    personaActive ||
    basicRoleplayActive({
      basicRoleplayEnabled: settings.basicRoleplayEnabled,
      promptEmpty,
      promptIsDefault: promptDefault,
      hasActiveCard: Boolean(card),
    })
  if (suppressionActive) {
    return true
  }
  if (promptEmpty) {
    return false
  }
  const displayName = resolveMemoryDisplayName({
    cardName: card?.name,
    characterName: settings.characterName,
    custom: Boolean(settings.chatConfig.endpoint),
  })
  return memoryPoolForDisplayName(displayName) === 'character'
}

/**
 * 普通代码记忆自动入库：回复里出现三连反引号代码块时自动存一张普通-代码卡。
 * 只在非角色扮演场景生效；同一条回复只记一次，用户仍可在保存弹窗里手动选择其它分类。
 */
const recordNormalCodeMemory = (sessionId: string, targetMessageId: string, answer: string) => {
  if (
    usesCharacterMemory(sessionId) ||
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
    (card) => getMemoryPool(card) === 'normal' && card.category === 'code' && !card.superseded
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

/** 面板里手动加一条：挂到当前分支第一条消息上，重新生成和继续对话都不会把它切掉 */
export const addManualMemory = (
  sessionId: string,
  text: string,
  target: {
    pool?: MemoryPool
    category?: NormalMemoryKind
    memoryKind?: CharacterMemoryKind
    owner?: MemoryOwner
    trigger?: string
    proactive?: boolean
    pinned?: boolean
  } = {}
) => {
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  // 手动记忆属于整段会话，不挂在最后一轮回答上：
  // 重新生成会换掉最后一条回答，挂在上面会让刚记下的内容在新分支里消失。
  const anchor = getVisibleMessages(session)[0]
  if (!anchor || !text.trim()) {
    return
  }
  const pool: MemoryPool = usesCharacterMemory(sessionId)
    ? 'character'
    : target.pool === 'normal'
      ? 'normal'
      : 'character'
  const category = pool === 'normal' ? (target.category ?? 'dialogue') : undefined
  const memoryKind = pool === 'character' ? (target.memoryKind ?? 'turn') : undefined
  const language = pool === 'normal' && category === 'code' ? detectCodeLanguage(text) : undefined
  const owner = pool === 'character' ? (target.owner ?? 'shared') : undefined
  if (
    attachMemories(sessionId, anchor.id, [
      createMemoryCard(text, 'manual', undefined, {
        pool,
        category,
        language,
        memoryKind,
        owner,
        trigger: target.trigger,
        proactive: target.proactive,
        pinned: target.pinned,
      }),
    ])
  ) {
    enforceMemoryChars(sessionId, pool)
    notifyMemoryAdded(sessionId, 'manual')
  }
}

export type SaveConversationMemoryResult = {
  /** 本次写入的完整回合卡片数 */
  created: number
  /** 已经存在整段卡片的轮次，不重复写入 */
  skipped: number
  /** 写完后仍在生效的卡片数 */
  active: number
  /** 写完后仍在生效的总字数 */
  chars: number
}

export type MemorySaveTarget =
  | {
      pool: 'character'
      /** 缺省保存完整回合；重要场景 / 关键事实会单独成卡 */
      kind?: CharacterMemoryKind
      /** 重要场景或关键事实的正文；界面里可先改再存 */
      content?: string
      /** 这批卡片属于谁；缺省按共同经历 */
      owner?: MemoryOwner
    }
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
  const session = getSession(sessionId)
  if (!session) {
    return empty
  }
  const pool: MemoryPool = usesCharacterMemory(sessionId) ? 'character' : target.pool
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
  const importantKind: Exclude<CharacterMemoryKind, 'turn'> | undefined =
    pool === 'character' && target.pool === 'character' && target.kind && target.kind !== 'turn'
      ? target.kind
      : undefined
  const importantContent = target.pool === 'character' ? target.content : undefined
  const owner = pool === 'character' && target.pool === 'character' ? target.owner : undefined
  const drafts: ConversationMemoryDraft[] =
    pool === 'normal'
      ? buildNormalMemoryCards(
          picked,
          target.pool === 'normal' ? (target.category ?? 'auto') : 'auto'
        )
      : importantKind
        ? buildImportantMemoryCards(picked, importantKind, importantContent)
        : buildConversationMemoryCards(
            picked,
            startTurn,
            (user, assistant) => indexById.get(assistant.id) === (indexById.get(user.id) ?? -2) + 1,
            { split: pool === 'character', ...memoryNames(sessionId) }
          )
  const ownedDrafts = owner
    ? drafts.map((draft) => ({ ...draft, card: { ...draft.card, owner } }))
    : drafts
  // 整段卡按消息去重；重要场景 / 关键事实按“同一消息 + 同类型 + 同正文”去重，
  // 允许在同一轮里保存多个不同场景，也允许场景与完整回合并存。
  const alreadyBulk = new Set(
    session.messages
      .filter((message) =>
        (message.memories ?? []).some(
          (card) =>
            card.source === 'bulk' &&
            getMemoryPool(card) === pool &&
            getCharacterMemoryKind(card) === 'turn'
        )
      )
      .map((message) => message.id)
  )
  const fresh = importantKind
    ? ownedDrafts.filter((draft) => {
        const targetMessage = session.messages.find((message) => message.id === draft.messageId)
        return !(targetMessage?.memories ?? []).some(
          (card) =>
            !card.superseded &&
            getCharacterMemoryKind(card) === importantKind &&
            card.text === draft.card.text
        )
      })
    : ownedDrafts.filter((draft) => !alreadyBulk.has(draft.messageId))
  const skipped = ownedDrafts.length - fresh.length
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
    messages: removeMemoryCards(session.messages, [{ messageId, cardId }]),
  }))
  persist(sessionId)
}

/** 按当前面板可见的目标精确清空；不按分类扫描，避免误删同分类其他卡片 */
export const clearMemoryCards = (sessionId: string, targets: MemoryRemovalTarget[]) => {
  if (targets.length === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: removeMemoryCards(session.messages, targets),
  }))
  persist(sessionId)
}


/* ---- 06 附件上传、请求组装与流式执行 ---- */
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

type Request = {
  history: Message[]
  question: UserMessage
  /** 重新生成时沿用的原轮信息快照；普通新回复不传，由本轮重新生成 */
  latestReminder?: string
  /** 明确要求复用快照，即使快照为空也不重新生成，保证重新生成的请求前缀一致 */
  reuseLatestReminder?: boolean
}

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
    ...request,
    history: request.history.map(pick),
    question: pick(request.question),
  }
}

/**
 * 发送前补齐附件的 serverId。
 * - 本轮提问的附件并行补齐，任一失败则整体失败，已成功的照常写回，重试时复用成功结果；
 * - 历史轮次（仅进入上下文的）中没有 serverId 的附件，多为导入的图片：从最新的消息往前逐张补传，
 *   任一张失败则中止本次发送，并在错误里列出附件名与原因，避免上下文缺少图片却无提示。
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
  const attachmentFailures: string[] = []
  for (const file of pending.values()) {
    signal.throwIfAborted()
    try {
      const result = await Promise.race([ensureServerId(apiKey, file), aborted])
      if (result) {
        saveUploadedFiles(sessionId, new Map([[file.id, result]]))
      }
      // result 为 null：本地已无原件（多为导入会话包 / 清理后残留的附件元数据）。
      // 这类附件只在界面展示、不进入请求（与 toFileBlocks 口径一致），不阻断本轮对话；
      // 只有原件存在但补传真正报错时才计入失败并中止发送。
    } catch (error) {
      signal.throwIfAborted()
      attachmentFailures.push(
        `${file.name}：${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  if (attachmentFailures.length > 0) {
    throw new Error(
      `历史附件未能补传：${attachmentFailures.join('；')}。请在输入框重新发送这些附件后再试。`
    )
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
    promptSessionIds,
    personaSessionIds,
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
    basicRoleplayEnabled,
    suppressionPersonaEnabled,
    suppressionPersona: storedSuppressionPersona,
    memoryMode,
    memoryLimit,
    memoryChars,
    normalMemoryEnabled,
    normalMemoryLimit,
    normalMemoryChars,
    characterCards,
    activeCharacterId,
    characterName,
    characterProfile,
    profileEnabled,
    friendlyTone,
    defaultPromptEnabled,
    systemPromptEnabled,
    roleplayEnabled,
    worldbook,
    worldbookInject,
    worldbookChars,
    sceneAutoUpdate,
  } = useSettings.getState()
  const apiKey = storedKey ?? ''
  const custom = Boolean(chatConfig.endpoint)
  // 系统提示词必须随每次请求下发：自定义网关同样需要 system 字段，缺失时模型无表达约束。
  // 手写文本原样使用，`{{user}}` 只在发请求时换成账号名字；打开出戏压制时再在后面追加演出规则。
  // 系统提示词为空是用户主动清空：回到默认官方助手，并停用角色卡、档案与身份行。
  // 否则残留的角色身份会单独留在 system，默认助手会被带成冷淡角色。
  const promptRawEmpty = !systemPrompt.trim()
  const promptIsDefault = !promptRawEmpty && systemPrompt.trim() === SYSTEM_PROMPT
  const sessionForMemory = getSession(sessionId)
  // 提示词按会话绑定：null 是旧版未迁移记录，暂按全部继承；显式数组只覆盖选中会话。
  const promptBound = promptSessionIds === null || promptSessionIds.includes(sessionId)
  const personaBound = personaSessionIds === null || personaSessionIds.includes(sessionId)
  const personaConfigured = Boolean(
    suppressionPersonaEnabled && basicRoleplayEnabled && storedSuppressionPersona.trim()
  )
  // 手写系统提示词开关关闭或未绑定到本会话时视同空提示词：文本保留在本机，但不注入、不参与身份判定；
  // 各可写提示词同级互斥，关闭哪一条就停止发送哪一条，避免两段身份在 system 里打架。
  const handwrittenPromptActive = systemPromptEnabled && !promptRawEmpty && promptBound
  // 场景按会话取；旧会话没有快照就按空场景处理，不从全局设置补，避免旧物件跨新对话。
  const sessionScene = sessionForMemory?.scene
    ? normalizeScene(sessionForMemory.scene)
    : { ...EMPTY_SCENE }
  const visibleForRoleplay = sessionForMemory ? getVisibleMessages(sessionForMemory) : []
  const sessionHasMessages = visibleForRoleplay.length > 0
  const resolvedCard = resolveTurnCharacterCard(
    characterCards,
    sessionForMemory,
    activeCharacterId,
    roleplayEnabled
  )
  // 显式绑定的自定义预设对选中会话生效；遗留的全局旧记录仍只作用于空白新会话，实体角色卡优先。
  const personaExplicit = personaSessionIds !== null
  const personaActive = (personaExplicit || !sessionHasMessages) && personaBound && personaConfigured && !resolvedCard
  const effectiveHandwrittenActive = handwrittenPromptActive && !personaActive
  const activeCard = effectiveHandwrittenActive ? resolvedCard : undefined
  const promptEmpty = !effectiveHandwrittenActive
  const promptIsCustom = effectiveHandwrittenActive && !promptIsDefault
  // 内置基础扮演只用于空白新会话；已有历史的会话不被全局内置预设反向覆盖，避免污染既有角色。
  const suppressionActive =
    personaActive ||
    (!sessionHasMessages &&
      basicRoleplayActive({
        basicRoleplayEnabled,
        promptEmpty,
        promptIsDefault,
        hasActiveCard: Boolean(activeCard),
      }))
  const roleplayActive = suppressionActive || (!promptEmpty && Boolean(activeCard))
  // 记忆落池按显示名判断，不跟角色卡开关绑定：显示 AI / DeepSeek 走普通池，
  // 显示角色名（卡名或手写档案名）走角色池，避免普通问答被默认写成角色剧情。
  // 压制设定接管空/默认提示词时，这一轮属于基础角色扮演，写角色记忆。
  const memoryPool: MemoryPool = suppressionActive
    ? 'character'
    : promptEmpty
      ? 'normal'
      : memoryPoolForDisplayName(
        resolveMemoryDisplayName({
          cardName: activeCard?.name,
          characterName,
          custom,
        })
      )
  const characterMemoryActive = memoryPool === 'character'
  const selectedMemoryEntries =
    memoryMode === 'off' || !sessionForMemory
      ? []
      : selectMemoryCardsForInjection(
          sessionForMemory,
          visibleForRoleplay,
          memoryLimit,
          request.question.content
        )
  // 角色记忆只服务于角色名上下文；普通问答不再召回角色剧情。
  const memoryCards = characterMemoryActive
    ? filterCharacterMemoryForInjection(selectedMemoryEntries, true).map((entry) => entry.card)
    : []
  // 普通记忆只在显示名仍是 AI / DeepSeek 时注入，避免角色剧情与开发问答互相污染。
  const normalCards =
    normalMemoryEnabled && sessionForMemory && !characterMemoryActive
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
  const sessionText = [
    request.question.content,
    ...visibleForRoleplay.map((message) =>
      message.role === 'assistant' ? replyPlainText(message) : message.content
    ),
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
          activeCard?.id ?? null,
          sessionText
        )
      : []
  const userName = resolveUserName()
  // 插入位置分两段：默认贴人物设定之前当背景，标了 tail 的接在提示词之后，离当前发言最近
  const worldBefore = worldEntries.filter((entry) => entry.position !== 'tail')
  const worldAfter = worldEntries.filter((entry) => entry.position === 'tail')
  // system 只放跨轮稳定的内容。缓存按完整前缀命中，system 里哪怕只变一张记忆卡，
  // 后面的全部历史都会失效；记忆、场景和按关键词挑出的世界书因此统一挪到本轮末尾。
  // 卡内开场白也固定在 system：不按消息条数删，是否重复由卡内“只用一次”的文案约束。
  // 有当前人物卡时以卡为准；没有卡且档案开关开启时，才用手写基础档案，避免两套身份在同一段 system 里打架。
  // 档案关闭后不再读取档案里的身份、经历和关系；非空档案名会走下面的轻量身份行。
  const profileSystem = shouldInjectCharacterProfile({
    profileEnabled,
    hasActiveCard: Boolean(activeCard),
    profile: characterProfile,
  })
    ? formatCharacterProfile({
        profile: characterProfile,
        name: characterName,
        userName,
      })
    : ''
  // 压制设定打开且提示词为空/默认时：已填基础档案就沿用档案；档案为空则给内置青梅竹马。
  // 自定义预设在绑定会话内整段替换内置预设。
  const suppressionPersona =
    personaActive && storedSuppressionPersona.trim()
      ? storedSuppressionPersona.trim()
      : DEFAULT_SUPPRESSION_PERSONA
  // 档案关闭或为空时不读取整份档案，但仍保留姓名这一条身份展示；
  // 角色卡已提供姓名时直接使用卡内值，不再追加档案姓名。
  const identitySystem =
    !activeCard && !profileSystem
      ? formatCharacterIdentity({
          name: characterName,
          userName,
        })
      : ''
  // 系统提示词与基础扮演预设同级互斥，避免两段身份在同一段 system 里左右互搏：
  // - 基础扮演接管时，手写系统提示词不进入 system（compose 收到空提示词），只保留预设/档案身份；
  // - 反过来，存在非默认系统提示词时 basicRoleplayActive 已返回 false，预设不会注入。
  // 互斥只作用于身份来源；角色卡、档案、世界书、场景、记忆等既有设定仍按既有优先级叠加。
  // 默认提示关闭、又没有系统提示词/角色卡/档案/基础扮演时，用内置兜底人设代替默认官方助手，
  // 避免不发送默认提示词后模型回退成预设客服助手。
  // 兜底人设同样只补空白新会话；已有历史角色由历史消息、角色卡、档案或绑定提示词延续，不被内置兜底覆盖。
  const fallbackBaseline =
    !sessionHasMessages &&
    !defaultPromptEnabled &&
    !suppressionActive &&
    !promptIsCustom &&
    !activeCard &&
    !profileSystem
  // 提示词清空时三种身份来源全部不参与；默认提示关闭且无其它身份时，只保留兜底人设与身份行。
  const identityBlock = suppressionActive
    ? promptIsCustom
      ? ''
      : profileSystem || suppressionPersona
    : promptEmpty || promptIsDefault
      ? fallbackBaseline
        ? identitySystem
        : ''
      : activeCard
        ? formatCharacterCard(activeCard, userName)
        : profileSystem || identitySystem
  // 三种身份来源互斥：一张卡、完整档案或轻量身份行，不会同时拼进 system。
  // 只有角色上下文才把默认助手提示替换成沉浸角色基底，并追加演出/格式规则。
  const roleplayContext =
    suppressionActive ||
    fallbackBaseline ||
    (!promptEmpty && Boolean(activeCard || profileSystem || identitySystem))
  // 统一替换占位符：系统提示词、角色卡字段、世界书与记忆都走这一处
  // 当前卡名优先，其次手写档案名；两者都空时用 AI 生成名，避免 {{char}} 原样漏进 system。
  const promptCharName = suppressionActive
    ? resolveSystemCharacterName(undefined, characterName || DEFAULT_SUPPRESSION_PERSONA_NAME)
    : resolveSystemCharacterName(activeCard?.name, characterName)
  const baseSystem = [
    identityBlock,
    composeSystemPrompt({
      savedPrompt: suppressionActive ? '' : handwrittenPromptActive ? systemPrompt : '',
      suppressMetaTalk,
      userName,
      roleplayContext,
      assistantWarmth: friendlyTone,
      forcedRoleplay: suppressionActive,
      customPromptNote:
        suppressMetaTalk && handwrittenPromptActive && !promptIsDefault && !roleplayContext,
      fallbackPrompt: fallbackBaseline ? FALLBACK_PERSONA : '',
      // 工具轮纪律按真实角色名决定是否追加名字条款：占位名 AI 视为没有设定名字。
      charName: promptCharName,
    }),
  ]
    .filter(Boolean)
    .join('\n\n')
  const baseSystemResolved = applyPlaceholders(baseSystem, {
    userName,
    charName: promptCharName,
  })
  const dynamicContext = [
    formatNormalMemoryBlock(normalCards, normalCards.length, normalMemoryChars),
    formatMemoryBlock(memoryCards, memoryCards.length, memoryChars),
    roleplayActive ? formatSceneBlock(sessionScene) : '',
    formatStoryTurnBlock(activeCard?.story, sessionForMemory),
    formatWorldbookBlock(worldBefore),
    formatWorldbookBlock(worldAfter),
    // 固定 system 之外的短提醒：长对话里模型容易滑向第三人称旁白，放在本轮背景末尾再压一次。
    roleplayContext ? ROLEPLAY_VIEWPOINT_REMINDER : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  // 不向本轮硬塞“必须检索”提醒；是否声明搜索/读链接工具只看最后一句是否明确要求查资料或发来链接。
  const explicitSearchRequest = hasExplicitSearchRequest(request.question.content)
  const explicitReadUrl = containsUrl(request.question.content)
  const turnContext = dynamicContext
    ? [
        '（以下是这一轮附带的背景资料，不是对方新说的话，也不属于对话正文；回答仍按最后一条发言继续。）',
        applyPlaceholders(dynamicContext, { userName, charName: promptCharName }),
      ].join('\n')
    : ''
  /* 前缀探针只记录指纹和长度：system 应是静态段，turnContext/记忆/场景/世界书/提醒都只进尾部。 */
  const systemAudit: SystemAudit = auditSystemText(baseSystemResolved)
  const endpointHash = hashPromptText(chatConfig.endpoint || 'official')
  const cacheModel = initial.model || chatConfig.model || DEFAULT_CHAT_MODEL
  const promptConfigHash = buildPromptConfigFingerprint({
    promptHash: hashPromptText(systemPrompt),
    userNameHash: hashPromptText(userName),
    characterName,
    profileHash: hashPromptText(JSON.stringify(characterProfile)),
    profileEnabled,
    activeCardId: activeCard?.id ?? '',
    activeCardUpdatedAt: activeCard?.updatedAt ?? 0,
    suppressionActive,
    suppressionHash: hashPromptText(storedSuppressionPersona),
    friendlyTone,
    defaultPromptEnabled,
    suppressMetaTalk,
    roleplayEnabled,
    worldbookInject,
    worldbookChars,
    memoryMode,
    memoryLimit,
    memoryChars,
    normalMemoryEnabled,
    normalMemoryLimit,
    normalMemoryChars,
    sceneAutoUpdate,
    autoCompact,
    model: cacheModel,
    format: chatConfig.format,
    custom,
    endpointHash,
    thinking: Boolean(initial.thinking),
    search: Boolean(initial.search),
    safetyCheck,
    keepRefusedContent,
    sendLatestReminder,
    thinkingEffort,
    autoTitle,
    temperature: effectiveTemperature,
    topP: effectiveTopP,
    maxOutput: effectiveMaxTokens,
  })
  const promptScope = [chatConfig.format, custom ? 'custom' : 'official', cacheModel, endpointHash].join('|')
  let cacheAttemptMeta:
    | {
        messageCount: number
        historyTurns: number
        compacted: boolean
        contextSummaryHash: string
        contextSummaryChars: number
        latestReminderHash: string
        latestReminderChars: number
        messageChain: string[]
        messageRoles: string[]
        requestHash: string
        chainTruncated: boolean
      }
    | undefined
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
  // 限时剧情的结束标记只在前端消费：先摘掉标记，再把会话改成已结束。
  // 截止轮没有结束标记时按失败处理，避免模型漏写后会话仍继续推进。
  const settleStory = (target: AssistantMessage) => {
    if (!activeCard?.story || (target.status !== 'done' && target.status !== 'stopped')) {
      return null
    }
    const current = getSession(sessionId)
    if (!current || current.storyState !== 'active' || !replyPlainText(target).trim()) {
      return null
    }
    const end = detectStoryEnd(replyPlainText(target))
    if (!end && !current.storyFinalTurn) {
      return null
    }
    return {
      state: end ?? ('bad' as const),
      reply: {
        ...target,
        blocks: target.blocks.map((block) =>
          block.type === 'text' ? { ...block, text: stripStoryMarkers(block.text) } : block
        ),
      },
    }
  }
  // 独白密度由前端硬性限制：只统计本轮之前的助手正文，最近两轮出现过独白就整轮剔除，
  // 允许保留时也只留一条，避免提示词失效时每轮复读同一句假心声。
  const settleStoryAsides = (target: AssistantMessage) => {
    if (!activeCard?.story) {
      return target
    }
    const previousReplies = visibleForRoleplay
      .filter((message) => message.role === 'assistant' && message.id !== target.id)
      .map((message) => replyPlainText(message))
      .filter((text) => text.trim())
    return {
      ...target,
      blocks: target.blocks.map((block) =>
        block.type === 'text'
          ? {
              ...block,
              text: limitStoryAsides(
                block.text,
                activeCard.story,
                sessionForMemory,
                previousReplies
              ),
            }
          : block
      ),
    }
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
      }
    : initial
  // 流式正文按固定间隔合帧：60fps 每帧都复制整段 messages 并触发列表重算，在千条以上会话里会持续抢主线程。
  let streamTimer = 0
  let lastStreamPaint = 0
  const flush = () => {
    if (streamTimer) {
      window.clearTimeout(streamTimer)
      streamTimer = 0
    }
    lastStreamPaint = performance.now()
    updateReply(sessionId, reply)
  }
  const scheduleFlush = () => {
    if (document.visibilityState === 'hidden') {
      flush()
      return
    }
    if (streamTimer) {
      return
    }
    const wait = Math.max(0, STREAM_UI_INTERVAL_MS - (performance.now() - lastStreamPaint))
    streamTimer = window.setTimeout(() => {
      streamTimer = 0
      lastStreamPaint = performance.now()
      updateReply(sessionId, reply)
    }, wait)
  }
  streamFlushes.set(sessionId, flush)

  const signal = controller.signal
  const summarize = createContextSummarizer(apiKey, signal, chatConfig)
  const extraHeaders = parseCustomHeaders(customHeaders)
  const requestModel = reply.model ?? DEFAULT_CHAT_MODEL
  const initialOutputTokens =
    effectiveMaxTokens ?? (custom ? CUSTOM_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS)
  const minOutputReserve = custom ? CUSTOM_OUTPUT_TOKENS : MIN_OUTPUT_RESERVE
  const defaultOutputTokens = custom ? 1_024 : initial.thinking ? 32_768 : 8_192
  const windowLimit = resolveContextWindow(custom)
  const tokenScale = estimateBranchScale(
    request.history,
    requestModel,
    getSession(sessionId)?.contextCheckpoints
  )
  const scaleEstimate = (tokens: number) =>
    tokenScale === 1 ? tokens : Math.ceil(tokens * tokenScale)
  // system 固定参与前缀缓存，本轮背景只影响尾部；两者都占输入窗口，预算里必须算进去。
  const fixedInputTokens =
    scaleEstimate(cachedTextTokens(baseSystemResolved)) + scaleEstimate(cachedTextTokens(turnContext))
  const budget = contextBudget(minOutputReserve, windowLimit)
  let historyBudget = Math.max(
    0,
    budget.input -
      scaleEstimate(estimateQuestionTokens(request.question)) -
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
  // 深度思考偶发把额度全花在 reasoning 上、正文为空；角色链路自动降级思考重发一次，避免空白回复。
  let thinkingEnabled = initial.thinking
  let emptyReplyRetries = 0
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
              contextBudget(Math.min(minOutputReserve, maxOutputTokens), windowLimit).input -
                scaleEstimate(estimateQuestionTokens(reducedInput.question)) -
                fixedInputTokens -
                PROMPT_OVERHEAD_TOKENS
            )
          )
          context = undefined
          continue
        }
        // 附件就绪后获取本轮信息；重新生成复用原回答的快照，保证同问同前缀。
        // 第三方接口默认不附带快照，可用「发送上下文提醒」开关显式打开。
        const latestReminder =
          custom || !sendLatestReminder
            ? undefined
            : request.reuseLatestReminder
              ? request.latestReminder
              : createLatestReminder(useSettings.getState())
        reply = { ...reply, latestReminder }
        updateReply(sessionId, reply)
        persist(sessionId)
        const activeQuestion = reducedInput?.question ?? prepared.question
        messages = toRequestMessages(
          prepared.history,
          activeQuestion,
          latestReminder,
          inlineFiles,
          turnContext
        )
        // 角色上下文才把出站副本里硬编码的“用户 / 玩家 / User”换成账号昵称；普通助手沿用标准称谓。
        // 只改发给接口的请求副本，不回写本地持久化记录，UI 渲染仍用原始文本。
        if (roleplayContext) {
          messages = replaceUserNickname(messages, userName)
        }
        includeContextSummary(messages, context.summary)
        const requestFingerprint = fingerprintRequestMessages(messages)
        cacheAttemptMeta = {
          historyTurns: Math.max(0, messages.filter((message) => message.role === 'user').length - 1),
          compacted: Boolean(context.summary),
          contextSummaryHash: context.summary ? hashPromptText(context.summary) : '',
          contextSummaryChars: context.summary?.length ?? 0,
          latestReminderHash: latestReminder ? hashPromptText(latestReminder) : '',
          latestReminderChars: latestReminder?.length ?? 0,
          ...requestFingerprint,
        }
        estimatedInput =
          context.tokens +
          scaleEstimate(estimateQuestionTokens(activeQuestion)) +
          fixedInputTokens +
          PROMPT_OVERHEAD_TOKENS
        requestMaxOutput = resolveMaxOutputTokens(
          maxOutputTokens,
          estimatedInput,
          Math.min(minOutputReserve, maxOutputTokens),
          windowLimit
        )
        const body: CreateMessageRequest = {
          model: requestModel,
          max_tokens: outputCap(requestMaxOutput),
          system: baseSystemResolved,
          messages,
          thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
          ...(safetyCheck ? { safety_check: SAFETY_CHECK } : {}),
          tools: serverTools(Boolean(initial.search) && explicitSearchRequest, explicitReadUrl),
          ...(effectiveTemperature !== null ? { temperature: effectiveTemperature } : {}),
          ...(effectiveTopP !== null ? { top_p: effectiveTopP } : {}),
          ...(thinkingEffort && chatConfig.format !== 'messages'
            ? { reasoning_effort: thinkingEffort }
            : {}),
          ...(autoTitle && titleRequests.has(controller) ? { title: { enabled: true } } : {}),
        }
        const events = streamChatMessage(chatConfig, apiKey, body, signal, extraHeaders, (wireBody) => {
          const wireFingerprint = fingerprintWireRequest(wireBody)
          if (wireFingerprint && cacheAttemptMeta) {
            cacheAttemptMeta = { ...cacheAttemptMeta, ...wireFingerprint }
          }
        })
        const blockIndexes = new Map<number, number>()
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
          reply = applyEvent(reply, event, Date.now(), blockIndexes)
          scheduleFlush()
        }
        reply = settleLocal(reply, 'done')
        const hasBody = reply.blocks.some((block) =>
          block.type === 'text' ? block.text.trim() : block.type !== 'thinking'
        )
        if (
          !hasBody &&
          reply.stopReason !== 'refusal' &&
          !controller.signal.aborted &&
          emptyReplyRetries < 1
        ) {
          emptyReplyRetries += 1
          thinkingEnabled = false
          reply = {
            ...initial,
            blocks: [],
            status: 'streaming',
            thinking: false,
            stopReason: undefined,
            usage: undefined,
            error: undefined,
          }
          updateReply(sessionId, reply)
          persist(sessionId)
          continue
        }
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
              requestMaxOutput > defaultOutputTokens &&
              estimatedInput + requestMaxOutput >= Math.floor(windowLimit * 0.85)
            ) {
              // 高输入场景下因 max_tokens 占满窗口导致的溢出，优先缩小输出预算，不误砍历史。
              maxOutputTokens = defaultOutputTokens
              continue
            }
            if (context?.tokens) {
              // 每次严格收紧历史预算。最后一次保留本轮输入，验证是否是输入本身过长。
              historyBudget =
                ++historyRetries < HISTORY_OVERFLOW_RETRIES ? Math.floor(context.tokens / 2) : 0
              context = undefined
              continue
            }
            if (maxOutputTokens > defaultOutputTokens) {
              maxOutputTokens = defaultOutputTokens
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
    if (streamTimer) {
      window.clearTimeout(streamTimer)
      streamTimer = 0
    }
    /* 记录最终一次请求的 usage；中断、上传失败或没有 usage 时不写入记录，不生成推断值。 */
    if (reply.usage && cacheAttemptMeta) {
      recordPromptCacheSample({
        sessionId,
        model: cacheModel,
        format: chatConfig.format,
        custom,
        endpointHash,
        scope: promptScope,
        configHash: promptConfigHash,
        systemAudit,
        turnContextHash: hashPromptText(turnContext),
        turnContextChars: turnContext.length,
        ...cacheAttemptMeta,
        thinking: Boolean(initial.thinking),
        search: Boolean(initial.search),
        usage: {
          input_tokens: reply.usage.input_tokens,
          cache_creation_input_tokens: reply.usage.cache_creation_input_tokens,
          cache_read_input_tokens: reply.usage.cache_read_input_tokens,
          output_tokens: reply.usage.output_tokens,
        },
      })
    }
    reply = settleStoryAsides(reply)
    const storyEnd = settleStory(reply)
    if (storyEnd) {
      reply = storyEnd.reply
      updateSession(sessionId, (session) => ({
        ...session,
        storyState: storyEnd.state === 'bad' ? 'bad_end' : 'good_end',
        storyFinalTurn: false,
        updatedAt: Date.now(),
      }))
    }
    updateReply(sessionId, reply)
    const answerText = replyPlainText(reply)
    // 玩家问题贴近当前已到点线索时，只在本轮回复完成后确认，避免弹窗早于角色表现。
    if (!storyEnd && (reply.status === 'done' || reply.status === 'stopped') && answerText.trim()) {
      const sessionNow = getSession(sessionId)
      if (sessionNow?.storyState === 'active') {
        const settingsNow = useSettings.getState()
        const turnCard = resolveTurnCharacterCard(
          settingsNow.characterCards,
          sessionNow,
          settingsNow.activeCharacterId,
          settingsNow.roleplayEnabled
        )
        const clueState = confirmStoryClueFromQuestion(
          turnCard?.story,
          sessionNow,
          request.question.content
        )
        if (clueState) {
          updateSession(sessionId, (session) => ({
            ...session,
            ...clueState,
            updatedAt: Date.now(),
          }))
        }
      }
    }
    set((state) => ({
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(([id]) => id !== sessionId)
      ),
    }))
    persist(sessionId)
    if ((reply.status === 'done' || reply.status === 'stopped') && answerText.trim()) {
      recordTurnMemory(
        sessionId,
        reply.id,
        request.question.content,
        answerText,
        memoryMode,
        memoryPool
      )
      if (!characterMemoryActive) {
        recordNormalCodeMemory(sessionId, reply.id, answerText)
      }
      if (sceneAutoUpdate && roleplayActive) {
        void updateSceneFromTurn(sessionId, request.question.content, answerText)
      }
    }
  }
}

/* ============================================================================
 * 功能区：会话与角色核心 / store 结束
 * ========================================================================== */
