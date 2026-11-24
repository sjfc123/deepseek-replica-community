import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { android } from '../../app/android.js'
import { useIsMobile } from '../../app/viewport.js'
import {
  buildMessageVersions,
  getVisibleMessages,
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
  detectCodeBlock,
  NORMAL_MEMORY_KINDS,
  normalMemoryLabel,
  type MemoryPool,
  type NormalMemoryKind,
} from '../../services/chat/memory.js'
import { findActiveCharacterCard, findSessionCharacterCard } from '../../services/chat/roleplay.js'
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
const INITIAL_MESSAGES = 4
const OLDER_MESSAGES = 8
const OLDER_THRESHOLD = 320
const SEARCH_JUMP_TOP_OFFSET = 10
const SEARCH_JUMP_SETTLE_MS = 650
const SEARCH_HIGHLIGHT_MS = 1800

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
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
  const roleplayActive =
    Boolean(findSessionCharacterCard(characterCards, session)) ||
    (roleplayEnabled && Boolean(findActiveCharacterCard(characterCards, activeCharacterId)))
  const tokenLimit = useSettings((state) => state.tokenLimit)
  const [tokenWarning, setTokenWarning] = useState<{ limit: number; used: number } | null>(null)
  const [chipHidden, setChipHidden] = useState(() => tokenUsageChipDismissed())
  useEffect(() => {
    setChipHidden(tokenUsageChipDismissed())
  }, [tokenLimit])
  const actualUsed = tokenLimit > 0 ? sessionActualUsage(session) : 0
  useEffect(() => {
    if (!tokenLimit || streaming) {
      setTokenWarning(null)
      return
    }
    const used = sessionActualUsage(session)
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
  }, [session, tokenLimit, streaming])
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
  useEffect(() => {
    setMemorySelect({ active: false, ids: new Set() })
    setMemoryConfirm(false)
  }, [session.id])
  const pendingJumpIndex = pendingJump
    ? messages.findIndex((message) => message.id === pendingJump.messageId)
    : -1
  const latestStart = Math.max(0, messages.length - INITIAL_MESSAGES)
  const requiredStart =
    pendingJumpIndex >= 0 ? Math.min(latestStart, Math.max(0, pendingJumpIndex - 1)) : latestStart
  const [messageWindow, setMessageWindow] = useState({
    sessionId: session.id,
    start: requiredStart,
  })
  const start =
    messageWindow.sessionId === session.id
      ? Math.min(messageWindow.start, requiredStart)
      : requiredStart
  if (messageWindow.sessionId !== session.id || messageWindow.start !== start) {
    setMessageWindow({ sessionId: session.id, start })
  }
  const prependAnchor = useRef<{ element: Element; top: number } | null>(null)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
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
  }, [cancelJump])
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

  // 首屏从最近几条消息开始。向上浏览时逐批补齐，保持原来的阅读位置。
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
    if (!start) {
      return
    }

    let frame = 0
    const loadOlder = () => {
      if (frame || jumpingRef.current) {
        return
      }
      frame = requestAnimationFrame(() => {
        frame = 0
        if (jumpingRef.current) {
          return
        }
        const fits = scroll.scrollHeight - scroll.clientHeight <= STICKY_THRESHOLD
        if (!fits && (stickyRef.current || scroll.scrollTop > OLDER_THRESHOLD)) {
          return
        }
        const element = content.firstElementChild
        if (element) {
          prependAnchor.current = { element, top: element.getBoundingClientRect().top }
        }
        setMessageWindow({ sessionId: session.id, start: Math.max(0, start - OLDER_MESSAGES) })
      })
    }
    const observer = new ResizeObserver(loadOlder)
    observer.observe(scroll)
    observer.observe(content)
    scroll.addEventListener('scroll', loadOlder, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      scroll.removeEventListener('scroll', loadOlder)
    }
  }, [isMobile, session.id, start])

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
    scrollToBottom()
  }, [session.id, lastMessageId, cancelJump, scrollToBottom, updateJumpVisibility])

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
  const roundMessageIds = (id: string) => {
    const index = messages.findIndex((message) => message.id === id)
    if (index < 0) {
      return [id]
    }
    if (messages[index].role === 'user') {
      const reply = messages[index + 1]
      return reply?.role === 'assistant' ? [id, reply.id] : [id]
    }
    const prompt = messages[index - 1]
    return prompt?.role === 'user' ? [prompt.id, id] : [id]
  }
  const startMemorySelect = (id: string, scope: 'one' | 'all') => {
    setMemoryConfirm(false)
    setMemoryPool('character')
    setMemoryKind('auto')
    setMemorySelect({
      active: true,
      ids: new Set(scope === 'all' ? messages.map((message) => message.id) : roundMessageIds(id)),
    })
  }
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
    const picked = messages.filter(
      (message) => memorySelect.active && memorySelect.ids.has(message.id)
    )
    const hasCode = picked.some((message) =>
      detectCodeBlock(
        message.role === 'assistant'
          ? message.blocks
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('\n')
          : message.content
      )
    )
    // 角色扮演中，代码只属于角色剧情，不能因为出现三连反引号就预选普通记忆
    setMemoryPool(roleplayActive ? 'character' : hasCode ? 'normal' : 'character')
    setMemoryKind('auto')
    setMemoryConfirm(true)
  }
  const confirmSaveMemory = () => {
    const savePool: MemoryPool = roleplayActive ? 'character' : memoryPool
    const result = saveMessagesAsMemory(
      session.id,
      Array.from(memorySelect.ids),
      savePool === 'normal'
        ? { pool: 'normal', category: memoryKind }
        : { pool: 'character' }
    )
    setMemoryConfirm(false)
    setMemorySelect({ active: false, ids: new Set() })
    if (result.created === 0) {
      showToast(
        result.skipped > 0
          ? `选中的内容已经有 ${result.skipped} 张整段记忆卡，没有重复保存`
          : '没有可保存的消息'
      )
      return
    }
    showToast(
      result.skipped > 0
        ? `已保存 ${result.created} 张记忆卡，跳过 ${result.skipped} 张已有记录`
        : `已保存 ${result.created} 张记忆卡，可在记忆面板查看`
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
              {messages.slice(start).map((message, offset) => {
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
                        onStartMemorySelect={(scope) => startMemorySelect(message.id, scope)}
                      />
                    ) : (
                      <AssistantMessage
                        sessionId={session.id}
                        message={message}
                        isLast={index === lastIndex}
                        streaming={streaming && index === lastIndex}
                        busy={streaming}
                        searchHighlightNonce={highlightNonce}
                        versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                        onSelectVersion={selectVersion}
                        onStartMemorySelect={(scope) => startMemorySelect(message.id, scope)}
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
                <strong className={styles.memoryConfirmTitle}>保存为记忆？</strong>
                <p className={styles.memoryConfirmText}>
                  已选 {memorySelectedCount} 条消息。先选分类：角色记忆按轮保存剧情与时间线；普通记忆每条独立保存，更适合开发、问答和代码检索。
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
                    <small>剧情 · 时间线 · 好感</small>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={memoryPool === 'normal'}
                    data-active={memoryPool === 'normal'}
                    disabled={roleplayActive}
                    onClick={() => setMemoryPool('normal')}
                  >
                    普通记忆
                    <small>{roleplayActive ? '角色扮演中暂停写入' : '开发 · 问答 · 代码'}</small>
                  </button>
                </div>
                {memoryPool === 'normal' ? (
                  <div className={styles.memoryConfirmKinds} role="radiogroup" aria-label="普通记忆子分类">
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
                ) : null}
                <p className={styles.memoryConfirmText}>
                  {roleplayActive
                    ? '角色扮演开启时，角色写的代码和整轮内容只写入角色记忆，普通记忆暂停保存；需要存开发代码时先关闭角色扮演。'
                    : memoryPool === 'normal'
                      ? '自动识别会把三连反引号代码块归入「代码」，用户消息归入「用户原话」，AI 回复归入「AI 原话」；也可以手动指定。'
                      : '同一轮已有整段角色卡会跳过；超出分类配额时归档最早的自动卡，不会保存失败。这里只处理记忆保存，不含分享。'}
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
