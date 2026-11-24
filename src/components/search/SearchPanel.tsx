/* ============================================================================
 * 功能区：搜索与引用 / SearchPanel 开始
 * 职责：SearchPanel 组件，负责该组件的渲染、状态与交互出口。
 * 导出：SearchPanel。
 * ========================================================================== */

import { android } from '../../app/android.js'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { closeSearchPanel, useSearchPanel } from './searchPanelState.js'
import { SourceCard } from './SourceCard.js'
import { AndroidSearchPanel } from './AndroidSearchPanel.js'
import styles from './SearchPanel.module.css'

/** 右侧「搜索结果」面板 */
export const SearchPanel = () => {
  const t = useTranslate()
  const entry = useSearchPanel((state) => state.entry)
  const sources = useSearchPanel((state) => state.sources)
  if (android) {
    return <AndroidSearchPanel />
  }
  if (!entry) {
    return null
  }
  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <div role="heading" className={styles.title}>
          {t('searchResult')}
        </div>
        <IconButton
          icon={<IconCloseOutline16 />}
          aria-label={t('close')}
          onClick={closeSearchPanel}
        />
      </div>
      <div className={styles.content}>
        {sources.map((source) => (
          <SourceCard key={source.url} source={source} className={styles.item} />
        ))}
      </div>
    </aside>
  )
}

/* ============================================================================
 * 功能区：搜索与引用 / SearchPanel 结束
 * ========================================================================== */
