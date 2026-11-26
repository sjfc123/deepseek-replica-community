/* ============================================================================
 * 功能区：视图与交互 / Button
 * 职责：Button 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：Button
 * 关联：依赖 components/base/Button.module；
 *    被 app/App、components/chatInput/ChatInput、components/files/AndroidImageViewer、components/messages/AssistantMessage 等 7 个模块 引用。
 * 导出：Button
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import clsx from 'clsx'
import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

/* ---- 01 实现：Button ---- */
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
