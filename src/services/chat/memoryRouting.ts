/* ============================================================================
 * 功能区：会话与角色核心 / memoryRouting 开始
 * 职责：按当前显示名决定自动记忆与手动保存落到普通池还是角色池。
 * 导出：ASSISTANT_MEMORY_NAMES、memoryPoolForDisplayName、resolveMemoryDisplayName。
 * ========================================================================== */

import type { MemoryPool } from './memory.js'

/** 普通助手兜底显示名：出现这些名字时，记忆写入普通池 */
export const ASSISTANT_MEMORY_NAMES = ['ai', 'deepseek']

/** 显示名解析顺序：角色卡名 > 手写档案名 > 端点默认名 */
export const resolveMemoryDisplayName = (options: {
  cardName?: string
  characterName?: string
  custom: boolean
}): string =>
  options.cardName?.trim() ||
  options.characterName?.trim() ||
  (options.custom ? 'AI' : 'DeepSeek')

/**
 * 显示名只决定记忆落池，不改变角色卡、档案或提示词的拼装。
 * 空名、AI、DeepSeek（含大小写差异）视为普通助手；其余非空名字视为角色名。
 * 角色卡名优先于手写档案名，调用方先解析出最终显示名再传入。
 */
export const memoryPoolForDisplayName = (name: string | undefined): MemoryPool => {
  const normalized = (name ?? '').trim().toLowerCase()
  if (!normalized || ASSISTANT_MEMORY_NAMES.includes(normalized)) {
    return 'normal'
  }
  return 'character'
}

/* ============================================================================
 * 功能区：会话与角色核心 / memoryRouting 结束
 * ========================================================================== */
