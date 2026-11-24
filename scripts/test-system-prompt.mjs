/**
 * System 前缀与续写回归测试：
 * 1. 角色卡开场白不再随消息数量进出，同一张卡永远拼出同一段；
 * 2. OpenAI Chat 把 system 放在 messages 第一条；
 * 3. OpenAI Responses 把 system 放在顶层 instructions；
 * 4. 空 system 不生成 system 消息，也不写空的 instructions；
 * 5. 续写回放只剥离已发送的 assistant 前缀，不误删正常续写。
 */
import assert from 'node:assert/strict'

const { formatCharacterCard } = await import('../src/services/chat/roleplay.ts')
const { CONTINUATION_GUARD, createContinuationEchoFilter, filterContinuationEcho } =
  await import('../src/services/chat/continuation.ts')
const { openAIRequest } = await import('../src/services/api/openaiChat.ts')

const card = {
  id: 'builtin:test',
  name: '测试角色',
  identity: '一个用于回归测试的固定身份',
  relationship: '{{user}}的旧识',
  style: '短句，直接',
  tics: '说话前先敲两下桌面',
  greeting: '（抬眼）你来了。先坐。',
  notes: '不要重复开场',
  createdAt: 1,
}

const first = formatCharacterCard(card, '用户')
const second = formatCharacterCard(card, '用户')
assert.equal(first, second, '角色卡前缀必须逐字稳定')
assert.match(first, /开场参考（只在第一条回复使用/)
assert.match(first, /（抬眼）你来了。先坐。/)
assert.match(first, /用户/, '{{user}} 必须替换')
assert.doesNotMatch(first, /{{user}}/, '不能留下用户占位符')

const body = {
  model: 'test-model',
  system: '固定 System 前缀',
  messages: [{ role: 'user', content: '你好' }],
  stream: true,
}

const chat = openAIRequest('chat', body, false)
assert.equal(chat.messages[0].role, 'system')
assert.equal(chat.messages[0].content, '固定 System 前缀')

const responses = openAIRequest('responses', body, false)
assert.equal(responses.instructions, '固定 System 前缀')
assert.equal(responses.input[0].role, 'user')

const empty = openAIRequest('chat', { ...body, system: '' }, false)
assert.equal(empty.messages[0].role, 'user', '空 system 不应插入 system 消息')
const emptyResponses = openAIRequest('responses', { ...body, system: '   ' }, false)
assert.equal(emptyResponses.instructions, undefined, '空白 system 不应写 instructions')

assert.match(CONTINUATION_GUARD, /从那条回复的最后一个字之后写起/)
assert.match(CONTINUATION_GUARD, /不要重新开场/)
assert.match(CONTINUATION_GUARD, /不要替用户说话/)

// 续写回放：上游把已发送的 assistant 原文整段回放时，只能留下真正新增的部分。
const textEvent = (text) => ({
  type: 'content_block_delta',
  index: 0,
  delta: { type: 'text_delta', text },
})
const echo = createContinuationEchoFilter('原来的回答。')
let step = filterContinuationEcho(echo, textEvent('原来的回答。'))
assert.equal(step.event, null, '完整回放原文时不能追加')
step = filterContinuationEcho(step.filter, textEvent('新增内容。'))
assert.equal(step.event.delta.text, '新增内容。', '回放之后只追加新增内容')

const plain = createContinuationEchoFilter('原来的回答。')
step = filterContinuationEcho(plain, textEvent('新的开头。'))
assert.equal(step.event.delta.text, '新的开头。', '正常续写不能被误删')

const partial = createContinuationEchoFilter('原来的回答。')
step = filterContinuationEcho(partial, textEvent('原来'))
assert.equal(step.event, null, '与原文一致的开头先暂存')
step = filterContinuationEcho(step.filter, textEvent('的回答。新增。'))
assert.equal(step.event.delta.text, '新增。', '跨分片的回放前缀也要剥掉')

// 少数兼容层把正文放在 content_block_start 中，也要能剥掉原文、保留新增内容。
const startEcho = createContinuationEchoFilter('原来的回答。')
step = filterContinuationEcho(startEcho, {
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'text', text: '原来的回答。新增。' },
})
assert.equal(step.event.content_block.text, '新增。', '块起始回放也要剥掉')

console.log('system prompt regression: ok')
