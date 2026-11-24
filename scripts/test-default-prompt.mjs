/**
 * 默认提示词与角色上下文回归：
 * 1. 默认提示词是普通 DeepSeek AI 助手，不含预置人设；
 * 2. 普通对话不加角色扮演规则，角色卡/档案上下文才使用中性基底；
 * 3. 清空提示词、自定义提示词不被改写；
 * 4. 角色扮演开关必须依附一张有效角色卡，不能多卡同时生效。
 */
import assert from 'node:assert/strict'

const {
  DEFAULT_SYSTEM_PROMPT,
  LEGACY_SYSTEM_PROMPT,
  NEUTRAL_SYSTEM_PROMPT,
  composeSystemPrompt,
} = await import('../src/services/chat/systemPrompt.ts')
const { canEnableRoleplay, resolveTurnCharacterCard } = await import(
  '../src/services/chat/roleplay.ts'
)

assert.match(DEFAULT_SYSTEM_PROMPT, /DeepSeek/)
assert.match(DEFAULT_SYSTEM_PROMPT, /深度求索/)
assert.match(DEFAULT_SYSTEM_PROMPT, /AI 助手/)
assert.doesNotMatch(DEFAULT_SYSTEM_PROMPT, /有血有肉|角色扮演|预置角色|人设/)
assert.equal(LEGACY_SYSTEM_PROMPT, '该助手为DeepSeek，由深度求索公司创造。')

const normal = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  custom: false,
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: false,
})
assert.equal(normal, DEFAULT_SYSTEM_PROMPT, '普通助手默认提示不应追加任何角色规则')
assert.doesNotMatch(normal, /演出规则|内心独白|角色/)

const roleplay = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  custom: false,
  suppressMetaTalk: false,
  userName: '用户',
  roleplayContext: true,
})
assert.ok(
  roleplay.startsWith(NEUTRAL_SYSTEM_PROMPT.replaceAll('{{user}}', '用户')),
  '角色上下文应换成中性角色基底'
)
assert.doesNotMatch(roleplay, /由深度求索开发的 AI 助手/, '角色上下文不能保留助手身份')
assert.match(roleplay, /【对话格式与称呼/)

const guarded = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  custom: false,
  suppressMetaTalk: true,
  userName: '用户',
  roleplayContext: true,
})
assert.match(guarded, /【演出规则/)

const plainGuard = composeSystemPrompt({
  savedPrompt: DEFAULT_SYSTEM_PROMPT,
  custom: false,
  suppressMetaTalk: true,
  userName: '用户',
  roleplayContext: false,
})
assert.equal(plainGuard, DEFAULT_SYSTEM_PROMPT, '普通助手对话不应因开关追加演出规则')

const customPrompt = '你是一个代码审查助手。'
assert.equal(
  composeSystemPrompt({
    savedPrompt: customPrompt,
    custom: true,
    suppressMetaTalk: false,
    userName: '用户',
    roleplayContext: false,
  }),
  customPrompt,
  '自定义提示词在普通对话中应原样保留'
)
assert.equal(
  composeSystemPrompt({
    savedPrompt: '   ',
    custom: false,
    suppressMetaTalk: false,
    userName: '用户',
    roleplayContext: false,
  }),
  '',
  '纯空白提示词必须按清空处理'
)

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
