/* ============================================================================
 * 功能区：输入与语音控件 / ChatInput 开始
 * 职责：聊天输入容器：文本、附件、发送/停止、工具入口与草稿恢复。
 * ========================================================================== */

import clsx from 'clsx'
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { create } from 'zustand'
import { createPortal } from 'react-dom'
import { android } from '../../app/android.js'
import { useAndroidBackInterception } from '../../app/useAndroidBackInterception.js'
import {
  IconCloseOutline16,
  IconGlobeLanguageOutline14,
  IconLightOutline16,
  IconPaperclipOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import { setSearch, setThinking, setThinkingEffort, useSettings } from '../../services/settings.js'
import { hasAside, splitAsides } from '../../services/chat/aside.js'
import { useIsMobile } from '../../app/viewport.js'
import { editMessage, sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import { generateReplySuggestions } from '../../services/chat/suggestions.js'
import {
  currentStoryClue,
  formatStoryClock,
  formatStoryRemaining,
  isStoryLocked,
  storyCluesUntil,
} from '../../services/chat/story.js'
import {
  findSessionCharacterCard,
} from '../../services/chat/roleplay.js'
import {
  addDraftFiles,
  addEditFiles,
  cancelMessageEdit,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  removeEditAttachment,
  replaceDraftImage,
  replaceEditImage,
  retryDraftAttachment,
  retryEditAttachment,
  setDraftText,
  setEditDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { AndroidCircle } from '../base/AndroidIcons.js'
import { Tooltip } from '../base/Tooltip.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { SessionActionDialog } from '../sider/SessionActionDialog.js'
import { generateIllustration } from '../../services/illustration/generate.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { VoiceButton } from './VoiceButton.js'
import { Spectrum } from './Spectrum.js'
import { AndroidAttachments } from './AndroidAttachments.js'
import { AndroidDraftAttachments } from './AndroidDraftAttachments.js'
import { AndroidImageViewer } from '../files/AndroidImageViewer.js'
import { AndroidVoiceOverlay } from './AndroidVoiceOverlay.js'
import { useHoldToTalk } from './useHoldToTalk.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

const useVoiceMode = create<{ enabled: boolean }>(() => ({ enabled: false }))

/** 思考强度面板的星点与流星位置：固定分布，避免每次打开重新洗牌 */
const EFFORT_STARS = [
  { left: 6, top: 16, size: 2, delay: 0.4 },
  { left: 15, top: 68, size: 1, delay: 1.1 },
  { left: 24, top: 26, size: 1, delay: 0.8 },
  { left: 33, top: 74, size: 2, delay: 1.6 },
  { left: 42, top: 14, size: 1, delay: 0.2 },
  { left: 51, top: 58, size: 1, delay: 1.9 },
  { left: 59, top: 30, size: 2, delay: 1.3 },
  { left: 68, top: 78, size: 1, delay: 0.6 },
  { left: 76, top: 20, size: 1, delay: 2.1 },
  { left: 84, top: 62, size: 2, delay: 0.9 },
  { left: 92, top: 34, size: 1, delay: 1.5 },
  { left: 10, top: 46, size: 1, delay: 2.4 },
  { left: 37, top: 50, size: 1, delay: 0.3 },
  { left: 64, top: 48, size: 1, delay: 1.7 },
  { left: 87, top: 84, size: 1, delay: 1.0 },
  { left: 47, top: 86, size: 2, delay: 2.2 },
  { left: 20, top: 88, size: 1, delay: 0.5 },
  { left: 71, top: 8, size: 1, delay: 1.2 },
] as const

const EFFORT_METEORS = [
  { left: '18%', top: '18%', duration: 2.4, delay: 0 },
  { left: '48%', top: '8%', duration: 2.1, delay: 0.7 },
  { left: '76%', top: '22%', duration: 2.6, delay: 1.4 },
  { left: '32%', top: '42%', duration: 2.2, delay: 1.9 },
  { left: '62%', top: '38%', duration: 2.5, delay: 2.4 },
  { left: '88%', top: '48%', duration: 2.3, delay: 1.1 },
] as const

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 语音输入 + 发送 / 停止 */
/* -------------------- 功能区：聊天输入入口与语音浮层 开始 -------------------- */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

/* -------------------- 功能区：聊天输入入口与语音浮层 结束 -------------------- */

/* -------------------- 功能区：输入控件主体 开始 -------------------- */
const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const editing = useDrafts((state) =>
    android && sessionId !== null && state.editing?.sessionId === sessionId ? state.editing : null
  )
  const editingHere = editing !== null
  const activeDraft = editing ?? draft
  const { text, attachments } = activeDraft
  const customEndpoint = useSettings((state) => Boolean(state.chatConfig.endpoint))
  const apiKey = useSettings((state) => state.apiKey)
  const uploadKey = customEndpoint ? null : apiKey
  const isEditingTarget = useCallback(
    () =>
      Boolean(
        android && sessionId !== null && useDrafts.getState().editing?.sessionId === sessionId
      ),
    [sessionId]
  )
  const setText = (value: string) => {
    if (isEditingTarget()) {
      setEditDraftText(value)
    } else {
      setDraftText(sessionId, value)
    }
  }
  const draftReady = useUploads(
    (state) => prepareDraftMessage(activeDraft, state.tasks, customEndpoint) !== null
  )
  const imagesUploading = useUploads(
    (state) =>
      !customEndpoint &&
      attachments.some(
        (item) =>
          item.isImage &&
          !item.existing &&
          (!state.tasks[item.id] || state.tasks[item.id].status === 'uploading')
      )
  )
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const thinkingEffort = useSettings((state) => state.thinkingEffort)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const thoughtAside = useSettings((state) => state.thoughtAside)
  const [illustrating, setIllustrating] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  const [effortValue, setEffortValue] = useState(50)
  const [effortAnchor, setEffortAnchor] = useState<{ left: number; top: number } | null>(null)
  const effortTimer = useRef<number | null>(null)
  const thinkButtonRef = useRef<HTMLButtonElement>(null)
  const effortOpenedAt = useRef(0)
  const suppressThinkClickUntil = useRef(0)
  const thinkPressStart = useRef({ x: 0, y: 0 })
  const [illustrationPrompt, setIllustrationPrompt] = useState('')
  const [illustrationUrl, setIllustrationUrl] = useState<string | null>(null)
  const [illustrationBusy, setIllustrationBusy] = useState(false)
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  const [suggestionLoading, setSuggestionLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const suggestionAbort = useRef<AbortController | null>(null)
  const session = useChatStore((state) => (sessionId ? state.sessionCache[sessionId] : undefined))
  const characterCards = useSettings((state) => state.characterCards)
  const activeCard = findSessionCharacterCard(characterCards, session)
  const story = activeCard?.story
  const storyLocked = isStoryLocked(session)
  const storyClock =
    story && session?.storyClockMinute !== undefined
      ? formatStoryClock(session.storyClockMinute)
      : ''
  const storyRemaining =
    story && session?.storyClockMinute !== undefined
      ? formatStoryRemaining(session.storyClockMinute, story.deadlineMinute)
      : ''
  const storyEnd = session?.storyState
  const storyClue = story && session?.storyClockMinute !== undefined
    ? currentStoryClue(story, session.storyClockMinute)
    : undefined
  const revealedClues = story && session?.storyClockMinute !== undefined
    ? storyCluesUntil(story, session.storyClockMinute)
    : []
  const [storyNoticeClosed, setStoryNoticeClosed] = useState(false)
  const [cluesOpen, setCluesOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)

  const clearEffortTimer = () => {
    if (effortTimer.current !== null) {
      window.clearTimeout(effortTimer.current)
      effortTimer.current = null
    }
  }

  const openEffortPanel = () => {
    if (!thinking) {
      return
    }
    const initial = thinkingEffort === 'low' ? 0 : thinkingEffort === 'max' ? 100 : 50
    const rect = thinkButtonRef.current?.getBoundingClientRect()
    const composer = thinkButtonRef.current?.closest(`.${styles.composer}`)
    const composerTop = composer?.getBoundingClientRect().top
    const half = 120
    const left = rect
      ? Math.min(Math.max(rect.left + rect.width / 2, 12 + half), window.innerWidth - 12 - half)
      : window.innerWidth / 2
    const top = composerTop
      ? Math.max(8, composerTop - 64)
      : rect
        ? Math.max(8, rect.top - 136)
        : 240
    setEffortAnchor({ left, top })
    setEffortValue(initial)
    setEffortOpen(true)
    effortOpenedAt.current = Date.now()
  }

  const updateEffort = (value: number) => {
    setEffortValue(value)
    setThinkingEffort(value <= 25 ? 'low' : value >= 75 ? 'max' : 'high')
  }

  useEffect(() => {
    if (!thinking) {
      setEffortOpen(false)
    }
  }, [thinking])

  useEffect(() => {
    setStoryNoticeClosed(false)
    setSuggestionOpen(false)
    setSuggestions([])
    suggestionAbort.current?.abort()
    suggestionAbort.current = null
    return () => {
      suggestionAbort.current?.abort()
      suggestionAbort.current = null
    }
  }, [sessionId, storyEnd])

  useEffect(() => {
    if (!effortOpen) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEffortOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [effortOpen])

  useEffect(() => () => clearEffortTimer(), [])
  const voiceMode = useVoiceMode((state) => state.enabled) && !editingHere
  const [showAttachments, setShowAttachments] = useState(false)
  const [previewId, setPreviewId] = useState<string>()
  const preview = attachments.find((item) => item.id === previewId)
  const [typing, setTyping] = useState(false)
  const sendSpoken = useRef(false)

  useEffect(() => {
    if (!uploadKey) {
      return
    }
    for (const item of attachments) {
      if (!item.existing && !useUploads.getState().tasks[item.id]) {
        if (editingHere) {
          retryEditAttachment(item.id, uploadKey)
        } else {
          retryDraftAttachment(sessionId, item.id, uploadKey)
        }
      }
    }
  }, [attachments, editingHere, sessionId, uploadKey])

  useEffect(() => {
    if (!apiKey) {
      useVoiceMode.setState({ enabled: false })
    }
  }, [apiKey])

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    if (android) {
      toggles.classList.remove(styles.collapsedToggles)
      const updateFade = () => {
        const overflow = toggles.scrollWidth - toggles.clientWidth > 1
        const fadeLeft = overflow && toggles.scrollLeft > 1
        const fadeRight =
          overflow && toggles.scrollLeft + toggles.clientWidth < toggles.scrollWidth - 1
        const fade = fadeLeft && fadeRight ? 'both' : fadeRight ? 'right' : fadeLeft ? 'left' : ''
        if (fade) {
          toggles.dataset.fade = fade
        } else {
          delete toggles.dataset.fade
        }
      }

      updateFade()
      const observer = new ResizeObserver(updateFade)
      observer.observe(toggles)
      toggles.addEventListener('scroll', updateFade, { passive: true })
      return () => {
        observer.disconnect()
        toggles.removeEventListener('scroll', updateFade)
        delete toggles.dataset.fade
      }
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [customEndpoint, t])

  const acceptFiles = (files: File[], recentPhotoId?: string) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = isEditingTarget()
      ? addEditFiles(files, uploadKey, recentPhotoId)
      : addDraftFiles(sessionId, files, uploadKey, recentPhotoId)
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && uploadKey && ensureApiKey(true)) {
        if (isEditingTarget()) {
          retryEditAttachment(id, uploadKey)
        } else {
          retryDraftAttachment(sessionId, id, uploadKey)
        }
      }
    },
    [isEditingTarget, sessionId, uploadKey]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        if (isEditingTarget()) {
          removeEditAttachment(id)
        } else {
          removeDraftAttachment(sessionId, id)
        }
      }
    },
    [isEditingTarget, sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = isEditingTarget()
      ? (useDrafts.getState().editing?.text ?? '')
      : getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    if (sendSpoken.current) {
      sendSpoken.current = false
      if (!useChatStore.getState().importingHistory && ensureApiKey() && !isEditingTarget()) {
        stopReadAloud()
        sendMessage(sessionId)
      }
      return
    }
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })
  const hold = useHoldToTalk(voice, () => {
    if (importingHistory || streaming || !ensureApiKey(true)) {
      return false
    }
    setShowAttachments(false)
    sendSpoken.current = true
    return true
  })

  // 欢迎页导入不改变会话 ID，无法依赖卸载取消语音；订阅开始事件同样覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
          setPreviewId(undefined)
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = voice.status === 'recording'
  const voiceOverlayActive = recording || voice.status === 'transcribing'

  const focusComposer = useCallback(() => {
    setShowAttachments(false)
    useVoiceMode.setState({ enabled: false })
    if (android) {
      setTyping(true)
    }
    textareaRef.current?.focus({ preventScroll: true })
    requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }))
  }, [])

  const editingMessageId = editing?.messageId
  useLayoutEffect(() => {
    if (!editingMessageId) {
      return
    }
    cancelVoice()
    setShowAttachments(false)
    useVoiceMode.setState({ enabled: false })
    setTyping(true)
    const textarea = textareaRef.current
    if (textarea) {
      textarea.focus({ preventScroll: true })
      const end = textarea.value.length
      textarea.setSelectionRange(end, end)
      textarea.scrollTop = textarea.scrollHeight
    }
  }, [cancelVoice, editingMessageId])

  useEffect(() => {
    if (!android) {
      return
    }
    const onFocusRequest = (event: Event) => {
      if ((event as CustomEvent<string>).detail === sessionId) {
        focusComposer()
      }
    }
    const onDismissExtras = () => {
      setShowAttachments(false)
      textareaRef.current?.blur()
    }
    window.addEventListener('android-focus-composer', onFocusRequest)
    window.addEventListener('android-close-attachments', onDismissExtras)
    return () => {
      window.removeEventListener('android-focus-composer', onFocusRequest)
      window.removeEventListener('android-close-attachments', onDismissExtras)
    }
  }, [focusComposer, sessionId])

  // 排队、上传中与上传失败的附件均保留在输入框，全部上传成功后方可发送
  const canSend = !importingHistory && !streaming && !storyLocked && voice.status === 'idle' && draftReady
  const showSend = !android || editingHere || streaming || draftReady || typing

  useAndroidBackInterception(showAttachments || editingHere)
  useEffect(() => {
    if (!showAttachments && !editingHere) {
      return
    }
    const closeOnBack = (event: Event) => {
      if (event.defaultPrevented) {
        return
      }
      event.preventDefault()
      if (showAttachments) {
        setShowAttachments(false)
        return
      }
      textareaRef.current?.blur()
      cancelMessageEdit()
    }
    window.addEventListener('android-back', closeOnBack)
    return () => window.removeEventListener('android-back', closeOnBack)
  }, [showAttachments, editingHere])

  useEffect(() => {
    if (!android) {
      return
    }
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      const textarea = textareaRef.current
      if (!root.hasAttribute('data-keyboard') && document.activeElement === textarea) {
        textarea?.blur()
      }
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-keyboard'] })
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (!android || !typing) {
      return
    }
    textareaRef.current?.focus({ preventScroll: true })
  }, [typing])

  const send = () => {
    if (useChatStore.getState().importingHistory || storyLocked || voice.status !== 'idle') {
      return
    }
    const currentEditing = useDrafts.getState().editing
    if (android && sessionId !== null && currentEditing?.sessionId === sessionId) {
      const prepared = prepareDraftMessage(
        currentEditing,
        useUploads.getState().tasks,
        customEndpoint
      )
      if (
        !prepared ||
        !ensureApiKey() ||
        !editMessage(sessionId, currentEditing.messageId, prepared.text, prepared.files)
      ) {
        return
      }
      setShowAttachments(false)
      stopReadAloud()
      textareaRef.current?.blur()
      return
    }
    if (!prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks, customEndpoint)) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    setShowAttachments(false)
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  const requestSuggestions = async () => {
    if (!sessionId || suggestionLoading || storyLocked || !activeCard) {
      return
    }
    if (!ensureApiKey()) {
      return
    }
    suggestionAbort.current?.abort()
    const controller = new AbortController()
    suggestionAbort.current = controller
    setSuggestionOpen(true)
    setSuggestionLoading(true)
    try {
      const list = await generateReplySuggestions({
        sessionId,
        draft: text,
        signal: controller.signal,
      })
      if (!controller.signal.aborted) {
        setSuggestions(list)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setSuggestionOpen(false)
        showToast(t('replySuggestionsFailed'))
      }
    } finally {
      if (suggestionAbort.current === controller) {
        suggestionAbort.current = null
        setSuggestionLoading(false)
      }
    }
  }

  const chooseSuggestion = (value: string) => {
    setText(value)
    setSuggestionOpen(false)
    focusComposer()
  }

  const photoSuggestions = !!android && !text.trim() && attachments.some((item) => item.isImage)
  const viewerBlob = preview ? (preview.file ?? preview.blob ?? undefined) : undefined

  return (
    <div className={styles.composer} data-photo-suggestions={photoSuggestions ? '' : undefined}>
      {story && storyClock ? (
        <div className={clsx(styles.storyBar, storyLocked && styles.storyBarLocked)}>
          <span className={styles.storyDot} aria-hidden />
          <span className={styles.storyClock}>{t('storyClockLabel', { time: storyClock })}</span>
          <span className={styles.storyRemaining}>
            {storyLocked ? t('storyLockedPlaceholder') : t('storyRemainingLabel', { time: storyRemaining })}
          </span>
          {story.clues?.length ? (
            <button
              type="button"
              className={styles.storyCluesButton}
              onClick={() => setCluesOpen(true)}
            >
              <IconSearchOutline16 />
              {t('storyCluesLabel', {
                done: storyClue ? storyClue.index + 1 : 0,
                total: storyClue?.total ?? story.clues.length,
              })}
            </button>
          ) : null}
        </div>
      ) : null}
      {suggestionOpen && activeCard && !storyLocked ? (
        <div className={styles.suggestions} data-drawer-gesture-ignore="">
          <div className={styles.suggestionHeader}>
            <span className={styles.suggestionTitle}>
              <IconLightOutline16 />
              {t('replySuggestions')}
            </span>
            <span className={styles.suggestionActions}>
              <button
                type="button"
                className={styles.suggestionRefresh}
                disabled={suggestionLoading}
                onClick={() => void requestSuggestions()}
              >
                <IconRefreshOutline16 />
                {t('replySuggestionsRefresh')}
              </button>
              <IconButton
                size="xs"
                tone="primary"
                icon={<IconCloseOutline16 />}
                aria-label={t('close')}
                onClick={() => setSuggestionOpen(false)}
              />
            </span>
          </div>
          {suggestionLoading ? (
            <div className={styles.suggestionLoading}>{t('replySuggestionsLoading')}</div>
          ) : (
            <div className={styles.suggestionList}>
              {suggestions.map((item, index) => (
                <button
                  key={`${index}-${item}`}
                  type="button"
                  className={styles.suggestionItem}
                  onClick={() => chooseSuggestion(item)}
                >
                  <span className={styles.suggestionIndex}>{index + 1}</span>
                  <span>{item}</span>
                </button>
              ))}
            </div>
          )}
          <div className={styles.suggestionHint}>{t('replySuggestionsHint')}</div>
        </div>
      ) : null}
      <div
        data-drawer-gesture-ignore=""
        data-editing={editingHere ? 'true' : undefined}
        className={clsx(
          styles.wrapper,
          sessionId === null ? styles.home : styles.session,
          android && voiceOverlayActive && styles.recordingCard
        )}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            focusComposer()
          }
        }}
      >
        {editingHere ? (
          <div className={styles.editBanner}>
            <span className={styles.editLabel}>{t('androidEditingMessage')}</span>
            <button
              type="button"
              className={styles.editClose}
              aria-label={t('cancel')}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                textareaRef.current?.blur()
                cancelMessageEdit()
              }}
            >
              <IconCloseOutline16 />
            </button>
          </div>
        ) : null}
        {android ? (
          <AndroidDraftAttachments
            items={attachments}
            suggestions={photoSuggestions}
            loading={imagesUploading}
            localOnly={customEndpoint}
            canSend={canSend}
            onRetry={retryFile}
            onRemove={removeFile}
            onPreview={(id) => {
              textareaRef.current?.blur()
              setPreviewId(id)
            }}
            onSuggestion={(message) => {
              const latestText = isEditingTarget()
                ? (useDrafts.getState().editing?.text ?? '')
                : getDraft(sessionId).text
              if (!canSend || latestText.trim()) {
                return
              }
              setText(message)
              send()
            }}
          />
        ) : (
          <DraftAttachments
            items={attachments}
            localOnly={customEndpoint}
            onRetry={retryFile}
            onRemove={removeFile}
          />
        )}
        <div
          className={styles.textareaWrapper}
          onClick={(event) => {
            if (android && event.target === event.currentTarget) {
              focusComposer()
            }
          }}
        >
          {android && voiceMode ? (
            <button
              type="button"
              className={styles.holdButton}
              disabled={importingHistory || streaming || storyLocked}
              {...hold.direct}
              onPointerDown={(event) => {
                if (voice.status === 'transcribing') {
                  voice.cancel()
                } else {
                  hold.direct.onPointerDown(event)
                }
              }}
            >
              {t(voice.status === 'transcribing' ? 'voiceInputCancel' : 'androidHoldToTalk')}
            </button>
          ) : (
            <textarea
              ref={textareaRef}
              className={clsx(
                styles.textarea,
                thoughtAside && hasAside(text) && styles.textareaWithAside,
                recording && isMobile && styles.textareaHidden
              )}
              placeholder={t(
                storyLocked
                  ? 'storyLockedPlaceholder'
                  : android
                    ? editingHere || typing
                      ? 'androidMessageHint'
                      : 'androidHoldHint'
                    : 'chatInputPlaceholderChat'
              )}
              rows={2}
              // 移动端不自动聚焦，避免一打开就弹出键盘
              autoFocus={!isMobile}
              disabled={importingHistory || storyLocked}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onScroll={(event) => {
                // 镜像层与输入框各自滚动，保持同一偏移，括号置灰才不会错位
                if (mirrorRef.current) {
                  mirrorRef.current.scrollTop = event.currentTarget.scrollTop
                }
                if (mirrorRef.current) {
                  mirrorRef.current.scrollLeft = event.currentTarget.scrollLeft
                }
              }}
              onFocus={() => {
                setTyping(true)
                setShowAttachments(false)
              }}
              onBlur={() => setTyping(false)}
              {...(android && !editingHere ? hold.delayed : {})}
              onPointerDown={(event) => {
                if (android && !editingHere && !text && !typing) {
                  hold.delayed.onPointerDown(event)
                }
              }}
              onContextMenu={(event) => {
                if (recording && android) {
                  event.preventDefault()
                }
              }}
              onMouseDown={(event) => {
                // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
                if (
                  isMobile &&
                  event.button === 0 &&
                  document.activeElement !== event.currentTarget
                ) {
                  event.preventDefault()
                  event.currentTarget.focus({ preventScroll: true })
                }
              }}
              enterKeyHint={android || isMobile ? 'enter' : undefined}
              onKeyDown={(event) => {
                if (
                  !android &&
                  !isMobile &&
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  send()
                }
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files)
                if (files.length > 0) {
                  event.preventDefault()
                  acceptFiles(files)
                }
              }}
            />
          )}
          {recording && isMobile && !android ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
          {voiceMode ? null : (
            <div
              ref={mirrorRef}
              className={clsx(
                styles.mirror,
                thoughtAside && hasAside(text) && styles.mirrorVisible
              )}
              aria-hidden
            >
              {thoughtAside && hasAside(text)
                ? splitAsides(`${text}\n`).map((part, partIndex) =>
                    part.aside ? (
                      <span key={partIndex} className={styles.inputAside}>
                        {part.text}
                      </span>
                    ) : (
                      <Fragment key={partIndex}>{part.text}</Fragment>
                    )
                  )
                : `${text}\n`}
            </div>
          )}
        </div>
        <div className={styles.functionRow}>
          {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
          <div ref={togglesRef} className={styles.toggles}>
            {sessionId && activeCard && !editingHere && !storyLocked ? (
              <Tooltip content={t('replySuggestionsTooltip')}>
                <button
                  type="button"
                  className={styles.toggle}
                  aria-label={t('replySuggestions')}
                  disabled={suggestionLoading || streaming}
                  onClick={() => void requestSuggestions()}
                >
                  <IconLightOutline16 />
                  <span className={styles.toggleLabel}>{t('replySuggestions')}</span>
                </button>
              </Tooltip>
            ) : null}
            {customEndpoint ? null : (
              <>
                <Tooltip content={thinking ? t('thinkLongPressOn') : t('deactivatedThinkTooltip')}>
                  <button
                    ref={thinkButtonRef}
                    type="button"
                    className={clsx(styles.toggle, thinking && styles.selected)}
                    aria-label={t('thinkingSwitch')}
                    aria-pressed={thinking}
                    onClick={() => {
                      if (Date.now() < suppressThinkClickUntil.current) {
                        return
                      }
                      setThinking(!thinking)
                    }}
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerDown={(event) => {
                      clearEffortTimer()
                      thinkPressStart.current = { x: event.clientX, y: event.clientY }
                      if (!thinking) {
                        return
                      }
                      effortTimer.current = window.setTimeout(() => {
                        suppressThinkClickUntil.current = Date.now() + 600
                        openEffortPanel()
                      }, 480)
                    }}
                    onPointerMove={(event) => {
                      const dx = event.clientX - thinkPressStart.current.x
                      const dy = event.clientY - thinkPressStart.current.y
                      if (Math.hypot(dx, dy) > 10) {
                        clearEffortTimer()
                      }
                    }}
                    onPointerUp={clearEffortTimer}
                    onPointerCancel={clearEffortTimer}
                    onPointerLeave={clearEffortTimer}
                  >
                    <IconThinkOutline14 />
                    <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
                  </button>
                </Tooltip>
                <Tooltip content={t('deactivatedSearchTooltip')}>
                  <button
                    type="button"
                    className={clsx(styles.toggle, search && styles.selected)}
                    aria-label={t('search')}
                    aria-pressed={search}
                    onClick={() => setSearch(!search)}
                  >
                    <IconGlobeLanguageOutline14 />
                    <span className={styles.toggleLabel}>{t('search')}</span>
                  </button>
                </Tooltip>
              </>
            )}
          </div>
          <div className={styles.right}>
            {android ? (
              <>
                <IconButton
                  size="xl"
                  tone="primary"
                  className={styles.androidToolButton}
                  icon={
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect
                        x="3"
                        y="4.5"
                        width="18"
                        height="15"
                        rx="4"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <circle cx="9" cy="10" r="2" fill="currentColor" />
                      <path
                        d="M4.5 17.5 9.8 13l3 2.6 2.6-2.2 4.1 3.6"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                    </svg>
                  }
                  aria-label="生成配图"
                  disabled={importingHistory}
                  onClick={() => {
                    textareaRef.current?.blur()
                    setIllustrationPrompt(text.trim())
                    setIllustrating(true)
                  }}
                />
                <IconButton
                  size="xl"
                  tone="primary"
                  className={styles.androidToolButton}
                  icon={<AndroidCircle icon={showAttachments ? 'close' : 'add'} />}
                  aria-label={t(showAttachments ? 'close' : 'uploadFile')}
                  aria-expanded={showAttachments}
                  disabled={importingHistory}
                  onClick={() => {
                    textareaRef.current?.blur()
                    setShowAttachments(!showAttachments)
                  }}
                />
                {typing ||
                editingHere ||
                (draftReady && (attachments.length === 0 || text.trim())) ? null : (
                  <IconButton
                    size="xl"
                    tone="primary"
                    className={styles.androidToolButton}
                    icon={<AndroidCircle icon={voiceMode ? 'keys' : 'voice'} />}
                    aria-label={t(voiceMode ? 'androidTextMode' : 'androidVoiceMode')}
                    aria-pressed={voiceMode}
                    onClick={() => {
                      if (!voiceMode && !ensureApiKey(true)) {
                        return
                      }
                      voice.cancel()
                      useVoiceMode.setState({ enabled: !voiceMode })
                      if (voiceMode) {
                        focusComposer()
                      }
                    }}
                  />
                )}
              </>
            ) : (
              <>
                <VoiceButton
                  status={voice.status}
                  disabled={!voice.available}
                  seconds={voice.seconds}
                  onClick={() => {
                    if (
                      voice.status !== 'idle' ||
                      (!useChatStore.getState().importingHistory && ensureApiKey(true))
                    ) {
                      void voice.toggle()
                    }
                  }}
                />
                <IconButton
                  size="m"
                  tone="primary"
                  icon={<IconPaperclipOutline16 />}
                  tooltip={t('uploadFile')}
                  disabled={importingHistory}
                  onClick={() => ensureApiKey() && fileInputRef.current?.click()}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  accept={ACCEPT}
                  onChange={(event) => {
                    acceptFiles(Array.from(event.target.files ?? []))
                    event.target.value = ''
                  }}
                />
              </>
            )}

            {streaming && sessionId ? (
              <button
                type="button"
                className={styles.sendButton}
                aria-label={t('chatInputStopButtonTooltip')}
                onClick={() => {
                  stopReadAloud()
                  stopReply(sessionId)
                }}
              >
                <IconStopFill16 />
              </button>
            ) : showSend ? (
              <button
                type="button"
                className={clsx(styles.sendButton, !canSend && styles.disabled)}
                aria-label={t('send')}
                aria-disabled={!canSend}
                onPointerDown={(event) => {
                  if (android && !canSend) {
                    event.preventDefault()
                  }
                }}
                onClick={send}
              >
                <IconSendOutline16 />
              </button>
            ) : null}
          </div>
        </div>
        {dragging ? <DragMask /> : null}
      </div>
      {android ? (
        <>
          <AndroidAttachments
            open={showAttachments}
            selectedPhotos={
              new Map(
                attachments.flatMap((item) =>
                  item.recentPhotoId ? [[item.recentPhotoId, item.id] as const] : []
                )
              )
            }
            onRecentFile={(file, photoId) => acceptFiles([file], photoId)}
            onRemove={removeFile}
            onFiles={(files, source) => {
              setShowAttachments(false)
              acceptFiles(files)
              if (source === 'gallery') {
                focusComposer()
              }
            }}
          />
          <AndroidVoiceOverlay
            active={voiceOverlayActive}
            canceling={hold.canceling}
            level={voice.getLevel}
            touch={hold.touch}
          />
        </>
      ) : null}
      {android && !importingHistory && preview?.previewUrl && viewerBlob ? (
        <AndroidImageViewer
          key={preview.id}
          blob={viewerBlob}
          name={preview.name}
          source={preview.previewUrl}
          onClose={() => setPreviewId(undefined)}
          onConfirm={(file) => {
            const error = editingHere
              ? replaceEditImage(preview.id, file, uploadKey)
              : replaceDraftImage(sessionId, preview.id, file, uploadKey)
            if (!error) {
              setPreviewId(undefined)
              focusComposer()
            }
            return error
          }}
        />
      ) : null}
      {illustrating ? (
        <SessionActionDialog
          title="生成配图"
          description="描述要画什么，会用设置里的接口、绘图模型与尺寸生成。"
          cancelLabel={t('cancel')}
          confirmLabel={illustrationBusy ? '生成中…' : '生成'}
          confirmDisabled={illustrationBusy || !illustrationPrompt.trim()}
          onCancel={() => {
            if (!illustrationBusy) {
              setIllustrating(false)
            }
          }}
          onConfirm={() => {
            if (illustrationBusy || !illustrationPrompt.trim()) {
              return
            }
            setIllustrationBusy(true)
            void generateIllustration(illustrationPrompt)
              .then((result) => {
                if (result.ok) {
                  setIllustrationUrl(result.url)
                  setIllustrating(false)
                } else {
                  showToast(result.message)
                }
              })
              .finally(() => setIllustrationBusy(false))
          }}
        >
          <textarea
            className={styles.illustrationPrompt}
            rows={4}
            value={illustrationPrompt}
            placeholder="例：雨夜的旧书店里，猫娘靠在窗边看书"
            onChange={(event) => setIllustrationPrompt(event.target.value)}
          />
        </SessionActionDialog>
      ) : null}
      {illustrationUrl ? (
        <div className={styles.illustrationViewer} role="dialog" aria-label="生成的配图">
          <img src={illustrationUrl} alt="生成的配图" />
          <button type="button" onClick={() => setIllustrationUrl(null)}>
            关闭
          </button>
        </div>
      ) : null}
      {effortOpen
        ? createPortal(
            <div
              className={styles.effortLayer}
              role="presentation"
              onClick={() => {
                if (Date.now() - effortOpenedAt.current > 200) {
                  setEffortOpen(false)
                }
              }}
            >
              <section
                className={styles.effortPanel}
                style={{ left: effortAnchor?.left, top: effortAnchor?.top }}
                role="dialog"
                aria-modal="true"
                aria-label={t('effortTitle')}
                onClick={(event) => event.stopPropagation()}
              >
                <div className={styles.effortSky} aria-hidden="true">
                  {EFFORT_STARS.map((star, index) => (
                    <span
                      key={`star-${index}`}
                      className={styles.effortStar}
                      style={{
                        left: `${star.left}%`,
                        top: `${star.top}%`,
                        width: star.size,
                        height: star.size,
                        animationDelay: `${star.delay}s`,
                        opacity:
                          index < 2 + Math.round((effortValue / 100) * 5)
                            ? 0.25 + (effortValue / 100) * 0.6
                            : 0,
                      }}
                    />
                  ))}
                  {EFFORT_METEORS.map((meteor, index) => {
                    const visible = index < 1 + Math.round((effortValue / 100) * 1)
                    return (
                      <span
                        key={`meteor-${index}`}
                        className={styles.effortMeteor}
                        style={
                          {
                            left: meteor.left,
                            top: meteor.top,
                            animationDuration: `${meteor.duration - (effortValue / 100) * 0.7}s`,
                            animationDelay: `${meteor.delay}s`,
                            display: visible ? undefined : 'none',
                            '--meteor-alpha': 0.3 + (effortValue / 100) * 0.7,
                            filter: `brightness(${0.7 + (effortValue / 100) * 0.9})`,
                          } as CSSProperties
                        }
                      />
                    )
                  })}
                </div>
                <header className={styles.effortHead}>
                  <strong>{t('effortTitle')}</strong>
                  <span className={styles.effortValue}>
                    {effortValue <= 25
                      ? t('effortLow')
                      : effortValue >= 75
                        ? t('effortMax')
                        : t('effortHigh')}
                  </span>
                </header>
                <div className={styles.effortControl}>
                  <div className={styles.effortTrack} aria-hidden="true">
                    <i style={{ width: `${effortValue}%` }} />
                  </div>
                  <input
                    className={styles.effortRange}
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={effortValue}
                    aria-label={t('effortTitle')}
                    onChange={(event) => updateEffort(Number(event.target.value))}
                  />
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
      {cluesOpen && story ? (
        <Modal
          title={t('storyCluesTitle')}
          footer={
            <Button size="m" onClick={() => setCluesOpen(false)}>
              {t('storyCluesClose')}
            </Button>
          }
          onClose={() => setCluesOpen(false)}
        >
          <p className={styles.cluesIntro}>{t('storyCluesIntro')}</p>
          <div className={styles.cluesList}>
            {(story.clues ?? []).map((clue, index) => {
              const revealed = revealedClues.includes(clue)
              return (
                <div
                  key={`${clue.atMinute}-${clue.title}`}
                  className={clsx(styles.clueItem, revealed && styles.clueItemRevealed)}
                >
                  <div className={styles.clueHead}>
                    <span className={styles.clueIndex}>{index + 1}</span>
                    <span className={styles.clueTitle}>
                      {revealed ? clue.title : t('storyCluePendingTitle', { index: index + 1 })}
                    </span>
                    {revealed ? <span className={styles.clueTime}>{formatStoryClock(clue.atMinute)}</span> : null}
                  </div>
                  <p className={styles.clueHint}>
                    {revealed ? clue.hint : t('storyCluePendingBody')}
                  </p>
                </div>
              )
            })}
          </div>
        </Modal>
      ) : null}
      {!storyNoticeClosed && storyEnd === 'bad_end' ? (
        <Modal
          title={t('storyFailedTitle')}
          footer={
            <Button size="m" onClick={() => setStoryNoticeClosed(true)}>
              {t('storyEndClose')}
            </Button>
          }
          onClose={() => setStoryNoticeClosed(true)}
        >
          <p>{t('storyFailedBody')}</p>
        </Modal>
      ) : null}
      {!storyNoticeClosed && storyEnd === 'good_end' ? (
        <Modal
          title={t('storySuccessTitle')}
          footer={
            <Button size="m" onClick={() => setStoryNoticeClosed(true)}>
              {t('storyEndClose')}
            </Button>
          }
          onClose={() => setStoryNoticeClosed(true)}
        >
          <p>{t('storySuccessBody')}</p>
        </Modal>
      ) : null}
    </div>
  )
}
/* -------------------- 功能区：输入控件主体 结束 -------------------- */

/* ============================================================================
 * 功能区：输入与语音控件 / ChatInput 结束
 * ========================================================================== */
