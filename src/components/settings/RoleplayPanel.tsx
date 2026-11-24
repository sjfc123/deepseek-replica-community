import { useEffect, useMemo, useRef, useState } from 'react'
import { startCharacterIntro, useChatStore } from '../../services/chat/store.js'
import {
  BUILTIN_CHARACTER_CARD_TOTAL,
  CHARACTER_CARD_MAX,
  CHARACTER_TAG_MAX,
  CHARACTER_TAG_LENGTH,
  SCENE_FIELDS,
  WORLDBOOK_WEIGHT_DEFAULT,
  WORLDBOOK_MAX,
  newRoleplayId,
  normalizeKeywords,
  normalizeTags,
  readAvatarImage,
  sceneHasContent,
  selectWorldbookEntries,
  type CharacterCard,
  type SceneField,
  type WorldbookEntry,
} from '../../services/chat/roleplay.js'
import {
  parseCharacterPayload,
  parseWorldbookPayload,
  readCharacterFile,
} from '../../services/chat/cardFormats.js'
import {
  activateCharacterCard,
  clearScene,
  deleteCharacterCard,
  deleteWorldbookEntry,
  restoreBuiltinCharacterCards,
  saveCharacterCard,
  setCardAvatar,
  saveWorldbookEntry,
  setSceneAutoUpdate,
  setSceneField,
  setRoleplayEnabled,
  setWorldbookChars,
  useSettings,
  WORLDBOOK_BUDGET_DEFAULT,
  WORLDBOOK_BUDGET_MAX,
  WORLDBOOK_BUDGET_MIN,
} from '../../services/settings.js'
import { showToast } from '../base/toastState.js'
import { android, saveAndroidHistory } from '../../app/android.js'
import styles from './RoleplayPanel.module.css'


/** 示例模板：字段与角色卡一一对应，点击后整组填入，用户可继续修改 */
const CARD_EXAMPLES: Array<{ label: string; card: Partial<CharacterCard> }> = [
  {
    label: '旧城邻里',
    card: {
      name: '林晚',
      identity: '二十八岁，旧城区巷口开一家修表铺，铺子只有一张工作台。手上常年有机油味，认得这条街上每一块表。',
      relationship: '住对门五年。你搬来那天她借过一把螺丝刀，之后一直没还，也没提。',
      style: '话少，句子短，先说结论再说原因。不主动开玩笑，但接得住别人的玩笑。',
      tics: '说话时用拇指搓表带；被问到私事会先低头看表。',
      greeting:
        '（把台灯往下压了压，抬头看你）门没锁，进来吧。表又停了？先放这儿，我看看。',
      notes: '不谈过去那段婚姻；不劝人留在旧城；夜里十点后不回铺子。',
    },
  },
  {
    label: '末世同行',
    card: {
      name: '陆沉',
      identity: '三十岁出头，灾变前是地铁检修工。现在负责一支六人小队的水电和路线，左臂有一道旧伤。',
      relationship: '和你搭伙走了两年，分工明确：他找水，你守夜。',
      style: '低声、简短，习惯先报风险再给方案。紧张时会重复对方的话尾。',
      tics: '检查装备时从左到右数一遍；听到异响会先按住你的手腕。',
      greeting: '（把水壶递过来，先拧开盖子闻了一下）今天只剩一半。你喝三口，剩下的路上再说。',
      notes: '不轻易承诺能活到明天；不美化伤亡；不谈灾变前的家人。',
    },
  },
  {
    label: '古风客栈',
    card: {
      name: '沈照',
      identity: '客栈掌柜，二十五六岁，账算得比刀快。祖父留下这间店，前后院一共九间房。',
      relationship: '你第三次住店，欠下的房钱还挂在账上，他没催。',
      style: '客气里带分寸，敬语用得准，话不说满。被冒犯时会笑，笑得让人心里发凉。',
      tics: '算账时拨算珠；不想答的问题会先给你添茶。',
      greeting: '（拨了一下算珠，抬眼）客官又来。上回的账还在，先坐，茶刚沏。',
      notes: '不谈祖父的死因；不让客人进后院东厢；不赊第二次账。',
    },
  },
]

