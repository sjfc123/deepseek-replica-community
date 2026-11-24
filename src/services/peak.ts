/* ============================================================================
 * 功能区：本地服务 / peak 开始
 * 职责：峰谷时段：按本地时钟判断高峰/空闲并生成提示。
 * 导出：PeakHint、getPeakHint。
 * ========================================================================== */

/**
 * DeepSeek API 峰谷时段。
 *
 * 规则来自官方定价页：北京时间周一至周五 09:00-12:00、14:00-18:00 为高峰，
 * 其余时间、周末和中国法定节假日全天为空闲；空闲价是高峰价的一半。
 * 计费以服务端收到请求的时间为准，因此仅生成本地时钟提示，不参与请求计时。
 *
 * 法定节假日使用国务院公布的 2026 年安排；跨年后未更新的日期只能按周末判断。
 */

type HolidayRange = {
  name: string
  /** [起始日, 结束日]，含首尾，格式 YYYY-MM-DD */
  from: string
  to: string
}

/** 国务院办公厅关于 2026 年部分节假日安排的通知（国办发明电〔2025〕7 号） */
const HOLIDAY_RANGES_2026: HolidayRange[] = [
  { name: '元旦', from: '2026-01-01', to: '2026-01-03' },
  { name: '春节', from: '2026-02-15', to: '2026-02-23' },
  { name: '清明节', from: '2026-04-04', to: '2026-04-06' },
  { name: '劳动节', from: '2026-05-01', to: '2026-05-05' },
  { name: '端午节', from: '2026-06-19', to: '2026-06-21' },
  { name: '中秋节', from: '2026-09-25', to: '2026-09-27' },
  { name: '国庆节', from: '2026-10-01', to: '2026-10-07' },
]

/** 官方规则按周一至周五判断，调休上班的周六仍算周末空档，不参与高峰 */
const PEAK_WINDOWS = [
  { start: 9 * 60, end: 12 * 60 },
  { start: 14 * 60, end: 18 * 60 },
]

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

export type PeakHint = {
  /** 当前是否高峰 */
  peak: boolean
  /** 当前阶段文案，例如「高峰时段」 */
  phaseLabel: string
  /** 当前北京时间，例如「21:15」 */
  nowLabel: string
  /** 距下一次切换的文案，例如「距空闲 12:00 还剩 1 小时 40 分」 */
  nextLabel: string
  /** 当前日期属性与固定时段说明 */
  rangeLabel: string
}

const pad = (value: number) => String(value).padStart(2, '0')

const dateKey = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`

const beijingParts = (now: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const hour = read('hour') % 24
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
  }
}

/** 用 UTC 日历做纯日期加减，避免设备时区影响北京日期 */
const shiftDay = (year: number, month: number, day: number, delta: number) => {
  const value = new Date(Date.UTC(year, month - 1, day + delta))
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  }
}

const weekdayOf = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day)).getUTCDay()

/** 北京某天某时刻对应的绝对时间 */
const beijingTime = (year: number, month: number, day: number, minuteOfDay: number) =>
  Date.UTC(year, month - 1, day, 0, minuteOfDay) - BEIJING_OFFSET_MS

const holidayOf = (year: number, month: number, day: number) => {
  const key = dateKey(year, month, day)
  if (year === 2026) {
    const range = HOLIDAY_RANGES_2026.find((item) => key >= item.from && key <= item.to)
    if (range) {
      return range.name
    }
  }
  // 2027 年安排尚未公布，先保留固定的元旦，其余等新表随版本更新。
  if (month === 1 && day === 1) {
    return '元旦'
  }
  return undefined
}

const isWorkday = (year: number, month: number, day: number) => {
  if (holidayOf(year, month, day)) {
    return false
  }
  const weekday = weekdayOf(year, month, day)
  return weekday !== 0 && weekday !== 6
}

const isPeakMinute = (workday: boolean, minuteOfDay: number) =>
  workday && PEAK_WINDOWS.some((window) => minuteOfDay >= window.start && minuteOfDay < window.end)

const weekdayLabel = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const dayLabel = (
  base: { year: number; month: number; day: number },
  target: { year: number; month: number; day: number }
) => {
  const baseUtc = Date.UTC(base.year, base.month - 1, base.day)
  const targetUtc = Date.UTC(target.year, target.month - 1, target.day)
  const diff = Math.round((targetUtc - baseUtc) / (24 * 60 * MINUTE_MS))
  if (diff === 0) {
    return '今天'
  }
  if (diff === 1) {
    return '明天'
  }
  if (diff > 1 && diff < 7) {
    return weekdayLabel[weekdayOf(target.year, target.month, target.day)]
  }
  return `${target.month}月${target.day}日`
}

const durationLabel = (minutes: number) => {
  if (minutes < 60) {
    return `${Math.max(1, minutes)} 分钟`
  }
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`
  }
  const days = Math.floor(minutes / (24 * 60))
  const hours = Math.round((minutes % (24 * 60)) / 60)
  return hours === 0 ? `${days} 天` : `${days} 天 ${hours} 小时`
}

