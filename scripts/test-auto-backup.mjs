/**
 * 自动备份回归：
 * 1. 文件名精确到秒，同一天多次备份不会重名；
 * 2. 同一时刻生成稳定名称，方便按时间排序；
 * 3. 名称只包含固定前缀、日期和时分秒，不夹带路径分隔符。
 */
import assert from 'node:assert/strict'

const { autoBackupFileName } = await import('../src/services/chat/backupName.ts')

const morning = new Date(2026, 10, 24, 8, 5, 3)
assert.equal(autoBackupFileName(morning), 'deepseek_data-2026-11-24-080503.zip')
assert.match(autoBackupFileName(morning), /^deepseek_data-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/)
assert.ok(!autoBackupFileName(morning).includes('/'))

const later = new Date(2026, 10, 24, 8, 5, 4)
assert.notEqual(
  autoBackupFileName(morning),
  autoBackupFileName(later),
  '同一天不同秒的备份必须使用不同文件名'
)

assert.equal(
  autoBackupFileName(new Date(2026, 0, 1, 0, 0, 0)),
  'deepseek_data-2026-01-01-000000.zip'
)

console.log('auto backup regression: ok')
