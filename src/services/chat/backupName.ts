/* ============================================================================
 * 功能区：会话与角色核心 / backupName 开始
 * 职责：backupName 服务实现，负责会话状态、角色档案、角色卡、世界书、记忆、上下文或草稿操作中的该子能力。
 * 导出：autoBackupFileName。
 * ========================================================================== */

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * 自动备份文件名精确到秒，避免同一天多次备份产生同名副本。
 * 只使用本机时间与固定前缀，文件名可直接按时间排序。
 */
export const autoBackupFileName = (date: Date): string =>
  `deepseek_data-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}.zip`

/* ============================================================================
 * 功能区：会话与角色核心 / backupName 结束
 * ========================================================================== */
