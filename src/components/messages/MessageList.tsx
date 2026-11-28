/* ============================================================================
 * 功能区：视图与交互 / MessageList · 消息列表
 * 职责：消息列表：分支渲染、虚拟滚动、选择模式与底部操作条。
 * 分区：01 类型、常量与模块依赖；02 列表派生与重试标识；03 消息列表渲染与交互
 * 关联：依赖 app/android、app/viewport、components/base/toastState、components/messages/AssistantMessage 等 21 个模块；
 *    被 components/session/SessionView 引用。
 * 导出：MessageList
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { android } from '../../app/android.js'
import { useIsMobile } from '../../app/viewport.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  isContentOnlyChange,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { cancelMessageEdit, useDrafts } from '../../services/chat/drafts.js'
import {
  clearPendingJump,
  selectMessageVersion,
  useChatStore,
  saveMessagesAsMemory,
} from '../../services/chat/store.js'
import {
  characterMemoryLabel,
  CHARACTER_MEMORY_KINDS,
  MEMORY_OWNERS,
  memoryOwnerLabel,
  NORMAL_MEMORY_KINDS,
  normalMemoryLabel,
  replyPlainText,
  type CharacterMemoryKind,
  type MemoryOwner,
  type MemoryPool,
  type NormalMemoryKind,
} from '../../services/chat/memory.js'
import { resolveSessionCharacterCard } from '../../services/chat/roleplay.js'
import { basicRoleplayActive, SYSTEM_PROMPT } from '../../services/chat/systemPrompt.js'
import {
  memoryPoolForDisplayName,
  resolveMemoryDisplayName,
} from '../../services/chat/memoryRouting.js'
import type { Session } from '../../services/chat/types.js'
import { sessionActualUsage } from '../../services/chat/tokenUsage.js'
import {
  dismissTokenUsageChip,
  tokenUsageChipDismissed,
  useSettings,
} from '../../services/settings.js'
import { TokenLimitDialog } from './TokenLimitDialog.js'
import { TokenUsageChip } from './TokenUsageChip.js'
import { showToast } from '../base/toastState.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { JumpToBottomButton } from './JumpToBottomButton.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { prefersReducedMotion, stepCriticallyDampedSpring, type SpringState } from './spring.js'
import { UserMessage } from './UserMessage.js'
import type { Message } from '../../services/chat/types.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
/* ---- 01 类型、常量与模块依赖 ---- */
/* ---- 02 列表派生与重试标识 ---- */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
const JUMP_TO_BOTTOM_THRESHOLD = 48
const JUMP_TO_BOTTOM_MIN_HEIGHT = 64
const JUMP_SCROLL_STIFFNESS = 700
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }
/**
 * 渲染窗口上限：普通游玩始终只挂最近 40 条；用户主动查看更早消息时最多扩到 80 条。
 * 这不是内容截断，完整消息仍在 session 中，只是不把所有历史节点同时交给 React/WebView。
 */
const INITIAL_VISIBLE_MESSAGES = 40
const LOAD_EARLIER_MESSAGES = 20
const MAX_VISIBLE_MESSAGES = 80
const SEARCH_WINDOW_BEFORE = 2
const SEARCH_WINDOW_AFTER = 26
const SEARCH_JUMP_TOP_OFFSET = 10
const SEARCH_JUMP_SETTLE_MS = 650
const SEARCH_HIGHLIGHT_MS = 1800

type MessageWindowState = {
  sessionId: string
  /** 渲染切片起点，绝对消息下标 */
  start: number
  /** 渲染切片终点，不含该下标 */
  end: number
  /** true=始终跟住会话尾部；false=用户正在查看更早消息，保留当前切片 */
  follow: boolean
}

const tailWindow = (sessionId: string, length: number): MessageWindowState => ({
  sessionId,
  start: Math.max(0, length - INITIAL_VISIBLE_MESSAGES),
  end: length,
  follow: true,
})


