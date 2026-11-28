/* ============================================================================
 * 功能区：回归与构建辅助 / test-theme-tokens · 深浅色令牌
 * 职责：深浅色令牌：校验浮层、分组底与结算面板在 light / dark 两套主题下都有定义，避免白底配浅色文字。
 * 分区：01 夹具与固定输入；02 验证场景；03 断言与清理
 * 关联：被测或辅助模块 app/theme.css、components/session/HistoryAuditDialog.css、i18n/zh；
 *    由 pnpm 脚本直接执行。
 * 导出：无（独立可执行脚本）
 * 边界：只读取样式与文案做静态断言；不构建、不截图、不写入产品数据。
 * ========================================================================== */

/**
 * 深浅色令牌回归：
 * 1. `--ds-bg-elevated` 在 light 与 dark 两个 body 主题块内都必须有定义，不能只靠 `#fff` 兜底；
 * 2. `--ds-bg-secondary` 同样两套主题都有定义，分组底在深色下不能继续用浅色半透明；
 * 3. 结算面板的卡片背景必须引用 `--ds-bg-elevated`，不能写死白色；
 * 4. 结算口径文案不再出现“估算”“冒充”一类非正式表述。
 */
/* ---- 01 夹具与固定输入 ---- */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const theme = read('src/app/theme.css')
const dialogCss = read('src/components/session/HistoryAuditDialog.css')
const zh = read('src/i18n/zh.ts')

/** 抓取顶层 `选择器 { … }` 块；theme.css 的主题块内部没有嵌套规则，按花括号截取即可。 */
const blocks = [...theme.matchAll(/(^|\n)([^{}\n][^{}]*)\{([^{}]*)\}/g)].map((match) => ({
  selector: match[2].trim(),
  body: match[3],
}))

const lightBlock = blocks.find(
  (block) =>
    block.selector === 'body' &&
    block.body.includes('--dsw-alias-bg-base: var(--dsw-static-neutral-bluish-00);'),
)
const darkBlock = blocks.find(
  (block) =>
    block.selector === 'body[data-ds-dark-theme]' &&
    block.body.includes('--dsw-alias-bg-base: var(--dsw-static-neutral-bluish-950);'),
)

/* ---- 02 验证场景 ---- */
assert.ok(lightBlock, 'theme.css 缺少浅色主题块')
assert.ok(darkBlock, 'theme.css 缺少深色主题块')

/* ---- 03 断言与清理 ---- */
assert.match(
  lightBlock.body,
  /--ds-bg-elevated:\s*var\(--dsw-static-neutral-bluish-00\);/,
  '浅色主题必须把浮层底定义为白色令牌',
)
assert.match(
  lightBlock.body,
  /--ds-bg-secondary:\s*rgba\(0,\s*0,\s*0,\s*0\.04\);/,
  '浅色主题必须定义分组底令牌',
)
assert.match(
  darkBlock.body,
  /--ds-bg-elevated:\s*var\(--dsw-static-neutral-bluish-850\);/,
  '深色主题必须把浮层底切换为深灰，不能回落到 #fff',
)
assert.match(
  darkBlock.body,
  /--ds-bg-secondary:\s*rgba\(255,\s*255,\s*255,\s*0\.06\);/,
  '深色主题必须定义白色低透明度分组底',
)
assert.match(
  dialogCss,
  /\.history-audit-card\s*\{[^}]*background:\s*var\(--ds-bg-elevated/,
  '结算卡片背景必须引用 --ds-bg-elevated',
)
assert.equal(/\.history-audit-card\s*\{[^}]*background:\s*#fff/.test(dialogCss), false, '结算卡片不能写死白色')

const caliber = zh.match(/historyAuditCaliber:\s*'([^']+)'/)?.[1] ?? ''
assert.ok(caliber.length > 0, '缺少结算口径文案')
for (const word of ['估算', '冒充', '近似']) {
  assert.equal(caliber.includes(word), false, `结算口径不能出现非正式表述：${word}`)
}
assert.match(caliber, /usage/, '结算口径必须说明 usage 的真实来源')

console.log('theme token regression: ok')
