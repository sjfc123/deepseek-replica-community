/* ============================================================================
 * 功能区：视图与交互 / MathFormula
 * 职责：MathFormula 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、契约与依赖；02 核心实现：useMathHtml、MathBlock、InlineMath
 * 关联：依赖 services/markdown/katex；
 *    被 components/markdown/MarkdownAstRenderer 引用。
 * 导出：MathBlock、InlineMath
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ensureKatex, type Katex } from '../../services/markdown/katex.js'

/* ---- 01 类型、契约与依赖 ---- */
/** renderToString 外层包裹的标签，组件自己渲染外层，这里切掉 */
const KATEX_WRAPPER = {
  inline: ['<span class="katex">', '</span>'],
  display: ['<span class="katex-display"><span class="katex">', '</span></span>'],
} as const

type MathHtmlResult = {
  html: string
  renderMode: 'katex' | 'plain'
}

const noop = () => {}

/* ---- 02 核心实现：useMathHtml、MathBlock、InlineMath ---- */
/** KaTeX 渲染公式；出错时保留上次成功的结果（流式中公式未写完），没有则展示原文 */
const useMathHtml = (input: string, isInline: boolean): MathHtmlResult => {
  const previousResultRef = useRef<MathHtmlResult | null>(null)
  const katexRef = useRef(ensureKatex())
  const [katex, setKatex] = useState<Katex | null>(
    katexRef.current instanceof Promise ? null : katexRef.current
  )

  useEffect(() => {
    if (katexRef.current instanceof Promise) {
      katexRef.current.then(setKatex, noop)
    }
  }, [])

  return useMemo((): MathHtmlResult => {
    if (!katex) {
      return { html: input, renderMode: 'plain' }
    }
    try {
      const [prefix, suffix] = KATEX_WRAPPER[isInline ? 'inline' : 'display']
      const html = katex
        .renderToString(input, { throwOnError: true, strict: false, displayMode: !isInline })
        .slice(prefix.length, -suffix.length)
      const result = { html, renderMode: 'katex' } as const
      previousResultRef.current = result
      return result
    } catch {
      return previousResultRef.current ?? { html: input, renderMode: 'plain' }
    }
  }, [input, isInline, katex])
}

export const MathBlock = memo(function MathBlock({ value }: { value: string }) {
  const { html, renderMode } = useMathHtml(value, false)
  if (renderMode === 'plain') {
    return <p className="ds-markdown-paragraph">{html}</p>
  }
  return (
    <span className="katex-display ds-markdown-math" data-latex={value} data-latex-display="true">
      <span className="katex" dangerouslySetInnerHTML={{ __html: html }}></span>
    </span>
  )
})

export const InlineMath = memo(function InlineMath({ value }: { value: string }) {
  const { html, renderMode } = useMathHtml(value, true)
  if (renderMode === 'plain') {
    return html
  }
  return (
    <span className="katex" data-latex={value} dangerouslySetInnerHTML={{ __html: html }}></span>
  )
})

/* ============================================================================
 * 功能区：Markdown 视图 / MathFormula 结束
 * ========================================================================== */
