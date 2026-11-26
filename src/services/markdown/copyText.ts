/* ============================================================================
 * 功能区：Markdown 渲染 / copyText · Android 复制文本
 * 职责：Android 复制文本：把 Markdown 引用、代码与链接转换成可粘贴纯文本。
 * 分区：01 类型、契约与依赖；
 *    02 核心实现：serializeBlock、serializeBlocks、formatAndroidCopyText；
 *    03 对外入口与收尾
 * 关联：依赖 services/markdown/parse；被 components/messages/AssistantMessage 引用。
 * 导出：formatAndroidCopyText
 * 边界：只处理 Markdown/公式/图表解析与渲染资源；不读取聊天状态，不写数据库。
 * ========================================================================== */

import type { BlockContent, DefinitionContent, List, PhrasingContent, RootContent } from 'mdast'
import { toMdAst } from './parse.js'

/* ---- 01 类型、契约与依赖 ---- */
const serializeInline = (nodes: PhrasingContent[]): string => {
  const parts: string[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        parts.push(node.value)
        break
      case 'inlineMath':
        parts.push(node.value.trim())
        break
      case 'inlineCode':
        parts.push(node.value)
        break
      case 'strong':
      case 'emphasis':
      case 'delete':
      case 'link':
        parts.push(serializeInline(node.children))
        break
      case 'image':
        parts.push(node.alt || '')
        break
      case 'break':
        parts.push('\n')
        break
      case 'html':
        parts.push(/^<br\s*\/?>$/i.test(node.value) ? '\n' : node.value)
        break
      case 'citation':
        break
      default:
        break
    }
  }
  return parts.join('')
}

/* ---- 02 核心实现：serializeBlock、serializeBlocks、formatAndroidCopyText ---- */
const serializeList = (list: List, depth: number): string =>
  list.children
    .map((item, index) => {
      const marker = '  '.repeat(depth) + (list.ordered ? `${(list.start ?? 1) + index}. ` : '· ')
      const check = typeof item.checked === 'boolean' ? (item.checked ? '☑ ' : '□ ') : ''
      const indent = '  '.repeat(depth + 1)
      const lines: string[] = []
      let started = false

      for (const child of item.children) {
        if (child.type === 'list') {
          const nested = serializeList(child, depth + 1)
          if (nested) {
            lines.push(nested)
          }
          continue
        }
        const text = serializeBlock(child)
        if (!text) {
          continue
        }
        if (!started) {
          lines.push(`${marker}${check}${text}`)
          started = true
        } else {
          lines.push(
            text
              .split('\n')
              .map((line) => (line ? `${indent}${line}` : ''))
              .join('\n')
          )
        }
      }

      if (!started) {
        lines.push(`${marker}${check}`.trimEnd())
      }
      return lines.join('\n')
    })
    .filter((entry) => entry.length > 0)
    .join('\n')

const serializeBlock = (node: RootContent | BlockContent | DefinitionContent): string => {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return serializeInline(node.children)
    case 'math':
      return node.value.trim()
    case 'code':
      return node.value
    case 'blockquote':
      return serializeBlocks(node.children)
    case 'list':
      return serializeList(node, 0)
    case 'table':
      return node.children
        .map((row) => row.children.map((cell) => serializeInline(cell.children)).join('\t'))
        .join('\n')
    case 'html':
      return node.value.replace(/<br\s*\/?>/gi, '\n')
    case 'thematicBreak':
      return ''
    default:
      return ''
  }
}

/* ---- 03 对外入口与收尾 ---- */
const serializeBlocks = (nodes: Array<RootContent | BlockContent | DefinitionContent>): string =>
  nodes
    .map(serializeBlock)
    .filter((text) => text.length > 0)
    .join('\n\n')

/**
 * 将 Markdown 回复正文转换为对齐官方 Android 客户端复制行为的纯文本：
 * 保留纯 LaTeX 源码（去除 `$`/`$$`/`\[`/`\]` 定界符）与代码块正文，剥离 Markdown 强调/标题/引用符号。
 */
export const formatAndroidCopyText = (markdown: string): string => {
  if (!markdown.trim()) {
    return markdown
  }
  const ast = toMdAst(markdown, { sources: undefined, disableLink: false })
  return serializeBlocks(ast.children)
}

/* ============================================================================
 * 功能区：Markdown 解析 / copyText 结束
 * ========================================================================== */
