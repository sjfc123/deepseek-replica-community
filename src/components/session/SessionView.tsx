/* ============================================================================
 * 功能区：视图与交互 / SessionView
 * 职责：SessionView 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：SessionView
 * 关联：依赖 app/android、app/viewport、components/chatInput/ChatInput、components/memory/MemoryChip 等 13 个模块；
 *    被 app/App 引用。
 * 导出：SessionView
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import clsx from 'clsx'
import { memo, useMemo } from 'react'
import { android } from '../../app/android.js'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { activeMemoryCards } from '../../services/chat/memory.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { openMemoryPanel, useMemoryPanel } from '../memory/memoryPanelState.js'
import { MemoryPanel } from '../memory/MemoryPanel.js'
import { MemoryChip } from '../memory/MemoryChip.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/* ---- 01 实现：SessionView ---- */
/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = memo(function SessionView({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  const memoryOpen = useMemoryPanel((state) => state.open)
  // 顶栏胶囊只统计真正会进对话的卡片，已归档或被关闭的不算
  const memoryCount = useMemo(() => {
    const messages = getVisibleMessages(session)
    return activeMemoryCards(session, messages).length
  }, [session])
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader
          title={title}
          onOpenMemory={openMemoryPanel}
          memoryCount={memoryCount}
          streaming={streaming}
        />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          <MemoryChip
            count={memoryCount}
            onClick={openMemoryPanel}
            className={styles.memoryButton}
          />
        </div>
      )}
      {memoryOpen ? <MemoryPanel session={session} /> : null}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer} data-side-shift={android ? 'center' : undefined}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveatSlot}>
              <div className={styles.caveat}>
                {t(android ? 'androidContentCaveat' : 'contentCaveat')}
              </div>
            </div>
          </div>
        }
      />
    </div>
  )
})

/* ============================================================================
 * 功能区：会话主视图 / SessionView 结束
 * ========================================================================== */
