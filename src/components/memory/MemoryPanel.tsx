/* ============================================================================
 * 功能区：视图与交互 / MemoryPanel · 长期记忆面板
 * 职责：长期记忆面板：双分类、筛选、编辑、补卡、配额与注入预览。
 * 分区：01 类型、常量与模块依赖；02 展示辅助与分类映射；03 功能实现（MemoryPanel）；04 记忆面板数据与渲染
 * 关联：依赖 components/memory/MemoryPanel.module、components/memory/memoryPanelState、services/chat/branches、services/chat/memory 等 10 个模块；
 *    被 components/session/SessionView 引用。
 * 导出：MemoryPanel
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useEffect, useMemo, useState } from 'react'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { findActiveCharacterCard, findSessionCharacterCard } from '../../services/chat/roleplay.js'
import {
  memoryPoolForDisplayName,
  resolveMemoryDisplayName,
} from '../../services/chat/memoryRouting.js'
import {
  activeMemoryCards,
  activeMemoryChars,
  characterMemoryLabel,
  collectVisibleMemories,
  CHARACTER_MEMORY_KINDS,
  detectCodeBlock,
  detectNormalMemoryKind,
  filterCharacterMemoryForInjection,
  getCharacterMemoryKind,
  getMemoryOwner,
  getMemoryPool,
  getNormalMemoryKind,
  isCoreMemory,
  MEMORY_OWNERS,
  memoryOwnerLabel,
  NORMAL_MEMORY_KINDS,
  normalMemoryLabel,
  selectMemoryCardsForInjection,
  selectNormalMemoryCardsForInjection,
  type CharacterMemoryKind,
  type MemoryCard,
  type MemoryOwner,
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
import { resolveUserName, useSettings } from '../../services/settings.js'
import { closeMemoryPanel } from './memoryPanelState.js'
import styles from './MemoryPanel.module.css'

/* ---- 01 类型、常量与模块依赖 ---- */
const PAGE_SIZE = 40

/* ---- 02 展示辅助与分类映射 ---- */
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
    if (getMemoryPool(card) === 'normal') {
      return '收录'
    }
    return getCharacterMemoryKind(card) === 'turn' ? '整段' : '摘录'
  }
  return card.source === 'refine' ? '提炼' : '自动'
}

