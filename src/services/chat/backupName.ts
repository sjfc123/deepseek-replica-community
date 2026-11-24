const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * 自动备份文件名精确到秒，避免同一天多次备份产生同名副本。
 * 只使用本机时间与固定前缀，文件名可直接按时间排序。
 */
export const autoBackupFileName = (date: Date): string =>
  `deepseek_data-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}.zip`
