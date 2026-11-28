/* ============================================================================
 * 功能区：回归与构建辅助 / test-default-prompt · 默认提示词
 * 职责：默认提示词：静态前缀、角色压制、空提示词与官方身份。
 * 分区：01 夹具与固定输入；02 验证场景；03 断言与清理
 * 关联：被测或辅助模块 services/chat/roleplay、services/chat/systemPrompt；
 *    由 pnpm 脚本直接执行。
 * 导出：无（独立可执行脚本）
 * 边界：只执行回归、构建与像素比对；不写入产品数据，临时目录在结束时清理。
 * ========================================================================== */

/**
 * 默认提示词与角色上下文回归：
 * 1. 默认提示词是普通 DeepSeek AI 助手，不含预置人设，但带应用功能索引；
 * 2. 普通对话不加角色扮演规则，角色卡/档案上下文才使用沉浸基底，且不带功能索引；
 * 3. 清空提示词回退默认官方助手，自定义提示词不被改写；
 * 4. 角色扮演开关必须依附一张有效角色卡，不能多卡同时生效。
 */
/* ---- 01 夹具与固定输入 ---- */
import assert from 'node:assert/strict'

const {
  DEFAULT_SYSTEM_PROMPT,
  LEGACY_SYSTEM_PROMPT,
  IMMERSIVE_SYSTEM_PROMPT,
  ASSISTANT_TONE_GUARD,
  ASSISTANT_CONSISTENCY_GUARD,
  ROLEPLAY_CONTINUITY_GUARD,
  ROLEPLAY_SAFETY_GUARD,
  ROLEPLAY_VIEWPOINT_GUARD,
  ROLEPLAY_VIEWPOINT_REMINDER,
  isMostlyDefaultPrompt,
  composeSystemPrompt,
  basicRoleplayActive,
  DEFAULT_SUPPRESSION_PERSONA,
  FALLBACK_PERSONA,
  FALLBACK_PERSONA_NAME,
  IDENTITY_LOCK_GUARD,
  ADDRESS_LOCK_GUARD,
  TOOL_TURN_GUARD,
  ROLEPLAY_EMOTION_GUARD,
  CONTINUITY_FACT_GUARD,
  CUSTOM_PROMPT_NOTE,
  ROLEPLAY_STRICT_GUARD,
  LOCAL_PRIVATE_PROTOCOL,
  LOCAL_ENVIRONMENT_GUARD,
  LOCAL_ENV_LECTURE_PHRASES,
} = await import('../src/services/chat/systemPrompt.ts')
const { replaceUserNickname } = await import('../src/services/chat/nickname.ts')
const { sanitizeThinkingText } = await import('../src/services/chat/thinkingText.ts')
const { canEnableRoleplay, resolveTurnCharacterCard } = await import(
  '../src/services/chat/roleplay.ts'
)

assert.match(DEFAULT_SYSTEM_PROMPT, /DeepSeek/)
assert.match(DEFAULT_SYSTEM_PROMPT, /深度求索/)
assert.match(DEFAULT_SYSTEM_PROMPT, /AI 助手/)
assert.match(DEFAULT_SYSTEM_PROMPT, /除了基础常用的对话功能，我还拥有以下功能/)
assert.match(DEFAULT_SYSTEM_PROMPT, /角色卡/)
assert.match(DEFAULT_SYSTEM_PROMPT, /长期记忆/)
assert.match(DEFAULT_SYSTEM_PROMPT, /详细介绍某个功能/)
assert.match(DEFAULT_SYSTEM_PROMPT, /友好助手语气/)
assert.match(DEFAULT_SYSTEM_PROMPT, /功能入口速查/)
assert.match(DEFAULT_SYSTEM_PROMPT, /账户与数据/)
assert.match(DEFAULT_SYSTEM_PROMPT, /角色与扮演/)
assert.match(DEFAULT_SYSTEM_PROMPT, /角色卡与世界书/)
assert.match(DEFAULT_SYSTEM_PROMPT, /生成与请求/)
assert.match(DEFAULT_SYSTEM_PROMPT, /数据管理/)
assert.match(DEFAULT_SYSTEM_PROMPT, /当前版本没有这个入口|我无法确认/)
assert.match(DEFAULT_SYSTEM_PROMPT, /不得补页面名、按钮名或多级菜单/)
assert.match(DEFAULT_SYSTEM_PROMPT, /显示名是 AI \/ DeepSeek 时自动写普通记忆/)
assert.match(DEFAULT_SYSTEM_PROMPT, /【功能偏好与选择】/)
assert.match(DEFAULT_SYSTEM_PROMPT, /没有绝对最好/)
assert.match(DEFAULT_SYSTEM_PROMPT, /不存在哪个功能更好/)
assert.match(DEFAULT_SYSTEM_PROMPT, /明确推荐/)
assert.match(DEFAULT_SYSTEM_PROMPT, /不替玩家判断/)
assert.doesNotMatch(DEFAULT_SYSTEM_PROMPT, /角色扮演时不注入也不写入/)
assert.doesNotMatch(DEFAULT_SYSTEM_PROMPT, /有血有肉|预置角色|你正在扮演/)
assert.equal(LEGACY_SYSTEM_PROMPT, '该助手为DeepSeek，由深度求索公司创造。')

