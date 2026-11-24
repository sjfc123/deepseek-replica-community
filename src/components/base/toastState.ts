/* ============================================================================
 * 功能区：基础 UI / toastState 开始
 * 职责：轻提示状态：创建、排队与自动关闭 Toast。
 * 导出：useToast、showToast。
 * ========================================================================== */

import { create } from 'zustand'
import type { LinkedMessage } from '../../i18n/index.js'

/** 轻提示：同一时间只显示一条，新的替换旧的，到时自动消失；文案在渲染时按当前语言翻译 */
type ToastState = { id: number; message: LinkedMessage | string | null; duration: number }

export const useToast = create<ToastState>(() => ({ id: 0, message: null, duration: 0 }))

const DURATION = 3000
/** 带链接时多留一些时间，方便点击 */
const LINK_DURATION = 5000
let timer = 0

export const showToast = (message: LinkedMessage | string, duration?: number) => {
  window.clearTimeout(timer)
  const visibleDuration =
    duration ?? (typeof message !== 'string' && message.link ? LINK_DURATION : DURATION)
  useToast.setState((state) => ({ id: state.id + 1, message, duration: visibleDuration }))
  timer = window.setTimeout(() => useToast.setState({ message: null }), visibleDuration)
}

/* ============================================================================
 * 功能区：基础 UI / toastState 结束
 * ========================================================================== */
