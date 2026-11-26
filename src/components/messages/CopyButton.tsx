/* ============================================================================
 * 功能区：视图与交互 / CopyButton
 * 职责：CopyButton 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：CopyButton
 * 关联：依赖 components/base/IconButton、components/base/icons、components/base/toastState、i18n/index 等 5 个模块；
 *    被 components/messages/AssistantMessage、components/messages/UserMessage 引用。
 * 导出：CopyButton
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconCheckOutline16, IconCopyOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { showToast } from '../base/toastState.js'
import { copyText } from '../../utils/clipboard.js'

/* ---- 01 实现：CopyButton ---- */
/** 复制成功后图标换成对勾 1 秒并提示，期间再次点击不重复复制 */
export const CopyButton = ({
  text,
  className,
  buttonProps,
  iconWrapperClassName,
}: {
  text: string
  className?: string
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>
  iconWrapperClassName?: string
}) => {
  const t = useTranslate()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timerRef.current), [])
  const icon: ReactNode = copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />

  return (
    <IconButton
      icon={iconWrapperClassName ? <span className={iconWrapperClassName}>{icon}</span> : icon}
      tooltip={t('copy')}
      tooltipPlacement="bottom"
      className={className}
      {...buttonProps}
      onClick={async () => {
        if (copied) {
          return
        }
        if (!(await copyText(text))) {
          showToast({ key: 'copyFailed' })
          return
        }
        setCopied(true)
        showToast({ key: 'copied' }, 1990)
        timerRef.current = setTimeout(() => setCopied(false), 1000)
      }}
    />
  )
}

/* ============================================================================
 * 功能区：消息渲染 / CopyButton 结束
 * ========================================================================== */
