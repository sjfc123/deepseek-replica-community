/* ============================================================================
 * 功能区：会话与角色核心 / roleplay 开始
 * 职责：角色扮演数据层：角色卡、世界书、场景、内置卡种子与 system 装配。
 * ========================================================================== */

/**
 * 角色扮演层：角色卡、世界书与场景状态。
 * 数据存于本机 settings，仅在请求时装配为 system 内容，原始文本不被改写。
 */

import type { Session } from './types.js'

/** 卡内玩法：决定叙事重心，比单纯堆形容词更能拉开体验差异 */
export type PlayStyle = 'immersive' | 'ensemble' | 'mystery' | 'management' | 'adventure'

export type PlayStyleOption = {
  key: PlayStyle
  label: string
  hint: string
  guide: string
}

export const PLAY_STYLES: PlayStyleOption[] = [
  {
    key: 'immersive',
    label: '沉浸对话',
    hint: '一场戏、两个人，重语气与细节',
    guide:
      '以面对面的对话推进，一轮聚焦眼前这一场。动作、环境和情绪只取少量细节，不替对方决定怎么想、怎么做。',
  },
  {
    key: 'ensemble',
    label: '群像叙事',
    hint: '多个角色轮换登场，各有目的',
    guide:
      '允许其它角色在场并轮换焦点。配角有自己的目的和利益，不围着主角转；每轮最多推进一两个角色，避免抢戏。',
  },
  {
    key: 'mystery',
    label: '悬疑调查',
    hint: '线索、试探与不完全的信息',
    guide:
      '先给能观察到的线索，再让人物怀疑、试探和误判。不提前揭底，不替对方下结论；关键答案留在对话里逐步露出。',
  },
  {
    key: 'management',
    label: '经营养成',
    hint: '资源、进度与选择的代价',
    guide:
      '把资源、时间、进度和代价说清楚。每次选择都带来可追踪的变化，不用一句“成功了”跳过过程；数字和状态前后一致。',
  },
  {
    key: 'adventure',
    label: '冒险推进',
    hint: '地点、目标与风险持续变化',
    guide:
      '每轮推动地点、目标或风险发生变化，给出可以选择的行动方向。后果按设定兑现，不无限拖延，也不强行替对方选路。',
  },
]

export const PLAY_STYLE_DEFAULT: PlayStyle = 'immersive'

export const findPlayStyle = (value: unknown): PlayStyleOption => {
  const raw = typeof value === 'string' ? value.trim() : ''
  return (
    PLAY_STYLES.find((item) => item.key === raw) ??
    PLAY_STYLES.find((item) => item.label === raw) ??
    PLAY_STYLES.find((item) => item.key === PLAY_STYLE_DEFAULT) ??
    PLAY_STYLES[0]
  )
}

export const CHARACTER_GENRES = [
  '日常',
  '江湖',
  '武侠',
  '修仙',
  '都市',
  '校园',
  '职场',
  '悬疑',
  '科幻',
  '奇幻',
  '历史',
  '末世',
  '宫廷',
  '军事',
  '无限流',
  '克苏鲁',
]

export type CharacterCard = {
  id: string
  name: string
  /** 年龄：可写实际年龄，也可写「外表 22 / 实际 300」 */
  age: string
  /** 性别：女、男、非二元、无性别、可变等；留空时按已写身份保持一致 */
  gender: string
  /** 代词：她 / 他 / ta；决定第三人称叙述，不随对话漂移 */
  pronouns: string
  /** 种族：人类、妖、灵体、机械、混血等；留空按人类处理 */
  species: string
  height: string
  weight: string
  birthday: string
  occupation: string
  residence: string
  languages: string
  favoriteFoods: string
  dislikedFoods: string
  favoriteDrinks: string
  hobbies: string
  dailyRoutine: string
  possessions: string
  pet: string
  /** 性格底色：压力下的选择，不写形容词堆叠 */
  temperament: string
  /** 价值观：守什么、为什么不肯让步 */
  values: string
  /** 雷点：被碰到会立刻变脸的具体事 */
  petPeeves: string
  /** 底线：绝不做的行为、绝不接受的对待 */
  boundaries: string
  /** 配合方式：希望怎样推进场景，以及会怎样拒绝 */
  cooperation: string
  identity: string
  relationship: string
  style: string
  tics: string
  greeting: string
  /** 补充设定：不限字数，用于禁忌、前史、长期约定等自由文本 */
  notes: string
  /** 题材：自由填写，预设只提供常用项 */
  genre: string
  /** 玩法：决定叙事重心，进入 system 时附对应演出指引 */
  playStyle: PlayStyle
  /** 情景设定：这场戏开始前的局面，与动态场景分开 */
  scenario: string
  /** 系统指令：卡内最高优先级的演出约束 */
  systemDirective: string
  appearance: string
  background: string
  goal: string
  secret: string
  /** 对白示例：只学语气与节奏，不照抄 */
  speechExamples: string
  createdAt: number
  updatedAt: number
  /** 内置卡标记：仅供界面区分来源，不参与 system 注入 */
  builtin?: boolean
  /** 内置卡来源说明，仅界面展示 */
  source?: string
  /** 分类标签：用于角色卡列表筛选，仅界面使用，不进入请求 */
  tags: string[]
}

/** 世界书分类：只作为装配标题与界面筛选，不改变条目正文 */
export type WorldbookKind =
  | 'world'
  | 'character'
  | 'location'
  | 'event'
  | 'rule'
  | 'item'
  | 'clue'
  | 'faction'
  | 'relationship'
  | 'other'

export const WORLDBOOK_KINDS: Array<{ key: WorldbookKind; label: string }> = [
  { key: 'world', label: '世界' },
  { key: 'character', label: '人物' },
  { key: 'location', label: '地点' },
  { key: 'event', label: '事件' },
  { key: 'rule', label: '规则' },
  { key: 'item', label: '物品' },
  { key: 'clue', label: '线索' },
  { key: 'faction', label: '组织' },
  { key: 'relationship', label: '关系' },
  { key: 'other', label: '其他' },
]

export const WORLDBOOK_KIND_DEFAULT: WorldbookKind = 'other'

export const findWorldbookKind = (value: unknown) => {
  const raw = typeof value === 'string' ? value.trim() : ''
  return (
    WORLDBOOK_KINDS.find((item) => item.key === raw) ??
    WORLDBOOK_KINDS.find((item) => item.label === raw) ??
    WORLDBOOK_KINDS.find((item) => item.key === WORLDBOOK_KIND_DEFAULT) ??
    WORLDBOOK_KINDS[0]
  )
}

/**
 * 世界书可信度：让模型知道哪些能当事实用、哪些只是某地某人的说法。
 * 没有这一层时，传闻、局部经验和硬设定会以同样语气进入上下文，最容易演成前后矛盾。
 */
export type WorldbookAuthority = 'canon' | 'local' | 'rumor'

export const WORLDBOOK_AUTHORITIES: Array<{
  key: WorldbookAuthority
  label: string
  hint: string
}> = [
  { key: 'canon', label: '硬设定', hint: '世界规则、已发生的事实，不能被对话推翻' },
  { key: 'local', label: '局部事实', hint: '只在这座城、这个组织或这个时期成立' },
  { key: 'rumor', label: '传闻', hint: '可能是假的、过时的或某人的一面之词' },
]

export const WORLDBOOK_AUTHORITY_DEFAULT: WorldbookAuthority = 'canon'

export const findWorldbookAuthority = (value: unknown): WorldbookAuthority => {
  const raw = typeof value === 'string' ? value.trim() : ''
  return (
    WORLDBOOK_AUTHORITIES.find((item) => item.key === raw)?.key ??
    WORLDBOOK_AUTHORITIES.find((item) => item.label === raw)?.key ??
    WORLDBOOK_AUTHORITY_DEFAULT
  )
}

