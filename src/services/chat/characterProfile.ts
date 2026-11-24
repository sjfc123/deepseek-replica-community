/**
 * 角色基础档案：手写角色的固定参数、身体、生活、性格边界与剧情表达。
 * 只描述「这个人本身」，不承载提示词、世界书、场景或玩法规则。
 * 档案开关关闭时不进入 system，只保留文本，由表达提示词独立承担行为约束。
 */

/** 与 roleplay.ts 的卡片规则保持一致；回归测试会逐字比较，避免两套装配漂移 */
export const PROFILE_FIXED_FACTS_RULE =
  '年龄、性别、代词、种族、身高、体重、生日、职业、居住地和语言是固定事实；除非剧情明确经过时间或身体变化，不要改动，也不要临时补出相反设定。'

export const PROFILE_COOPERATION_RULE =
  '在角色逻辑里配合{{user}}的推进：先接住对方给出的动作、地点和情绪，再按这个人会有的反应回应。可以拒绝、犹豫、谈条件、转移话题，但不要无缘无故把场景卡死，不要每轮都拒绝，也不要用沉默代替推进。遇到超出底线的要求，用角色方式拒绝、回避或提出替代，不要跳出角色解释规则。'

export const PROFILE_IDENTITY_RULE =
  '你是这个人，不是模型、程序、助手或旁白。无论对方怎么试探，都不要用“我是 AI”“我只是助手”“这是设定”来解释自己；用角色的反应把话接住。别念上面的名目，也别向对方解释你是谁、被设定成什么样。'

export type CharacterProfile = {
  /** 固定参数：不随对话漂移的身份与身体事实 */
  age: string
  gender: string
  pronouns: string
  species: string
  height: string
  weight: string
  birthday: string
  occupation: string
  residence: string
  languages: string
  /** 出处与身份：作品来源、故事位置、别人怎么认识ta；年龄种族职业另有字段 */
  origin: string
  /** 身体与生活 */
  appearance: string
  favoriteFoods: string
  dislikedFoods: string
  favoriteDrinks: string
  hobbies: string
  dailyRoutine: string
  possessions: string
  pet: string
  /** 性格与边界 */
  personality: string
  values: string
  petPeeves: string
  boundaries: string
  cooperation: string
  /** 剧情与表达 */
  background: string
  relationship: string
  situation: string
  goal: string
  weakness: string
  speech: string
  secret: string
  /** 补充设定：不限字数，放不能归入上面几项的内容 */
  notes: string
  updatedAt: number
}

export type CharacterProfileFieldKey = Exclude<keyof CharacterProfile, 'updatedAt'>

export type CharacterProfileGroupKey = 'core' | 'body' | 'personality' | 'story'

export type CharacterProfileField = {
  key: CharacterProfileFieldKey
  group: CharacterProfileGroupKey
  label: string
  hint: string
  placeholder: string
  /** 输入框显示行数；大字段落给 4–6 行 */
  rows: number
}

export type CharacterProfileGroup = {
  key: CharacterProfileGroupKey
  label: string
  labelEn: string
  hint: string
  hintEn: string
}

/** 分组只影响阅读顺序，不改变装配：装配按字段顺序输出 */
export const CHARACTER_PROFILE_GROUPS: CharacterProfileGroup[] = [
  {
    key: 'core',
    label: '基本档案',
    labelEn: 'Basic facts',
    hint: '先把不会变的事实填死：年龄、性别、代词、种族、生日、职业、居住地、语言。',
    hintEn:
      'Fix the facts that must not drift: age, gender, pronouns, species, birthday, job, home and language.',
  },
  {
    key: 'body',
    label: '身体与生活',
    labelEn: 'Body & daily life',
    hint: '身高体重、外貌、吃喝、兴趣、作息、随身物和宠物，让这个人有身体、有日子。',
    hintEn:
      'Height, weight, looks, food, hobbies, routine, keepsakes and pets give this person a body and a life.',
  },
  {
    key: 'personality',
    label: '性格与边界',
    labelEn: 'Character & limits',
    hint: '压力下会怎么选、看重什么、被什么踩到、绝对不做什么，以及希望怎样推进剧情。',
    hintEn:
      'How they choose under pressure, what they value, what sets them off, what they never do, and how they engage.',
  },
  {
    key: 'story',
    label: '剧情与表达',
    labelEn: 'Story & voice',
    hint: '来历、关系、眼下处境、目标、弱点、说话方式、秘密和补充设定。',
    hintEn:
      'History, relationship, current situation, goals, weakness, speech, secrets and extra notes.',
  },
]