const cardPoolLabel = (card: MemoryCard) => {
  if (getMemoryPool(card) === 'character') {
    return `角色 · ${characterMemoryLabel(getCharacterMemoryKind(card))}`
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
  { key: 'bulk', label: '整段/摘录' },
  { key: 'archived', label: '已归档' },
]

const CHARACTER_STATUS_FILTERS: Array<{ key: MemoryStatusFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pinned', label: '置顶' },
  { key: 'active', label: '生效中' },
  { key: 'scene', label: '重要场景' },
  { key: 'fact', label: '关键事实' },
  { key: 'manual', label: '手动' },
  { key: 'bulk', label: '整段/摘录' },
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

/* ---- 03 功能实现（MemoryPanel） ---- */
/* ---- 04 记忆面板数据与渲染 ---- */
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
  const characterName = useSettings((state) => state.characterName)
  const systemPrompt = useSettings((state) => state.systemPrompt)
  const sessionCard = findSessionCharacterCard(characterCards, session)
  const activeCard = roleplayEnabled
    ? findActiveCharacterCard(characterCards, activeCharacterId)
    : undefined
  const displayCard = sessionCard ?? activeCard
  const resolvedCharacterName = resolveMemoryDisplayName({
    cardName: displayCard?.name,
    characterName,
    custom: false,
  })
  const characterMemoryActive =
    Boolean(systemPrompt.trim()) &&
    memoryPoolForDisplayName(resolvedCharacterName) === 'character'
  // 旧卡没有 speaker 字段时，用当前玩家名与角色名补上归属，不再统一显示「用户」。
  const memoryNames = {
    user: resolveUserName(),
    character: characterMemoryActive ? resolvedCharacterName : '',
  }
  const [draft, setDraft] = useState('')
  const [draftKind, setDraftKind] = useState<NormalMemoryKind | 'auto'>('auto')
  const [draftCharacterKind, setDraftCharacterKind] =
    useState<CharacterMemoryKind>('turn')
  const [draftOwner, setDraftOwner] = useState<MemoryOwner>('shared')
  const [draftTrigger, setDraftTrigger] = useState('')
  const [draftProactive, setDraftProactive] = useState(true)
  const [draftPinned, setDraftPinned] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')
  const [query, setQuery] = useState('')
  const [pool, setPool] = useState<MemoryPool>(() =>
    characterMemoryActive ? 'character' : 'normal'
  )
  const normalDraftLocked = characterMemoryActive && pool === 'normal'
  // 显示名在面板打开期间变化时，把补卡池拉回当前允许的一侧，避免停在已锁定的普通池。
  useEffect(() => {
    setPool(characterMemoryActive ? 'character' : 'normal')
  }, [characterMemoryActive])
  useEffect(() => {
    if (!saveNotice) {
      return
    }
    const timer = window.setTimeout(() => setSaveNotice(''), 2600)
    return () => window.clearTimeout(timer)
  }, [saveNotice])
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
    setDraftCharacterKind('turn')
    setDraftOwner('shared')
    setDraftTrigger('')
    setDraftProactive(false)
    setDraftPinned(false)
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
  /** 顶部配额详情默认收起，只留一行摘要；需要核对预算时再展开 */
  const [statsOpen, setStatsOpen] = useState(false)
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
  const activeCards = useMemo(
    () => activeMemoryCards(session, messages, undefined, pool),
    [session, messages, pool]
  )
  const activeCount = activeCards.length
  const activeChars = useMemo(
    () => activeMemoryChars(session, messages, pool),
    [session, messages, pool]
  )
  const autoCount = useMemo(
    () =>
      poolEntries.filter(
        ({ card }) =>
          card.source !== 'manual' && !card.pinned && !card.superseded && !isCoreMemory(card)
      ).length,
    [poolEntries]
  )
  const sceneCount = useMemo(
    () => poolEntries.filter(({ card }) => getCharacterMemoryKind(card) === 'scene').length,
    [poolEntries]
  )
  const factCount = useMemo(
    () => poolEntries.filter(({ card }) => getCharacterMemoryKind(card) === 'fact').length,
    [poolEntries]
  )
  const activeSceneCount = activeCards.filter(
    ({ card }) => getCharacterMemoryKind(card) === 'scene'
  ).length
  const activeFactCount = activeCards.filter(
    ({ card }) => getCharacterMemoryKind(card) === 'fact'
  ).length
  const archivedCount = useMemo(
    () => poolEntries.filter(({ card }) => card.superseded).length,
    [poolEntries]
  )
  const manualCount = useMemo(
    () => poolEntries.filter(({ card }) => card.source === 'manual').length,
    [poolEntries]
  )
  const ownerCounts = useMemo(
    () =>
      poolEntries.reduce(
        (total, { card }) => {
          const owner = getMemoryOwner(card)
          total[owner] += 1
          return total
        },
        { character: 0, user: 0, shared: 0 }
      ),
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
  const normalInjectionAllowed = normalMemoryEnabled && !characterMemoryActive
  const injection = useMemo(
    () =>
      pool === 'character'
        ? filterCharacterMemoryForInjection(
            selectMemoryCardsForInjection(session, messages, memoryLimit, lastQuestion),
            characterMemoryActive
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
      characterMemoryActive,
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
  const statusFilters = pool === 'character' ? CHARACTER_STATUS_FILTERS : STATUS_FILTERS
  const clearActionLabel = narrowed ? '清空当前筛选' : `清空${memoryPoolLabel(pool)}`
  const clearTargets = filtered.map(({ card, messageId }) => ({ messageId, cardId: card.id }))
  const countRatio = Math.min(1, autoCount / Math.max(1, cardLimit))
  const charRatio = Math.min(1, activeChars / Math.max(1, budget))
  const limitRatio = Math.max(countRatio, charRatio)

  const submit = () => {
    const text = draft.trim()
    if (!text || (characterMemoryActive && pool === 'normal')) {
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
      memoryKind: pool === 'character' ? draftCharacterKind : undefined,
      owner: pool === 'character' ? draftOwner : undefined,
      trigger: pool === 'character' ? draftTrigger : undefined,
      proactive: pool === 'character' ? draftProactive : undefined,
      pinned: pool === 'character' ? draftPinned : undefined,
    })
    setDraft('')
    setDraftTrigger('')
    setDraftOwner('shared')
    setDraftProactive(true)
    setDraftPinned(false)
    setSaveNotice(
      pool === 'character'
        ? draftOwner === 'character'
          ? '已记下角色本人的记忆，重新生成或继续对话时会带进上下文。'
          : draftOwner === 'user'
            ? '已记下玩家本人的信息，角色会知道这是你说的，不会当成自己的经历。'
            : '已记下共同经历，重新生成或继续对话时会带进上下文。'
        : '已记下这条普通记忆。'
    )
  }

  const emptyForFilter =
    filter === 'archived'
      ? '尚无归档卡片'
      : filter === 'scene'
        ? '尚无重要场景。长按选中对话后可单独摘成场景'
        : filter === 'fact'
          ? '尚无关键事实。可在下方手动记一条'
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
      <section className={styles.card} data-adding={adding ? 'true' : undefined}>
        <header className={styles.head}>
          <div>
            <span className={styles.eyebrow}>MEMORY</span>
            <h2>长期记忆</h2>
            <p>
              角色 {characterCount} 张 · 普通 {normalCount} 张
              {pool === 'character' && (sceneCount > 0 || factCount > 0)
                ? ` · 场景 ${sceneCount} · 事实 ${factCount}`
                : ''}
              {pool === 'character' && (ownerCounts.character > 0 || ownerCounts.user > 0)
                ? ` · ${memoryOwnerLabel('character', memoryNames)} ${ownerCounts.character} · ${memoryOwnerLabel('user', memoryNames)} ${ownerCounts.user}`
                : ''}
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
              <small>剧情 · 场景 · 事实</small>
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
              <small>{characterMemoryActive ? '普通池已暂停' : '开发 · 问答 · 代码'}</small>
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
              生效 {activeCount} · 自动配额 {autoCount} / {cardLimit}
            </span>
            <button
              className={styles.usageToggle}
              type="button"
              aria-expanded={statsOpen}
              onClick={() => setStatsOpen((current) => !current)}
            >
              {statsOpen ? '收起' : '详情'}
              <span data-open={statsOpen ? 'true' : undefined} aria-hidden="true">
                ⌄
              </span>
            </button>
          </div>
          <div className={styles.usageSummary}>
            <span>
              {pool === 'normal' && !normalInjectionAllowed
                ? '普通池暂停注入'
                : lastQuestion
                  ? `本轮注入 ${injectionPreview.count} 张 · ${injectionPreview.chars.toLocaleString('zh-CN')} 字`
                  : '本轮注入：发消息后显示'}
            </span>
            {pool === 'character' ? (
              <span>
                核心 场景 {activeSceneCount} / 事实 {activeFactCount}
              </span>
            ) : null}
          </div>
          <div className={styles.meter} aria-hidden="true">
            <i style={{ width: `${Math.max(limitRatio * 100, autoCount > 0 ? 2 : 0)}%` }} />
          </div>
          {statsOpen ? (
            <>
              <div className={styles.diagnosis}>
                <div>
                  <b>本轮注入</b>
                  <span>
                    {pool === 'normal' && !normalInjectionAllowed
                      ? '已暂停：角色名下不注入普通池'
                      : lastQuestion
                        ? `${injectionPreview.count} 张 · ${injectionPreview.chars.toLocaleString('zh-CN')} 字`
                        : '发一条消息后显示'}
                  </span>
                  <small>
                    {pool === 'normal' && !normalInjectionAllowed
                      ? '把显示名恢复为 AI / DeepSeek 后恢复'
                      : injectionPreview.total > injectionPreview.count
                        ? `共对上 ${injectionPreview.total} 张，预算只够前 ${injectionPreview.count} 张`
                        : pool === 'character' && !characterMemoryActive && hasRoleplayCodeCard
                          ? '已排除带代码块的角色卡'
                          : `预算 ${budget.toLocaleString('zh-CN')} 字`}
                  </small>
                </div>
                <div>
                  <b>容量占用</b>
                  <span>
                    {activeChars.toLocaleString('zh-CN')} / {budget.toLocaleString('zh-CN')} 字
                  </span>
                  <small>
                    自动配额 {autoCount} / {cardLimit} 张
                    {activeChars >= budget ? ' · 已到上限，新的自动卡会归档' : ''}
                  </small>
                </div>
                {pool === 'character' ? (
                  <div>
                    <b>核心记忆</b>
                    <span>
                      生效场景 {activeSceneCount} · 生效事实 {activeFactCount}
                    </span>
                    <small>每轮各最多带回 6 张；不占自动配额，不参与淘汰</small>
                  </div>
                ) : null}
              </div>
              <p>
                {pool === 'normal'
                  ? `普通记忆只做关键词检索与开发问答，不参与角色时间线；超过 ${cardLimit} 张或 ${budget.toLocaleString('zh-CN')} 字后，最早的自动卡会归档，文本保留。`
                  : memoryMode === 'off'
                    ? '现在不带角色记忆，记下来的内容还在本机。到「设置 → 长期记忆」打开就能恢复。'
                    : `超过 ${cardLimit} 张或 ${budget.toLocaleString('zh-CN')} 字以后，最早的自动卡片会归档：内容不删，这里照样能看，只是不再带进对话。`}
              </p>
            </>
          ) : null}
        </div>

        <div className={styles.toolbar}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>状态</span>
            <div className={styles.filters} role="tablist" aria-label="记忆状态筛选">
              {statusFilters.map((item) => (
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
                const owner = getMemoryOwner(card)
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
                        {card.pool === 'character' &&
                        (card.source === 'manual' || owner !== 'shared') ? (
                          <span className={styles.ownerTag} data-owner={owner}>
                            {card.speaker || memoryOwnerLabel(owner, memoryNames)}
                          </span>
                        ) : null}
                        {card.trigger ? (
                          <span className={styles.tag}>触发 · {card.trigger}</span>
                        ) : null}
                        {card.proactive ? <span className={styles.tag}>主动提起</span> : null}
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
              {pool === 'character' ? (
                <div className={styles.addKindRow} role="radiogroup" aria-label="角色记忆类型">
                  {CHARACTER_MEMORY_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      aria-checked={draftCharacterKind === kind}
                      data-active={draftCharacterKind === kind}
                      onClick={() => setDraftCharacterKind(kind)}
                    >
                      {characterMemoryLabel(kind)}
                    </button>
                  ))}
                </div>
              ) : pool === 'normal' ? (
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
              {pool === 'character' ? (
                <div className={styles.addOptions}>
                  <div className={styles.addOwnerRow} role="radiogroup" aria-label="这条记忆属于谁">
                    <span className={styles.addOwnerLabel}>归属</span>
                    {MEMORY_OWNERS.map((owner) => (
                      <button
                        key={owner}
                        type="button"
                        role="radio"
                        aria-checked={draftOwner === owner}
                        data-active={draftOwner === owner}
                        onClick={() => setDraftOwner(owner)}
                      >
                        {memoryOwnerLabel(owner)}
                      </button>
                    ))}
                  </div>
                  <p className={styles.addOwnerHint}>
                    {draftOwner === 'character'
                      ? '记角色自己的经历、喜好或承诺；她会把它当成自己的事。'
                      : draftOwner === 'user'
                        ? '记玩家告诉她的信息；她可以提起，但不能说成自己的经历。'
                        : '记双方一起经历或共同知道的事，角色和玩家都算在场。'}
                  </p>
                  <input
                    className={styles.addTrigger}
                    value={draftTrigger}
                    maxLength={80}
                    placeholder="触发线索（可选）：她看到手表、听见下雨、你提到生日时更容易想起"
                    aria-label="记忆触发线索"
                    onChange={(event) => setDraftTrigger(event.target.value)}
                  />
                  <div className={styles.addFlags}>
                    <button
                      type="button"
                      aria-pressed={draftProactive}
                      data-active={draftProactive}
                      onClick={() => setDraftProactive((current) => !current)}
                    >
                      主动提起
                    </button>
                    <button
                      type="button"
                      aria-pressed={draftPinned}
                      data-active={draftPinned}
                      onClick={() => setDraftPinned((current) => !current)}
                    >
                      每轮优先
                    </button>
                    <small>手动卡本身会优先注入；「主动提起」只让角色找机会开口，「每轮优先」再提前占用预算。</small>
                  </div>
                </div>
              ) : null}
              <textarea
                value={draft}
                rows={2}
                maxLength={4000}
                disabled={normalDraftLocked}
                placeholder={
                  normalDraftLocked
                    ? '当前显示名是角色名，普通记忆暂停写入；把角色名恢复为 AI / DeepSeek 或清空表达提示词后再补开发代码。'
                    : pool === 'normal'
                      ? '记一条开发/问答参考，例如：报错原因、命令、接口字段；代码块会自动归入代码。'
                      : draftCharacterKind === 'scene'
                        ? '描述一个必须记住的场景：在哪里、和谁、发生了什么、当时的气氛或关键细节。'
                        : draftCharacterKind === 'fact'
                          ? '记一条稳定事实：姓名、称呼、关系、喜好、承诺或不能忘的约定。'
                          : '记一段完整回合，例如：用户/今天去了哪，角色/怎么回应；也可以直接贴原文。'
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
                {saveNotice ? (
                  <span className={styles.saveNotice} role="status">
                    {saveNotice}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className={styles.footerMeta}>
            <p className={styles.footerHint}>
              {normalDraftLocked
                ? '普通记忆暂停写入：把显示名恢复为 AI / DeepSeek 或清空表达提示词后恢复。'
                : adding
                  ? '长按消息可保存对话；写好后按「添加」。'
                  : '长按消息可保存对话，也可手写一条。'}
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
          </div>
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

/* ============================================================================
 * 功能区：长期记忆界面 / MemoryPanel 结束
 * ========================================================================== */
