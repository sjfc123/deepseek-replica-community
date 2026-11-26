/* ============================================================================
 * 功能区：视图与交互 / ReadAloudButton
 * 职责：ReadAloudButton 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：ReadAloudButton
 * 关联：依赖 app/android、components/base/IconButton、components/base/icons、components/base/toastState 等 7 个模块；
 *    被 components/messages/AssistantMessage 引用。
 * 导出：ReadAloudButton
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { android } from '../../app/android.js'
import { useTranslate } from '../../i18n/index.js'
import {
  describeReadAloudError,
  toggleReadAloud,
  useReadAloud,
} from '../../services/speech/readAloud.js'
import { IconPlayMediaOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { showToast } from '../base/toastState.js'
import { ReadingBars } from './ReadingBars.js'

/* ---- 01 实现：ReadAloudButton ---- */
/** 朗读按钮：未朗读时点击开始，加载中或朗读中点击停止；正文原样提交，由服务端过滤 markdown */
export const ReadAloudButton = ({
  messageId,
  text,
  className,
}: {
  messageId: string
  text: string
  className?: string
}) => {
  const t = useTranslate()
  const status = useReadAloud((state) => (state.messageId === messageId ? state.status : 'idle'))
  const label = status === 'idle' ? t('ttsPlay') : t('ttsStop')
  return (
    <IconButton
      icon={status === 'idle' ? <IconPlayMediaOutline16 /> : <ReadingBars mode={status} />}
      tooltip={label}
      tooltipPlacement="bottom"
      className={className}
      tabIndex={android ? -1 : undefined}
      onMouseDown={android ? (event) => event.preventDefault() : undefined}
      onClick={() =>
        toggleReadAloud(messageId, text, (error) => showToast(describeReadAloudError(error)))
      }
    />
  )
}

/* ============================================================================
 * 功能区：消息渲染 / ReadAloudButton 结束
 * ========================================================================== */
