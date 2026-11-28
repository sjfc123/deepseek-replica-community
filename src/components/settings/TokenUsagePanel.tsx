/* ============================================================================
 * 功能区：视图与交互 / TokenUsagePanel
 * 职责：按会话汇总输入/输出 token、缓存命中与请求体积；缓存未命中时说明前缀变化和重试边界。
 * 分区：01 类型、常量与模块依赖；02 类型、契约与依赖；03 类型、常量与模块依赖（2）；04 对外入口与收尾
 * 关联：依赖 components/settings/TokenUsagePanel.module、services/chat/cacheDiagnostics、services/chat/db、services/chat/types 等 6 个模块；
 *    被 components/settings/AndroidSettings 引用。
 * 导出：TokenUsagePanel
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSettings } from '../../services/settings.js'
import { loadSession, loadSessionSummaries } from '../../services/chat/db.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import type { AssistantMessage, SessionSummary } from '../../services/chat/types.js'
import { summarizeSessionUsage, type SessionUsageSummary } from '../../services/tokenUsage.js'
import {
  diagnosePromptCache,
  readPromptCacheSamples,
  type CacheDiagnosis,
} from '../../services/chat/cacheDiagnostics.js'
import styles from './TokenUsagePanel.module.css'

/* ---- 01 类型、常量与模块依赖 ---- */
/* ---- 02 类型、契约与依赖 ---- */
/* ---- 03 类型、常量与模块依赖（2） ---- */
type Props = {
  open: boolean
  onClose: () => void
}

const DAY_MS = 24 * 60 * 60 * 1000
const NEW_DAYS = 7
const SELECTABLE_DAYS = 30

const formatNumber = (value: number, locale: string) =>
  new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US').format(value)

const formatDate = (value: number, locale: string) =>
  new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))

