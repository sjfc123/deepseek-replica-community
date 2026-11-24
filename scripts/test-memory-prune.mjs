/**
 * 长期记忆精确删除回归：
 * 1. 删除只影响目标消息里的目标卡片；
 * 2. 同 ID 卡片挂在别的消息上不会被连带删除；
 * 3. 没有命中的消息保持原对象；
 * 4. 空目标不产生任何变化。
 */
import assert from 'node:assert/strict'

const { removeMemoryCards } = await import('../src/services/chat/memoryPrune.ts')

const card = (id, text) => ({ id, text, createdAt: 1, enabled: true, source: 'manual' })
const messages = [
  { id: 'm1', role: 'assistant', content: 'a', memories: [card('a1', 'A1'), card('a2', 'A2')] },
  { id: 'm2', role: 'assistant', content: 'b', memories: [card('a1', '同 ID 但不同消息')] },
  { id: 'm3', role: 'user', content: 'c' },
]

const one = removeMemoryCards(messages, [{ messageId: 'm1', cardId: 'a1' }])
assert.deepEqual(one[0].memories.map((item) => item.id), ['a2'])
assert.deepEqual(one[1], messages[1], '别的消息上的同 ID 卡片不能删除')
assert.equal(one[2], messages[2], '未命中的消息保持原对象')

const single = removeMemoryCards(messages, [{ messageId: 'm2', cardId: 'a1' }])
assert.equal(single[0], messages[0], '未命中的消息保持原对象')
assert.deepEqual(single[1].memories, [])

const allM1 = removeMemoryCards(messages, [
  { messageId: 'm1', cardId: 'a1' },
  { messageId: 'm1', cardId: 'a2' },
])
assert.deepEqual(allM1[0].memories, [])
assert.deepEqual(allM1[1].memories.map((item) => item.id), ['a1'])

const none = removeMemoryCards(messages, [])
assert.equal(none, messages)

console.log('memory prune regression: ok')
