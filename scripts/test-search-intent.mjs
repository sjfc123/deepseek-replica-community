/* ============================================================================
 * 功能区：回归与构建辅助 / test-search-intent · 显式检索判定
 * 职责：验证普通寒暄、剧情与情绪对话不会被误判为检索请求；只有明确查搜找或链接才放行工具。
 * 分区：01 夹具；02 断言
 * 关联：被测模块 services/chat/searchIntent、services/chat/systemPrompt。
 * 导出：无（独立可执行脚本）
 * 边界：不发起网络请求，不读取真实账号数据。
 * ========================================================================== */

import assert from 'node:assert/strict'

const { containsUrl, hasExplicitSearchRequest } = await import('../src/services/chat/searchIntent.ts')
const { TOOL_USE_DISCIPLINE_GUARD } = await import('../src/services/chat/systemPrompt.ts')

const shouldNotSearch = ['你好', '今天心情怎么样', '陪我聊聊天', '我饿了', '讲讲猫娘故事', '我们接下来去哪里', '新闻']
for (const question of shouldNotSearch) {
  assert.equal(hasExplicitSearchRequest(question), false, `普通对话不应触发检索：${question}`)
}

const shouldSearch = [
  '帮我查查 DeepSeek 的最新价格',
  '搜一下今天有什么新闻',
  '找一下相关资料',
  '查一下这个接口的版本',
  'https://example.com/article',
]
for (const question of shouldSearch) {
  assert.equal(hasExplicitSearchRequest(question), true, `明确请求应触发检索：${question}`)
}

assert.equal(containsUrl('你好'), false)
assert.equal(containsUrl('https://example.com/article'), true)
assert.match(TOOL_USE_DISCIPLINE_GUARD, /帮我查查 \/ 搜一下 \/ 找资料 \/ 检索 \/ 核实/)
assert.doesNotMatch(TOOL_USE_DISCIPLINE_GUARD, /天气、新闻、价格、日期、版本等会变化的外部事实/)

console.log('search intent regression: ok')