/* ---- 04 对外入口与收尾 ---- */
/** 会话级 Token 统计：按接口返回的用量字段汇总当前可见分支 */
export const TokenUsagePanel = ({ open, onClose }: Props) => {
  const locale = useSettings((state) => state.locale)
  const zh = locale === 'zh-CN'
  const t = (chinese: string, english: string) => (zh ? chinese : english)

  const [summaries, setSummaries] = useState<SessionSummary[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SessionSummary | null>(null)
  const [report, setReport] = useState<SessionUsageSummary | null>(null)
  const [reportError, setReportError] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  /** 只在同会话连续低命中或前缀变化时出现；正常命中不渲染 */
  const [cacheIssue, setCacheIssue] = useState<CacheDiagnosis | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    setLoadingList(true)
    setListError('')
    setSelected(null)
    setReport(null)
    setReportError('')
    void loadSessionSummaries()
      .then((items) => {
        if (cancelled) {
          return
        }
        setSummaries([...items].sort((a, b) => b.updatedAt - a.updatedAt))
      })
      .catch(() => {
        if (!cancelled) {
          setListError(zh ? '读取会话列表失败，请返回后重试' : 'Failed to load sessions, try again')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingList(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, zh])

  const now = Date.now()
  const visibleSummaries = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) {
      return summaries
    }
    return summaries.filter(
      (item) =>
        item.title.toLowerCase().includes(keyword) ||
        formatDate(item.updatedAt, locale).includes(keyword)
    )
  }, [summaries, query, locale])

  const ageOf = (updatedAt: number) => {
    const days = Math.floor((now - updatedAt) / DAY_MS)
    if (days <= NEW_DAYS) {
      return { days, selectable: true, tag: t('新', 'New'), tone: 'new' }
    }
    if (days <= SELECTABLE_DAYS) {
      return { days, selectable: true, tag: t('较新', 'Recent'), tone: 'recent' }
    }
    return {
      days,
      selectable: false,
      tag: t('超过 30 天', 'Older than 30d'),
      tone: 'stale',
    }
  }

  const choose = async (summary: SessionSummary) => {
    const age = ageOf(summary.updatedAt)
    if (!age.selectable) {
      return
    }
    setSelected(summary)
    setReport(null)
    setReportError('')
    setCacheIssue(null)
    setReportBusy(true)
    try {
      const session = await loadSession(summary.id)
      if (!session) {
        setReportError(t('会话内容读取失败，可能已被删除或损坏', 'Session could not be read'))
        return
      }
      setReport(
        summarizeSessionUsage(
          getVisibleMessages(session).filter(
            (message): message is AssistantMessage => message.role === 'assistant'
          )
        )
      )
      setCacheIssue(diagnosePromptCache(readPromptCacheSamples(), summary.id))
    } catch {
      setReportError(t('统计失败，请稍后重试', 'Failed to calculate usage'))
    } finally {
      setReportBusy(false)
    }
  }

  if (!open) {
    return null
  }

  const totals = report?.totals
  const hitRate = totals && totals.input > 0 ? (totals.cacheRead / totals.input) * 100 : 0
  const cacheUnknown = Boolean(
    report && report.requests > 0 && report.totals.cacheFieldMissing >= report.requests
  )

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <button
        type="button"
        className={styles.backdrop}
        aria-label={t('关闭', 'Close')}
        onClick={onClose}
      />
      <section className={styles.sheet}>
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2>{t('Token 用量统计', 'Token usage')}</h2>
            <p>
              {t(
                '按接口返回的用量字段统计当前可见分支',
                'Usage figures are based on API-reported data for the visible branch'
              )}
            </p>
          </div>
          <button type="button" className={styles.close} onClick={onClose}>
            {t('关闭', 'Close')}
          </button>
        </header>

        {selected ? (
          <div className={styles.body}>
            <div className={styles.reportHead}>
              <button
                type="button"
                className={styles.back}
                onClick={() => {
                  setSelected(null)
                  setReport(null)
                  setReportError('')
                }}
              >
                {t('重新选择', 'Choose another')}
              </button>
              <span className={styles.reportTitle}>{selected.title}</span>
            </div>

            {reportBusy ? (
              <div className={styles.state}>{t('正在统计…', 'Calculating…')}</div>
            ) : reportError ? (
              <div className={styles.state}>{reportError}</div>
            ) : report && totals ? (
              <>
                <div className={styles.totalCard}>
                  <span className={styles.totalLabel}>
                    {t('该会话总消耗', 'Total tokens in this session')}
                  </span>
                  <strong className={styles.totalValue}>
                    {formatNumber(totals.total, locale)}
                  </strong>
                  <span className={styles.totalUnit}>tokens</span>
                </div>

                <div className={styles.grid}>
                  <div className={styles.cell}>
                    <span>{t('输入', 'Input')}</span>
                    <strong>{formatNumber(totals.input, locale)}</strong>
                  </div>
                  <div className={styles.cell}>
                    <span>{t('输出', 'Output')}</span>
                    <strong>{formatNumber(totals.output, locale)}</strong>
                  </div>
                  <div className={styles.cell}>
                    <span>{t('缓存命中', 'Cache hit')}</span>
                    <strong>{formatNumber(totals.cacheRead, locale)}</strong>
                  </div>
                  <div className={styles.cell}>
                    <span>{t('未命中', 'Cache miss')}</span>
                    <strong>{formatNumber(totals.cacheMiss, locale)}</strong>
                  </div>
                  <div className={styles.cell}>
                    <span>{t('写入缓存', 'Cache write')}</span>
                    <strong>{formatNumber(totals.cacheWrite, locale)}</strong>
                  </div>
                  <div className={styles.cell}>
                    <span>{t('请求次数', 'Requests')}</span>
                    <strong>{formatNumber(report.requests, locale)}</strong>
                  </div>
                </div>

                {report.requests === 0 ? (
                  <div className={styles.empty}>
                    {t(
                      '该会话未包含接口返回的 usage。发送一条新消息并收到回复后再统计。',
                      'No API usage in this session yet. Send a reply first.'
                    )}
                  </div>
                ) : (
                  <>
                    <div className={styles.meterRow}>
                      <span>{t('缓存命中率', 'Cache hit rate')}</span>
                      <strong>
                        {cacheUnknown ? t('字段缺失', 'Fields missing') : `${hitRate.toFixed(1)}%`}
                      </strong>
                    </div>
                    <div className={styles.meter}>
                      <span style={{ width: `${cacheUnknown ? 0 : Math.min(100, hitRate)}%` }} />
                    </div>
                    {cacheIssue ? (
                      <div
                        className={styles.cacheAlert}
                        data-level={cacheIssue.level}
                        role="alert"
                      >
                        <div className={styles.cacheAlertHead}>
                          <span>{t('缓存异常', 'Cache issue')}</span>
                          <strong>{cacheIssue.detail}</strong>
                        </div>
                        <div className={styles.cacheAlertLabel}>
                          {t('可能原因', 'Likely causes')}
                        </div>
                        <ul>
                          {cacheIssue.causes.map((cause) => (
                            <li key={cause}>{cause}</li>
                          ))}
                        </ul>
                        <div className={styles.cacheAlertLabel}>
                          {t('证据', 'Evidence')}
                        </div>
                        <p className={styles.cacheEvidence}>
                          {cacheIssue.evidence.join(' · ')}
                        </p>
                      </div>
                    ) : null}
                    <div className={styles.notes}>
                      {cacheUnknown ? (
                        <p>
                          {t(
                            '这组请求都没有返回缓存命中字段，命中率不可计算；这不等于真实 0 命中，也不代表系统提示词丢失。',
                            'None of these requests returned cache fields, so the hit rate cannot be calculated. This is not a real 0% hit and does not mean the system prompt was lost.'
                          )}
                        </p>
                      ) : null}
                      <p>
                        {t(
                          '输入总量 = 未命中 + 命中 + 写入缓存；总消耗 = 输入 + 输出。',
                          'Input = miss + hit + cache write; total = input + output.'
                        )}
                      </p>
                      <p>
                        {t(
                          `覆盖 ${report.replies} 条带用量的回复、${report.requests} 次接口请求；重新生成和分支都计入。`,
                          `${report.requests} requests across ${report.replies} replies; regenerations and branches are included.`
                        )}
                      </p>
                      <p>
                        {t(
                          '缓存命中与未命中由上游按完整请求前缀判断，偶尔首轮、网关抖动或缓存字段缺失都会显示未命中，不等于系统提示词丢失。若同一会话连续异常，可重新生成或重发同一句话一次，观察命中是否恢复。',
                          'Cache hits and misses are decided upstream from the full request prefix. A cold first turn, gateway jitter or missing cache fields can all show a miss; this does not mean the system prompt is lost. If it keeps happening in the same chat, regenerate or resend the same message once and see whether it recovers.'
                        )}
                      </p>
                      <p>
                        {t(
                          '缓存按完整请求前缀匹配。切换深度思考或智能搜索后，请求形态发生变化，首条回复通常需要重新建立缓存，随后同模式连续请求恢复命中。频繁切换会让每一轮都接近首轮，单条回复的未命中不代表回答质量下降。',
                          'Cache matching works on the full request prefix. Switching thinking or search changes the request shape, so the first reply usually rebuilds the cache and consecutive requests in the same mode recover hits. Frequent switching makes nearly every turn a cold turn; a single miss does not mean answer quality dropped.'
                        )}
                      </p>
                      {report.legacyReplies > 0 ? (
                        <p className={styles.legacy}>
                          {t(
                            `其中 ${report.legacyReplies} 条是旧回复，只能取最近一次 usage，可能少于实际多次请求的消耗。`,
                            `${report.legacyReplies} older replies only keep their latest usage and may undercount.`
                          )}
                        </p>
                      ) : null}
                      <p>
                        {t(
                          '不含上下文摘要、自动标题、场景更新等后台请求；这些不写入消息 usage。',
                          'Excludes background title, summary and scene requests.'
                        )}
                      </p>
                    </div>
                  </>
                )}
              </>
            ) : null}
          </div>
        ) : (
          <div className={styles.body}>
            <div className={styles.tip}>
              {t(
                '建议选择新会话或最近 7 天使用过的会话。超过 30 天的记录置灰：旧数据仅保留最后一次 usage，无法还原逐请求消耗，统计结果会偏低。',
                'Pick a new session or one used in the last 7 days. Older than 30 days is disabled: no per-request usage was recorded.'
              )}
            </div>

            <label className={styles.search}>
              <span>{t('搜索会话', 'Search sessions')}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('输入标题或日期', 'Title or date')}
              />
            </label>

            {loadingList ? (
              <div className={styles.state}>{t('正在读取会话…', 'Loading sessions…')}</div>
            ) : listError ? (
              <div className={styles.state}>{listError}</div>
            ) : visibleSummaries.length === 0 ? (
              <div className={styles.state}>{t('未找到匹配的会话', 'No matching sessions')}</div>
            ) : (
              <div className={styles.list}>
                {visibleSummaries.map((item) => {
                  const age = ageOf(item.updatedAt)
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={styles.item}
                      data-tone={age.tone}
                      disabled={!age.selectable}
                      onClick={() => void choose(item)}
                    >
                      <span className={styles.itemMain}>
                        <span className={styles.itemTitle}>{item.title}</span>
                        <span className={styles.itemMeta}>
                          {formatDate(item.updatedAt, locale)}
                          {age.days > 0
                            ? ` · ${t(`${age.days} 天未用`, `${age.days}d unused`)}`
                            : ` · ${t('今天', 'today')}`}
                        </span>
                      </span>
                      <span className={styles.badge} data-tone={age.tone}>
                        {age.tag}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>,
    document.body
  )
}

/* ============================================================================
 * 功能区：设置页 / TokenUsagePanel 结束
 * ========================================================================== */
