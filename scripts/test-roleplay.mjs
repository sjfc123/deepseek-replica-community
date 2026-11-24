/**
 * 角色扮演层回归：
 * 1. 内置卡数量与三张新预设；
 * 2. 补充设定不限字数；
 * 3. 情景、系统指令与对白示例进入 system 且跨轮稳定；
 * 4. 会话绑定优先于全局开关，旧会话可按开场白识别；
 * 5. 世界书避触词与整段历史扫描；
 * 6. 场景新增字段可解析。
 */
import assert from 'node:assert/strict'

const {
  BUILTIN_CHARACTER_CARD_TOTAL,
  getBuiltinCharacterCards,
  normalizeCharacterCards,
  normalizeWorldbook,
  formatCharacterCard,
  findSessionCharacterCard,
  resolveTurnCharacterCard,
  selectWorldbookEntries,
  parseSceneUpdate,
  sceneHasContent,
  EMPTY_SCENE,
} = await import('../src/services/chat/roleplay.ts')

const builtins = getBuiltinCharacterCards()
assert.equal(builtins.length, BUILTIN_CHARACTER_CARD_TOTAL, '内置卡总数必须和常量一致')
assert.equal(builtins.length, 6)
for (const id of ['builtin:jianghu', 'builtin:xianxia', 'builtin:urban']) {
  assert.ok(builtins.some((card) => card.id === id), `缺少内置卡 ${id}`)
}
const newCards = builtins.filter((card) => ['江湖', '修仙', '都市'].includes(card.genre))
assert.equal(newCards.length, 3, '三张新卡必须带题材')
assert.ok(newCards.every((card) => card.greeting && card.scenario && card.systemDirective))

const longNotes = '长'.repeat(20_000)
const [card] = normalizeCharacterCards([
  {
    name: '测试',
    identity: '身份',
    notes: longNotes,
    greeting: '开场',
    playStyle: 'mystery',
  },
])
assert.equal(card.notes.length, longNotes.length, '补充设定不能被归一化截断')
assert.equal(card.playStyle, 'mystery', '英文玩法 key 应保留')
assert.equal(
  normalizeCharacterCards([{ name: '中文玩法', playStyle: '悬疑调查' }])[0].playStyle,
  'mystery',
  '导入中文玩法标签应映射到 key'
)
assert.equal(
  normalizeWorldbook([{ title: '码头', content: '旧码头', kind: '地点' }])[0].kind,
  'location',
  '导入中文世界书分类应映射到 key'
)

const prompt = formatCharacterCard(card, '用户')
assert.match(prompt, /补充设定/)
assert.doesNotMatch(prompt, /【角色内系统指令】/, '未填写系统指令时不应凭空出现')

const cardWithAll = normalizeCharacterCards([
  {
    name: '沈砚',
    greeting: '（抬眼）你来了。',
    scenario: '雨夜的渡口',
    systemDirective: '每次出手都要有代价。',
    speechExamples: '“茶两文，问事另算。”',
  },
])[0]
const resolved = formatCharacterCard(cardWithAll, '用户')
assert.match(resolved, /雨夜的渡口/)
assert.match(resolved, /每次出手都要有代价/)
assert.match(resolved, /参考对白/)
assert.equal(resolved, formatCharacterCard(cardWithAll, '用户'), '角色卡 system 必须稳定')

const session = {
  id: 's1',
  title: '沈砚',
  createdAt: 1,
  updatedAt: 1,
  messages: [
    { id: 'm1', role: 'assistant', createdAt: 1, blocks: [{ type: 'text', text: '（抬眼）你来了。' }] },
  ],
  rootMessageId: 'm1',
}
assert.equal(findSessionCharacterCard([cardWithAll], session)?.id, cardWithAll.id)
assert.equal(findSessionCharacterCard([cardWithAll], { ...session, characterId: cardWithAll.id })?.id, cardWithAll.id)
assert.equal(
  resolveTurnCharacterCard([cardWithAll], session, null, false)?.id,
  cardWithAll.id,
  '关闭全局开关后已绑定会话仍应沿用人物'
)
assert.equal(resolveTurnCharacterCard([], session, null, false), undefined)

const worldbook = [
  {
    id: 'w1',
    title: '渡口',
    keywords: ['渡口'],
    content: '旧码头已经停用。',
    enabled: true,
    always: false,
    match: 'keyword',
    cardId: '',
    weight: 50,
    position: 'context',
    kind: 'location',
    scope: 'session',
    excludeKeywords: ['渡口已封'],
    createdAt: 1,
    updatedAt: 1,
  },
]
assert.equal(
  selectWorldbookEntries(worldbook, '今天风大', 6, 1000, null, '很久以前在渡口见过').length,
  1,
  '整段历史扫描应命中旧会话内容'
)
assert.equal(
  selectWorldbookEntries(worldbook, '渡口已封，别去', 6, 1000, null, '渡口已封，别去').length,
  0,
  '避触词命中时必须跳过'
)

const scene = parseSceneUpdate(
  '天气：转小雨\n在场人物：店员在打盹\n当前目标：拿到监控\n冲突与悬念：店员认得你\n关键物件：旧钥匙',
  EMPTY_SCENE
)
assert.equal(scene.weather, '转小雨')
assert.equal(scene.participants, '店员在打盹')
assert.equal(scene.objective, '拿到监控')
assert.equal(scene.conflict, '店员认得你')
assert.equal(scene.props, '旧钥匙')
assert.ok(scene.updatedAt > 0)
assert.equal(sceneHasContent({ ...EMPTY_SCENE, weather: '小雨' }), true, '只有天气时场景也应有内容')
assert.equal(sceneHasContent(EMPTY_SCENE), false)

console.log('roleplay regression: ok')
