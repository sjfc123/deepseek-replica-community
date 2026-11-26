/* ============================================================================
 * 功能区：Markdown 渲染 / mermaid · Mermaid 渲染
 * 职责：Mermaid 渲染：初始化、主题适配与错误呈现。
 * 分区：01 类型、契约与依赖；02 核心实现：loadMermaid、sanitizeMermaid、renderMermaid
 * 关联：无内部依赖；被 components/markdown/MermaidDiagram 引用。
 * 导出：renderMermaid
 * 边界：只处理 Markdown/公式/图表解析与渲染资源；不读取聊天状态，不写数据库。
 * ========================================================================== */

/* ---- 01 类型、契约与依赖 ---- */
type Mermaid = typeof import('mermaid').default

let mermaidPromise: Promise<Mermaid> | null = null
let renderQueue = Promise.resolve()
let nextId = 0

const loadMermaid = () => {
  mermaidPromise ??= import('mermaid')
    .then((module) => module.default)
    .catch((error: unknown) => {
      mermaidPromise = null
      throw error
    })
  return mermaidPromise
}

/** 转义图片标签，对同一图中的全部标签生效。 */
const sanitizeMermaid = (code: string) => code.replace(/<((?:img|image)\s+)/gi, '&lt;$1')

/* ---- 02 核心实现：loadMermaid、sanitizeMermaid、renderMermaid ---- */
/** 串行执行初始化和绘制，避免不同图表互相覆盖 Mermaid 的全局配置。 */
export const renderMermaid = (
  code: string,
  dark: boolean,
  isCancelled: () => boolean
): Promise<string | null> => {
  const result = renderQueue.then(async () => {
    if (isCancelled() || !code.trim()) {
      return null
    }

    const mermaid = await loadMermaid()
    if (isCancelled()) {
      return null
    }

    mermaid.initialize({
      theme: dark ? 'dark' : 'default',
      securityLevel: 'strict',
      startOnLoad: false,
      suppressErrorRendering: true,
    })

    const { svg } = await mermaid.render(`standalone-mermaid-${nextId++}`, sanitizeMermaid(code))
    return isCancelled() ? null : svg
  })

  // 某张图失败不阻塞后续图表；调用方仍收到原始任务的错误。
  renderQueue = result.then(
    () => {},
    () => {}
  )
  return result
}

/* ============================================================================
 * 功能区：Markdown 解析 / mermaid 结束
 * ========================================================================== */
