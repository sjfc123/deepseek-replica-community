/* ============================================================================
 * 功能区：会话与角色核心 / sessionGroups 开始
 * 职责：sessionGroups 服务实现，负责会话状态、角色档案、角色卡、世界书、记忆、上下文或草稿操作中的该子能力。
 * 导出：groupSessions。
 * ========================================================================== */

import { translate } from '../../i18n/index.js'
import { monthKey } from '../../utils/format.js'
import type { SessionSummary } from './types.js'

const DAY = 86_400_000

const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0)

/** 分组：今天 / 昨天 / 前天 / 三天前 / 7 天前 / 15 天前 / 30 天前与近一个月 / 近三个月 / 近一年 / 按月 */
export const groupSessions = (sessions: SessionSummary[], now: number, t = translate) => {
  const groups: { key: string; label: string; sessions: SessionSummary[] }[] = []
  for (const session of sessions) {
    const diff = Math.floor((now - startOfDay(session.updatedAt)) / DAY)
    const key =
      diff <= 0
        ? 'sessionHistoryTimelineLabelToday'
        : diff === 1
          ? 'sessionHistoryTimelineLabelYesterday'
          : diff === 2
            ? 'sessionHistoryTimelineLabelDayBefore'
            : diff < 7
              ? 'sessionHistoryTimelineLabel3days'
              : diff < 15
                ? 'sessionHistoryTimelineLabel7days'
                : diff < 30
                  ? 'sessionHistoryTimelineLabel15days'
                  : diff < 90
                    ? 'sessionHistoryTimelineLabel30days'
                    : diff < 365
                      ? 'sessionHistoryTimelineLabel3months'
                      : diff < 730
                        ? 'sessionHistoryTimelineLabel1year'
                        : null
    const groupKey = key ?? monthKey(session.updatedAt) ?? ''
    const last = groups.at(-1)
    if (last?.key === groupKey) {
      last.sessions.push(session)
    } else {
      groups.push({ key: groupKey, label: key ? t(key) : groupKey, sessions: [session] })
    }
  }
  return groups
}

/* ============================================================================
 * 功能区：会话与角色核心 / sessionGroups 结束
 * ========================================================================== */
