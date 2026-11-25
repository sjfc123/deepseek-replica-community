/* ============================================================================
 * 功能区：会话与角色核心 / story 开始
 * 职责：限时推理角色卡的虚拟时钟、阶段注入、结局标记与会话锁定。
 * 导出：STORY_END_MARKERS、advanceStoryClock、createStoryState、detectStoryEnd、
 *       formatStoryClock、formatStoryRemaining、formatStoryTurnBlock、
 *       isStoryLocked、storyPhaseOf、stripStoryMarkers。
 * ========================================================================== */

import type { CharacterStory } from './roleplay.js'
import type { Session } from './types.js'

export const STORY_END_MARKERS = {
  bad: '[[STORY_END:BAD]]',
  good: '[[STORY_END:GOOD]]',
} as const

const END_PATTERN = /\[\[STORY_END:(BAD|GOOD)\]\]/g
const END_PATTERN_SINGLE = /\[\[STORY_END:(BAD|GOOD)\]\]/

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

/** 20:00–22:00 为本人，22:01–23:59 异变，00:00 起进入判定轮。 */
export const storyPhaseOf = (story: CharacterStory, minute: number): StoryPhase => {
  if (minute >= story.deadlineMinute) {
    return 'deadline'
  }
  return minute > story.normalUntilMinute ? 'anomaly' : 'normal'
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
      '玩家还没找到真相，不要主动解释超自然内容，不要暗示“她不是本人”。',
    ].join('\n')
  }
  if (phase === 'anomaly') {
    return [
      ...common,
      '这一轮起，和你对话的东西已经不再是本人。它记得妹妹说过的话，会模仿她的称呼和短句，但学不会她的标点习惯：从本轮开始，你输出的每条消息都不使用逗号、句号、问号、叹号、顿号、分号、冒号和引号，只用空格或换行断句。',
      '不要解释为什么没有标点，不要承认自己不是妹妹；被追问时用停顿、岔开、重复旧话或轻微敌意应对。可以逐步露出对不上的细节，但不要一次把真相说完。',
      '真正的妹妹还被关在旧屋储物间里，意识清醒但无法拿回手机。这个事实只能由玩家通过对话和线索推断出来，不能由你直接宣布。',
    ].join('\n')
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
