/**
 * 角色扮演层回归：
 * 1. 内置卡数量、八张卡的基础配置完整度、旧种子刷新与默认头像；
 * 2. 补充设定不限字数；
 * 3. 情景、系统指令与对白示例进入 system 且跨轮稳定；
 * 4. 会话绑定优先于全局开关，旧会话可按开场白识别；
 * 5. 世界书避触词与整段历史扫描；
 * 6. 场景新增字段可解析；
 * 7. 基础档案归一化、计数与 system 装配；
 * 8. 档案关闭后的身份名行与 system 名字解析。
 */
import assert from 'node:assert/strict'

const {
  BUILTIN_CHARACTER_CARD_TOTAL,
  getBuiltinCharacterCards,
  ensureBuiltinCharacterCards,
  normalizeCharacterCards,
  normalizeCharacterStory,
  normalizeWorldbook,
  formatCharacterCard,
  formatWorldbookBlock,
  dedupeWorldbookEntries,
  findSessionCharacterCard,
  resolveTurnCharacterCard,
  selectWorldbookEntries,
  parseSceneUpdate,
  sceneHasContent,
  WORLDBOOK_AUTHORITY_DEFAULT,
  EMPTY_SCENE,
  ROLEPLAY_FIXED_FACTS_RULE,
  ROLEPLAY_COOPERATION_RULE,
  ROLEPLAY_IDENTITY_RULE,
  isAvatarDataUrl,
} = await import('../src/services/chat/roleplay.ts')

const {
  normalizeCharacterProfile,
  characterProfileFieldCount,
  characterProfileHasContent,
  formatCharacterProfile,
  formatCharacterIdentity,
  resolveSystemCharacterName,
  CHARACTER_PROFILE_FIELDS,
  shouldInjectCharacterProfile,
  PROFILE_FIXED_FACTS_RULE,
  PROFILE_COOPERATION_RULE,
  PROFILE_IDENTITY_RULE,
} = await import('../src/services/chat/characterProfile.ts')

const builtins = getBuiltinCharacterCards()
assert.equal(builtins.length, BUILTIN_CHARACTER_CARD_TOTAL, '内置卡总数必须和常量一致')
assert.equal(builtins.length, 8)
for (const id of [
  'builtin:dafeiyu',
  'builtin:whale-girl',
  'builtin:catgirl',
  'builtin:jianghu',
  'builtin:xianxia',
  'builtin:urban',
  'builtin:midnight-sister',
  'builtin:kei',
]) {
  assert.ok(
    builtins.some((card) => card.id === id),
    `缺少内置卡 ${id}`
  )
}
const kei = builtins.find((card) => card.id === 'builtin:kei')
assert.equal(kei?.name, '天童凯伊', '凯伊卡必须使用正式姓名')
assert.match(kei?.identity ?? '', /AL-1S|Key/, '凯伊卡必须交代 AL-1S / Key 的来历')
assert.match(kei?.relationship ?? '', /爱丽丝/, '凯伊卡必须写明与爱丽丝的关系')
assert.match(kei?.systemDirective ?? '', /不是 Key/, '凯伊卡必须锁定当前身份')
assert.doesNotMatch(kei?.notes ?? '', /成人内容允许/, '凯伊卡必须保持健康向')
const keiSystem = formatCharacterCard(kei, '老师')
assert.match(keiSystem, /天童凯伊/, '凯伊卡 system 必须带正式姓名')
assert.match(keiSystem, /不是 Key/, '凯伊卡 system 必须锁定当前身份')
assert.match(keiSystem, /爱丽丝/, '凯伊卡 system 必须保留与爱丽丝的关系')
assert.doesNotMatch(keiSystem, /\{\{user\}\}|\{\{char\}\}/, '凯伊卡 system 不应残留占位符')
assert.ok(keiSystem.length < 12_000, '凯伊卡 system 不应把整段资料无限堆入上下文')