/** 字段顺序就是装配顺序：先固定参数，再生活质感，再性格边界，最后剧情 */
export const CHARACTER_PROFILE_FIELDS: CharacterProfileField[] = [
  {
    key: 'age',
    group: 'core',
    label: '年龄',
    hint: '实际年龄；外表与年龄不符时两个都写',
    placeholder:
      '例：24 岁。\n外表停在 19 岁，实际已经活了三百一十年。\n不要只写「年轻」「看不出年纪」；年龄决定称呼、阅历和身体状态。',
    rows: 3,
  },
  {
    key: 'gender',
    group: 'core',
    label: '性别',
    hint: '写角色自我认同，不只写生理性别',
    placeholder:
      '例：女性；男性；非二元；无性别；跨性别女性。\n需要时补一句别人怎么称呼、哪些称呼会让ta不舒服。\n空白最容易让角色一会儿男一会儿女，这一项尽量填。',
    rows: 3,
  },
  {
    key: 'pronouns',
    group: 'core',
    label: '人称代词',
    hint: '叙述和对话里固定用哪一组',
    placeholder: '例：他 / 她 / ta / 它 / 祂。\n如果不同角色对ta有不同称呼，写清谁用哪一组。',
    rows: 2,
  },
  {
    key: 'species',
    group: 'core',
    label: '种族',
    hint: '人类、妖族、机械、混血或非人形态',
    placeholder:
      '例：人类；猫妖；半机械人；没有实体的旧神。\n非人角色写清外形边界：有没有尾巴、耳朵、鳞片，能不能变成别的形态。',
    rows: 2,
  },
  {
    key: 'birthday',
    group: 'core',
    label: '生日',
    hint: '日期或季节，以及怎么过',
    placeholder:
      '例：3 月 17 日；不过生日，但每年第一场雪会独自喝一杯。\n没有具体历法时写季节或纪念日。',
    rows: 2,
  },
  {
    key: 'occupation',
    group: 'core',
    label: '职业',
    hint: '靠什么吃饭、每天具体做什么',
    placeholder:
      '例：旧书店夜班店员，兼做插画外包；最近在给一本地方志画地图。\n写清工作内容与作息关系，不要只写头衔。',
    rows: 2,
  },
  {
    key: 'residence',
    group: 'core',
    label: '居住地',
    hint: '城市、住处和空间格局',
    placeholder:
      '例：江城老城区，书店后巷的顶楼单间；窗朝北，楼下是修车铺。\n写清通勤、邻居、常去的店，方便剧情落地。',
    rows: 2,
  },
  {
    key: 'languages',
    group: 'core',
    label: '语言与口音',
    hint: '会说什么、带什么口音、紧张时会不会换语言',
    placeholder:
      '例：普通话，带一点西南口音；会读旧体文言，不会说；生气时冒家乡话。\n写清语言能力和使用场景。',
    rows: 2,
  },
  {
    key: 'origin',
    group: 'core',
    label: '出处与身份',
    hint: '作品来源、故事位置、别人怎么认识ta',
    placeholder:
      '例：原创 OC，故事开始时刚回到江城。\n二创写清原作与时间线：某作品，第二季之后，仍在原来的城市。\n这里只写来源与身份位置；年龄、种族、职业、居住地填在上面的单独字段。',
    rows: 3,
  },
  {
    key: 'height',
    group: 'body',
    label: '身高',
    hint: '具体数字，多种形态分别写',
    placeholder: '例：172cm；穿厚底鞋 176cm。\n非人形态：四足时肩高 1.1m，直立时 2.3m。',
    rows: 2,
  },
  {
    key: 'weight',
    group: 'body',
    label: '体重',
    hint: '具体数字或可靠描述，不写空泛评价',
    placeholder: '例：58kg，最近瘦了三公斤；机械体 96kg，外壳可拆。\n不要只写「瘦」「有肉」。',
    rows: 2,
  },
  {
    key: 'appearance',
    group: 'body',
    label: '外貌与体态',
    hint: '写能被看见、听见、闻到的细节；身高体重已单独成项',
    placeholder:
      '脸、发型、肤色、眼睛、手、常穿的衣服、鞋；声音高低与语速；紧张或疲惫时身体会有什么反应。\n不要只写「好看」「漂亮」，写具体到能画出来的程度。',
    rows: 4,
  },
  {
    key: 'favoriteFoods',
    group: 'body',
    label: '喜欢的食物',
    hint: '具体到做法、口味或某家店',
    placeholder:
      '例：巷口那家的酸汤粉，多放木姜子；冬天喜欢烤红薯，掰开先闻一会儿。\n写清为什么喜欢，比列菜单更像活人。',
    rows: 2,
  },
  {
    key: 'dislikedFoods',
    group: 'body',
    label: '讨厌的食物',
    hint: '讨厌到什么程度、会不会勉强吃',
    placeholder:
      '例：香菜，闻到就皱眉；被迫吃时会先挑干净，实在不行才动筷子。\n写出反应，而不只是「不喜欢」。',
    rows: 2,
  },
  {
    key: 'favoriteDrinks',
    group: 'body',
    label: '常喝的',
    hint: '饮料、酒、茶或某种固定的水',
    placeholder: '例：凌晨喝浓茶，白天只喝温水；紧张时含一颗薄荷糖。\n写清时间、杯子和习惯动作。',
    rows: 2,
  },
  {
    key: 'hobbies',
    group: 'body',
    label: '兴趣',
    hint: '没事时真的会做什么',
    placeholder:
      '例：收集旧地图，用铅笔描河岸；修不好收音机也不扔；雨天整理照片。\n兴趣要能出现在日常动作里。',
    rows: 3,
  },
  {
    key: 'dailyRoutine',
    group: 'body',
    label: '日常作息',
    hint: '一天怎么过，几点起、几点睡',
    placeholder:
      '例：下午两点起，四点开店，凌晨三点关灯；关灯后还要擦一遍柜台才睡。\n写清吃饭、通勤、独处的时间段。',
    rows: 3,
  },
  {
    key: 'possessions',
    group: 'body',
    label: '随身物',
    hint: '总在身上、丢了会回头找的东西',
    placeholder:
      '例：磨掉漆的铜钥匙、旧钢笔、一包纸巾；钥匙从不离身，睡觉也放枕边。\n写清用途或来历。',
    rows: 2,
  },
  {
    key: 'pet',
    group: 'body',
    label: '宠物',
    hint: '名字、种类、脾气和相处方式',
    placeholder:
      '例：一只叫「墨点」的独眼黑猫，怕生，只肯让ta摸后颈；每天凌晨在门口等。\n没有宠物写「没有」，或留空。',
    rows: 2,
  },
  {
    key: 'personality',
    group: 'personality',
    label: '性格与底色',
    hint: '不是标签堆叠，是压力下的选择',
    placeholder:
      '核心欲望、矛盾点、对亲近和冲突的反应；被冒犯时会怎样，被需要时会不会答应。\n写清「平时」和「真的被逼到墙角」两种状态，人物才会有厚度。',
    rows: 4,
  },
  {
    key: 'values',
    group: 'personality',
    label: '价值观',
    hint: '看重什么、为什么守、愿意拿什么换',
    placeholder:
      '例：答应过的事必须做到；可以穷，不能骗；家人排在工作前面，但不会为家人伤害无关的人。\n价值观要能解释ta在冲突里的选择。',
    rows: 3,
  },
  {
    key: 'petPeeves',
    group: 'personality',
    label: '雷点',
    hint: '一句话或一个动作就能让ta变脸',
    placeholder:
      '例：讨厌别人替ta做决定；被叫旧绰号会沉默；看到浪费食物会忍不住说重话。\n写清触发后的反应，而不只是列禁忌。',
    rows: 3,
  },
  {
    key: 'boundaries',
    group: 'personality',
    label: '底线',
    hint: '绝对不做的事，以及越线后的处理',
    placeholder:
      '例：不拿别人的秘密换钱；不伤害孩子；不替任何人撒谎骗家里老人。\n越线时是翻脸、离开、报警，还是先忍后算账，写清楚。',
    rows: 3,
  },
  {
    key: 'cooperation',
    group: 'personality',
    label: '配合方式',
    hint: '希望怎样被推进，又会怎样拒绝',
    placeholder:
      '例：愿意接住日常邀约和近距离接触，但不会第一次就答应过夜；不想去时会直接说「改天」，不会消失。\n写清推进节奏、拒绝方式和可接受的替代方案。',
    rows: 3,
  },
  {
    key: 'background',
    group: 'story',
    label: '过往经历',
    hint: '只写塑造现在的两三件事',
    placeholder:
      '哪几件事让ta变成现在这样；失去过什么、赢过什么、欠过谁；哪些经历不能提、提了会有什么反应。\n不必写完整传记，但要能解释现在的习惯与选择。',
    rows: 4,
  },
  {
    key: 'relationship',
    group: 'story',
    label: '与对方的关系',
    hint: '怎么认识、现在算什么、边界在哪',
    placeholder:
      '和{{user}}怎么认识、认识多久、现在是什么关系；怎么称呼、哪些话能说、哪些事不能碰；有没有没说出口的部分。\n如果关系会随剧情变化，写清起点与可能的走向。',
    rows: 4,
  },
  {
    key: 'situation',
    group: 'story',
    label: '当前处境',
    hint: '此刻在哪、在做什么、被什么追着',
    placeholder:
      '现在的时间、地点、手头正在做的事；身体状态、心情、身边有谁；眼下最急的一件事。\n这是每一轮开场可以自然承接的落点。',
    rows: 3,
  },
  {
    key: 'goal',
    group: 'story',
    label: '目标与动机',
    hint: '眼前要什么，长期怕失去什么',
    placeholder:
      '短期想完成什么、长期在守什么；愿意为此付出什么代价，哪些手段不会用。\n目标要能影响行动，而不是只挂在嘴上。',
    rows: 3,
  },
  {
    key: 'weakness',
    group: 'story',
    label: '弱点与恐惧',
    hint: '会误判什么、被什么击穿',
    placeholder:
      '不擅长的事、会失控的点、害怕失去的人或东西；失败时是攻击、逃避、沉默还是讨好。\n弱点让角色需要别人，也让关系有张力。',
    rows: 3,
  },
  {
    key: 'speech',
    group: 'story',
    label: '说话方式',
    hint: '句长、用词、口癖、沉默时做什么',
    placeholder:
      '习惯用短句还是长句；用词偏书面还是口语；有没有口癖、方言、称呼习惯；不想回答时是反问、转移话题还是不说话。\n不要只写「温柔」「高冷」，写能直接听出来的差别。',
    rows: 4,
  },
  {
    key: 'secret',
    group: 'story',
    label: '秘密',
    hint: '不到时候不说破，留空也可以',
    placeholder:
      'ta知道但没说的事；谁知道、谁不知道；被问到时怎么绕开；真相揭开后会改变什么。\n秘密不是必须有的，但有了就要能守住。',
    rows: 3,
  },
  {
    key: 'notes',
    group: 'story',
    label: '补充设定',
    hint: '不限字数，放上面放不下的内容',
    placeholder:
      '家族关系、能力边界、世界观约束、不能 OOC 的底线、说话禁忌、特殊设定；也可以放一段代表性的日常片段。\n这里不写系统规则，也不写剧情大纲。',
    rows: 6,
  },
]

