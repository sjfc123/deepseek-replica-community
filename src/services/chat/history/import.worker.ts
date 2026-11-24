/* ============================================================================
 * 功能区：历史归档 / import.worker 开始
 * 职责：import.worker 服务实现，负责历史归档的 ZIP 读写、结构校验、会话转换与导入导出中的该子能力。
 * 导出：无对外导出，仅供同目录模块使用。
 * ========================================================================== */

import '../../../utils/workerCompat.js'
import { BackupError } from './errors.js'
import { ArchiveSourceError, importArchive } from './importArchive.js'
import type { ImportRequest, ImportResponse } from './importOffMainThread.js'

const send = (response: ImportResponse) => globalThis.postMessage(response)

globalThis.addEventListener(
  'message',
  ({ data }: MessageEvent<ImportRequest>) => {
    void importArchive(
      data.file,
      data.importId,
      (value) => send({ type: 'progress', value }),
      data.mode
    ).then(
      (result) => send({ type: 'done', result }),
      (error: unknown) => {
        if (error instanceof ArchiveSourceError) {
          send({ type: 'unavailable' })
          return
        }
        send({
          type: 'error',
          key: error instanceof BackupError ? error.key : undefined,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    )
  },
  { once: true }
)

send({ type: 'ready', supported: typeof indexedDB !== 'undefined' })

/* ============================================================================
 * 功能区：历史归档 / import.worker 结束
 * ========================================================================== */
