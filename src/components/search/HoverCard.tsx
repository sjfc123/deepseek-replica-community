/* ============================================================================
 * 功能区：视图与交互 / HoverCard
 * 职责：HoverCard 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、契约与依赖；02 核心实现：GAP、HoverCardTrigger、HoverCard
 * 关联：依赖 components/base/anchored、components/search/HoverCard.module；
 *    被 components/search/CitationLink 引用。
 * 导出：HoverCardTrigger、HoverCard
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useEffect, type HTMLAttributes, type MutableRefObject, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDelayedOpen } from '../base/anchored.js'
import styles from './HoverCard.module.css'

/* ---- 01 类型、契约与依赖 ---- */
const ENTER_DELAY = 300
const LEAVE_DELAY = 100
const GAP = 6

export type HoverCardTrigger = (props: {
  domRef: MutableRefObject<HTMLSpanElement | null>
  domProps: Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'className' | 'style'> | undefined
}) => ReactNode

/* ---- 02 核心实现：GAP、HoverCardTrigger、HoverCard ---- */
/** 悬停 300ms 后在触发元素下方显示卡片（放不下则上方），鼠标可移入卡片 */
export const HoverCard = ({
  renderTrigger,
  children,
}: {
  renderTrigger: HoverCardTrigger
  children: ReactNode
}) => {
  const { open, schedule, cancel } = useDelayedOpen()
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { align: 'center', offset: GAP }
  )

  useEffect(() => () => cancel(), [cancel])

  return (
    <>
      {renderTrigger({
        domRef: anchorRef,
        domProps: {
          onMouseEnter: () => schedule(true, ENTER_DELAY),
          onMouseLeave: () => schedule(false, LEAVE_DELAY),
        },
      })}
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.card}
              style={position ?? { top: 0, left: 0, visibility: 'hidden' }}
              onMouseEnter={cancel}
              onMouseLeave={() => schedule(false, LEAVE_DELAY)}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

/* ============================================================================
 * 功能区：搜索与引用 / HoverCard 结束
 * ========================================================================== */
