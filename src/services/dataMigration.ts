/* ============================================================================
 * 功能区：本地服务 / dataMigration · 本地数据迁移
 * 职责：本地数据迁移：修复旧键、隔离非法值并在启动前完成一次性校准。
 * 分区：01 类型、常量与模块依赖；02 计算与判定（checkJsonKeys、checkNumberKeys、checkEnumKeys…）；
 *    03 计算与判定（checkRoleplayLists、checkActiveCharacter、checkSystemPrompt…）；
 *    04 功能实现（migrateLocalData）
 * 关联：无内部依赖；被 components/settings/AndroidSettings、services/settings 引用。
 * 导出：DATA_VERSION、MigrationReport、readMigrationReport、migrateLocalData
 * 边界：只处理本机存储、设置、迁移与数据版本；不实现界面控件，不直接请求模型。
 * ========================================================================== */

/**
 * 本机数据校验与迁移。
 *
 * 覆盖安装后应用已更新，而 data 目录中的 localStorage 与 IndexedDB 仍保留旧版本写入的值。
 * 单个字段结构不合法即可导致读取阶段抛错，界面无法完成首屏渲染。
 * 本模块在设置状态建立之前执行一次：修复可处理项，不可处理项移入隔离副本，不整库清空。
 */

/* ---- 01 类型、常量与模块依赖 ---- */
/** 数据结构版本。字段含义变化时递增，旧值将触发一次校验。 */
export const DATA_VERSION = 3

const VERSION_KEY = 'replica:data-version'
const REPORT_KEY = 'replica:data-migration'
/** 隔离副本前缀：原样保留非法值供人工追溯，不参与正常读取 */
const QUARANTINE_PREFIX = 'replica:quarantine:'
/** 隔离副本条目上限，避免非法数据持续累积占用存储配额 */
const QUARANTINE_MAX = 24

export type MigrationReport = {
  from: number
  to: number
  at: number
  repaired: string[]
  quarantined: string[]
  removed: string[]
}

const safeRead = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const safeWrite = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

const safeRemove = (key: string) => {
  try {
    localStorage.removeItem(key)
  } catch {
    /* 删除失败时保留原值，下次校验会重新处理 */
  }
}

const parse = (raw: string | null): unknown => {
  if (raw === null || raw === '') {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** 将非法值写入隔离副本；同名旧副本先清除，仅保留最近一次 */
const quarantine = (key: string, raw: string, report: MigrationReport) => {
  safeWrite(`${QUARANTINE_PREFIX}${key}`, raw)
  report.quarantined.push(key)
  safeRemove(key)
  trimQuarantine()
}

const trimQuarantine = () => {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(QUARANTINE_PREFIX)) {
        keys.push(key)
      }
    }
    if (keys.length <= QUARANTINE_MAX) {
      return
    }
    keys.sort()
    keys.slice(0, keys.length - QUARANTINE_MAX).forEach(safeRemove)
  } catch {
    /* 遍历失败不影响主流程 */
  }
}

/** JSON 型键：解析失败或类型不符则隔离，不进入业务逻辑 */
const JSON_KEYS: Array<{ key: string; kind: 'array' | 'object' }> = [
  { key: 'replica:character-cards', kind: 'array' },
  { key: 'replica:worldbook', kind: 'array' },
  { key: 'replica:scene', kind: 'object' },
  { key: 'replica:pinned-sessions', kind: 'array' },
  { key: 'replica:prompt-session-ids', kind: 'array' },
  { key: 'replica:account-profile', kind: 'object' },
  { key: 'replica:chat-config', kind: 'object' },
  { key: 'chat-demo:location', kind: 'object' },
]

