/* ============================================================================
 * 功能区：视图与交互 / BalanceUsageAnchor
 * 职责：主页与对话页共用的余额 + 上下文用量悬浮胶囊；点击展开明细面板。
 * 分区：01 类型、契约与依赖；02 数据选择与槽位；03 胶囊与面板渲染
 * 关联：依赖 services/balanceStore、services/settings、services/chat/tokenUsage、
 *    services/api/balance；被 components/session/Welcome、SessionView 引用。
 * 导出：BalanceUsageAnchor
 * 边界：只消费 store 与设置；余额接口请求节奏、字段归一化由 services 承担。
 * ========================================================================== */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  setBalanceChipPos,
  useSettings,
  type BalanceChipPoint,
} from '../../services/settings.js'
import { useBalanceStore } from '../../services/balanceStore.js'
import { useChatStore } from '../../services/chat/store.js'
import { MAX_OUTPUT_TOKENS, resolveContextWindow } from '../../services/chat/context.js'
import { contextSnapshot, formatTokenCount, type ContextSnapshot } from '../../services/chat/tokenUsage.js'
import { getPeakHint } from '../../services/peak.js'
import {
  currencySymbol,
  formatBalanceAmount,
  type AccountBalance,
  type BalanceInfo,
} from '../../services/api/balance.js'
import type { Session } from '../../services/chat/types.js'
import styles from './BalanceUsage.module.css'

/* ---- 01 类型、契约与依赖 ---- */
type Props = {
  session: Session | null
  context: 'home' | 'chat'
  /** inline：排在欢迎页空闲时段卡片下方的文档流里；floating：对话页悬浮槽位 */
  layout?: 'inline' | 'floating'
}

type Slot = 'bottom' | 'aboveInput' | 'top'

const PRIMARY_CURRENCY = 'CNY'

const pickPrimary = (infos: BalanceInfo[]): BalanceInfo | null =>
  infos.find((info) => info.currency === PRIMARY_CURRENCY) ?? infos[0] ?? null

const lastRequestInput = (snapshot: ContextSnapshot): number => {
  const last = snapshot.last
  if (!last) {
    return snapshot.totals.input
  }
  return last.input_tokens + last.cache_read_input_tokens + last.cache_creation_input_tokens
}