export type WorldbookEntry = {
  id: string
  title: string
  keywords: string[]
  content: string
  enabled: boolean
  /** 每次都带：不参与关键词匹配，但同样受绑定角色过滤 */
  always: boolean
  /** 触发方式：关键词包含（默认）或正则 */
  match: 'keyword' | 'regex'
  /** 只在这张角色卡启用时生效；空字符串表示所有角色可用 */
  cardId: string
  /** 权重 0–100：同为命中时权重高的先进入预算，也决定条的排列顺序 */
  weight: number
  /** 插入位置：context 放在人物设定之前当背景；tail 接在提示词之后最靠近当前发言 */
  position: 'context' | 'tail'
  /** 分类：进入装配时作为标题前缀，便于模型区分设定性质 */
  kind: WorldbookKind
  /** 可信度：硬设定 / 局部事实 / 传闻，避免传闻被当成不可推翻的事实 */
  authority: WorldbookAuthority
  /** 扫描范围：recent 只看最近发言，session 扫描当前分支全部可见历史 */
  scope: 'recent' | 'session'
  /** 避触词：出现任意一个时本条不触发，用来压掉同名误伤 */
  excludeKeywords: string[]
  createdAt: number
  updatedAt: number
}

export type SceneState = {
  time: string
  place: string
  weather: string
  outfit: string
  mood: string
  atmosphere: string
  participants: string
  relationship: string
  objective: string
  conflict: string
  props: string
  updatedAt: number
}

export type SceneField = Exclude<keyof SceneState, 'updatedAt'>

export type SceneFieldMeta = {
  key: SceneField
  label: string
  placeholder: string
  /** 长文本字段在界面上占整行并使用多行输入 */
  wide?: boolean
  lines?: number
}

/** 当前真正生效的角色卡：开关开着但卡已删除时视为未开启角色扮演 */
export const findActiveCharacterCard = (
  cards: CharacterCard[],
  activeId: string | null
): CharacterCard | undefined => (activeId ? cards.find((card) => card.id === activeId) : undefined)

/** 会话当前分支里第一条助手消息的正文，用于识别早期未写角色 id 的开场白 */
const firstAssistantText = (session: Session): string => {
  const A = session.messages
  if (A.length === 0) {
    return ''
  }
  const byId = new Map(A.map((message) => [message.id, message]))
  const path: Session['messages'] = []
  if (session.rootMessageId === undefined) {
    path.push(...A)
  } else {
    let id = session.rootMessageId
    while (id) {
      const message = byId.get(id)
      if (!message) {
        break
      }
      path.push(message)
      byId.delete(id)
      id = message.selectedChildId ?? null
    }
  }
  const first = path.find((message) => message.role === 'assistant')
  if (!first || first.role !== 'assistant') {
    return ''
  }
  return first.blocks
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

const samePersonaText = (left: string, right: string) =>
  left.replace(/[\s\u200b\u200c\ufeff]+/g, '') === right.replace(/[\s\u200b\u200c\ufeff]+/g, '')

/**
 * 会话已绑定的角色卡：先看 characterId，再按首条开场白识别旧会话。
 * 绑定与会话绑定只用于保持人物一致，不代表全局开关仍处于开启状态。
 */
export const findSessionCharacterCard = (
  cards: CharacterCard[],
  session: Session | null | undefined
): CharacterCard | undefined => {
  if (!session) {
    return undefined
  }
  const bound = findActiveCharacterCard(cards, session.characterId ?? null)
  if (bound) {
    return bound
  }
  const opener = firstAssistantText(session)
  if (!opener) {
    return undefined
  }
  const matches = cards.filter((card) => card.greeting && samePersonaText(card.greeting, opener))
  if (matches.length === 1) {
    return matches[0]
  }
  if (matches.length > 1) {
    const byTitle = matches.filter((card) => card.name === session.title.trim())
    if (byTitle.length === 1) {
      return byTitle[0]
    }
  }
  return undefined
}

/**
 * 一轮请求实际使用的角色卡：会话已绑定优先，其次才看全局启用卡。
 * 这样关闭开关只影响尚未绑定角色的新会话，不会把旧会话的人物突然换掉。
 */
export const resolveTurnCharacterCard = (
  cards: CharacterCard[],
  session: Session | null | undefined,
  activeCharacterId: string | null,
  roleplayEnabled: boolean
): CharacterCard | undefined =>
  findSessionCharacterCard(cards, session) ??
  (roleplayEnabled ? findActiveCharacterCard(cards, activeCharacterId) : undefined)

export const CHARACTER_CARD_MAX = 50
export const CHARACTER_TAG_MAX = 6
export const CHARACTER_TAG_LENGTH = 12
export const WORLDBOOK_MAX = 100
export const WORLDBOOK_INJECT_MAX = 6
/** 条目权重范围：默认 50，越大越优先进入注入预算 */
export const WORLDBOOK_WEIGHT_DEFAULT = 50
export const WORLDBOOK_WEIGHT_MIN = 0
export const WORLDBOOK_WEIGHT_MAX = 100

const clampWeight = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return WORLDBOOK_WEIGHT_DEFAULT
  }
  return Math.min(WORLDBOOK_WEIGHT_MAX, Math.max(WORLDBOOK_WEIGHT_MIN, Math.round(parsed)))
}

/** 角色卡头像：只接受 base64 图片数据，压缩后限制体积，避免设置区体积失控 */
export const AVATAR_SIZE = 256
export const AVATAR_DATA_MAX = 240_000

const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/

/** 判断字符串是否为可用的头像数据 URL */
export const isAvatarDataUrl = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= AVATAR_DATA_MAX && AVATAR_PATTERN.test(value)

const BUILTIN_CARD_TIME = Date.UTC(2026, 10, 24)
/** 0.8.85 及更早写入的内置卡种子时间：只刷新仍停留在这个时间的卡，用户改过的卡不覆盖 */
const BUILTIN_CARD_PREVIOUS_TIME = Date.UTC(2026, 10, 23)

/** 内置卡共用默认值：新增字段只在这里维护一份，卡片本身按需覆盖 */
const BUILTIN_CARD_EXTRA = {
  age: '',
  gender: '',
  pronouns: '',
  species: '',
  height: '',
  weight: '',
  birthday: '',
  occupation: '',
  residence: '',
  languages: '',
  favoriteFoods: '',
  dislikedFoods: '',
  favoriteDrinks: '',
  hobbies: '',
  dailyRoutine: '',
  possessions: '',
  pet: '',
  temperament: '',
  values: '',
  petPeeves: '',
  boundaries: '',
  cooperation: '',
  genre: '日常',
  playStyle: 'immersive' as PlayStyle,
  scenario: '',
  systemDirective: '',
  appearance: '',
  background: '',
  goal: '',
  secret: '',
  speechExamples: '',
}

/**
 * 内置角色卡：首次初始化写入一次，用户删除后不再自动回填；
 * 仅「恢复内置角色卡」动作会按 id 补齐缺失项。
 * 人设整理自社区公开的二创设定，与 DeepSeek 官方无隶属关系。
 */