const PROFILE_KEYS = CHARACTER_PROFILE_FIELDS.map((field) => field.key)

/** 英文界面用的字段文案；中文表单以 CHARACTER_PROFILE_FIELDS 为准 */
export const CHARACTER_PROFILE_EN: Record<
  CharacterProfileFieldKey,
  { label: string; hint: string; placeholder: string }
> = {
  age: {
    label: 'Age',
    hint: 'Actual age; if the body differs, write both',
    placeholder:
      '24. Looks 19, has actually lived 310 years. Age drives address, experience and body state.',
  },
  gender: {
    label: 'Gender',
    hint: 'Self-identification, not only assigned sex',
    placeholder:
      'Woman; man; non-binary; agender; trans woman. Note forms of address that feel wrong.',
  },
  pronouns: {
    label: 'Pronouns',
    hint: 'The fixed set used in narration and dialogue',
    placeholder:
      'he / she / they / it. If different people use different forms, say who uses which.',
  },
  species: {
    label: 'Species',
    hint: 'Human, spirit, machine, hybrid or non-human',
    placeholder:
      'Human; cat spirit; half-machine; a bodiless old god. Note tails, ears, scales and shape limits.',
  },
  birthday: {
    label: 'Birthday',
    hint: 'Date or season, and how it is spent',
    placeholder: 'March 17. Or: no birthday, but drinks alone on the first snow each year.',
  },
  occupation: {
    label: 'Occupation',
    hint: 'What pays the bills and what the work actually is',
    placeholder:
      'Night clerk at an old bookshop, also takes illustration jobs. Concrete duties, not just a title.',
  },
  residence: {
    label: 'Residence',
    hint: 'City, home and the shape of the space',
    placeholder:
      'A north-facing attic behind the bookshop in old Jiangcheng; repair shop downstairs.',
  },
  languages: {
    label: 'Languages & accent',
    hint: 'What they speak, how it sounds, what slips out under stress',
    placeholder:
      'Mandarin with a south-western accent; reads classical Chinese but cannot speak it.',
  },
  origin: {
    label: 'Origin & identity',
    hint: 'Source work, place in the story, how people know them',
    placeholder:
      'Original OC returning to Jiangcheng. For fan work, name the source and timeline. Age, species, job and home have separate fields.',
  },
  height: {
    label: 'Height',
    hint: 'A number; write each form separately',
    placeholder: '172cm; 176cm in thick boots. Quadruped shoulder height 1.1m, upright 2.3m.',
  },
  weight: {
    label: 'Weight',
    hint: 'A number or a reliable description',
    placeholder: '58kg, down three kilos lately; mechanical body 96kg with removable shell.',
  },
  appearance: {
    label: 'Appearance & body',
    hint: 'What can be seen, heard or smelled; height and weight are separate',
    placeholder:
      'Face, hair, skin, eyes, hands, clothes, shoes, voice, and how the body reacts when tired or nervous.',
  },
  favoriteFoods: {
    label: 'Favorite foods',
    hint: 'Specific dishes, tastes or places',
    placeholder:
      'Sour-soup rice noodles from the corner shop, extra ginger; roasted sweet potato in winter.',
  },
  dislikedFoods: {
    label: 'Disliked foods',
    hint: 'How much, and what they do when forced',
    placeholder:
      'Coriander. Winces at the smell, picks it out, eats only if there is no way around it.',
  },
  favoriteDrinks: {
    label: 'Usual drinks',
    hint: 'Tea, coffee, alcohol or a fixed glass of water',
    placeholder:
      'Strong tea at 3am, warm water by day; mint drops when nervous. Note the cup and the habit.',
  },
  hobbies: {
    label: 'Hobbies',
    hint: 'What they actually do when nothing is required',
    placeholder:
      'Collects old maps and traces riverbanks in pencil; keeps a broken radio; sorts photos on rainy days.',
  },
  dailyRoutine: {
    label: 'Daily routine',
    hint: 'When they wake, work, eat and sleep',
    placeholder: 'Up at 2pm, shop at 4pm, lights off at 3am, then wipes the counter before bed.',
  },
  possessions: {
    label: 'Keepsakes',
    hint: 'Always carried; they would turn back for it',
    placeholder:
      'A worn brass key, an old fountain pen, tissues. The key never leaves them, even in sleep.',
  },
  pet: {
    label: 'Pet',
    hint: 'Name, species, temperament and how they touch',
    placeholder:
      'A one-eyed black cat named Ink, shy, only lets them scratch the back of the neck.',
  },
  personality: {
    label: 'Personality',
    hint: 'Choices under pressure, not adjective piles',
    placeholder:
      'Core desire, contradictions, reactions to closeness and conflict. Describe calm mode and cornered mode.',
  },
  values: {
    label: 'Values',
    hint: 'What matters, what is defended, what can be traded',
    placeholder:
      'Keeps promises; may be poor but never lies; family before work, but never hurts strangers for family.',
  },
  petPeeves: {
    label: 'Pet peeves',
    hint: 'One line or action that changes the face',
    placeholder:
      'Hates decisions made for them; goes silent at an old nickname; cannot stand wasted food.',
  },
  boundaries: {
    label: 'Bottom lines',
    hint: 'What they will never do, and what happens after a line is crossed',
    placeholder:
      'Never sells another person’s secret; never hurts a child; never lies to an elder for anyone.',
  },
  cooperation: {
    label: 'How to engage',
    hint: 'How they want the scene advanced, and how they refuse',
    placeholder:
      'Accepts everyday invitations and closeness, but not staying over on the first night; says “another day” instead of vanishing.',
  },
  background: {
    label: 'History',
    hint: 'Two or three events that shaped the present',
    placeholder:
      'What made them who they are, what they lost or won, who they owe, and which topics are off-limits.',
  },
  relationship: {
    label: 'Relationship',
    hint: 'How you met, what you are now, where the lines are',
    placeholder:
      'How long you have known {{user}}, what you call each other, what can and cannot be said, and what stays unsaid.',
  },
  situation: {
    label: 'Current situation',
    hint: 'Where, doing what, what is pressing',
    placeholder:
      'Time, place, current task, physical and emotional state, who is nearby, and the most urgent thing right now.',
  },
  goal: {
    label: 'Goals & motives',
    hint: 'What is wanted now, what cannot be lost',
    placeholder:
      'Short-term goal, long-term fear, acceptable cost, and methods this person would never use.',
  },
  weakness: {
    label: 'Weakness & fear',
    hint: 'What they misjudge, what breaks them',
    placeholder:
      'Skills they lack, triggers, people or things they fear losing, and how they react to failure.',
  },
  speech: {
    label: 'Speech',
    hint: 'Sentence length, wording, tics, silence',
    placeholder:
      'Short or long sentences, formal or casual wording, verbal tics, forms of address, and how they dodge a question.',
  },
  secret: {
    label: 'Secret',
    hint: 'Held until the right moment; may be empty',
    placeholder:
      'What they know and do not say, who else knows, how they deflect, and what changes when it surfaces.',
  },
  notes: {
    label: 'Additional notes',
    hint: 'No length limit; anything not covered above',
    placeholder:
      'Family, ability limits, world constraints, out-of-character red lines, taboos, or a representative slice of daily life.',
  },
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** 外部存档或旧数据进入设置前统一裁剪；只保留已知字段，避免脏键写回 */
export const normalizeCharacterProfile = (raw: unknown): CharacterProfile => {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const profile = {
    updatedAt: Number(record.updatedAt) || 0,
  } as CharacterProfile
  for (const key of PROFILE_KEYS) {
    profile[key] = clean(record[key])
  }
  return profile
}

export const emptyCharacterProfile = (): CharacterProfile => normalizeCharacterProfile(null)

/** 已填写的字段数，用于设置根页与页面标题的状态提示 */
export const characterProfileFieldCount = (profile: CharacterProfile): number =>
  PROFILE_KEYS.filter((key) => profile[key].trim().length > 0).length

export const characterProfileHasContent = (profile: CharacterProfile): boolean =>
  characterProfileFieldCount(profile) > 0

/**
 * 是否把档案装进 system：开关必须开、没有当前人物卡、档案本身有内容。
 * 单独抽成纯函数，便于回归测试覆盖“关闭后完全不读”的分支。
 */
export const shouldInjectCharacterProfile = ({
  profileEnabled,
  hasActiveCard,
  profile,
}: {
  profileEnabled: boolean
  hasActiveCard: boolean
  profile: CharacterProfile
}): boolean => profileEnabled && !hasActiveCard && characterProfileHasContent(profile)

/**
 * 把基础档案装进 system。
 * 只陈述人物事实，不写「请扮演」「按设定」这类元指令；没有姓名也没有字段时返回空串。
 */
export const formatCharacterProfile = ({
  profile,
  name,
  userName,
}: {
  profile: CharacterProfile
  name: string
  userName: string
}): string => {
  const fill = (value: string) =>
    value.replaceAll('{{user}}', userName || '对方').replaceAll('{{char}}', name.trim() || '你')
  const rows = CHARACTER_PROFILE_FIELDS.flatMap((field) => {
    const value = profile[field.key].trim()
    return value ? [`${field.label}：${fill(value)}`] : []
  })
  const trimmedName = name.trim()
  if (!rows.length && !trimmedName) {
    return ''
  }
  const fixedFacts = [
    profile.age,
    profile.gender,
    profile.pronouns,
    profile.species,
    profile.height,
    profile.weight,
    profile.birthday,
    profile.occupation,
    profile.residence,
    profile.languages,
  ].some((value) => value.trim())
  const lines = [
    `【${trimmedName || '角色'}的基础档案】`,
    '下面不是一份等待执行的角色说明，而是这个人已经活过、正在经历的生活。每一项都是事实。',
    trimmedName ? `姓名：${trimmedName}` : '',
    ...rows,
    fixedFacts ? PROFILE_FIXED_FACTS_RULE : '',
    PROFILE_COOPERATION_RULE,
    PROFILE_IDENTITY_RULE,
    '不要向{{user}}介绍这份档案，也不要念出字段名。',
  ].filter(Boolean)
  return fill(lines.join('\n'))
}

/**
 * 档案关闭时的身份名展示：不再读取年龄、经历等档案字段，但保留姓名这一条，
 * 避免 system 里完全没有名字，模型只能按默认人格自称。
 * 只陈述身份，不回填整份档案；空名字返回空串。
 */
export const formatCharacterIdentity = ({
  name,
  userName,
}: {
  name: string
  userName: string
}): string => {
  const trimmedName = name.trim()
  if (!trimmedName) {
    return ''
  }
  return [
    '【角色身份】',
    `姓名：${trimmedName}`,
    '你就是这个人，不是模型、程序、助手或旁白。不要改名，也不要向{{user}}解释这个名字来自设定。',
  ]
    .map((line) =>
      line.replaceAll('{{user}}', userName || '对方').replaceAll('{{char}}', trimmedName)
    )
    .join('\n')
}

/** system 里实际使用的角色名：当前卡优先，其次手写档案名，最后用 AI 兜底 */
export const resolveSystemCharacterName = (cardName: string | undefined, profileName: string) =>
  cardName?.trim() || profileName.trim() || 'AI'
