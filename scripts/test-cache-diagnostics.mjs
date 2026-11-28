/* ============================================================================
 * 功能区：回归与构建辅助 / test-cache-diagnostics · 缓存诊断
 * 职责：缓存诊断：字段缺失、命中率、重建与报告导出。
 * 分区：01 夹具与固定输入；02 验证场景；03 断言与清理
 * 关联：被测或辅助模块 services/api/openaiChat、services/api/parseEvent、services/chat/cacheDiagnostics、services/chat/systemPrompt 等 6 个模块；
 *    由 pnpm 脚本直接执行。
 * 导出：无（独立可执行脚本）
 * 边界：只执行回归、构建与像素比对；不写入产品数据，临时目录在结束时清理。
 * ========================================================================== */

/* 缓存前缀诊断回归：正常命中不报警；首轮、配置切换、网关无字段不误报；连续低命中与静态段改写要报警。 */
/* ---- 01 夹具与固定输入 ---- */
import assert from 'node:assert/strict'

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
}

const {
  auditSystemText,
  clearPromptCacheSamples,
  diagnosePromptCache,
  fingerprintRequestMessages,
  fingerprintWireRequest,
  recordPromptCacheSample,
  readPromptCacheSamples,
} = await import('../src/services/chat/cacheDiagnostics.ts')
const { compareVersions } = await import('../src/services/updateCheck.ts')
const { DEFAULT_SYSTEM_PROMPT } = await import('../src/services/chat/systemPrompt.ts')
const { readOpenAIFrame } = await import('../src/services/api/openaiChat.ts')
const { readMessageEvent } = await import('../src/services/api/parseEvent.ts')
const { summarizeSessionUsage } = await import('../src/services/tokenUsage.ts')

