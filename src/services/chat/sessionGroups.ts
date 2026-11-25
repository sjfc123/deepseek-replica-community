/* ============================================================================
 * 功能区：会话与角色核心 / sessionGroups 开始
 * 职责：sessionGroups 服务实现，负责会话状态、角色档案、角色卡、世界书、记忆、上下文或草稿操作中的该子能力。
 * 导出：groupSessions、groupSessionsByCharacter。
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

/** 侧栏的一段可折叠区域：时间组在存在角色会话时拆成“普通聊天 + 各角色卡”子组。 */
export type SessionSection = {
  key: string
  label: string
  sessions: SessionSummary[]
  /** 标题旁展示的总数；父时间组用整组数量，子组用自己的数量 */
  total: number
  kind: 'time' | 'normal' | 'character'
  /** 子组所属的时间组 key；父时间组不填 */
  parentKey?: string
  characterId?: string
}

/**
 * 时间分组内部再按角色卡分组。
 * 只有该时间组里实际存在角色会话时才拆分；没有角色会话的时间组保持原来的扁平结构。
 * 普通会话单独成组，角色会话按 characterId 各自成组，空组不会生成。
 */
export const groupSessionsByCharacter = (
  sessions: SessionSummary[],
  now: number,
  t = translate,
  characterNameFor: (id: string) => string | undefined = () => undefined
): SessionSection[] => {
  const timeGroups = groupSessions(sessions, now, t)
  const sections: SessionSection[] = []
  for (const timeGroup of timeGroups) {
    const normal: SessionSummary[] = []
    const characters = new Map<string, SessionSummary[]>()
    for (const session of timeGroup.sessions) {
      if (session.characterId) {
        const bucket = characters.get(session.characterId)
        if (bucket) {
          bucket.push(session)
        } else {
          characters.set(session.characterId, [session])
        }
      } else {
        normal.push(session)
      }
    }
    if (characters.size === 0) {
      sections.push({
        ...timeGroup,
        total: timeGroup.sessions.length,
        kind: 'time',
      })
      continue
    }
    // 父时间组只负责标题与整组折叠；真正的会话行放到普通组或各角色子组。
    sections.push({
      key: timeGroup.key,
      label: timeGroup.label,
      sessions: [],
      total: timeGroup.sessions.length,
      kind: 'time',
    })
    if (normal.length > 0) {
      sections.push({
        key: `${timeGroup.key}::normal`,
        label: t('sessionHistoryNormalGroup'),
        sessions: normal,
        total: normal.length,
        kind: 'normal',
        parentKey: timeGroup.key,
      })
    }
    for (const [characterId, characterSessions] of characters) {
      sections.push({
        key: `${timeGroup.key}::character:${characterId}`,
        label: characterNameFor(characterId) ?? t('sessionHistoryUnknownCharacter'),
        sessions: characterSessions,
        total: characterSessions.length,
        kind: 'character',
        parentKey: timeGroup.key,
        characterId,
      })
    }
  }
  return sections
}

/* ============================================================================
 * 功能区：会话与角色核心 / sessionGroups 结束
 * ========================================================================== */
