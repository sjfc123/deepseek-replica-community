import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import type { DraftAttachment } from '../../services/chat/drafts.js'
import { DraftAttachments } from './DraftAttachments.js'
import styles from './ChatInput.module.css'

const TRANSITION_MS = 300
const PHOTO_ACTIONS = [
  'androidPhotoWhat',
  'androidPhotoAnalyze',
  'androidPhotoAdvice',
  'androidPhotoExplain',
] as const satisfies readonly TranslationKey[]

/** 保留退出中的预览，让图片和输入框一起收回。 */
export const AndroidDraftAttachments = ({
  items,
  suggestions,
  loading,
  localOnly,
  canSend,
  onRetry,
  onRemove,
  onPreview,
  onSuggestion,
}: {
  items: DraftAttachment[]
  suggestions: boolean
  loading: boolean
  localOnly: boolean
  canSend: boolean
  onRetry: (id: string) => void
  onRemove: (id: string) => void
  onPreview: (id: string) => void
  onSuggestion: (text: string) => void
}) => {
  const t = useTranslate()
  const [displayed, setDisplayed] = useState(items)
  const lastSuggestions = useRef(suggestions)

  useLayoutEffect(() => {
    if (items.length > 0) {
      lastSuggestions.current = suggestions
    }
  }, [items.length, suggestions])

  useLayoutEffect(() => {
    if (items.length > 0) {
      setDisplayed(items)
      return
    }
    if (displayed.length === 0) {
      return
    }
    // 草稿移除时原预览 URL 已释放，退出动画持有独立 URL。
    const retained = displayed.map((item) => {
      const source = item.file ?? item.blob
      return {
        ...item,
        previewUrl: item.isImage && source ? URL.createObjectURL(source) : null,
      }
    })
    setDisplayed(retained)
    const release = () => {
      retained.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl)
        }
      })
    }
    const timer = window.setTimeout(() => {
      setDisplayed([])
      release()
    }, TRANSITION_MS)
    return () => {
      window.clearTimeout(timer)
      release()
    }
    // displayed is the previous snapshot; changing it must not restart the exit timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const showSuggestions =
    items.length > 0 ? suggestions : lastSuggestions.current && displayed.length > 0
  return (
    <div className={styles.androidPreview} data-expanded={items.length > 0}>
      <div className={styles.androidPreviewContent}>
        <DraftAttachments
          items={displayed}
          exiting={items.length === 0}
          localOnly={localOnly}
          onRetry={onRetry}
          onRemove={onRemove}
          onPreview={onPreview}
        />
        {showSuggestions ? (
          <div className={styles.quickSuggestions} data-open="true">
            <div className={styles.quickSuggestionsClip}>
              <div className={styles.quickSuggestionsList}>
                {PHOTO_ACTIONS.map((key) =>
                  loading ? (
                    <span key={key} className={styles.quickSuggestionSkeleton} aria-hidden="true" />
                  ) : (
                    <button
                      key={key}
                      type="button"
                      disabled={!canSend}
                      onClick={() => onSuggestion(t(key))}
                    >
                      <span>{t(key)}</span>
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M2.5 8h10m-3.5-3.5L12.5 8 9 11.5" />
                      </svg>
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