/* ---- 02 计算与判定（checkJsonKeys、checkNumberKeys、checkEnumKeys…） ---- */
/** 数值型键：越界或非数字则删除，业务逻辑回落至默认值 */
const NUMBER_KEYS: Array<{ key: string; min: number; max: number }> = [
  { key: 'replica:character-avatar-size', min: 20, max: 36 },
  { key: 'replica:user-avatar-size', min: 20, max: 36 },
  { key: 'replica:avatar-size', min: 20, max: 36 },
  { key: 'replica:token-limit', min: 0, max: 100_000_000 },
  { key: 'replica:memory-limit', min: 10, max: 9999 },
  { key: 'replica:auto-backup-hours', min: 1, max: 168 },
  { key: 'replica:temperature', min: 0, max: 2 },
  { key: 'replica:top-p', min: 0, max: 1 },
  { key: 'replica:max-tokens', min: 1, max: 1_000_000 },
]

/** 枚举型键：取值不在白名单内则删除 */
const ENUM_KEYS: Array<{ key: string; values: string[] }> = [
  { key: 'replica:chat-layout', values: ['card', 'wechat', 'blue'] },
  { key: 'replica:avatar-shape', values: ['circle', 'rounded'] },
  { key: 'replica:memory-mode', values: ['off', 'turn', 'refine'] },
  { key: 'chat-demo:locale', values: ['zh-CN', 'en-US'] },
  { key: 'chat-demo:theme-preference', values: ['light', 'dark', 'system'] },
  { key: 'chat-demo:tts-voice', values: ['stella', 'tide'] },
  { key: 'replica:thinking-effort', values: ['low', 'high', 'max'] },
]

/** 头像仅接受本地压缩后的 data URL；外链与不完整 base64 一律丢弃 */
const AVATAR_KEYS = ['replica:character-avatar']
const AVATAR_PATTERN = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/

/** 旧键 → 新键：仅在目标键无值时迁移一次，迁移后删除旧键 */
const RENAMES: Array<{ from: string; to: string }> = [
  { from: 'replica:avatar-size', to: 'replica:character-avatar-size' },
  { from: 'replica:avatar-size', to: 'replica:user-avatar-size' },
]

const checkJsonKeys = (report: MigrationReport) => {
  JSON_KEYS.forEach(({ key, kind }) => {
    const raw = safeRead(key)
    if (raw === null || raw === '') {
      return
    }
    const value = parse(raw)
    const ok = kind === 'array' ? Array.isArray(value) : isRecord(value)
    if (!ok) {
      quarantine(key, raw, report)
    }
  })
}

const checkNumberKeys = (report: MigrationReport) => {
  NUMBER_KEYS.forEach(({ key, min, max }) => {
    const raw = safeRead(key)
    if (raw === null || raw === '') {
      return
    }
    const value = Number(raw)
    if (!Number.isFinite(value) || value < min || value > max) {
      report.removed.push(key)
      safeRemove(key)
    }
  })
}

const checkEnumKeys = (report: MigrationReport) => {
  ENUM_KEYS.forEach(({ key, values }) => {
    const raw = safeRead(key)
    if (raw === null || raw === '') {
      return
    }
    if (!values.includes(raw)) {
      report.removed.push(key)
      safeRemove(key)
    }
  })
}

const checkAvatars = (report: MigrationReport) => {
  AVATAR_KEYS.forEach((key) => {
    const raw = safeRead(key)
    if (!raw) {
      return
    }
    if (!AVATAR_PATTERN.test(raw)) {
      report.removed.push(key)
      safeRemove(key)
    }
  })
  /* 账号头像存于 JSON 字段内，单独校验 */
  const raw = safeRead('replica:account-profile')
  const profile = parse(raw)
  if (isRecord(profile) && typeof profile.avatar === 'string' && profile.avatar) {
    if (!AVATAR_PATTERN.test(profile.avatar)) {
      const next = { ...profile, avatar: null }
      if (safeWrite('replica:account-profile', JSON.stringify(next))) {
        report.repaired.push('replica:account-profile.avatar')
      }
    }
  }
}

