/* ============================================================================
 * 功能区：视图与交互 / SiteLogo
 * 职责：SiteLogo 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、契约与依赖
 * 关联：依赖 components/base/icons、components/search/ImageWithPlaceholder、components/search/SiteLogo.module、services/chat/view；
 *    被 components/messages/AssistantMessage、components/messages/ReplyArea、components/search/AndroidSearchPanel、components/search/SourceCard 引用。
 * 导出：SiteLogo、SiteThumbnails
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import type { CSSProperties } from 'react'
import clsx from 'clsx'
import { ImageWithPlaceholder } from './ImageWithPlaceholder.js'
import { IconLinkOutline14 } from '../base/icons.js'
import type { Source } from '../../services/chat/view.js'
import styles from './SiteLogo.module.css'

/* ---- 01 类型、契约与依赖 ---- */
/** 站点图标：加载中显示骨架，没有图标或加载失败时显示链接图标 */
export const SiteLogo = ({
  url,
  className,
  style,
}: {
  url: string | null
  className?: string
  style?: CSSProperties
}) => (
  <ImageWithPlaceholder
    key={url ?? ''}
    src={url ?? ''}
    placeholder={<IconLinkOutline14 />}
    className={clsx(styles.logo, className)}
    imgClassName={styles.img}
    skeletonClassName={styles.placeholder}
    placeholderClassName={clsx(styles.placeholder, styles.iconPlaceholder)}
    style={style}
  />
)

/** 搜索结果前 4 个站点的重叠缩略图 */
export const SiteThumbnails = ({ sources }: { sources: Source[] }) => (
  <span className={styles.group}>
    {sources.slice(0, 4).map((source) => (
      <SiteLogo key={source.url} url={source.siteIcon} className={styles.thumbnail} />
    ))}
  </span>
)

/* ============================================================================
 * 功能区：搜索与引用 / SiteLogo 结束
 * ========================================================================== */
