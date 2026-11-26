/* ============================================================================
 * 功能区：回归与构建辅助 / test-session-groups · 会话分组
 * 职责：会话分组：时间桶、角色子组、排序、空组与删除卡。
 * 分区：01 夹具与固定输入；02 验证场景；03 断言与清理
 * 关联：被测或辅助模块 services/chat/sessionGroups；由 pnpm 脚本直接执行。
 * 导出：无（独立可执行脚本）
 * 边界：只执行回归、构建与像素比对；不写入产品数据，临时目录在结束时清理。
 * ========================================================================== */

/**
 * 会话日期分组回归：
 * 1. 今天、昨天、前天单独成组；
 * 2. 三天前、7 天前、15 天前、30天、近三个月、近一年按边界落组；
 * 3. 超过两年的会话回落到月份分组；
 * 4. 分组按时间倒序连续排列，不合并跨桶会话；
 * 5. 时间组内出现角色会话时再按普通聊天与各角色卡拆子组，空子组不生成。
 */
/* ---- 01 夹具与固定输入 ---- */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'

// TypeScript 源码内部使用 .js 后缀引用相邻模块；测试运行时映射回 .ts 文件。
const source = new URL('../src/', import.meta.url)
registerHooks({
  resolve(specifier, context, next) {
    if (
      context.parentURL?.startsWith(source.href) &&
      specifier.startsWith('.') &&
      specifier.endsWith('.js')
    ) {
      const target = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
      if (existsSync(target)) {
        return next(target.href, context)
      }
    }
    return next(specifier, context)
  },
})

// i18n 入口在模块加载时会读取 WebView 桥；回归只测纯分组，补一个空窗口即可。
globalThis.window = {}
const { groupSessions, groupSessionsByCharacter } =
  await import('../src/services/chat/sessionGroups.ts')

const now = new Date(2026, 10, 25, 12, 0, 0, 0).getTime()
const labels = {
  sessionHistoryTimelineLabelToday: '今天',
  sessionHistoryTimelineLabelYesterday: '昨天',
  sessionHistoryTimelineLabelDayBefore: '前天',
  sessionHistoryTimelineLabel3days: '三天前',
  sessionHistoryTimelineLabel7days: '7 天前',
  sessionHistoryTimelineLabel15days: '15 天前',
  sessionHistoryTimelineLabel30days: '30天',
  sessionHistoryTimelineLabel3months: '近三个月',
  sessionHistoryTimelineLabel1year: '近一年',
  sessionHistoryNormalGroup: '普通聊天',
  sessionHistoryUnknownCharacter: '未命名角色',
}
const t = (key) => labels[key] ?? key
const atDaysAgo = (days) => {
  const date = new Date(now)
  date.setDate(date.getDate() - days)
  return date.getTime()
}
const sessions = [0, 1, 2, 3, 6, 7, 14, 15, 29, 30, 89, 90, 364, 365, 729, 730].map((days) => ({
  id: `d${days}`,
  title: `${days} 天前`,
  updatedAt: atDaysAgo(days),
}))

const groups = groupSessions(sessions, now, t)
assert.deepEqual(
  groups.map((group) => [group.key, group.sessions.length]),
  [
    ['sessionHistoryTimelineLabelToday', 1],
    ['sessionHistoryTimelineLabelYesterday', 1],
    ['sessionHistoryTimelineLabelDayBefore', 1],
    ['sessionHistoryTimelineLabel3days', 2],
    ['sessionHistoryTimelineLabel7days', 2],
    ['sessionHistoryTimelineLabel15days', 2],
    ['sessionHistoryTimelineLabel30days', 2],
    ['sessionHistoryTimelineLabel3months', 2],
    ['sessionHistoryTimelineLabel1year', 2],
    ['2024-11', 1],
  ]
)
assert.equal(groups.at(-1).label, '2024-11')
assert.equal(groups.at(-2).label, '近一年')
assert.equal(groups[6].label, '30天')
assert.equal(groups[6].key, 'sessionHistoryTimelineLabel30days')

