/* ============================================================================
 * 功能区：视图与交互 / SourceCard
 * 职责：SourceCard 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、契约与依赖
 * 关联：依赖 components/search/SiteLogo、components/search/SourceCard.module、services/chat/view、utils/format；
 *    被 components/search/CitationLink、components/search/SearchPanel 引用。
 * 导出：SourceCard
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import clsx from 'clsx'
import type { Source } from '../../services/chat/view.js'
import { formatDate } from '../../utils/format.js'
import { SiteLogo } from './SiteLogo.js'
import styles from './SourceCard.module.css'

/* ---- 01 类型、契约与依赖 ---- */
/** 显示为 YYYY/MM/DD；无法解析的日期原样显示 */
const formatPublishedAt = (value: string | null) => (value ? (formatDate(value, '/') ?? value) : '')

/**
 * 搜索结果卡片：站点图标与名称、日期、标题、摘要。
 * 元数据缺失时省略摘要，图标使用链接图标回退。
 */
export const SourceCard = ({ source, className }: { source: Source; className?: string }) => {
  const date = formatPublishedAt(source.publishedAt)
  return (
    <a className={styles.anchor} href={source.url} target="_blank" rel="noreferrer">
      <div className={clsx(styles.card, className)}>
        <div className={styles.meta}>
          <SiteLogo url={source.siteIcon} className={styles.siteIcon} />
          {source.siteName ? <span className={styles.siteName}>{source.siteName}</span> : null}
          {source.siteName && date ? <span className={styles.divider} /> : null}
          {date ? <span className={styles.date}>{date}</span> : null}
        </div>
        <div className={styles.title}>{source.title}</div>
        {source.snippet ? <div className={styles.snippet}>{source.snippet}</div> : null}
      </div>
    </a>
  )
}

/* ============================================================================
 * 功能区：搜索与引用 / SourceCard 结束
 * ========================================================================== */
