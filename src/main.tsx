/* ============================================================================
 * 功能区：源码模块 / main 开始
 * 职责：前端入口：挂载根组件、初始化主题与 Android 视图参数。
 * ========================================================================== */

import './utils/abort.js'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { CrashScreen } from './app/CrashScreen.js'
import { android } from './app/android.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'
import './app/android.css'

/* WebView 没有接管 onJsConfirm 时，window.confirm 会把 JS 线程挂住，表现为整页点不动，
   只能强杀应用。应用内确认统一走自绘弹窗，这里留一个不阻塞的兜底。 */
window.confirm = () => {
  // oxlint-disable-next-line no-console -- 保留调用方诊断，不弹原生阻塞框
  console.warn('window.confirm 已禁用：请使用应用内确认弹窗')
  return false
}

ensureKatex()
if (android) {
  document.title = ''
  const root = document.documentElement
  const buttonNavigationInset = android.buttonNavigationInset()
  root.dataset.android = ''
  root.style.setProperty('--android-status-inset', `${android.statusInset()}px`)
  root.style.setProperty('--android-button-nav-inset', `${buttonNavigationInset}px`)
  root.toggleAttribute('data-button-navigation', buttonNavigationInset > 0)
}
setupTheme()

/* 上一轮渲染失败可能留有记录：本次成功挂载前清除，避免诊断信息保留过期错误 */
try {
  localStorage.removeItem('replica:last-render-error')
} catch {
  /* 隐私模式下存储不可写，忽略 */
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <CrashScreen>
    <App />
  </CrashScreen>
)
requestAnimationFrame(() => {
  // 只标记脚本已执行；遮罩等 App 真正画出会话后再由 App 调用 __replicaBootDone，
  // 否则 React 尚未提交首屏就淡出，会先露出空白再弹出对话，形成一次闪白。
  ;(window as Window & { __replicaReady?: boolean }).__replicaReady = true
})

/* ============================================================================
 * 功能区：源码模块 / main 结束
 * ========================================================================== */
