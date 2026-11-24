/* ============================================================================
 * 功能区：侧栏与会话管理 / AndroidContentSearch 开始
 * 职责：AndroidContentSearch 组件，负责该组件的渲染、状态与交互出口。
 * 导出：AndroidContentSearch。
 * ========================================================================== */

import clsx from 'clsx'
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  formatSearchDate,
  searchLocalHistory,
  type ContentSearchResult,
  type HighlightRange,
} from '../../services/chat/contentSearch.js'
import { selectSession, selectSessionMessage, useChatStore } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import { IconChevronRightOutline14, IconSearchOutline16 } from '../base/icons.js'
import { closeDrawerSearch, closeOverlaySider, useMobileSider } from './mobileSiderState.js'
import styles from './AndroidContentSearch.module.css'

const ROW_HEIGHT = 74
const ROW_OVERSCAN = 10
const SEARCH_DEBOUNCE_MS = 160
const SKELETON_DELAY_MS = 80
const SKELETON_ROWS = [0, 1, 2, 3] as const

const SearchChatBubbleIcon = () => (
  <svg width={20} height={20} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M10 1.8C5.47 1.8 1.8 5.47 1.8 10c0 1.26.28 2.45.79 3.51l.31.65 1.32-.63-.31-.65-.15-.33A7.2 7.2 0 0 1 3.25 10c0-3.73 3.02-6.75 6.75-6.75S16.75 6.27 16.75 10 13.73 16.75 10 16.75c-.76 0-1.32-.05-1.82-.19-.49-.14-.95-.36-1.5-.75-.81-.57-1.98-.77-2.94-.16l-.03.02-.64.45.48 1.44.97-.69c.35-.21.87-.19 1.32.13.66.46 1.27.77 1.95.95.67.19 1.38.25 2.21.25 4.53 0 8.2-3.67 8.2-8.2S14.53 1.8 10 1.8Z"
      fill="currentColor"
    />
    <rect x="6.8" y="7.5" width="6.4" height="1.5" rx="0.2" fill="currentColor" />
    <rect x="6.8" y="10.8" width="3.5" height="1.5" rx="0.2" fill="currentColor" />
  </svg>
)

const SearchUserBadgeIcon = () => (
  <svg width={12} height={12} viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <circle cx="7" cy="4.6" r="2.2" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M2.8 11.4c.72-1.85 2.2-2.8 4.2-2.8s3.48.95 4.2 2.8"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
)

const SearchBranchIcon = () => (
  <svg width={11} height={11} viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path
      d="M1.6 3.8h7.5M3.2 3.8c1.9 0 2.1 6.4 5.9 6.4"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
    />
    <circle cx="10.8" cy="3.8" r="1.45" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="10.8" cy="10.2" r="1.45" stroke="currentColor" strokeWidth="1.3" />
  </svg>
)

const SearchClearIcon = () => (
  <svg width={9} height={9} viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
  </svg>
)

const SearchEmptyIcon = () => (
  <svg width={44} height={44} viewBox="0 0 44 44" fill="none" aria-hidden="true">
    <circle
      cx="19.5"
      cy="19.5"
      r="11.5"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeDasharray="8.8 3.24"
      strokeDashoffset="1.6"
    />
    <path d="m29.4 29.4 6.2 6.2" stroke="currentColor" strokeWidth="3.1" strokeLinecap="butt" />
  </svg>
)

const renderSnippet = (snippet: string, highlights: HighlightRange[]): ReactNode => {
  if (highlights.length === 0) {
    return snippet
  }
  const nodes: ReactNode[] = []
  let cursor = 0
  highlights.forEach((range, index) => {
    const start = Math.max(cursor, Math.min(snippet.length, range.start))
    const end = Math.max(start, Math.min(snippet.length, range.end))
    if (start > cursor) {
      nodes.push(snippet.slice(cursor, start))
    }
    if (end > start) {
      nodes.push(
        <mark key={index} className={styles.match}>
          {snippet.slice(start, end)}
        </mark>
      )
    }
    cursor = end
  })
  if (cursor < snippet.length) {
    nodes.push(snippet.slice(cursor))
  }
  return nodes
}

