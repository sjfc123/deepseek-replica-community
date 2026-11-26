/* ============================================================================
 * 功能区：会话与角色核心 / aside · 旁白与对白分离
 * 职责：旁白与对白分离：识别括号、斜体与井号旁白，支持剥离、遮罩与保留；不修改原消息。
 * 分区：01 类型、契约与依赖
 * 关联：无内部依赖；
 *    被 components/chatInput/ChatInput、components/markdown/MarkdownAstRenderer、components/messages/UserMessage、services/speech/readAloud 等 5 个模块 引用。
 * 导出：splitAsides、stripAsides、hasAside、maskAsides
 * 边界：只处理聊天领域的数据、状态转换与提示词装配；不直接渲染视图，不发起职责外的网络请求。
 * ========================================================================== */

/**
 * 内心独白：用圆括号包起来的一段（中英文括号都算），只给读者看，不读出来。
 * 渲染侧负责置灰，朗读与通话侧负责剔除。
 */

/* ---- 01 类型、契约与依赖 ---- */
/** 单行内成对出现的括号片段；未闭合的部分留在正文里 */
const ASIDE_IN_LINE = /（[^（）]*）|\([^()]*\)/g

/** 跨行的宽松版，用于整段文本的朗读剔除 */
const ASIDE_ANYWHERE = /（[\s\S]*?）|\([\s\S]*?\)/g

/** 按独白切分文本，保留原文顺序；未闭合的括号不切分 */
export const splitAsides = (text: string): Array<{ text: string; aside: boolean }> => {
  const parts: Array<{ text: string; aside: boolean }> = []
  let cursor = 0
  for (const match of text.matchAll(ASIDE_IN_LINE)) {
    const start = match.index ?? 0
    if (start > cursor) {
      parts.push({ text: text.slice(cursor, start), aside: false })
    }
    parts.push({ text: match[0], aside: true })
    cursor = start + match[0].length
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), aside: false })
  }
  return parts
}

/** 去掉独白后的正文，用于语音合成；整段都是独白时返回空串 */
export const stripAsides = (text: string) =>
  text
    .replace(ASIDE_ANYWHERE, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()

/** 文本里是否有独白 */
export const hasAside = (text: string) => /（[^（）]*）|\([^()]*\)/.test(text)

/**
 * 等长掩码：把独白换成空格，长度与换行位置都不变。
 * 通话按字符偏移切句，掩码后偏移仍对齐原文，独白里的标点也不会再触发断句。
 */
export const maskAsides = (text: string) =>
  text.replace(ASIDE_ANYWHERE, (match) => match.replace(/[^\n]/g, ' '))

/* ============================================================================
 * 功能区：会话与角色核心 / aside 结束
 * ========================================================================== */
