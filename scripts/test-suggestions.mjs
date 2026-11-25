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
  buildSuggestionCastContext,
  buildSuggestionSceneContext,
  detectSuggestionPresence,
  filterPrematureSuggestions,
  parseReplySuggestions,
  pickFreshReplySuggestions,
  pickFreshSuggestions,
  resolvePresentCast,
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
assert.match(ask, /三条必须方向不同/)
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
assert.match(SUGGESTION_SYSTEM, /两种呈现方式/)
assert.match(SUGGESTION_SYSTEM, /至少两条建议要以“（”开头/)
assert.match(SUGGESTION_SYSTEM, /不要客服腔/)
assert.match(SUGGESTION_SYSTEM, /多角色场景/)

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



// 场景站位：角色把玩家往外推、玩家自己离开、玩家仍留在原地必须分流
const leaveByCharacter = detectSuggestionPresence({
  lastCharacterLine: '你走吧，我一个人待会儿。',
  lastPlayerLine: '我再说一句。',
})
assert.equal(leaveByCharacter.presence, 'leaving')
const leaveByPlayer = detectSuggestionPresence({
  lastCharacterLine: '门没锁。',
  lastPlayerLine: '（我把外套拎起来，往门口走）',
})
assert.equal(leaveByPlayer.presence, 'leaving')
const stillHere = detectSuggestionPresence({
  lastCharacterLine: '你别站那儿。',
  lastPlayerLine: '我没走，我就在门口。',
})
assert.equal(stillHere.presence, 'together')
const group = detectSuggestionPresence({
  lastCharacterLine: '你们两个都进来。',
  lastPlayerLine: '我把门推开。',
  castCount: 2,
})
assert.equal(group.presence, 'group')

const cast = resolvePresentCast(
  '林小满',
  '林小满、许棠、门外的人、邻居老周（住在对门）'
)
assert.deepEqual(cast, ['林小满', '许棠', '邻居老周'], '角色卡外 NPC 也应进入在场名单')
assert.equal(resolvePresentCast('林小满', '林小满和许棠')[1], '许棠', '“和”也应能拆开人名')
const castText = buildSuggestionCastContext(cast, [card, { name: '许棠' }], card.name)
assert.match(castText, /林小满/)
assert.match(castText, /许棠/)
assert.match(castText, /邻居老周/)
const leavingScene = buildSuggestionSceneContext({
  scene: {
    time: '21:10',
    place: '旧屋堂屋',
    weather: '雨',
    atmosphere: '灯没开，门口有风',
    mood: '压着话',
    props: '窗边的旧台灯',
    objective: '让玩家离开屋子',
    conflict: '她不想被看见',
  },
  clockText: '21:10',
  cast,
  presence: 'leaving',
  presenceReason: leaveByCharacter.reason,
  lastCharacterLine: '你走吧，我一个人待会儿。',
})
assert.match(leavingScene, /旧屋堂屋/)
assert.match(leavingScene, /林小满、许棠/)
assert.match(leavingScene, /玩家正在离开/)
assert.match(leavingScene, /至少两条用括号旁白/)
assert.match(leavingScene, /幕后目标/)
const askLeaving = buildSuggestionAsk({
  card,
  stageText,
  sceneText: leavingScene,
  castText,
  presence: 'leaving',
  draft: '',
  transcript,
})
assert.match(askLeaving, /至少两条建议用“（”开头/)
assert.match(askLeaving, /在场角色/)

// 对象输出：mode/target 必须保留；字符串旧格式仍可解析
const parsed = parseReplySuggestions(
  JSON.stringify([
    { mode: 'aside', target: '林小满', text: '（我把手从门把上收回来，没有回头。）' },
    { mode: 'speech', target: '许棠', text: '你刚才也听见了？' },
    { mode: 'speech', target: '门外的人', text: '都别站在门口。' },
  ]),
  ['林小满', '许棠'],
  '林小满'
)
assert.equal(parsed.length, 3)
assert.equal(parsed[0].mode, 'aside')
assert.equal(parsed[0].text.startsWith('（'), true)
assert.equal(parsed[1].target, '许棠')
assert.equal(parsed[2].target, '林小满')
const legacy = parseReplySuggestions('["你先把窗关好","（我退到门口）","别急着点灯"]', ['林小满'], '林小满')
assert.equal(legacy[1].mode, 'aside')
assert.equal(legacy[0].mode, 'speech')
const freshObjects = pickFreshReplySuggestions(
  [
    { mode: 'speech', target: '林小满', text: '你先把窗关好' },
    { mode: 'speech', target: '林小满', text: '你先把窗户关好' },
    { mode: 'aside', target: '林小满', text: '（我退到门口，没再往里看。）' },
  ],
  []
)
assert.equal(freshObjects.length, 2)
assert.equal(freshObjects[1].mode, 'aside')

assert.equal(
  detectSuggestionPresence({ lastCharacterLine: '你别走，外面还在下雨。' }).presence,
  'together',
  '角色挽留不应判为离开'
)
assert.equal(
  detectSuggestionPresence({
    lastCharacterLine: '你走吧，把门带上。',
    lastPlayerLine: '我还没走，我在门口。',
  }).presence,
  'together',
  '玩家明确还在场时不应因为角色推动作废'
)
const remotePresence = detectSuggestionPresence({
  lastCharacterLine: '你把门带上，我一个人待会儿。',
  lastPlayerLine: '我在楼下，还没上去。',
  castCount: 1,
})
assert.equal(remotePresence.presence, 'remote', '玩家在楼下时应判为不在身边')
assert.match(
  buildSuggestionSceneContext({
    scene: {},
    cast: ['林小满'],
    presence: remotePresence.presence,
    presenceReason: remotePresence.reason,
  }),
  /不能假设玩家看得见屋内陈设/
)

console.log('suggestions regression: ok')
