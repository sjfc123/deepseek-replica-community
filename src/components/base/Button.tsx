/* ============================================================================
 * 功能区：基础 UI / Button 开始
 * 职责：Button 组件，负责该组件的渲染、状态与交互出口。
 * 导出：Button。
 * ========================================================================== */

import clsx from 'clsx'
import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

export const Button = ({
  variant = 'primary',
  size = 'l',
  block = false,
  className,
  ...props
}: {
  variant?: 'primary' | 'outlined' | 'danger' | 'dangerOutlined'
  size?: 'l' | 'm' | 's'
  block?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    className={clsx(styles.button, styles[variant], styles[size], block && styles.block, className)}
    {...props}
  />
)

/* ============================================================================
 * 功能区：基础 UI / Button 结束
 * ========================================================================== */
