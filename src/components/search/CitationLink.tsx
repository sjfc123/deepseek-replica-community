/* ============================================================================
 * 功能区：视图与交互 / CitationLink
 * 职责：CitationLink 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：CitationLink
 * 关联：依赖 app/android、components/search/HoverCard、components/search/SourceCard、components/search/searchPanelState 等 5 个模块；
 *    被 components/markdown/MarkdownAstRenderer 引用。
 * 导出：CitationLink
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import type { MouseEvent } from 'react'
import { android } from '../../app/android.js'
import type { Source } from '../../services/chat/view.js'
import { HoverCard, type HoverCardTrigger } from './HoverCard.js'
import { SourceCard } from './SourceCard.js'
import { toggleSearchPanel } from './searchPanelState.js'

/* ---- 01 实现：CitationLink ---- */
/**
 * 正文里 [citation:N] 的数字角标：Android 打开来源面板，桌面端悬停预览并在新标签打开。
 * 角标使用带 link 角色的 span，可嵌入链接文字。样式由 .ds-markdown-cite 提供。
 */
export const CitationLink = ({ source }: { source: Source }) => {
  const open = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (android) {
      toggleSearchPanel(`citation:${source.url}`, [source])
    } else {
      window.open(source.url, '_blank', 'noopener,noreferrer')
    }
  }
  if (android) {
    return (
      <span
        className="ds-markdown-cite"
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            event.stopPropagation()
            toggleSearchPanel(`citation:${source.url}`, [source])
          }
        }}
      >
        {source.index}
      </span>
    )
  }
  const renderTrigger: HoverCardTrigger = ({ domRef, domProps }) => (
    <span ref={domRef} className="ds-markdown-cite" {...domProps} role="link" onClick={open}>
      {source.index}
    </span>
  )
  return (
    <HoverCard renderTrigger={renderTrigger}>
      <SourceCard source={source} />
    </HoverCard>
  )
}

/* ============================================================================
 * 功能区：搜索与引用 / CitationLink 结束
 * ========================================================================== */
