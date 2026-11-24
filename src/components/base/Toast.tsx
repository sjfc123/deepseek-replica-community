/* ============================================================================
 * 功能区：基础 UI / Toast 开始
 * 职责：Toast 组件，负责该组件的渲染、状态与交互出口。
 * 导出：Toast。
 * ========================================================================== */

import clsx from 'clsx'
import type { CSSProperties } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconToastError16 } from './icons.js'
import { useToast } from './toastState.js'
import styles from './Toast.module.css'

export const Toast = () => {
  const t = useTranslate()
  const { id, message, duration } = useToast()
  if (!message) {
    return null
  }
  const style = { '--toast-duration': `${duration}ms` } as CSSProperties
  const key =
    typeof message === 'string'
      ? undefined
      : message.key === 'androidAlreadyInNewChat'
        ? 'android-new-chat'
        : undefined
  if (typeof message === 'string') {
    return (
      <div key={id} className={styles.toast} style={style} data-toast={key} role="status">
        {message}
      </div>
    )
  }
  const error = message.type === 'error'
  return (
    <div
      key={id}
      className={clsx(styles.toast, error && styles.error)}
      style={style}
      data-toast={key}
      role="status"
    >
      {error ? (
        <span className={styles.icon}>
          <IconToastError16 />
        </span>
      ) : null}
      <span className={styles.content}>
        {t(message.key, message.params)}
        {message.link ? (
          <a className={styles.link} href={message.link.href} target="_blank" rel="noreferrer">
            {t(message.link.key)}
          </a>
        ) : null}
      </span>
    </div>
  )
}

/* ============================================================================
 * 功能区：基础 UI / Toast 结束
 * ========================================================================== */
