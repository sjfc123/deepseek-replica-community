/* ============================================================================
 * 功能区：历史归档 / import.worker · 历史导入 Worker
 * 职责：历史导入 Worker：在后台解析 ZIP 并返回导入结果。
 * 分区：01 实现：send
 * 关联：依赖 services/chat/history/errors、services/chat/history/importArchive、services/chat/history/importOffMainThread、utils/workerCompat；
 *    无内联引用。
 * 导出：无对外导出（模块内部实现）
 * 边界：只处理导入导出格式、ZIP、合并与还原；不承担在线会话状态，也不负责自动备份调度。
 * ========================================================================== */

import '../../../utils/workerCompat.js'
import { BackupError } from './errors.js'
import { ArchiveSourceError, importArchive } from './importArchive.js'
import type { ImportRequest, ImportResponse } from './importOffMainThread.js'

/* ---- 01 实现：send ---- */
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
