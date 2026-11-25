/**
 * 回复建议回归：
 * 1. 角色资料只保留玩家能感知的字段，不带 secret、notes 与卡内系统指令；
 * 2. 阶段上下文按轮次给出当前可观察行为，不泄漏完整线索链与真相；
 * 3. 对话记录必须带说话人标签，建议请求只使用玩家这一侧的单一 user 消息；
 * 4. 系统提示必须明确“玩家代笔”、禁止角色台词/动作/独白/反向称呼；
 * 5. 上一批建议必须进入排除区，近义复读会被 pickFreshSuggestions 拦掉；
 * 6. 尚未到点的线索词必须从候选里硬过滤，不能提前写旧疤、暗号或储物间。
 */
import assert from 'node:assert/strict'

const { getBuiltinCharacterCards } = await import('../src/services/chat/roleplay.ts')
const { formatStorySuggestionContext, futureStoryClueTerms } =
  await import('../src/services/chat/story.ts')
const {
  SUGGESTION_SYSTEM,
  buildSuggestionAsk,
  buildSuggestionCardContext,
  buildSuggestionTranscript,
  filterPrematureSuggestions,
  pickFreshSuggestions,
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
const stageText = formatStorySuggestionContext(card.story, session)
assert.match(stageText, /当前环境/)
assert.match(stageText, /旧屋/)
assert.match(stageText, /第 13 轮/)
assert.match(stageText, /异变阶段第 1 轮/)
assert.match(stageText, /22:01/)
assert.match(stageText, /不再使用标点/)
assert.match(stageText, /第 1\/4 层「标点与独白」/)
assert.match(stageText, /怪异|句末标点|空格或换行/)
for (const forbidden of ['镜子', '储物间', '替身', '真正的妹妹', '[[STORY_END']) {
  assert.equal(stageText.includes(forbidden), false, `阶段上下文不应提前泄漏：${forbidden}`)
}

const ask = buildSuggestionAsk({
  card,
  stageText,
  draft: '我快到了',
  transcript,
  previous: ['我马上到楼下了', '你先把窗关好'],
})
assert.match(ask, /你是玩家这一侧/)
assert.match(ask, /当前轮次与阶段行为/)
assert.match(ask, /第 13 轮/)
assert.match(ask, /上一批建议，禁止原句复现或换词复读/)
assert.match(ask, /我马上到楼下了/)
assert.match(ask, /三条必须分别是不同方向/)
assert.match(ask, /玩家：你先别硬推。/)
assert.match(ask, /玩家已经输入到一半的话/)
for (const forbidden of ['镜子', '储物间', '替身', '真正的妹妹', '[[STORY_END', card.secret]) {
  assert.equal(ask.includes(forbidden), false, `建议请求不应包含秘密：${forbidden}`)
}

assert.match(SUGGESTION_SYSTEM, /说话人必须是玩家/)
assert.match(SUGGESTION_SYSTEM, /禁止写角色的台词、动作、表情、心理/)
assert.match(SUGGESTION_SYSTEM, /称呼方向不能反/)
assert.match(SUGGESTION_SYSTEM, /参考不是素材库/)
assert.match(SUGGESTION_SYSTEM, /上一批建议/)
assert.match(SUGGESTION_SYSTEM, /不要把角色卡秘密、真相、后续线索或完整线索链直接说破/)

const blocked = futureStoryClueTerms(card.story, session)
assert.ok(blocked.includes('左腕'))
assert.ok(blocked.includes('暗号'))
assert.ok(blocked.includes('储物间'))
const filtered = filterPrematureSuggestions(
  [
    '你左腕的疤还在吗？',
    '奶奶那句暗号后半句是什么？',
    '你现在在储物间吗？',
    '你刚才怎么不打句号了？',
  ],
  blocked
)
assert.deepEqual(filtered, ['你刚才怎么不打句号了？'])

const fresh = pickFreshSuggestions(
  ['你左腕的疤还疼吗？', '你左腕上的疤还疼吗？', '我先过去看看窗户', '窗边那盏灯还亮着吗'],
  ['我马上到楼下了']
)
assert.equal(fresh.length, 3)
assert.equal(fresh[0], '你左腕的疤还疼吗？')
assert.equal(fresh.includes('你左腕上的疤还疼吗？'), false, '近义改写应被去重')
assert.equal(pickFreshSuggestions(['我马上到楼下了'], ['我马上到楼下了']).length, 0)

console.log('suggestions regression: ok')