const {
  BUILTIN_CARD_AVATARS,
  BUILTIN_CARD_AVATAR_IDS,
  ensureBuiltinCardAvatars,
} = await import('../src/services/chat/builtinAvatars.ts')
assert.equal(BUILTIN_CARD_AVATAR_IDS.length, 8, '八张内置卡都必须有默认头像')
for (const id of BUILTIN_CARD_AVATAR_IDS) {
  assert.ok(isAvatarDataUrl(BUILTIN_CARD_AVATARS[id]), `${id} 的默认头像必须是合法 data URL`)
}
const emptyAvatars = ensureBuiltinCardAvatars(
  {},
  builtins.map((card) => card.id)
)
assert.equal(emptyAvatars.added, 8, '空头像表应一次补齐八张内置头像')
assert.ok(emptyAvatars.avatars['builtin:kei']?.startsWith('data:image/webp;base64,'), '凯伊应使用 WebP 默认头像')
const customAvatars = { 'builtin:kei': 'data:image/jpeg;base64,Zm9v' }
const keptAvatars = ensureBuiltinCardAvatars(
  customAvatars,
  builtins.map((card) => card.id)
)
assert.equal(keptAvatars.avatars['builtin:kei'], customAvatars['builtin:kei'], '自定义头像不得被默认头像覆盖')
const removedAvatars = ensureBuiltinCardAvatars(
  {},
  builtins.map((card) => card.id),
  ['builtin:kei']
)
assert.equal(removedAvatars.avatars['builtin:kei'], undefined, '显式移除过的默认头像不得补回')

const newCards = builtins.filter((card) => ['江湖', '修仙', '都市'].includes(card.genre))
assert.equal(newCards.length, 3, '三张新卡必须带题材')
assert.ok(newCards.every((card) => card.greeting && card.scenario && card.systemDirective))

const storyCard = builtins.find((card) => card.id === 'builtin:midnight-sister')
assert.ok(storyCard?.story, '限时推理卡必须带 story 配置')
assert.equal(storyCard.story.startMinute, 20 * 60, '开场应为 20:00')
assert.equal(storyCard.story.normalUntilMinute, 22 * 60, '22:00 前是本人')
assert.equal(storyCard.story.deadlineMinute, 24 * 60, '00:00 截止')
assert.equal(storyCard.story.stepMinutes, 10, '每轮推进十分钟')
assert.equal(storyCard.story.clues?.length, 4, '限时推理卡必须配置四层线索')
assert.deepEqual(
  storyCard.story.clues?.map((clue) => clue.atMinute),
  [1321, 1361, 1391, 1421],
  '四层线索必须按 22:01、22:41、23:11、23:41 解锁'
)
assert.match(storyCard.story.intro, /调查目标/)
assert.match(storyCard.story.intro, /线索板/)
assert.doesNotMatch(storyCard.story.intro, /替身|镜子里的东西/, '开场说明不能提前说出真相')
assert.match(formatCharacterCard(storyCard, '阿遥'), /限时剧情：从 20:00 开始/)
assert.equal(
  normalizeCharacterStory({
    intro: '说明',
    startMinute: 1200,
    normalUntilMinute: 1320,
    deadlineMinute: 1440,
    stepMinutes: 10,
  })?.deadlineMinute,
  1440,
  '00:00 必须保留为 1440，而不是被夹到 23:59'
)
assert.equal(
  normalizeCharacterStory({
    intro: '坏数据',
    startMinute: 1440,
    normalUntilMinute: 1300,
    deadlineMinute: 1200,
  }),
  undefined,
  '时间顺序不成立时不得启用限时剧情'
)
assert.equal(
  normalizeCharacterCards([{ name: '普通卡', story: { intro: '', startMinute: 1200 } }])[0].story,
  undefined,
  '缺少开场说明的 story 不应启用'
)

