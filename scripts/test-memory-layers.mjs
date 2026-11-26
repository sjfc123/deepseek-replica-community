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
  buildTurnMemoryCards,
  buildConversationMemoryCards,
  createMemoryCard,
  parseRefinedCards,
  formatMemoryBlock,
  getCharacterMemoryKind,
  getMemoryOwner,
  memoryOwnerLabel,
  MEMORY_MAX_CHARS,
  overflowMemoryCards,
  selectMemoryCardsForInjection,
} from '../src/services/chat/memory.ts'
import { getMemorySpeech } from '../src/services/chat/memoryView.ts'

const split = buildTurnMemoryCards('报纸是哪一天的？', '我没细看日期，眼镜位置不对。', {
  at: 1,
  turnIndex: 9,
})
assert.equal(split.length, 2)
assert.equal(split[0].owner, 'user', '玩家提问必须标玩家本人')
assert.match(split[0].text, /玩家提问/)
assert.doesNotMatch(split[0].text, /角色回应/)
assert.equal(split[1].owner, 'character', '角色回复必须标角色本人')
assert.match(split[1].text, /角色回应/)
assert.doesNotMatch(split[1].text, /玩家提问/)

// 有名字时，自动记忆不再写「用户 / 玩家提问」，而是写成具体说话人，并保存 speaker 供面板显示。
const named = buildTurnMemoryCards('今天去哪？', '去旧屋看看。', {
  at: 2,
  userName: '林默',
  characterName: '凯伊',
})
assert.match(named[0].text, /林默：今天去哪？/)
assert.doesNotMatch(named[0].text, /用户：|玩家提问/)
assert.equal(named[0].speaker, '林默')
assert.match(named[1].text, /凯伊：去旧屋看看。/)
assert.equal(named[1].speaker, '凯伊')
const sameName = buildTurnMemoryCards('你是谁？', '我是凯伊。', {
  userName: '凯伊',
  characterName: '凯伊',
})
assert.match(sameName[0].text, /凯伊（玩家）：你是谁？/)
assert.match(sameName[1].text, /凯伊（角色）：我是凯伊。/)

const turnMessages = [
  { id: 'u1', role: 'user', content: '窗户还是打不开吗？', createdAt: 10, blocks: [] },
  {
    id: 'a1',
    role: 'assistant',
    content: '',
    createdAt: 11,
    blocks: [{ type: 'text', text: '打不开，跟焊死了一样。' }],
  },
]
const splitDrafts = buildConversationMemoryCards(turnMessages, 0, undefined, { split: true })
assert.equal(splitDrafts.length, 2, '整段保存角色对话也要拆成两张')
assert.equal(getMemoryOwner(splitDrafts[0].card), 'user')
assert.equal(getMemoryOwner(splitDrafts[1].card), 'character')
const mergedDrafts = buildConversationMemoryCards(turnMessages.length ? turnMessages : [], 0)
assert.equal(mergedDrafts.length, 1, '普通池不拆，仍按一轮一张')

const refined = parseRefinedCards(
  '[玩家本人] 玩家怕黑，睡觉要留一盏小灯。\n[角色本人] 角色答应下雨天会提前提醒带伞。\n[共同经历] 你们在旧屋雨夜一起修过窗。'
)
assert.deepEqual(
  refined.map((item) => item.owner),
  ['user', 'character', 'shared']
)
assert.match(refined[0].text, /怕黑/)

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

// 手动卡可以标明角色本人 / 玩家本人，并带触发线索和主动提起标记
const ownedManual = createMemoryCard('她怕黑，睡觉前会把走廊灯留一盏。', 'manual', 30, {
  pool: 'character',
  memoryKind: 'fact',
  owner: 'character',
  trigger: '关灯、走廊、睡觉',
  proactive: true,
  pinned: true,
})
assert.equal(getMemoryOwner(ownedManual), 'character')
assert.equal(memoryOwnerLabel('character'), '角色本人')
assert.equal(memoryOwnerLabel('user'), '玩家本人')
assert.equal(memoryOwnerLabel('shared'), '共同经历')
assert.equal(memoryOwnerLabel('user', { user: '林默' }), '林默')
assert.equal(memoryOwnerLabel('character', { character: '凯伊' }), '凯伊')
assert.equal(memoryOwnerLabel('user', { user: '用户' }), '玩家本人')
assert.equal(getMemoryOwner(card('legacy', '旧卡', 1)), 'shared', '旧卡默认共同经历')
const ownedBlock = formatMemoryBlock([ownedManual], 1, MEMORY_MAX_CHARS)
assert.match(ownedBlock, /（角色本人）/)
const namedBlock = formatMemoryBlock(
  [createMemoryCard('我怕黑，睡觉要留灯。', 'auto', 60, { owner: 'user', speaker: '林默' })],
  1,
  MEMORY_MAX_CHARS
)
assert.match(namedBlock, /（林默）/)
assert.doesNotMatch(namedBlock, /（玩家本人）/)
assert.match(ownedBlock, /（回忆触发：关灯、走廊、睡觉）/)
assert.match(ownedBlock, /（可主动提起）/)
assert.match(ownedBlock, /标了「角色本人」/)
assert.match(ownedBlock, /不要把玩家的事实说成角色自己的/)
const userManual = createMemoryCard('玩家下周三要去面试，不想被提前问。', 'manual', 40, {
  pool: 'character',
  memoryKind: 'fact',
  owner: 'user',
})
assert.match(formatMemoryBlock([userManual], 1, MEMORY_MAX_CHARS), /（玩家本人）/)
assert.equal(ownedManual.pinned, true, '手动卡可直接带置顶')

// 手动卡不勾“主动提起”和“每轮优先”也必须每轮优先注入；两个开关只负责语气与排序加成。
const plainManual = createMemoryCard('玩家讨厌香菜，点外卖时不要加。', 'manual', 50, {
  pool: 'character',
  memoryKind: 'fact',
  owner: 'user',
})
const pickedPlainManual = selectMemoryCardsForInjection(
  { id: 's' },
  [{ id: 'm', role: 'assistant', content: '', memories: [plainManual, ...turns], createdAt: 1 }],
  1,
  '今天吃什么'
)
assert.equal(pickedPlainManual[0]?.card.id, plainManual.id, '无开关的手动卡仍应排在最前')

// 触发词必须真的参与召回：旧卡本身不在最近 12 张里，只靠“关灯”触发词回到注入。
const triggered = card('triggered', '她说过走廊那盏灯不能关。', 35, {
  pool: 'character',
  trigger: '关灯、走廊',
})
const pickedByTrigger = selectMemoryCardsForInjection(
  { id: 's' },
  [{ id: 'm', role: 'assistant', content: '', memories: [triggered, ...turns], createdAt: 1 }],
  3,
  '你把走廊的灯关了吗'
)
assert.ok(
  pickedByTrigger.some(({ card: item }) => item.id === 'triggered'),
  '触发词命中时旧卡应被召回'
)

console.log('memory layers regression: ok')
