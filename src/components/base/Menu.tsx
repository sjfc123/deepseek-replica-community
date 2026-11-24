import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from './anchored.js'
import styles from './Menu.module.css'

export type MenuOption = {
  key: string
  label: string
  icon: ReactNode
  danger?: boolean
  /** 从这里开始另起一组，视觉上用留白隔开，避免一长串按钮黏在一起 */
  sectionStart?: boolean
  onSelect: () => void
}

/** 点击触发，向下展开；点外部或 Esc 关闭 */
export const Menu = ({
  options,
  children,
  variant,
  anchorClassName,
  anchorPoint,
  onOpenChange,
}: {
  options: MenuOption[]
  children: (props: { open: boolean; toggle: () => void }) => ReactNode
  variant?: 'sidebar' | 'userMessage' | 'assistantMessage'
  anchorClassName?: string
  /** 长按触点：菜单以手指按下的文字位置为锚点，而不是会话行的按钮 */
  anchorPoint?: { x: number; y: number } | null
  onOpenChange?: (open: boolean) => void
}) => {
  const [open, setOpen] = useState(false)
  const changeOpen = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }
  const close = () => changeOpen(false)
  const sidebarMenu = variant === 'sidebar'
  const userMessageMenu = variant === 'userMessage'
  const assistantMessageMenu = variant === 'assistantMessage'
  // 长按以手指按下的文字为锚点：会话向左展开，消息按所在列向内展开
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    userMessageMenu
      ? { point: anchorPoint, align: 'end', alignOffset: 0, offset: -7.8222, maxHeight: 228 }
      : {
          point: anchorPoint,
          align: 'start',
          alignOffset: -5,
          offset: sidebarMenu ? 5.6 : 4,
          // 会话菜单在网页端也可能有 9 项；上限留足，具体高度仍会按视口剩余空间收口
          maxHeight: sidebarMenu ? 420 : 286,
        }
  )
  useDismiss(open, [anchorRef, floatingRef], close)

  return (
    <>
      <span ref={anchorRef} className={clsx(styles.anchor, anchorClassName)}>
        {children({ open, toggle: () => changeOpen(!open) })}
      </span>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={clsx(
                styles.menu,
                sidebarMenu && styles.sidebarMenu,
                userMessageMenu && styles.userMessageMenu,
                assistantMessageMenu && styles.assistantMessageMenu
              )}
              style={position ?? undefined}
              role="menu"
            >
              {options.map((option) => (
                <div
                  key={option.key}
                  role="menuitem"
                  className={clsx(
                    styles.option,
                    option.danger && styles.danger,
                    option.sectionStart && styles.sectionStart
                  )}
                  onClick={(event) => {
                    event.stopPropagation()
                    changeOpen(false)
                    option.onSelect()
                  }}
                >
                  <span className={styles.icon}>{option.icon}</span>
                  <span>{option.label}</span>
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
