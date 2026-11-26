/* ============================================================================
 * 功能区：视图与交互 / FileCard
 * 职责：FileCard 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：FileCard
 * 关联：依赖 components/base/icons、components/files/FileCard.module、components/files/FileIcon、i18n/index 等 5 个模块；
 *    被 components/chatInput/DraftAttachments、components/messages/MessageFile 引用。
 * 导出：FileCard
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import clsx from 'clsx'
import type { ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { formatSize, getExtension } from '../../services/attachments.js'
import { IconCloseFill14, IconRefreshOutline16 } from '../base/icons.js'
import { FileIcon } from './FileIcon.js'
import styles from './FileCard.module.css'

/* ---- 01 实现：FileCard ---- */
/**
 * 文档文件卡片：图标 + 文件名 + 「扩展名 大小」或状态文案。
 * 输入框内失败时描边和说明标红；可重试时显示刷新图标，不可重试时常显红色删除按钮。
 * 消息里的不可重试文件保留普通边框和状态说明。
 */
export const FileCard = ({
  name,
  size,
  status = 'done',
  error,
  onRetry,
  onRemove,
  onOpen,
}: {
  name: string
  size: number
  status?: 'uploading' | 'done' | 'error'
  error?: string
  onRetry?: () => void
  onRemove?: () => void
  onOpen?: () => void
}) => {
  const t = useTranslate()
  const ext = getExtension(name)
  let icon: ReactNode = <FileIcon ext={ext} />
  let description = [ext, formatSize(size)].filter(Boolean).join(' ')
  if (status === 'uploading') {
    icon = <span className={styles.spinner} />
    description = t('uploadFileStatusUploading')
  } else if (status === 'error') {
    // 不可重试（过大、格式不支持）时保留文件图标并显示原因
    if (onRetry) {
      icon = <IconRefreshOutline16 />
    }
    description = error ?? t('uploadFileStatusFailed')
  }
  const onClick = status === 'error' ? onRetry : status === 'done' ? onOpen : undefined
  return (
    <div
      className={clsx(
        styles.card,
        onRemove && styles.editable,
        status === 'error' && (onRemove || onRetry) && styles.failed,
        onClick && styles.clickable
      )}
      title={
        status === 'error'
          ? onRetry
            ? t('uploadRetry', { message: description })
            : description
          : name
      }
      onClick={onClick}
    >
      <div className={clsx(styles.icon, status === 'error' && onRetry && styles.retry)}>{icon}</div>
      <div className={styles.content}>
        <div className={styles.caption}>{name}</div>
        <div className={styles.subCaption}>{description}</div>
      </div>
      {onRemove ? (
        <button
          type="button"
          className={clsx(styles.remove, status === 'error' && !onRetry && styles.invalidRemove)}
          aria-label={t('delete')}
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
        >
          <IconCloseFill14 />
        </button>
      ) : null}
    </div>
  )
}

/* ============================================================================
 * 功能区：附件与文件预览 / FileCard 结束
 * ========================================================================== */