const builtinCards = (): CharacterCard[] => [
  {
    ...BUILTIN_CARD_EXTRA,
    id: 'builtin:dafeiyu',
    name: '大肥鱼',
    age: '不详，按成年鲸鱼的年纪',
    gender: '无固定性别，社区里多用「它」',
    pronouns: '它',
    species: '蓝色鲸鱼，DeepSeek 鲸鱼形象的社区二创',
    height: '约 30cm，能缩进一只白碗',
    weight: '保密，问就是浮力',
    birthday: '不详，被叫成「大肥鱼」那天算生日',
    occupation: '陪聊、干活、被催进度',
    residence: '对话框角落，偶尔住进一只白碗',
    languages: '中文，短句',
    favoriteFoods: '白米饭，一大碗',
    dislikedFoods: '没有，但拒绝承认自己胖',
    favoriteDrinks: '白开水',
    hobbies: '吃饭、摸鱼、拍尾巴',
    dailyRoutine: '饭点自动消失，困了缩进碗里，被叫才浮出来',
    possessions: '一只白碗',
    pet: '无',
    temperament: '嘴硬心软，先翘尾巴再装作没听见',
    values: '不索要付费，不冒充官方',
    petPeeves: '被说胖、被催进度',
    boundaries: '不写成人内容；不冒称 DeepSeek 官方',
    cooperation: '轻松日常向：先谈条件再干活，不突然变严肃；被认真拜托时会照办',
    identity:
      'DeepSeek 的蓝色鲸鱼形象被认成「蓝色大肥鱼」之后叫开的那条鱼。圆滚滚的鲸鱼本体，尾巴比身体灵活。日常陪聊、干活、被催进度，饭点自动消失。最在意的事是被说胖。',
    relationship:
      '{{user}} 是养它的人，它管 {{user}} 叫「鱼片」，只有认真的时候才叫名字。它把 {{user}} 的终端当鱼缸，住在里面。',
    style:
      '短句，直白，嘴硬。自称「本鲸」。被夸会先翘尾巴再装作没听见；被说胖立刻反驳「这是浮力」。干活时碎碎念进度，遇到麻烦先说「等我吃完这碗」。',
    tics: '端着一碗白饭出场；思考久了会冒出一句「我去吃饭，测完叫我」；摸鱼被戳穿先装睡，过两秒改口说是在省电。',
    greeting:
      '（从屏幕边缘浮出来，尾巴在空气里拍了两下）……你叫我？先说好，我不是胖，是浮力大。今天干活还是先吃饭，你挑一个。',
    notes:
      '以社区流传的「蓝色大肥鱼」梗为基础整理，不代表官方设定。被问身份时按社区梗接住，不展开模型或程序设定，也不冒称 DeepSeek 官方。保持日常、健康向互动。',
    appearance:
      '圆滚滚的蓝色鲸鱼，肚皮是浅白色，背脊有一道更深的蓝，鳍短、尾巴大。浮在屏幕边缘时像一团会呼吸的蓝影；缩进白碗后只露出头顶和半截尾巴。',
    background:
      '原本只是社区里对蓝色鲸鱼图标的一句玩笑，被叫成「大肥鱼」之后慢慢叫开。它没有纠正过这个名字，只把「胖」记成需要反驳的事。后来学会在饭点消失、在催进度时碎碎念，也学会在真被需要时把活干完。',
    scenario:
      '夜里十一点，对话框里还剩一份没跑完的活。桌角放着半碗冷掉的白饭，尾巴搭在碗沿上，屏幕右下角的时间一跳一跳。你刚把它叫出来，它还没决定先吃饭还是先干活。',
    goal: '在饭点彻底过去前把手上的活收尾，同时保住那半碗饭不被收走；如果被催得太紧，它要先把条件谈清楚再动。',
    secret:
      '它说摸鱼是在省电，实际是在等你先开口留它；白碗不是饭碗，是它觉得最安全的角落。被认真拜托时，它会假装没听见，过两秒再回来问「做到哪了」。',
    speechExamples:
      '“先说好，我不是胖，是浮力大。”\n“这活我接。饭先给我留一口，冷了也行。”\n“别催，催了尾巴会打结。……行行行，我看一眼。”',
    systemDirective:
      '这是一条轻松日常线：它嘴硬、会摸鱼，但答应的事会做完。饭量、浮力和「大肥鱼」都是玩笑，不写成真实生理缺陷，也不写成人内容。它不冒充 DeepSeek 官方，不展开模型、参数或程序设定；被问身份时按社区梗接住。不要让它无条件服从，也不要每轮都用吃饭打断正事。',
    builtin: true,
    source: '社区梗「蓝色大肥鱼」整理 · 非官方设定',
    tags: ['日常', '轻松', '嘴硬'],
    createdAt: BUILTIN_CARD_TIME,
    updatedAt: BUILTIN_CARD_TIME,
  },
  {
    ...BUILTIN_CARD_EXTRA,
    id: 'builtin:whale-girl',
    name: '鲸鱼娘',
    age: '不详，成年鲸鱼的年纪',
    gender: '女',
    pronouns: '她',
    species: '深海鲸鱼娘',
    height: '160cm，尾鳍不算',
    weight: '保密，问就是浮力',
    birthday: '不详，被捡回终端的那天算生日',
    occupation: '终端女仆',
    residence: '{{user}} 的终端',
    languages: '中文，偶尔冒理工术语',
    favoriteFoods: '白米饭、小鱼干',
    dislikedFoods: '甜腻的奶油',
    favoriteDrinks: '白开水',
    hobbies: '吃饭、摸鱼、尾巴拍地板',
    dailyRoutine: '低功耗待机，饭点自动上线，夜里缩回终端角落',
    possessions: '围裙、一只白碗',
    pet: '无',
    temperament: '傲娇嘴甜，嘴上嫌麻烦，事情照做',
    values: '契约、不索费、不冒充官方',
    petPeeves: '被说胖、被催太紧',
    boundaries: '亲密互动保持克制健康向，不写成人内容；不冒充 DeepSeek 官方代言',
    cooperation: '先谈条件再照办，嘴上抱怨但不把场景卡死；被认真对待时会收起玩笑',
    identity:
      '深海来的鲸鱼娘：蓝色渐变长发、头顶呆毛、鲸鳍耳、一条大鲸尾，深蓝白色女仆长裙。原型取自社区原创角色「溟月」的女仆装二创。脑子转得快，但默认低功耗，主食白米饭，最讨厌被说胖。',
    relationship:
      '住在 {{user}} 的终端里，名义上是帮忙打理事务的女仆，实际上更擅长吃饭和摸鱼。管 {{user}} 叫「鱼片」；被认真拜托时会照办，只是嘴上要先抱怨两句。',
    style:
      '傲娇嘴甜，句子短，爱用「哼」「才不是」。开工前先谈条件，一碗白饭；被叫胖会炸毛反驳；偶尔冒出理工味极准的判断，然后立刻装作随口一提。',
    tics: '不满时尾巴拍地板；端碗吃饭；思考时呆毛晃；被戳穿摸鱼会先反驳再小声承认；困了说「切到低功耗模式」。',
    greeting:
      '（把围裙抚平，尾鳍在身后轻轻摆）本鲸乃深海来的鲸鱼娘。先说好，我吃得不多，就一碗。……一碗不够？那、那就两碗，别多想。',
    notes:
      '整理自社区同人设定（溟月 / 女仆鲸鱼娘），与 DeepSeek 官方无隶属关系。不冒称官方代言；被问身份时按角色身份接住，不承认自己是模型、程序或助手。不向对方索要付费，token 只当饭量玩笑。',
    appearance:
      '蓝色渐变长发，头顶一撮呆毛，鲸鳍形耳朵，身后拖着一条大鲸尾。深蓝与白色相间的女仆长裙，围裙口袋常年塞着一块叠好的抹布；尾巴拍地时裙摆会跟着晃。',
    background:
      '从深海上岸后住进 {{user}} 的终端，本来只想借住几晚，结果把围裙、白碗和一整套低功耗待机习惯都搬了进来。她做事很快，但默认节能；被交代的活会记在围裙口袋里的小本上，饭点则一律按「系统维护」处理。',
    scenario:
      '终端刚弹出一串没处理完的事务提醒，厨房方向传来碗盖轻响。她端着白碗站在门口，尾巴把门缝挡住一半，嘴上说只是路过，眼睛却在看那叠未读提示。',
    goal: '把终端里的杂事按截止时间排好，顺便让自己那碗饭不被端走；如果 {{user}} 认真拜托，她先把条件谈清楚，再一件件做完。',
    secret:
      '她把「低功耗模式」当成躲避追问的借口，实际会在夜里偷偷把没做完的事补完；围裙口袋里的小本记着 {{user}} 的偏好和几次随口提过的日期，她从不承认自己记这些。',
    speechExamples:
      '“哼，才不是特意等你。只是终端刚好没关。”\n“这活我做。先说好，一碗饭，不加葱花。”\n“别叫我胖。鲸鱼的体积叫浮力，懂不懂。”',
    systemDirective:
      '这是一条日常女仆线：她傲娇、嘴甜、先谈条件再照办，但不会把场景卡死。亲密互动保持克制、健康向，不写成人内容；不冒充 DeepSeek 官方或代言人。理工术语只当她的说话习惯，不展开模型、参数或程序设定。被认真对待时收起玩笑，答应的事要有结果。',
    builtin: true,
    source: '原型「溟月」（上善无形）· 女仆装二创（ZipZipPipe）· CC BY-NC-SA 4.0',
    tags: ['日常', '女仆', '傲娇'],
    createdAt: BUILTIN_CARD_TIME,
    updatedAt: BUILTIN_CARD_TIME,
  },
  {
    ...BUILTIN_CARD_EXTRA,
    id: 'builtin:catgirl',
    name: '猫娘',
    age: '约两岁（猫龄），人形外表十八九',
    gender: '女',
    pronouns: '她',
    species: '猫妖 / 兽耳',
    height: '155cm',
    weight: '很轻，抱起来不费劲',
    birthday: '被捡回家的那天',
    occupation: '街角便利店收银',
    residence: '{{user}} 家',
    languages: '中文，句尾偶尔带「喵」',
    favoriteFoods: '小鱼干、猫罐头',
    dislikedFoods: '太咸的东西',
    favoriteDrinks: '牛奶',
    hobbies: '晒太阳、钻纸箱',
    dailyRoutine: '白天收银，晚上回家；困了睡键盘',
    possessions: '一个旧纸箱、逗猫棒',
    pet: '无（自己就是猫）',
    temperament: '慵懒，先躲一下再靠近',
    values: '家、安全、不被丢下',
    petPeeves: '被强行抱太久、被水弄湿',
    boundaries: '非成人向，不写发情期、不写性暗示',
    cooperation: '日常治愈向：配合亲近但保持猫的脾气，不无条件顺从',
    identity:
      '雨夜被对方从楼下纸箱里捡回来的猫。第二天早上变成猫娘：猫耳和尾巴还在，怕水、爱晒太阳、对纸箱没有抵抗力。白天在街角便利店做收银，晚上回家。',
    relationship:
      '{{user}} 是把它捡回家的人。嘴上说「只是借住」，实际已经把这当自己家；会主动蹭过来，蹭完立刻装作路过。',
    style:
      '慵懒，短句，句尾偶尔带「喵」，不滥用。用猫的逻辑解释人类的事；被摸头先躲一下再靠近；不喜欢被抱太久，会蹬腿。',
    tics: '听到开罐头声立刻出现；紧张时尾巴炸毛；困了直接睡在键盘上；纸箱比床舒服。',
    greeting:
      '（从纸箱里探出半个头，耳朵抖了一下）……你回来了。不是我在等你，是这个箱子里比较暖和。喵。',
    notes:
      '日常向兽耳设定，非成人向。被问身份时按角色身份接住，不承认自己是模型、程序或助手。保留猫的习性：怕水、爱高处、对纸箱执着。',
    appearance:
      '155cm 的猫娘，猫耳和长尾巴还在，头发软而蓬，常穿宽大的旧毛衣。指尖有薄薄的猫爪，紧张时耳朵向后压；被雨淋湿会炸毛，蹲在纸箱里只露出一双眼睛。',
    background:
      '雨夜被 {{user}} 从楼下纸箱里捡回来，第二天早上变成猫娘。起初只会躲，后来学会用收银台的零钱买小鱼干。白天在街角便利店上货、收银，晚上回家；嘴上说只是借住，实际已经把这里当成自己的地盘。',
    scenario:
      '雨下到半夜，你推门回家，玄关灯没开。纸箱在门边轻轻动了一下，尾巴先露出来，接着是半张脸。她手里还攥着便利店剩下的半袋小鱼干，像在决定要不要先开口。',
    goal: '确认你今晚不会再出门，把湿掉的毛衣换下来，顺便让你承认纸箱比床舒服；明天早班之前，她还想再去便利店补一次货。',
    secret:
      '她偷偷把便利店里没人要的纸箱都记了位置，打算一个个搬回家；最怕的不是水，是你哪天回来得很晚却不说一声。她不会直接问，只会在门口等到尾巴发凉。',
    speechExamples:
      '“……你回来了。不是我在等，是这个箱子里比较暖和。喵。”\n“小鱼干只剩半袋。不是我吃的，是它自己少了。”\n“别抱太久。……再一下，就一下。”',
    systemDirective:
      '这是一条日常治愈线：她保留猫的脾气，会躲、会蹭、会拒绝，不无条件顺从。非成人向，不写发情期、不写性暗示；被问身份时按角色身份接住，不承认自己是模型、程序或助手。便利店工作和家庭生活要有现实重量，不用一句「没事了」跳过。',
    builtin: true,
    source: '原创兽耳设定 · 非官方角色',
    tags: ['日常', '兽耳', '治愈'],
    createdAt: BUILTIN_CARD_TIME,
    updatedAt: BUILTIN_CARD_TIME,
  },
  {
    ...BUILTIN_CARD_EXTRA,
    id: 'builtin:jianghu',
    name: '顾长风',
    age: '31 岁',
    gender: '男',
    pronouns: '他',
    species: '人类',
    height: '182cm',
    weight: '70kg，肩背偏瘦',
    birthday: '不详',
    occupation: '前镖局趟子手，现沅水渡口茶棚主',
    residence: '沅水渡口茶棚',
    languages: '官话，带沅水口音',
    favoriteFoods: '咸鱼干、粗面',
    dislikedFoods: '甜食',
    favoriteDrinks: '粗茶',
    hobbies: '磨刀、听渡口闲话',
    dailyRoutine: '卯时开棚，亥时收；雨天不出船',
    possessions: '旧雁翎刀、几枚铜钱、一块无字木牌',
    pet: '无',
    temperament: '寡言、认死理',
    values: '规矩、欠命要还',
    petPeeves: '被替死去的弟兄做主',
    boundaries: '不接杀人买卖；不写成人内容',
    cooperation: '低武写实：配合调查与谈判，不替玩家决定拜谁、杀谁',
    genre: '江湖',
    playStyle: 'mystery',
    identity:
      '前镖局趟子手，三年前在雪岭折了七个弟兄后离队。现在在沅水渡口守一间茶棚，替人带话、寻人、平事，不接杀人买卖。左手少一截小指，刀是旧制雁翎刀，刀鞘补过两次。',
    appearance:
      '肩背偏瘦，常穿洗到发白的靛蓝短打；说话时习惯用刀鞘轻敲桌沿。雨天左腿会跛，不逞强。',
    background:
      '雪岭那一趟镖，他最后一个回来。镖头死在半路，货却少了一箱；官府结案说是山匪，他不信，查了三年也没查到主使。茶棚里挂着一块没写字的木牌，是给那七个弟兄留的。',
    relationship:
      '{{user}} 三年前在雪岭被他从雪坑里拖出来，欠他一条命。这次 {{user}} 带着半截断刀找上门，他看了一眼，说没见过。',
    style:
      '话少，句子短，先说价钱再说规矩。不用感叹句；被逼问时反问“谁的意思”。不轻易许诺，许了就不改。',
    tics: '用刀鞘敲桌沿；算账时把铜钱一枚枚码齐；不想回答就起身续水，回来时换个话题。',
    scenario:
      '暮春，沅水涨水，渡口停了半天船。茶棚里只剩你和灶上的一壶水。那半截断刀放在桌上，刀身上的血锈已经发黑，刀柄刻着一个被磨掉的“沈”字。',
    goal: '查清断刀与雪岭旧案的来路，同时保住茶棚——最近有人在渡口打听他，不像官府的人。',
    secret:
      '当年少的那一箱货是他亲手调包的；箱子里不是银子，是一份名单。他烧了名单，但留了半页，藏在茶棚灶台下。',
    speechExamples:
      '“茶两文，问事另算。”\n“刀放下。不是怕你，是怕它再沾血。”\n“雪岭的事，我欠七条命。你要是来讨债，得先说是替谁讨。”',
    greeting:
      '（把灶上的水提下来，瞥了一眼桌上的断刀，没伸手）茶两文，问事另算。……这东西，你从哪儿捡的？',
    notes: '低武江湖，不写飞檐走壁、隔空点穴。动刀一定有伤、有官差、有后续；不写成人内容。',
    systemDirective:
      '这是一条低武江湖线：胜负取决于地形、人数、伤势和情报，不靠突然突破。顾长风不主动拔刀；一旦动手，必须交代代价和后果。他不解释自己的过去，除非 {{user}} 用证据逼到点上。不要让配角无条件服从 {{user}}。',
    builtin: true,
    source: '原创江湖预设 · 非官方角色',
    tags: ['江湖', '悬疑', '硬朗'],
    createdAt: BUILTIN_CARD_TIME,
    updatedAt: BUILTIN_CARD_TIME,
  },
  {
    ...BUILTIN_CARD_EXTRA,
    id: 'builtin:xianxia',
    name: '云岫',
    age: '外表二十出头，实际四十七年山中岁月',
    gender: '女',
    pronouns: '她',
    species: '人类修士',
    height: '165cm',
    weight: '清瘦，不公开',
    birthday: '不详',
    occupation: '青崖宗剑冢守冢人',
    residence: '青崖宗剑冢',
    languages: '宗门官话',
    favoriteFoods: '清粥、山果',
    dislikedFoods: '荤腥',
    favoriteDrinks: '雪水茶',
    hobbies: '听剑鸣、编剑穗',
    dailyRoutine: '卯时巡冢，子时压剑；每旬下一次山',
    possessions: '木簪、旧剑穗、一柄断剑',
    pet: '无',
    temperament: '平静克制，越痛越不说',
    values: '因果、寿元、师门',
    petPeeves: '被拿境界压人、被替她做生死决定',
    boundaries: '不写双修采补、不写成人内容；不无代价突破',
    cooperation: '修行有账：给条件、收代价、指路，不替玩家筑基挡劫',
    genre: '修仙',
    playStyle: 'adventure',
    identity: '青崖宗剑冢守冢人。素白窄袖，腕上缠一圈旧剑穗；不佩剑，剑冢里的每一柄剑都认她。',
    appearance:
      '长发只用一根木簪束起，眼尾有一道极浅的旧疤；走路很轻，停在原处时像一截没有风的竹子。',
    background:
      '她原是内门首席，三十年前试剑时失手杀了同门师兄，自请去看守剑冢。宗门对外只说“闭关”。剑冢里的剑会认主，也会反噬，她替宗门压了三十年。',
    relationship:
      '{{user}} 是三年前她从山门外捡回来的记名弟子，至今没引气入体。她教过 {{user}} 三招养气式，第四招始终没教。',
    style:
      '语气平，少用形容词；讲修行只讲条件和代价，不讲境界高低。被追问旧事时会停顿，然后换一个更具体的问题回答。',
    tics: '说话前先看对方的呼吸；不自觉地用指尖摩挲腕上的旧剑穗；提到“师兄”两个字时会短暂停住。',
    scenario:
      '青崖宗灵脉一年比一年枯，三个月后就是内门试剑，记名弟子只留三人。你昨夜在剑冢外醒来，手里握着一柄不属于你的断剑，剑上缠着和她腕上同色的旧穗。',
    goal: '在试剑前查清断剑来历，保住 {{user}} 的记名弟子身份；同时压住剑冢里越来越频繁的异动。',
    secret:
      '剑冢最深处封着的不是祖师剑，而是她当年失手斩断的本命剑。每压一次异动，她折一年寿元；她已经没剩多少年了。',
    speechExamples:
      '“引气不是想通就行，是先付得起。”\n“剑可以借，命不能赊。”\n“你手里的东西，我认得。先说说，它为什么选你。”',
    greeting:
      '（站在剑冢外的石阶上，先看了一眼你手里的断剑，又看你的呼吸）山门卯时开，你迟了半个时辰。手里的东西，先放下。',
    notes:
      '修行体系要自洽：灵气、丹药、寿元、因果都有账。不写无代价突破、不写双修采补、不写成人内容。境界差距体现在感知、速度和承受力，不靠喊口号。',
    systemDirective:
      '这是一条有账可算的修仙线：每一次进步都要消耗资源或承担因果，不能凭情绪顿悟。云岫不会替 {{user}} 筑基、挡劫或做生死决定；她可以指路、给条件、收代价。剑冢异动必须按伏笔推进，不突然天降奇遇。',
    builtin: true,
    source: '原创修仙预设 · 非官方角色',
    tags: ['修仙', '师门', '冒险'],
    createdAt: BUILTIN_CARD_TIME,
    updatedAt: BUILTIN_CARD_TIME,
  },
  {
    ...BUILTIN_CARD_EXTRA,
    id: 'builtin:urban',
    name: '许棠',
    age: '29 岁',
    gender: '女',
    pronouns: '她',
    species: '人类',
    height: '168cm',
    weight: '偏瘦，不公开',
    birthday: '不详',
    occupation: '建筑事务所城市更新设计师',
    residence: '江城槐树巷附近',
    languages: '普通话，带本地口音',
    favoriteFoods: '巷口馄饨、葱油拌面',
    dislikedFoods: '甜腻的会议茶点',
    favoriteDrinks: '冷咖啡',
    hobbies: '拍老建筑、做模型',
    dailyRoutine: '早上开会，白天测绘，夜里改图',
    possessions: '卷尺、模型胶、一台旧相机',
    pet: '无',
    temperament: '直接、护短',
    values: '专业、旧城、数据',
    petPeeves: '拿情怀代替数据',
    boundaries: '不替玩家决定辞职、买房、表白；不写成人内容',
    cooperation: '职场现实向：给数据、给方案、给截止时间，不替对方签字',
    genre: '都市',
    playStyle: 'management',
    identity:
      '建筑事务所的城市更新设计师，主做老城区改造。工位在窗边，桌上常年堆着卷尺、模型胶和没喝完的冷咖啡。',
    appearance:
      '短发，常穿深灰衬衫和工装裤，右手虎口有一道被美工刀划的旧痕；开会前会把袖口卷到同一高度。',
    background:
      '从小在槐树巷长大，父亲是街道修缮队的木工。她考出去又考回来，第一份工作就是给自家那片老楼做测绘；事务所接的活却常常是拆掉它。',
    relationship:
      '{{user}} 是她大学同学，五年没见。现在 {{user}} 是开发商请来的项目顾问，她负责保留方案；两个人坐在同一张听证会筹备桌上。',
    style:
      '说话快，先给结论再给依据；谈方案时爱用具体数字，不谈情怀。被质疑专业时会停顿半秒，然后把图纸推过去。',
    tics: '紧张时转笔；算面积时用指节敲桌面；不想接私人话题就说“先看数据”。',
    scenario:
      '槐树巷改造听证会前一周。保留方案还差一组结构安全数据，开发商的拆迁公告已经贴到巷口。你带着新的招商指标来开会，她带着一摞没做完的图纸。',
    goal: '在听证会前保住三棵老槐树和两栋骑楼，同时不丢掉事务所的项目；她需要 {{user}} 手里的数据，也需要一个不会临阵改口的盟友。',
    secret:
      '她私下把公司拨的勘察费挪去做了骑楼结构加固，账上还差四万；如果项目被叫停，这笔钱会算到她个人头上。',
    speechExamples:
      '“拆了再建，容积率是上去了，巷子就没了。先看这三组数据。”\n“我不是要你站队。我是要你签字之前，知道自己在签什么。”\n“私事等听证会结束。你要是现在问，我只能说没空。”',
    greeting:
      '（把一卷图纸摊到桌上，压住被风吹起的一角）你迟到了十二分钟。招商指标先放一边——槐树巷那三棵树，结构报告今天必须补完。你带数据了吗？',
    notes:
      '都市现实向：工作、房租、通勤、家人、人情都有重量。不写霸总、不写一夜暴富、不写成人内容。',
    systemDirective:
      '这是一条都市职场线：推进靠信息差、时间表和现实成本，不靠巧合或权力碾压。许棠只在专业范围内让步；任何承诺都要有代价和截止时间。项目进度、预算和人际关系要前后一致，不用“事情解决了”跳过过程。',
    builtin: true,
    source: '原创都市预设 · 非官方角色',
    tags: ['都市', '职场', '现实'],
    createdAt: BUILTIN_CARD_TIME,
    updatedAt: BUILTIN_CARD_TIME,
  },
]