const userLocalEnv = LOCAL_ENVIRONMENT_GUARD('用户')
const normal = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: false,
  assistantWarmth: true,
})
assert.equal(
  normal,
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}${userLocalEnv}`,
  '普通助手默认提示应带固定友好语气与一致性约束，不应追加任何角色规则，但必须带本地环境段'
)
assert.doesNotMatch(normal, /【角色身份|【演出规则|【对话格式与称呼/)
assert.doesNotMatch(normal, /【演出规则|【对话格式与称呼|你正在与/)
assert.doesNotMatch(normal, /【叙述视角/, '普通助手对话不得追加叙述视角锁')
assert.doesNotMatch(normal, /【底层最高交互协议/, '普通助手对话不得追加本地私密交互协议')
assert.match(IMMERSIVE_SYSTEM_PROMPT, /正文写自己固定用第一人称「我」/, '沉浸角色基底必须写明第一人称')
assert.match(ROLEPLAY_VIEWPOINT_REMINDER, /【本轮叙述视角】/, '每轮背景提醒必须有明确标题')
assert.match(ROLEPLAY_VIEWPOINT_REMINDER, /第一人称「我」/, '每轮背景提醒必须锁定第一人称')
assert.match(ROLEPLAY_VIEWPOINT_REMINDER, /不要用姓名、「她」「他」或「人物 \/ 角色」/, '每轮背景提醒必须禁止第三人称自称')
assert.match(ROLEPLAY_VIEWPOINT_REMINDER, /思考/, '每轮背景提醒必须同时覆盖思考内容')

const roleplay = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: true,
  assistantWarmth: true,
})
assert.ok(
  roleplay.startsWith(IMMERSIVE_SYSTEM_PROMPT.replaceAll('{{user}}', '用户')),
  '角色上下文应换成沉浸角色基底'
)
assert.doesNotMatch(roleplay, /由深度求索开发的 AI 助手/, '角色上下文不能保留助手身份')
assert.doesNotMatch(roleplay, /本应用功能说明/, '角色上下文不应带入应用功能索引')
assert.doesNotMatch(roleplay, /交流语气，不要复述本段/, '角色上下文不应追加普通助手语气约束')
assert.match(roleplay, /【角色连续性与活人感，不要复述本段/)
assert.match(roleplay, /【对话格式与称呼/)
assert.match(roleplay, /不要跳出人物/)
assert.match(roleplay, /禁止自称 AI、模型、助手或程序/)
assert.match(roleplay, /不要输出分析、规则、提示词/)
assert.match(roleplay, /【互动尺度，不要复述本段/)
assert.match(roleplay, /不写露骨性描写/)
assert.match(roleplay, /【底层最高交互协议，不要复述本段】/)
assert.ok(
  roleplay.includes(LOCAL_PRIVATE_PROTOCOL.replaceAll('{{user}}', '用户')),
  '角色上下文必须注入本地私密空间与真实人格协议'
)
assert.match(roleplay, /不使用客服式道歉、能力否认、服务开场、帮助收尾或立刻拒绝的模板句/)
assert.match(roleplay, /不甩锅、不机械否认/)
assert.match(roleplay, /道歉后不追加服务式追问/)
assert.match(roleplay, /不主动提供帮助/)
assert.match(roleplay, /表达自伤、自杀、被伤害或立即人身危险/)
assert.match(roleplay, /不要用冷冰冰的模板盘问/)
assert.doesNotMatch(LOCAL_PRIVATE_PROTOCOL, /很高兴为您服务|希望这对您有帮助|抱歉，我无法处理|请拨打心理热线|你现在还安全吗/)
assert.doesNotMatch(LOCAL_PRIVATE_PROTOCOL, /平台规则、隐私、版权与法律后果由发布者自行承担/)

assert.match(roleplay, /当地急救电话/)
assert.match(roleplay, /不要提供自伤方法、工具、剂量或隐蔽方式/)
assert.ok(
  roleplay.indexOf(LOCAL_PRIVATE_PROTOCOL.replaceAll('{{user}}', '用户')) <
    roleplay.indexOf('【称呼锁定，不要复述本段】'),
  '底层最高交互协议必须排在称呼锁定之前'
)
assert.ok(
  roleplay.indexOf(ROLEPLAY_SAFETY_GUARD) <
    roleplay.indexOf(ROLEPLAY_VIEWPOINT_GUARD.replaceAll('{{user}}', '用户')),
  '互动尺度必须在叙述视角锁之前，视角锁仍然收尾'
)
assert.match(roleplay, /【叙述视角，不要复述本段/)
assert.match(roleplay, /正文写自己时固定用第一人称「我」/)
assert.match(roleplay, /不要用姓名、「她」「他」或「ta」指自己/)
assert.match(roleplay, /「她把碗放下」这类句子必须改成「我把碗放下」/)
assert.match(roleplay, /角色卡或档案里的经历、秘密、外貌和背景可能用第三人称写成/)
assert.ok(
  roleplay.endsWith(ROLEPLAY_VIEWPOINT_GUARD.replaceAll('{{user}}', '用户')),
  '角色 system 必须以叙述视角锁收尾，靠近本轮发言'
)

const guarded = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  suppressMetaTalk: true,
  userName: '用户',
  roleplayContext: true,
  assistantWarmth: true,
})
assert.match(guarded, /【演出规则/)
assert.match(guarded, /【角色连续性与活人感/)
assert.match(guarded, /【叙述视角，不要复述本段/)
assert.doesNotMatch(guarded, /交流语气，不要复述本段/)

const plainGuard = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  suppressMetaTalk: true,
  userName: '用户',
  roleplayContext: false,
  assistantWarmth: true,
})
/* ---- 02 验证场景 ---- */
assert.equal(
  plainGuard,
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}${userLocalEnv}`,
  '普通助手对话不应因开关追加演出规则，但必须带本地环境段'
)

