/* ============================================================================
 * 功能区：Markdown 渲染 / parse · Markdown 解析
 * 职责：Markdown 解析：把 Markdown 转为自定义 AST，处理引用、公式、表格与安全链接。
 * 分区：01 类型、契约与依赖；02 对外入口与收尾
 * 关联：依赖 services/chat/view；
 *    被 components/markdown/Markdown、services/markdown/copyText、services/markdown/parse.worker、services/markdown/parseOffMainThread 引用。
 * 导出：CitationNode、MarkdownParseOptions、toMdAst
 * 边界：只处理 Markdown/公式/图表解析与渲染资源；不读取聊天状态，不写数据库。
 * ========================================================================== */

import type { Node as MdAstNode, Nodes, Parent, RootContent, Root, Text } from 'mdast'
import { findAndReplace } from 'mdast-util-find-and-replace'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-llm-math'
import type { Source } from '../chat/view.js'

/* ---- 01 类型、契约与依赖 ---- */
/** 正文里的 [citation:N]，已换成对应来源 */
export interface CitationNode extends MdAstNode {
  type: 'citation'
  source: Source
}

declare module 'mdast' {
  interface RootContentMap {
    citation: CitationNode
  }

  interface PhrasingContentMap {
    citation: CitationNode
  }
}

const text = (value: string): Text => ({ type: 'text', value })

export type MarkdownParseOptions = { sources: Source[] | undefined; disableLink: boolean }

const parserOptions = {
  extensions: [
    // codeIndented 语法导致有前导空格的列表无法正常渲染
    { ...gfm(), disable: { null: ['codeIndented'] } },
    math({ singleDollarTextMath: true }),
  ],
  mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
}

/* ---- 02 对外入口与收尾 ---- */
/**
 * 解析正文，并把渲染器不单独处理的节点提前换掉，渲染时无需再读原文：
 * - 传入 sources 时，[citation:N] 换成角标节点，找不到来源的直接去掉
 * - disableLink 时链接只保留文字
 * - 删除线保留原样的 ~ 定界符，脚注、引用式链接与定义显示原文
 */
export function toMdAst(input: string, { sources, disableLink }: MarkdownParseOptions): Root {
  const ast = fromMarkdown(input, parserOptions)
  if (sources) {
    const sourcesByIndex = new Map(sources.map((source) => [source.index, source]))
    findAndReplace(
      ast,
      [
        /\[citation:(\d+)\]/g,
        (_: string, index: string): CitationNode | '' => {
          const source = sourcesByIndex.get(Number(index))
          return source ? { type: 'citation', source } : ''
        },
      ],
      { ignore: ['linkReference'] }
    )
  }
  const raw = (node: Nodes) => input.slice(node.position?.start.offset, node.position?.end.offset)
  // 先递归处理子节点，再把当前节点替换为展开后的节点序列。
  const simplify = (node: Nodes): Nodes[] => {
    if ('children' in node) {
      ;(node as Parent).children = node.children.flatMap(simplify) as RootContent[]
    }
    switch (node.type) {
      case 'link':
        return disableLink ? node.children : [node]
      case 'delete': {
        // 首尾定界符长度由解析器保证一致，这里只需比较中间内容。
        const delimiter = raw(node).match(/^~+/)?.[0] ?? ''
        return [text(delimiter), ...node.children, text(delimiter)]
      }
      case 'footnoteReference':
      case 'imageReference':
      case 'linkReference':
        return [text(raw(node))]
      case 'footnoteDefinition':
      case 'definition':
        return [{ type: 'paragraph', children: [text(raw(node))] }]
      default:
        return [node]
    }
  }
  simplify(ast)
  return ast
}

/* ============================================================================
 * 功能区：Markdown 解析 / parse 结束
 * ========================================================================== */
