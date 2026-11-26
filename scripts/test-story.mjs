/**
 * 限时推理卡回归：虚拟时钟、阶段注入、结局标记与会话锁定。
 */
import assert from 'node:assert/strict'

const {
  advanceStoryClock,
  createStoryState,
  detectStoryEnd,
  formatStoryClock,
  formatStoryRemaining,
  formatStoryTurnBlock,
  currentStoryClue,
  formatStorySuggestionContext,
  isStoryLocked,
  limitStoryAsides,
  matchStoryClueQuestion,
  confirmStoryClueFromQuestion,
  storyClueKey,
  storyCluesUntil,
  storyPhaseOf,
  storyTurnNumber,
  stripStoryMarkers,
} = await import('../src/services/chat/story.ts')
const { getBuiltinCharacterCards } = await import('../src/services/chat/roleplay.ts')

const story = {
  intro: '剧情说明',
  startMinute: 20 * 60,
  normalUntilMinute: 22 * 60,
  deadlineMinute: 24 * 60,
  stepMinutes: 10,
  clues: [
    { atMinute: 1321, title: '标点与独白', hint: '句末标点消失' },
    { atMinute: 1361, title: '左右腕旧疤', hint: '旧疤在左腕' },
    { atMinute: 1391, title: '奶奶的暗号', hint: '红豆糕要趁热' },
    { atMinute: 1421, title: '旧屋动线', hint: '窗与储物间对不上' },
  ],
}

assert.deepEqual(createStoryState(story), {
  storyClockMinute: 1200,
  storyState: 'active',
  storyFinalTurn: false,
})
assert.equal(formatStoryClock(1200), '20:00')
assert.equal(formatStoryClock(1320), '22:00')
assert.equal(formatStoryClock(1440), '00:00')
assert.equal(formatStoryRemaining(1200, 1440), '4 小时')
assert.equal(formatStoryRemaining(1430, 1440), '10 分钟')
assert.equal(storyPhaseOf(story, 1200), 'normal')
assert.equal(storyPhaseOf(story, 1320), 'normal')
assert.equal(storyPhaseOf(story, 1321), 'anomaly')
assert.equal(storyPhaseOf(story, 1440), 'deadline')

const start = { id: 's', title: '林小满', createdAt: 1, updatedAt: 1, messages: [] }
assert.deepEqual(advanceStoryClock(story, { ...start, storyClockMinute: 1200 }), {
  storyClockMinute: 1210,
  storyFinalTurn: false,
})
assert.deepEqual(advanceStoryClock(story, { ...start, storyClockMinute: 1320 }), {
  storyClockMinute: 1321,
  storyFinalTurn: false,
})
assert.deepEqual(advanceStoryClock(story, { ...start, storyClockMinute: 1430 }), {
  storyClockMinute: 1440,
  storyFinalTurn: true,
})

const normalBlock = formatStoryTurnBlock(story, { ...start, storyClockMinute: 1200 })
assert.match(normalBlock, /20:00/)
assert.match(normalBlock, /仍是本人/)
assert.match(normalBlock, /生活细节/)
assert.doesNotMatch(normalBlock, /不使用逗号/)
assert.equal(storyCluesUntil(story, 1200).length, 0)
assert.equal(storyCluesUntil(story, 1321).length, 1)
assert.equal(storyCluesUntil(story, 1421).length, 4)
const clueAtFirst = currentStoryClue(story, 1321)
assert.equal(clueAtFirst?.index, 0)
assert.equal(clueAtFirst?.total, 4)
assert.equal(currentStoryClue(story, 1200), undefined)
const anomalyBlock = formatStoryTurnBlock(story, { ...start, storyClockMinute: 1321 })
assert.match(anomalyBlock, /22:01/)
assert.match(anomalyBlock, /不使用逗号/)
assert.match(anomalyBlock, /旧屋储物间/)
assert.match(anomalyBlock, /【本轮线索层】第 1\/4 层「标点与独白」/)
assert.match(anomalyBlock, /不要提前揭示更后面的层/)
assert.doesNotMatch(anomalyBlock, /左右腕旧疤|奶奶的暗号|旧屋动线/, '首轮不得泄漏后续线索层')

const builtin = getBuiltinCharacterCards().find((item) => item.id === 'builtin:midnight-sister')
assert.ok(builtin?.story)
const builtinStory = builtin.story
assert.ok(builtinStory.clues?.length)
assert.match(builtinStory.clues[0].behavior, /句号|问号|标点/)
assert.ok(builtinStory.clues[0].chain.length >= 3)
assert.ok(builtinStory.clues[0].triggers.includes('标点'))
assert.ok(builtinStory.clues[1].foreshadow.includes('左手腕'))
assert.equal(storyTurnNumber(builtinStory, { ...start, storyClockMinute: 1200 }), 0)
assert.equal(storyTurnNumber(builtinStory, { ...start, storyClockMinute: 1210 }), 1)
assert.equal(storyTurnNumber(builtinStory, { ...start, storyClockMinute: 1321 }), 13)
const suggestionStage = formatStorySuggestionContext(builtinStory, {
  ...start,
  storyClockMinute: 1321,
})
assert.match(suggestionStage, /第 13 轮/)
assert.match(suggestionStage, /异变阶段第 1 轮/)
assert.match(suggestionStage, /第 1\/4 层「标点与独白」/)
assert.match(suggestionStage, /句末标点|空格或换行/)
assert.doesNotMatch(suggestionStage, /旧屋的窗|储物间门|穿衣镜|替身/)