const audit = (text) => auditSystemText(text)
const base = {
  sessionId: 's1',
  model: 'deepseek-flash',
  format: 'messages',
  custom: false,
  endpointHash: 'official',
  scope: 'messages|official|deepseek-flash|official',
  configHash: 'config-a',
  turnContextHash: 'turn-a',
  turnContextChars: 120,
  latestReminderHash: 'reminder-a',
  latestReminderChars: 40,
  messageCount: 8,
  historyTurns: 3,
  messageChain: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'],
  messageRoles: ['latest_reminder', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user'],
  requestHash: 'request-a',
  chainTruncated: false,
  compacted: false,
  contextSummaryHash: '',
  contextSummaryChars: 0,
  thinking: false,
  search: false,
}

const sample = (overrides = {}) => ({
  ...base,
  ...overrides,
  systemAudit: overrides.systemAudit ?? audit('固定身份\n固定规则'),
  usage: {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 10,
    cache_fields_present: true,
    ...(overrides.usage ?? {}),
  },
})

const rate = (hit, total = 10_000, overrides = {}) =>
  sample({
    ...overrides,
    usage: {
      input_tokens: total - hit,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: hit,
      output_tokens: 10,
    },
  })

clearPromptCacheSamples()
const clean = audit('【角色身份】\n姓名：阿澈\n固定规则')
assert.equal(clean.dynamicMarkers.length, 0, '正常 system 不应出现动态标记')
assert.equal(clean.unresolvedPlaceholders.length, 0, '正常 system 不应留下占位符')
assert.deepEqual(
  audit(DEFAULT_SYSTEM_PROMPT).dynamicMarkers,
  [],
  '默认提示词提到 latest_reminder 功能时不应被当成动态块'
)
assert.deepEqual(
  audit('【本轮叙述视角】固定第一人称').dynamicMarkers,
  [],
  '本轮视角提醒只应出现在 turnContext，不能被误判为 system 动态块'
)
assert.deepEqual(
  audit('【长期记忆】\n今天下雨\n【latest_reminder】\n当前地点：毕节').dynamicMarkers,
  ['记忆块', 'latest_reminder'],
  '动态块应被识别'
)
assert.deepEqual(
  audit('你在{{user}}面前，称呼{{char}}').unresolvedPlaceholders,
  ['{{user}}', '{{char}}'],
  '未替换占位符应被识别'
)

recordPromptCacheSample(rate(8000))
recordPromptCacheSample(rate(8200))
assert.equal(diagnosePromptCache(readPromptCacheSamples(), 's1'), null, '连续健康命中不应报警')

clearPromptCacheSamples()
recordPromptCacheSample(sample({ usage: { input_tokens: 9000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 8 } }))
assert.equal(diagnosePromptCache(readPromptCacheSamples(), 's1'), null, '首轮低命中不应报警')

clearPromptCacheSamples()
recordPromptCacheSample(rate(0))
recordPromptCacheSample(rate(0))
recordPromptCacheSample(rate(0))
const streak = diagnosePromptCache(readPromptCacheSamples(), 's1')
assert.equal(streak?.level, 'problem', '连续三轮低命中应报问题')
assert.ok(streak?.causes.length, '问题应附可能原因')
assert.ok(streak?.evidence.length, '问题应附证据')

clearPromptCacheSamples()
recordPromptCacheSample(rate(8000, 10_000))
recordPromptCacheSample(rate(2000))
recordPromptCacheSample(rate(0))
const sudden = diagnosePromptCache(readPromptCacheSamples(), 's1')
assert.equal(sudden?.level, 'problem', '从健康值骤降应报问题')

clearPromptCacheSamples()
recordPromptCacheSample(rate(0, 10_000))
recordPromptCacheSample(rate(0, 10_000, { configHash: 'config-b' }))
assert.equal(
  diagnosePromptCache(readPromptCacheSamples(), 's1'),
  null,
  '配置刚切换后的低命中属于重建，不应误报'
/* ---- 02 验证场景 ---- */
)

clearPromptCacheSamples()
recordPromptCacheSample(rate(0, 10_000))
recordPromptCacheSample(
  rate(0, 10_000, {
    compacted: true,
    contextSummaryHash: 'summary-a',
    contextSummaryChars: 900,
  })
)
const firstCompaction = diagnosePromptCache(readPromptCacheSamples(), 's1')
assert.equal(firstCompaction?.level, 'warning', '首次压缩后的低命中要说明原因，但不能冒充静态前缀污染')
assert.ok(
  firstCompaction?.evidence.some((item) => item.includes('首次插入上下文摘要')),
  '首次压缩要给出重建原因'
)
recordPromptCacheSample(
  rate(0, 10_000, {
    compacted: true,
    contextSummaryHash: 'summary-b',
    contextSummaryChars: 920,
  })
)
const recompressed = diagnosePromptCache(readPromptCacheSamples(), 's1')
assert.equal(recompressed?.level, 'problem', '连续压缩改写摘要应报问题')
assert.ok(
  recompressed?.causes.some((cause) => cause.includes('连续两轮都在改写上下文摘要')),
  '连续压缩要给出具体原因'
)

clearPromptCacheSamples()
recordPromptCacheSample(
  sample({
    systemAudit: audit('固定规则 A'),
    usage: { input_tokens: 9000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 8 },
  })
)
recordPromptCacheSample(
  sample({
    systemAudit: audit('固定规则 B'),
    usage: { input_tokens: 9000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 8 },
  })
)
const changed = diagnosePromptCache(readPromptCacheSamples(), 's1')
assert.equal(changed?.area, '提示词前缀', '同配置下 system 改写应报前缀污染')
assert.equal(changed?.level, 'problem', '前缀污染应报问题')

clearPromptCacheSamples()
recordPromptCacheSample(rate(8000, 10_000, { messageChain: ['a1', 'a2', 'a3'], messageRoles: ['latest_reminder', 'user', 'assistant'], requestHash: 'r1' }))
recordPromptCacheSample(
  rate(0, 10_000, {
    messageChain: ['x1', 'a2', 'a3', 'a4'],
    messageRoles: ['latest_reminder', 'user', 'assistant', 'user'],
    requestHash: 'r2',
  })
)
const drifted = diagnosePromptCache(readPromptCacheSamples(), 's1')
assert.equal(drifted?.level, 'problem', '历史前缀被改写且骤降时应报问题')
assert.ok(
  drifted?.causes.some((cause) => cause.includes('历史前缀从第 1 条')),
  '要指出具体前缀断点'
)

clearPromptCacheSamples()
recordPromptCacheSample(
  sample({
    custom: true,
    usage: { input_tokens: 5000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 8, cache_fields_present: false },
  })
)
recordPromptCacheSample(
  sample({
    custom: true,
    usage: { input_tokens: 5100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 8, cache_fields_present: false },
  })
)
const gateway = diagnosePromptCache(readPromptCacheSamples(), 's1')
assert.equal(gateway?.level, 'warning', '自定义网关缺少缓存字段时只应提醒，不能判定提示词丢失')

const fp1 = fingerprintRequestMessages([
  { role: 'user', content: '第一轮' },
  { role: 'assistant', content: [{ type: 'text', text: '回答' }] },
])
const fp2 = fingerprintRequestMessages([
  { role: 'user', content: '第一轮' },
  { role: 'assistant', content: [{ type: 'text', text: '回答' }] },
  { role: 'user', content: '第二轮' },
])
assert.deepEqual(fp2.messageChain.slice(0, 2), fp1.messageChain, '追加新消息不应改变历史前缀指纹')
assert.notEqual(fp2.requestHash, fp1.requestHash, '新增消息应改变整轮请求指纹')
const fp3 = fingerprintRequestMessages([
  { role: 'user', content: '第一轮被改写' },
  { role: 'assistant', content: [{ type: 'text', text: '回答' }] },
])
assert.notEqual(fp3.messageChain[0], fp1.messageChain[0], '首条 user 改写必须能被发现')
const wire = fingerprintWireRequest({
  model: 'deepseek-chat',
  messages: [
    { role: 'system', content: '稳定系统提示' },
    { role: 'user', content: '问题' },
    { role: 'assistant', content: '回答' },
    { role: 'user', content: '追问' },
  ],
})
assert.equal(wire?.messageCount, 4, 'wire 指纹应读取最终 messages')
const wireNoReminder = fingerprintWireRequest({
  model: 'deepseek-chat',
  messages: [
    { role: 'system', content: '稳定系统提示' },
/* ---- 03 断言与清理 ---- */
    { role: 'user', content: '问题' },
  ],
})
assert.deepEqual(
  wireNoReminder?.messageChain.slice(0, 1),
  wire?.messageChain.slice(0, 1),
  '最终请求体才是诊断依据'
)

const deepseekUsage = readOpenAIFrame('chat', {
  choices: [{ delta: {} }],
  usage: { prompt_tokens: 100, completion_tokens: 1, prompt_cache_hit_tokens: 80 },
}).usage
assert.equal(deepseekUsage?.cache_read_input_tokens, 80, '顶层 prompt_cache_hit_tokens 必须被识别')
assert.equal(deepseekUsage?.input_tokens, 20, '缓存命中要从输入总量中扣除，避免重复计算')
assert.equal(deepseekUsage?.cache_fields_present, true, '顶层缓存字段应标记为存在')

const detailedUsage = readOpenAIFrame('chat', {
  choices: [{ delta: {} }],
  usage: {
    prompt_tokens: 100,
    completion_tokens: 20,
    prompt_cache_hit_tokens: 40,
    completion_tokens_details: { reasoning_tokens: 8, safety_tokens: 3 },
  },
}).usage
assert.equal(detailedUsage?.reasoning_tokens, 8, 'OpenAI 兼容格式应读取思考 Token')
assert.equal(detailedUsage?.safety_tokens, 3, 'OpenAI 兼容格式应读取安全 Token')

const noCacheFields = readOpenAIFrame('chat', {
  choices: [{ delta: {} }],
  usage: { prompt_tokens: 50, completion_tokens: 1 },
}).usage
assert.equal(noCacheFields?.input_tokens, 50, '缺失缓存字段时仍要保留输入总量')
assert.equal(noCacheFields?.cache_fields_present, false, '缺失缓存字段不能冒充真实 0 命中')

const usageSummary = summarizeSessionUsage([
  {
    role: 'assistant',
    usage: {
      input_tokens: 70,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 2,
      cache_fields_present: false,
    },
  },
])
assert.equal(usageSummary.totals.cacheFieldMissing, 1, '缺字段的请求数要能汇总给用量面板')

const anthropicMissing = readMessageEvent({
  type: 'message_delta',
  delta: { stop_reason: 'end_turn' },
  usage: { input_tokens: 70, output_tokens: 2 },
})
assert.equal(anthropicMissing?.type, 'message_delta', '缓存字段缺失不能导致整条 usage 事件被丢弃')
if (anthropicMissing?.type === 'message_delta') {
  assert.equal(anthropicMissing.usage?.input_tokens, 70, 'Anthropic 缺字段时仍要保留输入')
  assert.equal(anthropicMissing.usage?.cache_fields_present, false, 'Anthropic 缺字段要标记为缺失')
}

assert.equal(compareVersions('0.9.2', '0.9.1'), 1, '更高版本应识别为可更新')
assert.equal(compareVersions('v0.9.1', '0.9.1'), 0, 'v 前缀不影响版本比较')
assert.equal(compareVersions('0.9.1-beta', '0.9.1'), 0, '预发布后缀不参与数字比较')

console.log('cache diagnostics regression: ok')