/* ---- 02 数据选择与槽位 ---- */
export const BalanceUsageAnchor = ({ session, context, layout = 'floating' }: Props) => {
  const locale = useSettings((state) => state.locale)
  const zh = locale === 'zh-CN'
  const tr = (chinese: string, english: string) => (zh ? chinese : english)

  const enabled = useSettings((state) => state.balanceChipEnabled)
  const showUsage = useSettings((state) => state.balanceChipShowUsage)
  const position = useSettings((state) => state.balanceChipPosition)
  const chatConfig = useSettings((state) => state.chatConfig)
  const streaming = useChatStore((state) => state.streaming)

  const data = useBalanceStore((state) => state.data)
  const status = useBalanceStore((state) => state.status)
  const message = useBalanceStore((state) => state.message)
  const refresh = useBalanceStore((state) => state.refresh)

  const [panelOpen, setPanelOpen] = useState(false)
  const savedPos = useSettings((state) => state.balanceChipPos)
  const [placed, setPlaced] = useState<BalanceChipPoint | null>(savedPos)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef({
    timer: 0,
    active: false,
    moved: false,
    suppressClick: false,
    startX: 0,
    startY: 0,
  })

  // 设置页复位后，同步清掉本地拖拽落点
  useEffect(() => {
    setPlaced(savedPos)
  }, [savedPos])

  const snapshot = useMemo(() => (session ? contextSnapshot(session) : null), [session])
  const anyStreaming = Object.keys(streaming).length > 0

  // 进入页面、切换会话、流式结束后各补一次；TTL 内由 store 自己去重。
  useEffect(() => {
    refresh()
  }, [refresh, session?.id])

  useEffect(() => {
    if (!anyStreaming) {
      refresh()
    }
  }, [anyStreaming, refresh])

  if (!enabled) {
    return null
  }

  const slot: Slot =
    context === 'home'
      ? 'bottom'
      : position === 'bottom'
        ? 'aboveInput'
        : position

  const primary = data ? pickPrimary(data.infos) : null
  const usageTokens = snapshot ? lastRequestInput(snapshot) : 0
  const loading = status === 'loading'
  const unsupported = status === 'unsupported'
  const failed = status === 'error'

  const balanceLabel = primary
    ? `${currencySymbol(primary.currency)}${formatBalanceAmount(primary.total)}`
    : unsupported
      ? tr('余额不可用', 'Balance unavailable')
      : failed
        ? tr('余额读取失败', 'Balance load failed')
        : loading
          ? tr('读取中…', 'Loading…')
          : status === 'idle'
            ? tr('未配置 API Key', 'No API key')
            : tr('无余额数据', 'No balance')

  const inline = layout === 'inline'
  // 对话页行内形态：不悬浮、不带胶囊背景，与消息 / 输入文字同排版；点击仍展开明细。
  const flow = context === 'chat' && !inline
  const customEndpoint = Boolean(chatConfig.endpoint)
  const windowLimit = resolveContextWindow(customEndpoint)
  const maxOutputTokens = customEndpoint ? 0 : MAX_OUTPUT_TOKENS
  const peakHint = getPeakHint()
  const contextRatio = windowLimit > 0 ? Math.min(1, usageTokens / windowLimit) : 0
  const nearLimit = contextRatio >= 0.9
  const placedPoint = inline || flow ? null : placed

  const toPoint = (clientX: number, clientY: number): BalanceChipPoint => ({
    x: Math.min(96, Math.max(4, (clientX / window.innerWidth) * 100)),
    y: Math.min(96, Math.max(4, (clientY / window.innerHeight) * 100)),
  })

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (inline || flow) {
      return
    }
    const d = dragRef.current
    d.startX = event.clientX
    d.startY = event.clientY
    d.moved = false
    d.active = false
    d.suppressClick = false
    event.currentTarget.setPointerCapture(event.pointerId)
    window.clearTimeout(d.timer)
    // 长按进入拖拽；短按仍走点击展开明细
    d.timer = window.setTimeout(() => {
      d.active = true
      setDragging(true)
    }, 420)
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d.active) {
      if (Math.abs(event.clientX - d.startX) > 8 || Math.abs(event.clientY - d.startY) > 8) {
        window.clearTimeout(d.timer)
      }
      return
    }
    event.preventDefault()
    d.moved = true
    setPlaced(toPoint(event.clientX, event.clientY))
  }

  const endDrag = () => {
    const d = dragRef.current
    window.clearTimeout(d.timer)
    if (d.active && d.moved && placed) {
      setBalanceChipPos(placed)
      d.suppressClick = true
    }
    d.active = false
    setDragging(false)
  }

  const onChipClick = () => {
    if (dragRef.current.suppressClick) {
      dragRef.current.suppressClick = false
      return
    }
    refresh(true)
    setPanelOpen(true)
  }

  const contextSegment = showUsage ? (
    flow ? (
      <span className={styles.chipSegment}>
        <span className={styles.chipLabel}>{tr('上下文', 'Context')}</span>
        <span
          className={`${styles.chipValue}${nearLimit ? ` ${styles.warn}` : ''}`}
        >
          {snapshot
            ? `${formatTokenCount(usageTokens)} / ${formatTokenCount(windowLimit)}`
            : `— / ${formatTokenCount(windowLimit)}`}
        </span>
        <span className={`${styles.chipLabel}${nearLimit ? ` ${styles.warn}` : ''}`}>
          {snapshot ? `${Math.round(contextRatio * 100)}%` : ''}
        </span>
      </span>
    ) : (
      <span className={styles.chipSegment}>
        <span className={styles.chipLabel}>{tr('上下文', 'Context')}</span>
        <span className={styles.chipValue}>{formatTokenCount(usageTokens)}</span>
      </span>
    )
  ) : null

  const chip = (
    <button
      type="button"
      className={[
        styles.chip,
        flow ? styles.flowRow : '',
        inline ? styles.inlineChip : '',
        placedPoint ? styles.placed : '',
        dragging ? styles.dragging : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-slot={inline || flow ? undefined : slot}
      data-placed={placedPoint ? '' : undefined}
      style={
        placedPoint
          ? ({ '--chip-x': `${placedPoint.x}%`, '--chip-y': `${placedPoint.y}%` } as CSSProperties)
          : undefined
      }
      role="status"
      aria-label={tr('余额与上下文用量，点击查看明细', 'Balance and usage; tap for details')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={onChipClick}
    >
      <span className={styles.chipSegment}>
        <span className={styles.chipLabel}>{tr('余额', 'Balance')}</span>
        <span
          className={`${styles.chipValue}${failed || unsupported || !primary ? ` ${styles.muted}` : ''}`}
        >
          {balanceLabel}
        </span>
        <span className={styles.chipLabel}>{peakHint.peak ? tr('高峰', 'Peak') : tr('空闲', 'Off-peak')}</span>
      </span>
      {showUsage && contextSegment ? (
        <>
          <span className={styles.chipDivider} aria-hidden="true" />
          {contextSegment}
        </>
      ) : null}
    </button>
  )

  return (
    <>
      {inline ? <div className={styles.inlineSlot}>{chip}</div> : chip}

      {panelOpen
        ? createPortal(
            <BalanceUsagePanel
              data={data}
              status={status}
              message={message}
              snapshot={snapshot}
              windowLimit={windowLimit}
              contextUsed={usageTokens}
              contextRatio={contextRatio}
              nearLimit={nearLimit}
              maxOutputTokens={maxOutputTokens}
              peakPhase={peakHint.peak ? tr('高峰时段', 'Peak') : tr('空闲时段', 'Off-peak')}
              peakRange={peakHint.rangeLabel}
              loading={loading}
              onClose={() => setPanelOpen(false)}
              onRefresh={() => refresh(true)}
              tr={tr}
            />,
            document.body
          )
        : null}
    </>
  )
}

/* ---- 03 胶囊与面板渲染 ---- */
const BalanceUsagePanel = ({
  data,
  status,
  message,
  snapshot,
  windowLimit,
  contextUsed,
  contextRatio,
  nearLimit,
  maxOutputTokens,
  peakPhase,
  peakRange,
  loading,
  onClose,
  onRefresh,
  tr,
}: {
  data: AccountBalance | null
  status: 'idle' | 'loading' | 'ok' | 'error' | 'unsupported'
  message: string
  snapshot: ContextSnapshot | null
  windowLimit: number
  contextUsed: number
  contextRatio: number
  nearLimit: boolean
  maxOutputTokens: number
  peakPhase: string
  peakRange: string
  loading: boolean
  onClose: () => void
  onRefresh: () => void
  tr: (zh: string, en: string) => string
}) => {
  const infos = data?.infos ?? []
  const hitRate =
    snapshot && snapshot.totals.input > 0
      ? (snapshot.totals.cacheRead / snapshot.totals.input) * 100
      : null

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <button type="button" className={styles.backdrop} aria-label={tr('关闭', 'Close')} onClick={onClose} />
      <section className={styles.sheet}>
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2>{tr('余额与上下文用量', 'Balance & context usage')}</h2>
            <p>
              {data
                ? tr(
                    `更新于 ${new Date(data.updatedAt).toLocaleTimeString()}；数据由网关接口返回，可能存在延迟，未显示可点击刷新重试。`,
                    `Updated ${new Date(data.updatedAt).toLocaleTimeString()}; figures come from the gateway and may lag. Tap refresh to retry.`
                  )
                : tr(
                    '数据由网关接口返回，统计可能存在延迟；若未显示，可点击右上角刷新重试。',
                    'Figures come from the gateway and may lag. If nothing shows, tap refresh in the top right to retry.'
                  )}
            </p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.refreshButton} onClick={onRefresh} disabled={loading}>
              {loading ? tr('刷新中…', 'Refreshing…') : tr('刷新', 'Refresh')}
            </button>
            <button type="button" className={styles.closeButton} onClick={onClose}>
              {tr('关闭', 'Close')}
            </button>
          </div>
        </header>

        <div className={styles.sheetBody}>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{tr('账号余额', 'Account balance')}</h3>
          {status === 'loading' && !data ? (
            <div className={styles.state}>{tr('正在读取余额…', 'Loading balance…')}</div>
          ) : status === 'unsupported' ? (
            <div className={styles.state}>
              {tr('当前网关未提供余额接口，无法读取账号余额。', 'This gateway does not expose a balance endpoint.')}
            </div>
          ) : status === 'error' ? (
            <div className={styles.state}>
              {tr('余额读取失败', 'Balance load failed')}
              {message ? `：${message}` : ''}
            </div>
          ) : infos.length === 0 ? (
            <div className={styles.state}>{tr('暂无余额明细', 'No balance details yet')}</div>
          ) : (
            infos.map((info) => (
              <div className={styles.balanceCard} key={info.currency || 'default'}>
                <div className={styles.balanceRow}>
                  <span className={styles.chipLabel}>
                    {info.currency || tr('余额', 'Balance')}
                  </span>
                  <strong>
                    {currencySymbol(info.currency)}
                    {formatBalanceAmount(info.total)}
                  </strong>
                </div>
                <div className={styles.balanceMeta}>
                  <span>{tr('赠金', 'Granted')} {formatBalanceAmount(info.granted) || '—'}</span>
                  <span>{tr('充值', 'Topped up')} {formatBalanceAmount(info.toppedUp) || '—'}</span>
                  <span>{tr('当前计价', 'Billing phase')} {peakPhase}</span>
                  <span className={styles.availability} data-off={data?.available === false ? '' : undefined}>
                    {data?.available === false ? tr('余额不足', 'Insufficient') : tr('余额可用', 'Available')}
                  </span>
                </div>
              </div>
            ))
          )}
          <p className={styles.footnote} style={{ marginTop: 10 }}>
            {tr(
              '余额取自官方余额接口；高峰/空闲只标记当前计价时段，并不是两个独立余额池。',
              'Balance comes from the official balance endpoint. Peak/off-peak labels mark the current billing phase, not separate balance pools.'
            )}
          </p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{tr('上下文用量', 'Context usage')}</h3>
          {!snapshot || snapshot.requests === 0 ? (
            <div className={styles.state}>{tr('还没有接口用量，发送一条消息后显示。', 'No API usage yet. Send a message first.')}</div>
          ) : (
            <>
              <div className={styles.windowRow}>
                <div className={styles.windowHead}>
                  <span>{tr('上下文长度', 'Context length')}</span>
                  <strong className={nearLimit ? styles.warn : ''}>
                    {snapshot ? formatTokenCount(contextUsed) : '—'}
                    <span className={styles.windowLimit}> / {formatTokenCount(windowLimit)}</span>
                    <span className={styles.windowRatio}>{snapshot ? `${Math.round(contextRatio * 100)}%` : ''}</span>
                  </strong>
                </div>
                <div className={styles.windowBar} aria-hidden="true">
                  <span
                    className={nearLimit ? styles.warn : ''}
                    style={{ width: `${Math.round(contextRatio * 100)}%` }}
                  />
                </div>
                <div className={styles.balanceMeta}>
                  {maxOutputTokens > 0 ? (
                    <span>{tr('最大输出', 'Max output')} {formatTokenCount(maxOutputTokens)}</span>
                  ) : null}
                  <span>{peakRange}</span>
                </div>
              </div>
              <div className={styles.grid}>
                <div className={styles.cell}>
                  <span>{tr('本段累计输入', 'Session input')}</span>
                  <strong>{formatTokenCount(snapshot.totals.input)}</strong>
                </div>
                <div className={styles.cell}>
                  <span>{tr('本段累计输出', 'Session output')}</span>
                  <strong>{formatTokenCount(snapshot.totals.output)}</strong>
                </div>
                <div className={styles.cell}>
                  <span>{tr('总消耗', 'Total')}</span>
                  <strong>{formatTokenCount(snapshot.totals.total)}</strong>
                </div>
                <div className={styles.cell}>
                  <span>{tr('缓存命中', 'Cache hit')}</span>
                  <strong>{formatTokenCount(snapshot.totals.cacheRead)}</strong>
                </div>
                <div className={styles.cell}>
                  <span>{tr('缓存未命中', 'Cache miss')}</span>
                  <strong>{formatTokenCount(snapshot.totals.cacheMiss)}</strong>
                </div>
                <div className={styles.cell}>
                  <span>{tr('缓存写入', 'Cache write')}</span>
                  <strong>{formatTokenCount(snapshot.totals.cacheWrite)}</strong>
                </div>
                <div className={styles.cell}>
                  <span>{tr('思考 Token', 'Reasoning')}</span>
                  <strong>{formatTokenCount(snapshot.totals.reasoning)}</strong>
                </div>
                <div className={styles.cell}>
                  <span>{tr('安全 Token', 'Safety')}</span>
                  <strong>{formatTokenCount(snapshot.totals.safety)}</strong>
                </div>
              </div>
              <div className={styles.balanceMeta} style={{ marginTop: 10 }}>
                <span>{tr('请求次数', 'Requests')} {snapshot.requests}</span>
                <span>{tr('带用量回复', 'Replies')} {snapshot.replies}</span>
                {hitRate !== null ? <span>{tr('缓存命中率', 'Cache hit rate')} {hitRate.toFixed(1)}%</span> : null}
              </div>
            </>
          )}
        </section>

        <p className={styles.footnote}>
          {tr(
            'Token 数量按接口返回的用量字段统计；后台标题、摘要、场景更新等请求不计入本段对话。这里不按本地费率估算金额，实际扣费以官方账单为准。',
            'Token counts are based on API-reported usage; background title, summary and scene requests are excluded. No local fee estimate is shown; official billing remains authoritative.'
          )}
        </p>
        </div>
      </section>
    </div>
  )
}
