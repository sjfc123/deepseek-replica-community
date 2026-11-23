import { useEffect, useState } from 'react'
import styles from './MemoryAddedToast.module.css'

type Kind = 'turn' | 'refine' | 'manual'
type Payload = { kind: Kind; count: number }

const LABELS: Record<Kind, string> = {
  turn: '已记住这一轮',
  refine: '长期记忆已整理',
  manual: '已添加一条长期记忆',
}

/**
 * 记忆写入的即时反馈：卡片真正挂上去后才由 store 派发事件，
 * 挂在页面顶部，两秒多自动淡出，不打断聊天。
 */
export const MemoryAddedToast = () => {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [visible, setVisible] = useState(false)

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

  if (!payload) {
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