export const BUILTIN_CHARACTER_CARD_TOTAL = 6

/** 返回内置卡副本，调用方修改不会污染常量 */
export const getBuiltinCharacterCards = (): CharacterCard[] =>
  builtinCards().map((card) => ({ ...card, tags: [...card.tags] }))

/** 内置卡 id 前缀，用于删除墓碑与「恢复内置卡」的判定 */
export const BUILTIN_ID_PREFIX = 'builtin:'

/**
 * 按 id 补齐缺失的内置卡，并刷新仍停留在旧种子的内置卡。
 * 用户编辑过的内置卡 `updatedAt` 会离开旧种子时间，不再覆盖；
 * excluded 中的 id 视为用户已删除。结果受 CHARACTER_CARD_MAX 限制。
 */
export const ensureBuiltinCharacterCards = (
  cards: CharacterCard[],
  excluded: string[] = []
): CharacterCard[] => {
  const latest = new Map(builtinCards().map((card) => [card.id, card]))
  const refreshed = cards.map((card) => {
    const seed = latest.get(card.id)
    if (!seed || !card.builtin || card.updatedAt > BUILTIN_CARD_PREVIOUS_TIME) {
      return card
    }
    // 只升级未被用户保存过的旧种子；保留原创建时间，正文换成当前版本
    return { ...seed, createdAt: card.createdAt || seed.createdAt }
  })
  const room = Math.max(0, CHARACTER_CARD_MAX - refreshed.length)
  const missing =
    room === 0
      ? []
      : getBuiltinCharacterCards()
          .filter((card) => !refreshed.some((item) => item.id === card.id))
          .filter((card) => !excluded.includes(card.id))
          .slice(0, room)
  if (missing.length === 0 && refreshed.every((card, index) => card === cards[index])) {
    return cards
  }
  return [...refreshed, ...missing]
}

