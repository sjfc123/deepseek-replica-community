/* ============================================================================
 * 功能区：Markdown 解析 / parseOffMainThread 开始
 * 职责：parseOffMainThread 服务实现，负责 Markdown 解析、代码高亮、KaTeX、Mermaid 与 Worker 调度中的该子能力。
 * 导出：ParsedMarkdown、parseOffMainThread。
 * ========================================================================== */

import type { Root } from 'mdast'
import type { MarkdownParseOptions } from './parse.js'

export type ParsedMarkdown = { id: number; ast: Root }
type ParseResponse = { id: number; ast?: Root; reused?: number }

let worker: Worker | undefined
let unavailable = false
let nextId = 0
const pending = new Map<number, (response?: ParseResponse) => void>()

const getWorker = () => {
  if (worker) {
    return worker
  }
  const parser = new Worker(
    new URL(/* webpackChunkName: "markdown-parser" */ './parse.worker.ts', import.meta.url)
  )
  const reset = () => {
    if (worker !== parser) {
      return
    }
    clearTimeout(startupTimer)
    parser.terminate()
    worker = undefined
    unavailable = true
    for (const resolve of pending.values()) {
      resolve()
    }
    pending.clear()
  }
  const startupTimer = setTimeout(reset, 4000)
  parser.addEventListener('error', reset)
  parser.addEventListener('messageerror', reset)
  parser.addEventListener('message', ({ data }: MessageEvent<ParseResponse>) => {
    clearTimeout(startupTimer)
    const resolve = pending.get(data.id)
    pending.delete(data.id)
    resolve?.(data)
  })
  worker = parser
  return parser
}

export const parseOffMainThread = (
  content: string,
  options: MarkdownParseOptions,
  previous?: ParsedMarkdown
) =>
  new Promise<ParsedMarkdown | null>((resolve) => {
    if (unavailable) {
      resolve(null)
      return
    }
    const id = ++nextId
    try {
      pending.set(id, (response) => {
        const ast = response?.ast
        if (!ast) {
          resolve(null)
          return
        }
        if (previous && response.reused) {
          ast.children = [...previous.ast.children.slice(0, response.reused), ...ast.children]
        }
        resolve({ id, ast })
      })
      getWorker().postMessage({ id, content, ...options, previousId: previous?.id })
    } catch {
      pending.delete(id)
      resolve(null)
    }
  })

/* ============================================================================
 * 功能区：Markdown 解析 / parseOffMainThread 结束
 * ========================================================================== */
