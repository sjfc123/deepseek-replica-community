/* ============================================================================
 * 功能区：消息渲染 / MessageAvatar 开始
 * 职责：MessageAvatar 组件，负责该组件的渲染、状态与交互出口。
 * 导出：MessageAvatar。
 * ========================================================================== */

import styles from './MessageAvatar.module.css'

/**
 * 消息身份行：角色头像靠左、用户头像靠右，配一个弱化的名字。
 * 没有图片时用名字首字兜底，避免空圈。
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
