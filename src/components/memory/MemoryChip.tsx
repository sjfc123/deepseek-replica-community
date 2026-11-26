/* ============================================================================
 * 功能区：视图与交互 / MemoryChip
 * 职责：MemoryChip 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：MemoryChip
 * 关联：依赖 components/memory/MemoryChip.module；
 *    被 components/messages/AssistantMessage、components/session/MobileHeader、components/session/SessionView 引用。
 * 导出：MemoryChip
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import clsx from 'clsx'
import styles from './MemoryChip.module.css'

/* ---- 01 实现：MemoryChip ---- */
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