assert.equal(
  matchStoryClueQuestion(
    builtinStory,
    { ...start, storyClockMinute: 1200 },
    '你说话怎么没有标点了？'
  ),
  undefined,
  '正常阶段不得提前确认线索'
)
const punctuation = matchStoryClueQuestion(
  builtinStory,
  { ...start, storyClockMinute: 1321 },
  '你说话怎么没有标点了？'
)
assert.equal(punctuation?.clue.title, '标点与独白')
assert.equal(punctuation?.index, 0)
assert.equal(
  matchStoryClueQuestion(builtinStory, { ...start, storyClockMinute: 1321 }, '你左腕的疤还疼吗？'),
  undefined,
  '未到点的旧疤线索不能被提前确认'
)
const scar = matchStoryClueQuestion(
  builtinStory,
  { ...start, storyClockMinute: 1361 },
  '你左腕的疤还疼吗？'
)
assert.equal(scar?.clue.title, '左右腕旧疤')
assert.equal(scar?.index, 1)
assert.equal(
  matchStoryClueQuestion(builtinStory, { ...start, storyClockMinute: 1361 }, '你晚饭吃了吗？'),
  undefined,
  '无关问题不应确认线索'
)

const confirmed = confirmStoryClueFromQuestion(
  builtinStory,
  { ...start, storyClockMinute: 1321 },
  '你刚才的句号怎么都没了？'
)
assert.ok(confirmed?.storyClueIds?.length === 1)
assert.equal(confirmed.storyClueNotice, storyClueKey(builtinStory.clues[0]))
assert.equal(
  confirmStoryClueFromQuestion(
    builtinStory,
    { ...start, storyClockMinute: 1321, storyClueIds: confirmed.storyClueIds },
    '你是不是没有标点了？'
  ),
  null,
  '同一层线索不得重复弹窗'
)

const deadlineBlock = formatStoryTurnBlock(story, { ...start, storyClockMinute: 1440 })
assert.match(deadlineBlock, /\[\[STORY_END:BAD\]\]/)
assert.match(deadlineBlock, /\[\[STORY_END:GOOD\]\]/)

const anomalySession = { ...start, storyClockMinute: 1380 }
assert.equal(
  limitStoryAsides('门我开一条缝了\n（他应该没发现）', story, anomalySession, [
    '没事 就是右腕蹭了一下\n（他应该没发现）',
    '我快到楼下了\n（他应该不会多问）',
  ]),
  '门我开一条缝了',
  '最近两轮都有独白时本轮必须剔除'
)
assert.match(
  limitStoryAsides('门我开一条缝了\n（他应该没发现）', story, anomalySession, [
    '上一轮正文',
    '这一轮正文',
  ]),
  /（他应该没发现）/,
  '最近两轮没有独白时允许保留一条'
)
assert.equal(
  limitStoryAsides('门我开一条缝了\n（他应该没发现）', story, anomalySession, [
    '更早一轮\n（他应该没发现）',
    '上一轮正文',
    '这一轮正文',
  ]),
  '门我开一条缝了',
  '最近三轮出现过同一句独白时不得复读'
)
assert.doesNotMatch(
  limitStoryAsides('正文\n（第一句）\n（第二句）', story, anomalySession, []),
  /第二句/,
  '一轮最多保留一条独白'
)
assert.equal(
  limitStoryAsides('正文\n（最后一句）', story, { ...start, storyClockMinute: 1440 }, []),
  '正文\n（最后一句）',
  '判定轮不强行改写最后一幕'
)

assert.equal(detectStoryEnd('最后一句\n[[STORY_END:BAD]]'), 'bad')
assert.equal(detectStoryEnd('救出来了\n[[STORY_END:GOOD]]'), 'good')
assert.equal(detectStoryEnd('没有标记'), null)
assert.equal(stripStoryMarkers('最后一句\n[[STORY_END:BAD]]'), '最后一句')

assert.equal(isStoryLocked({ ...start, storyState: 'active' }), false)
assert.equal(isStoryLocked({ ...start, storyState: 'bad_end' }), true)
assert.equal(isStoryLocked({ ...start, storyState: 'good_end' }), true)
assert.equal(
  formatStoryTurnBlock(story, { ...start, storyClockMinute: 1440, storyState: 'bad_end' }),
  '',
  '结束后不再注入阶段，避免模型继续续写'
)

console.log('story regression: ok')