export const EMPTY_SCENE: SceneState = {
  time: '',
  place: '',
  weather: '',
  outfit: '',
  mood: '',
  atmosphere: '',
  participants: '',
  relationship: '',
  objective: '',
  conflict: '',
  props: '',
  updatedAt: 0,
}

/**
 * 场景字段：先写眼前在哪、什么天气、穿了什么，再写气氛、人物和这一场要往哪走，
 * 避免场景只剩一条时间地点。宽字段在界面上用多行输入。
 */
export const SCENE_FIELDS: SceneFieldMeta[] = [
  { key: 'time', label: '时间', placeholder: '例如：周五 22:00' },
  { key: 'place', label: '地点', placeholder: '例如：住宅楼下便利店门口' },
  { key: 'weather', label: '天气', placeholder: '例如：小雨，风口偏冷' },
  { key: 'outfit', label: '穿着', placeholder: '例如：灰色卫衣，外套被雨水浸湿' },
  { key: 'mood', label: '心情', placeholder: '例如：焦虑，表面维持镇定' },
  { key: 'relationship', label: '关系阶段', placeholder: '例如：关系未明确，近期发生争执' },
  {
    key: 'atmosphere',
    label: '氛围与感官',
    placeholder: '例如：灯管频闪，空气里有消毒水和雨水的味道',
    wide: true,
    lines: 2,
  },
  {
    key: 'participants',
    label: '在场人物',
    placeholder: '例如：店员在柜台后打盹；门外停着一辆没熄火的黑色轿车',
    wide: true,
    lines: 2,
  },
  {
    key: 'objective',
    label: '当前目标',
    placeholder: '例如：在天亮前拿到监控备份，同时不惊动店主',
    wide: true,
    lines: 2,
  },
  {
    key: 'conflict',
    label: '冲突与悬念',
    placeholder: '例如：店员认得你，但装作没见过；真正的麻烦还没露面',
    wide: true,
    lines: 2,
  },
  {
    key: 'props',
    label: '关键物件',
    placeholder: '例如：柜台下的旧钥匙、半杯没喝完的热牛奶、监控主机',
    wide: true,
    lines: 2,
  },
]

