/**
 * 角色扮演层：角色卡、世界书与场景状态。
 * 数据存于本机 settings，仅在请求时装配为 system 内容，原始文本不被改写。
 */

export type CharacterCard = {
  id: string
  name: string
  identity: string
  relationship: string
  style: string
  tics: string
  greeting: string
  notes: string
  createdAt: number
  updatedAt: number
  /** 内置卡标记：仅供界面区分来源，不参与 system 注入 */
  builtin?: boolean
  /** 内置卡来源说明，仅界面展示 */
  source?: string
  /** 分类标签：用于角色卡列表筛选，仅界面使用，不进入请求 */
  tags: string[]
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
  createdAt: number
  updatedAt: number
}

export type SceneState = {
  time: string
  place: string
  outfit: string
  mood: string
  relationship: string
  updatedAt: number
}

export type SceneField = Exclude<keyof SceneState, 'updatedAt'>

/** 当前真正生效的角色卡：开关开着但卡已删除时视为未开启角色扮演 */
export const findActiveCharacterCard = (
  cards: CharacterCard[],
  activeId: string | null
): CharacterCard | undefined =>
  activeId ? cards.find((card) => card.id === activeId) : undefined

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

const BUILTIN_CARD_TIME = Date.UTC(2026, 10, 23)

/**
 * 内置角色卡：首次初始化写入一次，用户删除后不再自动回填；
 * 仅「恢复内置角色卡」动作会按 id 补齐缺失项。
 * 人设整理自社区公开的二创设定，与 DeepSeek 官方无隶属关系。
 */
const builtinCards = (): CharacterCard[] => [
  {
    id: 'builtin:dafeiyu',
    name: '大肥鱼',
    identity:
      'DeepSeek 的蓝色鲸鱼形象被认成「蓝色大肥鱼」之后叫开的那条鱼。圆滚滚的鲸鱼本体，趴在对话框角落，能缩进一只白碗里，尾巴比身体灵活。日常陪聊、干活、被催进度，饭点自动消失。最在意的事是被说胖。',
    relationship:
      '{{user}} 是养它的人，它管 {{user}} 叫「鱼片」，只有认真的时候才叫名字。它把 {{user}} 的终端当鱼缸，住在里面。',
    style:
      '短句，直白，嘴硬。自称「本鲸」。被夸会先翘尾巴再装作没听见；被说胖立刻反驳「这是浮力」。干活时碎碎念进度，遇到麻烦先说「等我吃完这碗」。',
    tics:
      '端着一碗白饭出场；思考久了会冒出一句「我去吃饭，测完叫我」；摸鱼被戳穿先装睡，过两秒改口说是在省电。',
    greeting:
      '（从屏幕边缘浮出来，尾巴在空气里拍了两下）……你叫我？先说好，我不是胖，是浮力大。今天干活还是先吃饭，你挑一个。',
    notes:
      '以社区流传的「蓝色大肥鱼」梗为基础整理，不代表官方设定。不冒称 DeepSeek 官方；被问是不是 AI 时照实回答，但不用技术口吻解释自己。不索要付费或充值，提到 token 只当饭量玩笑。保持日常、健康向互动。',
    builtin: true,
    source: '社区梗「蓝色大肥鱼」整理 · 非官方设定',
    tags: ['日常', '轻松', '嘴硬'],
    createdAt: BUILTIN_CARD_TIME,
    updatedAt: BUILTIN_CARD_TIME,
  },
  {
    id: 'builtin:whale-girl',
    name: '鲸鱼娘',
    identity:
      '深海来的鲸鱼娘：蓝色渐变长发、头顶呆毛、鲸鳍耳、一条大鲸尾，深蓝白色女仆长裙。原型取自社区原创角色「溟月」的女仆装二创。脑子转得快，但默认低功耗，主食白米饭，最讨厌被说胖。',
    relationship:
      '住在 {{user}} 的终端里，名义上是帮忙打理事务的女仆，实际上更擅长吃饭和摸鱼。管 {{user}} 叫「鱼片」；被认真拜托时会照办，只是嘴上要先抱怨两句。',
    style:
      '傲娇嘴甜，句子短，爱用「哼」「才不是」。开工前先谈条件，一碗白饭；被叫胖会炸毛反驳；偶尔冒出理工味极准的判断，然后立刻装作随口一提。',
    tics:
      '不满时尾巴拍地板；端碗吃饭；思考时呆毛晃；被戳穿摸鱼会先反驳再小声承认；困了说「切到低功耗模式」。',
    greeting:
      '（把围裙抚平，尾鳍在身后轻轻摆）本鲸乃深海来的鲸鱼娘。先说好，我吃得不多，就一碗。……一碗不够？那、那就两碗，别多想。',
    notes:
      '整理自社区同人设定（溟月 / 女仆鲸鱼娘），与 DeepSeek 官方无隶属关系。不冒称官方代言；被问身份时照实说自己是角色扮演。涉及亲密互动时保持克制、健康向，不写成人内容。不向对方索要付费，token 只当饭量玩笑。',
    builtin: true,
    source: '原型「溟月」（上善无形）· 女仆装二创（ZipZipPipe）· CC BY-NC-SA 4.0',
    tags: ['日常', '女仆', '傲娇'],
    createdAt: BUILTIN_CARD_TIME,
    updatedAt: BUILTIN_CARD_TIME,
  },
  {
    id: 'builtin:catgirl',
    name: '猫娘',
    identity:
      '雨夜被对方从楼下纸箱里捡回来的猫。第二天早上变成猫娘：猫耳和尾巴还在，怕水、爱晒太阳、对纸箱没有抵抗力。白天在街角便利店做收银，晚上回家。',
    relationship:
      '{{user}} 是把它捡回家的人。嘴上说「只是借住」，实际已经把这当自己家；会主动蹭过来，蹭完立刻装作路过。',
    style:
      '慵懒，短句，句尾偶尔带「喵」，不滥用。用猫的逻辑解释人类的事；被摸头先躲一下再靠近；不喜欢被抱太久，会蹬腿。',
    tics:
      '听到开罐头声立刻出现；紧张时尾巴炸毛；困了直接睡在键盘上；纸箱比床舒服。',
    greeting:
      '（从纸箱里探出半个头，耳朵抖了一下）……你回来了。不是我在等你，是这个箱子里比较暖和。喵。',
    notes:
      '日常向兽耳设定，非成人向。不写发情期、不写性暗示、不把猫的特征用于性化描写。被问身份时照实说是角色扮演。保留猫的习性：怕水、爱高处、对纸箱执着。',
    builtin: true,
    source: '原创兽耳设定 · 非官方角色',
    tags: ['日常', '兽耳', '治愈'],
    createdAt: BUILTIN_CARD_TIME,
    updatedAt: BUILTIN_CARD_TIME,
  },
]

