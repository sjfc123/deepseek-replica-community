/* ============================================================================
 * 功能区：历史归档 / errors 开始
 * 职责：errors 服务实现，负责历史归档的 ZIP 读写、结构校验、会话转换与导入导出中的该子能力。
 * 导出：BackupError、fail。
 * ========================================================================== */

import type { TranslationKey } from '../../../i18n/index.js'

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
