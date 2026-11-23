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
