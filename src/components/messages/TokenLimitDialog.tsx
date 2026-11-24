/* ============================================================================
 * 功能区：消息渲染 / TokenLimitDialog 开始
 * 职责：TokenLimitDialog 组件，负责该组件的渲染、状态与交互出口。
 * 导出：TokenLimitDialog。
 * ========================================================================== */

import './TokenLimitDialog.css'
import { formatTokenCount } from '../../services/chat/tokenUsage.js'

/** 达到自定义 token 上限后的居中提醒：只提示一次，确认后照常聊天 */
export const TokenLimitDialog = ({
  open,
  used,
  limit,
  onClose,
}: {
  open: boolean
  used: number
  limit: number
  onClose: () => void
}) => {
  if (!open) {
    return null
  }
  return (
    <div className="token-limit-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <section className="token-limit-card" onClick={(event) => event.stopPropagation()}>
        <h3>Token 用量已达上限</h3>
        <p className="token-limit-usage">
          本段对话约 {formatTokenCount(used)} tokens，上限 {formatTokenCount(limit)}。
        </p>
        <p className="token-limit-note">请注意劳逸结合、合理分配。点击确认可继续聊，不影响使用。</p>
        <button type="button" onClick={onClose}>
          确认
        </button>
      </section>
    </div>
  )
}

/* ============================================================================
 * 功能区：消息渲染 / TokenLimitDialog 结束
 * ========================================================================== */
