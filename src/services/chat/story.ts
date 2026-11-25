/* ============================================================================
 * 功能区：会话与角色核心 / story 开始
 * 职责：限时推理角色卡的虚拟时钟、阶段注入、结局标记、线索链与会话锁定。
 * 导出：STORY_END_MARKERS、advanceStoryClock、createStoryState、detectStoryEnd、
 *       formatStoryClock、formatStoryRemaining、formatStoryTurnBlock、
 *       isStoryLocked、limitStoryAsides、storyPhaseOf、stripStoryMarkers、
 *       storyTurnNumber、formatStorySuggestionContext、matchStoryClueQuestion、
 *       confirmStoryClueFromQuestion。
 * ========================================================================== */

import type { CharacterStory, CharacterStoryClue } from './roleplay.js'
import type { Session } from './types.js'

export const STORY_END_MARKERS = {
  bad: '[[STORY_END:BAD]]',
  good: '[[STORY_END:GOOD]]',
} as const

const END_PATTERN = /\[\[STORY_END:(BAD|GOOD)\]\]/g
const END_PATTERN_SINGLE = /\[\[STORY_END:(BAD|GOOD)\]\]/
const ASIDE_IN_LINE = /（[^（）]*）|\([^()]*\)/g

/** 与 aside 服务同一口径：只把同行成对括号当成独白，未闭合括号留在正文。 */
const splitStoryAsides = (text: string) => {
  const parts: Array<{ text: string; aside: boolean }> = []
  let cursor = 0
  for (const match of text.matchAll(ASIDE_IN_LINE)) {
    const start = match.index ?? 0
    if (start > cursor) {
      parts.push({ text: text.slice(cursor, start), aside: false })
    }
    parts.push({ text: match[0], aside: true })
    cursor = start + match[0].length
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), aside: false })
  }
  return parts
}

const hasStoryAside = (text: string) => /（[^（）]*）|\([^()]*\)/.test(text)

export type StoryPhase = 'normal' | 'anomaly' | 'deadline'

