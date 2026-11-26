/* ============================================================================
 * 功能区：视图与交互 / MessageIllustration
 * 职责：MessageIllustration 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：MessageIllustration
 * 关联：依赖 components/messages/MessageIllustration.module、services/illustration/store；
 *    被 components/messages/AssistantMessage 引用。
 * 导出：MessageIllustration
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useState } from 'react'
import { useIllustration, removeIllustration } from '../../services/illustration/store.js'
import styles from './MessageIllustration.module.css'

/* ---- 01 实现：MessageIllustration ---- */
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

/* ============================================================================
 * 功能区：消息渲染 / MessageIllustration 结束
 * ========================================================================== */