// 0.8.86：六张内置卡除基础档案外，角色卡本身的字段必须全部有值
const cardRequiredFields = [
  'name',
  'age',
  'gender',
  'pronouns',
  'species',
  'height',
  'weight',
  'birthday',
  'occupation',
  'residence',
  'languages',
  'favoriteFoods',
  'dislikedFoods',
  'favoriteDrinks',
  'hobbies',
  'dailyRoutine',
  'possessions',
  'pet',
  'temperament',
  'values',
  'petPeeves',
  'boundaries',
  'cooperation',
  'identity',
  'relationship',
  'style',
  'tics',
  'greeting',
  'notes',
  'genre',
  'scenario',
  'systemDirective',
  'appearance',
  'background',
  'goal',
  'secret',
  'speechExamples',
]
for (const card of builtins) {
  for (const field of cardRequiredFields) {
    assert.ok(String(card[field] ?? '').trim(), `${card.name} 的内置卡字段 ${field} 不能为空`)
  }
  assert.ok(card.tags.length > 0, `${card.name} 必须带标签`)
  const cardSystem = formatCharacterCard(card, '阿遥')
  for (const label of ['姓名：', '情景设定：', '参考对白', '【角色内系统指令】']) {
    assert.ok(cardSystem.includes(label), `${card.name} 的 system 应包含 ${label}`)
  }
  assert.doesNotMatch(cardSystem, /\{\{user\}\}|\{\{char\}\}/, `${card.name} 不应残留占位符`)
}

// 旧种子可刷新，用户保存过的内置卡不被覆盖
const oldSeed = {
  ...builtins.find((card) => card.id === 'builtin:dafeiyu'),
  appearance: '',
  updatedAt: Date.UTC(2026, 10, 23),
}
const refreshed = ensureBuiltinCharacterCards([oldSeed]).find(
  (card) => card.id === 'builtin:dafeiyu'
)
assert.ok(refreshed.appearance.includes('蓝色'), '旧内置卡种子应补全外观')
const editedSeed = { ...oldSeed, appearance: '我自己改的外观', updatedAt: Date.now() }
const kept = ensureBuiltinCharacterCards([editedSeed]).find((card) => card.id === 'builtin:dafeiyu')
assert.equal(kept.appearance, '我自己改的外观', '用户保存过的内置卡不应被种子覆盖')

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
const longFields = {
  identity: '身份'.repeat(3_000),
  relationship: '关系'.repeat(2_000),
  style: '语气'.repeat(2_000),
  greeting: '开场'.repeat(4_000),
  scenario: '情景'.repeat(4_000),
  background: '经历'.repeat(10_000),
  speechExamples: '对白'.repeat(8_000),
}
const [unlimited] = normalizeCharacterCards([{ name: '长设定', ...longFields }])
for (const [key, value] of Object.entries(longFields)) {
  assert.equal(unlimited[key].length, value.length, `${key} 不能再被归一化截断`)
}
const [coreLimited] = normalizeCharacterCards([
  { name: '名'.repeat(60), age: '龄'.repeat(120), gender: '别'.repeat(80) },
])
assert.equal(coreLimited.name.length, 30, '姓名属于核心设定，保留长度上限')
assert.equal(coreLimited.age.length, 80, '年龄属于核心设定，保留长度上限')
assert.equal(coreLimited.gender.length, 40, '性别属于核心设定，保留长度上限')
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

