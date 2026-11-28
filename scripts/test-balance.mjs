/* ============================================================================
 * 功能区：回归与构建辅助 / test-balance · 余额与上下文用量
 * 职责：余额格式化、货币符号、上下文快照聚合与余额胶囊设置默认值/ setter 回归。
 * 分区：01 夹具与存储桩；02 余额格式化断言；03 上下文快照断言；04 设置项断言
 * 关联：被测模块 services/api/balance、services/chat/tokenUsage、services/settings；
 *    由 pnpm 脚本直接执行。
 * 导出：无（独立可执行脚本）
 * 边界：不发起网络请求；余额接口字段归一化只测纯函数部分。
 * ========================================================================== */

/* ---- 01 夹具与存储桩 ---- */
import assert from 'node:assert/strict'

const storage = new Map()
globalThis.window = {}
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}

const {
  currencySymbol,
  formatBalanceAmount,
} = await import('../src/services/api/balanceFormat.ts')
const { contextSnapshot } = await import('../src/services/chat/tokenUsage.ts')
const {
  useSettings,
  setBalanceChipEnabled,
  setBalanceChipPosition,
  setBalanceChipShowUsage,
} = await import('../src/services/settings.ts')

/* ---- 02 余额格式化断言 ---- */
assert.equal(currencySymbol('CNY'), '¥')
assert.equal(currencySymbol('USD'), '$')
assert.equal(currencySymbol('JPY'), 'JPY ')
assert.equal(formatBalanceAmount('110.00'), '110.00')
assert.equal(formatBalanceAmount('5'), '5.00')
assert.equal(formatBalanceAmount('赠金已用完'), '赠金已用完')
assert.equal(formatBalanceAmount(''), '')

/* ---- 03 上下文快照断言 ---- */
const session = {
  id: 's1',
  messages: [
    { id: 'u1', role: 'user', content: 'hi' },
    {
      id: 'a1',
      role: 'assistant',
      content: 'hello',
      usage: {
        input_tokens: 80,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 0,
        output_tokens: 30,
        reasoning_tokens: 10,
        safety_tokens: 2,
        cache_fields_present: true,
      },
    },
    {
      id: 'a2',
      role: 'assistant',
      content: 'again',
      usageHistory: [
        {
          input_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 120,
          output_tokens: 40,
          reasoning_tokens: 5,
          cache_fields_present: true,
        },
      ],
    },
  ],
}

const snapshot = contextSnapshot(session)
assert.equal(snapshot.requests, 2)
assert.equal(snapshot.replies, 2)
assert.equal(snapshot.totals.input, 280)
assert.equal(snapshot.totals.output, 70)
assert.equal(snapshot.totals.total, 350)
assert.equal(snapshot.totals.cacheRead, 120)
assert.equal(snapshot.totals.cacheMiss, 130)
assert.equal(snapshot.totals.cacheWrite, 30)
assert.equal(snapshot.totals.reasoning, 15)
assert.equal(snapshot.totals.safety, 2)
assert.ok(snapshot.last)
const lastInput =
  snapshot.last.input_tokens +
  snapshot.last.cache_read_input_tokens +
  snapshot.last.cache_creation_input_tokens
assert.equal(lastInput, 180)

const emptySnapshot = contextSnapshot({ id: 's2', messages: [] })
assert.equal(emptySnapshot.requests, 0)
assert.equal(emptySnapshot.last, null)

/* ---- 04 设置项断言 ---- */
const state = useSettings.getState()
assert.equal(state.balanceChipEnabled, true, '余额胶囊默认开启')
assert.equal(state.balanceChipPosition, 'bottom', '默认底部居中')
assert.equal(state.balanceChipShowUsage, true, '默认附带上下文用量')

setBalanceChipEnabled(false)
assert.equal(useSettings.getState().balanceChipEnabled, false)
assert.equal(storage.get('replica:balance-chip-enabled'), '0')

setBalanceChipPosition('top')
assert.equal(useSettings.getState().balanceChipPosition, 'top')
assert.equal(storage.get('replica:balance-chip-position'), 'top')

setBalanceChipShowUsage(false)
assert.equal(useSettings.getState().balanceChipShowUsage, false)
assert.equal(storage.get('replica:balance-chip-show-usage'), '0')

console.log('test:balance ok')
