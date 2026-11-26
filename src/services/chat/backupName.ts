/* ============================================================================
 * 功能区：会话与角色核心 / backupName · 自动备份文件名
 * 职责：自动备份文件名：固定前缀、日期与秒级时间，保证同日不重名且可排序。
 * 分区：01 类型、契约与依赖
 * 关联：无内部依赖；被 scripts/test-auto-backup、services/chat/backup 引用。
 * 导出：autoBackupFileName
 * 边界：只处理聊天领域的数据、状态转换与提示词装配；不直接渲染视图，不发起职责外的网络请求。
 * ========================================================================== */

/* ---- 01 类型、契约与依赖 ---- */
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
