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

/** 一条建议；target 只用于界面标注和模型自检，填入输入框时只写 text */
export type ReplySuggestion = {
  text: string
  mode: ReplySuggestionMode
  /** 当前在场角色名，或「在场所有人」 */
  target?: string
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
  '不要默认玩家就在她身边：场景没写玩家站位、或玩家上一句已经离开/在门外时，不能写“你手边”“你屋里”“你身后”这类只有贴身站立才知道的细节，也不能命令她“站那儿”“翻给我看”“念给我听”。',
  '角色卡设定只用来判断她的称呼、语气、习惯和边界，是参考不是素材库；不要把设定里的旧事、物件和背景每条都搬进建议。',
  '多角色场景要先确认这句话是对谁说的：只能用【在场角色】里出现过的名字，不能把不在场的人写进来；对全场说话时用“你们”或“两个人”。',
  '实际生成依据是最近两轮对话、当前场景快照和角色此刻的行为；每条只回应当前这一小步，不跳步、不替下一轮写剧情。',
  '上一批建议里的句子不能再出现，也不要用近义改写复读；玩家已经看过的建议视为过期。',
  '正常阶段顺着本人语气回应，不要提前把异变、替身或后续线索说破；异变阶段用已经出现过的细节做验证，不要空泛地问“你是不是假的”；截止阶段只写识破、拒绝承认和救人。',
  '只能使用最近对话和场景里玩家已经看到的信息。不要把角色卡秘密、真相、后续线索或完整线索链直接说破；玩家还没掌握的证据只能写成怀疑或试探。',
  '只输出一个 JSON 数组，四个对象，不要代码块：',
  '[{"mode":"speech","target":"角色名","text":"……"},{"mode":"aside","target":"角色名","text":"（……）"}]',
  'mode 只能是 speech 或 aside；target 只能是【在场角色】里的名字或“在场所有人”；aside 的 text 必须以“（”开头。',
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
  /(?:^|[\s（(])(?:我|咱)[^。！？\n]{0,10}(?:走|出去|离开|回去|下楼|出门|不待)|我走了|我先走|我出去|我离开|我下楼|我出门/
const playerRemotePattern =
  /(?:我|咱)[^。！？\n]{0,8}(?:在门外|在外面|在楼下|在街上|在路上|还在路上|还没进去|进不去)|我(?:还)?没到|我赶不过来|我过不去/
const playerStayPattern =
  /我(?:还|仍|就)在|我(?:还没|还没有|没)走|我不走|我在门口|我回来了|我回来/
/** 角色挽留不算把人往外推：“你别走”与“你走吧”方向相反，不能用同一组关键词判。 */
const characterKeepsPattern = /别走|不要走|别离开|留下|别出去|别回去/

/**
 * 判断玩家此刻的站位。优先看角色最后一句有没有把玩家往外推，
 * 其次看玩家上一句是不是已经在做离开动作；角色喊“站那儿”不等于玩家已经离开。
 */
export const detectSuggestionPresence = ({
  lastCharacterLine = '',
  lastPlayerLine = '',
  castCount = 1,
}: {
  lastCharacterLine?: string
  lastPlayerLine?: string
  castCount?: number
}): { presence: SuggestionPresence; reason: string } => {
  const characterPushes =
    leavePushPattern.test(lastCharacterLine) && !characterKeepsPattern.test(lastCharacterLine)
  const playerLeaves = playerLeavePattern.test(lastPlayerLine) && !playerStayPattern.test(lastPlayerLine)
  const playerRemote =
    playerRemotePattern.test(lastPlayerLine) &&
    !playerStayPattern.test(lastPlayerLine) &&
    !playerLeaves
  if (playerLeaves) {
    return { presence: 'leaving', reason: '玩家上一句已经在离开或走向门外' }
  }
  if (playerRemote) {
    return { presence: 'remote', reason: '玩家上一句说明自己在门外、楼下或路上，不在角色身边' }
  }
  if (playerStayPattern.test(lastPlayerLine)) {
    return { presence: 'together', reason: '玩家上一句明确还在场' }
  }
  if (characterPushes) {
    return {
      presence: 'leaving',
      reason: '角色最后一句在把玩家往外推，或暗示玩家该走了',
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
        ? '玩家不在角色身边（门外、楼下或路上）；不能假设玩家看得见屋内陈设，也不能让玩家隔着距离命令她站、翻、念或把东西递过来。'
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
        ? '当前玩家不在角色身边（门外、楼下或路上）：不要写玩家看见她屋里灯暗不暗、让她站那儿或把东西递过来；改为隔着门/电话能听到的动静、问她现在是否安全、说明自己多久到，或写玩家在门外等待的动作。'
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
      '2. 三条必须方向不同：一条接住她刚说的具体细节，一条给情绪或态度，一条用动作/验证推进；不要三条都问同一个物件，也不要三条都问句。',
      '3. 每条都要能落到当前场景的具体物件、动作、地点或台词；禁止“你还好吗”“要不要我陪你”“有什么我能帮你”这类通用关心。',
      '4. 每条必须是玩家口吻；若放到角色嘴里也成立，就说明身份错了，必须重写。',
      '5. 先写四条候选，覆盖不同方向与不同 target；系统会去掉重复、未来线索和跑偏的一条，最终只展示三条。',
    ].join('\n'),
    '只输出 JSON 数组，四个对象。每个对象包含 mode、target、text。',
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
    return { text: text.slice(0, 180), mode, target: currentName }
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
  return { text: normalized.slice(0, 180), mode, target }
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

/** 带 mode/target 的去重版本；文本相似度沿用同一套规则。 */
export const pickFreshReplySuggestions = (
  candidates: ReplySuggestion[],
  previous: string[] = []
): ReplySuggestion[] => {
  const picked: ReplySuggestion[] = []
  for (const candidate of candidates) {
    const text = candidate.text.trim()
    if (!text || picked.length >= 3) {
      continue
    }
    if (picked.some((item) => suggestionSimilarity(item.text, text) >= 0.76)) {
      continue
    }
    if (previous.some((item) => suggestionSimilarity(item, text) >= 0.7)) {
      continue
    }
    picked.push({ ...candidate, text })
  }
  return picked
}
/* ============================================================================
 * 功能区：会话与角色核心 / suggestionsContext 结束
 * ========================================================================== */
