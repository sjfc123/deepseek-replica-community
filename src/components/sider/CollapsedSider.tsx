/* ============================================================================
 * 功能区：视图与交互 / CollapsedSider
 * 职责：CollapsedSider 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：CollapsedSider
 * 关联：依赖 components/base/IconButton、components/base/icons、components/sider/Sider.module、i18n/index 等 6 个模块；
 *    被 app/App 引用。
 * 导出：CollapsedSider
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { IconPanelLeftOutline16, NewChatIcon } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import styles from './Sider.module.css'

/* ---- 01 实现：CollapsedSider ---- */
/** 收起后左上角的按钮组 */
export const CollapsedSider = () => {
  const t = useTranslate()
  return (
    <div className={styles.collapsed}>
      <div className={styles.collapsedGroup}>
        <IconButton
          size="m"
          tone="primary"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('expandSiderbarButton')}
          onClick={() => setSiderCollapsed(false)}
        />
        <IconButton
          size="m"
          tone="primary"
          icon={<NewChatIcon />}
          tooltip={t('newChat')}
          onClick={newChat}
        />
      </div>
    </div>
  )
}

/* ============================================================================
 * 功能区：侧栏与会话管理 / CollapsedSider 结束
 * ========================================================================== */
