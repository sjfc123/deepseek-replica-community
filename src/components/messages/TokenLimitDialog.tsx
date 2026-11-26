/* ============================================================================
 * 功能区：视图与交互 / TokenLimitDialog
 * 职责：TokenLimitDialog 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：TokenLimitDialog
 * 关联：依赖 components/messages/TokenLimitDialog、services/chat/tokenUsage；
 *    被 components/messages/MessageList 引用。
 * 导出：TokenLimitDialog
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import './TokenLimitDialog.css'
import { formatTokenCount } from '../../services/chat/tokenUsage.js'

/* ---- 01 实现：TokenLimitDialog ---- */
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
