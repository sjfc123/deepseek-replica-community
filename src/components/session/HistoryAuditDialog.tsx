/* ============================================================================
 * 功能区：视图与交互 / HistoryAuditDialog · 历史结算面板
 * 职责：历史结算面板：展示上一段会话的消息规模、分词 Token、接口实际用量与最重消息。
 * 分区：01 类型、契约与依赖；02 实现：HistoryAuditDialog
 * 关联：依赖 components/session/HistoryAuditDialog、i18n、services/chat/historyAudit、services/chat/store；
 *    被 app/App 引用。
 * 导出：HistoryAuditDialog
 * 边界：只读 store 里的结算快照；不遍历消息、不写数据库。
 * ========================================================================== */

import './HistoryAuditDialog.css'
import { useTranslate } from '../../i18n/index.js'
import { dismissHistoryAudit, useChatStore } from '../../services/chat/store.js'
import { formatTokenCount } from '../../services/chat/tokenUsage.js'

/* ---- 01 类型、契约与依赖 ---- */
const percentOf = (value: number) => `${(Math.max(0, Math.min(1, value)) * 100).toFixed(0)}%`

/* ---- 02 实现：HistoryAuditDialog ---- */
export const HistoryAuditDialog = () => {
  const t = useTranslate()
  const audit = useChatStore((state) => state.historyAudit)
  if (!audit) {
    return null
  }
  const stats = audit.stats
  const progress = percentOf(audit.progress)
  return (
    <div
      className="history-audit-overlay"
      role="dialog"
      aria-modal="true"
      onClick={dismissHistoryAudit}
    >
      <section className="history-audit-card" onClick={(event) => event.stopPropagation()}>
        <header className="history-audit-head">
          <span className="history-audit-eyebrow">{t('historyAuditEyebrow')}</span>
          <h3>{audit.title || t('historyAuditUntitled')}</h3>
        </header>
        <div className="history-audit-body">
        {stats ? (
          <>
            <dl className="history-audit-grid">
              <div>
                <dt>{t('historyAuditMessages')}</dt>
                <dd>
                  {t('historyAuditMessageValue', {
                    messages: stats.messages,
                    turns: stats.turns,
                    stored: stats.storedMessages,
                  })}
                </dd>
              </div>
              <div>
                <dt>{t('historyAuditChars')}</dt>
                <dd>
                  {t('historyAuditCharValue', {
                    total: stats.totalChars,
                    assistant: stats.assistantChars,
                    thinking: stats.thinkingChars,
                  })}
                </dd>
              </div>
              <div>
                <dt>{t('historyAuditTokens')}</dt>
                <dd className="history-audit-strong">
                  {t('historyAuditTokenValue', {
                    total: formatTokenCount(stats.totalTokens),
                    user: formatTokenCount(stats.userTokens),
                    assistant: formatTokenCount(stats.assistantTokens),
                    thinking: formatTokenCount(stats.thinkingTokens),
                  })}
                </dd>
              </div>
              <div>
                <dt>{t('historyAuditUsage')}</dt>
                <dd>
                  {stats.usage.requests > 0
                    ? t('historyAuditUsageValue', {
                        requests: stats.usage.requests,
                        input: formatTokenCount(stats.usage.input),
                        output: formatTokenCount(stats.usage.output),
                        cache: formatTokenCount(stats.usage.cacheRead),
                      })
                    : t('historyAuditNoUsage')}
                </dd>
              </div>
              <div>
                <dt>{t('historyAuditShare')}</dt>
                <dd>{percentOf(stats.contextShare)}</dd>
              </div>
            </dl>
            {stats.heaviest.length > 0 ? (
              <div className="history-audit-heavy">
                <h4>{t('historyAuditHeaviest')}</h4>
                <ul>
                  {stats.heaviest.map((item) => (
                    <li key={`${item.index}-${item.role}`}>
                      <span className="history-audit-heavy-meta">
                        {t('historyAuditHeavyMeta', {
                          index: item.index + 1,
                          role:
                            item.role === 'user'
                              ? t('historyAuditRoleUser')
                              : t('historyAuditRoleAssistant'),
                          chars: item.chars,
                          tokens: formatTokenCount(item.tokens),
                        })}
                      </span>
                      <span className="history-audit-heavy-preview">{item.preview}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="history-audit-caliber">{t('historyAuditCaliber')}</p>
          </>
        ) : (
          <div className="history-audit-running">
            <span>{t('historyAuditRunning', { percent: progress })}</span>
            <div className="history-audit-bar">
              <i style={{ width: progress }} />
            </div>
          </div>
        )}
        </div>
        <button type="button" className="history-audit-close" onClick={dismissHistoryAudit}>
          {t('historyAuditClose')}
        </button>
      </section>
    </div>
  )
}

/* ============================================================================
 * 功能区：视图与交互 / HistoryAuditDialog 结束
 * ========================================================================== */
