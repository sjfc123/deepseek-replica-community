/**
 * 默认提示词与角色上下文回归：
 * 1. 默认提示词是普通 DeepSeek AI 助手，不含预置人设，但带应用功能索引；
 * 2. 普通对话不加角色扮演规则，角色卡/档案上下文才使用中性基底，且不带功能索引；
 * 3. 清空提示词回退默认官方助手，自定义提示词不被改写；
 * 4. 角色扮演开关必须依附一张有效角色卡，不能多卡同时生效。
 */
import assert from 'node:assert/strict'

const {
  DEFAULT_SYSTEM_PROMPT,
  LEGACY_SYSTEM_PROMPT,
  NEUTRAL_SYSTEM_PROMPT,
  ASSISTANT_TONE_GUARD,
  ASSISTANT_CONSISTENCY_GUARD,
  ROLEPLAY_CONTINUITY_GUARD,
  ROLEPLAY_SAFETY_GUARD,
  ROLEPLAY_VIEWPOINT_GUARD,
  ROLEPLAY_VIEWPOINT_REMINDER,
  isMostlyDefaultPrompt,
  composeSystemPrompt,
} = await import('../src/services/chat/systemPrompt.ts')
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

const normal = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  custom: false,
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: false,
  assistantWarmth: true,
})
assert.equal(
  normal,
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}`,
  '普通助手默认提示应带固定友好语气与一致性约束，不应追加任何角色规则'
)
assert.doesNotMatch(normal, /【角色身份|【演出规则|【对话格式与称呼/)
assert.doesNotMatch(normal, /【演出规则|【对话格式与称呼|你正在与/)
assert.doesNotMatch(normal, /【叙述视角/, '普通助手对话不得追加叙述视角锁')
assert.match(NEUTRAL_SYSTEM_PROMPT, /正文写自己固定用第一人称「我」/, '中性角色基底必须写明第一人称')
assert.match(ROLEPLAY_VIEWPOINT_REMINDER, /【本轮叙述视角】/, '每轮背景提醒必须有明确标题')
assert.match(ROLEPLAY_VIEWPOINT_REMINDER, /第一人称「我」/, '每轮背景提醒必须锁定第一人称')
assert.match(ROLEPLAY_VIEWPOINT_REMINDER, /不要用姓名或「她」「他」/, '每轮背景提醒必须禁止第三人称自称')

const roleplay = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  custom: false,
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: true,
  assistantWarmth: true,
})
assert.ok(
  roleplay.startsWith(NEUTRAL_SYSTEM_PROMPT.replaceAll('{{user}}', '用户')),
  '角色上下文应换成中性角色基底'
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
assert.match(roleplay, /不用露骨性描写推进/)
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
  custom: false,
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
  custom: false,
  suppressMetaTalk: true,
  userName: '用户',
  roleplayContext: false,
  assistantWarmth: true,
})
assert.equal(
  plainGuard,
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}`,
  '普通助手对话不应因开关追加演出规则'
)

const customPrompt = '你是一个代码审查助手。'
assert.equal(
  composeSystemPrompt({
    savedPrompt: customPrompt,
    custom: true,
    suppressMetaTalk: false,
    userName: '用户',
    roleplayContext: false,
    assistantWarmth: true,
  }),
  customPrompt,
  '自定义提示词在普通对话中应原样保留'
)
const emptyPrompt = composeSystemPrompt({
  savedPrompt: '   ',
  custom: false,
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: false,
  assistantWarmth: true,
})
assert.equal(
  emptyPrompt,
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}`,
  '纯空白提示词必须回退默认官方助手'
)
assert.doesNotMatch(emptyPrompt, /【角色身份|【演出规则|【对话格式与称呼/)

const emptyPromptRoleplay = composeSystemPrompt({
  savedPrompt: '',
  custom: false,
  suppressMetaTalk: true,
  userName: '用户',
  roleplayContext: true,
  assistantWarmth: true,
})
assert.equal(
  emptyPromptRoleplay,
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}`,
  '清空提示词即使收到角色上下文标记也必须回到官方助手，不能恢复角色规则'
)

const warmOff = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  custom: false,
  suppressMetaTalk: true,
  userName: '用户',
  roleplayContext: false,
  assistantWarmth: false,
})
assert.equal(
  warmOff,
  `${DEFAULT_SYSTEM_PROMPT}${ASSISTANT_CONSISTENCY_GUARD}`,
  '关闭友好助手语气后只保留一致性核对，不再追加语气约束'
)
assert.equal(
  composeSystemPrompt({
    savedPrompt: DEFAULT_SYSTEM_PROMPT,
    custom: false,
    suppressMetaTalk: false,
    userName: '用户',
    roleplayContext: false,
    assistantWarmth: true,
  }),
  normal,
  '同参数重复拼装必须逐字一致，保证 system 前缀稳定'
)

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
  custom: false,
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: false,
  assistantWarmth: true,
})
assert.equal(
  nearDefaultReply,
  `${nearDefault}${ASSISTANT_TONE_GUARD}${ASSISTANT_CONSISTENCY_GUARD}`,
  '近似默认人格仍应保留友好语气与一致性约束'
)
const nearDefaultRoleplay = composeSystemPrompt({
  savedPrompt: nearDefault,
  custom: false,
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

console.log('default prompt regression: ok')
