/* ============================================================================
 * 功能区：应用外壳 / useAndroidBackInterception · Android 返回拦截
 * 职责：Android 返回拦截：注册返回事件、预览与阻塞条件，并同步给原生壳。
 * 分区：01 类型、契约与依赖；
 *    02 核心实现：forwardPreview、subscribeToAndroidBackPreview、useAndroidBackInterception
 * 关联：依赖 app/android；
 *    被 app/App、components/base/Modal、components/chatInput/ChatInput、components/chatInput/VoiceCallOverlay 等 9 个模块 引用。
 * 导出：subscribeToAndroidBackPreview、useAndroidBackInterception
 * 边界：只处理应用装配、生命周期、导航与全局视图；不实现聊天协议、持久化与业务算法。
 * ========================================================================== */

import { useLayoutEffect } from 'react'
import { android } from './android.js'

/* ---- 01 类型、契约与依赖 ---- */
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

/* ---- 02 核心实现：forwardPreview、subscribeToAndroidBackPreview、useAndroidBackInterception ---- */
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
    const index = previewListeners.indexOf(listener)
    if (index >= 0) {
      previewListeners.splice(index, 1)
    }
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

/* ============================================================================
 * 功能区：应用外壳 / useAndroidBackInterception 结束
 * ========================================================================== */
