/* ============================================================================
 * 功能区：输入与语音控件 / AndroidAttachments 开始
 * 职责：AndroidAttachments 组件，负责该组件的渲染、状态与交互出口。
 * 导出：AndroidAttachments。
 * ========================================================================== */

import { useEffect, useRef, useState } from 'react'
import { android } from '../../app/android.js'
import { useTranslate } from '../../i18n/index.js'
import { ACCEPT } from '../../services/attachments.js'
import { AndroidAttachment } from '../base/AndroidIcons.js'
import { showToast } from '../base/toastState.js'
import styles from './AndroidAttachments.module.css'

type Photo = { id: string; name: string; type: string }
type Source = 'camera' | 'gallery' | 'files'

export const AndroidAttachments = ({
  open,
  onFiles,
  selectedPhotos,
  onRecentFile,
  onRemove,
}: {
  open: boolean
  onFiles: (files: File[], source: Source) => void
  selectedPhotos: ReadonlyMap<string, string>
  onRecentFile: (file: File, photoId: string) => void
  onRemove: (attachmentId: string) => void
}) => {
  const t = useTranslate()
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const documents = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLElement>(null)
  const loadingPhotos = useRef(new Map<string, AbortController>())
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loadingIds, setLoadingIds] = useState<Set<string>>(() => new Set())
  useEffect(
    () => () => {
      loadingPhotos.current.forEach((controller) => controller.abort())
      loadingPhotos.current.clear()
    },
    []
  )
  useEffect(() => {
    // 面板收起由 CSS 控制显示，不再用 inert：一旦状态和动画错位会连输入区一起点不动
  }, [open])

  useEffect(() => {
    const device = android
    if (!device) {
      return
    }
    const update = (event: Event) => setPhotos((event as CustomEvent<Photo[]>).detail)
    window.addEventListener('android-photos', update)
    device.prefetchRecentPhotos()
    return () => window.removeEventListener('android-photos', update)
  }, [])

  useEffect(() => {
    if (open) {
      android?.requestRecentPhotos()
    }
  }, [open])

  const chooseRecent = async (photo: Photo) => {
    const selectedId = selectedPhotos.get(photo.id)
    if (selectedId) {
      onRemove(selectedId)
      return
    }
    const pending = loadingPhotos.current.get(photo.id)
    if (pending) {
      pending.abort()
      loadingPhotos.current.delete(photo.id)
      setLoadingIds(new Set(loadingPhotos.current.keys()))
      return
    }
    const controller = new AbortController()
    loadingPhotos.current.set(photo.id, controller)
    setLoadingIds(new Set(loadingPhotos.current.keys()))
    try {
      const response = await fetch(`/recent/${photo.id}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error('Photo unavailable')
      }
      const blob = await response.blob()
      if (!controller.signal.aborted) {
        const name =
          blob.type === 'image/png' && photo.type !== 'image/png'
            ? photo.name.replace(/\.[^.]+$/, '') + '.png'
            : photo.name
        onRecentFile(new File([blob], name, { type: blob.type || photo.type }), photo.id)
      }
    } catch {
      if (!controller.signal.aborted) {
        showToast({ key: 'uploadParseFailed' })
      }
    } finally {
      if (loadingPhotos.current.get(photo.id) === controller) {
        loadingPhotos.current.delete(photo.id)
        setLoadingIds(new Set(loadingPhotos.current.keys()))
      }
    }
  }

  const actions = [
    { kind: 'camera', label: t('androidCamera'), ref: camera, accept: 'image/*' },
    { kind: 'gallery', label: t('androidGallery'), ref: gallery, accept: 'image/*' },
    { kind: 'files', label: t('androidFiles'), ref: documents, accept: ACCEPT },
  ] satisfies { kind: Source; label: string; ref: typeof camera; accept: string }[]

  return (
    <section
      ref={panel}
      className={styles.panel}
      data-open={open}
      data-attachment-panel=""
      aria-label={t('uploadFile')}
    >
      <div className={styles.content}>
        {photos.length > 0 ? (
          <div className={styles.recent}>
            {photos.map((photo) => {
              const selected = selectedPhotos.has(photo.id) || loadingIds.has(photo.id)
              return (
                <button
                  key={photo.id}
                  type="button"
                  aria-label={photo.name}
                  aria-pressed={selected}
                  data-selected={selected}
                  onClick={() => void chooseRecent(photo)}
                >
                  <img
                    src={`/thumbnail/${photo.id}`}
                    alt=""
                    loading="lazy"
                    onError={() =>
                      setPhotos((current) => current.filter((item) => item.id !== photo.id))
                    }
                  />
                  <span aria-hidden="true">
                    <svg viewBox="0 0 16 16">
                      <path d="m3.2 8.2 3 3 6.6-6.6" />
                    </svg>
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}
        <div className={styles.actions}>
          {actions.map(({ kind, label, ref, accept }) => (
            <div key={kind}>
              <button type="button" onClick={() => ref.current?.click()}>
                <AndroidAttachment kind={kind} />
                {label}
              </button>
              <input
                ref={ref}
                type="file"
                hidden
                accept={accept}
                capture={kind === 'camera' ? 'environment' : undefined}
                multiple={kind !== 'camera'}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  if (files.length) {
                    onFiles(files, kind)
                  }
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ============================================================================
 * 功能区：输入与语音控件 / AndroidAttachments 结束
 * ========================================================================== */