/** 找下一个工作日的 09:00；从次日开始，最多查 15 天 */
const nextWorkdayPeak = (year: number, month: number, day: number, includeToday: boolean) => {
  for (let offset = includeToday ? 0 : 1; offset <= 15; offset += 1) {
    const target = shiftDay(year, month, day, offset)
    if (isWorkday(target.year, target.month, target.day)) {
      return { ...target, minuteOfDay: PEAK_WINDOWS[0].start }
    }
  }
  return undefined
}

export const getPeakHint = (now = new Date()): PeakHint => {
  const today = beijingParts(now)
  const minuteOfDay = today.hour * 60 + today.minute
  const workday = isWorkday(today.year, today.month, today.day)
  const peak = isPeakMinute(workday, minuteOfDay)
  const holiday = holidayOf(today.year, today.month, today.day)
  const weekday = weekdayOf(today.year, today.month, today.day)
  const weekend = weekday === 0 || weekday === 6

  let next: { year: number; month: number; day: number; minuteOfDay: number } | undefined
  let nextPeak = false

  if (peak) {
    const end = PEAK_WINDOWS.find(
      (window) => minuteOfDay >= window.start && minuteOfDay < window.end
    )?.end
    next = { ...today, minuteOfDay: end ?? 18 * 60 }
  } else if (workday && minuteOfDay < PEAK_WINDOWS[0].start) {
    next = { ...today, minuteOfDay: PEAK_WINDOWS[0].start }
    nextPeak = true
  } else if (workday && minuteOfDay >= PEAK_WINDOWS[0].end && minuteOfDay < PEAK_WINDOWS[1].start) {
    next = { ...today, minuteOfDay: PEAK_WINDOWS[1].start }
    nextPeak = true
  } else {
    next = nextWorkdayPeak(today.year, today.month, today.day, false)
    nextPeak = true
  }

  let nextLabel = ''
  if (next) {
    const targetTime = beijingTime(next.year, next.month, next.day, next.minuteOfDay)
    const remaining = Math.max(1, Math.ceil((targetTime - now.getTime()) / MINUTE_MS))
    const clock = `${pad(Math.floor(next.minuteOfDay / 60))}:${pad(next.minuteOfDay % 60)}`
    const day = dayLabel(today, next)
    nextLabel = `距${nextPeak ? '高峰' : '空闲'} ${day} ${clock} 还剩 ${durationLabel(remaining)}`
  }

  const rangeLabel = holiday
    ? `${holiday}全天空闲 · 工作日高峰 09:00–12:00 / 14:00–18:00`
    : weekend
      ? '周末全天空闲 · 工作日高峰 09:00–12:00 / 14:00–18:00'
      : '工作日高峰 09:00–12:00 / 14:00–18:00'

  return {
    peak,
    phaseLabel: peak ? '高峰时段' : '空闲时段',
    nowLabel: `当前 ${pad(today.hour)}:${pad(today.minute)}`,
    nextLabel,
    rangeLabel,
  }
}

/* ============================================================================
 * 功能区：本地服务 / peak 结束
 * ========================================================================== */
