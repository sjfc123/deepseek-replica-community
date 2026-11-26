/* ============================================================================
 * 功能区：视图与交互 / Toast
 * 职责：Toast 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：Toast
 * 关联：依赖 components/base/Toast.module、components/base/icons、components/base/toastState、i18n/index；
 *    被 app/App 引用。
 * 导出：Toast
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import clsx from 'clsx'
import type { CSSProperties } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconToastError16 } from './icons.js'
import { useToast } from './toastState.js'
import styles from './Toast.module.css'

/* ---- 01 实现：Toast ---- */
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
