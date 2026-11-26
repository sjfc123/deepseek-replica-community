/* ============================================================================
 * 功能区：回归与构建辅助 / test-system-prompt · 系统提示词
 * 职责：系统提示词：默认与自定义、角色 guard、缓存前缀与占位符。
 * 分区：01 夹具与固定输入；02 验证场景；03 断言与清理
 * 关联：被测或辅助模块 services/api/openaiChat、services/chat/roleplay；由 pnpm 脚本直接执行。
 * 导出：无（独立可执行脚本）
 * 边界：只执行回归、构建与像素比对；不写入产品数据，临时目录在结束时清理。
 * ========================================================================== */

/**
 * System 前缀回归测试：
 * 1. 角色卡开场白不再随消息数量进出，同一张卡永远拼出同一段；
 * 2. OpenAI Chat 把 system 放在 messages 第一条；
 * 3. OpenAI Responses 把 system 放在顶层 instructions；
 * 4. 空 system 不生成 system 消息，也不写空的 instructions。
 */
/* ---- 01 夹具与固定输入 ---- */
import assert from 'node:assert/strict'

const { formatCharacterCard } = await import('../src/services/chat/roleplay.ts')
const { openAIRequest } = await import('../src/services/api/openaiChat.ts')

const card = {
  id: 'builtin:test',
  name: '测试角色',
  identity: '一个用于回归测试的固定身份',
  relationship: '{{user}}的旧识',
  style: '短句，直接',
  tics: '说话前先敲两下桌面',
  greeting: '（抬眼）你来了。先坐。',
  notes: '不要重复开场',
  createdAt: 1,
}
/* ---- 02 验证场景 ---- */

const first = formatCharacterCard(card, '用户')
const second = formatCharacterCard(card, '用户')
assert.equal(first, second, '角色卡前缀必须逐字稳定')
assert.match(first, /开场参考（只在第一条回复使用/)
assert.match(first, /（抬眼）你来了。先坐。/)
assert.match(first, /用户/, '{{user}} 必须替换')
assert.doesNotMatch(first, /{{user}}/, '不能留下用户占位符')

const body = {
  model: 'test-model',
  system: '固定 System 前缀',
  messages: [{ role: 'user', content: '你好' }],
  stream: true,
}

const chat = openAIRequest('chat', body, false)
assert.equal(chat.messages[0].role, 'system')
assert.equal(chat.messages[0].content, '固定 System 前缀')

/* ---- 03 断言与清理 ---- */
const responses = openAIRequest('responses', body, false)
assert.equal(responses.instructions, '固定 System 前缀')
assert.equal(responses.input[0].role, 'user')

const empty = openAIRequest('chat', { ...body, system: '' }, false)
assert.equal(empty.messages[0].role, 'user', '空 system 不应插入 system 消息')
const emptyResponses = openAIRequest('responses', { ...body, system: '   ' }, false)
assert.equal(emptyResponses.instructions, undefined, '空白 system 不应写 instructions')

console.log('system prompt regression: ok')
