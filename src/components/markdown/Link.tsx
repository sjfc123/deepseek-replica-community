/* ============================================================================
 * 功能区：视图与交互 / Link
 * 职责：Link 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、契约与依赖；02 核心实现：openInApp、Link、ImageAsLink
 * 关联：依赖 app/openAndroidPage；被 components/markdown/MarkdownAstRenderer 引用。
 * 导出：Link、ImageAsLink
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import type { Image, Link as LinkNode } from 'mdast'
import { memo, type MouseEvent, type ReactNode } from 'react'
import { openAndroidPage } from '../../app/openAndroidPage.js'

/* ---- 01 类型、契约与依赖 ---- */
const sanitizeUrl = (url: string) => {
  // 如果URL没有协议，添加默认的https协议
  if (url && !url.match(/^[a-zA-Z]+:\/\//) && !url.startsWith('mailto:')) {
    url = `https://${url}`
  }

  try {
    const parsedUrl = new URL(url)
    if (['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)) {
      return parsedUrl.toString()
    }
    return undefined
  } catch {
    return undefined
  }
}

const openInApp = (event: MouseEvent<HTMLAnchorElement>) => {
  if (openAndroidPage(event.currentTarget.href)) {
    event.preventDefault()
  }
}

/* ---- 02 核心实现：openInApp、Link、ImageAsLink ---- */
export const Link = memo(function Link({
  node,
  children,
}: {
  node: LinkNode
  children: ReactNode
}) {
  // 页内锚点显示链接文字。
  if (node.url.startsWith('#')) {
    return children
  }

  // 邮件地址显示链接文字。
  if (node.url.startsWith('mailto:')) {
    return children
  }

  // URL 解析失败时 href 为空，链接文字仍可显示。
  const href = sanitizeUrl(node.url)

  return (
    <a
      href={href}
      title={node.title || undefined}
      target="_blank"
      rel="noreferrer"
      onClick={openInApp}
    >
      {children}
    </a>
  )
})

/** Markdown 图片显示为指向图片地址的链接 */
export function ImageAsLink({ node }: { node: Image }) {
  const url = sanitizeUrl(node.url)
  return (
    <a href={url} title={node.title ?? ''} target="_blank" rel="noreferrer" onClick={openInApp}>
      {url}
    </a>
  )
}

/* ============================================================================
 * 功能区：Markdown 视图 / Link 结束
 * ========================================================================== */