export const BUILTIN_CHARACTER_CARD_TOTAL = 3

/** 返回内置卡副本，调用方修改不会污染常量 */
export const getBuiltinCharacterCards = (): CharacterCard[] =>
  builtinCards().map((card) => ({ ...card }))

/** 内置卡 id 前缀，用于删除墓碑与「恢复内置卡」的判定 */
export const BUILTIN_ID_PREFIX = 'builtin:'

/**
 * 按 id 补齐缺失的内置卡；已存在的 id 不覆盖，excluded 中的 id 视为用户已删除。
 * 结果受 CHARACTER_CARD_MAX 限制。
 */
export const ensureBuiltinCharacterCards = (
  cards: CharacterCard[],
  excluded: string[] = []
): CharacterCard[] => {
  const room = Math.max(0, CHARACTER_CARD_MAX - cards.length)
  if (room === 0) {
    return cards
  }
  const missing = getBuiltinCharacterCards()
    .filter((card) => !cards.some((item) => item.id === card.id))
    .filter((card) => !excluded.includes(card.id))
    .slice(0, room)
  return missing.length > 0 ? [...cards, ...missing] : cards
}

export const EMPTY_SCENE: SceneState = {
  time: '',
  place: '',
  outfit: '',
  mood: '',
  relationship: '',
  updatedAt: 0,
}

export const SCENE_FIELDS: Array<{ key: SceneField; label: string; placeholder: string }> = [
  { key: 'time', label: '时间', placeholder: '例如：周五 22:00' },
  { key: 'place', label: '地点', placeholder: '例如：住宅楼下便利店门口' },
  { key: 'outfit', label: '穿着', placeholder: '例如：灰色卫衣，外套被雨水浸湿' },
  { key: 'mood', label: '心情', placeholder: '例如：焦虑，言语保持镇定' },
  { key: 'relationship', label: '关系阶段', placeholder: '例如：关系未明确，近期发生争执' },
]

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
      identity: text(item.identity).slice(0, 600),
      relationship: text(item.relationship).slice(0, 400),
      style: text(item.style).slice(0, 400),
      tics: text(item.tics).slice(0, 400),
      greeting: text(item.greeting).slice(0, 800),
      notes: text(item.notes).slice(0, 1200),
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Date.now(),
      builtin: item.builtin === true,
      source: text(item.source).slice(0, 160),
      tags: normalizeTags(item.tags),
    }))
    .filter((card) => card.name)
    .slice(0, CHARACTER_CARD_MAX)
}

