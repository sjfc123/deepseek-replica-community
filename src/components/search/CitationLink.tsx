import type { MouseEvent } from 'react'
import { android } from '../../app/android.js'
import type { Source } from '../../services/chat/view.js'
import { HoverCard, type HoverCardTrigger } from './HoverCard.js'
import { SourceCard } from './SourceCard.js'
import { toggleSearchPanel } from './searchPanelState.js'

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
