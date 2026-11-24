/* ============================================================================
 * 功能区：Markdown 解析 / katex 开始
 * 职责：katex 服务实现，负责 Markdown 解析、代码高亮、KaTeX、Mermaid 与 Worker 调度中的该子能力。
 * 导出：Katex、ensureKatex。
 * ========================================================================== */

export type Katex = typeof import('katex').default

let katex: Katex | null = null
let katexPromise: Promise<Katex> | null = null

/** 按需加载 KaTeX 及其样式、化学公式扩展；已加载时同步返回 */
export const ensureKatex = (): Katex | Promise<Katex> => {
  if (katex !== null) {
    return katex
  }
  katexPromise ??= Promise.all([
    import('katex'),
    import('katex/contrib/mhchem'),
    import('katex/dist/katex.min.css'),
  ]).then(([module]) => (katex = module.default))
  return katexPromise
}

/* ============================================================================
 * 功能区：Markdown 解析 / katex 结束
 * ========================================================================== */
