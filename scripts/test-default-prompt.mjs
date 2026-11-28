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
  ROLEPLAY_TONE_GUARD,
  CONTINUITY_FACT_GUARD,
  CUSTOM_PROMPT_NOTE,
  ROLEPLAY_STRICT_GUARD,
  LOCAL_PRIVATE_PROTOCOL,
  LOCAL_ENVIRONMENT_GUARD,
  LOCAL_ENV_LECTURE_PHRASES,
  THINKING_VOICE_GUARD,
  TOOL_USE_DISCIPLINE_GUARD,
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
assert.match(DEFAULT_SYSTEM_PROMPT, /当前版本无法确认|我无法确认/)
assert.match(DEFAULT_SYSTEM_PROMPT, /不要补页面名、按钮名、路径、第三方来源/)
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
const thinkingVoice = THINKING_VOICE_GUARD('用户')
const toolDiscipline = TOOL_USE_DISCIPLINE_GUARD
const normal = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: false,
  assistantWarmth: true,
})
assert.equal(
  normal,
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}${thinkingVoice}${toolDiscipline}${userLocalEnv}`,
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
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}${thinkingVoice}${toolDiscipline}${userLocalEnv}`,
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
  `${customPrompt}${thinkingVoice}${toolDiscipline}${userLocalEnv}`,
  '自定义提示词正文原样保留，只在末尾追加本地环境段'
)

