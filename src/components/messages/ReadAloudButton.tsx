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
