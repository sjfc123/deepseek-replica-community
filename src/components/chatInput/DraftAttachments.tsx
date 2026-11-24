/* ============================================================================
 * 功能区：输入与语音控件 / DraftAttachments 开始
 * 职责：DraftAttachments 组件，负责该组件的渲染、状态与交互出口。
 * 导出：DraftAttachments。
 * ========================================================================== */

import clsx from 'clsx'
import { memo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useUploads, type UploadTask } from '../../services/attachments.js'
import type { DraftAttachment } from '../../services/chat/drafts.js'
import { IconCloseFill14, IconPhotoErrorFill20, IconRefreshOutline16 } from '../base/icons.js'
import { Tooltip } from '../base/Tooltip.js'
import { FileCard } from '../files/FileCard.js'
import styles from './ChatInput.module.css'

const UPLOADING: UploadTask = { status: 'uploading' }

/** 列表只随草稿附件变化更新；每张卡片独立订阅自己的上传状态。 */
export const DraftAttachments = memo(function DraftAttachments({
  items,
  onRetry,
  onRemove,
  onPreview,
  exiting = false,
  localOnly = false,
}: {
  items: DraftAttachment[]
  onRetry: (id: string) => void
  onRemove: (id: string) => void
  onPreview?: (id: string) => void
  exiting?: boolean
  localOnly?: boolean
}) {
  if (items.length === 0) {
    return null
  }
  return (
    <div className={styles.attachments}>
      {items.map((item) => (
        <AttachmentItem
          key={item.id}
          item={item}
          ready={exiting || localOnly}
          onRetry={() => onRetry(item.id)}
          onRemove={() => onRemove(item.id)}
          onPreview={!exiting && onPreview ? () => onPreview(item.id) : undefined}
        />
      ))}
    </div>
  )
})

/** 输入框里的文件：图片显示缩略图，其余显示文件卡片 */
const AttachmentItem = ({
  item,
  ready,
  onRetry,
  onRemove,
  onPreview,
}: {
  item: DraftAttachment
  ready: boolean
  onRetry: () => void
  onRemove: () => void
  onPreview?: () => void
}) => {
  const t = useTranslate()
  const task = useUploads((state) => state.tasks[item.id] ?? UPLOADING)
  const status = ready || item.existing ? 'done' : task.status
  const error =
    status === 'error' && task.status === 'error' ? t(task.error.key, task.error.params) : undefined
  // 过大、格式不支持等重试无效的失败只提示原因，需删除后再发送
  const retry =
    status === 'error' && task.status === 'error' && task.retryable ? onRetry : undefined
  const failed = status === 'error'
  const retryLabel = t('uploadRetry', { message: error ?? t('uploadFileStatusFailed') })
  // 「上传失败」只显示重试图标，其余原因写在图片上：可重试时在图标下方，不可重试时贴底
  const showReason = failed && error !== undefined && error !== t('uploadFileStatusFailed')
  return item.isImage ? (
    <div
      className={clsx(styles.attachment, failed && styles.attachmentFailed)}
      title={error ?? item.name}
    >
      {item.previewUrl ? (
        onPreview ? (
          <button
            type="button"
            className={styles.previewImage}
            aria-label={t('androidPreviewDraftImage', { name: item.name })}
            onClick={onPreview}
          >
            <img src={item.previewUrl} alt="" />
          </button>
        ) : (
          <img src={item.previewUrl} alt={item.name} />
        )
      ) : item.blob === null ? (
        <span className={styles.missingImage} role="img" aria-label={item.name}>
          <IconPhotoErrorFill20 />
        </span>
      ) : null}
      {status === 'uploading' ? <div className={styles.uploading} /> : null}
      {failed && retry ? (
        <Tooltip content={retryLabel}>
          <button type="button" className={styles.failed} aria-label={retryLabel} onClick={retry}>
            <IconRefreshOutline16 />
            {showReason ? <span className={styles.failedReason}>{error}</span> : null}
          </button>
        </Tooltip>
      ) : null}
      {failed && !retry ? (
        <div className={clsx(styles.failed, styles.failedStatic)} aria-label={error}>
          {showReason ? <span className={styles.failedReason}>{error}</span> : null}
        </div>
      ) : null}
      <button
        type="button"
        className={clsx(styles.remove, failed && !retry && styles.invalidRemove)}
        aria-label={t('delete')}
        onClick={onRemove}
      >
        <IconCloseFill14 />
      </button>
    </div>
  ) : (
    <FileCard
      name={item.name}
      size={item.size}
      status={status}
      error={error}
      onRetry={retry}
      onRemove={onRemove}
    />
  )
}

/* ============================================================================
 * 功能区：输入与语音控件 / DraftAttachments 结束
 * ========================================================================== */
