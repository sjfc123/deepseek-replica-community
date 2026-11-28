/* ============================================================================
 * 功能区：会话与角色核心 / nickname · 出站称呼宏替换
 * 职责：只在发给接口的请求副本里，把硬编码的玩家称呼统一替换为当前账号昵称；不回写本地持久化记录。
 * 分区：01 占位名与转义；02 文本替换；03 消息副本映射
 * 关联：依赖 services/api/types；被 services/chat/store、services/chat/reply 引用。
 * 导出：replaceUserNickname
 * 边界：纯函数，不读设置、不发请求、不写数据库；替换只作用于出站消息副本。
 * ========================================================================== */

import type { MessageParam } from '../api/types.js'

/* ---- 01 占位名与转义 ---- */
/** 账号名为空或落在这些占位名上时，回落默认“用户”，不做替换 */
const PLACEHOLDER_NAMES = new Set(['用户', '本地用户', 'Local user', 'local user'])

/** 替换串里的 `$` 在正则/字符串替换中是特殊占位，先转义避免被当成匹配组引用 */
const escapeReplacement = (value: string): string => value.replace(/\$/g, '$$$$')

/* ---- 02 文本替换 ---- */
/** 名字紧邻重复（可夹顿号、逗号与空格）合并成一次：小满小满 / 小满、小满 → 小满 */
const collapseRepeatedName = (text: string, name: string): string => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(${escaped})(?:[、,，\\s]{0,2}\\1)+`, 'g')
  return text.replace(pattern, '$1')
}

const replaceText = (text: string, name: string, replacement: string): string =>
  collapseRepeatedName(text.replace(/玩家|用户|\bUser\b/gi, replacement), name)

/* ---- 03 消息副本映射 ---- */
/**
 * 出站请求副本里的玩家称呼宏替换：把历史与本轮文本里硬编码的
 * “用户 / 玩家 / User”统一换成当前账号昵称，并合并替换后紧邻重复的名字。
 *
 * - 只映射请求用的消息副本，不修改 IndexedDB / 本地会话里的原始记录，UI 渲染不受影响；
 * - 昵称为空或占位名时原样返回（回落默认“用户”）；
 * - 文件块、工具块、检索结果块原样保留，只改文本块。
 */
export const replaceUserNickname = (
  messages: MessageParam[],
  userName: string
): MessageParam[] => {
  const name = userName.trim()
  if (!name || PLACEHOLDER_NAMES.has(name)) {
    return messages
  }
  const replacement = escapeReplacement(name)
  return messages.map((message) => {
    if (message.role === 'latest_reminder') {
      return message
    }
    if (message.role === 'assistant') {
      const content = message.content.map((block) =>
        block.type === 'text'
          ? { ...block, text: replaceText(block.text, name, replacement) }
          : block
      )
      return { ...message, content }
    }
    if (typeof message.content === 'string') {
      return { ...message, content: replaceText(message.content, name, replacement) }
    }
    const content = message.content.map((block) =>
      block.type === 'text'
        ? { ...block, text: replaceText(block.text, name, replacement) }
        : block
    )
    return { ...message, content }
  })
}