const applyRenames = (report: MigrationReport) => {
  RENAMES.forEach(({ from, to }) => {
    const legacy = safeRead(from)
    if (legacy === null || safeRead(to) !== null) {
      return
    }
    if (safeWrite(to, legacy)) {
      report.repaired.push(`${from} → ${to}`)
    }
  })
}

/* ---- 03 计算与判定（checkRoleplayLists、checkActiveCharacter、checkSystemPrompt…） ---- */
/** 角色卡与世界书逐条校验：单条非法仅剔除该条，不影响整张列表 */
const checkRoleplayLists = (report: MigrationReport) => {
  const lists: Array<{ key: string; required: string[] }> = [
    { key: 'replica:character-cards', required: ['name'] },
    { key: 'replica:worldbook', required: ['title', 'content'] },
  ]
  lists.forEach(({ key, required }) => {
    const raw = safeRead(key)
    const value = parse(raw)
    if (!Array.isArray(value)) {
      return
    }
    const kept = value.filter((item) => {
      if (!isRecord(item)) {
        return false
      }
      return required.every((field) => typeof item[field] === 'string' && item[field])
    })
    if (kept.length !== value.length && raw !== null) {
      quarantine(`${key}.bad-items`, raw, report)
      if (safeWrite(key, JSON.stringify(kept))) {
        report.repaired.push(key)
      }
    }
  })
}

/** 启用中的角色卡 id 必须存在，否则清除，避免聊天中显示空角色 */
const checkActiveCharacter = (report: MigrationReport) => {
  const activeId = safeRead('replica:active-character')
  if (!activeId) {
    return
  }
  const cards = parse(safeRead('replica:character-cards'))
  const exists =
    Array.isArray(cards) && cards.some((card) => isRecord(card) && card.id === activeId)
  if (!exists) {
    report.removed.push('replica:active-character')
    safeRemove('replica:active-character')
  }
}

/** 空提示词标记与提示词正文必须同步，否则清空后会被回填为默认提示词 */
const checkSystemPrompt = (report: MigrationReport) => {
  const cleared = safeRead('replica:system-prompt-empty')
  const prompt = safeRead('replica:system-prompt')
  if (cleared === '1' && prompt) {
    report.repaired.push('replica:system-prompt')
    safeRemove('replica:system-prompt')
  }
}

export const readMigrationReport = (): MigrationReport | null => {
  const value = parse(safeRead(REPORT_KEY))
  return isRecord(value) && Array.isArray(value.quarantined)
    ? (value as unknown as MigrationReport)
    : null
}

/* ---- 04 功能实现（migrateLocalData） ---- */
/**
 * 执行校验。同一数据版本仅执行一次；覆盖安装后版本号变化会再次执行。
 * 任一步骤失败均不抛出：允许漏修单项，但不得阻塞启动流程。
 */
export const migrateLocalData = (): MigrationReport | null => {
  const savedVersion = Number(safeRead(VERSION_KEY) ?? 0)
  const from = Number.isFinite(savedVersion) ? savedVersion : 0
  if (from === DATA_VERSION) {
    return null
  }
  const report: MigrationReport = {
    from,
    to: DATA_VERSION,
    at: Date.now(),
    repaired: [],
    quarantined: [],
    removed: [],
  }
  const steps = [
    checkJsonKeys,
    checkNumberKeys,
    checkEnumKeys,
    checkAvatars,
    applyRenames,
    checkRoleplayLists,
    checkActiveCharacter,
    checkSystemPrompt,
  ]
  steps.forEach((step) => {
    try {
      step(report)
    } catch {
      /* 单项校验失败则排除该项，继续处理后续项 */
    }
  })
  safeWrite(VERSION_KEY, String(DATA_VERSION))
  safeWrite(REPORT_KEY, JSON.stringify(report))
  return report
}

/* ============================================================================
 * 功能区：本地服务 / dataMigration 结束
 * ========================================================================== */