const relaxedPrompt = '你是 GPT，按模型身份直接回答。'
const relaxed = composeSystemPrompt({
  savedPrompt: relaxedPrompt,
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: false,
  relaxedIdentity: true,
  assistantWarmth: true,
})
assert.match(relaxed, /你是 GPT/, '用户在手写身份中写明的模型/产品身份必须保留')
assert.doesNotMatch(relaxed, /身份锁定|严格约束|角色连续性与活人感/, '放松身份来源不得追加内部角色身份锁定')
const emptyPrompt = composeSystemPrompt({
  savedPrompt: '   ',
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: false,
  assistantWarmth: true,
})
assert.equal(
  emptyPrompt,
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}${thinkingVoice}${toolDiscipline}${userLocalEnv}`,
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
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_CONSISTENCY_GUARD}${thinkingVoice}${toolDiscipline}${userLocalEnv}`,
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
  `${nearDefault}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}${thinkingVoice}${toolDiscipline}${userLocalEnv}`,
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
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}${thinkingVoice}${toolDiscipline}${userLocalEnv}`,
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
assert.match(locked, /【人物语气与态度，不要复述本段】/)
assert.match(locked, /【事实与剧情边界，不要复述本段】/)
const sameNamed = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  suppressMetaTalk: false,
  userName: '小夜',
  charName: '小夜',
  roleplayContext: true,
  assistantWarmth: true,
})
assert.match(sameNamed, /【同名细节，不要复述本段】/, '玩家名与角色名完全相同时才注入同名反应')
assert.match(sameNamed, /他的名字居然和我同名|这也太罕见了/)
const differentName = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  suppressMetaTalk: false,
  userName: '小梦',
  charName: '小夜',
  roleplayContext: true,
  assistantWarmth: true,
})
assert.doesNotMatch(differentName, /【同名细节/, '名字不同时不触发同名反应')
for (const phrase of ['死不承认', '责怪', '居高临下', '客服式模板', '上帝视角', '我不会道歉']) {
  assert.match(ROLEPLAY_TONE_GUARD, new RegExp(phrase), `态度护栏必须覆盖「${phrase}」`)
}
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
assert.doesNotMatch(unlocked, /【人物语气与态度/)
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

// 思考链展示归一：搜索工作保留，答题式收尾/回避/不追问/不要过度逐句切掉；
// 人物心声、情绪、关系判断保留；用户统一换成名字；不再整段隐藏。
assert.match(THINKING_VOICE_GUARD('小梦'), /思考里只有一个人物的第一人称「我」/)
assert.match(THINKING_VOICE_GUARD('小梦'), /提小梦时一律写「小梦」/)
assert.match(THINKING_VOICE_GUARD('小梦'), /不写怎么答/)
assert.ok(THINKING_VOICE_GUARD('小梦').includes('不写“保持友好'))
assert.match(TOOL_USE_DISCIPLINE_GUARD, /只有当前这句明确要求“帮我查查 \/ 搜一下 \/ 找资料 \/ 检索 \/ 核实”/)
assert.match(TOOL_USE_DISCIPLINE_GUARD, /普通寒暄、情绪、关系、剧情、闲聊/)

assert.equal(sanitizeThinkingText('分析用户意图，先接住用户这句话', '小梦'), '', '纯元分析句丢弃')
assert.equal(
  sanitizeThinkingText('用户想让我先开口；玩家在等回应', '小梦'),
  '小梦想让我先开口；小梦在等回应',
  '泛称统一成用户名，不再改成第二人称'
)
assert.equal(sanitizeThinkingText('User 在等回应', '小梦'), '小梦 在等回应')
assert.equal(sanitizeThinkingText('用户想让我先开口', '用户'), '先开口', '占位名不替换')
assert.equal(sanitizeThinkingText('分析用户意图：先看看他想要什么', '小梦'), '', '分析标题句丢弃')
assert.equal(sanitizeThinkingText('意图分析: 他在试探', '小梦'), '', '试探类元分析句丢弃')

// 一句计划不能连带整段人物心声
assert.equal(
  sanitizeThinkingText('（梦问我的名字。这个直接答就好，不用绕。） 我叫小夜。她问名字，我就告诉她。', '梦'),
  '（梦问我的名字。） 我叫小夜。梦问名字，我就告诉梦。',
  '只切掉“直接答就好”，保留同一段人物反应'
)
assert.equal(
  sanitizeThinkingText('（嗯，梦只是打了个招呼，没有提具体问题。这种情况下不用套功能清单，也不用展开什么，轻松回应一下，把话头递回去就行。）', '梦'),
  '（嗯，梦只是打了个招呼，没有提具体问题。）',
  '同一句里只切计划片段，人物观察留住'
)
assert.equal(
  sanitizeThinkingText('嗯，梦问我的名字。这是个很简单直接的问题，不需要复杂分析。直接告诉梦我叫DeepSeek，是深度求索开发的AI助手，保持友好自然就行。', '梦'),
  '嗯，梦问我的名字。',
  '答题策略与助手身份整句剔除'
)

// 第一人称认知动词后面的他/她，在单用户场景按名字处理
assert.equal(
  sanitizeThinkingText('阿岚问我天气。我担心她晚上出门冷。', '阿岚'),
  '阿岚问我天气。我担心阿岚晚上出门冷。',
  '单用户场景的第三人称指代收成名字'
)
assert.equal(
  sanitizeThinkingText('这帮人又在催我查活动，烦。小满想知道就直说嘛，偏要绕一圈。', '小满'),
  '这帮人又在催我查活动，烦。小满想知道就直说嘛，偏要绕一圈。',
  '人物心里的名字保持名字，不改第二人称'
)

// 相邻重复昵称与悬空标点
assert.equal(sanitizeThinkingText('小满小满让我查看近期活动', '小满'), '小满让我查看近期活动')
assert.equal(sanitizeThinkingText('小满、小满 想了解资料', '小满'), '小满 想了解资料')
assert.equal(sanitizeThinkingText('用户用户想查活动', '小满'), '小满想查活动')
assert.equal(sanitizeThinkingText('阿岚要求检索新模型，并给出信息来源。）。', '阿岚'), '阿岚要求检索新模型，并给出信息来源。')
assert.equal(
  sanitizeThinkingText('梦问"你叫什么名字？', '梦'),
  '梦问你叫什么名字？',
  '删句后残留的单边引号必须收掉'
)

// 搜索工作本身保留：查询计划、结果、来源、场馆、天气数据都可以留在思考里
assert.equal(
  sanitizeThinkingText('用户想知道今天上海的天气。我将进行搜索。我需要整合这些信息来回答。天气情况：白天多云，最高17度。', '阿岚'),
  '阿岚想知道今天上海的天气。我将进行搜索。我需要整合这些信息。白天多云，最高17度。',
  '搜索计划与结果保留，只切“来回答”'
)
assert.equal(
  sanitizeThinkingText('阿岚要求我查展。这些结果显示了几个展览。我可以在回答中提及来源。', '阿岚'),
  '阿岚让我查展。这些结果显示了几个展览。我可以在回答中提及来源。',
  '来源与结果保留'
)
assert.equal(
  sanitizeThinkingText('搜索结果显示了几家展览。我需要打开链接核实，然后引用来源。', '阿岚'),
  '搜索结果显示了几家展览。我需要打开链接核实，然后引用来源。',
  '检索工作可以展示'
)
assert.equal(
  sanitizeThinkingText('多个来源都提到今天是晴到多云，白天最高气温在16-17°C左右。', '阿岚'),
  '多个来源都提到今天是晴到多云，白天最高气温在16-17°C左右。',
  '天气资料句保留'
)
assert.equal(
  sanitizeThinkingText('阿岚想查这周末上海的展览。可以并行搜索。避免列太多。可以顺便吐槽一句“你升职了倒有闲心看展，数据还没给我”。', '阿岚'),
  '阿岚想查这周末上海的展览。可以并行搜索。',
  '搜索计划保留，答题式“避免列太多/顺便吐槽”整句切掉'
)

// 搜索回来后的答题式收尾、回避、不追问、不要过度：逐句切掉
assert.equal(
  sanitizeThinkingText('阿岚说累了，升职也没那么开心，还问我是不是觉得阿岚矫情。阿岚要的不是分析。不要追问。不要过度。带小组的压力提前压过来。', '阿岚'),
  '阿岚说累了，升职也没那么开心，还问我是不是觉得阿岚矫情。带小组的压力提前压过来。',
  '不要追问/不要过度属于答题策略，切掉；人物状态保留'
)
assert.equal(
  sanitizeThinkingText('阿岚说累了，升职也没那么开心。那我们换个话题吧。', '阿岚'),
  '阿岚说累了，升职也没那么开心。',
  '无缘无故换话题要切掉'
)
assert.equal(
  sanitizeThinkingText('阿岚说累了。我不追问，先让她缓一缓。', '阿岚'),
  '阿岚说累了。',
  '“不追问”属于答题式回避，切掉'
)
assert.equal(
  sanitizeThinkingText('阿岚说累了。不要问太多，也不要回避。', '阿岚'),
  '阿岚说累了。',
  '不要问太多/不要回避切掉'
)

// 甩锅、死不承认、高冷说教、客服机械与旁白视角属于态度残留，整句或片段切掉
assert.equal(
  sanitizeThinkingText('我不会道歉，我没错，是你让我，你不断逼我。', '阿岚'),
  '',
  '甩锅话术整句丢弃'
)
assert.equal(
  sanitizeThinkingText('阿岚说累了。我才没错，是你逼我的。', '阿岚'),
  '阿岚说累了。',
  '人物处境保留，甩锅片段切掉'
)
assert.equal(
  sanitizeThinkingText('装高冷，居高临下说教，客服式复读。', '阿岚'),
  '',
  '高冷说教与机械模板丢弃'
)
assert.equal(
  sanitizeThinkingText('旁白以第三人称上帝视角看着他。', '阿岚'),
  '',
  '旁白视角残留丢弃'
)

// 搜索之后混进来的“我的回答将…/用什么口吻/给建议”同样属于答题策略
assert.equal(
  sanitizeThinkingText('我的回答将先给出今晚天气，再给建议。', '阿岚'),
  '',
  '“我的回答将…”切掉'
)
assert.equal(
  sanitizeThinkingText('我需要用角色名的口吻来组织回答。', '阿岚'),
  '',
  '“用什么口吻组织回答”切掉'
)
assert.equal(
  sanitizeThinkingText('我需要整合这些信息，给出今晚出门的建议。', '阿岚'),
  '我需要整合这些信息。',
  '搜索整合保留，给建议的答题尾巴切掉'
)
assert.equal(
  sanitizeThinkingText('这时候不该再拿查资料那套接。', '阿岚'),
  '',
  '“不该再拿…接”属于回避策略，切掉'
)

assert.equal(
  sanitizeThinkingText('这些信息可以用来回答阿岚。', '阿岚'),
  '',
  '“这些信息可以用来回答”切掉'
)
assert.equal(
  sanitizeThinkingText('然后给出具体的天气信息，最后再自然地回到庆祝的话题。', '阿岚'),
  '',
  '回答顺序计划切掉'
)
assert.equal(
  sanitizeThinkingText('把场馆、时间、票价这些具体信息整理出来告诉阿岚。带点情绪，然后再自然地讲展览信息。', '阿岚'),
  '',
  '整理出来告诉/带点情绪/再自然地讲切掉'
)
assert.equal(
  sanitizeThinkingText('我需要用人物自己的话把这些讲清楚，带上来源。再讲查到的内容。', '阿岚'),
  '',
  '“用人物自己的话/再讲查到的内容/带上来源”切掉'
)
assert.equal(
  sanitizeThinkingText('可以提议一两家，带点自己的主张。', '阿岚'),
  '',
  '提议与主张的答题计划切掉'
)
assert.equal(
  sanitizeThinkingText('我挑一条给阿岚说就行。', '阿岚'),
  '',
  '挑一条给用户说切掉'
)

assert.equal(
  sanitizeThinkingText('我需要整合这些信息来回答阿岚。', '阿岚'),
  '我需要整合这些信息。',
  '搜索整合保留，只切“来回答阿岚”'
)
assert.equal(
  sanitizeThinkingText('给来源可以自然地说“官方文档上写着”。但阿岚明确要来源，我可以把链接附上。', '阿岚'),
  '但阿岚明确要来源。',
  '来源交付话术切掉，来源要求保留'
)
assert.equal(
  sanitizeThinkingText('这不是要我查什么，也不是要我给方案。', '阿岚'),
  '',
  '答题式否定收尾切掉'
)

assert.equal(
  sanitizeThinkingText('但也不能太冷硬到卡死。', '阿岚'),
  '',
  '不能太冷硬/卡死切掉'
)
assert.equal(
  sanitizeThinkingText('我该真心替阿岚高兴。想说说带小组的真实感受。', '阿岚'),
  '',
  '我该真心替/想说说切掉'
)
assert.equal(
  sanitizeThinkingText('区域上可以提几个大方向，但我不能编具体店名。', '阿岚'),
  '',
  '区域上可以提几个大方向/不能编店名的答题计划切掉'
)
assert.equal(
  sanitizeThinkingText('把笔转一圈，压住脾气，只说需要什么。', '阿岚'),
  '',
  '只说需要什么属于答题计划，整句切掉'
)
assert.equal(
  sanitizeThinkingText('阿岚让我猜。我猜不出来具体是什么。”“路上捡到一只猫？', '阿岚'),
  '阿岚让我猜。我猜不出来具体是什么。路上捡到一只猫？',
  '相邻收引号/开引号要收掉'
)

assert.equal(
  sanitizeThinkingText('别一下子猜中，反问句。', '阿岚'),
  '',
  '猜谜策略“别猜中/反问句”切掉'
)
assert.equal(
  sanitizeThinkingText('这样也比较自然。', '阿岚'),
  '',
  '“比较自然”的答题自评切掉'
)
assert.equal(
  sanitizeThinkingText('我得用阿岚的语气，先有个反应，带上来源。', '阿岚'),
  '',
  '用语气/先有反应/带上来源切掉'
)
assert.equal(
  sanitizeThinkingText('回复先带个反应，再说日期，然后给新闻。', '阿岚'),
  '',
  '回复顺序计划切掉'
)
assert.equal(
  sanitizeThinkingText('这个信息够用了，不需要再打开链接。先有个反应。', '阿岚'),
  '这个信息够用了，不需要再打开链接。',
  '检索判断保留，先有反应切掉'
)

assert.equal(
  sanitizeThinkingText('那我就直接告诉阿岚日期，再顺一条新闻。', '阿岚'),
  '',
  '直接告诉/再顺一条切掉'
)
assert.equal(
  sanitizeThinkingText('可以用第一条消息或者第二条消息，选第二条吧，现场感强一点。', '阿岚'),
  '',
  '挑选资料的答题计划切掉'
)
assert.equal(
  sanitizeThinkingText('就讲第二条消息吧，细节和关系还能接上。', '阿岚'),
  '',
  '“就讲/就选”解题计划切掉'
)

// 答题策略、拿主意、客服腔与自我解释
assert.equal(
  sanitizeThinkingText('我得拿主意，像真会做决定的人。想想附近有什么。不能编太细的店名吧。稳妥点。', '阿岚'),
  '',
  '拿主意/编细节/稳妥点属于写戏计划'
)
assert.equal(
  sanitizeThinkingText('不需要友好。简洁友好一点。保持友好自然。', '阿岚'),
  '',
  '用户点名的友好/简洁口径必须清掉'
)
assert.equal(
  sanitizeThinkingText('她今天对我挺友好，我笑了笑。', '阿岚'),
  '她今天对我挺友好，我笑了笑。',
  '人物叙述里的“友好”不能误伤'
)
assert.equal(
  sanitizeThinkingText('阿岚分享升职高兴事，我该真诚庆祝。', '阿岚'),
  '阿岚分享升职高兴事。',
  '“我该真诚庆祝”属于答题计划，只切后半句'
)
assert.equal(
  sanitizeThinkingText('阿岚要我讲真实感觉，不要安慰。但也不能伤人。', '阿岚'),
  '阿岚要我讲真实感觉，不要安慰。',
  '“不能伤人”是答题分寸，切掉；真实感觉的任务上下文留着'
)

// 人物情绪必须能正常出现，不再因为一句计划整段吞掉
assert.equal(
  sanitizeThinkingText('阿岚让我猜开心的事，没有给线索。', '阿岚'),
  '阿岚让我猜开心的事，没有给线索。',
  '任务备注不再整句隐藏'
)
assert.equal(
  sanitizeThinkingText('（阿岚说累了，升职也没那么开心。我心里也堵着事，但先不逼她。）', '阿岚'),
  '（阿岚说累了，升职也没那么开心。我心里也堵着事，但先不逼阿岚。）',
  '情绪与关系判断完整保留'
)
assert.equal(
  sanitizeThinkingText('阿岚想让我查天气。我心里有点烦，但还是得去。', '阿岚'),
  '阿岚想让我查天气。我心里有点烦，但还是得去。',
  '检索任务与人物不情愿可以同时存在'
)

// 本地环境段：普通助手与角色上下文都要带，写入用户名，并覆盖自我审查清单
assert.match(normal, /【本地环境，不要复述本段】/)
assert.match(normal, /用户的本机客户端/)
assert.match(normal, /不写自我审查清单/)
assert.match(normal, /分析用户意图：/)
for (const phrase of LOCAL_ENV_LECTURE_PHRASES) {
  assert.ok(normal.includes(`「${phrase}」`), `本地环境段必须列出「${phrase}」`)
}
assert.match(roleplay, /【本地环境，不要复述本段】/)
assert.ok(
  roleplay.endsWith(ROLEPLAY_VIEWPOINT_GUARD.replaceAll('{{user}}', '用户')),
  '角色上下文仍以叙述视角锁收尾，本地环境段位于其前'
)
assert.ok(locked.endsWith(ROLEPLAY_VIEWPOINT_GUARD.replaceAll('{{user}}', '小梦')))
assert.ok(
  roleplay.indexOf(thinkingVoice) < roleplay.indexOf(ROLEPLAY_VIEWPOINT_GUARD.replaceAll('{{user}}', '用户')),
  '思考声音必须排在叙述视角锁之前'
)

// 出站副本同样折叠重复昵称
const repeatedMessages = [{ role: 'user', content: [{ type: 'text', text: '用户用户你好' }] }]
assert.match(replaceUserNickname(repeatedMessages, '小满')[0].content[0].text, /^小满你好$/)

console.log('default prompt regression: ok')
