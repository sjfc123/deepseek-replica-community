/* ============================================================================
 * 功能区：历史归档 / importOffMainThread · 历史导入调度
 * 职责：历史导入调度：Worker 与主线程两条执行路径。
 * 分区：01 类型、契约与依赖；02 核心实现：ImportResponse、runInWorker、importOffMainThread；
 *    03 对外入口与收尾
 * 关联：依赖 i18n/index、services/chat/history/errors、services/chat/history/importArchive；
 *    被 services/chat/backup、services/chat/history/import.worker 引用。
 * 导出：ImportRequest、ImportResponse、importOffMainThread
 * 边界：只处理导入导出格式、ZIP、合并与还原；不承担在线会话状态，也不负责自动备份调度。
 * ========================================================================== */

import type { TranslationKey } from '../../../i18n/index.js'
import { BackupError } from './errors.js'
import type { ArchiveProgress, ImportArchiveResult, ImportMode } from './importArchive.js'

/* ---- 01 类型、契约与依赖 ---- */
export type { ImportArchiveResult, ImportMode } from './importArchive.js'

export type ImportRequest = { file: File; importId: string; mode: ImportMode }
export type ImportResponse =
  | { type: 'ready'; supported: boolean }
  | { type: 'unavailable' }
  | { type: 'progress'; value: ArchiveProgress }
  | { type: 'done'; result: ImportArchiveResult }
  | { type: 'error'; key?: TranslationKey; message: string }

/* ---- 02 核心实现：ImportResponse、runInWorker、importOffMainThread ---- */
const runInWorker = (request: ImportRequest, onProgress: (progress: ArchiveProgress) => void) =>
  new Promise<ImportArchiveResult | undefined>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(
        new URL(/* webpackChunkName: "history-import" */ './import.worker.ts', import.meta.url)
      )
    } catch {
      resolve(undefined)
      return
    }
    let started = false
    let closed = false
    const close = () => {
      closed = true
      clearTimeout(timer)
      worker.terminate()
    }
    const onFailure = () => {
      if (closed) {
        return
      }
      close()
      if (started) {
        reject(new Error('History import worker stopped'))
      } else {
        resolve(undefined)
      }
    }
    const timer = setTimeout(onFailure, 4000)
    worker.addEventListener('error', onFailure)
    worker.addEventListener('messageerror', onFailure)
    worker.addEventListener('message', ({ data }: MessageEvent<ImportResponse>) => {
      if (closed) {
        return
      }
      switch (data.type) {
        case 'ready':
          if (!data.supported) {
            onFailure()
            return
          }
          clearTimeout(timer)
          try {
            worker.postMessage(request)
            started = true
          } catch {
            onFailure()
          }
          return
        case 'progress':
          onProgress(data.value)
          return
        case 'unavailable':
          close()
          resolve(undefined)
          return
        case 'done':
          close()
          resolve(data.result)
          return
        case 'error':
          close()
          reject(data.key ? new BackupError(data.key) : new Error(data.message))
      }
    })
  })

/* ---- 03 对外入口与收尾 ---- */
export const importOffMainThread = async (
  file: File,
  importId: string,
  onProgress: (progress: ArchiveProgress) => void,
  mode: ImportMode = 'replace'
): Promise<ImportArchiveResult> => {
  const result = await runInWorker({ file, importId, mode }, onProgress)
  if (result) {
    return result
  }
  // 旧版本 WebView 可能不支持加载本地 Worker 或跨线程传递系统文件选择器的 File。
  const { importArchive } = await import('./importArchive.js')
  return importArchive(file, importId, onProgress, mode)
}

/* ============================================================================
 * 功能区：历史归档 / importOffMainThread 结束
 * ========================================================================== */