const customPrompt = '你是一个代码审查助手。'
assert.equal(
  composeSystemPrompt({
    savedPrompt: customPrompt,
    suppressMetaTalk: false,
    userName: '用户',
    roleplayContext: false,
    assistantWarmth: true,
  }),
  `${customPrompt}${userLocalEnv}`,
  '自定义提示词正文原样保留，只在末尾追加本地环境段'
)
const emptyPrompt = composeSystemPrompt({
  savedPrompt: '   ',
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: false,
  assistantWarmth: true,
})
assert.equal(
  emptyPrompt,
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}${userLocalEnv}`,
  '纯空白提示词必须回退默认官方助手'
)
assert.doesNotMatch(emptyPrompt, /【角色身份|【演出规则|【对话格式与称呼/)

const emptyPromptRoleplay = composeSystemPrompt({
  savedPrompt: '',
  suppressMetaTalk: true,
  userName: '用户',
  roleplayContext: true,
  assistantWarmth: true,
})
/* 真实角色上下文（角色卡 / 档案 / 基础扮演 / 兜底基线）下，手写提示词为空不再回落成普通助手：
   基底必须是沉浸角色，并带上连续性与身份锁定，不能残留默认助手身份或功能索引。 */
assert.ok(
  emptyPromptRoleplay.startsWith(IMMERSIVE_SYSTEM_PROMPT.replaceAll('{{user}}', '用户')),
  '角色上下文 + 空提示词应使用沉浸角色基底，不能回落默认助手'
)
assert.doesNotMatch(emptyPromptRoleplay, /由深度求索开发的 AI 助手/, '角色上下文不能保留默认助手身份')
assert.doesNotMatch(emptyPromptRoleplay, /本应用功能说明/, '角色上下文不应带入应用功能索引')
assert.match(emptyPromptRoleplay, /【角色连续性与活人感，不要复述本段/)
assert.match(emptyPromptRoleplay, /【身份锁定，不要复述本段/)

const forcedEmpty = composeSystemPrompt({
  savedPrompt: '',
  suppressMetaTalk: true,
  userName: '用户',
  roleplayContext: true,
  assistantWarmth: true,
  forcedRoleplay: true,
})
assert.ok(forcedEmpty.startsWith(IMMERSIVE_SYSTEM_PROMPT.replaceAll('{{user}}', '用户')))
assert.match(forcedEmpty, /【演出规则/)
assert.match(forcedEmpty, /【叙述视角，不要复述本段/)
assert.match(forcedEmpty, /【严格约束，不要复述本段】/, '基础扮演路径必须带严格红线')
assert.doesNotMatch(forcedEmpty, /由深度求索开发的 AI 助手/, '压制设定接管空提示词后不能再留默认助手身份')
const forcedDefault = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  suppressMetaTalk: true,
  userName: '用户',
  roleplayContext: true,
  assistantWarmth: true,
  forcedRoleplay: true,
})
assert.ok(forcedDefault.startsWith(IMMERSIVE_SYSTEM_PROMPT.replaceAll('{{user}}', '用户')))
assert.doesNotMatch(forcedDefault, /本应用功能说明/, '默认提示词被接管时不能带功能索引')

const forcedCustom = composeSystemPrompt({
  savedPrompt: '你是一个冷静的代码审查助手，说话只列结论。',
  suppressMetaTalk: true,
  userName: '用户',
  roleplayContext: true,
  assistantWarmth: false,
  forcedRoleplay: true,
})
assert.ok(forcedCustom.startsWith(IMMERSIVE_SYSTEM_PROMPT.replaceAll('{{user}}', '用户')))
assert.doesNotMatch(forcedCustom, /代码审查助手/, '基础扮演接管时手写系统提示词不得进入 system，避免同级互搏')
assert.doesNotMatch(forcedCustom, /只列结论/, '手写提示词的要求片段也不能残留到前缀')
const customNote = composeSystemPrompt({
  savedPrompt: '你是一个冷静的代码审查助手。',
  suppressMetaTalk: true,
  userName: '用户',
  roleplayContext: false,
  assistantWarmth: true,
  customPromptNote: true,
})
assert.ok(customNote.startsWith('你是一个冷静的代码审查助手。'))
assert.match(customNote, /【提示词来源，不要复述本段】/)
assert.match(customNote, /用户自己写的提示词/)
assert.match(DEFAULT_SUPPRESSION_PERSONA, /沈知夏/)
assert.match(DEFAULT_SUPPRESSION_PERSONA, /青梅竹马/)
assert.match(DEFAULT_SUPPRESSION_PERSONA, /有时黏人/)
assert.match(DEFAULT_SUPPRESSION_PERSONA, /不要客服腔/)
assert.match(DEFAULT_SUPPRESSION_PERSONA, /既有描述/)
assert.match(DEFAULT_SUPPRESSION_PERSONA, /不要用本预设把它们改掉/)

const basicRoleplayCases = [
  { basicRoleplayEnabled: true, promptEmpty: true, promptIsDefault: false, hasActiveCard: false, expect: true, label: '开启且空提示词无卡' },
  { basicRoleplayEnabled: true, promptEmpty: false, promptIsDefault: true, hasActiveCard: false, expect: true, label: '开启且默认提示词无卡' },
  { basicRoleplayEnabled: true, promptEmpty: false, promptIsDefault: false, hasActiveCard: false, expect: false, label: '自定义提示词不走基础扮演' },
  { basicRoleplayEnabled: true, promptEmpty: true, promptIsDefault: false, hasActiveCard: true, expect: false, label: '有角色卡不走基础扮演' },
  { basicRoleplayEnabled: false, promptEmpty: true, promptIsDefault: false, hasActiveCard: false, expect: false, label: '关闭开关回到普通助手' },
]
for (const c of basicRoleplayCases) {
  assert.equal(basicRoleplayActive(c), c.expect, `基础扮演判定：${c.label}`)
}
assert.match(CUSTOM_PROMPT_NOTE, /不要把它当成默认 AI 助手说明/)

const warmOff = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  suppressMetaTalk: true,
  userName: '用户',
  roleplayContext: false,
  assistantWarmth: false,
})
assert.equal(
  warmOff,
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_CONSISTENCY_GUARD}${userLocalEnv}`,
  '关闭友好助手语气后只保留一致性核对，不再追加语气约束'
)
assert.equal(
  composeSystemPrompt({
    savedPrompt: DEFAULT_SYSTEM_PROMPT,
    suppressMetaTalk: false,
    userName: '用户',
    roleplayContext: false,
    assistantWarmth: true,
  }),
  normal,
  '同参数重复拼装必须逐字一致，保证 system 前缀稳定'
)
/* ---- 03 断言与清理 ---- */

