/* ============================================================================
 * 功能区：长期记忆界面 / MemoryChip 开始
 * 职责：MemoryChip 组件，负责该组件的渲染、状态与交互出口。
 * 导出：MemoryChip。
 * ========================================================================== */

import clsx from 'clsx'
import styles from './MemoryChip.module.css'

/**
 * 记忆胶囊：顶栏入口与消息内标记共用。
 * header 变体带描边与数量，inline 变体更小，仅显示该回复关联的记忆条数。
 */
export const MemoryChip = ({
  count,
  onClick,
  variant = 'header',
  pulse = false,
  className,
}: {
  count: number
  onClick: () => void
  variant?: 'header' | 'inline'
  pulse?: boolean
  className?: string
}) => (
  <button
    type="button"
    className={clsx(styles.chip, className)}
    data-variant={variant}
    data-pulse={pulse ? '' : undefined}
    aria-label={count > 0 ? `长期记忆，共 ${count} 条` : '长期记忆'}
    onClick={onClick}
  >
    <span className={styles.star} aria-hidden="true">
      ✦
    </span>
    <span className={styles.label}>记忆</span>
    {count > 0 ? <span className={styles.count}>{count}</span> : null}
  </button>
)

/* ============================================================================
 * 功能区：长期记忆界面 / MemoryChip 结束
 * ========================================================================== */
