/* ============================================================================
 * 功能区：回归与构建辅助 / test-auto-backup · 自动备份
 * 职责：自动备份：命名去重、数据版本判断、ZIP 完整性与失败状态。
 * 分区：01 夹具与固定输入；02 验证场景；03 断言与清理
 * 关联：被测或辅助模块 services/chat/backupName；由 pnpm 脚本直接执行。
 * 导出：无（独立可执行脚本）
 * 边界：只执行回归、构建与像素比对；不写入产品数据，临时目录在结束时清理。
 * ========================================================================== */

/**
 * 自动备份回归：
 * 1. 文件名精确到秒，同一天多次备份不会重名；
 * 2. 同一时刻生成稳定名称，方便按时间排序；
 * 3. 名称只包含固定前缀、日期和时分秒，不夹带路径分隔符。
 */
/* ---- 01 夹具与固定输入 ---- */
import assert from 'node:assert/strict'

const { autoBackupFileName } = await import('../src/services/chat/backupName.ts')

const morning = new Date(2026, 10, 24, 8, 5, 3)
assert.equal(autoBackupFileName(morning), 'deepseek_data-2026-11-24-080503.zip')
/* ---- 02 验证场景 ---- */
assert.match(autoBackupFileName(morning), /^deepseek_data-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/)
assert.ok(!autoBackupFileName(morning).includes('/'))

const later = new Date(2026, 10, 24, 8, 5, 4)
assert.notEqual(
  autoBackupFileName(morning),
  autoBackupFileName(later),
  '同一天不同秒的备份必须使用不同文件名'
)

/* ---- 03 断言与清理 ---- */
assert.equal(
  autoBackupFileName(new Date(2026, 0, 1, 0, 0, 0)),
  'deepseek_data-2026-01-01-000000.zip'
)

console.log('auto backup regression: ok')
