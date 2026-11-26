/* ============================================================================
 * 功能区：视图与交互 / MemoryAddedToast
 * 职责：MemoryAddedToast 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、契约与依赖；02 核心实现：Payload、LABELS、MemoryAddedToast
 * 关联：依赖 components/memory/MemoryAddedToast.module、components/memory/memoryPanelState；
 *    被 app/App 引用。
 * 导出：MemoryAddedToast
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useEffect, useState } from 'react'
import styles from './MemoryAddedToast.module.css'
import { useMemoryPanel } from './memoryPanelState.js'

/* ---- 01 类型、契约与依赖 ---- */
type Kind = 'turn' | 'refine' | 'manual'
type Payload = { kind: Kind; count: number }

const LABELS: Record<Kind, string> = {
  turn: '已记住这一轮',
  refine: '长期记忆已整理',
  manual: '已添加一条长期记忆',
}

/* ---- 02 核心实现：Payload、LABELS、MemoryAddedToast ---- */
/**
 * 记忆写入的即时反馈：卡片真正挂上去后才由 store 派发事件，
 * 挂在页面顶部，两秒多自动淡出，不打断聊天。
 */
export const MemoryAddedToast = () => {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [visible, setVisible] = useState(false)
  // 记忆面板打开时由面板内的 saveNotice 就地反馈，避免顶部气泡盖住弹窗标题。
  const panelOpen = useMemoryPanel((state) => state.open)

  useEffect(() => {
    let timer = 0
    const onAdded = (event: Event) => {
      const detail = (event as CustomEvent<Payload>).detail
      if (!detail) {
        return
      }
      setPayload(detail)
      setVisible(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setVisible(false), 2400)
    }
    window.addEventListener('replica:memory-added', onAdded)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('replica:memory-added', onAdded)
    }
  }, [])

  if (!payload || panelOpen) {
    return null
  }

  return (
    <div className={styles.layer} data-visible={visible} aria-live="polite">
      <div className={styles.chip} data-kind={payload.kind}>
        <span className={styles.icon} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
            <path
              d="M12 4.5 13.7 9.3 18.5 11 13.7 12.7 12 17.5 10.3 12.7 5.5 11 10.3 9.3Z"
              fill="currentColor"
            />
            <circle cx="18.5" cy="5" r="1.6" fill="currentColor" opacity=".7" />
          </svg>
        </span>
        <span>{LABELS[payload.kind]}</span>
        <span className={styles.count}>· 记忆 {payload.count} 条</span>
      </div>
    </div>
  )
}

/* ============================================================================
 * 功能区：长期记忆界面 / MemoryAddedToast 结束
 * ========================================================================== */