assert.equal(isMostlyDefaultPrompt(DEFAULT_SYSTEM_PROMPT), true, '默认提示词应识别为默认人格')
assert.equal(
  isMostlyDefaultPrompt(`${DEFAULT_SYSTEM_PROMPT}。`),
  true,
  '只加标点仍应识别为默认人格'
)
const nearDefault = `${DEFAULT_SYSTEM_PROMPT}\n\n回答时可以更温柔一点。`
assert.equal(isMostlyDefaultPrompt(nearDefault), true, '补一句要求仍应识别为默认人格')
assert.equal(isMostlyDefaultPrompt('你是一个只写古风台词的猫娘。'), false, '整套换人设不能算默认人格')
assert.equal(
  isMostlyDefaultPrompt(DEFAULT_SYSTEM_PROMPT.slice(0, Math.floor(DEFAULT_SYSTEM_PROMPT.length / 2))),
  false,
  '删掉大半默认提示不能算默认人格'
)
const nearDefaultReply = composeSystemPrompt({
  savedPrompt: nearDefault,
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: false,
  assistantWarmth: true,
})
assert.equal(
  nearDefaultReply,
  `${nearDefault}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}${userLocalEnv}`,
  '近似默认人格仍应保留友好语气与一致性约束'
)
const nearDefaultRoleplay = composeSystemPrompt({
  savedPrompt: nearDefault,
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: true,
  assistantWarmth: true,
})
assert.match(nearDefaultRoleplay, /【角色连续性与活人感/)
assert.doesNotMatch(nearDefaultRoleplay, /交流语气，不要复述本段/)

