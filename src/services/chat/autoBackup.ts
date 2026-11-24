import { readBlobBuffer } from '../../utils/blob.js'
import { android, writeAndroidBlob } from '../../app/android.js'
import { useSettings } from '../settings.js'
import { exportHistory } from './backup.js'

/** 自动备份落在公共下载目录，卸载重装后仍能找到；这里只记录本机上次备份时间 */
const LAST_KEY = 'replica:auto-backup-at'
/** 上一次成功备份的指纹，设置页用来展示「已校验」 */
const META_KEY = 'replica:auto-backup-meta'
const KEEP = 5

export type AutoBackupStatus = { name: string; date: number; size: number }

export type AutoBackupMeta = AutoBackupStatus & {
  sessionCount: number
  /** SHA-256 前 16 位，导出后立刻计算，用于确认文件与这次导出一致 */
  checksum: string
  verifiedAt: number
}

const checksumOf = async (blob: Blob) => {
  try {
    if (!crypto.subtle) {
      return ''
    }
    const digest = await crypto.subtle.digest('SHA-256', await readBlobBuffer(blob))
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16)
  } catch {
    return ''
  }
}

export const readAutoBackupMeta = (): AutoBackupMeta | null => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(META_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const value = parsed as Partial<AutoBackupMeta>
    return typeof value.name === 'string' && typeof value.checksum === 'string'
      ? {
          name: value.name,
          date: value.date ?? 0,
          size: value.size ?? 0,
          sessionCount: value.sessionCount ?? 0,
          checksum: value.checksum,
          verifiedAt: value.verifiedAt ?? 0,
        }
      : null
  } catch {
    return null
  }
}

/** 失败位置：bridge 旧包没有备份接口；begin 建不了临时文件；write 写入中断；verify 校验失败；finish 发布未确认 */
export type AutoBackupFailure = 'bridge' | 'begin' | 'write' | 'verify' | 'finish'

/** ok 成功；empty 本机确实没有对话；failed 写了但系统没确认或写入失败 */
export type AutoBackupResult = {
  outcome: 'ok' | 'empty' | 'failed'
  status: AutoBackupStatus | null
  sessionCount: number
  /** 仅 failed 时给出失败位置，界面据此给不同提示 */
  failure?: AutoBackupFailure
  /** 原生层返回的错误说明，便于定位设备侧原因 */
  detail?: string
}

const device = () => (android?.beginAutoBackup ? android : null)

/** 询问原生层上一次备份失败的原因；旧包没有该方法时返回空串 */
const readDeviceError = (target: ReturnType<typeof device>) => {
  try {
    return target?.autoBackupError?.() ?? ''
  } catch {
    return ''
  }
}

/** 读取最近一次自动备份（原生查询 MediaStore），无备份或旧包不支持时返回 null */
export const readAutoBackupStatus = (): AutoBackupStatus | null => {
  const target = device()
  if (!target?.autoBackupStatus) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(target.autoBackupStatus())
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const value = parsed as Partial<AutoBackupStatus>
    if (typeof value.name !== 'string' || typeof value.date !== 'number') {
      return null
    }
    return {
      name: value.name,
      date: value.date,
      size: typeof value.size === 'number' ? value.size : 0,
    }
  } catch {
    return null
  }
}

/**
 * 立刻导出一次到下载目录。导出会遍历全部会话，和手动导出共用同一个串行队列，
 * 因此不会与用户正在进行的导入/导出互相打断。
 */