export const AndroidContentSearch = memo(function AndroidContentSearch() {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const sessions = useChatStore((state) => state.sessions)
  const drawerOpen = useMobileSider((state) => state.open)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ContentSearchResult[]>([])
  const [settledQuery, setSettledQuery] = useState('')
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)
  const [viewport, setViewport] = useState({ top: 0, height: 720 })
  const inputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const touchStartYRef = useRef<number | null>(null)
  const trimmed = query.trim()

  // 首次进入搜索页自动聚焦弹出键盘；点击结果跳转后再次打开抽屉时保持结果视图、不强弹键盘。
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  // 重新打开抽屉进入保留的搜索结果时刷新当前日期，并同步期间新增或修改的会话。
  useEffect(() => {
    if (drawerOpen) {
      setNow(Date.now())
    }
  }, [drawerOpen])

  useEffect(() => {
    if (!trimmed) {
      setResults([])
      setSettledQuery('')
      setShowSkeleton(false)
      setSelectedKey(null)
      return
    }

    const controller = new AbortController()
    let skeletonTimer: ReturnType<typeof setTimeout> | undefined
    const debounceTimer = setTimeout(() => {
      skeletonTimer = setTimeout(() => {
        if (!controller.signal.aborted) {
          setShowSkeleton(true)
        }
      }, SKELETON_DELAY_MS)

      void searchLocalHistory(
        trimmed,
        sessions,
        useChatStore.getState().sessionCache,
        controller.signal
      )
        .then((next) => {
          if (controller.signal.aborted) {
            return
          }
          clearTimeout(skeletonTimer)
          setResults(next)
          setSettledQuery(trimmed)
          setShowSkeleton(false)
          setSelectedKey((previous) =>
            previous && next.some((item) => item.key === previous) ? previous : null
          )
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            clearTimeout(skeletonTimer)
            setShowSkeleton(false)
          }
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      controller.abort()
      clearTimeout(debounceTimer)
      clearTimeout(skeletonTimer)
    }
  }, [trimmed, sessions, drawerOpen])

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) {
      return
    }
    const bucketSize = ROW_HEIGHT * 2
    let frame = 0
    const sync = () => {
      const top = Math.floor(body.scrollTop / bucketSize) * bucketSize
      const height = body.clientHeight
      setViewport((previous) =>
        previous.top === top && previous.height === height ? previous : { top, height }
      )
    }
    const schedule = () => {
      if (frame) {
        return
      }
      frame = requestAnimationFrame(() => {
        frame = 0
        sync()
      })
    }
    const observer = new ResizeObserver(sync)
    observer.observe(body)
    body.addEventListener('scroll', schedule, { passive: true })
    sync()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      body.removeEventListener('scroll', schedule)
    }
  }, [])

  const dismissKeyboard = () => {
    if (document.activeElement === inputRef.current) {
      inputRef.current?.blur()
    }
  }

  const exitSearch = () => {
    dismissKeyboard()
    closeDrawerSearch()
  }

  const clearQuery = () => {
    setQuery('')
    setSelectedKey(null)
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0
    }
    inputRef.current?.focus()
  }

  const openResult = (result: ContentSearchResult) => {
    dismissKeyboard()
    setSelectedKey(result.key)
    if (result.kind === 'session') {
      selectSession(result.sessionId)
    } else {
      selectSessionMessage(result.sessionId, result.messageId)
    }
    closeOverlaySider()
  }

  const hasSettled = Boolean(trimmed && settledQuery === trimmed)
  const total = results.length
  const start = Math.min(
    total,
    Math.max(0, Math.floor((viewport.top - 12) / ROW_HEIGHT) - ROW_OVERSCAN)
  )
  const end = Math.min(
    total,
    Math.max(start, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + ROW_OVERSCAN)
  )

  return (
    <div className={styles.container} data-drawer-gesture-ignore="">
      <div className={styles.header}>
        <button
          type="button"
          className={styles.back}
          aria-label={t('androidSearchBack')}
          onClick={exitSearch}
        >
          <IconChevronRightOutline14 />
        </button>
        <div className={styles.inputBox}>
          <IconSearchOutline16 />
          <input
            ref={inputRef}
            className={styles.input}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('androidSearchChats')}
            aria-label={t('androidSearchChats')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelectedKey(null)
              if (bodyRef.current) {
                bodyRef.current.scrollTop = 0
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                exitSearch()
              } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                dismissKeyboard()
              }
            }}
          />
          {query.length > 0 ? (
            <button
              type="button"
              className={styles.clear}
              aria-label={t('androidSearchClear')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearQuery}
            >
              <span className={styles.clearCircle}>
                <SearchClearIcon />
              </span>
            </button>
          ) : null}
        </div>
      </div>

      <div
        ref={bodyRef}
        className={styles.body}
        onTouchStart={(event) => {
          touchStartYRef.current = event.touches[0]?.clientY ?? null
        }}
        onTouchMove={(event) => {
          const startY = touchStartYRef.current
          const currentY = event.touches[0]?.clientY
          if (startY !== null && currentY !== undefined && Math.abs(currentY - startY) > 6) {
            touchStartYRef.current = null
            dismissKeyboard()
          }
        }}
        onTouchEnd={() => {
          touchStartYRef.current = null
        }}
        onTouchCancel={() => {
          touchStartYRef.current = null
        }}
        onWheel={dismissKeyboard}
      >
        {!trimmed ? null : showSkeleton && !hasSettled ? (
          <div className={styles.skeletonList} aria-hidden="true">
            {SKELETON_ROWS.map((row) => (
              <div key={row} className={styles.skeletonRow}>
                <div className={styles.skeletonCircle} />
                <div className={styles.skeletonLines}>
                  <div className={styles.skeletonBarPrimary} />
                  <div className={styles.skeletonBarSecondary} />
                </div>
              </div>
            ))}
          </div>
        ) : hasSettled && total === 0 ? (
          <div className={styles.empty} role="status" aria-live="polite">
            <SearchEmptyIcon />
            <span>{t('androidSearchNoResults')}</span>
          </div>
        ) : total > 0 ? (
          <div className={styles.list}>
            {start > 0 ? <div aria-hidden="true" style={{ height: start * ROW_HEIGHT }} /> : null}
            {results.slice(start, end).map((result) => {
              const title = result.title || t('untitledChat')
              const date = formatSearchDate(result.timestamp, now, locale)
              return (
                <div key={result.key} className={styles.rowSlot}>
                  <button
                    type="button"
                    className={clsx(styles.row, selectedKey === result.key && styles.selected)}
                    onClick={() => openResult(result)}
                  >
                    <span className={styles.avatar} aria-hidden="true">
                      <SearchChatBubbleIcon />
                      {result.kind === 'message' && result.role === 'user' ? (
                        <span className={styles.userBadge}>
                          <SearchUserBadgeIcon />
                        </span>
                      ) : null}
                    </span>
                    <span className={styles.content}>
                      <span className={styles.topLine}>
                        <span
                          className={clsx(
                            styles.title,
                            result.kind === 'session' && styles.titleOnly
                          )}
                        >
                          {title}
                        </span>
                        {date ? <span className={styles.date}>{date}</span> : null}
                      </span>
                      {result.kind === 'message' ? (
                        <span className={styles.snippetLine}>
                          {result.branchLabel ? (
                            <span className={styles.branch}>
                              <SearchBranchIcon />
                              <span>{result.branchLabel}</span>
                            </span>
                          ) : null}
                          <span className={styles.snippet}>
                            {renderSnippet(result.snippet, result.highlights)}
                          </span>
                        </span>
                      ) : null}
                    </span>
                  </button>
                </div>
              )
            })}
            {end < total ? (
              <div aria-hidden="true" style={{ height: (total - end) * ROW_HEIGHT }} />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
})

/* ============================================================================
 * 功能区：侧栏与会话管理 / AndroidContentSearch 结束
 * ========================================================================== */
