/* ============================================================================
 * 功能区：视图与交互 / AndroidSearchPanel
 * 职责：AndroidSearchPanel 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、契约与依赖；02 对外入口与收尾
 * 关联：依赖 app/openAndroidPage、app/useAndroidBackInterception、app/viewport、components/search/AndroidSearchPanel.module 等 9 个模块；
 *    被 components/search/SearchPanel 引用。
 * 导出：AndroidSearchPanel
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { openAndroidPage } from '../../app/openAndroidPage.js'
import { useAndroidBackInterception } from '../../app/useAndroidBackInterception.js'
import { useIsAndroidWide } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Source } from '../../services/chat/view.js'
import { formatDate } from '../../utils/format.js'
import { closeSearchPanel, useSearchPanel, type SearchPanelTitle } from './searchPanelState.js'
import { SiteLogo } from './SiteLogo.js'
import styles from './AndroidSearchPanel.module.css'

/* ---- 01 类型、契约与依赖 ---- */
const TRANSITION_MS = 240

type DisplayedResults = { entry: string; sources: Source[]; title: SearchPanelTitle }

const AndroidSource = ({
  source,
  single,
  numbered,
}: {
  source: Source
  single: boolean
  numbered: boolean
}) => {
  const date = source.publishedAt ? (formatDate(source.publishedAt, '/') ?? source.publishedAt) : ''
  return (
    <button type="button" className={styles.result} onClick={() => openAndroidPage(source.url)}>
      <div className={styles.meta}>
        <SiteLogo url={source.siteIcon} className={styles.logo} />
        <span className={styles.siteName}>{source.siteName}</span>
        {date ? <span className={styles.date}>{date}</span> : null}
        {numbered ? <span className={styles.number}>{source.index}</span> : null}
      </div>
      <span className={styles.resultTitle}>{source.title}</span>
      {source.snippet ? (
        <span className={styles.snippet} data-single={single}>
          {source.snippet}
        </span>
      ) : null}
    </button>
  )
}

/* ---- 02 对外入口与收尾 ---- */
/** Android 搜索来源：窄屏底部面板，宽屏（>= 840dp）对齐官方以居中模态弹窗显示。 */
export const AndroidSearchPanel = () => {
  const t = useTranslate()
  const isDialog = useIsAndroidWide()
  const entry = useSearchPanel((state) => state.entry)
  const sources = useSearchPanel((state) => state.sources)
  const title = useSearchPanel((state) => state.title)
  const [displayed, setDisplayed] = useState<DisplayedResults | null>(null)
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useAndroidBackInterception(entry !== null || displayed !== null)
  useLayoutEffect(() => {
    if (entry) {
      overlayRef.current?.style.removeProperty('--result-drag-offset')
      overlayRef.current?.style.removeProperty('--result-scrim-opacity')
      setDisplayed({ entry, sources, title })
      setScrolled(false)
      const frame = requestAnimationFrame(() => setOpen(true))
      return () => cancelAnimationFrame(frame)
    }
    setOpen(false)
    const timer = setTimeout(() => setDisplayed(null), TRANSITION_MS)
    return () => clearTimeout(timer)
  }, [entry, sources, title])

  useEffect(() => {
    if (!entry) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSearchPanel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [entry])

  useEffect(() => {
    const overlay = overlayRef.current
    const sheet = sheetRef.current
    const content = contentRef.current
    if (!entry || !overlay || !sheet || !content) {
      return
    }
    if (isDialog) {
      delete overlay.dataset.dragging
      overlay.style.removeProperty('--result-drag-offset')
      overlay.style.removeProperty('--result-scrim-opacity')
      return
    }

    let gesture: {
      id: number
      x: number
      y: number
      inContent: boolean
      dragging: boolean
      offset: number
      height: number
    } | null = null

    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !(event.target instanceof Node)) {
        return
      }
      const touch = event.touches[0]
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        inContent: content.contains(event.target),
        dragging: false,
        offset: 0,
        height: sheet.getBoundingClientRect().height,
      }
    }

    const touchMove = (event: TouchEvent) => {
      if (!gesture) {
        return
      }
      const touch = Array.from(event.touches).find((item) => item.identifier === gesture?.id)
      if (!touch) {
        return
      }

      // Let the list scroll normally until it reaches its upper edge.
      if (!gesture.dragging && gesture.inContent && content.scrollTop > 0) {
        gesture.x = touch.clientX
        gesture.y = touch.clientY
        return
      }
      const deltaY = touch.clientY - gesture.y
      if (!gesture.dragging && (deltaY <= 0 || deltaY <= Math.abs(touch.clientX - gesture.x))) {
        return
      }
      if (event.cancelable) {
        event.preventDefault()
      }
      if (!gesture.dragging && deltaY < 6) {
        return
      }

      gesture.dragging = true
      gesture.offset = Math.max(0, Math.min(deltaY - 6, gesture.height))
      overlay.dataset.dragging = 'true'
      overlay.style.setProperty('--result-drag-offset', `${gesture.offset}px`)
      overlay.style.setProperty(
        '--result-scrim-opacity',
        String(0.32 * (1 - gesture.offset / gesture.height))
      )
    }

    const touchEnd = (event: TouchEvent) => {
      if (
        !gesture ||
        !Array.from(event.changedTouches).some((item) => item.identifier === gesture?.id)
      ) {
        return
      }
      const { dragging, offset, height } = gesture
      gesture = null
      if (!dragging) {
        return
      }
      if (event.cancelable) {
        event.preventDefault()
      }
      delete overlay.dataset.dragging
      if (event.type !== 'touchcancel' && offset > height / 2) {
        closeSearchPanel()
      } else {
        overlay.style.removeProperty('--result-drag-offset')
        overlay.style.removeProperty('--result-scrim-opacity')
      }
    }

    sheet.addEventListener('touchstart', touchStart, { passive: true })
    sheet.addEventListener('touchmove', touchMove, { passive: false })
    sheet.addEventListener('touchend', touchEnd, { passive: false })
    sheet.addEventListener('touchcancel', touchEnd, { passive: false })
    return () => {
      sheet.removeEventListener('touchstart', touchStart)
      sheet.removeEventListener('touchmove', touchMove)
      sheet.removeEventListener('touchend', touchEnd)
      sheet.removeEventListener('touchcancel', touchEnd)
    }
  }, [displayed?.entry, entry, isDialog])

  if (!displayed) {
    return null
  }
  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      data-open={open}
      data-layout={isDialog ? 'dialog' : 'sheet'}
      data-drawer-gesture-ignore=""
    >
      <div className={styles.scrim} onClick={closeSearchPanel} aria-hidden="true" />
      <section
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={t(displayed.title)}
      >
        <div className={styles.header} data-scrolled={scrolled}>
          <span>{t(displayed.title)}</span>
          <button
            className={styles.close}
            type="button"
            aria-label={t('close')}
            onClick={closeSearchPanel}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5.2 5.2 14.8 14.8M14.8 5.2 5.2 14.8" />
            </svg>
          </button>
        </div>
        <div
          ref={contentRef}
          key={displayed.entry}
          className={styles.content}
          data-single={displayed.sources.length === 1}
          onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
        >
          {displayed.sources.map((source) => (
            <AndroidSource
              key={source.url}
              source={source}
              single={displayed.sources.length === 1}
              numbered={displayed.title === 'searchResult'}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

/* ============================================================================
 * 功能区：搜索与引用 / AndroidSearchPanel 结束
 * ========================================================================== */
