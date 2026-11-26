/* ============================================================================
 * 功能区：视图与交互 / MessageAvatar
 * 职责：MessageAvatar 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：MessageAvatar
 * 关联：依赖 components/messages/MessageAvatar.module；
 *    被 components/messages/AssistantMessage、components/messages/UserMessage 引用。
 * 导出：MessageAvatar
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import styles from './MessageAvatar.module.css'

/* ---- 01 实现：MessageAvatar ---- */
/**
 * 消息身份行：角色头像靠左、用户头像靠右，配一个弱化的名字。
 * 没有图片时用名字首字生成占位，避免空圈。
 */
export const MessageAvatar = ({
  src,
  name,
  align,
}: {
  src: string | null
  name: string
  align: 'start' | 'end'
}) => {
  const initial = name.trim().slice(0, 1).toUpperCase()
  return (
    <div className={styles.row} data-align={align}>
      <span className={styles.avatar}>
        {src ? (
          <img src={src} alt="" decoding="async" />
        ) : (
          <span className={styles.initial} aria-hidden="true">
            {initial || 'A'}
          </span>
        )}
      </span>
      <span className={styles.name}>{name}</span>
    </div>
  )
}

/* ============================================================================
 * 功能区：消息渲染 / MessageAvatar 结束
 * ========================================================================== */
