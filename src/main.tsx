/* ============================================================================
 * 功能区：应用入口与共享契约 / main · 前端入口
 * 职责：前端入口：挂载根组件、初始化主题与 Android 视图参数，并安装崩溃隔离与全局确认替代。
 * 分区：01 全局确认替代；02 启动装配与主题；03 Android 视图参数与收尾
 * 关联：依赖 app/App、app/CrashScreen、app/android、app/global 等 7 个模块；无内联引用。
 * 导出：无对外导出（入口模块，仅执行挂载副作用）
 * 边界：只负责应用挂载、全局样式与启动诊断；不实现页面状态、接口协议或数据持久化。
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

/* ---- 01 全局确认替代 ---- */
/* WebView 没有接管 onJsConfirm 时，window.confirm 会把 JS 线程挂住，表现为整页点不动，
   只能强杀应用。应用内确认统一走自绘弹窗，这里提供不阻塞的进程退出路径。 */
window.confirm = () => {
  // oxlint-disable-next-line no-console -- 保留调用方诊断，不弹原生阻塞框
  console.warn('window.confirm 已禁用：请使用应用内确认弹窗')
  return false
}

/* ---- 02 启动装配与主题 ---- */
ensureKatex()
/* ---- 03 Android 视图参数与收尾 ---- */
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
  /* 隐私模式下存储不可写，不写入任何数据 */
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
