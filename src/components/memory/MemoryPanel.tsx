import { useMemo, useState } from 'react'
import { getVisibleMessages } from '../../services/chat/branches.js'
import {
  activeMemoryCards,
  activeMemoryChars,
  collectVisibleMemories,
  selectMemoryCardsForInjection,
  type MemoryCard,
} from '../../services/chat/memory.js'
import {
  addManualMemory,
  clearMemories,
  deleteMemoryCard,
  saveConversationAsMemory,
  setMemoryEnabled,
  setMemoryPinned,
  updateMemoryText,
} from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { useSettings } from '../../services/settings.js'
import { closeMemoryPanel } from './memoryPanelState.js'
import styles from './MemoryPanel.module.css'

const PAGE_SIZE = 40

const formatTime = (value: number) => {
  const date = new Date(value)
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const sourceLabel = (card: MemoryCard) => {
  if (card.source === 'manual') {
    return '手动'
  }
  if (card.source === 'bulk') {
    return '整段'
  }
  return card.source === 'refine' ? '提炼' : '自动'
}

type Filter = 'all' | 'active' | 'manual' | 'archived'

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '生效中' },
  { key: 'manual', label: '手动' },
  { key: 'archived', label: '已归档' },
]

/** 长期记忆面板：统计、筛选、搜索、分页；卡片可改、可关、可删，也能手动补一条 */
export const MemoryPanel = ({ session }: { session: Session }) => {
  const memoryMode = useSettings((state) => state.memoryMode)
  const memoryLimit = useSettings((state) => state.memoryLimit)
  const memoryChars = useSettings((state) => state.memoryChars)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [shown, setShown] = useState(PAGE_SIZE)
  /** 编辑框按内容自动撑高：卡片正文越长，textarea 越高，避免文字被固定三行挡住 */
  const autoGrow = (el: HTMLTextAreaElement | null) => {
    if (!el) {
      return
    }
    el.style.height = 'auto'
    el.style.height = `${Math.min(300, Math.max(96, el.scrollHeight))}px`
  }

  const [confirming, setConfirming] = useState<
    | { kind: 'one'; messageId: string; cardId: string }
    | { kind: 'all' }
    | { kind: 'bulk'; count: number }
    | null
  >(null)
  const [editing, setEditing] = useState<{ messageId: string; cardId: string; text: string } | null>(
    null
  )
  const [bulkSelected, setBulkSelected] = useState(0)
  const [bulkStatus, setBulkStatus] = useState('')
  const messages = useMemo(() => getVisibleMessages(session), [session])
  const entries = useMemo(() => {
    const all = collectVisibleMemories(session, messages)
    return all.slice().sort((a, b) => b.card.createdAt - a.card.createdAt)
  }, [session, messages])
  const activeCount = useMemo(
    () => activeMemoryCards(session, messages).length,
    [session, messages]
  )
  const activeChars = useMemo(() => activeMemoryChars(session, messages), [session, messages])
  const autoCount = useMemo(
    () =>
      entries.filter(({ card }) => card.source !== 'manual' && !card.pinned && !card.superseded)
        .length,
    [entries]
  )
  const archivedCount = useMemo(
    () => entries.filter(({ card }) => card.superseded).length,
    [entries]
  )
  const manualCount = useMemo(
    () => entries.filter(({ card }) => card.source === 'manual').length,
    [entries]
  )
  const pinnedCount = useMemo(
    () => entries.filter(({ card }) => card.pinned && !card.superseded).length,
    [entries]
  )
  const lastQuestion = useMemo(() => {
    const lastUser = messages.filter((message) => message.role === 'user').at(-1)
    return lastUser?.content ?? ''
  }, [messages])
  const injection = useMemo(
    () => selectMemoryCardsForInjection(session, messages, memoryLimit, lastQuestion),
    [session, messages, memoryLimit, lastQuestion]
  )
  const injectionPreview = useMemo(() => {
    let chars = 0
    let count = 0
    for (const { card } of injection) {
      const size = `- ${card.text.replace(/\n/g, ' / ')}`.length + 1
      if (chars + size > memoryChars) {
        if (count === 0) {
          chars = memoryChars
          count = 1
        }
        break
      }
      chars += size
      count++
    }
    return { count, chars, total: injection.length }
  }, [injection, memoryChars])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter(({ card }) => {
      const byFilter =
        filter === 'all'
          ? true
          : filter === 'active'
            ? card.enabled && !card.superseded
            : filter === 'manual'
              ? card.source === 'manual'
              : Boolean(card.superseded)
      if (!byFilter) {
        return false
      }
      return needle ? card.text.toLowerCase().includes(needle) : true
    })
  }, [entries, filter, query])

  const countRatio = Math.min(1, autoCount / Math.max(1, memoryLimit))
  const charRatio = Math.min(1, activeChars / Math.max(1, memoryChars))
  const limitRatio = Math.max(countRatio, charRatio)

  const submit = () => {
    const text = draft.trim()
    if (!text) {
      return
    }
    addManualMemory(session.id, text)
    setDraft('')
  }

  const emptyForFilter =
    filter === 'archived'
      ? '尚无归档卡片'
      : filter === 'manual'
        ? '尚无手动卡片'
        : filter === 'active'
          ? '没有生效中的卡片'
          : '尚无记忆'

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="长期记忆">
      <section className={styles.card}>
        <header className={styles.head}>
          <div>
            <h2>长期记忆</h2>
            <p>
              {entries.length} 张卡片 · 生效 {activeCount} 张 · 手动 {manualCount} 张
              {pinnedCount > 0 ? ` · 置顶 ${pinnedCount} 张` : ''}
              {archivedCount > 0 ? ` · 归档 ${archivedCount} 张` : ''}
            </p>
          </div>
          <button className={styles.close} type="button" onClick={closeMemoryPanel}>
            关闭
          </button>
        </header>

        <div className={styles.usage} data-mode={memoryMode}>
          <div className={styles.usageTop}>
            <span className={styles.modePill} data-mode={memoryMode}>
              {memoryMode === 'off'
                ? '记忆已关闭'
                : memoryMode === 'refine'
                  ? '自动提炼'
                  : '整轮记录'}
            </span>
            <span className={styles.limitText}>
              自动/整段 {autoCount} / {memoryLimit}
            </span>
          </div>
          <div className={styles.injectLine}>
            {lastQuestion
              ? `这一轮会带上 ${injectionPreview.count} 张 · ${injectionPreview.chars} / ${memoryChars.toLocaleString('zh-CN')} 字`
              : '发一条消息后，这里会写清楚这轮带上了哪些'}
            {injectionPreview.total > injectionPreview.count
              ? `（对上 ${injectionPreview.total} 张，字数只够带前 ${injectionPreview.count} 张）`
              : ''}
          </div>
          <div className={styles.injectLine}>
            已存 {activeChars.toLocaleString('zh-CN')} / {memoryChars.toLocaleString('zh-CN')} 字
            {activeChars >= memoryChars ? ' · 已到上限，新卡会把最早的自动卡归档' : ''}
          </div>
          <div className={styles.meter} aria-hidden="true">
            <i style={{ width: `${Math.max(limitRatio * 100, autoCount > 0 ? 2 : 0)}%` }} />
          </div>
          <p>
            {memoryMode === 'off'
              ? '现在不带任何记忆，记下来的内容还在本机。到「设置 → 长期记忆」打开就能恢复。'
              : `超过 ${memoryLimit} 张或 ${memoryChars.toLocaleString('zh-CN')} 字以后，最早的自动卡片会归档：内容不删，这里照样能看，只是不再带进对话。`}
          </p>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.filters} role="tablist" aria-label="记忆筛选">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={filter === item.key}
                data-active={filter === item.key}
                onClick={() => {
                  setFilter(item.key)
                  setShown(PAGE_SIZE)
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <input
            className={styles.search}
            type="search"
            value={query}
            placeholder="搜卡片内容，如称呼、地点、约定"
            aria-label="搜索记忆"
            onChange={(event) => {
              setQuery(event.target.value)
              setShown(PAGE_SIZE)
            }}
          />
        </div>

        <div className={styles.list}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              <strong>{query.trim() ? '没有匹配的卡片' : emptyForFilter}</strong>
              <p>
                {query.trim()
                  ? '换个关键词，或切到「全部」再看。'
                  : filter === 'archived'
                    ? '归档来自提炼替换或超出卡片/字数上限的旧卡；文本还在，只是不再注入。调高上限只影响之后的卡片，已归档的旧卡不会自动恢复。'
                    : '开启自动记忆后，每完成一轮对话就会留一张；也可以在下面手写一条。'}
              </p>
            </div>
          ) : (
            <>
              {filtered.slice(0, shown).map(({ card, messageId }) => (
                <article
                  className={styles.item}
                  key={card.id}
                  data-off={!card.enabled ? 'true' : undefined}
                  data-archived={card.superseded ? 'true' : undefined}
                >
                  <div className={styles.itemHead}>
                    <span className={styles.tag} data-source={card.source}>
                      {sourceLabel(card)}
                      {card.pinned ? ' · 置顶' : ''}
                      {card.superseded ? ' · 已归档' : ''}
                    </span>
                    <span className={styles.time}>{formatTime(card.createdAt)}</span>
                    <button
                      className={styles.toggle}
                      type="button"
                      aria-pressed={card.enabled}
                      onClick={() => setMemoryEnabled(session.id, messageId, card.id, !card.enabled)}
                    >
                      {card.enabled ? '已启用' : '已关闭'}
                    </button>
                    <button
                      className={styles.toggle}
                      data-pinned={card.pinned ? 'true' : undefined}
                      type="button"
                      aria-pressed={Boolean(card.pinned)}
                      onClick={() =>
                        setMemoryPinned(session.id, messageId, card.id, !card.pinned)
                      }
                    >
                      {card.pinned ? '已置顶' : '置顶'}
                    </button>
                  </div>
                  {editing?.cardId === card.id ? (
                    <div className={styles.editBox}>
                      <textarea
                        ref={autoGrow}
                        value={editing.text}
                        rows={3}
                        onChange={(event) => {
                          autoGrow(event.currentTarget)
                          setEditing((current) =>
                            current ? { ...current, text: event.target.value } : current
                          )
                        }}
                      />
                      <div className={styles.editActions}>
                        <button type="button" onClick={() => setEditing(null)}>
                          取消
                        </button>
                        <button
                          className={styles.primary}
                          type="button"
                          onClick={() => {
                            updateMemoryText(session.id, messageId, card.id, editing.text)
                            setEditing(null)
                          }}
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className={styles.text}>{card.text}</p>
                  )}
                  <div className={styles.itemActions}>
                    <button
                      type="button"
                      onClick={() => setEditing({ messageId, cardId: card.id, text: card.text })}
                    >
                      编辑
                    </button>
                    <button
                      className={styles.danger}
                      type="button"
                      onClick={() => setConfirming({ kind: 'one', messageId, cardId: card.id })}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
              {filtered.length > shown ? (
                <button
                  className={styles.more}
                  type="button"
                  onClick={() => setShown((current) => current + PAGE_SIZE)}
                >
                  加载更多（还有 {filtered.length - shown} 张）
                </button>
              ) : null}
            </>
          )}
        </div>

        <footer className={styles.footer}>
          <div className={styles.bulkBar}>
            <div className={styles.bulkCopy}>
              <strong>整段保存</strong>
              <span>
                {bulkSelected > 0
                  ? `已全选 ${bulkSelected} 条消息，按轮存成完整记忆卡`
                  : `当前分支 ${messages.length} 条消息，可一键全选后保存`}
              </span>
            </div>
            <div className={styles.bulkActions}>
              {bulkSelected > 0 ? (
                <>
                  <button
                    className={styles.primary}
                    type="button"
                    onClick={() => setConfirming({ kind: 'bulk', count: bulkSelected })}
                  >
                    保存为记忆
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkSelected(0)
                      setBulkStatus('')
                    }}
                  >
                    取消全选
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={messages.length === 0}
                  onClick={() => {
                    setBulkSelected(messages.length)
                    setBulkStatus('')
                  }}
                >
                  全选本对话
                </button>
              )}
            </div>
          </div>
          {bulkStatus ? <p className={styles.bulkStatus}>{bulkStatus}</p> : null}
          <div className={styles.addBox}>
            <textarea
              value={draft}
              rows={2}
              maxLength={400}
              placeholder="手动记一条，例如：用户住在大方县，习惯晚上聊天。"
              onChange={(event) => setDraft(event.target.value)}
            />
            <button className={styles.primary} type="button" onClick={submit} disabled={!draft.trim()}>
              添加
            </button>
          </div>
          <div className={styles.footMeta}>
            <span>
              记忆总字数上限 {memoryChars.toLocaleString('zh-CN')} 字，超出自动归档，不删除
            </span>
            {entries.length > 0 ? (
              <button
                className={styles.danger}
                type="button"
                onClick={() => setConfirming({ kind: 'all' })}
              >
                清空本会话
              </button>
            ) : null}
          </div>
        </footer>
      </section>
      {confirming ? (
        <div className={styles.confirmBackdrop} role="dialog" aria-modal="true">
          <div className={styles.confirmCard}>
            <div className={styles.confirmTitle}>
              {confirming.kind === 'one'
                ? '删除这条记忆？'
                : confirming.kind === 'all'
                  ? '清空本会话记忆？'
                  : '将本对话保存为记忆？'}
            </div>
            <div className={styles.confirmText}>
              {confirming.kind === 'one'
                ? '删除后不会再进入下一轮上下文，也无法恢复。'
                : confirming.kind === 'all'
                  ? `共 ${entries.length} 条记忆，清空后不可恢复，也不会再进入下一轮上下文。`
                  : `已全选 ${confirming.count} 条消息。保存会按轮生成完整卡片；已有整段卡片的轮次跳过；超过卡片或字数上限的最早自动卡自动归档，内容不删除，也不会保存失败。`}
            </div>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirmCancel}
                onClick={() => setConfirming(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={
                  confirming.kind === 'bulk' ? styles.confirmPrimary : styles.confirmDanger
                }
                onClick={() => {
                  if (confirming.kind === 'one') {
                    deleteMemoryCard(session.id, confirming.messageId, confirming.cardId)
                    setConfirming(null)
                    return
                  }
                  if (confirming.kind === 'all') {
                    clearMemories(session.id)
                    setConfirming(null)
                    return
                  }
                  const result = saveConversationAsMemory(session.id)
                  setBulkSelected(0)
                  setBulkStatus(
                    result.created > 0
                      ? `已保存 ${result.created} 轮完整记忆${result.skipped > 0 ? `，跳过 ${result.skipped} 轮已有整段卡` : ''}；现在生效 ${result.active} 张 / ${result.chars.toLocaleString('zh-CN')} 字。`
                      : `没有新增卡片：${result.skipped} 轮已经有整段记忆，可在「全部」里查看。`
                  )
                  setConfirming(null)
                }}
              >
                {confirming.kind === 'one'
                  ? '删除'
                  : confirming.kind === 'all'
                    ? '清空'
                    : '保存'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
