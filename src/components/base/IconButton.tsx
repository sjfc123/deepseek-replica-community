/* ============================================================================
 * 功能区：视图与交互 / IconButton
 * 职责：IconButton 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：IconButton
 * 关联：依赖 components/base/IconButton.module、components/base/Tooltip；
 *    被 components/base/Modal、components/chatInput/ChatInput、components/messages/AssistantMessage、components/messages/BranchSwitcher 等 13 个模块 引用。
 * 导出：IconButton
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Tooltip, type TooltipPlacement } from './Tooltip.js'
import styles from './IconButton.module.css'

/* ---- 01 实现：IconButton ---- */
/**
 * xs 为 28px（图标 16px）、m 为 34px、xl 为 44px（图标 20px）。
 * tooltip 同时作为无障碍名称；没有 tooltip 的按钮通过 aria-label 提供名称
 */
export const IconButton = ({
  icon,
  size = 'xs',
  tone = 'tertiary',
  tooltip,
  tooltipPlacement,
  className,
  ...props
}: {
  icon: ReactNode
  size?: 'xs' | 'm' | 'xl'
  tone?: 'tertiary' | 'primary'
  tooltip?: string
  tooltipPlacement?: TooltipPlacement
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'>) => {
  const button = (
    <button
      type="button"
      className={clsx(styles.button, styles[size], styles[tone], className)}
      aria-label={tooltip}
      {...props}
    >
      {icon}
    </button>
  )
  return tooltip ? (
    <Tooltip content={tooltip} placement={tooltipPlacement}>
      {button}
    </Tooltip>
  ) : (
    button
  )
}

/* ============================================================================
 * 功能区：基础 UI / IconButton 结束
 * ========================================================================== */
