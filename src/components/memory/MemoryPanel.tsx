/* ============================================================================
 * 功能区：长期记忆界面 / MemoryPanel 开始
 * 职责：长期记忆面板：双分类、筛选、编辑、补卡、配额与注入预览。
 * ========================================================================== */

import { useMemo, useState } from 'react'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { findActiveCharacterCard, findSessionCharacterCard } from '../../services/chat/roleplay.js'
import {
  activeMemoryCards,
  activeMemoryChars,
  collectVisibleMemories,
  detectCodeBlock,
  detectNormalMemoryKind,
  filterCharacterMemoryForInjection,
  getMemoryPool,
  getNormalMemoryKind,
  NORMAL_MEMORY_KINDS,
  normalMemoryLabel,
  selectMemoryCardsForInjection,
  selectNormalMemoryCardsForInjection,
  type MemoryCard,
  type MemoryPool,
  type NormalMemoryKind,
} from '../../services/chat/memory.js'
import {
  addManualMemory,
  clearMemoryCards,
  deleteMemoryCard,
  selectSessionMessage,
  setMemoryEnabled,
  setMemoryPinned,
  updateMemoryText,
} from '../../services/chat/store.js'
import {
  filterMemoryEntries,
  getMemorySpeech,
  memoryTextForView,
  sortMemoryEntries,
  type MemorySpeechFilter,
  type MemoryStatusFilter,
  type MemoryTimeFilter,
} from '../../services/chat/memoryView.js'
import type { Session } from '../../services/chat/types.js'
import { useSettings } from '../../services/settings.js'
import { closeMemoryPanel } from './memoryPanelState.js'
import styles from './MemoryPanel.module.css'

const PAGE_SIZE = 40

