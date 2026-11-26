/* ============================================================================
 * 功能区：本地服务 / dataRevision
 * 职责：记录本机数据的逻辑版本，供自动备份判断「备份后是否真的产生新数据」。
 * 分区：01 类型、契约与依赖；
 *    02 核心实现：markDataChanged、readBackupRevision、markBackupRevision
 * 关联：无内部依赖；
 *    被 scripts/test-data-management、services/chat/autoBackup、services/chat/store、services/settings 引用。
 * 导出：currentDataRevision、flushDataRevision、markDataChanged、readBackupRevision、markBackupRevision
 * 边界：只处理本机存储、设置、迁移与数据版本；不实现界面控件，不直接请求模型。
 * ========================================================================== */

/* ---- 01 类型、契约与依赖 ---- */
/** 当前数据版本；每次会话、记忆或设置真正落盘时递增。 */
const REVISION_KEY = 'replica:data-revision'
/** 上一次完整备份使用的数据版本；只有它变化才需要重新写盘。 */
const BACKUP_REVISION_KEY = 'replica:auto-backup-revision'

let cached: number | null = null
let pending: number | null = null
let flushTimer: ReturnType<typeof setTimeout> | undefined

const parseRevision = (value: string | null) => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

const readStoredRevision = () => {
  try {
    return parseRevision(localStorage.getItem(REVISION_KEY))
  } catch {
    return 0
  }
}

/** 同步拿到当前版本；内存里的最新值优先于尚未刷写的存储值。 */
export const currentDataRevision = (): number => {
  if (cached === null) {
    cached = readStoredRevision()
  }
  return cached
}

/** 合并短时间内的连续写入，避免流式回复每个分片都同步写一次 localStorage。 */
const scheduleFlush = () => {
  if (flushTimer !== undefined || typeof window === 'undefined') {
    return
  }
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    flushDataRevision()
  }, 300)
}

/* ---- 02 核心实现：markDataChanged、readBackupRevision、markBackupRevision ---- */
export const flushDataRevision = () => {
  if (pending === null) {
    return
  }
  const value = pending
  pending = null
  try {
    localStorage.setItem(REVISION_KEY, String(value))
  } catch {
    // 存储不可用时只失去跨启动的版本记忆，不影响本次会话内的判断。
  }
}

/** 标记数据已变化；同一个事件循环里的多次写入会合并成一次递增。 */
export const markDataChanged = () => {
  cached = currentDataRevision() + 1
  pending = cached
  scheduleFlush()
}

/** 上一次成功备份对应的数据版本；没有记录时返回 0，表示需要先备份一次。 */
export const readBackupRevision = (): number => {
  try {
    return parseRevision(localStorage.getItem(BACKUP_REVISION_KEY))
  } catch {
    return 0
  }
}

/** 备份成功且文件已发布后调用：当前版本成为新的基线。 */
export const markBackupRevision = (revision = currentDataRevision()) => {
  // 导出期间可能又产生了新数据，不能把内存里的当前版本回退到导出开始时的值。
  flushDataRevision()
  try {
    localStorage.setItem(BACKUP_REVISION_KEY, String(revision))
  } catch {
    // 基线写不进去时下次启动会多备份一次，不会漏掉新数据。
  }
}

/* ============================================================================
 * 功能区：本机数据 / dataRevision 结束
 * ========================================================================== */
