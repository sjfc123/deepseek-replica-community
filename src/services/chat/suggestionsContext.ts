/* ============================================================================
 * 功能区：会话与角色核心 / suggestionsContext 开始
 * 职责：回复建议的纯文本装配：场景快照、在场人物、玩家站位、身份边界与去重。
 * 导出：SUGGESTION_SYSTEM、ReplySuggestion、buildSuggestionCardContext、
 *       buildSuggestionCastContext、buildSuggestionSceneContext、
 *       detectSuggestionPresence、buildSuggestionTranscript、buildSuggestionAsk、
 *       filterPrematureSuggestions、pickFreshSuggestions、pickFreshReplySuggestions。
 * ========================================================================== */

import type { CharacterCard, SceneState } from './roleplay.js'

/** 建议的呈现方式：玩家说出口的话，或玩家侧括号动作/旁白 */
export type ReplySuggestionMode = 'speech' | 'aside'

/** 三条建议必须承担不同方向，避免整批都在追问同一件物品或都在下指令。 */
export type ReplySuggestionIntent = 'detail' | 'emotion' | 'action' | 'aside'

/** 一条建议；target 只用于界面标注，intent/topic 用于去重，不直接展示 */
export type ReplySuggestion = {
  text: string
  mode: ReplySuggestionMode
  /** 当前在场角色名，或「在场所有人」 */
  target?: string
  /** 本句承担的推进方向 */
  intent?: ReplySuggestionIntent
  /** 本句落在哪件具体事/物/情绪上，用来阻止三条都围着同一物件打转 */
  topic?: string
}

/** 玩家当前是否还在场；leaving 表示角色台词或玩家上一句已经把行动推向门外 */
export type SuggestionPresence = 'together' | 'leaving' | 'remote' | 'group'

export const SUGGESTION_SYSTEM = [
  '你是玩家回复建议器，只替玩家拟下一条输入，不扮演角色，不续写角色反应。',
  '每条建议的说话人必须是玩家，收话人是当前在场的角色或全场。可以先判断这句话是不是更像角色会说的；只要像，立刻删掉重写。',
  '禁止写角色的台词、动作、表情、心理；也不能替角色回答、解释角色自己、预判角色下一步。括号里的内容只能属于玩家。',
  '称呼方向不能反：角色平时怎么称呼玩家，不等于玩家也这样称呼角色。角色叫玩家“哥”“主人”或“老师”时，建议里若用这个称呼去叫对方，基本就是写成了角色。',
  '两种呈现方式：对白直接写玩家说出口的话，不带括号；旁白或动作以全角“（”开头，写玩家自己的动作、视线、呼吸、停顿、内心或留在门口的半句话。括号里不能指挥其他角色，也不能写其他角色的内心。',
  '默认给对白。只有角色刚把玩家往外推、玩家上一句已经在离开、或此刻需要沉默动作时，才允许出现旁白；这种情况至少两条建议要以“（”开头，且不能三条都写成离开。',
  '不要客服腔：不写“我理解你”“你需要我做什么”“我可以帮你”“你别害怕”“有什么我能帮你”这类安抚句，也不要把通用关心当成回应。',
  '不要固定模板问句：不要每条都用“你先”“你要不要”“你能”“你是不是”开头，也不要反复问同一个物件。三条的开头、句式和落点必须不同。',
  '每条必须落在当前场景里的具体东西：她刚说的一句话、手边的物件、门口或窗边的动静、在场另一个人的反应。写不出具体落点时，说明建议还停在泛泛关心，重写。',
  '不要默认玩家就在她身边：场景没写玩家站位、或最近几轮显示玩家还在赶路、在门外、在电话里时，不能写“你手边”“你屋里”“你身后”“你站在那儿”这类只有贴身站立才知道的细节，也不能假设玩家亲手碰到屋里的东西。',
  '角色卡设定只用来判断她的称呼、语气、习惯和边界，是参考不是素材库；不要把设定里的旧事、物件和背景每条都搬进建议。',
  '多角色场景要先确认这句话是对谁说的：只能用【在场角色】里出现过的名字，不能把不在场的人写进来；对全场说话时用“你们”或“两个人”。',
  '实际生成依据是最近两轮对话、当前场景快照和角色此刻的行为；每条只回应当前这一小步，不跳步、不替下一轮写剧情。',
  '上一批建议里的句子不能再出现，也不要用近义改写复读；玩家已经看过的建议视为过期。',
  '正常阶段顺着本人语气回应，不要提前把异变、替身或后续线索说破；异变阶段用已经出现过的细节做验证，不要空泛地问“你是不是假的”；截止阶段只写识破、拒绝承认和救人。',
  '只能使用最近对话和场景里玩家已经看到的信息。不要把角色卡秘密、真相、后续线索或完整线索链直接说破；玩家还没掌握的证据只能写成怀疑或试探。',
  '三条必须错开方向：detail 接住她刚说的具体细节并追问/验证；emotion 回应她的情绪、身体或你们的关系；action 给一个能实际推进的动作、安排或态度；旁白另算 aside。不能三条都做 action，也不能三条都围着同一件物品。',
  '每条标注 topic：用 2 到 6 个字写这句落在什么具体事、物或情绪上，例如“报纸日期”“她的疲惫”“电话信号”。同一批里 topic 不能重复。',
  '只输出一个 JSON 数组，四个对象，不要代码块：',
  '[{"mode":"speech","target":"角色名","intent":"detail","topic":"报纸日期","text":"……"},{"mode":"aside","target":"角色名","intent":"aside","topic":"电话里的停顿","text":"（……）"}]',
  'mode 只能是 speech 或 aside；intent 只能是 detail、emotion、action、aside；target 只能是【在场角色】里的名字或“在场所有人”；aside 的 text 必须以“（”开头。',
].join('\n')

