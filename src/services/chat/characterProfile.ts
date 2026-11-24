/**
 * 角色基础档案：手写角色的出处、外貌、性格、经历与处境。
 * 只描述「这个人本身」，不承载提示词、世界书、场景或玩法规则；
 * 启用角色卡时以卡为准，没有人物卡时由这份档案补上身份与生活史。
 */

export type CharacterProfile = {
  /** 出处、身份、年龄、种族、职业，以及在故事里的位置 */
  origin: string
  appearance: string
  personality: string
  background: string
  relationship: string
  situation: string
  goal: string
  weakness: string
  speech: string
  habits: string
  secret: string
  /** 补充设定：不限字数，放不能归入上面几项的内容 */
  notes: string
  updatedAt: number
}

export type CharacterProfileFieldKey = Exclude<keyof CharacterProfile, 'updatedAt'>

export type CharacterProfileField = {
  key: CharacterProfileFieldKey
  label: string
  hint: string
  placeholder: string
  /** 输入框显示行数；大字段落给 4–6 行 */
  rows: number
}

/** 字段顺序就是装配顺序：先是谁，再是什么样，最后是藏起来的部分 */
export const CHARACTER_PROFILE_FIELDS: CharacterProfileField[] = [
  {
    key: 'origin',
    label: '出处与身份',
    hint: '原创、OC、二创、游戏、动漫、小说角色都从这里开始',
    placeholder:
      '例：原创 OC，26 岁，江城旧书店的夜班店员，曾是美术生。\n二创写清原作与时间线：某作品，第二季之后，仍在原来的城市。\n写清年龄、种族、职业、身份，以及在故事里的位置。',
    rows: 4,
  },
  {
    key: 'appearance',
    label: '外貌与体态',
    hint: '写能被看见、听见、闻到的细节',
    placeholder:
      '身高、体型、脸、发型、肤色、常穿的衣服、鞋、随身物件；声音高低与语速；紧张或疲惫时身体会有什么反应。\n不要只写「好看」「漂亮」，写具体到能画出来的程度。',
    rows: 4,
  },
  {
    key: 'personality',
    label: '性格与底色',
    hint: '不是标签堆叠，是压力下的选择',
    placeholder:
      '核心欲望、底线、矛盾点、对亲近和冲突的反应；被冒犯时会怎样，被需要时会不会答应。\n写清「平时」和「真的被逼到墙角」两种状态，人物才会有厚度。',
    rows: 4,
  },
  {
    key: 'background',
    label: '过往经历',
    hint: '只写塑造现在的两三件事',
    placeholder:
      '哪几件事让ta变成现在这样；失去过什么、赢过什么、欠过谁；哪些经历不能提、提了会有什么反应。\n不必写完整传记，但要能解释现在的习惯与选择。',
    rows: 5,
  },
  {
    key: 'relationship',
    label: '与对方的关系',
    hint: '怎么认识、现在算什么、边界在哪',
    placeholder:
      '和{{user}}怎么认识、认识多久、现在是什么关系；怎么称呼、哪些话能说、哪些事不能碰；有没有没说出口的部分。\n如果关系会随剧情变化，写清起点与可能的走向。',
    rows: 4,
  },
  {
    key: 'situation',
    label: '当前处境',
    hint: '此刻在哪、在做什么、被什么追着',
    placeholder:
      '现在的时间、地点、手头正在做的事；身体状态、心情、身边有谁；眼下最急的一件事。\n这是每一轮开场可以自然承接的落点。',
    rows: 3,
  },
  {
    key: 'goal',
    label: '目标与动机',
    hint: '眼前要什么，长期怕失去什么',
    placeholder:
      '短期想完成什么、长期在守什么；愿意为此付出什么代价，哪些手段不会用。\n目标要能影响行动，而不是只挂在嘴上。',
    rows: 3,
  },
  {
    key: 'weakness',
    label: '弱点与恐惧',
    hint: '会误判什么、被什么击穿',
    placeholder:
      '不擅长的事、会失控的点、害怕失去的人或东西；失败时是攻击、逃避、沉默还是讨好。\n弱点让角色需要别人，也让关系有张力。',
    rows: 3,
  },
  {
    key: 'speech',
    label: '说话方式',
    hint: '句长、用词、口癖、沉默时做什么',
    placeholder:
      '习惯用短句还是长句；用词偏书面还是口语；有没有口癖、方言、称呼习惯；不想回答时是反问、转移话题还是不说话。\n不要只写「温柔」「高冷」，写能直接听出来的差别。',
    rows: 4,
  },
  {
    key: 'habits',
    label: '喜恶与日常',
    hint: '让ta有生活，而不是只在等回复',
    placeholder:
      '吃什么、喝什么、几点睡；工作或学业、朋友、宠物、常去的地方；无聊时做什么，烦了会去哪。\n写几个没有剧情作用的小习惯，人物就会像真的在过日子。',
    rows: 4,
  },
  {
    key: 'secret',
    label: '秘密',
    hint: '不到时候不说破，留空也可以',
    placeholder:
      'ta知道但没说的事；谁知道、谁不知道；被问到时怎么绕开；真相揭开后会改变什么。\n秘密不是必须有的，但有了就要能守住。',
    rows: 3,
  },
  {
    key: 'notes',
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
  origin: {
    label: 'Origin & identity',
    hint: 'OC, fan work, game, anime or novel: start here',
    placeholder:
      'Age, species, job, role in the story, and the source work or timeline. For fan characters, name the original work.',
  },
  appearance: {
    label: 'Appearance & body',
    hint: 'What can be seen, heard or smelled',
    placeholder:
      'Height, build, face, hair, clothes, voice, scent, and how the body reacts when tired or nervous. Concrete enough to draw.',
  },
  personality: {
    label: 'Personality',
    hint: 'Choices under pressure, not adjective piles',
    placeholder:
      'Core desire, bottom line, contradictions, reactions to closeness and conflict. Describe calm mode and cornered mode.',
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
  habits: {
    label: 'Likes & daily life',
    hint: 'Make them live, not wait for a reply',
    placeholder:
      'Food, drink, sleep schedule, work or study, friends, pets, usual places, and small meaningless habits.',
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
  const rows = CHARACTER_PROFILE_FIELDS.flatMap((field) => {
    const value = profile[field.key].trim()
    return value ? [`${field.label}：${value}`] : []
  })
  const trimmedName = name.trim()
  if (!rows.length && !trimmedName) {
    return ''
  }
  const withUser = (text: string) =>
    text.replaceAll('{{user}}', userName || '对方').replaceAll('{{char}}', trimmedName || '你')
  const lines = [
    `【${trimmedName || '角色'}的基础档案】`,
    '下面不是一份等待执行的角色说明，而是这个人已经活过、正在经历的生活。每一项都是事实。',
    trimmedName ? `姓名：${trimmedName}` : '',
    ...rows,
    '回应时按这些事实活着：该知道的知道，不该知道的不知道；没有写到的部分不要临时补出新的身份、经历或关系。',
    '不要向{{user}}介绍这份档案，也不要念出字段名。',
  ].filter(Boolean)
  return withUser(lines.join('\n'))
}
