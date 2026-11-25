/**
 * 角色记忆分层回归：
 * 1. 旧卡默认是完整回合；重要场景 / 关键事实可独立成卡；
 * 2. 场景卡从选中对话摘出，挂到最后一条消息，正文可编辑；
 * 3. 场景与事实不参与自动配额淘汰，并优先进入注入；
 * 4. 注入块按“重要场景 → 关键事实 → 对话经历”分段，避免模型混读。
 */
import assert from 'node:assert/strict'
import {
  buildImportantMemoryCards,
  createMemoryCard,
  formatMemoryBlock,
  getCharacterMemoryKind,
  MEMORY_MAX_CHARS,
  overflowMemoryCards,
  selectMemoryCardsForInjection,
} from '../src/services/chat/memory.ts'
import { getMemorySpeech } from '../src/services/chat/memoryView.ts'

const card = (id, text, createdAt, overrides = {}) => ({
  id,
  text,
  createdAt,
  enabled: true,
  source: 'bulk',
  ...overrides,
})

assert.equal(getCharacterMemoryKind(card('old', '旧卡', 1)), 'turn', '缺省旧卡按整轮回合')
const scene = createMemoryCard('【2026-11-25】\n雨夜，她把伞递给你。', 'bulk', 20, {
  pool: 'character',
  memoryKind: 'scene',
})
assert.equal(getCharacterMemoryKind(scene), 'scene')
assert.deepEqual(getMemorySpeech(scene).summary, ['雨夜，她把伞递给你。'])
assert.equal(getMemorySpeech(scene).user.length, 0, '场景卡不伪造用户台词')

const messages = [
  {
    id: 'u1',
    role: 'user',
    content: '今晚下雨了。',
    createdAt: 10,
  },
  {
    id: 'a1',
    role: 'assistant',
    content: 'ignored',
    createdAt: 20,
    blocks: [{ type: 'text', text: '她把伞递给你，自己退到屋檐下。' }],
  },
]
const drafts = buildImportantMemoryCards(messages, 'scene', '雨夜，旧书店门口，她第一次把伞递给你。')
assert.equal(drafts.length, 1)
assert.equal(drafts[0].messageId, 'a1', '场景卡跟随最后一轮消息')
assert.equal(drafts[0].card.memoryKind, 'scene')
assert.match(drafts[0].card.text, /雨夜，旧书店门口/)
assert.doesNotMatch(drafts[0].card.text, /ignored|今晚下雨了/, '场景卡只保存编辑后的摘录')

const sceneCard = card('scene', '【2026-11-25 周\u4e49 21:00】\n雨夜，旧书店门口，她第一次把伞递给你。', 5, {
  pool: 'character',
  memoryKind: 'scene',
})
const factCard = card('fact', '【2026-11-25】\n她答应每周三晚上留出时间。', 10, {
  pool: 'character',
  memoryKind: 'fact',
})
const turnCard = card('turn', '【2026-11-25】\n用户：今晚下雨了。\n角色：把伞带上。', 20, {
  pool: 'character',
})
const block = formatMemoryBlock([turnCard, factCard, sceneCard], 3, MEMORY_MAX_CHARS)
assert.match(block, /【重要场景 · 先当作角色亲身经历过的背景锚点】/)
assert.match(block, /【关键事实 · 姓名、关系、偏好、承诺等稳定设定】/)
assert.match(block, /【对话经历 · 按时间顺序保留的原话与回合】/)
assert.ok(block.indexOf('重要场景') < block.indexOf('关键事实'), '场景先于事实')
assert.ok(block.indexOf('关键事实') < block.indexOf('对话经历'), '事实先于普通回合')

// 20 条普通回合之外，旧场景仍然每轮被召回；普通回合只保留最近 12 条。
const turns = Array.from({ length: 20 }, (_, index) =>
  card(`t${index}`, `第 ${index} 轮普通对话`, 100 + index, { pool: 'character' })
)
const picked = selectMemoryCardsForInjection(
  { id: 's' },
  [{ id: 'm', role: 'assistant', content: '', memories: [sceneCard, ...turns], createdAt: 1 }],
  5,
  '随便问一句'
)
assert.ok(picked.some(({ card: item }) => item.id === 'scene'), '旧场景不能被最近 12 张挤掉')

const overflow = overflowMemoryCards(
  { id: 's' },
  [
    {
      id: 'm',
      role: 'assistant',
      content: '',
      createdAt: 1,
      memories: [sceneCard, factCard, ...turns],
    },
  ],
  2,
  'character'
)
assert.ok(!overflow.some(({ card: item }) => item.id === 'scene' || item.id === 'fact'), '核心记忆不参与自动淘汰')
assert.ok(overflow.length > 0, '普通自动卡仍会按配额归档')

console.log('memory layers regression: ok')
