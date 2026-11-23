import { useLayoutEffect } from 'react'
import { android } from './android.js'

// Several app surfaces can be open at once. Keep intercepting until the last one closes.
let interceptors = 0

type BackPreview = {
  progress: number
  edge: 'left' | 'right' | null
  touchY: number
}

type PreviewListener = (preview: BackPreview | null) => void
const previewListeners: PreviewListener[] = []
const forwardPreview = (event: Event) => {
  previewListeners.at(-1)?.((event as CustomEvent<BackPreview | null>).detail)
}

export const subscribeToAndroidBackPreview = (listener: PreviewListener) => {
  const device = android
  if (!device) {
    return
  }
  if (previewListeners.length === 0) {
    window.addEventListener('android-back-preview', forwardPreview)
    device.setBackPreviewEnabled(true)
  }
  previewListeners.push(listener)
  return () => {
    previewListeners.splice(previewListeners.indexOf(listener), 1)
    if (previewListeners.length === 0) {
      device.setBackPreviewEnabled(false)
      window.removeEventListener('android-back-preview', forwardPreview)
    }
  }
}

export const useAndroidBackInterception = (active = true) => {
  useLayoutEffect(() => {
    const device = android
    if (!device || !active) {
      return
    }
    if (++interceptors === 1) {
      device.setHandlesBack(true)
    }
    return () => {
      if (--interceptors === 0) {
        device.setHandlesBack(false)
      }
    }
  }, [active])
}
