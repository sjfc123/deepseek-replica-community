/* ============================================================================
 * 功能区：会话与角色核心 / latestReminder · 当前轮提醒
 * 职责：当前轮提醒：日期、地点与最新用户要求拼成请求尾部提醒，不进入静态 system。
 * 分区：01 类型、契约与依赖
 * 关联：依赖 i18n/index、services/location、services/settings、utils/format；
 *    被 services/chat/store 引用。
 * 导出：createLatestReminder
 * 边界：只处理聊天领域的数据、状态转换与提示词装配；不直接渲染视图，不发起职责外的网络请求。
 * ========================================================================== */

import { getRegionName, provinces, type UserLocation } from '../location.js'
import type { Locale } from '../settings.js'
import { formatDate } from '../../utils/format.js'
import { translate } from '../../i18n/index.js'

/* ---- 01 类型、契约与依赖 ---- */
const locationName = (location: UserLocation | null, locale: Locale): string => {
  if (!location) {
    return ''
  }
  if (location.region === 'CN' && locale === 'zh-CN') {
    const province = provinces.find((item) => item.code === location.province)
    const city = province?.cities.find((item) => item.code === location.city)
    return city?.name ?? province?.name ?? getRegionName('CN', locale)
  }
  return getRegionName(location.region, locale)
}

/** 模型约定的五项信息；日期与星期使用浏览器本地时区，避免 UTC 日期跨日。 */
export const createLatestReminder = (
  { locale, location }: { locale: Locale; location: UserLocation | null },
  now = new Date()
): string => {
  return [
    formatDate(now),
    new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(now),
    locationName(location, locale),
    'Web',
    translate('latestReminderLanguage'),
  ].join(',')
}

/* ============================================================================
 * 功能区：会话与角色核心 / latestReminder 结束
 * ========================================================================== */
