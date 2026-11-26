/* ============================================================================
 * 功能区：侧栏与会话管理 / SessionActionDialog 开始
 * 职责：SessionActionDialog 组件，负责该组件的渲染、状态与交互出口。
 * 导出：SessionActionDialog。
 * ========================================================================== */

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAndroidBackInterception } from '../../app/useAndroidBackInterception.js'
import styles from './SessionActionDialog.module.css'

/** 侧边栏会话动作弹窗；叠放时 Esc 只关闭最上层。 */
const openDialogs: object[] = []

export const SessionActionDialog = ({
  title,
  description,
  children,
  cancelLabel,
  confirmLabel,
  secondaryLabel,
  danger = false,
  secondaryDanger = false,
  stacked = false,
  closeDisabled = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
  onSecondary,
}: {
  title: string
  description?: string
  children?: ReactNode
  cancelLabel: string
  confirmLabel: string
  secondaryLabel?: string
  danger?: boolean
  secondaryDanger?: boolean
  stacked?: boolean
  closeDisabled?: boolean
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: () => void
  onSecondary?: () => void
}) => {
  useAndroidBackInterception(!closeDisabled)

  useEffect(() => {
    const token = {}
    openDialogs.push(token)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openDialogs.at(-1) === token && !closeDisabled) {
        onCancel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      openDialogs.splice(openDialogs.indexOf(token), 1)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeDisabled, onCancel])

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (!closeDisabled && event.target === event.currentTarget) {
          onCancel()
        }
      }}
    >
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.title}>{title}</div>
        {description ? <p className={styles.description}>{description}</p> : null}
        {children ? <div className={styles.body}>{children}</div> : null}
        <div className={stacked ? styles.stackedActions : styles.actions}>
          {stacked ? (
            <>
              <button
                type="button"
                className={danger ? styles.danger : styles.primary}
                disabled={confirmDisabled}
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
              {secondaryLabel && onSecondary ? (
                <button
                  type="button"
                  className={secondaryDanger ? styles.secondaryDanger : undefined}
                  disabled={closeDisabled}
                  onClick={onSecondary}
                >
                  {secondaryLabel}
                </button>
              ) : null}
              <button type="button" disabled={closeDisabled} onClick={onCancel}>
                {cancelLabel}
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={closeDisabled} onClick={onCancel}>
                {cancelLabel}
              </button>
              <button
                type="button"
                className={danger ? styles.confirmDanger : styles.confirm}
                disabled={confirmDisabled}
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
            </>
          )}
        </div>
      </section>
    </div>,
    document.body
  )
}

/* ============================================================================
 * 功能区：侧栏与会话管理 / SessionActionDialog 结束
 * ========================================================================== */
