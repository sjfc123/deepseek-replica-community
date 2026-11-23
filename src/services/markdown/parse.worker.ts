import '../../utils/workerCompat.js'
import type { RootContent } from 'mdast'
import { toMdAst, type MarkdownParseOptions } from './parse.js'

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
