import { useState } from 'react'
import { useIllustration, removeIllustration } from '../../services/illustration/store.js'
import styles from './MessageIllustration.module.css'

/** 消息下方的生成插画：点开大图，大图里可删除这张图 */
export const MessageIllustration = ({ messageId }: { messageId: string }) => {
  const url = useIllustration(messageId)
  const [open, setOpen] = useState(false)
  if (!url) {
    return null
  }
  return (
    <>
      <button
        type="button"
        className={styles.thumb}
        onClick={() => setOpen(true)}
        aria-label="查看生成的插画"
      >
        <img src={url} alt="剧情插画" loading="lazy" />
      </button>
      {open ? (
        <div className={styles.viewer} role="dialog" aria-label="剧情插画">
          <img src={url} alt="剧情插画" />
          <div className={styles.viewerBar}>
            <button
              type="button"
              onClick={() => {
                removeIllustration(messageId)
                setOpen(false)
              }}
            >
              删除
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              关闭
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
