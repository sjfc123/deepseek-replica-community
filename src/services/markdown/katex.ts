/* ============================================================================
 * 功能区：Markdown 渲染 / katex · KaTeX 资源
 * 职责：KaTeX 资源：按需加载样式与字体并暴露渲染器。
 * 分区：01 类型、契约与依赖
 * 关联：无内部依赖；被 components/markdown/MathFormula、main 引用。
 * 导出：Katex、ensureKatex
 * 边界：只处理 Markdown/公式/图表解析与渲染资源；不读取聊天状态，不写数据库。
 * ========================================================================== */

/* ---- 01 类型、契约与依赖 ---- */
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
