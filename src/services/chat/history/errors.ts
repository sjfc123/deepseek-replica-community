/* ============================================================================
 * 功能区：历史归档 / errors · 历史归档错误
 * 职责：历史归档错误：统一错误码与消息，供导入导出层抛出。
 * 分区：01 类型、契约与依赖
 * 关联：依赖 i18n/index；
 *    被 services/chat/backup、services/chat/history/import.worker、services/chat/history/importArchive、services/chat/history/importOffMainThread 等 7 个模块 引用。
 * 导出：BackupError、fail
 * 边界：只处理导入导出格式、ZIP、合并与还原；不承担在线会话状态，也不负责自动备份调度。
 * ========================================================================== */

import type { TranslationKey } from '../../../i18n/index.js'

/* ---- 01 类型、契约与依赖 ---- */
/** 导入导出失败的原因，key 对应界面提示文案。 */
export class BackupError extends Error {
  constructor(readonly key: TranslationKey) {
    super(key)
    this.name = 'BackupError'
  }
}

export const fail = (key: TranslationKey): never => {
  throw new BackupError(key)
}

/* ============================================================================
 * 功能区：历史归档 / errors 结束
 * ========================================================================== */
