/* ============================================================================
 * 功能区：视图与交互 / AndroidImageViewer
 * 职责：AndroidImageViewer 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、常量与模块依赖；02 类型、契约与依赖；03 类型、常量与模块依赖（2）；04 对外入口与收尾
 * 关联：依赖 app/android、app/useAndroidBackInterception、components/base/Button、components/base/icons 等 8 个模块；
 *    被 components/chatInput/ChatInput、components/messages/MessageFile 引用。
 * 导出：AndroidImageViewer
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { android, saveAndroidImage } from '../../app/android.js'
import {
  subscribeToAndroidBackPreview,
  useAndroidBackInterception,
} from '../../app/useAndroidBackInterception.js'
import { useTranslate, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import {
  IconCloseOutline16,
  IconDownloadOutline16,
  IconPhotoErrorFill20,
  IconRefreshOutline16,
} from '../base/icons.js'
import {
  MAX_CROP_ZOOM,
  exportCrop,
  fitCrop,
  freezeAnimatedImage,
  fullImage,
  isFullImage,
  resizeCrop,
  rotateCrop,
  rotatedSize,
  zoomCrop,
  type Crop,
  type Handle,
  type Point,
  type Size,
} from './imageCrop.js'
import styles from './AndroidImageViewer.module.css'
import { usePreviewZoom } from './usePreviewZoom.js'

/* ---- 01 类型、常量与模块依赖 ---- */
/* ---- 02 类型、契约与依赖 ---- */
/* ---- 03 类型、常量与模块依赖（2） ---- */
const handles = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
]

type Placement = ReturnType<typeof fitCrop>
type Drag = {
  crop: Crop
  placement: Placement
  origin: Point
} & ({ handle: Handle } | { distance: number; anchor: Point })

const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = (a: Point, b: Point) => Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))

const CropIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="M7 3v14h14M3 7h14v14" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/* ---- 04 对外入口与收尾 ---- */
export const AndroidImageViewer = ({
  blob,
  name,
  source,
  onClose,
  onConfirm,
  canDownload = false,
}: {
  blob: Blob
  name: string
  source: string
  onClose: () => void
  onConfirm: (file: File) => TranslationMessage | null
  canDownload?: boolean
}) => {
  const t = useTranslate()
  const dialog = useRef<HTMLDialogElement>(null)
  const previewSurface = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>()
  const editing = useRef(false)
  const pending = useRef<AbortController>()
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Drag>()
  const [natural, setNatural] = useState<Size>()
  const preview = usePreviewZoom(natural, onClose)
  const [stageSize, setStageSize] = useState<Size>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [imageSource, setImageSource] = useState<string>()
  const [crop, setCrop] = useState<Crop>()
  const isEditing = crop !== undefined
  const [dragPlacement, setDragPlacement] = useState<Placement>()
  const [settling, setSettling] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<TranslationMessage>()
  const [downloading, setDownloading] = useState(false)
  const [downloadStatus, setDownloadStatus] = useState<TranslationMessage>()

  useAndroidBackInterception()
  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) {
      return
    }
    element.showModal()
    android?.setImageViewerFullscreen?.(true)
    return () => {
      pending.current?.abort()
      android?.setImageViewerFullscreen?.(false)
      element.close()
    }
  }, [])

  useLayoutEffect(() => {
    const element = dialog.current
    const surface = previewSurface.current
    if (isEditing || !element || !surface) {
      return
    }
    const reset = () => {
      element.style.removeProperty('--image-back-reveal')
      surface.style.removeProperty('transform')
    }
    const unsubscribe = subscribeToAndroidBackPreview((back) => {
      if (!back?.edge) {
        reset()
        return
      }
      const shrink = 0.2 * back.progress
      const x = (back.edge === 'left' ? 8 : -8) * back.progress
      const y = (back.touchY - surface.clientHeight / 2) * shrink
      element.style.setProperty('--image-back-reveal', String(shrink))
      surface.style.transform = `translate(${x}%, ${y}px) scale(${1 - shrink})`
    })
    return () => {
      unsubscribe?.()
      reset()
    }
  }, [isEditing])

  useEffect(() => {
    let closed = false
    let staticUrl: string | undefined
    void freezeAnimatedImage(blob)
      .catch(() => null)
      .then((still) => {
        if (!closed) {
          staticUrl = still ? URL.createObjectURL(still) : undefined
          setImageSource(staticUrl ?? source)
        }
      })
    return () => {
      closed = true
      if (staticUrl) {
        URL.revokeObjectURL(staticUrl)
      }
    }
  }, [blob, source])

  useLayoutEffect(() => {
    const element = stage.current
    if (!element) {
      return
    }
    const measure = () => {
      const { width, height } = element.getBoundingClientRect()
      if (width && height) {
        setStageSize({ width, height })
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [isEditing])

  const cancelEdit = () => {
    pending.current?.abort()
    editing.current = false
    gesture.current = undefined
    pointers.current.clear()
    setDragPlacement(undefined)
    setSettling(false)
    setCrop(undefined)
    setSaving(false)
    setError(undefined)
  }
  const back = () => (editing.current ? cancelEdit() : onClose())
  const backRef = useRef(back)
  backRef.current = back
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        backRef.current()
      }
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [])

  useEffect(() => {
    if (!downloadStatus) {
      return
    }
    const timeout = window.setTimeout(() => setDownloadStatus(undefined), 2500)
    return () => window.clearTimeout(timeout)
  }, [downloadStatus])

  const oriented = natural && crop && rotatedSize(natural, crop.turns)
  const maxScale =
    stageSize && oriented
      ? MAX_CROP_ZOOM *
        Math.min(stageSize.width / oriented.width, stageSize.height / oriented.height)
      : undefined
  const placement = crop && stageSize && (dragPlacement ?? fitCrop(crop.rect, stageSize, maxScale))
  const screenRect = crop &&
    placement && {
      left: placement.x + crop.rect.x * placement.scale,
      top: placement.y + crop.rect.y * placement.scale,
      width: crop.rect.width * placement.scale,
      height: crop.rect.height * placement.scale,
    }

  const startGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (!crop || !placement || saving || event.button !== 0 || pointers.current.size === 2) {
      return
    }
    const target = event.target as HTMLElement
    const handle =
      target.dataset.handle === undefined ? undefined : handles[Number(target.dataset.handle)]
    if (pointers.current.size === 0 && !handle && !target.closest('[data-crop-frame]')) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setSettling(false)
    const point = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, point)
    const [first, second] = pointers.current.values()
    if (first && second) {
      const center = midpoint(first, second)
      const bounds = event.currentTarget.getBoundingClientRect()
      gesture.current = {
        crop,
        placement,
        origin: center,
        distance: distance(first, second),
        anchor: {
          x: (center.x - bounds.left - placement.x) / placement.scale,
          y: (center.y - bounds.top - placement.y) / placement.scale,
        },
      }
      setDragPlacement(undefined)
    } else {
      gesture.current = { crop, placement, origin: point, handle: handle ?? { x: 0, y: 0 } }
      setDragPlacement(handle ? placement : undefined)
    }
    setError(undefined)
  }

  const moveGesture = (event: PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current
    if (!drag || !oriented || !stageSize || !maxScale || !pointers.current.has(event.pointerId)) {
      return
    }
    const point = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, point)
    const { scale, x, y } = drag.placement
    if ('handle' in drag) {
      const visible = {
        x: -x / scale,
        y: -y / scale,
        width: stageSize.width / scale,
        height: stageSize.height / scale,
      }
      const delta = { x: (point.x - drag.origin.x) / scale, y: (point.y - drag.origin.y) / scale }
      setCrop({
        ...drag.crop,
        rect: resizeCrop(
          drag.crop.rect,
          oriented,
          visible,
          drag.handle,
          delta,
          Math.min(stageSize.width, stageSize.height) / (10 * scale)
        ),
      })
    } else {
      const [first, second] = pointers.current.values()
      if (first && second) {
        const center = midpoint(first, second)
        const offset = {
          x: drag.anchor.x - drag.crop.rect.x + (center.x - drag.origin.x) / scale,
          y: drag.anchor.y - drag.crop.rect.y + (center.y - drag.origin.y) / scale,
        }
        setCrop({
          ...drag.crop,
          rect: zoomCrop(
            drag.crop.rect,
            oriented,
            drag.anchor,
            offset,
            drag.distance / distance(first, second),
            scale / maxScale
          ),
        })
      }
    }
  }

  const stopGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(event.pointerId)) {
      pointers.current.clear()
      gesture.current = undefined
      setDragPlacement(undefined)
      setSettling(dragPlacement !== undefined)
    }
  }

  const confirm = async () => {
    if (
      !image.current ||
      !natural ||
      !crop ||
      (pending.current && !pending.current.signal.aborted)
    ) {
      return
    }
    const controller = new AbortController()
    pending.current = controller
    setSaving(true)
    setError(undefined)
    try {
      const result = await exportCrop(image.current, name, crop)
      if (!controller.signal.aborted) {
        const confirmError = onConfirm(result)
        if (confirmError) {
          setError(confirmError)
        } else {
          // Remove the modal's focus restriction before the composer requests focus.
          dialog.current?.close()
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        setError({ key: 'androidCropFailed' })
      }
    } finally {
      if (pending.current === controller) {
        pending.current = undefined
        if (!controller.signal.aborted) {
          setSaving(false)
        }
      }
    }
  }

  const download = async () => {
    setDownloading(true)
    setDownloadStatus(undefined)
    try {
      await saveAndroidImage(name, blob)
      setDownloadStatus({ key: 'androidImageSaved' })
    } catch {
      setDownloadStatus({ key: 'androidImageSaveFailed' })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      role="dialog"
      aria-label={crop ? t('androidCropImage') : t('androidPreviewDraftImage', { name })}
      className={styles.dialog}
      data-preview={isEditing ? undefined : ''}
      data-drawer-gesture-ignore=""
      onCancel={(event) => {
        event.preventDefault()
        back()
      }}
    >
      {crop ? (
        <>
          <header className={styles.tools}>
            {natural && !isFullImage(crop, natural) ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setCrop(fullImage(natural))
                  setError(undefined)
                }}
              >
                {t('androidCropReset')}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.rotate}
              disabled={saving}
              onClick={() => {
                if (natural) {
                  setCrop(rotateCrop(crop, natural))
                  setError(undefined)
                }
              }}
            >
              <IconRefreshOutline16 />
              {t('androidCropRotate')}
            </button>
          </header>
          <div
            ref={stage}
            className={styles.stage}
            data-settling={settling || undefined}
            onPointerDown={startGesture}
            onPointerMove={moveGesture}
            onPointerUp={stopGesture}
            onPointerCancel={stopGesture}
            onLostPointerCapture={stopGesture}
          >
            <img
              src={imageSource}
              alt={name}
              draggable={false}
              className={styles.cropImage}
              style={
                natural && oriented && placement
                  ? {
                      left: placement.x + (oriented.width * placement.scale) / 2,
                      top: placement.y + (oriented.height * placement.scale) / 2,
                      width: natural.width * placement.scale,
                      height: natural.height * placement.scale,
                      transform: `translate(-50%, -50%) rotate(${-crop.turns * 90}deg)`,
                    }
                  : { visibility: 'hidden' }
              }
            />
            {screenRect ? (
              <div className={styles.frame} style={screenRect} data-crop-frame="">
                {handles.map(({ x, y }, index) => (
                  <span
                    key={index}
                    className={styles.handle}
                    data-handle={index}
                    style={{ left: `${(x + 1) * 50}%`, top: `${(y + 1) * 50}%` }}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <footer className={styles.controls}>
            {error ? (
              <div className={styles.error} role="alert">
                {t(error.key, error.params)}
              </div>
            ) : null}
            <button
              type="button"
              className={styles.close}
              aria-label={t('cancel')}
              onClick={cancelEdit}
            >
              <IconCloseOutline16 />
            </button>
            <Button className={styles.confirm} disabled={saving} onClick={() => void confirm()}>
              {t('androidCropAsk')}
            </Button>
          </footer>
        </>
      ) : (
        <>
          <div ref={previewSurface} className={styles.previewSurface}>
            <button
              type="button"
              className={styles.preview}
              aria-label={t('close')}
              {...preview.bindings}
            >
              <img
                key={loadAttempt}
                src={imageSource}
                alt={name}
                draggable={false}
                hidden={!natural}
                style={{
                  transform: `translate(${preview.position.x}px, ${preview.position.y}px) scale(${preview.position.scale})`,
                }}
                onLoad={({ currentTarget }) => {
                  image.current = currentTarget
                  setNatural({
                    width: currentTarget.naturalWidth,
                    height: currentTarget.naturalHeight,
                  })
                  setLoadFailed(false)
                }}
                onError={() => {
                  image.current = undefined
                  setNatural(undefined)
                  setLoadFailed(true)
                }}
              />
            </button>
            {loadFailed ? (
              <div className={styles.loadError}>
                <IconPhotoErrorFill20 />
                <span>{t('androidDraftImageLoadFailed')}</span>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    setLoadFailed(false)
                    setLoadAttempt((attempt) => attempt + 1)
                  }}
                >
                  <IconRefreshOutline16 />
                  {t('androidDraftImageReload')}
                </button>
              </div>
            ) : natural ? null : (
              <span className={styles.loading} aria-hidden="true" />
            )}
          </div>
          {natural && !loadFailed ? (
            <div className={styles.previewControls} hidden={preview.controlsHidden}>
              {downloadStatus ? (
                <div className={styles.downloadStatus} role="status">
                  {t(downloadStatus.key)}
                </div>
              ) : null}
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  preview.cancelTap()
                  editing.current = true
                  setCrop(fullImage(natural))
                }}
              >
                <CropIcon />
                {t('androidCropImage')}
              </button>
              {canDownload ? (
                <button
                  type="button"
                  className={styles.action}
                  disabled={downloading}
                  onClick={() => void download()}
                >
                  <IconDownloadOutline16 />
                  {t('androidSaveImage')}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </dialog>
  )
}

/* ============================================================================
 * 功能区：附件与文件预览 / AndroidImageViewer 结束
 * ========================================================================== */
