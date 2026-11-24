/* ============================================================================
 * 功能区：消息渲染 / TokenUsageChip 开始
 * 职责：TokenUsageChip 组件，负责该组件的渲染、状态与交互出口。
 * 导出：TokenUsageChip。
 * ========================================================================== */

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatTokenCount } from '../../services/chat/tokenUsage.js'
import styles from './TokenUsageChip.module.css'

const CLOSE_HOLD_MS = 5000

/**
 * 聊天区顶部的用量小窗：显示本段对话接口返回的实际 tokens，
 * 按住不动 5 秒关闭，按住后拖动可换位置。
 */
export const TokenUsageChip = ({
  used,
  limit,
  onClose,
}: {
  used: number
  limit: number
  onClose: () => void
}) => {
  const chipRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pressing, setPressing] = useState(false)
  const timer = useRef(0)
  const start = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  const clearPress = useCallback(() => {
    window.clearTimeout(timer.current)
    setPressing(false)
  }, [])

  useEffect(() => clearPress, [clearPress])

  const ratio = limit > 0 ? Math.min(1, used / limit) : 0

  return (
    <div
      ref={chipRef}
      className={styles.chip}
      data-dragging={dragging ? '' : undefined}
      data-pressing={pressing ? '' : undefined}
      style={pos ? { left: pos.x, top: pos.y, transform: 'none' } : undefined}
      role="status"
      aria-label={`接口实际用量 ${formatTokenCount(used)}，提醒阈值 ${formatTokenCount(limit)}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        const rect = event.currentTarget.getBoundingClientRect()
        start.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
        setPressing(true)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(onClose, CLOSE_HOLD_MS)
      }}
      onPointerMove={(event) => {
        const origin = start.current
        if (!origin) {
          return
        }
        const dx = event.clientX - origin.x
        const dy = event.clientY - origin.y
        if (!dragging && Math.abs(dx) + Math.abs(dy) < 8) {
          return
        }
        // 拖动开始即取消“按住关闭”，避免移动窗口时误触发关闭
        clearPress()
        setDragging(true)
        const width = chipRef.current?.offsetWidth ?? 0
        const height = chipRef.current?.offsetHeight ?? 0
        setPos({
          x: Math.min(window.innerWidth - width - 8, Math.max(8, origin.left + dx)),
          y: Math.min(window.innerHeight - height - 8, Math.max(8, origin.top + dy)),
        })
      }}
      onPointerUp={() => {
        start.current = null
        setDragging(false)
        clearPress()
      }}
      onPointerCancel={() => {
        start.current = null
        setDragging(false)
        clearPress()
      }}
    >
      <span className={styles.label}>实际</span>
      <span className={styles.value} key={used}>
        {formatTokenCount(used)}
      </span>
      <span className={styles.limit}>/ {formatTokenCount(limit)}</span>
      <span className={styles.bar} aria-hidden="true">
        <span style={{ width: `${Math.round(ratio * 100)}%` }} />
      </span>
    </div>
  )
}

/* ============================================================================
 * 功能区：消息渲染 / TokenUsageChip 结束
 * ========================================================================== */
