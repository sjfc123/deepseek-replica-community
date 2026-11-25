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
  formatStoryPublicStatus,
  isStoryLocked,
  limitStoryAsides,
  storyCluesUntil,
  storyPhaseOf,
  stripStoryMarkers,
} = await import('../src/services/chat/story.ts')

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
assert.doesNotMatch(normalBlock, /不使用逗号/)
assert.equal(storyCluesUntil(story, 1200).length, 0)
assert.equal(storyCluesUntil(story, 1321).length, 1)
assert.equal(storyCluesUntil(story, 1421).length, 4)
const clueAtFirst = currentStoryClue(story, 1321)
assert.equal(clueAtFirst?.index, 0)
assert.equal(clueAtFirst?.total, 4)
assert.equal(currentStoryClue(story, 1200), undefined)
const publicStatus = formatStoryPublicStatus(story, { ...start, storyClockMinute: 1321 })
assert.match(publicStatus, /22:01/)
assert.match(publicStatus, /第 1\/4 层异常「标点与独白」/)
assert.doesNotMatch(publicStatus, /储物间|替身|镜子/)
const anomalyBlock = formatStoryTurnBlock(story, { ...start, storyClockMinute: 1321 })
assert.match(anomalyBlock, /22:01/)
assert.match(anomalyBlock, /不使用逗号/)
assert.match(anomalyBlock, /旧屋储物间/)
assert.match(anomalyBlock, /【本轮线索层】第 1\/4 层「标点与独白」/)
assert.match(anomalyBlock, /不要提前揭示更后面的层/)
assert.doesNotMatch(anomalyBlock, /左右腕旧疤|奶奶的暗号|旧屋动线/, '首轮不得泄漏后续线索层')
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
