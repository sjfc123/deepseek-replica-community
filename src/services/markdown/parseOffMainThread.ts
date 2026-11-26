/* ============================================================================
 * 功能区：Markdown 渲染 / parseOffMainThread · Markdown 解析调度
 * 职责：Markdown 解析调度：优先 Worker，失败时退回主线程。
 * 分区：01 类型、契约与依赖；02 核心实现：pending、getWorker、parseOffMainThread
 * 关联：依赖 services/markdown/parse；被 components/markdown/Markdown 引用。
 * 导出：ParsedMarkdown、parseOffMainThread
 * 边界：只处理 Markdown/公式/图表解析与渲染资源；不读取聊天状态，不写数据库。
 * ========================================================================== */

import type { Root } from 'mdast'
import type { MarkdownParseOptions } from './parse.js'

/* ---- 01 类型、契约与依赖 ---- */
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

/* ---- 02 核心实现：pending、getWorker、parseOffMainThread ---- */
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