/** 虚拟分钟数转为 HH:MM；跨日仍按 00:00–23:59 显示。 */
export const formatStoryClock = (minute: number) => {
  if (minute >= 24 * 60) {
    return '00:00'
  }
  const value = Math.min(24 * 60 - 1, Math.max(0, Math.round(minute)))
  const hour = Math.floor(value / 60)
  const rest = value % 60
  return `${String(hour).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/** 距离截止的剩余时间；已经到点或越界时返回 0。 */
export const formatStoryRemaining = (minute: number, deadline: number) => {
  const rest = Math.max(0, deadline - minute)
  const hour = Math.floor(rest / 60)
  const minutes = rest % 60
  if (hour > 0 && minutes > 0) {
    return `${hour} 小时 ${minutes} 分钟`
  }
  if (hour > 0) {
    return `${hour} 小时`
  }
  return `${minutes} 分钟`
}

/** 已经到点的调查线索：只按时间解锁，不读取玩家输入，也不补发历史。 */
export const storyCluesUntil = (story: CharacterStory, minute: number): CharacterStoryClue[] =>
  (story.clues ?? []).filter((clue) => clue.atMinute <= minute)

/** 当前最新一层线索；尚未进入异变或没有配置时返回 undefined。 */
export const currentStoryClue = (
  story: CharacterStory,
  minute: number
): { clue: CharacterStoryClue; index: number; total: number } | undefined => {
  const clues = story.clues ?? []
  if (clues.length === 0) {
    return undefined
  }
  const revealed = clues.filter((clue) => clue.atMinute <= minute)
  const clue = revealed.at(-1)
  return clue ? { clue, index: revealed.length - 1, total: clues.length } : undefined
}

/** 线索在会话里的稳定 id：优先用卡里配置的标题和时间，不依赖数组下标。 */
export const storyClueKey = (clue: CharacterStoryClue) => `${clue.atMinute}:${clue.title.trim()}`

/** 玩家已经发送的剧情轮次；开场为 0，第一次发送后为 1。 */
export const storyTurnNumber = (story: CharacterStory, session: Session | null | undefined) => {
  if (!session || session.storyClockMinute === undefined) {
    return 0
  }
  return Math.max(
    0,
    Math.ceil((session.storyClockMinute - story.startMinute) / Math.max(1, story.stepMinutes))
  )
}

/**
 * 回复建议用的阶段上下文：只给说话方式、当前可观察行为和建议边界，
 * 不把完整线索链或真相交给建议模型，避免它替玩家提前破案。
 */
export const formatStorySuggestionContext = (
  story: CharacterStory | undefined,
  session: Session | null | undefined
) => {
  if (!story || !session || session.storyClockMinute === undefined) {
    return ''
  }
  const minute = session.storyClockMinute
  const phase = storyPhaseOf(story, minute)
  const turn = storyTurnNumber(story, session)
  const phaseTurn =
    phase === 'normal'
      ? Math.min(
          turn,
          Math.max(1, Math.ceil((story.normalUntilMinute - story.startMinute) / story.stepMinutes))
        )
      : Math.max(1, Math.ceil((minute - story.normalUntilMinute) / story.stepMinutes))
  const lines = [
    phase === 'normal'
      ? `当前是第 ${turn} 轮，正常阶段第 ${phaseTurn} 轮；虚拟时间 ${formatStoryClock(minute)}。`
      : `当前是第 ${turn} 轮，异变阶段第 ${phaseTurn} 轮；虚拟时间 ${formatStoryClock(minute)}。`,
  ]
  if (story.publicScene) {
    lines.push(`当前环境：${story.publicScene}`)
  }
  if (phase === 'normal') {
    lines.push(
      '角色还是本人：短句、语速快，常把一句话拆成两三条发，每条都有标点；被唠叨时先顶一句再软下来，害怕时会装作没事。',
      '建议应围绕她刚说的话回应，可以顺着生活细节追问、表达关心或提出具体行动；不要把角色卡里的背景整段搬进建议。'
    )
  } else if (phase === 'anomaly') {
    const current = currentStoryClue(story, minute)
    lines.push(
      '对方仍在模仿妹妹的称呼和短句，但消息不再使用标点，句子更硬，回答会绕开具体回忆；括号独白可能像算计，也可能没有。',
      '建议要用已经出现过的生活细节做交叉验证，或指出语气变化但不直接揭穿；不要写“你是不是假的”这种会让它顺着演的空泛问题。'
    )
    if (current) {
      lines.push(
        `当前可观察的异常层：第 ${current.index + 1}/${current.total} 层「${current.clue.title}」。${
          current.clue.behavior ?? current.clue.hint
        }`
      )
    }
  } else {
    lines.push('已经到零点，只剩最后一幕；建议必须围绕识破、拒绝承认和救人，不能再抛新的日常钩子。')
  }
  lines.push('不得写出尚未出现的线索、完整线索链、角色秘密、结局或角色台词；每条只推进一小步。')
  return lines.join('\n')
}

const normalizeClueProbe = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * 玩家问题是否贴近某个已经到点的线索：只做候选确认，不读取完整对话。
 * 必须同时满足“已进入异变/判定阶段”和“命中该层 triggers”，避免正常阶段提前解锁。
 */
export const matchStoryClueQuestion = (
  story: CharacterStory | undefined,
  session: Session | null | undefined,
  text: string
): { clue: CharacterStoryClue; index: number; total: number } | undefined => {
  if (!story || !session || session.storyClockMinute === undefined) {
    return undefined
  }
  const phase = storyPhaseOf(story, session.storyClockMinute)
  if (phase === 'normal') {
    return undefined
  }
  const normalized = normalizeClueProbe(text)
  if (normalized.length < 2) {
    return undefined
  }
  let best: { clue: CharacterStoryClue; index: number; total: number; hits: number } | undefined
  for (const [index, clue] of storyCluesUntil(story, session.storyClockMinute).entries()) {
    const hits = (clue.triggers ?? []).reduce((count, trigger) => {
      const normalizedTrigger = normalizeClueProbe(trigger)
      return normalizedTrigger && normalized.includes(normalizedTrigger) ? count + 1 : count
    }, 0)
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { clue, index, total: story.clues?.length ?? 0, hits }
    }
  }
  return best ? { clue: best.clue, index: best.index, total: best.total } : undefined
}

/**
 * 玩家问到点子上后，把线索链标记为已确认，并留下一次性弹窗提示。
 * 同一层只确认一次；已确认过的线索不会重复弹窗。
 */
export const confirmStoryClueFromQuestion = (
  story: CharacterStory | undefined,
  session: Session | null | undefined,
  text: string
): Pick<Session, 'storyClueIds' | 'storyClueNotice'> | null => {
  const match = matchStoryClueQuestion(story, session, text)
  if (!match) {
    return null
  }
  const key = storyClueKey(match.clue)
  if (session?.storyClueIds?.includes(key)) {
    return null
  }
  return {
    storyClueIds: [...(session?.storyClueIds ?? []), key],
    storyClueNotice: key,
  }
}

/**
 * 尚未到点的线索关键词：建议生成后用它做一次硬过滤，
 * 避免模型看见卡设旧事就提前把后面的疤、暗号、储物间写进玩家建议。
 */
export const futureStoryClueTerms = (
  story: CharacterStory | undefined,
  session: Session | null | undefined
): string[] => {
  if (!story || !session || session.storyClockMinute === undefined) {
    return []
  }
  const minute = session.storyClockMinute
  const terms = new Set<string>()
  for (const clue of story.clues ?? []) {
    if (clue.atMinute <= minute) {
      continue
    }
    for (const trigger of clue.triggers ?? []) {
      const normalized = normalizeClueProbe(trigger)
      if (normalized.length >= 2) {
        terms.add(normalized)
      }
    }
  }
  return [...terms]
}

/** 给回复建议看的公开状态：只告诉时间、阶段和线索标题，不暴露卡内秘密。 */ export const formatStoryPublicStatus =
  (story: CharacterStory | undefined, session: Session | null | undefined) => {
    if (!story || !session || session.storyClockMinute === undefined) {
      return ''
    }
    const minute = session.storyClockMinute
    const phase = storyPhaseOf(story, minute)
    const current = currentStoryClue(story, minute)
    const lines = [
      `当前虚拟时间 ${formatStoryClock(minute)}，距零点还有 ${formatStoryRemaining(minute, story.deadlineMinute)}。`,
      phase === 'normal'
        ? '妹妹目前仍像本人，语气、标点和短句习惯正常。'
        : phase === 'anomaly'
          ? '聊天对象已经出现异常，但玩家还不知道原因。'
          : '已经到达零点，只能写最后一幕，不能再给可继续的钩子。',
    ]
    if (current) {
      lines.push(
        `玩家目前已经遇到第 ${current.index + 1}/${current.total} 层异常「${current.clue.title}」。`
      )
    }
    lines.push('建议只能使用玩家已经看到的内容，禁止写出角色卡秘密、真相、后续线索或角色台词。')
    return lines.join('\n')
  }

/** 20:00–22:00 为本人，22:01–23:59 异变，00:00 起进入判定轮。 */
export const storyPhaseOf = (story: CharacterStory, minute: number): StoryPhase => {
  if (minute >= story.deadlineMinute) {
    return 'deadline'
  }
  return minute > story.normalUntilMinute ? 'anomaly' : 'normal'
}

/**
 * 内心独白的硬上限：提示词只能降低概率，这里按最近两轮兜底。
 * 最近两条回复只要有一条独白，本轮就全部剔除；同一条独白在最近三轮出现过也剔除。
 * 允许保留时最多保留一条，避免一轮里连续写两三句心理分析。
 */
export const limitStoryAsides = (
  text: string,
  story: CharacterStory | undefined,
  session: Session | null | undefined,
  previousReplies: string[] = []
): string => {
  if (!text || !story || !session || session.storyClockMinute === undefined) {
    return text
  }
  const phase = storyPhaseOf(story, session.storyClockMinute)
  if (phase === 'deadline') {
    return text
  }
  const recent = previousReplies.slice(-2)
  const blocked = recent.some(hasStoryAside)
  const recentAsides = new Set(
    previousReplies
      .slice(-3)
      .flatMap((reply) => splitStoryAsides(reply).filter((part) => part.aside))
      .map((part) => part.text.trim())
  )
  let kept = false
  const cleaned = splitStoryAsides(text)
    .map((part) => {
      if (!part.aside) {
        return part.text
      }
      if (blocked || kept || recentAsides.has(part.text.trim())) {
        return ''
      }
      kept = true
      return part.text
    })
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
  // 极端情况下模型整条回复只有一句独白，清空会让消息变成空白；这时保留原文，交给提示词约束。
  return cleaned.trim() ? cleaned : text
}

export const createStoryState = (story: CharacterStory) => ({
  storyClockMinute: story.startMinute,
  storyState: 'active' as const,
  storyFinalTurn: false,
})

/** 只有 active 的剧情还能继续；失败或成功后都锁死当前会话。 */
export const isStoryLocked = (session: Session | null | undefined) =>
  session?.storyState === 'bad_end' || session?.storyState === 'good_end'

/**
 * 每轮只推进 stepMinutes，最多推到 00:00；跨过本人阶段时落在 22:01，确保异变从第一分钟开始。
 * 到达截止的这一轮仍允许模型输出最后一幕，由结束标记或落库兜底改成 bad_end。
 */
export const advanceStoryClock = (
  story: CharacterStory,
  session: Session
): Pick<Session, 'storyClockMinute' | 'storyFinalTurn'> => {
  const current = session.storyClockMinute ?? story.startMinute
  let next = Math.min(story.deadlineMinute, current + story.stepMinutes)
  if (current <= story.normalUntilMinute && next > story.normalUntilMinute) {
    next = Math.min(story.deadlineMinute, story.normalUntilMinute + 1)
  }
  return {
    storyClockMinute: next,
    storyFinalTurn: next >= story.deadlineMinute,
  }
}

export const detectStoryEnd = (text: string): 'bad' | 'good' | null => {
  const match = text.match(END_PATTERN_SINGLE)
  if (!match) {
    return null
  }
  return match[1] === 'BAD' ? 'bad' : 'good'
}

/** 结束标记只给前端判定，不进正文，也不留给模型下一轮复读。 */
export const stripStoryMarkers = (text: string) => text.replace(END_PATTERN, '').trimEnd()

/**
 * 本轮追加的剧情时钟与阶段约束。
 * 放在用户消息末尾而不是 system，避免每轮变化打断缓存前缀。
 */
export const formatStoryTurnBlock = (
  story: CharacterStory | undefined,
  session: Session | null | undefined
) => {
  if (!story || !session || session.storyClockMinute === undefined) {
    return ''
  }
  if (isStoryLocked(session)) {
    return ''
  }
  const minute = session.storyClockMinute
  const phase = storyPhaseOf(story, minute)
  const clock = formatStoryClock(minute)
  const remaining = formatStoryRemaining(minute, story.deadlineMinute)
  const common = [
    `【本轮剧情时钟】${clock}，距离零点还有 ${remaining}。`,
    '时间只按这张卡的时间线推进；不要读取手机时间，不要把时间写快或写慢。',
  ]
  if (phase === 'normal') {
    return [
      ...common,
      '这一轮妹妹仍是本人：说话习惯、称呼、标点和日常反应都要和开场一致；可以埋很小的不安，但不能提前揭底，也不能突然不用标点。',
      '正常阶段可以在一轮里自然埋一个以后能回收的生活细节：左腕旧疤、奶奶的红豆糕、旧屋动线或自己的标点习惯；一轮最多一个，只说生活细节，不解释含义，也不要每轮都埋。',
      '本人偶尔会写一句真实、短促的括号内心独白，最多三十字；22:00 前至少自然出现一次，但不要每轮都写，也不要写成大段心理分析。',
      '玩家还没找到真相，不要主动解释超自然内容，不要暗示“她不是本人”。',
    ].join('\n')
  }
  if (phase === 'anomaly') {
    const current = currentStoryClue(story, minute)
    const clueLine = current
      ? [
          `【本轮线索层】第 ${current.index + 1}/${current.total} 层「${current.clue.title}」。`,
          current.clue.behavior ? `本轮玩家能看到：${current.clue.behavior}` : '',
          `调查方向：${current.clue.hint}`,
          '本轮必须让这一层异常自然出现一次；不要提前揭示更后面的层，也不要解释线索本身。',
        ]
          .filter(Boolean)
          .join('\n')
      : ''
    return [
      ...common,
      '这一轮起，和你对话的东西已经不再是本人。它记得妹妹说过的话，会模仿她的称呼和短句，但学不会她的标点习惯：从本轮开始，你输出的每条消息都不使用逗号、句号、问号、叹号、顿号、分号、冒号和引号，只用空格或换行断句。',
      '替身会模仿括号独白，但只会写功能性的假心声，或者干脆不写；不要连续两轮写，最多每三回合一次，不要照抄“他应该没发现”这类示例。它没有本人那种没来得及说出口的犹豫，但不要说明两者的区别。',
      clueLine,
      '不要解释为什么没有标点，不要承认自己不是妹妹；被追问时用停顿、岔开、重复旧话或轻微敌意应对。不要一次把真相说完。',
      '真正的妹妹还被关在旧屋储物间里，意识清醒但无法拿回手机。这个事实只能由玩家通过对话和线索推断出来，不能由你直接宣布。',
    ]
      .filter(Boolean)
      .join('\n')
  }
  return [
    ...common,
    '这是截止轮：零点已到。若玩家还没有完成识别与救援，写出妹妹最后一条消息或彻底安静下来，让对话在这个时间点断掉；正文末尾单独一行输出 [[STORY_END:BAD]]，不得再给可继续的钩子。',
    '只有玩家在本轮之前已经明确识破替身、拒绝承认它是妹妹，并说明要去旧屋储物间救出本人，才允许输出成功结局和 [[STORY_END:GOOD]]。',
  ].join('\n')
}

/* ============================================================================
 * 功能区：会话与角色核心 / story 结束
 * ========================================================================== */