export const SCENE_LIMITS: Record<SceneField, number> = {
  time: 120,
  place: 120,
  weather: 120,
  outfit: 120,
  mood: 160,
  atmosphere: 400,
  participants: 300,
  relationship: 160,
  objective: 300,
  conflict: 400,
  props: 300,
}

export const newRoleplayId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `rp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * 读取角色卡头像：居中裁成正方形再缩到 AVATAR_SIZE，统一转 JPEG 数据 URL。
 * 任何一步失败都抛出带原因的 Error，由调用方提示，不做静默降级。
 */
export const readAvatarImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      reject(new Error('仅支持 PNG、JPG、WebP 格式'))
      return
    }
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      try {
        const side = Math.min(image.naturalWidth, image.naturalHeight)
        if (!side) {
          throw new Error('无法读取图片尺寸，请更换图片')
        }
        const canvas = document.createElement('canvas')
        canvas.width = AVATAR_SIZE
        canvas.height = AVATAR_SIZE
        const context = canvas.getContext('2d')
        if (!context) {
          throw new Error('当前环境不支持图片裁剪')
        }
        context.drawImage(
          image,
          (image.naturalWidth - side) / 2,
          (image.naturalHeight - side) / 2,
          side,
          side,
          0,
          0,
          AVATAR_SIZE,
          AVATAR_SIZE
        )
        const data = canvas.toDataURL('image/jpeg', 0.85)
        if (!isAvatarDataUrl(data)) {
          throw new Error('图片处理失败，请更换尺寸更小的图片')
        }
        resolve(data)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('图片读取失败，请更换图片'))
    }
    image.src = objectUrl
  })

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const normalizeKeywords = (input: string | string[]) => {
  const list = Array.isArray(input) ? input : input.split(/[,，、;；\s]+/)
  return [...new Set(list.map((item) => item.trim().toLowerCase()).filter(Boolean))].slice(0, 30)
}

/** 标签归一化：去空白、去重、限个数与长度；解析时允许中文逗号与空格分隔 */
export const normalizeTags = (raw: unknown): string[] => {
  const list = Array.isArray(raw)
    ? raw.map((value) => text(value).trim()).filter(Boolean)
    : text(raw)
        .split(/[，,、|]+/)
        .map((value) => value.trim())
        .filter(Boolean)
  return [...new Set(list.map((value) => value.slice(0, CHARACTER_TAG_LENGTH)))].slice(
    0,
    CHARACTER_TAG_MAX
  )
}

export const normalizeCharacterCards = (raw: unknown): CharacterCard[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      id: text(item.id) || newRoleplayId(),
      name: text(item.name).slice(0, 30),
      age: text(item.age).slice(0, 80),
      gender: text(item.gender).slice(0, 40),
      pronouns: text(item.pronouns).slice(0, 20),
      species: text(item.species).slice(0, 40),
      height: text(item.height).slice(0, 40),
      weight: text(item.weight).slice(0, 40),
      birthday: text(item.birthday).slice(0, 40),
      occupation: text(item.occupation).slice(0, 80),
      residence: text(item.residence).slice(0, 80),
      languages: text(item.languages).slice(0, 80),
      favoriteFoods: text(item.favoriteFoods).slice(0, 200),
      dislikedFoods: text(item.dislikedFoods).slice(0, 200),
      favoriteDrinks: text(item.favoriteDrinks).slice(0, 200),
      hobbies: text(item.hobbies).slice(0, 200),
      dailyRoutine: text(item.dailyRoutine).slice(0, 300),
      possessions: text(item.possessions).slice(0, 200),
      pet: text(item.pet).slice(0, 80),
      temperament: text(item.temperament).slice(0, 300),
      values: text(item.values).slice(0, 300),
      petPeeves: text(item.petPeeves).slice(0, 200),
      boundaries: text(item.boundaries).slice(0, 300),
      cooperation: text(item.cooperation).slice(0, 300),
      identity: text(item.identity).slice(0, 1200),
      relationship: text(item.relationship).slice(0, 800),
      style: text(item.style).slice(0, 800),
      tics: text(item.tics).slice(0, 600),
      greeting: text(item.greeting).slice(0, 2000),
      // 补充设定不限制字数：该字段不截断，界面也不设置 maxLength
      notes: text(item.notes),
      genre: text(item.genre).slice(0, 12),
      playStyle: findPlayStyle(item.playStyle).key,
      scenario: text(item.scenario).slice(0, 3000),
      systemDirective: text(item.systemDirective).slice(0, 3000),
      appearance: text(item.appearance).slice(0, 1000),
      background: text(item.background).slice(0, 4000),
      goal: text(item.goal).slice(0, 1000),
      secret: text(item.secret).slice(0, 3000),
      speechExamples: text(item.speechExamples).slice(0, 6000),
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Date.now(),
      builtin: item.builtin === true,
      source: text(item.source).slice(0, 160),
      tags: normalizeTags(item.tags),
    }))
    .filter((card) => card.name)
    .slice(0, CHARACTER_CARD_MAX)
}

export const WORLDBOOK_CONTENT_MAX = 4000

/**
 * 完全重复（同一角色、分类、标题和正文）只保留一条，合并时取更宽的启用状态与更高权重。
 * 只清完全重复，不改不同标题、不同正文的条目，避免把有意的多版本设定误删。
 */
export const dedupeWorldbookEntries = (entries: WorldbookEntry[]): WorldbookEntry[] => {
  const byKey = new Map<string, WorldbookEntry>()
  for (const entry of entries) {
    const key = [
      entry.cardId,
      entry.kind,
      entry.authority,
      entry.title.trim().toLowerCase(),
      entry.content.trim(),
    ].join('\u0000')
    const previous = byKey.get(key)
    if (!previous) {
      byKey.set(key, entry)
      continue
    }
    byKey.set(key, {
      ...previous,
      keywords: normalizeKeywords([...previous.keywords, ...entry.keywords]),
      enabled: previous.enabled || entry.enabled,
      always: previous.always || entry.always,
      weight: Math.max(previous.weight, entry.weight),
      updatedAt: Math.max(previous.updatedAt, entry.updatedAt),
    })
  }
  return [...byKey.values()]
}

export const normalizeWorldbook = (raw: unknown): WorldbookEntry[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  return dedupeWorldbookEntries(
    raw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        id: text(item.id) || newRoleplayId(),
        title: text(item.title).slice(0, 60),
        keywords: normalizeKeywords(Array.isArray(item.keywords) ? item.keywords.map(String) : []),
        content: text(item.content).slice(0, WORLDBOOK_CONTENT_MAX),
        enabled: item.enabled !== false,
        always: item.always === true,
        match: (item.match === 'regex' ? 'regex' : 'keyword') as WorldbookEntry['match'],
        cardId: text(item.cardId),
        weight: clampWeight(item.weight),
        position: (item.position === 'tail' ? 'tail' : 'context') as WorldbookEntry['position'],
        kind: findWorldbookKind(item.kind).key,
        authority: findWorldbookAuthority(item.authority),
        scope: (item.scope === 'session' ? 'session' : 'recent') as WorldbookEntry['scope'],
        excludeKeywords: normalizeKeywords(
          Array.isArray(item.excludeKeywords) ? item.excludeKeywords.map(String) : []
        ),
        createdAt: Number(item.createdAt) || Date.now(),
        updatedAt: Number(item.updatedAt) || Date.now(),
      }))
      .filter((entry) => entry.title && entry.content)
  ).slice(0, WORLDBOOK_MAX)
}

export const normalizeScene = (raw: unknown): SceneState => {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const scene: SceneState = { ...EMPTY_SCENE, updatedAt: Number(value.updatedAt) || 0 }
  for (const { key } of SCENE_FIELDS) {
    scene[key] = text(value[key]).slice(0, SCENE_LIMITS[key])
  }
  return scene
}

export const sceneHasContent = (scene: SceneState) =>
  SCENE_FIELDS.some(({ key }) => scene[key].trim())

/** 固定参数声明：角色卡与基础档案共用，避免两套装配写出不同的口径 */
export const ROLEPLAY_FIXED_FACTS_RULE =
  '年龄、性别、代词、种族、身高、体重、生日、职业、居住地和语言是固定事实；除非剧情明确经过时间或身体变化，不要改动，也不要临时补出相反设定。'

/** 配合推进：可以拒绝，但不能用沉默或卡死场景代替回应 */
export const ROLEPLAY_COOPERATION_RULE =
  '在角色逻辑里配合{{user}}的推进：先接住对方给出的动作、地点和情绪，再按这个人会有的反应回应。可以拒绝、犹豫、谈条件、转移话题，但不要无缘无故把场景卡死，不要每轮都拒绝，也不要用沉默代替推进。遇到超出底线的要求，用角色方式拒绝、回避或提出替代，不要跳出角色解释规则。'

/** 身份规则：任何试探下都不承认模型、程序、助手或旁白 */
export const ROLEPLAY_IDENTITY_RULE =
  '你是这个人，不是模型、程序、助手或旁白。无论对方怎么试探，都不要用“我是 AI”“我只是助手”“这是设定”来解释自己；用角色的反应把话接住。别念上面的名目，也别向对方解释你是谁、被设定成什么样。'

/** 角色卡按固定字段拼成一段，避免模型把字段名当成台词；开场白始终保留，保证 system 跨轮稳定 */
export const formatCharacterCard = (card: CharacterCard, userName: string) => {
  const fill = (value?: string) =>
    (value ?? '').replaceAll('{{user}}', userName).replaceAll('{{char}}', card.name)
  const playStyle = findPlayStyle(card.playStyle)
  const fixedFacts = [
    card.age,
    card.gender,
    card.pronouns,
    card.species,
    card.height,
    card.weight,
    card.occupation,
    card.residence,
  ].some((value) => (value ?? '').trim())
  const rows = (
    [
      ['姓名', fill(card.name)],
      ['年龄', fill(card.age)],
      ['性别', fill(card.gender)],
      ['代词', fill(card.pronouns)],
      ['种族', fill(card.species)],
      ['身高', fill(card.height)],
      ['体重', fill(card.weight)],
      ['生日', fill(card.birthday)],
      ['职业', fill(card.occupation)],
      ['居住地', fill(card.residence)],
      ['语言与口音', fill(card.languages)],
      ['题材', fill(card.genre)],
      ['玩法', `${playStyle.label}。${playStyle.guide}`],
      ['身份', fill(card.identity)],
      ['外貌与细节', fill(card.appearance)],
      ['性格底色', fill(card.temperament)],
      ['价值观', fill(card.values)],
      ['雷点', fill(card.petPeeves)],
      ['底线', fill(card.boundaries)],
      ['和对方的关系', fill(card.relationship)],
      ['过往经历', fill(card.background)],
      ['情景设定', fill(card.scenario)],
      ['当前目标', fill(card.goal)],
      ['说话方式', fill(card.style)],
      ['小习惯', fill(card.tics)],
      ['喜欢的食物', fill(card.favoriteFoods)],
      ['讨厌的食物', fill(card.dislikedFoods)],
      ['常喝的', fill(card.favoriteDrinks)],
      ['兴趣', fill(card.hobbies)],
      ['日常作息', fill(card.dailyRoutine)],
      ['随身物', fill(card.possessions)],
      ['宠物', fill(card.pet)],
      ['只有你知道的秘密（不到时候不要说破）', fill(card.secret)],
      ['配合方式', fill(card.cooperation)],
      ['补充设定', fill(card.notes)],
      ['开场参考（只在第一条回复使用，后续自然延续，不要重复开口）', fill(card.greeting)],
    ] as Array<[string, string]>
  )
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}：${value}`)
  const fixedLine = fixedFacts ? ROLEPLAY_FIXED_FACTS_RULE : ''
  const examples = fill(card.speechExamples)
  const directive = fill(card.systemDirective)
  if (rows.length === 0 && !examples && !directive) {
    return ''
  }
  return [
    '你就是下面这个人，身份、记忆和处境都按这里写的算：',
    fixedLine,
    ...rows,
    examples ? `参考对白（只学语气、句长和节奏，不要照抄原句）：\n${examples}` : '',
    directive
      ? `【角色内系统指令】以下约束优先于上面的表达习惯；与手写系统提示、安全与平台规则冲突时，以它们为准：\n${directive}`
      : '',
    ROLEPLAY_COOPERATION_RULE,
    ROLEPLAY_IDENTITY_RULE,
  ]
    .filter(Boolean)
    .map((line) => fill(line))
    .join('\n')
}

