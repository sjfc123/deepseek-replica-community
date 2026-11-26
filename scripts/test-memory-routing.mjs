/* ============================================================================
 * 功能区：回归与构建辅助 / test-memory-routing · 记忆路由
 * 职责：记忆路由：角色名、卡绑定、普通池与归属。
 * 分区：01 夹具与固定输入；02 验证场景；03 断言与清理
 * 关联：被测或辅助模块 services/chat/memoryRouting；由 pnpm 脚本直接执行。
 * 导出：无（独立可执行脚本）
 * 边界：只执行回归、构建与像素比对；不写入产品数据，临时目录在结束时清理。
 * ========================================================================== */

/**
 * 记忆分池回归：
 * 1. 空名、AI、DeepSeek 及其大小写/空白变体只进普通池；
 * 2. 任意真实角色名进入角色池，不按“有卡就角色”额外归类；
 * 3. 显示名解析顺序固定为角色卡名 > 手写档案名 > 端点默认名；
 * 4. 自动写入、注入和面板保存共用同一判定。
 */
/* ---- 01 夹具与固定输入 ---- */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { ASSISTANT_MEMORY_NAMES, memoryPoolForDisplayName, resolveMemoryDisplayName } =
  await import('../src/services/chat/memoryRouting.ts')

assert.deepEqual(ASSISTANT_MEMORY_NAMES, ['ai', 'deepseek'])

for (const name of ['', '   ', 'AI', 'ai', 'Ai', 'DeepSeek', 'deepseek', ' DeepSeek ']) {
  assert.equal(memoryPoolForDisplayName(name), 'normal', `${JSON.stringify(name)} 应进普通池`)
}
for (const name of ['小夜', '韩寒', 'AI助手', 'DeepSeek-7B']) {
  assert.equal(memoryPoolForDisplayName(name), 'character', `${name} 应进角色池`)
}

assert.equal(
  resolveMemoryDisplayName({ cardName: ' 小夜 ', characterName: '韩寒', custom: true }),
  '小夜',
  '角色卡名优先'
)
/* ---- 02 验证场景 ---- */
assert.equal(
  resolveMemoryDisplayName({ cardName: '   ', characterName: ' 韩寒 ', custom: false }),
  '韩寒',
  '卡名为空时回退手写档案名'
)
assert.equal(
  resolveMemoryDisplayName({ cardName: '', characterName: '', custom: true }),
  'AI',
  '自定义端点空名回退 AI'
)
assert.equal(
  resolveMemoryDisplayName({ cardName: '', characterName: '', custom: false }),
  'DeepSeek',
  '默认端点空名回退 DeepSeek'
)

const root = new URL('../', import.meta.url)
const store = readFileSync(new URL('src/services/chat/store.ts', root), 'utf8')
assert.match(
  store,
  /recordTurnMemory\([\s\S]{0,180}?memoryMode,\s*memoryPool\s*\)/,
  '自动记忆必须把最终池传给 recordTurnMemory'
)
assert.match(store, /const characterMemoryActive = memoryPool === 'character'/)
/* ---- 03 断言与清理 ---- */
assert.match(store, /const normalCards =[\s\S]{0,260}?characterMemoryActive/)

const panel = readFileSync(new URL('src/components/memory/MemoryPanel.tsx', root), 'utf8')
assert.match(panel, /resolveMemoryDisplayName/)
assert.match(panel, /characterMemoryActive \? 'character' : 'normal'/)
assert.doesNotMatch(panel, /roleplayActive/)

const list = readFileSync(new URL('src/components/messages/MessageList.tsx', root), 'utf8')
assert.match(list, /resolveMemoryDisplayName/)
assert.doesNotMatch(list, /roleplayActive/)

console.log('memory routing regression: ok')