export const runAutoBackup = async (
  options: { notify?: boolean } = {}
): Promise<AutoBackupResult> => {
  const target = device()
  const begin = target?.beginAutoBackup
  const write = target?.writeAutoBackup
  const finish = target?.finishAutoBackup
  if (!target || !begin || !write || !finish) {
    return { outcome: 'failed', status: null, sessionCount: 0, failure: 'bridge' }
  }
  // 列表可能还没载入：先等一次初始化，否则导出会拿到空的会话列表并误报「没有对话」。
  try {
    const { initChat } = await import('./store.js')
    await initChat()
  } catch {
    // 初始化失败时继续导出，由导出结果的实际会话数决定是否为空。
  }
  // 不以内存中的会话摘要数组判定是否存在对话：列表可能尚未加载或读取失败。
  // 改由导出结果的实际会话数判定，避免将已有记录误报为空。
  const { name, blob, count } = await exportHistory()
  if (count === 0) {
    return { outcome: 'empty', status: readAutoBackupStatus(), sessionCount: 0 }
  }
  const checksum = await checksumOf(blob)
  if (!begin.call(target, name, blob.size)) {
    const result: AutoBackupResult = {
      outcome: 'failed',
      status: readAutoBackupStatus(),
      sessionCount: count,
      failure: 'begin',
      detail: readDeviceError(target),
    }
    if (options.notify) {
      window.dispatchEvent(new CustomEvent('replica:auto-backup-failed', { detail: result }))
    }
    return result
  }
  let writeFailed = false
  try {
    await writeAndroidBlob(blob, (base64) => {
      if (!write.call(target, base64)) {
        writeFailed = true
        return false
      }
      return true
    })
  } catch {
    writeFailed = true
  }
  // 写入中断时仍要收尾：原生层会删除临时文件，绝不会把半截文件发布到下载目录。
  const closed = finish.call(target)
  if (writeFailed || !closed) {
    const detail = readDeviceError(target)
    const result: AutoBackupResult = {
      outcome: 'failed',
      status: readAutoBackupStatus(),
      sessionCount: count,
      failure: writeFailed ? 'write' : detail.includes('校验') ? 'verify' : 'finish',
      detail,
    }
    if (options.notify) {
      window.dispatchEvent(new CustomEvent('replica:auto-backup-failed', { detail: result }))
    }
    return result
  }
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()))
  } catch {
    // 存储不可用时仅失去节流时间戳。
  }
  target.pruneAutoBackups?.(KEEP)
  try {
    localStorage.setItem(
      META_KEY,
      JSON.stringify({
        name,
        date: Date.now(),
        size: blob.size,
        sessionCount: count,
        checksum,
        verifiedAt: Date.now(),
      } satisfies AutoBackupMeta)
    )
  } catch {
    // 元信息写不进去时只是少一行校验展示，不影响备份文件
  }
  const result: AutoBackupResult = {
    outcome: 'ok',
    status: readAutoBackupStatus(),
    sessionCount: count,
  }
  if (options.notify) {
    window.dispatchEvent(new CustomEvent('replica:auto-backup-success', { detail: result }))
  }
  return result
}

/** 开关开启且距上次备份超过设定间隔时执行；由启动、回到前台与定时器触发 */
export const maybeAutoBackup = () => {
  if (!useSettings.getState().autoBackup) {
    return
  }
  const target = device()
  if (!target) {
    return
  }
  let last = 0
  try {
    last = Number(localStorage.getItem(LAST_KEY) ?? 0)
  } catch {
    last = 0
  }
  const intervalMinutes = Math.max(1, useSettings.getState().autoBackupMinutes)
  if (Number.isFinite(last) && Date.now() - last < intervalMinutes * 60 * 1000) {
    return
  }
  // 启动阶段先让首屏与历史列表完成渲染，再在空闲时写盘。
  const start = () => {
    void runAutoBackup({ notify: true }).catch(() => {
      window.dispatchEvent(new CustomEvent('replica:auto-backup-failed'))
    })
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(start, { timeout: 5_000 })
  } else {
    setTimeout(start, 15_000)
  }
}

/**
 * 自动备份调度：启动时先检查一次，之后每 10 分钟检查、回到前台再检查。
 * 真正是否写盘仍由 maybeAutoBackup 按设置间隔判断，不会重复备份。
 */
export const startAutoBackupScheduler = () => {
  const run = () => {
    maybeAutoBackup()
  }
  run()
  const timer = window.setInterval(run, 5 * 60 * 1000)
  // 原生壳在 onPause 里回调这个函数：退到后台前若已到期就先写一次，
  // 页面随后被系统冻结也不会丢这一轮数据。
  const lifecycle = window as Window & { __replicaLifecyclePause?: () => void }
  lifecycle.__replicaLifecyclePause = run
  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      run()
    }
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    delete lifecycle.__replicaLifecyclePause
  }
}
