/* ============================================================================
 * 功能区：视图与交互 / SearchPanel
 * 职责：SearchPanel 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：SearchPanel
 * 关联：依赖 app/android、components/base/IconButton、components/base/icons、components/search/AndroidSearchPanel 等 8 个模块；
 *    被 app/App 引用。
 * 导出：SearchPanel
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { android } from '../../app/android.js'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { closeSearchPanel, useSearchPanel } from './searchPanelState.js'
import { SourceCard } from './SourceCard.js'
import { AndroidSearchPanel } from './AndroidSearchPanel.js'
import styles from './SearchPanel.module.css'

/* ---- 01 实现：SearchPanel ---- */
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