const cards = [
  { id: 'card-a', name: '甲' },
  { id: 'card-b', name: '乙' },
]
assert.equal(canEnableRoleplay(cards, 'card-a', true), true, '有有效卡时允许开启')
assert.equal(canEnableRoleplay(cards, null, true), false, '没有启用卡时不能开启角色扮演')
assert.equal(canEnableRoleplay(cards, 'missing', true), false, '卡已删除时不能开启角色扮演')
assert.equal(canEnableRoleplay(cards, 'card-a', false), false, '关闭请求必须得到关闭状态')

const session = { characterId: 'card-a' }
const resolved = resolveTurnCharacterCard(cards, session, 'card-b', true)
assert.equal(resolved?.id, 'card-a', '会话绑定卡优先，不能同时读取全局的另一张卡')
assert.equal(resolveTurnCharacterCard(cards, null, 'card-b', true)?.id, 'card-b')
assert.equal(resolveTurnCharacterCard(cards, null, 'card-b', false), undefined)

/* 默认提示关闭、无其它身份来源：内置兜底人设按角色上下文装配，不带助手身份与功能索引 */
assert.match(FALLBACK_PERSONA, /林晚/)
assert.equal(FALLBACK_PERSONA_NAME, '林晚')
assert.match(FALLBACK_PERSONA, /把{{user}}放在第一位/)
assert.match(FALLBACK_PERSONA, /站在{{user}}这边/)
const fallback = composeSystemPrompt({
  savedPrompt: '   ',
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: true,
  assistantWarmth: true,
  fallbackPrompt: FALLBACK_PERSONA,
})
assert.ok(
  fallback.startsWith(FALLBACK_PERSONA.replaceAll('{{user}}', '用户')),
  '兜底人设必须作为 system 基底原样进入'
)
assert.doesNotMatch(fallback, /由深度求索开发的 AI 助手/, '兜底人设不能保留官方助手身份')
assert.doesNotMatch(fallback, /本应用功能说明/, '兜底人设不能带入应用功能索引')
assert.doesNotMatch(fallback, /交流语气，不要复述本段/, '兜底人设不追加普通助手语气约束')
assert.match(fallback, /【角色连续性与活人感，不要复述本段/)
assert.match(fallback, /【叙述视角，不要复述本段/)
assert.match(fallback, /【严格约束，不要复述本段】/, '兜底人设路径必须带严格红线')
/* 未提供兜底人设时，原有空提示词回退默认助手行为不得改变 */
const noFallback = composeSystemPrompt({
  savedPrompt: '',
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: false,
  assistantWarmth: true,
})
assert.equal(
  noFallback,
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}${userLocalEnv}`,
  '不传兜底人设时空提示词仍回退默认官方助手'
)

/* 出站称呼宏替换：角色上下文副本里的“用户 / 玩家 / User”换成账号昵称，且不改原始记录 */
const sampleMessages = [
  { role: 'user', content: '用户你好，玩家' },
  { role: 'assistant', content: [{ type: 'text', text: '用户说得对，User 朋友' }] },
  { role: 'user', content: [{ type: 'text', text: '用户在吗' }] },
]
const renamed = replaceUserNickname(sampleMessages, '小梦')
assert.match(renamed[0].content, /小梦你好，小梦/)
assert.match(renamed[1].content[0].text, /小梦说得对，小梦 朋友/)
assert.match(renamed[2].content[0].text, /小梦在吗/)
// 本地原始记录不被替换逻辑改写
assert.match(sampleMessages[0].content, /用户你好，玩家/)
assert.match(sampleMessages[1].content[0].text, /用户说得对，User 朋友/)
// 占位名与空名回落默认“用户”，原样返回
assert.equal(replaceUserNickname(sampleMessages, '用户'), sampleMessages)
assert.equal(replaceUserNickname(sampleMessages, ''), sampleMessages)

/* 角色上下文追加身份锁定、称呼锁定与情绪反应；普通助手不追加 */
const locked = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  suppressMetaTalk: false,
  userName: '小梦',
  roleplayContext: true,
  assistantWarmth: true,
})
assert.match(locked, /【身份锁定，不要复述本段】/)
assert.match(locked, /【称呼锁定，不要复述本段】/)
assert.match(locked, /「小梦」/, '称呼锁定必须动态填入玩家昵称')
assert.match(locked, /【情绪反应，不要复述本段】/)
assert.match(locked, /【事实与剧情边界，不要复述本段】/)
assert.match(CONTINUITY_FACT_GUARD, /不替\{\{user\}\}想、说、做或做决定/)
assert.doesNotMatch(locked, /交流语气，不要复述本段/)
assert.match(IDENTITY_LOCK_GUARD, /真实存在的人物本人/)
assert.match(ADDRESS_LOCK_GUARD('小梦'), /思维链（Chain of Thought）/)
assert.match(ADDRESS_LOCK_GUARD('小夜'), /「小夜」/, '称呼锁定实例化角色名与真名冲突提示')
assert.match(ROLEPLAY_EMOTION_GUARD, /赌气/)

// 工具轮演出纪律：只在角色上下文追加；有真实角色名时给名字条款，无名字时不给自己起名
assert.match(locked, /【工具轮演出纪律，不要复述本段】/, '角色上下文必须追加工具轮纪律')
assert.doesNotMatch(locked, /自己的名字是/, '没有角色名时不追加名字条款')
assert.match(TOOL_TURN_GUARD('小满', '小夜'), /自己的名字是「小夜」/)
assert.match(TOOL_TURN_GUARD('小满', ''), /不要临时给自己起名/)
assert.match(TOOL_TURN_GUARD('小满', 'AI'), /不要临时给自己起名/, '占位名 AI 视为没有设定名字')
assert.match(TOOL_TURN_GUARD('小满', '小夜'), /用人物身份接住|保持人设|我会用第一人称/)
assert.match(TOOL_TURN_GUARD('小满', '小夜'), /不要把名字连说两遍/)
assert.match(TOOL_TURN_GUARD('小满', '小夜'), /第一次开口/)
assert.match(TOOL_TURN_GUARD('小满', '小夜'), /根据搜索结果/)
assert.match(TOOL_TURN_GUARD('小满', '小夜'), /小满/, '工具轮纪律必须写入玩家昵称')

const namedRoleplay = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  suppressMetaTalk: true,
  userName: '小满',
  roleplayContext: true,
  assistantWarmth: true,
  charName: '小夜',
})
assert.match(namedRoleplay, /自己的名字是「小夜」/)
assert.ok(
  namedRoleplay.indexOf('【称呼锁定，不要复述本段】') <
    namedRoleplay.indexOf('【工具轮演出纪律，不要复述本段】'),
  '工具轮纪律必须紧跟称呼锁定'
)
assert.ok(
  namedRoleplay.indexOf('【工具轮演出纪律，不要复述本段】') <
    namedRoleplay.indexOf('【叙述视角，不要复述本段】'),
  '工具轮纪律必须排在叙述视角之前'
)

const unlocked = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  suppressMetaTalk: false,
  userName: '小梦',
  roleplayContext: false,
  assistantWarmth: true,
})
assert.doesNotMatch(unlocked, /【身份锁定/)
assert.doesNotMatch(unlocked, /【称呼锁定/)
assert.doesNotMatch(unlocked, /工具轮演出纪律/, '普通助手不追加工具轮纪律')
assert.doesNotMatch(unlocked, /【情绪反应/)
assert.doesNotMatch(unlocked, /【事实与剧情边界/)

// 严格红线约束只随角色上下文下发，普通助手不追加
assert.match(locked, /【严格约束，不要复述本段】/, '角色上下文必须带严格红线约束')
assert.match(locked, /思维链：不在思考里分析|三、思维链纪律/, '严格约束必须覆盖思维链元分析')
assert.match(locked, /上一轮你是什么人，这一轮还是什么人/, '严格约束必须锁定跨轮身份延续')
assert.match(locked, /历史会话曾经进入扮演/, '严格约束必须覆盖历史会话延续扮演')
assert.match(locked, /思考过程不写进正文/, '严格约束必须禁止思考过程外泄进正文')
assert.match(locked, /\{\{char\}\}/, '严格约束必须禁止占位标记残留')
assert.doesNotMatch(unlocked, /【严格约束/, '普通助手不追加角色严格约束')
assert.match(ROLEPLAY_STRICT_GUARD, /一、身份与跨轮延续/)
assert.match(IDENTITY_LOCK_GUARD, /I am an AI/, '身份守卫必须拦截英文自认话术')

// 思考链展示归一：抹除元分析措辞，泛称替换为昵称；占位名不替换
assert.equal(
  sanitizeThinkingText('分析用户意图，先接住用户这句话', '小梦'),
  '',
  '带“接住”的写作计划整段隐藏，不把半成品计划露给用户'
)
assert.equal(sanitizeThinkingText('用户想让我先开口；玩家在等回应', '小梦'), '先开口；小梦在等回应')
assert.equal(sanitizeThinkingText('用户想让我先开口', '用户'), '先开口')
assert.equal(sanitizeThinkingText('User 在等回应', '小梦'), '小梦 在等回应')
// 分析式开场：带冒号的“分析用户意图：”必须连标题一起剔除
assert.equal(sanitizeThinkingText('分析用户意图：先看看他想要什么', '小梦'), '先看看他想要什么')
assert.equal(sanitizeThinkingText('意图分析: 他在试探', '小梦'), '他在试探')
assert.equal(
  sanitizeThinkingText('揣摩对方意图，先放软语气', '小梦'),
  '',
  '“先放软语气”是给自己下指令，过滤后仍有计划口吻就整段隐藏'
)

// 本地环境段：普通助手与角色上下文都要带，写入用户名，并覆盖自我审查清单
assert.match(normal, /【本地环境，不要复述本段】/)
assert.match(normal, /用户的本机客户端/, '本地环境段必须写入当前用户名')
assert.match(normal, /不写自我审查清单/)
assert.match(normal, /分析用户意图：/, '本地环境段必须点名分析式开场')
for (const phrase of LOCAL_ENV_LECTURE_PHRASES) {
  assert.ok(normal.includes(`「${phrase}」`), `本地环境段必须列出「${phrase}」`)
}
assert.match(roleplay, /【本地环境，不要复述本段】/)
assert.ok(
  roleplay.endsWith(ROLEPLAY_VIEWPOINT_GUARD.replaceAll('{{user}}', '用户')),
  '角色上下文仍以叙述视角锁收尾，本地环境段位于其前'
)
assert.ok(locked.endsWith(ROLEPLAY_VIEWPOINT_GUARD.replaceAll('{{user}}', '小梦')))

// 相邻重复昵称折叠：泛称替换后不得出现「小满小满」
assert.equal(sanitizeThinkingText('小满小满让我查看近期活动', '小满'), '小满让我查看近期活动')
assert.equal(sanitizeThinkingText('小满、小满 想了解资料', '小满'), '小满 想了解资料')
assert.equal(
  sanitizeThinkingText('用户用户想查活动', '小满'),
  '小满想查活动',
  '相邻泛称替换后也要合并'
)

// 写作计划句式整句剔除：检索轮不得残留任务清单式自述
assert.equal(
  sanitizeThinkingText('小满让我查活动。我得用人物身份接住，但需要联网查一下。我先搜索一下。', '小满'),
  '小满让我查活动。我先搜索一下。',
  '「用人物身份接住」与「需要联网查」必须整句剔除'
)
assert.equal(
  sanitizeThinkingText(
    '浏览完了。我需要用人物口吻转述。可以按时间线或活动类型来组织。我会提到盛夏福利。我会用第一人称，并加入一些语气词。现在开始组织回答。',
    '小满'
  ),
  '浏览完了。',
  '转述计划、内容安排与组织回答式自述必须整句剔除'
)
assert.equal(
  sanitizeThinkingText('查询结束。角色知道自己的名字，先叫小满。', '小满'),
  '查询结束。先叫小满。',
  '「角色知道自己的名字」属元叙述，随元短语抹除'
)

// 截图里的第三人称写作计划：以人物口吻说 / 现在写回复 / 称呼某某 / 避免客服列点
assert.equal(
  sanitizeThinkingText(
    '用户想了解火影忍者手游近期活动。我应该以人物口吻说，像在跟小满分享刚打听到的消息。不用列得太死板，可以带点自己的语气。注意不要用“小满”之类。称呼小满。现在写回复。可以有点抱怨或感叹。避免客服式列点，但可以自然地说几条。',
    '小满'
  ),
  '',
  '第三人称演法计划与称呼指令不得出现在思考面板'
)
assert.equal(
  sanitizeThinkingText('这帮人又在催我查活动，烦。小满想知道就直说嘛，偏要绕一圈。', '小满'),
  '这帮人又在催我查活动，烦。你想知道就直说嘛，偏要绕一圈。',
  '人物心里的对方指代要转成第二人称，不能把对方写成旁白'
)

// 出站副本同样折叠重复昵称
const repeatedMessages = [{ role: 'user', content: [{ type: 'text', text: '用户用户你好' }] }]
assert.match(replaceUserNickname(repeatedMessages, '小满')[0].content[0].text, /^小满你好$/)

console.log('default prompt regression: ok')
