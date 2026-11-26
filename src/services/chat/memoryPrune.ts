/* ============================================================================
 * 功能区：会话与角色核心 / memoryPrune · 长期记忆精确删除
 * 职责：长期记忆精确删除：按消息与卡片 ID 移除，不扫描或清空整个分类。
 * 分区：01 类型、契约与依赖
 * 关联：依赖 services/chat/types；
 *    被 scripts/test-memory-prune、services/chat/store 引用。
 * 导出：MemoryRemovalTarget、removeMemoryCards
 * 边界：只处理聊天领域的数据、状态转换与提示词装配；不直接渲染视图，不发起职责外的网络请求。
 * ========================================================================== */

import type { Message } from './types.js'

/* ---- 01 类型、契约与依赖 ---- */
/** 精确删除目标：只按消息 + 卡片定位，绝不按分类批量清空 */
export type MemoryRemovalTarget = { messageId: string; cardId: string }

/**
 * 从消息树中移除指定卡片。没有命中的消息保持原对象，
 * 同 ID 卡片若挂在别的消息上也不会被误删。
 */
export const removeMemoryCards = (
  messages: Message[],
  targets: MemoryRemovalTarget[]
): Message[] => {
  if (targets.length === 0) {
    return messages
  }
  const byMessage = new Map<string, Set<string>>()
  for (const target of targets) {
    const ids = byMessage.get(target.messageId) ?? new Set<string>()
    ids.add(target.cardId)
    byMessage.set(target.messageId, ids)
  }
  return messages.map((message) => {
    const ids = byMessage.get(message.id)
    if (!ids || !message.memories?.length) {
      return message
    }
    const memories = message.memories.filter((card) => !ids.has(card.id))
    return memories.length === message.memories.length ? message : { ...message, memories }
  })
}

/* ============================================================================
 * 功能区：会话与角色核心 / memoryPrune 结束
 * ========================================================================== */
