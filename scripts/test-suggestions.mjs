/**
 * 回复建议回归：
 * 1. 角色资料只保留玩家能感知的字段，不带 secret、notes 与卡内系统指令；
 * 2. 公开剧情状态只给时间、阶段和已到点线索标题，不泄漏真相；
 * 3. 对话记录必须带说话人标签，建议请求只使用玩家这一侧的单一 user 消息；
 * 4. 系统提示必须明确“玩家代笔”，禁止角色台词、动作、独白与反向称呼。
 */
import assert from 'node:assert/strict'

const { getBuiltinCharacterCards } = await import('../src/services/chat/roleplay.ts')
const { formatStoryPublicStatus } = await import('../src/services/chat/story.ts')
const {
  SUGGESTION_SYSTEM,
  buildSuggestionAsk,
  buildSuggestionCardContext,
  buildSuggestionTranscript,
} = await import('../src/services/chat/suggestionsContext.ts')

const card = getBuiltinCharacterCards().find((item) => item.id === 'builtin:midnight-sister')
assert.ok(card)

const cardText = buildSuggestionCardContext(card)
for (const forbidden of ['镜子', '储物间', '替身', '真正的妹妹', '00:00', '[[STORY_END']) {
  assert.equal(cardText.includes(forbidden), false, `角色资料不应包含秘密或结局：${forbidden}`)
}
assert.match(cardText, /林小满/)
assert.match(cardText, /说话方式/)

const transcript = buildSuggestionTranscript('林小满', [
  { role: 'assistant', content: '哥，窗户又卡住了。' },
  { role: 'user', content: '你先别硬推。' },
])
assert.match(transcript, /林小满：哥，窗户又卡住了。/)
assert.match(transcript, /玩家：你先别硬推。/)

const session = {
  id: 's',
  title: '林小满',
  createdAt: 1,
  updatedAt: 1,
  messages: [],
  storyClockMinute: 1321,
  storyState: 'active',
}
const ask = buildSuggestionAsk({
  card,
  storyText: formatStoryPublicStatus(card.story, session),
  draft: '我快到了',
  transcript,
})
assert.match(ask, /你是玩家这一侧/)
assert.match(ask, /22:01/)
assert.match(ask, /第 1\/4 层异常「标点与独白」/)
assert.match(ask, /玩家：你先别硬推。/)
assert.match(ask, /玩家已经输入到一半的话/)
for (const forbidden of ['镜子', '储物间', '替身', '真正的妹妹', '[[STORY_END', card.secret]) {
  assert.equal(ask.includes(forbidden), false, `建议请求不应包含秘密：${forbidden}`)
}

assert.match(SUGGESTION_SYSTEM, /说话人必须是玩家/)
assert.match(SUGGESTION_SYSTEM, /禁止写角色的台词、动作、表情、心理/)
assert.match(SUGGESTION_SYSTEM, /称呼方向不能反/)
assert.match(SUGGESTION_SYSTEM, /不要把角色卡秘密、真相、后续线索直接说破/)

console.log('suggestions regression: ok')