/** 只保留玩家能感知的角色侧信息；不读取秘密、备注、卡内系统指令与剧情真相。 */
export const buildSuggestionCardContext = (card: CharacterCard) =>
  [
    `角色名：${card.name}`,
    // 不把 identity 放进来：里面可能夹着旧疤、暗号等后续线索，容易让建议提前点破。
    card.relationship ? `与玩家的关系：${card.relationship}` : '',
    card.temperament ? `性格底色：${card.temperament}` : '',
    card.style ? `说话方式：${card.style}` : '',
    card.tics ? `小习惯：${card.tics}` : '',
  ]
    .filter(Boolean)
    .join('\n')

const castSeparators = /[、，,；;/／|和与及]+/
const castPlaceholders = new Set([
  '玩家',
  '我',
  '你',
  '他',
  '她',
  '他们',
  '她们',
  '众人',
  '所有人',
  '大家',
])
/** 场景里的在场人物可能是角色卡之外的 NPC；含动作词的长句不是名字，不能塞进说话对象。 */
const castNoise = /[在的了着说站坐走来去，。！？]/

/** 把场景里的在场人物拆成名字；角色卡之外的 NPC 也可以进入，但会剔除长句、动作词与泛称。 */
export const resolvePresentCast = (
  cardName: string,
  participants: string | undefined
): string[] => {
  const names = (participants ?? '')
    .split(castSeparators)
    .map((name) => name.replace(/[（(][^）)]*[）)]/g, '').trim())
    .filter(
      (name) =>
        name.length >= 1 &&
        name.length <= 6 &&
        !castPlaceholders.has(name) &&
        !castNoise.test(name)
    )
  return [...new Set([cardName, ...names].filter(Boolean))].slice(0, 5)
}

/** 在场角色资料：同名卡带关系与说话方式，其他卡只给名字和关系。 */
export const buildSuggestionCastContext = (
  cast: string[],
  cards: CharacterCard[],
  currentName: string
) => {
  const rows = cast.map((name) => {
    const card = cards.find((item) => item.name === name)
    if (!card) {
      return `- ${name}${name === currentName ? '（本会话角色）' : ''}`
    }
    const details = [
      name === currentName ? '本会话角色' : '',
      card.relationship ? `与玩家：${card.relationship}` : '',
      card.style ? `说话方式：${card.style}` : '',
    ].filter(Boolean)
    return `- ${name}${details.length ? `（${details.join('；')}）` : ''}`
  })
  return rows.length > 0 ? rows.join('\n') : `- ${currentName}`
}

