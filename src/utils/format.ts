/* ============================================================================
 * 功能区：公共工具 / format · 格式化工具
 * 职责：格式化工具：日期、月份键与本地化数字展示。
 * 分区：01 类型、契约与依赖
 * 关联：无内部依赖；
 *    被 components/search/AndroidSearchPanel、components/search/SourceCard、services/chat/latestReminder、services/chat/memoryArchive 等 5 个模块 引用。
 * 导出：formatDate、monthKey
 * 边界：只提供纯函数与浏览器能力封装；不读取应用状态，不产生网络请求。
 * ========================================================================== */

/* ---- 01 类型、契约与依赖 ---- */
const pad = (value: number, length = 2): string => String(value).padStart(length, '0')

const toDate = (value: string | number | Date): Date | null => {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export const formatDate = (
  value: string | number | Date,
  separator: '/' | '-' = '-'
): string | null => {
  const date = toDate(value)
  if (!date) {
    return null
  }
  return [pad(date.getFullYear(), 4), pad(date.getMonth() + 1), pad(date.getDate())].join(separator)
}

export const monthKey = (value: string | number | Date): string | null => {
  const date = toDate(value)
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}` : null
}

/* ============================================================================
 * 功能区：通用工具 / format 结束
 * ========================================================================== */