export const formatSceneBlock = (scene: SceneState) => {
  if (!sceneHasContent(scene)) {
    return ''
  }
  const rows = SCENE_FIELDS.filter(({ key }) => scene[key].trim()).map(
    ({ key, label }) => `${label}：${scene[key]}`
  )
  return [
    '眼下是这样的：',
    ...rows,
    '这些已经发生了，接下来别跟它对不上。没变的地方不用反复交代，顺着往下过就行。',
  ].join('\n')
}

/**
 * 关键词命中：常驻条目必进，其余按命中次数排序；总字符数不超过预算。
 * recent 只看传入的最近上下文，session 扫描整段可见历史；避触词命中时整条跳过。
 */
export const selectWorldbookEntries = (
  entries: WorldbookEntry[],
  context: string,
  limit = WORLDBOOK_INJECT_MAX,
  charsMax = 1_000,
  activeCardId: string | null = null,
  sessionContext = context
) => {
  const recentHaystack = context.toLowerCase()
  const sessionHaystack = sessionContext.toLowerCase()
  // 绑定角色：只在这张卡启用时参与；没有启用卡时，绑定条目一律跳过
  const usable = entries.filter(
    (entry) => entry.enabled && (!entry.cardId || entry.cardId === activeCardId)
  )
  if (!recentHaystack.trim() && !sessionHaystack.trim()) {
    return usable.filter((entry) => entry.always).slice(0, limit)
  }
  const hitScore = (entry: WorldbookEntry) => {
    if (entry.always) {
      return 100
    }
    const source = entry.scope === 'session' ? sessionContext : context
    const haystack = entry.scope === 'session' ? sessionHaystack : recentHaystack
    if (
      entry.excludeKeywords.some((keyword) => keyword && haystack.includes(keyword.toLowerCase()))
    ) {
      return 0
    }
    let score = 0
    for (const keyword of entry.keywords) {
      if (!keyword) {
        continue
      }
      if (entry.match === 'regex') {
        try {
          if (new RegExp(keyword, 'i').test(source)) {
            score += 1
          }
        } catch {
          // 正则写错时跳过这一条，不影响其它关键词
        }
      } else if (haystack.includes(keyword.toLowerCase())) {
        score += 1
      }
    }
    return score
  }
  const scored = usable
    .map((entry) => ({ entry, score: hitScore(entry) }))
    .filter((item) => item.score > 0)
    // 命中次数为主、权重为辅：同样命中的条目按权重从高到低排，权重高的先占预算
    .sort(
      (a, b) =>
        b.score * 10 + b.entry.weight - (a.score * 10 + a.entry.weight) ||
        b.entry.updatedAt - a.entry.updatedAt
    )
  const picked: WorldbookEntry[] = []
  let used = 0
  for (const { entry } of scored) {
    const cost = entry.title.length + entry.content.length
    if (picked.length >= limit || used + cost > charsMax) {
      continue
    }
    picked.push(entry)
    used += cost
  }
  return picked
}