const leavePushPattern =
  /你(?:先|就|快|还)?[^。！？\n]{0,8}(?:走|出去|回去|离开|别待|别留)|别(?:站|待|留)[^。！？\n]{0,4}这|别进来|在门外等|在门口等|把门带上|你该走了|不用留下|不用陪我|我一个人(?:就|能|待|会)|别管我|滚出去|你先睡/
const playerLeavePattern =
  /(?:^|[\s（(])(?:我|咱)[^。！？\n]{0,10}(?:往门口走|走向门口|朝门口走|出去|离开|回去|下楼|出门|不待)|我走了|我先走|我出去|我离开|我下楼|我出门/
const playerRemotePattern =
  /(?:我|咱)[^。！？\n]{0,10}(?:在门外|在外面|在楼下|在街上|在路上|还在路上|在车上|还没进去|进不去)|我(?:还)?没到|我赶不过来|我过不去|我(?:马上|这就|快)(?:到|过去|过来)|我(?:在赶|赶过去|正在过去)|我(?:过去|过来)|等我(?:一下|一会儿)|你等我/
const playerStayPattern =
  /我(?:还|仍|就)在|我(?:还没|还没有|没)走|我不走|我在门口|我回来了|我回来|我(?:已经|刚)?到了|我到了|我进门|我进屋|我上来了/
/** 电话/赶路语境：角色问“听得到吗”“信号”，即使玩家没写位置，也说明两人不在同一空间 */
const characterPhonePattern =
  /听得到|听得见|信号|电话|打给你|你那边|你到哪|你还没到|你还没上来|你快点|等你|别挂/
/** 角色挽留不算把人往外推：“你别走”与“你走吧”方向相反，不能用同一组关键词判。 */
const characterKeepsPattern = /别走|不要走|别离开|留下|别出去|别回去/

/**
 * 判断玩家此刻的站位。优先看玩家最近几轮自己说的位置/行动，
 * 其次看角色最后一句有没有把玩家往外推，再看电话/赶路语境。
 * 只看最后一句会漏掉“我马上到”之后又聊了几轮的情况，所以同时接收最近消息。
 */
export const detectSuggestionPresence = ({
  lastCharacterLine = '',
  lastPlayerLine = '',
  recentMessages = [],
  castCount = 1,
}: {
  lastCharacterLine?: string
  lastPlayerLine?: string
  recentMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
  castCount?: number
}): { presence: SuggestionPresence; reason: string } => {
  const recent = recentMessages.filter((message) => message.content.trim())
  const players = recent.length
    ? recent.filter((message) => message.role === 'user').map((message) => message.content)
    : lastPlayerLine
      ? [lastPlayerLine]
      : []
  const characters = recent.length
    ? recent.filter((message) => message.role === 'assistant').map((message) => message.content)
    : lastCharacterLine
      ? [lastCharacterLine]
      : []

  // 从最近一条玩家发言往回找第一个明确的位置信号；后面没有再改口，就沿用这个站位。
  let playerSignal: SuggestionPresence | null = null
  for (const line of players.slice().reverse()) {
    if (playerStayPattern.test(line)) {
      playerSignal = 'together'
      break
    }
    if (playerLeavePattern.test(line)) {
      playerSignal = 'leaving'
      break
    }
    if (playerRemotePattern.test(line)) {
      playerSignal = 'remote'
      break
    }
  }

  const latestCharacter = characters.at(-1) ?? ''
  const characterPushes =
    leavePushPattern.test(latestCharacter) && !characterKeepsPattern.test(latestCharacter)
  // 电话语境会持续多轮，只查最后一句会漏；最近十条角色发言里提过信号/电话，就按远程处理。
  const characterOnPhone = characters.slice(-10).some((line) => characterPhonePattern.test(line))

  if (playerSignal === 'leaving') {
    return { presence: 'leaving', reason: '玩家最近已经说明要离开或正走向门外' }
  }
  if (playerSignal === 'together') {
    return { presence: 'together', reason: '玩家最近明确已经到场或仍留在角色身边' }
  }
  if (playerSignal === 'remote') {
    return {
      presence: 'remote',
      reason: '玩家最近说明自己还在赶路、门外、楼下或电话里，不在角色身边',
    }
  }
  if (characterPushes) {
    return {
      presence: 'leaving',
      reason: '角色最后一句在把玩家往外推，或暗示玩家该走了',
    }
  }
  if (characterOnPhone) {
    return {
      presence: 'remote',
      reason: '最近几轮是电话或赶路语境，玩家不在角色身边',
    }
  }
  if (castCount > 1) {
    return { presence: 'group', reason: '当前场景有多个角色在场' }
  }
  return { presence: 'together', reason: '玩家与角色仍在同一场景' }
}

/**
 * 场景快照：只写玩家能看到的时间、地点、在场人物、道具和气氛。
 * 幕后目标与冲突单独标记为“只用于判断下一步”，避免模型把导演信息写进建议。
 */
export const buildSuggestionSceneContext = ({
  scene,
  clockText,
  cast,
  presence,
  presenceReason,
  lastCharacterLine,
}: {
  scene?: Pick<
    SceneState,
    'time' | 'place' | 'weather' | 'atmosphere' | 'mood' | 'props' | 'objective' | 'conflict'
  >
  clockText?: string
  cast: string[]
  presence: SuggestionPresence
  presenceReason: string
  lastCharacterLine?: string
}) => {
  const presenceText =
    presence === 'leaving'
      ? '玩家正在离开或已经被角色推往门外；本批至少两条用括号旁白写玩家的动作、停顿或内心，不能继续追问屋里的事。'
      : presence === 'remote'
        ? '玩家不在角色身边（门外、楼下、路上或电话里）；不能假设玩家看得见屋内陈设或亲手碰到东西，也不能命令她站到某处；可以隔着电话让她看日期、念一句或先别动。'
      : presence === 'group'
        ? '多个角色同时在场；每条要明确对谁说话，不能把对话写成只剩本会话角色的二人场景。'
        : '玩家仍在同一场景；以对白为主，最多一条括号动作。'
  const rows = [
    clockText ? `剧情时间：${clockText}` : '',
    scene?.time ? `场景时间：${scene.time}` : '',
    scene?.place ? `地点：${scene.place}` : '',
    scene?.weather ? `天气：${scene.weather}` : '',
    `在场角色：${cast.join('、')}`,
    `玩家站位：${presenceText}（${presenceReason}）`,
    scene?.props ? `手边物件：${scene.props}` : '',
    scene?.atmosphere ? `气氛：${scene.atmosphere}` : '',
    scene?.mood ? `情绪：${scene.mood}` : '',
    scene?.objective ? `幕后目标（只用于判断下一步，不得照抄）：${scene.objective}` : '',
    scene?.conflict ? `幕后冲突（只用于判断下一步，不得照抄）：${scene.conflict}` : '',
    lastCharacterLine ? `角色最后一句：${lastCharacterLine}` : '',
  ].filter(Boolean)
  return rows.join('\n')
}

/** 把对话改写成有说话人标签的记录，避免模型把上一句角色台词继续当成自己的回合。 */
export const buildSuggestionTranscript = (
  cardName: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
) =>
  messages
    .map((message) => `${message.role === 'user' ? '玩家' : cardName}：${message.content}`)
    .join('\n')

/** 可单独回归的完整提问，确保身份约束、场景站位与去重规则不会在后续改动中丢失。 */
export const buildSuggestionAsk = ({
  card,
  stageText,
  sceneText,
  castText,
  presence = 'together',
  draft,
  transcript,
  previous = [],
}: {
  card: CharacterCard
  stageText: string
  sceneText?: string
  castText?: string
  presence?: SuggestionPresence
  draft: string
  transcript: string
  previous?: string[]
}) => {
  const cardText = buildSuggestionCardContext(card)
  const presenceLine =
    presence === 'leaving'
      ? '当前玩家正在离开或角色已经把玩家往外推：至少两条建议用“（”开头的玩家侧旁白/动作/内心，允许写走到门口、停下、回头或不回头的动作；不要继续写“屋里暗不暗”“站那儿”这类仍在屋内的追问。'
      : presence === 'remote'
        ? '当前玩家不在角色身边（门外、楼下、路上或电话里）：不要写玩家看见她屋里灯暗不暗、让她站那儿、假设玩家亲手碰到东西；可以隔着电话让她看日期或念一句，问她现在是否安全、说明自己多久到，或写玩家在门外/路上等待的动作。'
      : presence === 'group'
        ? '当前有多名角色在场：每条建议必须明确对谁说话，target 只能是【在场角色】里的名字或“在场所有人”；不要只回应本会话角色。'
        : '当前玩家仍在场：以对白为主，最多一条用“（”开头的玩家侧动作；不要三条都写成旁白。'
  return [
    `你是玩家这一侧，正在当前场景里回应「${card.name}」。替玩家写三条可以立刻发送的输入。`,
    '再次确认：不是替角色写，不是替角色接话，括号里只能写玩家自己的动作、视线或内心。',
    cardText ? `【角色参考，只用于理解她怎么说话；禁止把设定条目逐条搬进建议】\n${cardText}` : '',
    castText ? `【在场角色】\n${castText}` : '',
    sceneText ? `【当前场景与玩家站位】\n${sceneText}` : '',
    stageText ? `【当前轮次与阶段行为】\n${stageText}` : '',
    presenceLine,
    transcript ? `【最近两轮对话，角色的话只能当成她在对玩家说】\n${transcript}` : '',
    previous.length
      ? `【上一批建议，禁止原句复现或换词复读】\n${previous.map((line) => `- ${line}`).join('\n')}`
      : '',
    draft.trim() ? `【玩家已经输入到一半的话】\n${draft.trim()}` : '',
    [
      '【本批生成约束】',
      '1. 先判断角色最后一句在做什么、玩家站在哪里、这句话该对谁说，再决定三条建议的切入点。',
      '2. 三条必须方向不同，分别给 detail、emotion、action（旁白另算 aside）：detail 接住她刚说的具体细节，emotion 回应她的情绪、身体或关系，action 给一个能推进的动作或安排；不要三条都下指令、都问同一个物件，也不要三条都问句。',
      '3. 每条都要能落到当前场景的具体物件、动作、地点或台词；禁止“你还好吗”“要不要我陪你”“有什么我能帮你”这类通用关心。',
      '4. 每条必须是玩家口吻；若放到角色嘴里也成立，就说明身份错了，必须重写。',
      '5. 先写四条候选，四条分别覆盖不同 intent 与不同 topic，并尽量换 target；系统会去掉重复、未来线索、贴身错位和跑偏的候选，最终只展示三条。',
      '6. 不要三条都用“先……”或“别……”开头；同一批至少有一条直接回应她的情绪或关系，而不是继续给操作步骤。',
    ].join('\n'),
    '只输出 JSON 数组，四个对象。每个对象包含 mode、target、intent、topic、text。',
  ]
    .filter(Boolean)
    .join('\n\n')
}


const normalizeAside = (text: string) => {
  const trimmed = text.trim().replace(/^\(/, '（').replace(/\)$/, '）')
  if (trimmed.startsWith('（')) {
    return trimmed.endsWith('）') ? trimmed : `${trimmed}）`
  }
  return `（${trimmed}）`
}

const suggestionIntents = new Set<ReplySuggestionIntent>(['detail', 'emotion', 'action', 'aside'])

const normalizeIntent = (
  value: unknown,
  text: string,
  mode: ReplySuggestionMode
): ReplySuggestionIntent => {
  if (mode === 'aside') {
    return 'aside'
  }
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (suggestionIntents.has(raw as ReplySuggestionIntent)) {
    return raw as ReplySuggestionIntent
  }
  if (/[？?]|吗|呢|记得|是不是|对不对/.test(text)) {
    return 'detail'
  }
  if (/担心|害怕|心疼|累|难受|别急|别怕|我在|陪你|辛苦/.test(text)) {
    return 'emotion'
  }
  return 'action'
}

const normalizeTopic = (value: unknown, text: string) => {
  const raw = typeof value === 'string' ? value.trim().replace(/[。！？!?，,]/g, '') : ''
  if (raw) {
    return raw.slice(0, 12)
  }
  // 旧格式没有 topic 时，取正文里的一个短片段作近似主题；只用于同批去重，不展示。
  return text.replace(/[（(].*?[）)]/g, '').replace(/[“”"']/g, '').trim().slice(0, 12)
}

const normalizeTarget = (target: string | undefined, cast: string[], currentName: string) => {
  const trimmed = target?.trim()
  if (!trimmed || trimmed === '全场' || trimmed === '所有人') {
    return cast.length > 1 ? '在场所有人' : currentName
  }
  if (trimmed === '在场所有人') {
    return trimmed
  }
  return cast.includes(trimmed) ? trimmed : currentName
}

const toReplySuggestion = (
  item: unknown,
  cast: string[],
  currentName: string
): ReplySuggestion | undefined => {
  if (typeof item === 'string') {
    const raw = item.trim()
    if (!raw) {
      return undefined
    }
    const mode = /^[（(]/.test(raw) ? 'aside' : 'speech'
    const text = mode === 'aside' ? normalizeAside(raw) : raw
    return {
      text: text.slice(0, 180),
      mode,
      target: currentName,
      intent: normalizeIntent(undefined, text, mode),
      topic: normalizeTopic(undefined, text),
    }
  }
  if (!item || typeof item !== 'object') {
    return undefined
  }
  const record = item as Record<string, unknown>
  const rawText =
    typeof record.text === 'string'
      ? record.text
      : typeof record.content === 'string'
        ? record.content
        : typeof record.line === 'string'
          ? record.line
          : ''
  const text = rawText.trim()
  if (!text) {
    return undefined
  }
  const rawMode = typeof record.mode === 'string' ? record.mode.trim().toLowerCase() : ''
  const mode: ReplySuggestion['mode'] =
    rawMode === 'aside' || rawMode === 'narration' || rawMode === 'action' || /^[（(]/.test(text)
      ? 'aside'
      : 'speech'
  const normalized = mode === 'aside' ? normalizeAside(text) : text
  const target =
    typeof record.target === 'string'
      ? normalizeTarget(record.target, cast, currentName)
      : normalizeTarget(undefined, cast, currentName)
  return {
    text: normalized.slice(0, 180),
    mode,
    target,
    intent: normalizeIntent(record.intent ?? record.kind ?? record.type, normalized, mode),
    topic: normalizeTopic(record.topic ?? record.subject, normalized),
  }
}

/** 从模型输出里取建议；支持对象数组、字符串数组、编号列表与代码块。 */
export const parseReplySuggestions = (
  raw: string,
  cast: string[] = [],
  currentName = ''
): ReplySuggestion[] => {
  const cleaned = raw
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1))
      if (Array.isArray(parsed)) {
        const list = parsed
          .map((item) => toReplySuggestion(item, cast, currentName))
          .filter((item): item is ReplySuggestion => Boolean(item?.text))
        if (list.length > 0) {
          const seen = new Set<string>()
          return list
            .filter((item) => {
              const key = item.text.replace(/[^\p{L}\p{N}]/gu, '')
              if (!key || seen.has(key)) {
                return false
              }
              seen.add(key)
              return true
            })
            .slice(0, 4)
        }
      }
    } catch {
      // JSON 不完整时继续按行解析
    }
  }
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.、)])\s*/, '').trim())
    .map((line) => line.replace(/^["“]|["”]$/g, '').trim())
    .filter((line) => {
      if (!line) {
        return false
      }
      const wrappers = new Set(['[', ']', '{', '}'])
      return ![...line].every((char) => wrappers.has(char))
    })
  const list = lines
    .map((line) => toReplySuggestion(line, cast, currentName))
    .filter((item): item is ReplySuggestion => Boolean(item?.text))
  const seen = new Set<string>()
  return list
    .filter((item) => {
      const key = item.text.replace(/[^\p{L}\p{N}]/gu, '')
      if (!key || seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    .slice(0, 3)
}

/** 去掉标点和空格后比较；两句只差标点或语气词时视为同一句。 */
const suggestionFingerprint = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** 双字重合度用于拦截“换词复述”，避免同一句只改一两个字又出现。 */
const suggestionSimilarity = (left: string, right: string) => {
  const a = suggestionFingerprint(left)
  const b = suggestionFingerprint(right)
  if (!a || !b) {
    return 0
  }
  if (a === b) {
    return 1
  }
  if (a.length < 2 || b.length < 2) {
    return 0
  }
  const grams = (value: string) => {
    const chars = [...value]
    return new Set(chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`))
  }
  const leftGrams = grams(a)
  const rightGrams = grams(b)
  let shared = 0
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) {
      shared += 1
    }
  }
  return shared / Math.max(1, Math.min(leftGrams.size, rightGrams.size))
}

/**
 * 硬过滤尚未到点的线索词：模型即使从卡设里看见旧疤、暗号或储物间，
 * 也不能把它们写成玩家此刻的建议。只比较已归一化的关键词，不做语义扩写。
 */
export const filterPrematureSuggestions = (
  candidates: string[],
  blockedTerms: string[] = []
): string[] => {
  if (blockedTerms.length === 0) {
    return candidates
  }
  return candidates.filter((candidate) => {
    const normalized = suggestionFingerprint(candidate)
    return !blockedTerms.some((term) => normalized.includes(term))
  })
}

/**
 * 候选去重：先排除上一批建议，再保证本批三条彼此不像。
 * 模型偶尔会只改一个词复读，因此用双字重合度而不是简单的字符串相等。
 */
export const pickFreshSuggestions = (candidates: string[], previous: string[] = []): string[] => {
  const picked: string[] = []
  for (const candidate of candidates) {
    const text = candidate.trim()
    if (!text || picked.length >= 3) {
      continue
    }
    if (picked.some((item) => suggestionSimilarity(item, text) >= 0.76)) {
      continue
    }
    if (previous.some((item) => suggestionSimilarity(item, text) >= 0.7)) {
      continue
    }
    picked.push(text)
  }
  return picked
}

/** 玩家不在身边时，出现这些词就说明模型又把玩家写成贴身站着。 */
const misplacedPlayerPattern =
  /(?:你|您)[^。！？\n]{0,6}(?:站|坐)在(?:那|这)|站那儿|站着看|你手边|你屋里|你身后|递(?:给|过)我|把(?:东西|它|那个)递/
/** 同批里最多让一个物件反复出现：报纸、眼镜、窗户各自只占一条，避免整批围着同一件东西打转。 */
const sceneObjectPattern = /报纸|老花镜|眼镜|窗户|窗台|窗|布鞋|藤椅|垫子|镜子|信号|电话|手机|日期|门把|灯/g
const sceneObjectsOf = (text: string) => {
  const matches = text.match(sceneObjectPattern) ?? []
  return new Set(matches.map((item) => (item === '老花镜' ? '眼镜' : item === '窗台' || item === '窗' ? '窗户' : item)))
}
/** 开头指令词相同就算同一句式：“先……”“别……”“你先把……”。 */
const openingKey = (text: string) => {
  const stripped = text.replace(/^[（(]\s*/, '')
  return /^(?:先|别|你先把|你先|快|赶紧|要不)/.exec(stripped)?.[0] ?? ''
}
const suggestionTopicKey = (candidate: ReplySuggestion) =>
  candidate.topic?.trim() || normalizeTopic(undefined, candidate.text)

/** 按玩家站位去掉贴身错位与看不见屋内的建议；远程时也只保留隔着电话能说出口的话。 */
export const filterSuggestionFit = (
  candidates: ReplySuggestion[],
  presence: SuggestionPresence
): ReplySuggestion[] => {
  if (presence !== 'remote' && presence !== 'leaving') {
    return candidates
  }
  return candidates.filter((candidate) => {
    if (candidate.mode === 'aside' && /看见|屋里|屋内|身后|手边/.test(candidate.text)) {
      return false
    }
    return !misplacedPlayerPattern.test(candidate.text)
  })
}

/** 三条是否真的错开：至少两种方向、至少一条情绪/旁白、topic 不重复。 */
export const hasSuggestionMix = (items: ReplySuggestion[]) => {
  if (items.length < 3) {
    return false
  }
  const intents = new Set(items.map((item) => item.intent))
  const topics = new Set(items.map(suggestionTopicKey).filter(Boolean))
  const hasFeeling = items.some((item) => item.intent === 'emotion' || item.mode === 'aside')
  const allAction = items.every((item) => item.intent === 'action')
  const allDetail = items.every((item) => item.intent === 'detail')
  const seenObjects = new Set<string>()
  for (const item of items) {
    for (const object of sceneObjectsOf(item.text)) {
      if (seenObjects.has(object)) {
        return false
      }
      seenObjects.add(object)
    }
  }
  return intents.size >= 2 && hasFeeling && !allAction && !allDetail && topics.size >= 2
}

/**
 * 带 mode/target 的去重版本。除了文本相似度，还要保证方向、主题和句式错开：
 * 三条都在“报纸日期”或都用“先……”开头时，宁可少一条让上层重试，也不硬凑满三条。
 */
export const pickFreshReplySuggestions = (
  candidates: ReplySuggestion[],
  previous: string[] = [],
  options: { presence?: SuggestionPresence } = {}
): ReplySuggestion[] => {
  const presence = options.presence ?? 'together'
  const maxAside = presence === 'leaving' ? 3 : 1
  const ordered = presence === 'leaving'
    ? [...candidates.filter((item) => item.mode === 'aside'), ...candidates.filter((item) => item.mode !== 'aside')]
    : candidates
  const picked: ReplySuggestion[] = []
  const topics = new Set<string>()
  const intents = new Set<string>()
  const objects = new Set<string>()
  const openings = new Set<string>()
  let asides = 0

  const canTake = (candidate: ReplySuggestion, strict: boolean) => {
    const text = candidate.text.trim()
    if (!text) {
      return false
    }
    if (picked.some((item) => suggestionSimilarity(item.text, text) >= 0.76)) {
      return false
    }
    if (previous.some((item) => suggestionSimilarity(item, text) >= 0.7)) {
      return false
    }
    if (candidate.mode === 'aside' && asides >= maxAside) {
      return false
    }
    const topic = suggestionTopicKey(candidate)
    if (topic && topics.has(topic)) {
      return false
    }
    // 物件与开头在两道筛选里都必须唯一：放宽只能放宽 intent，不能让三条又围回报纸/眼镜。
    const objectSet = sceneObjectsOf(text)
    if ([...objectSet].some((object) => objects.has(object))) {
      return false
    }
    const opening = openingKey(text)
    if (opening && openings.has(opening)) {
      return false
    }
    if (strict && candidate.intent && intents.has(candidate.intent)) {
      return false
    }
    return true
  }

  const take = (candidate: ReplySuggestion) => {
    const text = candidate.text.trim()
    const topic = suggestionTopicKey(candidate)
    if (topic) {
      topics.add(topic)
    }
    if (candidate.intent) {
      intents.add(candidate.intent)
    }
    for (const object of sceneObjectsOf(text)) {
      objects.add(object)
    }
    const opening = openingKey(text)
    if (opening) {
      openings.add(opening)
    }
    if (candidate.mode === 'aside') {
      asides += 1
    }
    picked.push({ ...candidate, text })
  }

  for (const candidate of ordered) {
    if (picked.length >= 3) {
      break
    }
    if (canTake(candidate, true)) {
      take(candidate)
    }
  }
  // 第一轮太严时放宽 intent/物件重复，但 topic、句式与旁白上限仍然保留，避免退回三种同款。
  for (const candidate of ordered) {
    if (picked.length >= 3) {
      break
    }
    if (canTake(candidate, false)) {
      take(candidate)
    }
  }
  return picked
}
/* ============================================================================
 * 功能区：会话与角色核心 / suggestionsContext 结束
 * ========================================================================== */