/* -------------------- 功能区：展示辅助与分类映射 开始 -------------------- */
const formatTime = (value: number) => {
  const date = new Date(value)
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const memoryPoolLabel = (pool: MemoryPool) => (pool === 'normal' ? '普通记忆' : '角色记忆')

const memoryExcerpt = (text: string) => {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 24 ? `${compact.slice(0, 24)}…` : compact
}

const sourceLabel = (card: MemoryCard) => {
  if (card.source === 'manual') {
    return '手动'
  }
  if (card.source === 'bulk') {
    return getMemoryPool(card) === 'normal' ? '收录' : '整段'
  }
  return card.source === 'refine' ? '提炼' : '自动'
}

const cardPoolLabel = (card: MemoryCard) => {
  if (getMemoryPool(card) === 'character') {
    return '角色'
  }
  return `普通 · ${normalMemoryLabel(getNormalMemoryKind(card))}`
}

const STATUS_FILTERS: Array<{ key: MemoryStatusFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pinned', label: '置顶' },
  { key: 'active', label: '生效中' },
  { key: 'auto', label: '自动' },
  { key: 'refine', label: '提炼' },
  { key: 'manual', label: '手动' },
  { key: 'bulk', label: '整段' },
  { key: 'archived', label: '已归档' },
]

const TIME_FILTERS: Array<{ key: MemoryTimeFilter; label: string }> = [
  { key: 'all', label: '全部时间' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '最近 7 天' },
  { key: 'older', label: '更早' },
]

const SPEECH_FILTERS: Record<MemoryPool, Array<{ key: MemorySpeechFilter; label: string }>> = {
  character: [
    { key: 'all', label: '全部内容' },
    { key: 'user', label: '用户的话' },
    { key: 'character', label: '角色的话' },
    { key: 'scene', label: '剧情摘要' },
  ],
  normal: [
    { key: 'all', label: '全部内容' },
    { key: 'user', label: '用户原话' },
    { key: 'character', label: 'AI 原话' },
  ],
}

/** 长期记忆面板：普通/角色双分类，普通记忆再分对话、代码、用户、AI */
/* -------------------- 功能区：展示辅助与分类映射 结束 -------------------- */

/* -------------------- 功能区：记忆面板数据与渲染 开始 -------------------- */
export const MemoryPanel = ({ session }: { session: Session }) => {
  const memoryMode = useSettings((state) => state.memoryMode)
  const memoryLimit = useSettings((state) => state.memoryLimit)
  const memoryChars = useSettings((state) => state.memoryChars)
  const normalMemoryEnabled = useSettings((state) => state.normalMemoryEnabled)
  const normalMemoryLimit = useSettings((state) => state.normalMemoryLimit)
  const normalMemoryChars = useSettings((state) => state.normalMemoryChars)
  const roleplayEnabled = useSettings((state) => state.roleplayEnabled)
  const activeCharacterId = useSettings((state) => state.activeCharacterId)
  const characterCards = useSettings((state) => state.characterCards)
  const roleplayActive =
    Boolean(findSessionCharacterCard(characterCards, session)) ||
    (roleplayEnabled && Boolean(findActiveCharacterCard(characterCards, activeCharacterId)))
  const [draft, setDraft] = useState('')
  const [draftKind, setDraftKind] = useState<NormalMemoryKind | 'auto'>('auto')
  const [query, setQuery] = useState('')
  const [pool, setPool] = useState<MemoryPool>('character')
  const normalDraftLocked = roleplayActive && pool === 'normal'
  const [filter, setFilter] = useState<MemoryStatusFilter>('all')
  const [speech, setSpeech] = useState<MemorySpeechFilter>('all')
  const [time, setTime] = useState<MemoryTimeFilter>('all')
  const [shown, setShown] = useState(PAGE_SIZE)
  /** 顶部 Tab 就是手动补卡的写入目标；切换分类时清掉未提交草稿，避免写到另一分类 */
  const switchPool = (next: MemoryPool) => {
    setPool(next)
    setFilter('all')
    setSpeech('all')
    setTime('all')
    setShown(PAGE_SIZE)
    setDraft('')
    setDraftKind('auto')
  }

  /** 编辑框按内容自动撑高：卡片正文越长，textarea 越高，避免文字被固定三行挡住 */
  const autoGrow = (el: HTMLTextAreaElement | null) => {
    if (!el) {
      return
    }
    el.style.height = 'auto'
    el.style.height = `${Math.min(300, Math.max(96, el.scrollHeight))}px`
  }

  const [confirming, setConfirming] = useState<
    | { kind: 'one'; messageId: string; cardId: string; text: string; pool: MemoryPool }
    | {
        kind: 'filter'
        label: string
        count: number
        pool: MemoryPool
        targets: Array<{ messageId: string; cardId: string }>
      }
    | null
  >(null)
  const [editing, setEditing] = useState<{
    messageId: string
    cardId: string
    text: string
  } | null>(null)
  const [jumpTarget, setJumpTarget] = useState<{
    messageId: string
    text: string
    createdAt: number
  } | null>(null)
  /** 底部补卡区默认收起，把高度留给卡片列表；需要写入时展开 */
  const [adding, setAdding] = useState(false)
  const messages = useMemo(() => getVisibleMessages(session), [session])
  const entries = useMemo(
    () => sortMemoryEntries(collectVisibleMemories(session, messages)),
    [session, messages]
  )

  const poolEntries = useMemo(
    () => entries.filter(({ card }) => getMemoryPool(card) === pool),
    [entries, pool]
  )
  const characterCount = useMemo(
    () => entries.filter(({ card }) => getMemoryPool(card) === 'character').length,
    [entries]
  )
  const normalCount = useMemo(
    () => entries.filter(({ card }) => getMemoryPool(card) === 'normal').length,
    [entries]
  )
  const activeCount = useMemo(
    () => activeMemoryCards(session, messages, undefined, pool).length,
    [session, messages, pool]
  )
  const activeChars = useMemo(
    () => activeMemoryChars(session, messages, pool),
    [session, messages, pool]
  )
  const autoCount = useMemo(
    () =>
      poolEntries.filter(({ card }) => card.source !== 'manual' && !card.pinned && !card.superseded)
        .length,
    [poolEntries]
  )
  const archivedCount = useMemo(
    () => poolEntries.filter(({ card }) => card.superseded).length,
    [poolEntries]
  )
  const manualCount = useMemo(
    () => poolEntries.filter(({ card }) => card.source === 'manual').length,
    [poolEntries]
  )
  const pinnedCount = useMemo(
    () => poolEntries.filter(({ card }) => card.pinned && !card.superseded).length,
    [poolEntries]
  )
  const hasRoleplayCodeCard = useMemo(
    () =>
      entries.some(
        ({ card }) =>
          getMemoryPool(card) === 'character' &&
          card.enabled &&
          !card.superseded &&
          detectCodeBlock(card.text)
      ),
    [entries]
  )
  const lastQuestion = useMemo(() => {
    const lastUser = messages.filter((message) => message.role === 'user').at(-1)
    return lastUser?.content ?? ''
  }, [messages])
  const normalInjectionAllowed = normalMemoryEnabled && !roleplayActive
  const injection = useMemo(
    () =>
      pool === 'character'
        ? filterCharacterMemoryForInjection(
            selectMemoryCardsForInjection(session, messages, memoryLimit, lastQuestion),
            roleplayActive
          )
        : normalInjectionAllowed
          ? selectNormalMemoryCardsForInjection(session, messages, normalMemoryLimit, lastQuestion)
          : [],
    [
      pool,
      session,
      messages,
      memoryLimit,
      normalMemoryLimit,
      lastQuestion,
      normalInjectionAllowed,
      roleplayActive,
    ]
  )
  const budget = pool === 'normal' ? normalMemoryChars : memoryChars
  const cardLimit = pool === 'normal' ? normalMemoryLimit : memoryLimit
  const injectionPreview = useMemo(() => {
    let chars = 0
    let count = 0
    for (const { card } of injection) {
      const size = `- ${card.text.replace(/\n/g, ' / ')}`.length + 1
      if (chars + size > budget) {
        if (count === 0) {
          chars = budget
          count = 1
        }
        break
      }
      chars += size
      count++
    }
    return { count, chars, total: injection.length }
  }, [injection, budget])

  const filtered = useMemo(
    () =>
      filterMemoryEntries(entries, {
        pool,
        status: filter,
        speech,
        time,
        query,
        now: Date.now(),
      }),
    [entries, filter, query, pool, speech, time]
  )

  const narrowed = filter !== 'all' || speech !== 'all' || time !== 'all'
  const clearActionLabel = narrowed ? '清空当前筛选' : `清空${memoryPoolLabel(pool)}`
  const clearTargets = filtered.map(({ card, messageId }) => ({ messageId, cardId: card.id }))
  const countRatio = Math.min(1, autoCount / Math.max(1, cardLimit))
  const charRatio = Math.min(1, activeChars / Math.max(1, budget))
  const limitRatio = Math.max(countRatio, charRatio)

  const submit = () => {
    const text = draft.trim()
    if (!text || (roleplayActive && pool === 'normal')) {
      return
    }
    const category =
      pool === 'normal'
        ? draftKind === 'auto'
          ? detectNormalMemoryKind(text)
          : draftKind
        : undefined
    addManualMemory(session.id, text, {
      pool,
      category,
    })
    setDraft('')
  }

  const emptyForFilter =
    filter === 'archived'
      ? '尚无归档卡片'
      : filter === 'manual'
        ? '尚无手动卡片'
        : filter === 'active'
          ? '没有生效中的卡片'
          : filter === 'pinned'
            ? '没有置顶卡片'
            : filter === 'auto'
              ? '没有自动记录卡片'
              : filter === 'refine'
                ? '没有提炼卡片'
                : filter === 'bulk'
                  ? '没有整段保存的卡片'
                  : narrowed
                    ? '当前筛选没有卡片'
                    : pool === 'normal'
                      ? '普通记忆还没有卡片'
                      : '角色记忆还没有卡片'

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="长期记忆">
      <section className={styles.card}>
        <header className={styles.head}>
          <div>
            <span className={styles.eyebrow}>MEMORY</span>
            <h2>长期记忆</h2>
            <p>
              角色 {characterCount} 张 · 普通 {normalCount} 张
              {manualCount > 0 ? ` · 当前手动 ${manualCount}` : ''}
              {pinnedCount > 0 ? ` · 当前置顶 ${pinnedCount}` : ''}
              {archivedCount > 0 ? ` · 当前归档 ${archivedCount}` : ''}
            </p>
          </div>
          <button className={styles.close} type="button" onClick={closeMemoryPanel}>
            关闭
          </button>
        </header>

        <div className={styles.poolTabs} role="tablist" aria-label="记忆分类">
          <button
            type="button"
            role="tab"
            aria-selected={pool === 'character'}
            data-active={pool === 'character'}
            onClick={() => switchPool('character')}
          >
            <span className={styles.poolIcon}>✦</span>
            <span>
              <strong>角色记忆</strong>
              <small>剧情 · 时间线 · 好感</small>
            </span>
            <em>{characterCount}</em>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pool === 'normal'}
            data-active={pool === 'normal'}
            onClick={() => switchPool('normal')}
          >
            <span className={styles.poolIcon}>⌘</span>
            <span>
              <strong>普通记忆</strong>
              <small>{roleplayActive ? '角色扮演中暂停写入' : '开发 · 问答 · 代码'}</small>
            </span>
            <em>{normalCount}</em>
          </button>
        </div>

        <div className={styles.usage} data-mode={memoryMode} data-pool={pool}>
          <div className={styles.usageTop}>
            <span className={styles.modePill} data-mode={memoryMode}>
              {pool === 'normal'
                ? normalMemoryEnabled
                  ? '普通记忆已开启'
                  : '普通记忆已关闭'
                : memoryMode === 'off'
                  ? '角色记忆已关闭'
                  : memoryMode === 'refine'
                    ? '自动提炼'
                    : '整轮记录'}
            </span>
            <span className={styles.limitText}>
              生效 {activeCount} · 配额 {autoCount} / {cardLimit}
            </span>
          </div>
          <div className={styles.injectLine}>
            {pool === 'normal' && !normalInjectionAllowed
              ? '角色扮演开启时普通记忆不会注入，避免代码与开发日志污染人设。'
              : lastQuestion
                ? `这一轮会带上 ${injectionPreview.count} 张 · ${injectionPreview.chars.toLocaleString('zh-CN')} / ${budget.toLocaleString('zh-CN')} 字${
                    pool === 'character' && !roleplayActive && hasRoleplayCodeCard
                      ? '；已排除带代码块的角色卡'
                      : ''
                  }`
                : '发一条消息后，这里会写清楚这轮带上了哪些'}
            {injectionPreview.total > injectionPreview.count
              ? `（对上 ${injectionPreview.total} 张，字数只够带前 ${injectionPreview.count} 张）`
              : ''}
          </div>
          <div className={styles.injectLine}>
            已存 {activeChars.toLocaleString('zh-CN')} / {budget.toLocaleString('zh-CN')} 字
            {activeChars >= budget ? ' · 已到上限，新卡会把最早的自动卡归档' : ''}
          </div>
          <div className={styles.meter} aria-hidden="true">
            <i style={{ width: `${Math.max(limitRatio * 100, autoCount > 0 ? 2 : 0)}%` }} />
          </div>
          <p>
            {pool === 'normal'
              ? `普通记忆只做关键词检索与开发问答，不参与角色时间线；超过 ${cardLimit} 张或 ${budget.toLocaleString('zh-CN')} 字后，最早的自动卡会归档，文本保留。`
              : memoryMode === 'off'
                ? '现在不带角色记忆，记下来的内容还在本机。到「设置 → 长期记忆」打开就能恢复。'
                : `超过 ${cardLimit} 张或 ${budget.toLocaleString('zh-CN')} 字以后，最早的自动卡片会归档：内容不删，这里照样能看，只是不再带进对话。`}
          </p>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>状态</span>
            <div className={styles.filters} role="tablist" aria-label="记忆状态筛选">
              {STATUS_FILTERS.map((item) => (
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
          </div>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>发言</span>
            <div className={styles.filters} role="tablist" aria-label="发言类型筛选">
              {SPEECH_FILTERS[pool].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={speech === item.key}
                  data-active={speech === item.key}
                  onClick={() => {
                    setSpeech(item.key)
                    setShown(PAGE_SIZE)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>时间</span>
            <div className={styles.filters} role="tablist" aria-label="记忆时间筛选">
              {TIME_FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={time === item.key}
                  data-active={time === item.key}
                  onClick={() => {
                    setTime(item.key)
                    setShown(PAGE_SIZE)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <input
            className={styles.search}
            type="search"
            value={query}
            placeholder={
              speech === 'all'
                ? '搜索记忆：称呼、地点、代码、报错关键词'
                : `只搜${SPEECH_FILTERS[pool].find((item) => item.key === speech)?.label ?? '当前发言'}`
            }
            aria-label="搜索记忆"
            onChange={(event) => {
              setQuery(event.target.value)
              setShown(PAGE_SIZE)
            }}
          />
          <div className={styles.panelHint}>置顶卡片排在最前 · 双击卡片可跳回原对话</div>
        </div>
        {query.trim() ? (
          <div className={styles.searchHint}>
            正在跨角色与普通记忆搜索，共 {filtered.length} 张匹配；清空搜索框恢复分类浏览。
          </div>
        ) : null}

        <div className={styles.list}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              <strong>{query.trim() ? '没有匹配的卡片' : emptyForFilter}</strong>
              <p>
                {query.trim()
                  ? '换个关键词，或清空搜索框再看。'
                  : filter === 'archived'
                    ? '归档来自提炼替换或超出卡片/字数上限的旧卡；文本还在，只是不再注入。调高上限只影响之后的卡片，已归档的旧卡不会自动恢复。'
                    : pool === 'normal'
                      ? '长按消息保存时选「普通记忆」，代码块会自动预选代码分类；也可以直接在下面手写一条。'
                      : '开启自动记忆后，每完成一轮对话就会留一张；也可以在下面手写一条。'}
              </p>
            </div>
          ) : (
            <>
              {filtered.slice(0, shown).map(({ card, messageId }) => {
                const visibleText = memoryTextForView(card, speech)
                const speechParts = getMemorySpeech(card)
                const hasBothSpeeches =
                  speechParts.user.length > 0 && speechParts.character.length > 0
                const speechLabel =
                  SPEECH_FILTERS[pool].find((item) => item.key === speech)?.label ?? ''
                return (
                  <article
                    className={styles.item}
                    key={card.id}
                    data-off={!card.enabled ? 'true' : undefined}
                    data-archived={card.superseded ? 'true' : undefined}
                    data-pool={getMemoryPool(card)}
                    data-pinned={card.pinned ? 'true' : undefined}
                    title="双击跳到原对话"
                    onDoubleClick={(event) => {
                      const target = event.target as HTMLElement
                      if (
                        editing ||
                        target.closest('button, textarea, input, select, a')
                      ) {
                        return
                      }
                      setJumpTarget({
                        messageId,
                        text: card.text,
                        createdAt: card.createdAt,
                      })
                    }}
                  >
                    <div className={styles.itemHead}>
                      <div className={styles.tagRow}>
                        <span className={styles.poolTag} data-pool={getMemoryPool(card)}>
                          {cardPoolLabel(card)}
                          {card.language ? ` · ${card.language}` : ''}
                        </span>
                        <span className={styles.tag} data-source={card.source}>
                          {sourceLabel(card)}
                          {card.superseded ? ' · 已归档' : ''}
                        </span>
                        {card.pinned ? <span className={styles.pinTag}>置顶</span> : null}
                      </div>
                      <span className={styles.time}>{formatTime(card.createdAt)}</span>
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
                    ) : getMemoryPool(card) === 'normal' &&
                      getNormalMemoryKind(card) === 'code' &&
                      speech === 'all' ? (
                      <pre className={styles.codeText}>{visibleText}</pre>
                    ) : (
                      <p className={styles.text}>{visibleText}</p>
                    )}
                    {speech !== 'all' && hasBothSpeeches ? (
                      <div className={styles.speechHint}>
                        只显示{speechLabel}；下面的操作仍作用于整张卡片。
                      </div>
                    ) : null}
                    <div className={styles.itemActions}>
                      <button
                        className={styles.toggle}
                        type="button"
                        aria-pressed={card.enabled}
                        onClick={() =>
                          setMemoryEnabled(session.id, messageId, card.id, !card.enabled)
                        }
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
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({ messageId, cardId: card.id, text: card.text })
                        }
                      >
                        编辑
                      </button>
                      <button
                        className={styles.danger}
                        type="button"
                        onClick={() =>
                          setConfirming({
                            kind: 'one',
                            messageId,
                            cardId: card.id,
                            text: card.text,
                            pool: getMemoryPool(card),
                          })
                        }
                      >
                        删除
                      </button>
                    </div>
                  </article>
                )
              })}
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
          <button
            className={styles.addToggle}
            type="button"
            aria-expanded={adding}
            onClick={() => setAdding((current) => !current)}
          >
            <span>手动记一条</span>
            <small>写入{pool === 'normal' ? '普通记忆' : '角色记忆'}</small>
            <em>{adding ? '收起' : '展开'}</em>
          </button>
          {adding ? (
            <div className={styles.addBox}>
              {pool === 'normal' ? (
                <div className={styles.addKindRow}>
                  <button
                    type="button"
                    data-active={draftKind === 'auto'}
                    onClick={() => setDraftKind('auto')}
                  >
                    自动识别
                  </button>
                  {NORMAL_MEMORY_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      data-active={draftKind === kind}
                      onClick={() => setDraftKind(kind)}
                    >
                      {normalMemoryLabel(kind)}
                    </button>
                  ))}
                </div>
              ) : null}
              <textarea
                value={draft}
                rows={2}
                maxLength={4000}
                disabled={normalDraftLocked}
                placeholder={
                  normalDraftLocked
                    ? '角色扮演开启中，普通记忆暂停写入；先关闭角色扮演再补开发代码。'
                    : pool === 'normal'
                      ? '记一条开发/问答参考，例如：报错原因、命令、接口字段；代码块会自动归入代码。'
                      : '手动记一条，例如：用户/韩寒最喜欢吃烧烤，角色/她习惯晚上聊天。'
                }
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className={styles.addActions}>
                <button
                  className={styles.primary}
                  type="button"
                  disabled={normalDraftLocked}
                  onClick={submit}
                >
                  添加
                </button>
              </div>
            </div>
          ) : null}
          <p className={styles.footerHint}>
            {roleplayActive
              ? '角色扮演开启时，长按保存的代码与整轮内容只进角色记忆；普通记忆暂停手动补卡，关闭角色扮演后恢复。'
              : '保存历史对话请长按消息 → 选择这条对话 / 全选本对话 → 保存为记忆，并在确认弹窗里选分类。'}
          </p>
          {filtered.length > 0 && !query.trim() ? (
            <button
              className={styles.clearAll}
              type="button"
              onClick={() =>
                setConfirming({
                  kind: 'filter',
                  label: clearActionLabel,
                  count: filtered.length,
                  pool,
                  targets: clearTargets,
                })
              }
            >
              {clearActionLabel}（{filtered.length} 张）
            </button>
          ) : null}
        </footer>
      </section>

      {confirming ? (
        <div className={styles.confirm} role="dialog" aria-modal="true">
          <section>
            <strong>{confirming.kind === 'filter' ? `${confirming.label}？` : '删除这张卡片？'}</strong>
            <p>
              {confirming.kind === 'filter'
                ? `只会删除当前列表里的 ${confirming.count} 张${memoryPoolLabel(confirming.pool)}卡片；另一分类和没有出现在列表里的卡片都不会动。文本从本机删除，无法恢复。`
                : `只删除这一张「${memoryExcerpt(confirming.text)}」；${memoryPoolLabel(confirming.pool)}里的其他卡片不动。文本从本机删除，无法恢复。`}
            </p>
            <div>
              <button type="button" onClick={() => setConfirming(null)}>
                取消
              </button>
              <button
                className={styles.danger}
                type="button"
                onClick={() => {
                  if (confirming.kind === 'filter') {
                    clearMemoryCards(session.id, confirming.targets)
                  } else {
                    deleteMemoryCard(session.id, confirming.messageId, confirming.cardId)
                  }
                  setConfirming(null)
                }}
              >
                {confirming.kind === 'filter' ? '清空' : '删除'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {jumpTarget ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          onClick={() => setJumpTarget(null)}
        >
          <section onClick={(event) => event.stopPropagation()}>
            <strong>跳到这段对话？</strong>
            <p>
              {memoryExcerpt(jumpTarget.text)}
              <br />
              将关闭记忆面板，定位到 {formatTime(jumpTarget.createdAt)} 的那条消息；记忆内容不会改变。
            </p>
            <div>
              <button type="button" onClick={() => setJumpTarget(null)}>
                取消
              </button>
              <button
                className={styles.jumpConfirm}
                type="button"
                onClick={() => {
                  const targetId = jumpTarget.messageId
                  setJumpTarget(null)
                  closeMemoryPanel()
                  selectSessionMessage(session.id, targetId)
                }}
              >
                确定跳转
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
/* -------------------- 功能区：记忆面板数据与渲染 结束 -------------------- */

/* ============================================================================
 * 功能区：长期记忆界面 / MemoryPanel 结束
 * ========================================================================== */
