import { useMemo, useState } from 'react'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { findActiveCharacterCard } from '../../services/chat/roleplay.js'
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
  clearMemories,
  deleteMemoryCard,
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

type Filter = 'all' | 'active' | 'manual' | 'archived'

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '生效中' },
  { key: 'manual', label: '手动' },
  { key: 'archived', label: '已归档' },
]

const normalKinds: Array<{ key: NormalMemoryKind | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  ...NORMAL_MEMORY_KINDS.map((key) => ({
    key,
    label: normalMemoryLabel(key),
  })),
]

/** 长期记忆面板：普通/角色双分类，普通记忆再分对话、代码、用户、AI */
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
    roleplayEnabled && Boolean(findActiveCharacterCard(characterCards, activeCharacterId))
  const [draft, setDraft] = useState('')
  const [draftPool, setDraftPool] = useState<MemoryPool>('character')
  const normalDraftLocked = roleplayActive && draftPool === 'normal'
  const [draftKind, setDraftKind] = useState<NormalMemoryKind | 'auto'>('auto')
  const [query, setQuery] = useState('')
  const [pool, setPool] = useState<MemoryPool>('character')
  const [normalKind, setNormalKind] = useState<NormalMemoryKind | 'all'>('all')
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
    { kind: 'one'; messageId: string; cardId: string } | { kind: 'all' } | null
  >(null)
  const [editing, setEditing] = useState<{
    messageId: string
    cardId: string
    text: string
  } | null>(null)
  const messages = useMemo(() => getVisibleMessages(session), [session])
  const entries = useMemo(() => {
    const all = collectVisibleMemories(session, messages)
    return all.slice().sort((a, b) => b.card.createdAt - a.card.createdAt)
  }, [session, messages])

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
      poolEntries.filter(
        ({ card }) => card.source !== 'manual' && !card.pinned && !card.superseded
      ).length,
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
  const normalKindCounts = useMemo(() => {
    const counts: Record<NormalMemoryKind, number> = {
      dialogue: 0,
      code: 0,
      user: 0,
      ai: 0,
    }
    for (const { card } of entries) {
      if (getMemoryPool(card) === 'normal') {
        counts[getNormalMemoryKind(card)] += 1
      }
    }
    return counts
  }, [entries])
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
          ? selectNormalMemoryCardsForInjection(
              session,
              messages,
              normalMemoryLimit,
              lastQuestion
            )
          : [],
    [
      pool,
      session,
      messages,
      memoryLimit,
      normalMemoryLimit,
      lastQuestion,
      normalInjectionAllowed,
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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const searching = needle.length > 0
    return entries.filter(({ card }) => {
      // 有关键词时跨分类搜索；没有关键词时按当前 Tab 与普通子分类筛选
      if (!searching) {
        if (getMemoryPool(card) !== pool) {
          return false
        }
        if (
          pool === 'normal' &&
          normalKind !== 'all' &&
          getNormalMemoryKind(card) !== normalKind
        ) {
          return false
        }
      }
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
  }, [entries, filter, query, pool, normalKind])

  const countRatio = Math.min(1, autoCount / Math.max(1, cardLimit))
  const charRatio = Math.min(1, activeChars / Math.max(1, budget))
  const limitRatio = Math.max(countRatio, charRatio)

  const submit = () => {
    const text = draft.trim()
    if (!text || (roleplayActive && draftPool === 'normal')) {
      return
    }
    const category =
      draftPool === 'normal'
        ? draftKind === 'auto'
          ? detectNormalMemoryKind(text)
          : draftKind
        : undefined
    addManualMemory(session.id, text, {
      pool: draftPool,
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
            onClick={() => {
              setPool('character')
              setFilter('all')
              setShown(PAGE_SIZE)
              setDraftPool('character')
            }}
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
            onClick={() => {
              setPool('normal')
              setFilter('all')
              setShown(PAGE_SIZE)
              setDraftPool('normal')
            }}
          >
            <span className={styles.poolIcon}>⌘</span>
            <span>
              <strong>普通记忆</strong>
              <small>{roleplayActive ? '角色扮演中暂停写入' : '开发 · 问答 · 代码'}</small>
            </span>
            <em>{normalCount}</em>
          </button>
        </div>

        {pool === 'normal' ? (
          <div className={styles.kindTabs} role="tablist" aria-label="普通记忆子分类">
            {normalKinds.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={normalKind === item.key}
                data-active={normalKind === item.key}
                onClick={() => {
                  setNormalKind(item.key)
                  setShown(PAGE_SIZE)
                }}
              >
                {item.label}
                {item.key !== 'all' ? (
                  <span>{normalKindCounts[item.key]}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

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
          <div className={styles.filters} role="tablist" aria-label="记忆状态筛选">
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
            placeholder="搜索全部记忆：称呼、地点、代码、报错关键词"
            aria-label="搜索记忆"
            onChange={(event) => {
              setQuery(event.target.value)
              setShown(PAGE_SIZE)
            }}
          />
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
              {filtered.slice(0, shown).map(({ card, messageId }) => (
                <article
                  className={styles.item}
                  key={card.id}
                  data-off={!card.enabled ? 'true' : undefined}
                  data-archived={card.superseded ? 'true' : undefined}
                  data-pool={getMemoryPool(card)}
                >
                  <div className={styles.itemHead}>
                    <span className={styles.poolTag} data-pool={getMemoryPool(card)}>
                      {cardPoolLabel(card)}
                      {card.language ? ` · ${card.language}` : ''}
                    </span>
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
                      onClick={() => setMemoryPinned(session.id, messageId, card.id, !card.pinned)}
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
                  ) : getMemoryPool(card) === 'normal' &&
                    getNormalMemoryKind(card) === 'code' ? (
                    <pre className={styles.codeText}>{card.text}</pre>
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
          <div className={styles.addBox}>
            <div className={styles.addPoolRow}>
              <button
                type="button"
                data-active={draftPool === 'character'}
                onClick={() => setDraftPool('character')}
              >
                角色记忆
              </button>
              <button
                type="button"
                data-active={draftPool === 'normal'}
                disabled={roleplayActive}
                onClick={() => setDraftPool('normal')}
              >
                普通记忆
              </button>
            </div>
            {draftPool === 'normal' ? (
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
                  : draftPool === 'normal'
                    ? '记一条开发/问答参考，例如：报错原因、命令、接口字段；代码块会自动归入代码。'
                    : '手动记一条，例如：用户/韩寒最喜欢吃烧烤，角色/她习惯晚上聊天。'
              }
              onChange={(event) => setDraft(event.target.value)}
            />
            <button className={styles.primary} type="button" disabled={normalDraftLocked} onClick={submit}>
              添加
            </button>
          </div>
          <p className={styles.footerHint}>
            {roleplayActive
              ? '角色扮演开启时，长按保存的代码与整轮内容只进角色记忆；普通记忆暂停手动补卡，关闭角色扮演后恢复。'
              : '保存历史对话请长按消息 → 选择这条对话 / 全选本对话 → 保存为记忆，并在确认弹窗里选分类。'}
          </p>
          {poolEntries.length > 0 ? (
            <button
              className={styles.clearAll}
              type="button"
              onClick={() => setConfirming({ kind: 'all' })}
            >
              清空当前分类
            </button>
          ) : null}
        </footer>
      </section>

      {confirming ? (
        <div className={styles.confirm} role="dialog" aria-modal="true">
          <section>
            <strong>{confirming.kind === 'all' ? '清空当前分类？' : '删除这张卡片？'}</strong>
            <p>
              {confirming.kind === 'all'
                ? '只清空当前分类的全部卡片，另一个分类不受影响。文本会从本机删除，无法恢复。'
                : '文本会从本机删除，无法恢复；如果只是想停止注入，用「已启用」开关。'}
            </p>
            <div>
              <button type="button" onClick={() => setConfirming(null)}>
                取消
              </button>
              <button
                className={styles.danger}
                type="button"
                onClick={() => {
                  if (confirming.kind === 'all') {
                    clearMemories(session.id, pool)
                  } else {
                    deleteMemoryCard(session.id, confirming.messageId, confirming.cardId)
                  }
                  setConfirming(null)
                }}
              >
                {confirming.kind === 'all' ? '清空' : '删除'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