/* ---- 03 消息列表渲染与交互 ---- */
export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const desktopFooterRef = useRef<HTMLDivElement>(null)
  const jumpSlotRef = useRef<HTMLDivElement>(null)
  const autoFollow = useSettings((state) => state.autoFollow)
  const roleplayEnabled = useSettings((state) => state.roleplayEnabled)
  const activeCharacterId = useSettings((state) => state.activeCharacterId)
  const characterCards = useSettings((state) => state.characterCards)
  const characterName = useSettings((state) => state.characterName)
  const characterAvatar = useSettings((state) => state.characterAvatar)
  const cardAvatars = useSettings((state) => state.cardAvatars)
  const systemPrompt = useSettings((state) => state.systemPrompt)
  const systemPromptEnabled = useSettings((state) => state.systemPromptEnabled)
  // 只在会话身份/分支结构变化时重查角色卡；流式正文每帧更新时不再重复扫整段消息。
  /* oxlint-disable react-hooks/exhaustive-deps -- 会话对象来自 getState，这些字段仅作为失效信号 */
  const displayCard = useMemo(() => {
    const current = useChatStore.getState().sessionCache[session.id]
    return current
      ? resolveSessionCharacterCard(characterCards, current, activeCharacterId, roleplayEnabled)
      : undefined
  }, [
    characterCards,
    session.id,
    session.characterId,
    session.title,
    session.rootMessageId,
    session.messages.length,
    activeCharacterId,
    roleplayEnabled,
  ])
  /* oxlint-enable react-hooks/exhaustive-deps */
  // 保存弹窗与面板只看最终显示名：AI / DeepSeek 走普通池，角色名走角色池。
  // 基础扮演接管空/默认提示词时没有实体卡，按角色池写记忆，口径与 store 发送链路保持一致。
  const basicRoleplayEnabled = useSettings((state) => state.basicRoleplayEnabled)
  const promptText = systemPrompt.trim()
  // 系统提示词开关关闭时视同空提示词，与主请求装配保持同一口径。
  const handwrittenActive = systemPromptEnabled && Boolean(promptText)
  const promptEmpty = !handwrittenActive
  const promptIsDefault = !promptEmpty && promptText === SYSTEM_PROMPT
  const suppressionActive = basicRoleplayActive({
    basicRoleplayEnabled,
    promptEmpty,
    promptIsDefault,
    hasActiveCard: Boolean(displayCard),
  })
  const characterMemoryActive =
    suppressionActive ||
    memoryPoolForDisplayName(
      resolveMemoryDisplayName({
        cardName: displayCard?.name,
        characterName,
        custom: false,
      })
    ) === 'character'
  const tokenLimit = useSettings((state) => state.tokenLimit)
  const [tokenWarning, setTokenWarning] = useState<{ limit: number; used: number } | null>(null)
  const [chipHidden, setChipHidden] = useState(() => tokenUsageChipDismissed())
  useEffect(() => {
    setChipHidden(tokenUsageChipDismissed())
  }, [tokenLimit])
  const [actualUsed, setActualUsed] = useState(0)
  useEffect(() => {
    if (tokenLimit <= 0) {
      setActualUsed(0)
      return
    }
    // 流式期间不逐帧重算整段分支用量；等这一轮结束再算一次，避免和消息渲染抢主线程。
    if (streaming) {
      return
    }
    const current = useChatStore.getState().sessionCache[session.id]
    if (current) {
      setActualUsed(sessionActualUsage(current))
    }
  }, [session.id, session.messages.length, tokenLimit, streaming])
  useEffect(() => {
    if (!tokenLimit || streaming) {
      setTokenWarning(null)
      return
    }
    const current = useChatStore.getState().sessionCache[session.id]
    if (!current) {
      return
    }
    const used = sessionActualUsage(current)
    if (used < tokenLimit) {
      return
    }
    const key = `replica:token-warned:${session.id}:${tokenLimit}`
    try {
      if (window.sessionStorage.getItem(key)) {
        return
      }
      window.sessionStorage.setItem(key, '1')
    } catch {
      // 存不进去也照常提醒一次
    }
    setTokenWarning({ limit: tokenLimit, used })
  }, [session.id, session.messages.length, tokenLimit, streaming])
  const autoFollowRef = useRef(autoFollow)
  const stickyRef = useRef(true)
  const jumpingRef = useRef(false)
  const programmaticScrollRef = useRef(false)
  const scrollTopRef = useRef(0)
  useEffect(() => {
    autoFollowRef.current = autoFollow
  }, [autoFollow])
  const jumpFrameRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const jumpAnchorRef = useRef<{ messageId: string; expiresAt: number } | null>(null)
  const searchHighlightTimerRef = useRef<number | undefined>(undefined)
  const [searchHighlight, setSearchHighlight] = useState<{
    sessionId: string
    messageId: string
    nonce: number
  } | null>(null)
  const pendingJump = useChatStore((state) =>
    state.pendingJump?.sessionId === session.id ? state.pendingJump : null
  )
  const editingMessageId = useDrafts((state) =>
    android && state.editing?.sessionId === session.id ? state.editing.messageId : null
  )
  const editingMessageIdRef = useRef(editingMessageId)
  editingMessageIdRef.current = editingMessageId
  const messages = useMemo(() => getVisibleMessages(session), [session])
  const [memorySelect, setMemorySelect] = useState<{ active: boolean; ids: Set<string> }>({
    active: false,
    ids: new Set(),
  })
  const [memoryConfirm, setMemoryConfirm] = useState(false)
  const [memoryPool, setMemoryPool] = useState<MemoryPool>('character')
  const [memoryKind, setMemoryKind] = useState<NormalMemoryKind | 'auto'>('auto')
  const [memoryCharacterKind, setMemoryCharacterKind] = useState<CharacterMemoryKind>('turn')
  const [memoryOwner, setMemoryOwner] = useState<MemoryOwner>('shared')
  const [memoryDraft, setMemoryDraft] = useState('')
  useEffect(() => {
    setMemorySelect({ active: false, ids: new Set() })
    setMemoryConfirm(false)
  }, [session.id])
  const pendingJumpIndex = pendingJump
    ? messages.findIndex((message) => message.id === pendingJump.messageId)
    : -1
  // 搜索定位时临时把窗口切到目标附近，避免为了显示一条旧消息把整段历史重新挂载。
  const pendingJumpWindow =
    pendingJumpIndex >= 0
      ? {
          start: Math.max(0, pendingJumpIndex - SEARCH_WINDOW_BEFORE),
          end: Math.min(messages.length, pendingJumpIndex + SEARCH_WINDOW_AFTER),
        }
      : null
  const [messageWindow, setMessageWindow] = useState<MessageWindowState>(() =>
    tailWindow(session.id, messages.length)
  )
  if (messageWindow.sessionId !== session.id) {
    setMessageWindow(tailWindow(session.id, messages.length))
  }
  const activeWindow =
    messageWindow.sessionId === session.id
      ? messageWindow
      : tailWindow(session.id, messages.length)
  let start = 0
  let end = messages.length
  if (pendingJumpWindow) {
    // 搜索目标优先：即使当前停留在尾部，也先把目标附近切片渲染出来，再由定位副作用对齐。
    start = pendingJumpWindow.start
    end = pendingJumpWindow.end
  } else if (activeWindow.follow) {
    end = messages.length
    start = Math.max(0, end - INITIAL_VISIBLE_MESSAGES)
  } else {
    end = Math.min(Math.max(0, activeWindow.end), messages.length)
    start = Math.min(Math.max(0, activeWindow.start), end)
    if (end - start > MAX_VISIBLE_MESSAGES) {
      start = end - MAX_VISIBLE_MESSAGES
    }
  }
  const prependAnchor = useRef<{ element: Element; top: number } | null>(null)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versionInputRef = useRef<Message[] | null>(null)
  const versions = useMemo(() => {
    const previousMessages = versionInputRef.current
    versionInputRef.current = session.messages
    // 流式正文更新不改变分支结构：直接复用上一份版本表，避免每帧遍历整段历史。
    if (previousMessages && isContentOnlyChange(previousMessages, session.messages)) {
      return previousVersions
    }
    return buildMessageVersions(session, previousVersions)
  }, [session, previousVersions])
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  const cancelJump = useCallback(() => {
    cancelAnimationFrame(jumpFrameRef.current)
    jumpFrameRef.current = 0
    jumpingRef.current = false
  }, [])
  const updateJumpVisibility = useCallback(() => {
    const el = scrollRef.current
    if (!el || stickyRef.current || jumpingRef.current) {
      setShowJumpToBottom(false)
      return
    }
    const footerHeight =
      !isMobile && desktopFooterRef.current ? desktopFooterRef.current.offsetHeight : 0
    const availableHeight = Math.max(0, el.clientHeight - footerHeight)
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowJumpToBottom(
      availableHeight >= JUMP_TO_BOTTOM_MIN_HEIGHT && distance > JUMP_TO_BOTTOM_THRESHOLD
    )
  }, [isMobile])
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current && !jumpingRef.current) {
      const target = Math.max(0, el.scrollHeight - el.clientHeight)
      if (Math.abs(target - el.scrollTop) > 0.5) {
        el.scrollTop = el.scrollHeight
      }
      scrollTopRef.current = el.scrollTop
      setShowJumpToBottom(false)
    }
  }, [])
  const ensureEditedBubbleVisible = useCallback(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!scroll || !content || !editingMessageIdRef.current) {
      return
    }
    const bubble = content.querySelector<HTMLElement>(
      '[data-editing-target="true"] [data-editing-bubble="true"]'
    )
    if (!bubble) {
      return
    }
    const scrollRect = scroll.getBoundingClientRect()
    const bubbleRect = bubble.getBoundingClientRect()
    if (scrollRect.height <= 0 || bubbleRect.height <= 0) {
      return
    }
    const margin = 12
    let delta = 0
    if (bubbleRect.bottom > scrollRect.bottom - margin) {
      delta = bubbleRect.bottom - (scrollRect.bottom - margin)
      if (bubbleRect.top - delta < scrollRect.top + margin) {
        delta = Math.max(0, bubbleRect.top - (scrollRect.top + margin))
      }
    } else if (bubbleRect.top < scrollRect.top + margin) {
      delta = bubbleRect.top - (scrollRect.top + margin)
    }
    if (Math.abs(delta) > 0.5) {
      programmaticScrollRef.current = true
      scroll.scrollTop += delta
      scrollTopRef.current = scroll.scrollTop
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    }
  }, [])
  const alignJumpTarget = useCallback((messageId: string) => {
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!scroll || !content) {
      return false
    }
    const target = content.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`
    )
    if (!target) {
      return false
    }
    const scrollRect = scroll.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
    const nextTop = Math.max(
      0,
      Math.min(
        maxTop,
        scroll.scrollTop + (targetRect.top - scrollRect.top) - SEARCH_JUMP_TOP_OFFSET
      )
    )
    programmaticScrollRef.current = true
    scroll.scrollTop = nextTop
    scrollTopRef.current = scroll.scrollTop
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
    return true
  }, [])
  const stopFollowing = useCallback(() => {
    jumpAnchorRef.current = null
    cancelJump()
    stickyRef.current = false
    updateJumpVisibility()
  }, [cancelJump, updateJumpVisibility])
  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el || jumpingRef.current) {
      return
    }
    // 当前停留在更早的切片时，先恢复到尾部窗口；等新节点挂上后再滚到底。
    if (!activeWindow.follow) {
      stickyRef.current = true
      setShowJumpToBottom(false)
      setMessageWindow(tailWindow(session.id, messages.length))
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
        scrollTopRef.current = el.scrollTop
      })
      return
    }
    const initialTarget = Math.max(0, el.scrollHeight - el.clientHeight)
    if (el.scrollTop >= initialTarget - 0.5 || prefersReducedMotion()) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
      stickyRef.current = true
      setShowJumpToBottom(false)
      return
    }
    cancelJump()
    jumpingRef.current = true
    // 到达底部前不恢复 stickyRef，避免流式增长触发 ResizeObserver 瞬间拉底打断弹簧动画。
    stickyRef.current = false
    setShowJumpToBottom(false)

    let state: SpringState = { value: el.scrollTop, velocity: 0 }
    let lastTime = performance.now()
    const step = (now: number) => {
      if (!jumpingRef.current || scrollRef.current !== el) {
        jumpFrameRef.current = 0
        jumpingRef.current = false
        return
      }
      const target = Math.max(0, el.scrollHeight - el.clientHeight)
      if (target <= 0) {
        el.scrollTop = el.scrollHeight
        scrollTopRef.current = el.scrollTop
        jumpingRef.current = false
        jumpFrameRef.current = 0
        stickyRef.current = true
        setShowJumpToBottom(false)
        return
      }
      const stepTime = now > lastTime ? now : lastTime
      const dt = Math.min(0.05, (stepTime - lastTime) / 1000)
      lastTime = stepTime
      state = stepCriticallyDampedSpring(state, target, JUMP_SCROLL_STIFFNESS, dt)
      if (state.value >= target) {
        state = { value: target, velocity: Math.min(0, state.velocity) }
      }
      el.scrollTop = state.value
      scrollTopRef.current = el.scrollTop
      if (
        (Math.abs(target - state.value) <= 0.5 && Math.abs(state.velocity) < 12) ||
        (jumpFrames += 1) > 900
      ) {
        el.scrollTop = el.scrollHeight
        scrollTopRef.current = el.scrollTop
        jumpingRef.current = false
        jumpFrameRef.current = 0
        stickyRef.current = true
        setShowJumpToBottom(false)
        return
      }
      jumpFrameRef.current = requestAnimationFrame(step)
    }
    let jumpFrames = 0
    jumpFrameRef.current = requestAnimationFrame(step)
  }, [activeWindow.follow, cancelJump, messages.length, session.id])
  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态，或刷新回到底部按钮的显示状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    const desktopFooter = desktopFooterRef.current
    if (!content || !scroll) {
      return
    }
    const handleResize = () => {
      if (editingMessageIdRef.current) {
        stickyRef.current = false
        ensureEditedBubbleVisible()
        return
      }
      if (!autoFollowRef.current) {
        stickyRef.current = false
        updateJumpVisibility()
        return
      }
      const jumpAnchor = jumpAnchorRef.current
      if (jumpAnchor) {
        if (performance.now() < jumpAnchor.expiresAt) {
          stickyRef.current = false
          alignJumpTarget(jumpAnchor.messageId)
          updateJumpVisibility()
          return
        }
        jumpAnchorRef.current = null
      }
      if (stickyRef.current && !jumpingRef.current) {
        scrollToBottom()
      } else {
        updateJumpVisibility()
      }
    }
    const observer = new ResizeObserver(handleResize)
    observer.observe(content)
    observer.observe(scroll)
    if (!isMobile && desktopFooter) {
      observer.observe(desktopFooter)
    }
    return () => observer.disconnect()
  }, [isMobile, alignJumpTarget, ensureEditedBubbleVisible, scrollToBottom, updateJumpVisibility])

  useLayoutEffect(() => {
    if (!editingMessageId) {
      updateJumpVisibility()
      return
    }
    cancelJump()
    stickyRef.current = false
    setShowJumpToBottom(false)
    ensureEditedBubbleVisible()
  }, [cancelJump, editingMessageId, ensureEditedBubbleVisible, updateJumpVisibility])

  useEffect(() => {
    if (!android || !editingMessageId) {
      return
    }
    const area = scrollAreaRef.current
    const scroll = scrollRef.current
    if (!area || !scroll) {
      return
    }
    let pointerDown: { x: number; y: number; pointerId: number } | null = null
    let touchStart: { x: number; y: number } | null = null
    let touchActive = false
    let dismissed = false
    const dismiss = () => {
      if (dismissed) {
        return
      }
      dismissed = true
      pointerDown = null
      touchStart = null
      touchActive = false
      cancelMessageEdit()
      window.dispatchEvent(new Event('android-close-attachments'))
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return
      }
      pointerDown = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!pointerDown || event.pointerId !== pointerDown.pointerId) {
        return
      }
      if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 8) {
        dismiss()
      }
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerDown || event.pointerId !== pointerDown.pointerId) {
        return
      }
      dismiss()
    }
    const onPointerCancel = () => {
      pointerDown = null
    }
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (touch) {
        touchStart = { x: touch.clientX, y: touch.clientY }
        touchActive = true
      }
    }
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch || !touchStart) {
        return
      }
      if (Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) > 8) {
        dismiss()
      }
    }
    const onTouchEnd = () => {
      touchStart = null
      touchActive = false
    }
    const onWheel = () => dismiss()
    const onScroll = () => {
      if (!programmaticScrollRef.current && (pointerDown || touchActive)) {
        dismiss()
      }
    }
    area.addEventListener('pointerdown', onPointerDown)
    area.addEventListener('pointermove', onPointerMove)
    area.addEventListener('pointerup', onPointerUp)
    area.addEventListener('pointercancel', onPointerCancel)
    area.addEventListener('touchstart', onTouchStart, { passive: true })
    area.addEventListener('touchmove', onTouchMove, { passive: true })
    area.addEventListener('touchend', onTouchEnd, { passive: true })
    area.addEventListener('touchcancel', onTouchEnd, { passive: true })
    scroll.addEventListener('wheel', onWheel, { passive: true })
    scroll.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      area.removeEventListener('pointerdown', onPointerDown)
      area.removeEventListener('pointermove', onPointerMove)
      area.removeEventListener('pointerup', onPointerUp)
      area.removeEventListener('pointercancel', onPointerCancel)
      area.removeEventListener('touchstart', onTouchStart)
      area.removeEventListener('touchmove', onTouchMove)
      area.removeEventListener('touchend', onTouchEnd)
      area.removeEventListener('touchcancel', onTouchEnd)
      scroll.removeEventListener('wheel', onWheel)
      scroll.removeEventListener('scroll', onScroll)
    }
  }, [editingMessageId])

  // 切片变化后只做滚动锚点修正。更早消息改为显式按钮，不再由滚动/ResizeObserver 自动无限补。
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!scroll || !content) {
      return
    }
    const anchor = prependAnchor.current
    prependAnchor.current = null
    if (anchor?.element.isConnected && !stickyRef.current) {
      scroll.scrollTop += anchor.element.getBoundingClientRect().top - anchor.top
      scrollTopRef.current = scroll.scrollTop
    }
  }, [isMobile, session.id, start, end])

  const loadEarlier = useCallback(() => {
    if (start <= 0) {
      return
    }
    // 第一个子节点在还有更早消息时是按钮行，锚定真正的首条消息才能保持阅读位置。
    const first = contentRef.current?.children[start > 0 ? 1 : 0] as HTMLElement | undefined
    if (first) {
      prependAnchor.current = { element: first, top: first.getBoundingClientRect().top }
    }
    const nextStart = Math.max(0, start - LOAD_EARLIER_MESSAGES)
    const nextEnd = Math.min(messages.length, Math.max(end, nextStart + 1))
    setMessageWindow({
      sessionId: session.id,
      start: nextStart,
      // 向前翻页时窗口整体向前滑；超过上限就丢掉已经离开视口的尾部，保持总数封顶。
      end: Math.min(nextEnd, nextStart + MAX_VISIBLE_MESSAGES),
      follow: false,
    })
  }, [end, messages.length, session.id, start])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      scrollTopRef.current = scroll.scrollTop
      updateJumpVisibility()
      return
    }
    if (useChatStore.getState().pendingJump?.sessionId === session.id) {
      return
    }
    jumpAnchorRef.current = null
    cancelJump()
    stickyRef.current = true
    // 新消息到达时回到尾部窗口。setState 后 DOM 才会重新挂上尾部消息，滚动放到下一帧。
    setMessageWindow((current) =>
      current.sessionId === session.id && current.follow
        ? current
        : tailWindow(session.id, messages.length)
    )
    requestAnimationFrame(scrollToBottom)
  }, [session.id, lastMessageId, messages.length, cancelJump, scrollToBottom, updateJumpVisibility])

  // 消费来自搜索结果的消息定位请求：滚动到目标消息并显示短暂底色高亮，随后自动淡出。
  useLayoutEffect(() => {
    if (!pendingJump) {
      return
    }
    if (pendingJumpIndex < 0) {
      clearPendingJump(pendingJump.nonce)
      return
    }
    cancelJump()
    stickyRef.current = false
    // 把临时搜索窗口固化下来；清理 pendingJump 后目标消息仍留在当前切片里。
    setMessageWindow((current) =>
      current.sessionId === session.id &&
      !current.follow &&
      current.start === start &&
      current.end === end
        ? current
        : { sessionId: session.id, start, end, follow: false }
    )
    if (alignJumpTarget(pendingJump.messageId)) {
      jumpAnchorRef.current = {
        messageId: pendingJump.messageId,
        expiresAt: performance.now() + SEARCH_JUMP_SETTLE_MS,
      }
      window.clearTimeout(searchHighlightTimerRef.current)
      setSearchHighlight({
        sessionId: session.id,
        messageId: pendingJump.messageId,
        nonce: pendingJump.nonce,
      })
      searchHighlightTimerRef.current = window.setTimeout(() => {
        setSearchHighlight((current) => (current?.nonce === pendingJump.nonce ? null : current))
      }, SEARCH_HIGHLIGHT_MS)
      updateJumpVisibility()
      clearPendingJump(pendingJump.nonce)
    }
  }, [
    alignJumpTarget,
    cancelJump,
    pendingJump,
    pendingJumpIndex,
    session.id,
    start,
    end,
    updateJumpVisibility,
  ])

  useEffect(
    () => () => {
      window.clearTimeout(searchHighlightTimerRef.current)
    },
    []
  )

  useEffect(closeSearchPanel, [session.id, lastMessageId])
  useEffect(() => cancelJump, [cancelJump])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      cancelJump()
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [cancelJump, session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框、当前阅读位置与回到底部按钮状态。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    cancelJump()
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
      updateJumpVisibility()
    }
    const onScroll = () => {
      const scrollTop = el.scrollTop
      if (jumpingRef.current) {
        scrollTopRef.current = scrollTop
        return
      }
      const clientHeight = el.clientHeight
      const scrollHeight = el.scrollHeight
      const distance = scrollHeight - scrollTop - clientHeight
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (autoFollowRef.current && distance < STICKY_THRESHOLD) {
        stickyRef.current = true
      } else if (scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = scrollTop
      if (stickyRef.current) {
        setShowJumpToBottom(false)
        return
      }
      const footerHeight =
        !isMobile && desktopFooterRef.current ? desktopFooterRef.current.offsetHeight : 0
      const availableHeight = Math.max(0, clientHeight - footerHeight)
      setShowJumpToBottom(
        availableHeight >= JUMP_TO_BOTTOM_MIN_HEIGHT && distance > JUMP_TO_BOTTOM_THRESHOLD
      )
    }
    const interruptJump = (event: Event) => {
      const target = event.target
      if (
        target instanceof Node &&
        (desktopFooterRef.current?.contains(target) || jumpSlotRef.current?.contains(target))
      ) {
        return
      }
      jumpAnchorRef.current = null
      if (!jumpingRef.current) {
        return
      }
      cancelJump()
      stickyRef.current = false
      scrollTopRef.current = el.scrollTop
      updateJumpVisibility()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('touchstart', interruptJump, { passive: true })
    el.addEventListener('pointerdown', interruptJump, { passive: true })
    el.addEventListener('wheel', interruptJump, { passive: true })
    return () => {
      cancelJump()
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('touchstart', interruptJump)
      el.removeEventListener('pointerdown', interruptJump)
      el.removeEventListener('wheel', interruptJump)
    }
  }, [isMobile, cancelJump, scrollToBottom, updateJumpVisibility])

  const lastIndex = messages.length - 1
  const memorySelectedCount = memorySelect.ids.size
  const memorySelectedPreview = useMemo(
    () =>
      messages
        .filter((message) => memorySelect.ids.has(message.id))
        .map((message) =>
          message.role === 'assistant' ? replyPlainText(message).trim() : message.content.trim()
        )
        .filter(Boolean)
        .join('\n\n'),
    [messages, memorySelect.ids]
  )
  const memoryAllSelected = messages.length > 0 && memorySelectedCount === messages.length
  const toggleMemorySelected = (id: string) => {
    setMemorySelect((state) => {
      if (!state.active) {
        return state
      }
      const ids = new Set(state.ids)
      if (ids.has(id)) {
        ids.delete(id)
      } else {
        ids.add(id)
      }
      return { ...state, ids }
    })
  }
  // 长按任意一条都按“一轮”选择：用户消息带上紧邻的角色回复，角色回复带上紧邻的用户提问
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const roundMessageIds = useCallback((id: string, list: Message[]) => {
    const index = list.findIndex((message) => message.id === id)
    if (index < 0) {
      return [id]
    }
    if (list[index].role === 'user') {
      const reply = list[index + 1]
      return reply?.role === 'assistant' ? [id, reply.id] : [id]
    }
    const prompt = list[index - 1]
    return prompt?.role === 'user' ? [prompt.id, id] : [id]
  }, [])
  const startMemorySelect = useCallback(
    (id: string, scope: 'one' | 'all') => {
      const list = messagesRef.current
      setMemoryConfirm(false)
      setMemoryPool('character')
      setMemoryKind('auto')
      setMemorySelect({
        active: true,
        ids: new Set(scope === 'all' ? list.map((message) => message.id) : roundMessageIds(id, list)),
      })
    },
    [roundMessageIds]
  )
  const selectAllMemory = () => {
    setMemorySelect((state) => ({
      ...state,
      ids: new Set(memoryAllSelected ? [] : messages.map((message) => message.id)),
    }))
  }
  const exitMemorySelect = () => {
    setMemoryConfirm(false)
    setMemorySelect({ active: false, ids: new Set() })
  }
  const openMemoryConfirm = () => {
    // 显示名仍是 AI / DeepSeek 时默认写普通池；角色名才默认写角色池。
    setMemoryPool(characterMemoryActive ? 'character' : 'normal')
    setMemoryKind('auto')
    setMemoryCharacterKind('turn')
    setMemoryOwner('shared')
    setMemoryDraft('')
    setMemoryConfirm(true)
  }
  const chooseMemoryCharacterKind = (kind: CharacterMemoryKind) => {
    setMemoryCharacterKind(kind)
    if (kind !== 'turn' && !memoryDraft.trim()) {
      // 默认带入选中原文，玩家可在弹窗里删改成一句场景或事实；
      // 不做模型猜测，避免把环境描写、动作和台词混成不存在的经历。
      setMemoryDraft(memorySelectedPreview)
    }
  }
  const confirmSaveMemory = () => {
    const savePool: MemoryPool = characterMemoryActive ? 'character' : memoryPool
    const importantKind =
      savePool === 'character' && memoryCharacterKind !== 'turn' ? memoryCharacterKind : undefined
    if (importantKind && !memoryDraft.trim()) {
      showToast('先写清这段场景或事实，再保存')
      return
    }
    const target =
      savePool === 'normal'
        ? { pool: 'normal' as const, category: memoryKind }
        : importantKind
          ? {
              pool: 'character' as const,
              kind: importantKind,
              content: memoryDraft,
              owner: memoryOwner,
            }
          : { pool: 'character' as const, owner: memoryOwner }
    const result = saveMessagesAsMemory(session.id, Array.from(memorySelect.ids), target)
    const savedLabel =
      savePool === 'character' ? characterMemoryLabel(memoryCharacterKind) : '记忆'
    setMemoryConfirm(false)
    setMemorySelect({ active: false, ids: new Set() })
    if (result.created === 0) {
      showToast(
        result.skipped > 0
          ? `选中的内容已经有相同的${savedLabel}，没有重复保存`
          : '没有可保存的消息'
      )
      return
    }
    showToast(
      result.skipped > 0
        ? `已保存 ${result.created} 张${savedLabel}，未重复保存 ${result.skipped} 张记录`
        : `已保存 ${result.created} 张${savedLabel}，可在记忆面板查看`
    )
  }
  const uploadRetryId = getUploadRetryId(messages, streaming)
  const jumpButton = (
    <JumpToBottomButton
      visible={showJumpToBottom && !editingMessageId}
      streaming={streaming}
      resetKey={session.id}
      onClick={jumpToBottom}
    />
  )
  return (
    <ScrollToBottomContext.Provider value={stopFollowing}>
      <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
        <div
          ref={scrollAreaRef}
          className={styles.scrollArea}
          data-side-shift={android ? 'center' : undefined}
        >
          <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
            <div
              ref={contentRef}
              className={styles.column}
              data-editing-session={editingMessageId ? 'true' : undefined}
            >
              {start > 0 ? (
                <div className={styles.loadEarlierRow}>
                  <button type="button" className={styles.loadEarlierBtn} onClick={loadEarlier}>
                    {t('loadEarlierMessages', { count: start })}
                  </button>
                </div>
              ) : null}
              {messages.slice(start, end).map((message, offset) => {
                const index = start + offset
                const highlightNonce =
                  searchHighlight?.sessionId === session.id &&
                  searchHighlight.messageId === message.id
                    ? searchHighlight.nonce
                    : null
                const selected = memorySelect.active && memorySelect.ids.has(message.id)
                return (
                  <div
                    key={message.id}
                    className={styles.memorySelectRow}
                    data-memory-selecting={memorySelect.active ? 'true' : undefined}
                    data-memory-selected={selected ? 'true' : undefined}
                    onClickCapture={
                      memorySelect.active
                        ? (event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            toggleMemorySelected(message.id)
                          }
                        : undefined
                    }
                    onContextMenuCapture={
                      memorySelect.active
                        ? (event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            toggleMemorySelected(message.id)
                          }
                        : undefined
                    }
                  >
                    {memorySelect.active ? (
                      <span
                        className={styles.memorySelectMark}
                        data-on={selected ? 'true' : undefined}
                      >
                        {selected ? '✓' : null}
                      </span>
                    ) : null}
                    {message.role === 'user' ? (
                      <UserMessage
                        sessionId={session.id}
                        message={message}
                        retryUploadId={uploadRetryId}
                        isFirst={index === 0}
                        isLast={index === lastIndex || index === lastIndex - 1}
                        busy={streaming}
                        editingTarget={editingMessageId === message.id}
                        searchHighlightNonce={highlightNonce}
                        versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                        onSelectVersion={selectVersion}
                        onStartMemorySelect={startMemorySelect}
                      />
                    ) : (
                      <AssistantMessage
                        sessionId={session.id}
                        message={message}
                        isLast={index === lastIndex}
                        streaming={streaming && index === lastIndex}
                        busy={streaming}
                        activeCard={displayCard}
                        cardAvatar={displayCard ? (cardAvatars[displayCard.id] ?? null) : null}
                        characterAvatar={characterAvatar}
                        characterName={characterName}
                        searchHighlightNonce={highlightNonce}
                        versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                        onSelectVersion={selectVersion}
                        onStartMemorySelect={startMemorySelect}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          {isMobile ? (
            <div ref={jumpSlotRef} className={styles.mobileJumpSlot}>
              {jumpButton}
            </div>
          ) : null}
        </div>
        {memorySelect.active ? (
          <div className={styles.memoryBar}>
            <span className={styles.memoryBarInfo}>
              已选 {memorySelectedCount} / {messages.length} 条
            </span>
            <button type="button" className={styles.memoryBarButton} onClick={selectAllMemory}>
              {memoryAllSelected ? '取消全选' : '全选'}
            </button>
            <button type="button" className={styles.memoryBarSecondary} onClick={exitMemorySelect}>
              退出
            </button>
            <button
              type="button"
              className={styles.memoryBarPrimary}
              disabled={memorySelectedCount === 0}
              onClick={openMemoryConfirm}
            >
              保存为记忆
            </button>
          </div>
        ) : null}
        {isMobile ? (
          footer
        ) : (
          <div ref={desktopFooterRef} className={styles.desktopFooter}>
            <div ref={jumpSlotRef} className={styles.desktopJumpSlot}>
              {jumpButton}
            </div>
            {footer}
          </div>
        )}
        {tokenLimit > 0 && !chipHidden && actualUsed > 0 ? (
          <TokenUsageChip
            used={actualUsed}
            limit={tokenLimit}
            onClose={() => {
              dismissTokenUsageChip()
              setChipHidden(true)
            }}
          />
        ) : null}
        <TokenLimitDialog
          open={tokenWarning !== null}
          limit={tokenWarning?.limit ?? 0}
          used={tokenWarning?.used ?? 0}
          onClose={() => setTokenWarning(null)}
        />
      </div>
      {memoryConfirm
        ? createPortal(
            <div className={styles.memoryConfirmBackdrop} onClick={() => setMemoryConfirm(false)}>
              <section
                className={styles.memoryConfirmCard}
                role="dialog"
                aria-modal="true"
                aria-label="保存为记忆"
                onClick={(event) => event.stopPropagation()}
              >
                <strong className={styles.memoryConfirmTitle}>保存为记忆</strong>
                <p className={styles.memoryConfirmText}>
                  已选 {memorySelectedCount}{' '}
                  条消息。角色记忆可存完整回合，也可以只把其中一段场景或事实拆出来独立记住；普通记忆每条独立保存，适合开发、问答与代码。
                </p>
                <div className={styles.memoryConfirmPools} role="radiogroup" aria-label="记忆分类">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={memoryPool === 'character'}
                    data-active={memoryPool === 'character'}
                    onClick={() => setMemoryPool('character')}
                  >
                    角色记忆
                    <small>剧情 · 场景 · 事实</small>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={memoryPool === 'normal'}
                    data-active={memoryPool === 'normal'}
                    disabled={characterMemoryActive}
                    onClick={() => setMemoryPool('normal')}
                  >
                    普通记忆
                    <small>{characterMemoryActive ? '当前显示角色名，普通池暂停写入' : '开发 · 问答 · 代码'}</small>
                  </button>
                </div>
                {memoryPool === 'character' ? (
                  <div
                    className={styles.memoryConfirmKinds}
                    role="radiogroup"
                    aria-label="角色记忆类型"
                  >
                    {CHARACTER_MEMORY_KINDS.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        role="radio"
                        aria-checked={memoryCharacterKind === kind}
                        data-active={memoryCharacterKind === kind}
                        onClick={() => chooseMemoryCharacterKind(kind)}
                      >
                        {characterMemoryLabel(kind)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div
                    className={styles.memoryConfirmKinds}
                    role="radiogroup"
                    aria-label="普通记忆子分类"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={memoryKind === 'auto'}
                      data-active={memoryKind === 'auto'}
                      onClick={() => setMemoryKind('auto')}
                    >
                      自动识别
                    </button>
                    {NORMAL_MEMORY_KINDS.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        role="radio"
                        aria-checked={memoryKind === kind}
                        data-active={memoryKind === kind}
                        onClick={() => setMemoryKind(kind)}
                      >
                        {normalMemoryLabel(kind)}
                      </button>
                    ))}
                  </div>
                )}
                {memoryPool === 'character' ? (
                  <div
                    className={styles.memoryConfirmKinds}
                    role="radiogroup"
                    aria-label="记忆归属"
                  >
                    {MEMORY_OWNERS.map((owner) => (
                      <button
                        key={owner}
                        type="button"
                        role="radio"
                        aria-checked={memoryOwner === owner}
                        data-active={memoryOwner === owner}
                        onClick={() => setMemoryOwner(owner)}
                      >
                        {memoryOwnerLabel(owner)}
                      </button>
                    ))}
                  </div>
                ) : null}
                {memoryPool === 'character' && memoryCharacterKind !== 'turn' ? (
                  <div className={styles.memoryConfirmEditor}>
                    <label htmlFor="memory-confirm-draft">
                      {memoryCharacterKind === 'scene'
                        ? '场景摘录 · 可删改成地点、人物、事件和关键细节'
                        : '关键事实 · 可删改成姓名、关系、喜好或承诺'}
                    </label>
                    <textarea
                      id="memory-confirm-draft"
                      rows={5}
                      maxLength={8000}
                      value={memoryDraft}
                      onChange={(event) => setMemoryDraft(event.target.value)}
                      placeholder={
                        memoryCharacterKind === 'scene'
                          ? '例如：雨夜，旧书店门口，她第一次把伞递给你。'
                          : '例如：她答应每周三晚上留出时间陪你。'
                      }
                    />
                    <small>已带入选中原文，只保留必须记住的部分；不会自动删除任何对话。</small>
                  </div>
                ) : null}
                <p className={styles.memoryConfirmText}>
                  {characterMemoryActive
                    ? '当前显示名是角色名，代码和整轮内容只写入角色记忆，普通记忆暂停保存；要存普通开发记忆，先把角色名字恢复为 AI / DeepSeek，或清空系统提示词。'
                    : memoryPool === 'normal'
                      ? '自动识别会把三连反引号代码块归入「代码」，用户消息归入「用户原话」，AI 回复归入「AI 原话」；也可以手动指定。'
                      : memoryCharacterKind === 'scene'
                        ? '重要场景独立成卡，每轮优先带回，不占自动配额；同一段文字重复保存不会新增。'
                        : memoryCharacterKind === 'fact'
                          ? '关键事实独立成卡，当作稳定设定长期保留；相同文字重复保存不会新增。'
                          : '完整回合保留用户与角色原话；同一轮已有整段卡时不重复保存。'}
                </p>
                <div className={styles.memoryConfirmActions}>
                  <button
                    type="button"
                    className={styles.memoryConfirmCancel}
                    onClick={() => setMemoryConfirm(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className={styles.memoryConfirmPrimary}
                    disabled={
                      memoryPool === 'character' &&
                      memoryCharacterKind !== 'turn' &&
                      !memoryDraft.trim()
                    }
                    onClick={confirmSaveMemory}
                  >
                    保存
                  </button>
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
    </ScrollToBottomContext.Provider>
  )
}

/* ============================================================================
 * 功能区：消息渲染 / MessageList 结束
 * ========================================================================== */