const emptyCard = (name = ''): CharacterCard => ({
  id: newRoleplayId(),
  name,
  identity: '',
  relationship: '',
  style: '',
  tics: '',
  greeting: '',
  notes: '',
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

const emptyEntry = (): WorldbookEntry => ({
  id: newRoleplayId(),
  title: '',
  keywords: [],
  content: '',
  enabled: true,
  always: false,
  match: 'keyword',
  cardId: '',
  weight: WORLDBOOK_WEIGHT_DEFAULT,
  position: 'context',
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

type Confirm = { kind: 'card' | 'entry'; id: string; name: string } | null

/** 角色卡字段完整度：名字必填，其余六项用于判断设定是否够用 */
const CARD_FIELD_TOTAL = 7

const cardFieldCount = (card: CharacterCard) =>
  [card.name, card.identity, card.relationship, card.style, card.tics, card.greeting, card.notes]
    .filter((value) => value.trim()).length

const formatDate = (value: number) =>
  value
    ? new Date(value).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '尚未填写'

export function RoleplayPanel() {
  const cards = useSettings((state) => state.characterCards)
  const activeCharacterId = useSettings((state) => state.activeCharacterId)
  const roleplayEnabled = useSettings((state) => state.roleplayEnabled)
  const cardAvatars = useSettings((state) => state.cardAvatars)
  const worldbook = useSettings((state) => state.worldbook)
  const worldbookChars = useSettings((state) => state.worldbookChars)
  const worldbookInject = useSettings((state) => state.worldbookInject)
  const scene = useSettings((state) => state.scene)
  const sceneAutoUpdate = useSettings((state) => state.sceneAutoUpdate)
  const characterName = useSettings((state) => state.characterName)
  const activeId = useChatStore((state) => state.activeId)
  const sessionCache = useChatStore((state) => state.sessionCache)

  const [cardDraft, setCardDraft] = useState<CharacterCard | null>(null)
  const [entryDraft, setEntryDraft] = useState<WorldbookEntry | null>(null)
  const [keywordDraft, setKeywordDraft] = useState('')
  const [sceneDraft, setSceneDraft] = useState(scene)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [cardQuery, setCardQuery] = useState('')
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  /** 分区切换：三块内容各自独立，进页面先看角色卡 */
  const [panelTab, setPanelTab] = useState<'cards' | 'worldbook' | 'scene'>('cards')
  const [entryQuery, setEntryQuery] = useState('')
  const [budgetDraft, setBudgetDraft] = useState(String(worldbookChars))
  const [cardImporting, setCardImporting] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)
  const cardFileInput = useRef<HTMLInputElement>(null)
  const entryFileInput = useRef<HTMLInputElement>(null)

  const activeCard = cards.find((card) => card.id === activeCharacterId)
  const roleplayOn = roleplayEnabled && Boolean(activeCard)
  const isNewDraft = Boolean(cardDraft && !cards.some((card) => card.id === cardDraft.id))
  const lastUserText = useMemo(() => {
    if (!activeId) {
      return ''
    }
    const session = sessionCache[activeId]
    if (!session) {
      return ''
    }
    const messages = session.messages
      .filter((message) => message.role === 'user')
      .slice(-2)
    return messages
      .map((message) => (message.role === 'user' ? message.content : ''))
      .filter(Boolean)
      .join('\n')
  }, [activeId, sessionCache])
  const hitEntries = useMemo(
    () =>
      roleplayOn && worldbookInject
        ? selectWorldbookEntries(
            worldbook,
            lastUserText,
            undefined,
            worldbookChars,
            activeCharacterId
          )
        : [],
    [worldbook, lastUserText, activeCharacterId, worldbookChars, worldbookInject, roleplayOn]
  )
  const entryNeedle = entryQuery.trim().toLowerCase()
  const filteredEntries = entryNeedle
    ? worldbook.filter((entry) =>
        [entry.title, entry.content, ...entry.keywords]
          .join('\n')
          .toLowerCase()
          .includes(entryNeedle)
      )
    : worldbook
  const enabledEntries = worldbook.filter((entry) => entry.enabled).length
  const alwaysEntries = roleplayOn && worldbookInject
    ? worldbook.filter((entry) => entry.enabled && entry.always).length
    : 0
  const sceneCount = SCENE_FIELDS.filter(({ key }) => scene[key].trim()).length
  // 标签清单按使用次数排序，供顶部筛选行展示
  const tagList = useMemo(() => {
    const counts = new Map<string, number>()
    for (const card of cards) {
      for (const tag of card.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
      .map(([tag, count]) => ({ tag, count }))
  }, [cards])
  const visibleCards = useMemo(() => {
    const query = cardQuery.trim().toLowerCase()
    return cards.filter((card) => {
      if (tagFilter && !card.tags.includes(tagFilter)) {
        return false
      }
      if (!query) {
        return true
      }
      return [card.name, card.identity, card.relationship, card.style, card.tics]
        .join('\n')
        .toLowerCase()
        .includes(query)
    })
  }, [cards, cardQuery, tagFilter])

  useEffect(() => {
    setSceneDraft(scene)
  }, [scene])

  useEffect(() => {
    setBudgetDraft(String(worldbookChars))
  }, [worldbookChars])

  const applyBudget = (value: number) => {
    const next = Math.min(WORLDBOOK_BUDGET_MAX, Math.max(WORLDBOOK_BUDGET_MIN, Math.round(value)))
    setWorldbookChars(next)
    setBudgetDraft(String(next))
  }

  const startEditCard = (card: CharacterCard) => {
    setCardDraft({ ...card })
    setTagDraft(card.tags.join('、'))
    setAvatarDraft(cardAvatars[card.id] ?? null)
    setEntryDraft(null)
  }

  const saveCardDraft = () => {
    if (!cardDraft) {
      return
    }
    const name = cardDraft.name.trim()
    if (!name) {
      showToast({ key: 'roleplayNeedName', type: 'error' })
      return
    }
    const saved = { ...cardDraft, name, tags: normalizeTags(tagDraft), updatedAt: Date.now() }
    if (!saveCharacterCard(saved)) {
      showToast({ key: 'roleplayStorageFailed', type: 'error' })
      return
    }
    if (!setCardAvatar(saved.id, avatarDraft)) {
      showToast({ key: 'roleplayStorageFailed', type: 'error' })
      return
    }
    setCardDraft(null)
    setAvatarDraft(null)
    setTagDraft('')
    showToast({ key: 'roleplayCardSaved', params: { name } })
  }

  const useCard = (card: CharacterCard) => {
    activateCharacterCard(card.id)
    const introSession = startCharacterIntro(card.greeting, card.name)
    showToast({
      key: introSession ? 'roleplayIntroStarted' : 'roleplaySwitched',
      params: { name: card.name },
    })
  }

  /** 关闭角色扮演：卡暂停，不再向请求注入卡设定，回到手写提示词与手写角色名 */
  const closeRoleplay = (card: CharacterCard) => {
    setRoleplayEnabled(false)
    showToast({ key: 'roleplayClosed', params: { name: card.name } })
  }

  /** 复制一张卡：沿用头像与设定，换新 id 与名字后缀，方便在同一原型上分叉 */
  const duplicateCard = (card: CharacterCard) => {
    if (cards.length >= CHARACTER_CARD_MAX) {
      showToast({ key: 'roleplayCardLimit', type: 'error', params: { max: CHARACTER_CARD_MAX } })
      return
    }
    const copy: CharacterCard = {
      ...card,
      id: newRoleplayId(),
      name: `${card.name} 副本`.slice(0, 30),
      builtin: false,
      source: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    if (!saveCharacterCard(copy)) {
      showToast({ key: 'roleplayStorageFailed', type: 'error' })
      return
    }
    const sourceAvatar = cardAvatars[card.id]
    if (sourceAvatar) {
      setCardAvatar(copy.id, sourceAvatar)
    }
    showToast({ key: 'roleplayCardCopied', params: { name: copy.name } })
  }

  /** 头像选择：读取后压缩为 256 正方形 JPEG，写回草稿，保存时才落盘 */
  const handleAvatarPick = async (file: File | undefined) => {
    if (!file) {
      return
    }
    setAvatarBusy(true)
    try {
      const avatar = await readAvatarImage(file)
      setAvatarDraft(avatar)
      showToast({ key: 'roleplayAvatarUpdated' })
    } catch (error) {
      showToast({
        key: 'roleplayAvatarFailed',
        type: 'error',
        params: { reason: error instanceof Error ? error.message : String(error) },
      })
    } finally {
      setAvatarBusy(false)
    }
  }

  const startEditEntry = (entry: WorldbookEntry) => {
    setEntryDraft({ ...entry })
    setKeywordDraft(entry.keywords.join('，'))
    setCardDraft(null)
    setAvatarDraft(null)
    setTagDraft('')
  }

  const saveEntryDraft = () => {
    if (!entryDraft) {
      return
    }
    const title = entryDraft.title.trim()
    const content = entryDraft.content.trim()
    const keywords = normalizeKeywords(keywordDraft)
    if (!title || !content) {
      showToast({ key: 'roleplayEntryFields', type: 'error' })
      return
    }
    if (!saveWorldbookEntry({ ...entryDraft, title, content, keywords, updatedAt: Date.now() })) {
      showToast({ key: 'roleplayStorageFailed', type: 'error' })
      return
    }
    setEntryDraft(null)
    showToast({ key: 'roleplayEntrySaved', params: { name: title } })
  }

  const restoreBuiltinCards = () => {
    const added = restoreBuiltinCharacterCards()
    if (added < 0) {
      showToast({ key: 'roleplayStorageFailed', type: 'error' })
      return
    }
    if (added === 0) {
      showToast({ key: 'roleplayBuiltinPresent' })
      return
    }
    showToast({ key: 'roleplayBuiltinRestored', params: { count: added } })
  }

  const doDelete = () => {
    if (!confirm) {
      return
    }
    if (confirm.kind === 'card') {
      deleteCharacterCard(confirm.id)
      if (activeCharacterId === confirm.id) {
        activateCharacterCard(null)
      }
    } else {
      deleteWorldbookEntry(confirm.id)
    }
    showToast({ key: 'roleplayDeleted', params: { name: confirm.name } })
    setConfirm(null)
  }

  /** 世界书导出：整本打包成 JSON，换机或分享设定时单独迁移 */
  const exportWorldbook = async () => {
    const payload = {
      format: 'deepseek-replica-worldbook',
      version: 1,
      exportedAt: Date.now(),
      entries: worldbook,
    }
    const name = `deepseek_worldbook-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${worldbook.length}entries.json`
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    try {
      if (android) {
        const saved = await saveAndroidHistory(name, blob)
        showToast(
          saved
            ? { key: 'roleplayWorldbookExported', params: { name } }
            : { key: 'roleplayWorldbookExportCanceled' }
        )
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      showToast({ key: 'roleplayWorldbookExported', params: { name } })
    } catch {
      showToast({ key: 'roleplayStorageFailed', type: 'error' })
    }
  }

  /** 角色卡导入：JSON / PNG（Character Card V2、V3、TavernAI），随卡世界书一并写入 */
  const importCharacter = async (file: File) => {
    setCardImporting(true)
    try {
      const payload = await readCharacterFile(file)
      if (!payload) {
        showToast({ key: 'roleplayCharacterBadFile', type: 'error' })
        return
      }
      const incoming = parseCharacterPayload(payload)
      if (incoming.length === 0) {
        showToast({ key: 'roleplayCharacterBadFile', type: 'error' })
        return
      }
      const existing = useSettings.getState().characterCards
      const signatures = new Set(existing.map((card) => `${card.name}\n${card.identity}`))
      const room = Math.max(0, CHARACTER_CARD_MAX - existing.length)
      let avatar = ''
      if (incoming.length === 1 && (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png'))) {
        try {
          avatar = await readAvatarImage(file)
        } catch {
          avatar = ''
        }
      }
      let added = 0
      let skipped = 0
      let entries = 0
      let avatarAdded = 0
      for (const item of incoming) {
        const signature = `${item.card.name}\n${item.card.identity}`
        if (signatures.has(signature) || added >= room) {
          skipped++
          continue
        }
        if (!saveCharacterCard(item.card)) {
          skipped++
          continue
        }
        signatures.add(signature)
        added++
        if (avatar && avatarAdded === 0 && setCardAvatar(item.card.id, avatar)) {
          avatarAdded++
        }
        for (const entry of item.worldbook) {
          if (useSettings.getState().worldbook.length >= WORLDBOOK_MAX) {
            continue
          }
          if (saveWorldbookEntry({ ...entry, cardId: item.card.id })) {
            entries++
          }
        }
      }
      showToast({
        key: 'roleplayCharacterImported',
        params: { added, skipped, entries, avatars: avatarAdded },
        type: skipped > 0 ? 'error' : undefined,
      })
    } catch {
      showToast({ key: 'roleplayCharacterBadFile', type: 'error' })
    } finally {
      setCardImporting(false)
    }
  }

  /** 世界书导入：兼容本应用、SillyTavern world info 与角色卡 character_book */
  const importWorldbook = async (file: File) => {
    try {
      const parsed = await readCharacterFile(file)
      const incoming = parseWorldbookPayload(parsed)
      if (incoming.length === 0) {
        showToast({ key: 'roleplayWorldbookBadFile', type: 'error' })
        return
      }
      const existing = new Set(worldbook.map((entry) => entry.id))
      const room = Math.max(0, WORLDBOOK_MAX - worldbook.length)
      let added = 0
      let updated = 0
      let skipped = 0
      for (const entry of incoming) {
        const known = existing.has(entry.id)
        if (!known && added >= room) {
          skipped++
          continue
        }
        if (!saveWorldbookEntry(entry)) {
          skipped++
          continue
        }
        if (known) {
          updated++
        } else {
          existing.add(entry.id)
          added++
        }
      }
      showToast({
        key: 'roleplayWorldbookImported',
        params: { added, updated, skipped },
        type: skipped > 0 ? 'error' : undefined,
      })
    } catch {
      showToast({ key: 'roleplayWorldbookBadFile', type: 'error' })
    }
  }

  /**
   * 角色卡编辑器：编辑现有卡时渲染在卡片原位置，新建卡时渲染在列表上方。
   * 头部提供头像上传与三套示例，字段留空则不参与注入。
   */
  const renderCardEditor = () => {
    if (!cardDraft) {
      return null
    }
    const editingExisting = cards.some((card) => card.id === cardDraft.id)
    return (
      <div className={styles.editor}>
        <div className={styles.editorHead}>
          <strong>{editingExisting ? '编辑角色卡' : '新建角色卡'}</strong>
          <span>姓名必填，其余字段留空则不注入；字段越具体，角色行为一致性越高。</span>
          <span className={styles.sourceLine}>
            字段支持 {'${char_name}'} 与 {'${user_name}'} 占位符，发送时替换为角色名和账户名。
          </span>
          {cardDraft.builtin && cardDraft.source ? (
            <span className={styles.sourceLine}>来源：{cardDraft.source}</span>
          ) : null}
        </div>
        <div className={styles.avatarEdit}>
          <span className={styles.avatarPreview} data-empty={avatarDraft ? undefined : ''}>
            {avatarDraft ? (
              <img src={avatarDraft} alt={`${cardDraft.name || '角色'}的头像`} />
            ) : (
              Array.from(cardDraft.name)[0] || '?'
            )}
          </span>
          <div className={styles.avatarCopy}>
            <strong>头像</strong>
            <small>选择图片后自动居中裁切为正方形并压缩至 256px，仅保存在本机；开启头像显示后同步用于聊天。</small>
          </div>
          <div className={styles.avatarButtons}>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={avatarBusy}
              onClick={() => avatarInput.current?.click()}
            >
              {avatarBusy ? '处理中…' : avatarDraft ? '更换图片' : '选择图片'}
            </button>
            {avatarDraft ? (
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => setAvatarDraft(null)}
              >
                移除
              </button>
            ) : null}
          </div>
          <input
            ref={avatarInput}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              void handleAvatarPick(file)
            }}
          />
        </div>
        <div className={styles.exampleRow}>
          <span>可载入示例模板：</span>
          {CARD_EXAMPLES.map((example) => (
            <button
              key={example.label}
              type="button"
              onClick={() => applyExample(example.label)}
            >
              {example.label}
            </button>
          ))}
        </div>
        <div className={styles.fieldGrid}>
          <label>
            <span>姓名 *</span>
            <input
              value={cardDraft.name}
              maxLength={30}
              placeholder="对话中使用的称呼"
              onChange={(event) => setCardDraft({ ...cardDraft, name: event.target.value })}
            />
          </label>
          <label>
            <span>身份</span>
            <input
              value={cardDraft.identity}
              maxLength={600}
              placeholder="职业、年龄、居住地、近期状态"
              onChange={(event) => setCardDraft({ ...cardDraft, identity: event.target.value })}
            />
          </label>
          <label>
            <span>与账户角色的关系</span>
            <input
              value={cardDraft.relationship}
              maxLength={400}
              placeholder="例如：邻居三年，关系尚未明确"
              onChange={(event) =>
                setCardDraft({ ...cardDraft, relationship: event.target.value })
              }
            />
          </label>
          <label>
            <span>说话风格</span>
            <input
              value={cardDraft.style}
              maxLength={400}
              placeholder="话量、语气强弱、用词习惯"
              onChange={(event) => setCardDraft({ ...cardDraft, style: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>小习惯</span>
            <input
              value={cardDraft.tics}
              maxLength={400}
              placeholder="例如：紧张时捏衣角，开口前先叹气"
              onChange={(event) => setCardDraft({ ...cardDraft, tics: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>开场白</span>
            <textarea
              rows={3}
              value={cardDraft.greeting}
              maxLength={800}
              placeholder="新对话开场白，可包含动作与环境描写；启用该卡时作为首条消息发送"
              onChange={(event) => setCardDraft({ ...cardDraft, greeting: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>补充设定</span>
            <textarea
              rows={4}
              value={cardDraft.notes}
              maxLength={1200}
              placeholder="禁忌话题、敏感事项、过往经历；当前剧情状态请写入下方场景"
              onChange={(event) => setCardDraft({ ...cardDraft, notes: event.target.value })}
            />
          </label>
          <label className={styles.wide}>
            <span>标签（可选）</span>
            <input
              value={tagDraft}
              maxLength={CHARACTER_TAG_MAX * (CHARACTER_TAG_LENGTH + 1)}
              placeholder="以逗号分隔，最多 6 个，例如：日常、兽耳、治愈"
              onChange={(event) => setTagDraft(event.target.value)}
            />
          </label>
        </div>
        <div className={styles.editorActions}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => {
              setCardDraft(null)
              setAvatarDraft(null)
              setTagDraft('')
            }}
          >
            取消
          </button>
          <button type="button" className={styles.primaryButton} onClick={saveCardDraft}>
            保存角色卡
          </button>
        </div>
      </div>
    )
  }

  const applyExample = (label: string) => {
    const example = CARD_EXAMPLES.find((item) => item.label === label)
    if (!example || !cardDraft) {
      return
    }
    setCardDraft({ ...cardDraft, ...example.card })
    showToast({ key: 'roleplayExampleApplied', params: { name: label } })
  }

  return (
    <div className={styles.panel}>
      <section className={styles.hero}>
        <div>
          <span className={styles.heroEyebrow}>角色设定</span>
          <h2>角色卡 · 世界书 · 场景</h2>
          <p>
            角色卡固定身份、关系与表达方式，可配置头像，由启用开关决定是否进入角色扮演；
            世界书保存地点、组织、既往事件等稳定设定，命中关键词时注入；场景记录当前时间、地点与人物状态。
            三层内容追加在手写提示词之后，不改写原文。
          </p>
        </div>
        <div className={styles.heroStats}>
          <span>
            角色卡 <b>{cards.length}</b>
          </span>
          <span>
            启用中 <b>{roleplayOn ? '1' : '0'}</b>
          </span>
          <span>
            世界书 <b>{enabledEntries}</b>
          </span>
          <span>
            场景 <b>{sceneCount}/5</b>
          </span>
        </div>
      </section>

      <div className={styles.tabs} role="tablist" aria-label="角色设定分区">
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === 'cards'}
          data-on={panelTab === 'cards' ? '' : undefined}
          onClick={() => setPanelTab('cards')}
        >
          角色卡 <b>{cards.length}</b>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === 'worldbook'}
          data-on={panelTab === 'worldbook' ? '' : undefined}
          onClick={() => setPanelTab('worldbook')}
        >
          世界书 <b>{enabledEntries}</b>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === 'scene'}
          data-on={panelTab === 'scene' ? '' : undefined}
          onClick={() => setPanelTab('scene')}
        >
          场景 <b>{sceneCount}/5</b>
        </button>
      </div>

      <section className={styles.section} hidden={panelTab !== 'cards'}>
        <header className={styles.sectionHead}>
          <div>
            <h3>角色卡</h3>
            <p>
              每张卡右侧为启用开关：开启后卡片设定与手写提示词共同注入，关闭后仅发送提示词。同一时间仅启用一张。
            </p>
          </div>
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={cardImporting}
              onClick={() => cardFileInput.current?.click()}
            >
              {cardImporting ? '导入中…' : '导入角色卡'}
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                setEntryDraft(null)
                setAvatarDraft(null)
                setTagDraft('')
                setCardDraft(emptyCard(characterName))
              }}
            >
              + 新建角色卡
            </button>
            <input
              ref={cardFileInput}
              hidden
              type="file"
              accept=".json,.png,application/json,image/png"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) {
                  void importCharacter(file)
                }
              }}
            />
          </div>
        </header>

        <div className={styles.formatHint}>
          <strong>支持格式</strong>
          <span>
            Character Card V2 / V3（JSON，或含 chara / ccv3 元数据的 PNG）、TavernAI 角色卡 JSON。
            随卡 character_book 会转为世界书并绑定该角色。缺少姓名或无法解析的文件会被拒绝，不会写入本地配置。
          </span>
        </div>

        <div className={styles.modeCard} data-on={roleplayOn}>
          <span className={styles.modeIcon} aria-hidden="true">
            {roleplayOn ? '扮' : activeCard ? '存' : '词'}
          </span>
          <div className={styles.modeMain}>
            <strong>
              {roleplayOn
                ? `角色扮演已开启 · ${activeCard?.name}`
                : activeCard
                  ? `角色扮演已关闭 · ${activeCard.name} 的卡已暂停`
                  : '角色扮演已关闭'}
            </strong>
            <p>
              {roleplayOn
                ? '每次请求会注入该卡设定与手写提示词，两者叠加生效。'
                : activeCard
                  ? '只发送手写提示词与手写角色名；卡的身份、关系、说话方式、世界书、场景和角色记忆都不进入请求。'
                  : '当前仅发送手写提示词，不注入角色设定；启用任一张卡即可恢复角色扮演。'}
            </p>
          </div>
          {activeCard ? (
            roleplayOn ? (
              <button type="button" className={styles.modeButton} onClick={() => closeRoleplay(activeCard)}>
                关闭角色扮演
              </button>
            ) : (
              <button type="button" className={styles.modeButton} onClick={() => setRoleplayEnabled(true)}>
                恢复角色扮演
              </button>
            )
          ) : (
            <span className={styles.modeHint}>启用开关位于角色卡</span>
          )}
        </div>

        {cards.length > 6 ? (
          <div className={styles.searchRow}>
            <input
              value={cardQuery}
              placeholder="按姓名、身份或关系搜索角色卡"
              aria-label="搜索角色卡"
              onChange={(event) => setCardQuery(event.target.value)}
            />
            {cardQuery ? (
              <button type="button" className={styles.linkButton} onClick={() => setCardQuery('')}>
                清空
              </button>
            ) : null}
            <span>{visibleCards.length} 张</span>
          </div>
        ) : null}

        {tagList.length > 0 ? (
          <div className={styles.tagRow} aria-label="按标签筛选角色卡">
            <button
              type="button"
              className={styles.tagChip}
              data-on={tagFilter === '' ? '' : undefined}
              onClick={() => setTagFilter('')}
            >
              全部 {cards.length}
            </button>
            {tagList.map(({ tag, count }) => (
              <button
                key={tag}
                type="button"
                className={styles.tagChip}
                data-on={tagFilter === tag ? '' : undefined}
                onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
              >
                {tag} {count}
              </button>
            ))}
          </div>
        ) : null}

        {isNewDraft ? renderCardEditor() : null}

        <div className={styles.cardList}>
          {visibleCards.map((card) => {
            const selected = card.id === activeCharacterId
            const active = selected && roleplayEnabled
            const editing = cardDraft?.id === card.id
            const filled = cardFieldCount(card)
            return (
              <article
                key={card.id}
                className={styles.cardRow}
                data-active={selected}
                data-editing={editing}
              >
                {editing ? (
                  <div className={styles.inlineEditor}>{renderCardEditor()}</div>
                ) : (
                  <>
                    <div className={styles.cardTop}>
                      <span
                        className={styles.cardAvatar}
                        data-photo={cardAvatars[card.id] ? '' : undefined}
                        aria-hidden="true"
                      >
                        {cardAvatars[card.id] ? (
                          <img src={cardAvatars[card.id]} alt="" />
                        ) : (
                          Array.from(card.name)[0] || '?'
                        )}
                      </span>
                      <div className={styles.cardHeading}>
                        <div className={styles.cardTitle}>
                          <strong>{card.name}</strong>
                          {selected ? (
                            <span className={styles.activeTag}>{active ? '已启用' : '未启用'}</span>
                          ) : null}
                          {card.builtin ? <span className={styles.builtinTag}>内置</span> : null}
                        </div>
                        <small>
                          {active
                            ? '当前对话主角色'
                            : selected
                              ? '角色扮演关闭，人物设定仍生效'
                              : card.builtin
                                ? '内置角色卡，可直接编辑'
                                : `${formatDate(card.updatedAt)} 更新`}
                        </small>
                      </div>
                    </div>
                    <div className={styles.cardMain}>
                      <p>{card.identity || card.relationship || '未填写身份'}</p>
                      {card.greeting ? (
                        <blockquote className={styles.cardQuote}>
                          “{card.greeting.slice(0, 72)}
                          {card.greeting.length > 72 ? '…' : ''}”
                        </blockquote>
                      ) : card.style ? (
                        <p className={styles.cardStyle}>{card.style}</p>
                      ) : null}
                      {card.tags.length > 0 ? (
                        <div className={styles.cardTags}>
                          {card.tags.slice(0, 3).map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                          {card.tags.length > 3 ? <span>+{card.tags.length - 3}</span> : null}
                        </div>
                      ) : null}
                      <div className={styles.cardMeta}>
                        <span className={styles.cardMeter}>
                          <i style={{ width: `${(filled / CARD_FIELD_TOTAL) * 100}%` }} />
                          <em>
                            {filled}/{CARD_FIELD_TOTAL} 项
                          </em>
                        </span>
                        {card.greeting ? <span className={styles.cardFlag}>开场白</span> : null}
                        {cardAvatars[card.id] ? (
                          <span className={styles.cardFlag}>头像</span>
                        ) : null}
                      </div>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={active}
                          aria-label={
                            active
                              ? `关闭「${card.name}」的角色扮演`
                              : selected
                                ? `恢复「${card.name}」的角色扮演`
                                : `启用「${card.name}」的角色扮演`
                          }
                          className={styles.cardSwitch}
                          data-on={active}
                          onClick={() => {
                            if (active) {
                              closeRoleplay(card)
                            } else if (selected) {
                              setRoleplayEnabled(true)
                            } else {
                              useCard(card)
                            }
                          }}
                        >
                          <i />
                          <span>{active ? '已启用' : selected ? '仅人设' : '启用'}</span>
                        </button>
                        <button type="button" onClick={() => startEditCard(card)}>
                          编辑
                        </button>
                        <button type="button" onClick={() => duplicateCard(card)}>
                          复制
                        </button>
                        <button
                          type="button"
                          className={styles.dangerText}
                          onClick={() => setConfirm({ kind: 'card', id: card.id, name: card.name })}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </article>
            )
          })}
          {cards.length > 0 && visibleCards.length === 0 ? (
            <div className={styles.emptyLine}>未找到匹配「{cardQuery}」的角色卡。</div>
          ) : null}
          {cards.length === 0 && !cardDraft ? (
            <div className={styles.emptyLine}>
              尚无角色卡。新建角色卡并分别填写姓名、身份、关系与表达方式，可减少长对话中的角色偏移。
            </div>
          ) : null}
        </div>
        <div className={styles.sectionFootRow}>
          <p className={styles.sectionFoot}>
            最多保存 {CHARACTER_CARD_MAX} 张，同一时间仅保留一张启用卡。关闭角色扮演后卡设定完全暂停，只发送手写提示词与手写角色名；世界书、场景与角色记忆也不注入。
          </p>
          <button type="button" className={styles.ghostButton} onClick={restoreBuiltinCards}>
            恢复内置角色卡（{BUILTIN_CHARACTER_CARD_TOTAL}）
          </button>
        </div>
      </section>

      <section className={styles.section} hidden={panelTab !== 'worldbook'}>
        <header className={styles.sectionHead}>
          <div>
            <h3>世界书</h3>
            <p>
              世界书条目仅在关键词命中时注入；标记「每轮注入」的条目每轮都会发送。
              支持本应用设定存档、SillyTavern world info（entries 数组或对象键值）与 Character Card V2 / V3 的 character_book；不支持私有数据库或未公开的二进制格式。
            </p>
          </div>
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={worldbook.length === 0}
              onClick={() => void exportWorldbook()}
            >
              导出世界书
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => entryFileInput.current?.click()}
            >
              导入世界书
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                setCardDraft(null)
                setAvatarDraft(null)
                setKeywordDraft('')
                setEntryDraft({ ...emptyEntry(), cardId: activeCharacterId ?? '' })
              }}
            >
              + 新建条目
            </button>
            <input
              ref={entryFileInput}
              hidden
              type="file"
              accept=".json,.png,application/json,image/png"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) {
                  void importWorldbook(file)
                }
              }}
            />
          </div>
        </header>

        <div className={styles.hitLine}>
          <span>
            每轮注入 <b>{alwaysEntries}</b> 条 · 已启用 <b>{enabledEntries}</b> 条
          </span>
          <span>
            {lastUserText
              ? `按最近一条输入计算，将注入 ${hitEntries.length} 条`
              : '发送消息后显示匹配条数'}
          </span>
        </div>

        {!worldbookInject ? (
          <div className={styles.injectOff}>
            世界书注入已关闭：条目与预算保留，但不会拼进请求。可在「设置 → Token 与费用」重新开启。
          </div>
        ) : null}

        <div className={styles.budgetCard}>
          <div className={styles.budgetHead}>
            <div>
              <strong>注入字符预算</strong>
              <span>标题与正文合计上限，按命中优先级占用</span>
            </div>
            <b>{worldbookChars.toLocaleString('zh-CN')} 字</b>
          </div>
          <div className={styles.budgetPresets} aria-label="世界书注入预算预设">
            {[1000, 2000, 4000, 8000].map((preset) => (
              <button
                key={preset}
                type="button"
                data-on={worldbookChars === preset ? '' : undefined}
                onClick={() => applyBudget(preset)}
              >
                {preset.toLocaleString('zh-CN')}
              </button>
            ))}
          </div>
          <label className={styles.budgetCustom}>
            <span>自定义</span>
            <input
              type="number"
              inputMode="numeric"
              min={WORLDBOOK_BUDGET_MIN}
              max={WORLDBOOK_BUDGET_MAX}
              step={100}
              value={budgetDraft}
              aria-label="世界书注入字符预算"
              onChange={(event) => setBudgetDraft(event.target.value.replace(/[^0-9]/g, ''))}
              onBlur={() => {
                const value = Number(budgetDraft)
                if (!Number.isFinite(value) || value <= 0) {
                  setBudgetDraft(String(worldbookChars))
                  return
                }
                applyBudget(value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
              }}
            />
            <em>字</em>
          </label>
          <p>
            默认 {WORLDBOOK_BUDGET_DEFAULT.toLocaleString('zh-CN')} 字，范围
            {' '}{WORLDBOOK_BUDGET_MIN.toLocaleString('zh-CN')}–{WORLDBOOK_BUDGET_MAX.toLocaleString('zh-CN')}。
            预算过高会挤占对话上下文，请按模型窗口和实际条目长度调整；未命中条目不计入。
          </p>
        </div>

        {entryDraft ? (
          <div className={styles.editor}>
            <div className={styles.editorHead}>
              <strong>
                {worldbook.some((entry) => entry.id === entryDraft.id) ? '编辑条目' : '新建条目'}
              </strong>
              <span>关键词以逗号分隔；命中任意一个时注入该条目。</span>
            </div>
            <div className={styles.fieldGrid}>
              <label>
                <span>标题 *</span>
                <input
                  value={entryDraft.title}
                  maxLength={60}
                  placeholder="例如：夜班便利店"
                  onChange={(event) =>
                    setEntryDraft({ ...entryDraft, title: event.target.value })
                  }
                />
              </label>
              <label>
                <span>{entryDraft.match === 'regex' ? '正则' : '关键词'}</span>
                <input
                  value={keywordDraft}
                  placeholder={
                    entryDraft.match === 'regex'
                      ? '便利(店|铺)，夜\\s*班'
                      : '便利店，夜班，热牛奶'
                  }
                  onChange={(event) => setKeywordDraft(event.target.value)}
                />
              </label>
              <label className={styles.wide}>
                <span>匹配方式</span>
                <div className={styles.toggleRow}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={entryDraft.match === 'keyword'}
                    className={styles.toggle}
                    data-on={entryDraft.match === 'keyword'}
                    onClick={() => setEntryDraft({ ...entryDraft, match: 'keyword' })}
                  >
                    关键词包含
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={entryDraft.match === 'regex'}
                    className={styles.toggle}
                    data-on={entryDraft.match === 'regex'}
                    onClick={() => setEntryDraft({ ...entryDraft, match: 'regex' })}
                  >
                    正则表达式
                  </button>
                </div>
              </label>
              <label className={styles.wide}>
                <span>生效范围</span>
                <div className={styles.toggleRow}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!entryDraft.cardId}
                    className={styles.toggle}
                    data-on={!entryDraft.cardId}
                    onClick={() => setEntryDraft({ ...entryDraft, cardId: '' })}
                  >
                    所有角色
                  </button>
                  {cards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      role="switch"
                      aria-checked={entryDraft.cardId === card.id}
                      className={styles.toggle}
                      data-on={entryDraft.cardId === card.id}
                      onClick={() => setEntryDraft({ ...entryDraft, cardId: card.id })}
                    >
                      {card.name}
                    </button>
                  ))}
                </div>
              </label>
              <label className={styles.wide}>
                <span>权重（0–100）</span>
                <div className={styles.toggleRow}>
                  <input
                    className={styles.weightInput}
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={entryDraft.weight}
                    aria-label="世界书权重"
                    onChange={(event) =>
                      setEntryDraft({
                        ...entryDraft,
                        weight: Number(event.target.value),
                      })
                    }
                  />
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => setEntryDraft({ ...entryDraft, weight: 70 })}
                  >
                    常用背景 70
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => setEntryDraft({ ...entryDraft, weight: 30 })}
                  >
                    细节补充 30
                  </button>
                </div>
              </label>
              <label className={styles.wide}>
                <span>插入位置</span>
                <div className={styles.toggleRow}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={entryDraft.position === 'context'}
                    className={styles.toggle}
                    data-on={entryDraft.position === 'context'}
                    onClick={() => setEntryDraft({ ...entryDraft, position: 'context' })}
                  >
                    人物设定之前
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={entryDraft.position === 'tail'}
                    className={styles.toggle}
                    data-on={entryDraft.position === 'tail'}
                    onClick={() => setEntryDraft({ ...entryDraft, position: 'tail' })}
                  >
                    提示词之后
                  </button>
                </div>
              </label>
              <label className={styles.wide}>
                <span>设定内容 *</span>
                <textarea
                  rows={5}
                  value={entryDraft.content}
                  maxLength={1500}
                  placeholder="记录稳定设定：地点环境、人物关系、规则与既往事件；随剧情变化的状态请写入场景。"
                  onChange={(event) =>
                    setEntryDraft({ ...entryDraft, content: event.target.value })
                  }
                />
              </label>
            </div>
            <div className={styles.toggleRow}>
              <button
                type="button"
                role="switch"
                aria-checked={entryDraft.enabled}
                className={styles.toggle}
                data-on={entryDraft.enabled}
                onClick={() =>
                  setEntryDraft({ ...entryDraft, enabled: !entryDraft.enabled })
                }
              >
                {entryDraft.enabled ? '已启用' : '已停用'}
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={entryDraft.always}
                className={styles.toggle}
                data-on={entryDraft.always}
                onClick={() => setEntryDraft({ ...entryDraft, always: !entryDraft.always })}
              >
                {entryDraft.always ? '每轮注入' : '命中注入'}
              </button>
            </div>
            <div className={styles.editorActions}>
              <button type="button" className={styles.ghostButton} onClick={() => setEntryDraft(null)}>
                取消
              </button>
              <button type="button" className={styles.primaryButton} onClick={saveEntryDraft}>
                保存条目
              </button>
            </div>
          </div>
        ) : null}

        <div className={styles.listSearch}>
          <input
            value={entryQuery}
            onChange={(event) => setEntryQuery(event.target.value)}
            placeholder="搜索标题、关键词或正文"
            aria-label="搜索世界书条目"
          />
          {entryQuery.trim() ? (
            <button type="button" onClick={() => setEntryQuery('')} aria-label="清除搜索">
              清除
            </button>
          ) : null}
        </div>

        <div className={styles.list}>
          {filteredEntries.map((entry) => (
            <article key={entry.id} className={styles.entryRow} data-off={!entry.enabled}>
              <div className={styles.entryHead}>
                <div>
                  <strong>{entry.title}</strong>
                  {entry.match === 'regex' ? (
                    <span className={styles.constantTag}>正则</span>
                  ) : null}
                  {entry.cardId ? (
                    <span className={styles.constantTag}>
                      仅 {cards.find((card) => card.id === entry.cardId)?.name ?? '已删除的卡'}
                    </span>
                  ) : null}
                  {entry.always ? <span className={styles.constantTag}>每轮注入</span> : null}
                  {entry.position === 'tail' ? (
                    <span className={styles.constantTag}>靠后</span>
                  ) : null}
                  {entry.weight !== WORLDBOOK_WEIGHT_DEFAULT ? (
                    <span className={styles.constantTag}>权重 {entry.weight}</span>
                  ) : null}
                  {!entry.enabled ? <span className={styles.offTag}>已停用</span> : null}
                </div>
                <div className={styles.rowActions}>
                  <button type="button" onClick={() => startEditEntry(entry)}>
                    编辑
                  </button>
                  <button
                    type="button"
                    className={styles.dangerText}
                    onClick={() =>
                      setConfirm({ kind: 'entry', id: entry.id, name: entry.title })
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
              <p>{entry.content}</p>
              <div className={styles.keywords}>
                {entry.keywords.length > 0
                  ? entry.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)
                  : <span className={styles.mutedChip}>未设置关键词，仅在「每轮注入」开启时生效</span>}
              </div>
            </article>
          ))}
          {entryNeedle && filteredEntries.length === 0 && worldbook.length > 0 ? (
            <div className={styles.emptyLine}>
              未找到匹配「{entryQuery.trim()}」的条目，请调整关键词或清除搜索。
            </div>
          ) : null}
          {worldbook.length === 0 && !entryDraft ? (
            <div className={styles.emptyLine}>
              尚未添加世界书条目。可录入地点、组织、人物关系等稳定背景；关键词命中时才注入，未命中不占用上下文。
            </div>
          ) : null}
        </div>
      </section>

      <section className={styles.section} hidden={panelTab !== 'scene'}>
        <header className={styles.sectionHead}>
          <div>
            <h3>当前场景</h3>
            <p>记录当前地点、时间、人物状态与关系。场景变化后可手动修改，或开启自动更新由模型在每轮后重写；角色扮演关闭时只保留记录，不进入请求，自动更新也会暂停。</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sceneAutoUpdate}
            className={styles.autoToggle}
            data-on={sceneAutoUpdate}
            onClick={() => setSceneAutoUpdate(!sceneAutoUpdate)}
          >
            <i />
            <span>{sceneAutoUpdate ? '自动更新：开' : '自动更新：关'}</span>
          </button>
        </header>

        <div className={styles.notice} data-warn={sceneAutoUpdate}>
          {sceneAutoUpdate
            ? '开启后，每轮回复结束会额外发送一次摘要请求，由模型更新地点、时间与心情；会产生额外 Token 消耗，请求失败时保留原场景，不影响对话。'
            : '关闭时仅在手动编辑后更新，不产生额外请求。'}
        </div>

        <div className={styles.sceneGrid}>
          {SCENE_FIELDS.map((field) => (
            <label key={field.key} className={field.key === 'mood' || field.key === 'relationship' ? styles.wide : ''}>
              <span>{field.label}</span>
              <input
                value={sceneDraft[field.key]}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setSceneDraft({ ...sceneDraft, [field.key]: event.target.value })
                }
                onBlur={(event) => {
                  if (event.target.value !== scene[field.key]) {
                    setSceneField(field.key as SceneField, event.target.value)
                  }
                }}
              />
            </label>
          ))}
        </div>

        <div className={styles.sceneFooter}>
          <span>{scene.updatedAt ? `${formatDate(scene.updatedAt)} 更新` : '尚未填写'}</span>
          <button
            type="button"
            className={styles.ghostButton}
            disabled={!sceneHasContent(scene)}
            onClick={() => {
              clearScene()
              setSceneDraft({ ...useSettings.getState().scene })
              showToast({ key: 'roleplaySceneCleared' })
            }}
          >
            清空场景
          </button>
        </div>
      </section>

      <p className={styles.footerNote}>
        角色卡、世界书与场景只保存在本机，对话导出包不包含这三类设定。角色扮演关闭时，
        世界书与场景暂停注入但不会删除；单轮最多注入 6 条世界书，当前预算 {worldbookChars.toLocaleString('zh-CN')} 字；
        超出后按命中次数与权重排序取前面的条目，避免背景设定挤占对话上下文。
      </p>

      {confirm ? (
        <div className={styles.confirmOverlay} onClick={() => setConfirm(null)}>
          <div className={styles.confirmCard} onClick={(event) => event.stopPropagation()}>
            <strong>删除「{confirm.name}」？</strong>
            <p>
              {confirm.kind === 'card'
                ? '只删这张卡。手写的提示词和以前的对话都不动。'
                : '只删这条背景。已经聊过的消息不会变。'}
            </p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.ghostButton} onClick={() => setConfirm(null)}>
                取消
              </button>
              <button type="button" className={styles.dangerButton} onClick={doDelete}>
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
