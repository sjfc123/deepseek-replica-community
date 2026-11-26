/* 缓存前缀诊断回归：正常命中不报警；首轮、配置切换、网关无字段不误报；连续低命中与静态段改写要报警。 */
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
  recordPromptCacheSample,
  readPromptCacheSamples,
} = await import('../src/services/chat/cacheDiagnostics.ts')
const { compareVersions } = await import('../src/services/updateCheck.ts')

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
const clean = audit('【角色身份】\n姓名：凯伊\n固定规则')
assert.equal(clean.dynamicMarkers.length, 0, '正常 system 不应出现动态标记')
assert.equal(clean.unresolvedPlaceholders.length, 0, '正常 system 不应留下占位符')
assert.deepEqual(
  audit('【长期记忆】\n今天下雨\nlatest_reminder').dynamicMarkers,
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
assert.equal(
  diagnosePromptCache(readPromptCacheSamples(), 's1'),
  null,
  '首次压缩后的低命中属于预期重建，不应误报'
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
recordPromptCacheSample(
  sample({
    custom: true,
    usage: { input_tokens: 5000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 8 },
  })
)
recordPromptCacheSample(
  sample({
    custom: true,
    usage: { input_tokens: 5100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 8 },
  })
)
const gateway = diagnosePromptCache(readPromptCacheSamples(), 's1')
assert.equal(gateway?.level, 'warning', '自定义网关缺少缓存字段时只应提醒，不能判定提示词丢失')

assert.equal(compareVersions('0.9.2', '0.9.1'), 1, '更高版本应识别为可更新')
assert.equal(compareVersions('v0.9.1', '0.9.1'), 0, 'v 前缀不影响版本比较')
assert.equal(compareVersions('0.9.1-beta', '0.9.1'), 0, '预发布后缀不参与数字比较')

console.log('cache diagnostics regression: ok')
