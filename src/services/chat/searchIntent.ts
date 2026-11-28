/* ============================================================================
 * 功能区：会话与角色核心 / searchIntent · 显式检索判定
 * 职责：只识别玩家明确要求查资料、搜索或给出链接的请求；普通寒暄、剧情、情绪与关系闲聊不触发检索。
 * 分区：01 正则与判定函数
 * 关联：被 services/chat/store 在组装工具清单前调用；不发起网络请求。
 * 导出：hasExplicitSearchRequest
 * 边界：本地只做保守意图判定，不代替模型判断事实是否需要外部资料。
 * ========================================================================== */

const SEARCH_REQUEST_PATTERNS: readonly RegExp[] = [
  /帮我[^\s，。；！？]*(查|搜|找|检索|打听|核实)/,
  /(帮我|给我|麻烦|请)[^\s，。；！？]*(查一下|查一查|搜一下|搜一搜|找一下|找一找|检索一下|查资料|找资料)/,
  /(查|搜|找|检索)(一下|一查|一搜|一找|资料|信息|最新|新闻)/,
  /搜索|检索|查找|查阅|核实一下|查清楚/,
  /找资料|查资料|搜集资料|搜索资料/,
]

const URL_PATTERN = /https?:\/\/[^\s，。；！？]+|www\.[^\s，。；！？]+/i

/** 消息是否直接包含可打开链接；只有这种情况下才声明读链接工具。 */
export const containsUrl = (question: string): boolean => URL_PATTERN.test(question.trim())

/**
 * 是否存在明确检索请求。
 *
 * 口径：必须出现“查 / 搜 / 找 / 检索 / 核实”等主动要求，或直接给出可打开链接；
 * 仅出现名词、话题、情绪、寒暄、剧情或关系闲聊时返回 false。
 */
export const hasExplicitSearchRequest = (question: string): boolean => {
  const text = question.trim()
  if (!text) {
    return false
  }
  return containsUrl(text) || SEARCH_REQUEST_PATTERNS.some((pattern) => pattern.test(text))
}