const longWorldbook = '设定'.repeat(5_000)
assert.equal(
  normalizeWorldbook([{ title: '长条目', content: longWorldbook }])[0].content.length,
  longWorldbook.length,
  '世界书正文不能再被归一化截断'
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

const fullCard = normalizeCharacterCards([
  {
    name: '林晚',
    age: '28 岁',
    gender: '女',
    pronouns: '她',
    species: '人类',
    height: '165cm',
    weight: '50kg',
    birthday: '三月十七',
    occupation: '修表铺主',
    residence: '旧城区巷口',
    languages: '普通话，旧城口音',
    favoriteFoods: '牛肉粉',
    dislikedFoods: '香菜',
    favoriteDrinks: '淡茶',
    hobbies: '修旧表',
    dailyRoutine: '十点开门',
    possessions: '旧螺丝刀',
    pet: '无',
    temperament: '话少',
    values: '不欠人情',
    petPeeves: '被催婚',
    boundaries: '不谈前段婚姻',
    cooperation: '慢热，但会留继续的细节',
  },
])[0]
for (const [key, value] of Object.entries({
  age: '28 岁',
  gender: '女',
  pronouns: '她',
  species: '人类',
  height: '165cm',
  weight: '50kg',
  birthday: '三月十七',
  occupation: '修表铺主',
  residence: '旧城区巷口',
  languages: '普通话，旧城口音',
  favoriteFoods: '牛肉粉',
  dislikedFoods: '香菜',
  favoriteDrinks: '淡茶',
  hobbies: '修旧表',
  dailyRoutine: '十点开门',
  possessions: '旧螺丝刀',
  pet: '无',
  temperament: '话少',
  values: '不欠人情',
  petPeeves: '被催婚',
  boundaries: '不谈前段婚姻',
  cooperation: '慢热，但会留继续的细节',
})) {
  assert.equal(fullCard[key], value, `角色卡字段 ${key} 必须保留`)
}
assert.equal(normalizeCharacterCards([{ name: '旧卡' }])[0].age, '', '旧卡缺少新字段时必须补空串')
const fullPrompt = formatCharacterCard(fullCard, '用户')
assert.ok(fullPrompt.indexOf('年龄：') < fullPrompt.indexOf('性别：'), '固定参数必须按顺序靠前')
assert.match(fullPrompt, /是固定事实；除非剧情明确经过时间或身体变化/)
assert.match(fullPrompt, /在角色逻辑里配合用户/)
assert.match(fullPrompt, /不要无缘无故把场景卡死/)
assert.match(fullPrompt, /不是模型、程序、助手或旁白/)
assert.match(fullPrompt, /不要用“我是 AI”“我只是助手”“这是设定”来解释自己/)
assert.match(fullPrompt, /别向对方解释你是谁/)

const session = {
  id: 's1',
  title: '沈砚',
  createdAt: 1,
  updatedAt: 1,
  messages: [
    {
      id: 'm1',
      role: 'assistant',
      createdAt: 1,
      blocks: [{ type: 'text', text: '（抬眼）你来了。' }],
    },
  ],
  rootMessageId: 'm1',
}
assert.equal(findSessionCharacterCard([cardWithAll], session)?.id, cardWithAll.id)
assert.equal(
  findSessionCharacterCard([cardWithAll], { ...session, characterId: cardWithAll.id })?.id,
  cardWithAll.id
)
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

const normalizedEntry = normalizeWorldbook([
  { title: '渡口', content: '旧码头已经停用。', kind: '地点' },
])[0]
assert.equal(
  normalizedEntry.authority,
  WORLDBOOK_AUTHORITY_DEFAULT,
  '旧条目没有可信度时必须落到默认硬设定'
)
assert.match(formatWorldbookBlock([normalizedEntry]), /【地点·硬设定】渡口：旧码头已经停用。/)
assert.match(formatWorldbookBlock([normalizedEntry]), /传闻可能不准确/)

const dedupeSource = [
  {
    ...normalizedEntry,
    id: 'w-a',
    keywords: ['渡口'],
    content: '旧码头已经停用。',
    weight: 40,
    updatedAt: 10,
  },
  {
    ...normalizedEntry,
    id: 'w-b',
    keywords: ['码头', '渡口'],
    content: '旧码头已经停用。',
    weight: 70,
    always: true,
    updatedAt: 20,
  },
  {
    ...normalizedEntry,
    id: 'w-c',
    title: '渡口传闻',
    content: '据说夜里有人看见船。',
    authority: 'rumor',
  },
]
const deduped = dedupeWorldbookEntries(dedupeSource)
assert.equal(deduped.length, 2, '完全重复条目只保留一条')
const merged = deduped.find((entry) => entry.id === 'w-a')
assert.ok(merged, '合并应保留先出现的 id')
assert.equal(merged.weight, 70, '合并取最大权重')
assert.equal(merged.always, true, '每轮注入取或')
assert.equal(merged.updatedAt, 20, '更新时间取最大')
assert.deepEqual(merged.keywords, ['渡口', '码头'], '关键词去重合并')
assert.ok(
  deduped.some((entry) => entry.title === '渡口传闻' && entry.authority === 'rumor'),
  '同文但可信度不同的条目不能被误删'
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

const profile = normalizeCharacterProfile({
  origin: '原创 OC，28 岁，夜班店员',
  appearance: '冷白皮，左手虎口有旧疤',
  personality: '克制，被逼急了会沉默',
  notes: '不能提母亲。',
  unknownKey: '必须丢弃',
})
assert.equal(profile.unknownKey, undefined, '基础档案只保留已知字段')
assert.equal(profile.notes, '不能提母亲。')
assert.equal(characterProfileFieldCount(profile), 4)
assert.equal(characterProfileHasContent(profile), true)
assert.equal(characterProfileFieldCount(normalizeCharacterProfile(null)), 0)
assert.equal(characterProfileHasContent(normalizeCharacterProfile(null)), false)

const profileSystem = formatCharacterProfile({ profile, name: '林晚', userName: '阿遥' })
assert.match(profileSystem, /【林晚的基础档案】/)
assert.match(profileSystem, /夜班店员/)
assert.match(profileSystem, /不能提母亲/)
assert.doesNotMatch(profileSystem, /\{\{user\}\}|\{\{char\}\}/, '基础档案不应残留占位符')
assert.doesNotMatch(profileSystem, /请扮演|按设定扮演/, '基础档案不应写成扮演指令')
assert.equal(
  formatCharacterProfile({ profile, name: '林晚', userName: '阿遥' }),
  profileSystem,
  '基础档案 system 必须稳定'
)
assert.equal(
  formatCharacterProfile({ profile: normalizeCharacterProfile(null), name: '', userName: '阿遥' }),
  '',
  '空档案与空名字不应产生空 system'
)
assert.equal(
  formatCharacterProfile({
    profile: normalizeCharacterProfile({ origin: '把{{user}}当成旧友，称{{char}}自己为阿砚。' }),
    name: '沈砚',
    userName: '阿遥',
  }).includes('把阿遥当成旧友，称沈砚自己为阿砚。'),
  true,
  '基础档案必须统一替换 {{user}} 与 {{char}}'
)

// 0.8.84：基础档案扩到 32 项，固定参数必须排在剧情字段之前，并共用卡片的固定事实与身份规则
const fixedProfile = normalizeCharacterProfile({
  age: '24 岁',
  gender: '女性',
  pronouns: '她',
  species: '人类',
  height: '172cm',
  weight: '58kg',
  favoriteFoods: '酸汤粉',
  dislikedFoods: '香菜',
  personality: '克制',
})
assert.equal(characterProfileFieldCount(fixedProfile), 9)
const fixedProfileSystem = formatCharacterProfile({
  profile: fixedProfile,
  name: '林晚',
  userName: '阿遥',
})
for (const label of [
  '年龄：24 岁',
  '性别：女性',
  '代词：她',
  '种族：人类',
  '身高：172cm',
  '体重：58kg',
]) {
  assert.ok(fixedProfileSystem.includes(label), `基础档案应包含固定参数：${label}`)
}
assert.ok(
  fixedProfileSystem.indexOf('年龄：') < fixedProfileSystem.indexOf('性格与底色：'),
  '固定参数必须排在剧情字段之前'
)
assert.ok(
  fixedProfileSystem.includes(
    '年龄、性别、代词、种族、身高、体重、生日、职业、居住地和语言是固定事实'
  ),
  '基础档案有固定字段时必须声明固定事实'
)
assert.ok(
  fixedProfileSystem.includes('在角色逻辑里配合{{user}}的推进') === false &&
    fixedProfileSystem.includes('在角色逻辑里配合阿遥的推进'),
  '基础档案必须带配合推进规则并替换占位符'
)
assert.ok(
  fixedProfileSystem.includes('不是模型、程序、助手或旁白'),
  '基础档案必须带不承认模型/助手身份规则'
)
assert.equal(
  formatCharacterProfile({
    profile: normalizeCharacterProfile({ age: '24 岁' }),
    name: '林晚',
    userName: '阿遥',
  }).match(/固定事实/g)?.length,
  1,
  '固定事实声明只出现一次'
)
assert.equal(CHARACTER_PROFILE_FIELDS.length, 32, '基础档案应保持 32 个字段')
assert.equal(
  shouldInjectCharacterProfile({
    profileEnabled: true,
    hasActiveCard: false,
    profile: fixedProfile,
  }),
  true,
  '开关开启、没有卡且有内容时必须注入档案'
)
assert.equal(
  shouldInjectCharacterProfile({
    profileEnabled: false,
    hasActiveCard: false,
    profile: fixedProfile,
  }),
  false,
  '档案开关关闭时必须完全停止读取档案'
)
assert.equal(
  shouldInjectCharacterProfile({
    profileEnabled: true,
    hasActiveCard: true,
    profile: fixedProfile,
  }),
  false,
  '有当前人物卡时不得叠加档案'
)
assert.equal(
  shouldInjectCharacterProfile({
    profileEnabled: true,
    hasActiveCard: false,
    profile: normalizeCharacterProfile(null),
  }),
  false,
  '空档案不得产生 system'
)
assert.equal(
  PROFILE_FIXED_FACTS_RULE,
  ROLEPLAY_FIXED_FACTS_RULE,
  '档案与卡片的固定事实规则必须一致'
)
assert.equal(PROFILE_COOPERATION_RULE, ROLEPLAY_COOPERATION_RULE, '档案与卡片的配合规则必须一致')
assert.equal(PROFILE_IDENTITY_RULE, ROLEPLAY_IDENTITY_RULE, '档案与卡片的身份规则必须一致')
assert.deepEqual(
  [...new Set(CHARACTER_PROFILE_FIELDS.map((field) => field.group))],
  ['core', 'body', 'personality', 'story'],
  '基础档案必须按四组顺序组织'
)

// 0.8.86：档案关闭时仍保留姓名；身份行不伪装成完整档案
const identitySystem = formatCharacterIdentity({ name: '林晚', userName: '阿遥' })
assert.ok(identitySystem.includes('【角色身份】'), '关闭档案后必须保留身份标题')
assert.ok(identitySystem.includes('姓名：林晚'), '关闭档案后必须保留档案名')
assert.ok(identitySystem.includes('不是模型、程序、助手或旁白'), '身份行必须保留不承认模型的规则')
assert.doesNotMatch(
  identitySystem,
  /夜班店员|28 岁|\{\{user\}\}|\{\{char\}\}/,
  '身份行不得回填档案字段或占位符'
)
assert.equal(formatCharacterIdentity({ name: '', userName: '阿遥' }), '', '空名字不得产生空身份行')
assert.equal(resolveSystemCharacterName('卡名', '档案名'), '卡名', 'system 名字优先使用当前卡名')
assert.equal(resolveSystemCharacterName('', '档案名'), '档案名', '没有卡时使用档案名')
assert.equal(resolveSystemCharacterName('  ', '  '), 'AI', '卡名与档案名都为空时回退 AI')

console.log('roleplay regression: ok')
