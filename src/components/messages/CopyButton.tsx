import { useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconCheckOutline16, IconCopyOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { showToast } from '../base/toastState.js'
import { copyText } from '../../utils/clipboard.js'

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
      icon={
        iconWrapperClassName ? <span className={iconWrapperClassName}>{icon}</span> : icon
      }
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
