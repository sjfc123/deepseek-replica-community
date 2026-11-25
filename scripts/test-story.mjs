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
  isStoryLocked,
  storyPhaseOf,
  stripStoryMarkers,
} = await import('../src/services/chat/story.ts')

const story = {
  intro: '剧情说明',
  startMinute: 20 * 60,
  normalUntilMinute: 22 * 60,
  deadlineMinute: 24 * 60,
  stepMinutes: 10,
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
const anomalyBlock = formatStoryTurnBlock(story, { ...start, storyClockMinute: 1321 })
assert.match(anomalyBlock, /22:01/)
assert.match(anomalyBlock, /不使用逗号/)
assert.match(anomalyBlock, /旧屋储物间/)
const deadlineBlock = formatStoryTurnBlock(story, { ...start, storyClockMinute: 1440 })
assert.match(deadlineBlock, /\[\[STORY_END:BAD\]\]/)
assert.match(deadlineBlock, /\[\[STORY_END:GOOD\]\]/)

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
