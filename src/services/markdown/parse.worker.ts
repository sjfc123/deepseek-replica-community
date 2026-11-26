/* ============================================================================
 * 功能区：Markdown 渲染 / parse.worker
 * 职责：Markdown 解析 Worker 入口：接收主线程消息并返回 AST。
 * 分区：01 类型、契约与依赖
 * 关联：依赖 services/markdown/parse、utils/workerCompat；无内联引用。
 * 导出：无对外导出（模块内部实现）
 * 边界：只处理 Markdown/公式/图表解析与渲染资源；不读取聊天状态，不写数据库。
 * ========================================================================== */

import '../../utils/workerCompat.js'
import type { RootContent } from 'mdast'
import { toMdAst, type MarkdownParseOptions } from './parse.js'

/* ---- 01 类型、契约与依赖 ---- */
type ParseRequest = MarkdownParseOptions & { id: number; content: string; previousId?: number }
let previous: { id: number; blocks: RootContent[] } | undefined

globalThis.addEventListener('message', ({ data }: MessageEvent<ParseRequest>) => {
  const { id, content, previousId, ...options } = data
  try {
    const ast = toMdAst(content, options)
    const blocks = ast.children
    let reused = 0
    // 仍解析完整文档：后续的链接定义等语法可能改变已解析块。
    if (previous && previous.id === previousId) {
      const limit = Math.min(previous.blocks.length, blocks.length)
      while (
        reused < limit &&
        JSON.stringify(previous.blocks[reused]) === JSON.stringify(blocks[reused])
      ) {
        reused++
      }
    }
    previous = { id, blocks }
    globalThis.postMessage({ id, reused, ast: { ...ast, children: blocks.slice(reused) } })
  } catch {
    globalThis.postMessage({ id })
  }
})

/* ============================================================================
 * 功能区：Markdown 解析 / parse.worker 结束
 * ========================================================================== */
