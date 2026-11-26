/* ============================================================================
 * 功能区：视图与交互 / Tooltip
 * 职责：Tooltip 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、契约与依赖；02 核心实现：TooltipPlacement、ENTER_DELAY、Tooltip
 * 关联：依赖 app/viewport、components/base/Tooltip.module、components/base/anchored；
 *    被 components/base/IconButton、components/chatInput/ChatInput、components/chatInput/DraftAttachments、components/chatInput/VoiceButton 等 6 个模块 引用。
 * 导出：TooltipPlacement、Tooltip
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '../../app/viewport.js'
import { useAnchoredPosition, useDelayedOpen } from './anchored.js'
import styles from './Tooltip.module.css'

/* ---- 01 类型、契约与依赖 ---- */
export type TooltipPlacement = 'top' | 'bottom'

const ENTER_DELAY = 100

/* ---- 02 核心实现：TooltipPlacement、ENTER_DELAY、Tooltip ---- */
/**
 * 悬停 100ms 后出现，离开立即消失，移动端不显示。
 * 触发元素外包一层 display: contents，不影响布局。
 */
export const Tooltip = ({
  content,
  placement = 'top',
  children,
}: {
  content: ReactNode
  placement?: TooltipPlacement
  children: ReactNode
}) => {
  const isMobile = useIsMobile()
  const { open, setOpen, schedule, cancel } = useDelayedOpen()
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { side: placement, align: 'center', measureFirstChild: true, measureKey: content }
  )

  useEffect(() => () => cancel(), [cancel])

  // 滚动时收起提示，避免浮层跟随视口错位。
  useEffect(() => {
    if (!open) {
      return
    }
    const onScroll = () => setOpen(false)
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [open, setOpen])

  const visible = open && !isMobile && Boolean(content)

  return (
    <>
      <span
        ref={anchorRef}
        className={styles.trigger}
        onMouseEnter={() => schedule(true, ENTER_DELAY)}
        onMouseLeave={() => schedule(false, 0)}
      >
        {children}
      </span>
      {visible
        ? createPortal(
            <div
              ref={floatingRef}
              role="tooltip"
              className={styles.tooltip}
              style={position ?? { top: 0, left: 0, visibility: 'hidden' }}
            >
              {content}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

/* ============================================================================
 * 功能区：基础 UI / Tooltip 结束
 * ========================================================================== */
