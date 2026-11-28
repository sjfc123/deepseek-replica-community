/* ============================================================================
 * 功能区：会话与角色核心 / easterEgg · 主页内置台词
 * 职责：集中维护主页内置台词的翻译键，供设置页台词池与主页台词切换复用；只提供可选文案，不承担写入与状态管理。
 * 分区：01 常量
 * 关联：依赖 i18n 类型；被 components/session/Welcome、components/settings/AndroidSettings 引用。
 * 导出：FAT_FISH_FIRST_LINE、FAT_FISH_RANDOM_LINES、FAT_FISH_ALL_LINES
 * 边界：只存翻译键，不做文案插值、持久化与交互编排。
 * ========================================================================== */

import type { TranslationKey } from '../../i18n/index.js'

/* ---- 01 常量：内置台词翻译键 ---- */

/** 内置首条台词 */
export const FAT_FISH_FIRST_LINE: TranslationKey = 'fatFishLineFirst'

/** 其余内置台词：阶段过渡三条 + 调侃十条 */
export const FAT_FISH_RANDOM_LINES: readonly TranslationKey[] = [
  'fatFishLinePhase1',
  'fatFishLinePhase2',
  'fatFishLinePhase3',
  'fatFishLineTease1',
  'fatFishLineTease2',
  'fatFishLineTease3',
  'fatFishLineTease4',
  'fatFishLineTease5',
  'fatFishLineTease6',
  'fatFishLineTease7',
  'fatFishLineTease8',
  'fatFishLineTease9',
  'fatFishLineTease10',
]

/** 内置台词全集：首条 + 其余，供编辑弹层与设置页列出可选 */
export const FAT_FISH_ALL_LINES: readonly TranslationKey[] = [
  FAT_FISH_FIRST_LINE,
  ...FAT_FISH_RANDOM_LINES,
]
