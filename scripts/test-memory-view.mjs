/**
 * 记忆面板视图回归：
 * 1. 置顶且未归档的卡片必须排在所有普通卡之前；
 * 2. 自动角色卡按用户 / 角色行拆分，筛选时只返回对应发言；
 * 3. 普通用户原话 / AI 原话在无前缀时按 category 兜底；
 * 4. 状态、时间、关键词筛选可组合。
 */
import assert from 'node:assert/strict'
import {
  filterMemoryEntries,
  getMemorySpeech,
  memoryTextForView,
  sortMemoryEntries,
} from '../src/services/chat/memoryView.ts'

const card = (overrides) => ({
  id: 'c',
  text: '文本',
  createdAt: 1,
  enabled: true,
  source: 'auto',
  ...overrides,
})

const entries = [
  { messageId: 'm1', card: card({ id: 'old', createdAt: 10 }) },
  { messageId: 'm2', card: card({ id: 'pin', createdAt: 1, pinned: true }) },
  { messageId: 'm3', card: card({ id: 'new', createdAt: 20 }) },
  { messageId: 'm4', card: card({ id: 'archived-pin', createdAt: 30, pinned: true, superseded: true }) },
]
assert.deepEqual(
  sortMemoryEntries(entries).map((entry) => entry.card.id),
  ['pin', 'archived-pin', 'new', 'old']
)

const turn = card({
  text: '【2026-11-25 第1轮】\n用户：今天下雨了。\n角色：把伞带上。\n她递过一把伞。',
})
const speech = getMemorySpeech(turn)
assert.deepEqual(speech.user, ['今天下雨了。'])
assert.deepEqual(speech.character, ['把伞带上。'])
assert.deepEqual(speech.summary, ['她递过一把伞。'])
assert.equal(memoryTextForView(turn, 'user'), '今天下雨了。')
assert.equal(memoryTextForView(turn, 'character'), '把伞带上。')
assert.equal(memoryTextForView(turn, 'scene'), '她递过一把伞。')
assert.equal(memoryTextForView(turn, 'all'), turn.text)

const plainUser = card({ text: '喜欢喝冰美式', pool: 'normal', category: 'user' })
assert.deepEqual(getMemorySpeech(plainUser).user, ['喜欢喝冰美式'])
assert.equal(memoryTextForView(plainUser, 'user'), '喜欢喝冰美式')

const plainAi = card({ text: '建议先备份再改配置', pool: 'normal', category: 'ai' })
assert.deepEqual(getMemorySpeech(plainAi).character, ['建议先备份再改配置'])

// 自动整轮卡实际写入的是「玩家提问 / 角色回应」，且用户卡与角色卡各自带 owner；
// 旧测试只覆盖「用户 / 角色」，曾导致两个发言筛选都显示空列表。
const autoUser = card({
  owner: 'user',
  text: '【2026-11-26 周四 07:40 · 第1轮】\n玩家提问：\n你好\n【2026-11-26 周四 07:41 · 第2轮】玩家提问：这么多年不见你还是如初',
})
const autoCharacter = card({
  owner: 'character',
  text: '【2026-11-26 周四 07:41 · 第2轮】\n角色回应：\n*把橘子塞回你怀里*\n这么多年不见？\n\n*顿了段，还是笑了*\n行吧，就当久别重逢。',
})
assert.deepEqual(getMemorySpeech(autoUser).user, ['你好', '这么多年不见你还是如初'])
assert.deepEqual(getMemorySpeech(autoUser).summary, [])
assert.deepEqual(getMemorySpeech(autoCharacter).character, [
  '*把橘子塞回你怀里*',
  '这么多年不见？',
  '*顿了段，还是笑了*',
  '行吧，就当久别重逢。',
])
assert.deepEqual(getMemorySpeech(autoCharacter).summary, [])
assert.equal(memoryTextForView(autoUser, 'user'), '你好\n这么多年不见你还是如初')
assert.equal(
  memoryTextForView(autoCharacter, 'character'),
  '*把橘子塞回你怀里*\n这么多年不见？\n*顿了段，还是笑了*\n行吧，就当久别重逢。'
)
const autoList = [
  { messageId: 'auto-user', card: autoUser },
  { messageId: 'auto-character', card: autoCharacter },
]
for (const [speech, expected] of [
  ['user', 'auto-user'],
  ['character', 'auto-character'],
]) {
  assert.deepEqual(
    filterMemoryEntries(autoList, {
      pool: 'character',
      status: 'all',
      speech,
      time: 'all',
      query: '',
      now: 100,
    }).map((entry) => entry.messageId),
    [expected],
    `自动整轮卡必须命中「${speech}」筛选`
  )
}

const list = [
  { messageId: 'a', card: card({ id: 'u', text: '用户：蓝色\n角色：红色', createdAt: 5 }) },
  { messageId: 'b', card: card({ id: 'c', text: '角色：只记角色', createdAt: 10 }) },
  { messageId: 'd', card: card({ id: 's', text: '一段没有前缀的剧情摘要', createdAt: 15 }) },
  { messageId: 'e', card: card({ id: 'o', text: '旧卡', createdAt: 1 }) },
]
assert.deepEqual(
  filterMemoryEntries(list, {
    pool: 'character',
    status: 'all',
    speech: 'user',
    time: 'all',
    query: '',
    now: 100,
  }).map((entry) => entry.card.id),
  ['u']
)
assert.deepEqual(
  filterMemoryEntries(list, {
    pool: 'character',
    status: 'all',
    speech: 'character',
    time: 'all',
    query: '只记',
    now: 100,
  }).map((entry) => entry.card.id),
  ['c']
)
assert.deepEqual(
  filterMemoryEntries(list, {
    pool: 'character',
    status: 'pinned',
    speech: 'all',
    time: 'all',
    query: '',
    now: 100,
  }),
 []
)
console.log('memory view regression: ok')