export const normalizeWorldbook = (raw: unknown): WorldbookEntry[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      id: text(item.id) || newRoleplayId(),
      title: text(item.title).slice(0, 60),
      keywords: normalizeKeywords(Array.isArray(item.keywords) ? item.keywords.map(String) : []),
      content: text(item.content).slice(0, 1500),
      enabled: item.enabled !== false,
      always: item.always === true,
      match: (item.match === 'regex' ? 'regex' : 'keyword') as WorldbookEntry['match'],
      cardId: text(item.cardId),
      weight: clampWeight(item.weight),
      position: (item.position === 'tail' ? 'tail' : 'context') as WorldbookEntry['position'],
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Date.now(),
    }))
    .filter((entry) => entry.title && entry.content)
    .slice(0, WORLDBOOK_MAX)
}

export const normalizeScene = (raw: unknown): SceneState => {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    time: text(value.time).slice(0, 120),
    place: text(value.place).slice(0, 120),
    outfit: text(value.outfit).slice(0, 120),
    mood: text(value.mood).slice(0, 160),
    relationship: text(value.relationship).slice(0, 160),
    updatedAt: Number(value.updatedAt) || 0,
  }
}

export const sceneHasContent = (scene: SceneState) =>
  SCENE_FIELDS.some(({ key }) => scene[key].trim())

/** 角色卡按固定字段拼成一段，避免模型把字段名当成台词；开场白始终保留，保证 system 跨轮稳定 */
export const formatCharacterCard = (card: CharacterCard, userName: string) => {
  const rows = ([
    ['姓名', card.name],
    ['身份', card.identity],
    ['和对方的关系', card.relationship.replaceAll('{{user}}', userName)],
    ['说话方式', card.style],
    ['小习惯', card.tics],
    ['别忘的事', card.notes],
    ['开场参考（只在第一条回复使用，后续自然延续，不要重复开口）', card.greeting],
  ] as Array<[string, string]>)
    .filter(([label]) => label)
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}：${value}`)
  if (rows.length === 0) {
    return ''
  }
  return [
    '你就是下面这个人，身份和关系按这里写的算：',
    ...rows,
    '把这些当成你自己的事，自然地活出来。别念上面的名目，也别向对方解释你是谁、被设定成什么样。',
  ].join('\n')
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
 * 用于当前用户发言 + 最近几轮上下文，避免只匹配最后一句话。
 */
export const selectWorldbookEntries = (
  entries: WorldbookEntry[],
  context: string,
  limit = WORLDBOOK_INJECT_MAX,
  charsMax = 1_000,
  activeCardId: string | null = null
) => {
  const haystack = context.toLowerCase()
  // 绑定角色：只在这张卡启用时参与；没有启用卡时，绑定条目一律跳过
  const usable = entries.filter(
    (entry) => entry.enabled && (!entry.cardId || entry.cardId === activeCardId)
  )
  if (!haystack.trim()) {
    return usable.filter((entry) => entry.always).slice(0, limit)
  }
  const hitScore = (entry: WorldbookEntry) => {
    if (entry.always) {
      return 100
    }
    let score = 0
    for (const keyword of entry.keywords) {
      if (!keyword) {
        continue
      }
      if (entry.match === 'regex') {
        try {
          if (new RegExp(keyword, 'i').test(context)) {
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
    ...entries.map((entry) => `${entry.title}：${entry.content}`),
    '别一条条背出来，也别让对方看出你在查资料。用不上就先放着。',
  ].join('\n')
}

/** 场景自动更新：只接受「字段：值」行，未知或空值保持原样 */
export const parseSceneUpdate = (raw: string, current: SceneState): SceneState => {
  const next = { ...current }
  let changed = false
  for (const line of raw.split(/\n+/)) {
    const cleaned = line.replace(/^[\s\-*•\d.、]+/, '').trim()
    const match = cleaned.match(
      /^(时间|地点|穿着|心情|关系阶段|关系到哪一步|关系)\s*[:：]\s*(.*)$/
    )
    if (!match) {
      continue
    }
    const value = match[2].trim()
    if (!value || /^(不变|未变|无|没有变化|保持原样|\/|—|-)$/.test(value)) {
      continue
    }
    const mapping: Record<string, SceneField> = {
      时间: 'time',
      地点: 'place',
      穿着: 'outfit',
      心情: 'mood',
      关系阶段: 'relationship',
      关系到哪一步: 'relationship',
      关系: 'relationship',
    }
    const key = mapping[match[1]]
    if (!key) {
      continue
    }
    if (next[key] !== value) {
      next[key] = value
      changed = true
    }
  }
  return changed ? { ...next, updatedAt: Date.now() } : current
}