// 同一桶的会话必须落在同一组，且顺序保持输入顺序。
const sameBucket = groupSessions(
/* ---- 02 验证场景 ---- */
  [
    { id: 'a', title: 'A', updatedAt: atDaysAgo(70) },
    { id: 'b', title: 'B', updatedAt: atDaysAgo(40) },
  ],
  now,
  t
)
assert.equal(sameBucket.length, 1)
assert.deepEqual(
  sameBucket[0].sessions.map((item) => item.id),
  ['a', 'b']
)

const cardNames = new Map([
  ['card-a', '林小满'],
  ['card-b', '沈砚'],
])
const nameFor = (id) => cardNames.get(id)

// 同时存在普通会话与两张卡：父时间组 + 普通聊天 + 两张卡，空角色组不会出现。
const mixed = groupSessionsByCharacter(
  [
    { id: 'normal', title: '普通', updatedAt: atDaysAgo(0) },
    { id: 'a1', title: 'A1', updatedAt: atDaysAgo(0), characterId: 'card-a' },
    { id: 'b1', title: 'B1', updatedAt: atDaysAgo(0), characterId: 'card-b' },
    { id: 'a2', title: 'A2', updatedAt: atDaysAgo(0), characterId: 'card-a' },
  ],
  now,
  t,
  nameFor
)
assert.deepEqual(
  mixed.map((section) => [section.kind, section.key, section.label, section.total]),
  [
    ['time', 'sessionHistoryTimelineLabelToday', '今天', 4],
    ['normal', 'sessionHistoryTimelineLabelToday::normal', '普通聊天', 1],
    ['character', 'sessionHistoryTimelineLabelToday::character:card-a', '林小满', 2],
    ['character', 'sessionHistoryTimelineLabelToday::character:card-b', '沈砚', 1],
  ]
)
assert.deepEqual(mixed[0].sessions, [])
assert.deepEqual(
  mixed[1].sessions.map((item) => item.id),
  ['normal']
)
assert.deepEqual(
  mixed[2].sessions.map((item) => item.id),
  ['a1', 'a2']
)
assert.equal(
  mixed.every((section) => section.total > 0),
  true
)

// 只有角色会话：父时间组下只生成该角色子组，不生成空的普通聊天组。
const onlyCharacter = groupSessionsByCharacter(
  [{ id: 'a1', title: 'A1', updatedAt: atDaysAgo(1), characterId: 'card-a' }],
  now,
  t,
  nameFor
)
assert.deepEqual(
  onlyCharacter.map((section) => [section.kind, section.label]),
  [
    ['time', '昨天'],
    ['character', '林小满'],
  ]
)

// 没有角色会话：保持原来的扁平时间组，不额外插普通聊天标题。
const onlyNormal = groupSessionsByCharacter(
/* ---- 03 断言与清理 ---- */
  [{ id: 'normal', title: '普通', updatedAt: atDaysAgo(2) }],
  now,
  t,
  nameFor
)
assert.equal(onlyNormal.length, 1)
assert.equal(onlyNormal[0].kind, 'time')
assert.deepEqual(
  onlyNormal[0].sessions.map((item) => item.id),
  ['normal']
)

// 同一张卡跨两个时间组：各自生成独立子组，key 不能互相覆盖。
const crossDay = groupSessionsByCharacter(
  [
    { id: 'today', title: '今天', updatedAt: atDaysAgo(0), characterId: 'card-a' },
    { id: 'yesterday', title: '昨天', updatedAt: atDaysAgo(1), characterId: 'card-a' },
  ],
  now,
  t,
  nameFor
)
assert.equal(new Set(crossDay.map((section) => section.key)).size, crossDay.length)
assert.equal(crossDay.filter((section) => section.kind === 'character').length, 2)

// 卡已被删除时仍按 id 分组，并显示可读的默认标题。
const missingCard = groupSessionsByCharacter(
  [{ id: 'x', title: 'X', updatedAt: atDaysAgo(0), characterId: 'card-missing' }],
  now,
  t,
  nameFor
)
assert.equal(missingCard[1].label, '未命名角色')

console.log('session groups regression: ok')
