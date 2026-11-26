/* ============================================================================
 * 功能区：会话与角色核心 / placeholders · 提示词占位符
 * 职责：提示词占位符：{{user}}、{{char}}、${user_name} 等统一替换；不做内容改写。
 * 分区：01 类型、契约与依赖
 * 关联：无内部依赖；被 services/chat/store 引用。
 * 导出：PlaceholderNames、applyPlaceholders
 * 边界：只处理聊天领域的数据、状态转换与提示词装配；不直接渲染视图，不发起职责外的网络请求。
 * ========================================================================== */

/* ---- 01 类型、契约与依赖 ---- */
/**
 * 提示词占位符：角色卡、世界书、记忆与手写提示词共用一套写法。
 * 兼容旧版 {{user}} 与更常见的 ${user_name} / ${char_name}。
 */

export type PlaceholderNames = {
  userName: string
  /** 当前启用的角色卡名字；没有启用卡时留空，角色占位符原样保留 */
  charName?: string
}

export const applyPlaceholders = (text: string, { userName, charName }: PlaceholderNames) => {
  if (!text) {
    return text
  }
  const char = charName?.trim()
  let result = text
    .replaceAll('{{user}}', userName)
    .replaceAll('{{user_name}}', userName)
    .replaceAll('${user_name}', userName)
    .replaceAll('${user}', userName)
  if (char) {
    result = result
      .replaceAll('{{char}}', char)
      .replaceAll('{{char_name}}', char)
      .replaceAll('${char_name}', char)
      .replaceAll('${char}', char)
  }
  return result
}

/* ============================================================================
 * 功能区：会话与角色核心 / placeholders 结束
 * ========================================================================== */
