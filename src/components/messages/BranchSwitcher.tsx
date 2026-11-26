/* ============================================================================
 * 功能区：视图与交互 / BranchSwitcher
 * 职责：BranchSwitcher 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、契约与依赖；02 核心实现：SelectMessageVersion、BranchSwitcher
 * 关联：依赖 components/base/IconButton、components/base/icons、components/messages/BranchSwitcher.module、i18n/index 等 5 个模块；
 *    被 components/messages/AssistantMessage、components/messages/UserMessage 引用。
 * 导出：SelectMessageVersion、BranchSwitcher
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useTranslate } from '../../i18n/index.js'
import { useRef } from 'react'
import type { MessageVersions } from '../../services/chat/branches.js'
import { IconChevronRightOutline14 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import styles from './BranchSwitcher.module.css'

/* ---- 01 类型、契约与依赖 ---- */
export type { MessageVersions } from '../../services/chat/branches.js'
export type SelectMessageVersion = (messageId: string, anchorTop: number) => void

/* ---- 02 核心实现：SelectMessageVersion、BranchSwitcher ---- */
export const BranchSwitcher = ({
  versions,
  disabled,
  onSelect,
}: {
  versions: MessageVersions
  disabled: boolean
  onSelect: SelectMessageVersion
}) => {
  const t = useTranslate()
  const anchorRef = useRef<HTMLDivElement>(null)
  const { ids, index } = versions
  const select = (messageId: string) => {
    if (anchorRef.current) {
      onSelect(messageId, anchorRef.current.getBoundingClientRect().top)
    }
  }
  if (ids.length <= 1) {
    return null
  }
  return (
    <div
      ref={anchorRef}
      className={styles.switcher}
      aria-label={t('messageVersions')}
      data-message-version={ids[index]}
    >
      <IconButton
        icon={<IconChevronRightOutline14 />}
        className={styles.previous}
        aria-label={t('previousVersion')}
        disabled={disabled || index <= 0}
        onClick={() => select(ids[index - 1])}
      />
      <span className={styles.count}>
        {index + 1} / {ids.length}
      </span>
      <IconButton
        icon={<IconChevronRightOutline14 />}
        aria-label={t('nextVersion')}
        disabled={disabled || index >= ids.length - 1}
        onClick={() => select(ids[index + 1])}
      />
    </div>
  )
}

/* ============================================================================
 * 功能区：消息渲染 / BranchSwitcher 结束
 * ========================================================================== */
