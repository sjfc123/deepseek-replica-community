/**
 * 会话日期分组回归：
 * 1. 今天、昨天、前天单独成组；
 * 2. 三天前、7 天前、15 天前、30 天前与近一个月、近三个月、近一年按边界落组；
 * 3. 超过两年的会话回落到月份分组；
 * 4. 分组按时间倒序连续排列，不合并跨桶会话。
 */
import assert from 'node:assert/strict'

// i18n 入口在模块加载时会读取 WebView 桥；回归只测纯分组，补一个空窗口即可。
globalThis.window = {}
const { groupSessions } = await import('../src/services/chat/sessionGroups.ts')

const now = new Date(2026, 10, 25, 12, 0, 0, 0).getTime()
const labels = {
  sessionHistoryTimelineLabelToday: '今天',
  sessionHistoryTimelineLabelYesterday: '昨天',
  sessionHistoryTimelineLabelDayBefore: '前天',
  sessionHistoryTimelineLabel3days: '三天前',
  sessionHistoryTimelineLabel7days: '7 天前',
  sessionHistoryTimelineLabel15days: '15 天前',
  sessionHistoryTimelineLabel30days: '30 天前 · 近一个月',
  sessionHistoryTimelineLabel3months: '近三个月',
  sessionHistoryTimelineLabel1year: '近一年',
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

// 同一桶的会话必须落在同一组，且顺序保持输入顺序。
const sameBucket = groupSessions(
  [
    { id: 'a', title: 'A', updatedAt: atDaysAgo(70) },
    { id: 'b', title: 'B', updatedAt: atDaysAgo(40) },
  ],
  now,
  t
)
assert.equal(sameBucket.length, 1)
assert.deepEqual(sameBucket[0].sessions.map((item) => item.id), ['a', 'b'])

console.log('session groups regression: ok')