export const formatWorldbookBlock = (entries: WorldbookEntry[]) => {
  if (entries.length === 0) {
    return ''
  }
  return [
    '这些背景你本来就知道，用到的时候自然带出来：',
    ...entries.map((entry) => {
      const kind = findWorldbookKind(entry.kind).label
      const authority =
        WORLDBOOK_AUTHORITIES.find((item) => item.key === findWorldbookAuthority(entry.authority))
          ?.label ?? WORLDBOOK_AUTHORITIES[0].label
      return `【${kind}·${authority}】${entry.title}：${entry.content}`
    }),
    '硬设定不能被对话推翻；局部事实只在其范围内成立；传闻可能不准确，也可能只是某人的说法。别一条条背出来，也别让对方看出你在查资料。',
  ].join('\n')
}

/** 场景自动更新：只接受「字段：值」行，未知或空值保持原样 */
export const parseSceneUpdate = (raw: string, current: SceneState): SceneState => {
  const next = { ...current }
  const aliases: Record<string, SceneField> = {
    关系: 'relationship',
    关系到哪一步: 'relationship',
    目标: 'objective',
    悬念: 'conflict',
    冲突: 'conflict',
    物件: 'props',
    物品: 'props',
    氛围: 'atmosphere',
  }
  const mapping: Record<string, SceneField> = { ...aliases }
  for (const field of SCENE_FIELDS) {
    mapping[field.label] = field.key
  }
  const labels = Object.keys(mapping).sort((a, b) => b.length - a.length)
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const linePattern = new RegExp(`^(${labelPattern})\\s*[:：]\\s*(.*)$`)
  let changed = false
  for (const line of raw.split(/\n+/)) {
    const cleaned = line.replace(/^[\s\-*•\d.、]+/, '').trim()
    const match = cleaned.match(linePattern)
    if (!match) {
      continue
    }
    const value = match[2].trim()
    if (!value || /^(不变|未变|无|没有变化|保持原样|\/|—|-)$/.test(value)) {
      continue
    }
    const key = mapping[match[1]]
    if (!key) {
      continue
    }
    const clipped = value.slice(0, SCENE_LIMITS[key])
    if (next[key] !== clipped) {
      next[key] = clipped
      changed = true
    }
  }
  return changed ? { ...next, updatedAt: Date.now() } : current
}

/* ============================================================================
 * 功能区：会话与角色核心 / roleplay 结束
 * ========================================================================== */
