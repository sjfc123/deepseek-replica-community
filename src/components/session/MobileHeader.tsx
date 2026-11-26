/* ============================================================================
 * 功能区：会话主视图 / MobileHeader 开始
 * 职责：MobileHeader 组件，负责该组件的渲染、状态与交互出口。
 * 导出：MobileHeader。
 * ========================================================================== */

import { useEffect, useState } from 'react'
import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { MemoryChip } from '../memory/MemoryChip.js'
import { useTranslate } from '../../i18n/index.js'
import { android } from '../../app/android.js'
import { useIsAndroidWide } from '../../app/viewport.js'
import { newChat, useChatStore } from '../../services/chat/store.js'
import { setAutoRead, useSettings } from '../../services/settings.js'
import { stopReadAloud, useReadAloud } from '../../services/speech/readAloud.js'
import { AndroidSound } from '../base/AndroidIcons.js'
import { IconButton } from '../base/IconButton.js'
import { showToast, useToast } from '../base/toastState.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import {
  endVoiceCall,
  ensureMicrophonePermission,
  prepareVoiceCall,
  primeVoiceCallAudio,
  startVoiceCall,
  useVoiceCall,
} from '../../services/speech/voiceCall.js'
import { openMobileSider, toggleMobileSider, useMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/** 移动端顶栏：左侧菜单打开或切换侧边栏；会话页再显示标题与开启新对话 */
export const MobileHeader = ({
  title,
  onOpenMemory,
  memoryCount = 0,
  streaming = false,
}: {
  title?: string
  onOpenMemory?: () => void
  memoryCount?: number
  streaming?: boolean
}) => {
  const t = useTranslate()
  const androidWide = useIsAndroidWide()
  const drawerOpen = useMobileSider((state) => state.open)
  const autoRead = useSettings((state) => state.autoRead)
  const readStatus = useReadAloud((state) => state.status)
  const reading = readStatus !== 'idle'
  const activeId = useChatStore((state) => state.activeId)
  const [callPending, setCallPending] = useState(false)
  const memoryBadge = useSettings((state) => state.memoryBadge)
  // 有新卡片写入时换一个 key 重新挂载胶囊，让弹动动画重播
  const [pulseKey, setPulseKey] = useState(0)
  useEffect(() => {
    const onAdded = () => setPulseKey((value) => value + 1)
    window.addEventListener('replica:memory-added', onAdded)
    return () => window.removeEventListener('replica:memory-added', onAdded)
  }, [])
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        className={styles.menu}
        data-side-shift={android ? 'edge' : undefined}
        icon={<IconMenuOutline20 />}
        aria-label={t(
          androidWide && drawerOpen ? 'collapseSiderbarButton' : 'expandSiderbarButton'
        )}
        aria-expanded={androidWide ? drawerOpen : undefined}
        onClick={androidWide ? toggleMobileSider : openMobileSider}
      />
      {android && !streaming ? (
        <button
          type="button"
          className={styles.call}
          aria-label="语音通话"
          aria-busy={callPending}
          data-pending={callPending ? 'true' : undefined}
          onClick={() => {
            if (callPending) {
              return
            }
            if (!ensureApiKey(true)) {
              showToast('需要先填写 API Key 才能通话')
              return
            }
            setCallPending(true)
            // 必须在点击手势里先把播放上下文建好；等授权回来再建会被系统判成非用户触发。
            primeVoiceCallAudio()
            // 先挂出通话页，授权提示出现在通话页之上，而不是停在聊天页干等。
            prepareVoiceCall(activeId ?? null)
            void ensureMicrophonePermission()
              .then((allowed) => {
                if (!allowed) {
                  if (useVoiceCall.getState().active) {
                    endVoiceCall()
                    showToast('麦克风不可用：请检查系统录音权限后重试')
                  }
                  return
                }
                // 用户在授权期间已关闭通话页时不再启动采集。
                if (!useVoiceCall.getState().active) {
                  return
                }
                // 没有活动会话也允许直接开麦；首条转写会新建会话，标题取这段内容。
                startVoiceCall(activeId ?? null)
              })
              .catch((error: unknown) => {
                if (useVoiceCall.getState().active) {
                  endVoiceCall()
                  showToast(
                    `打开通话失败：${error instanceof Error ? error.message : String(error)}`,
                  )
                }
              })
              .finally(() => setCallPending(false))
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M5.4 3.2c.6-.6 1.6-.5 2.1.2l1.8 2.6c.4.6.3 1.4-.2 1.9l-1 1c.8 1.7 2.3 3.2 4 4l1-1c.5-.5 1.3-.6 1.9-.2l2.6 1.8c.7.5.8 1.5.2 2.1l-1.4 1.4c-.6.6-1.5.8-2.3.5-4.8-1.9-8.6-5.7-10.5-10.5-.3-.8-.1-1.7.5-2.3L5.4 3.2Z" />
          </svg>
        </button>
      ) : null}
      {title === undefined && !android ? null : (
        <>
          {title === undefined ? null : (
            <div className={styles.title} data-side-shift={android ? 'edge' : undefined}>
              <span className={styles.titleText}>{title}</span>
            </div>
          )}
          {onOpenMemory && memoryBadge ? (
            <span className={styles.memorySlot} key={pulseKey}>
              <MemoryChip count={memoryCount} onClick={onOpenMemory} pulse={pulseKey > 0} />
            </span>
          ) : null}
          <IconButton
            size="xl"
            tone="primary"
            className={styles.newChat}
            icon={<IconNewChatOutline20 />}
            aria-label={t('newChat')}
            onClick={() => {
              if (android && activeId === null) {
                const current = useToast.getState().message
                if (typeof current !== 'string' && current?.key === 'androidAlreadyInNewChat') {
                  return
                }
                showToast({ key: 'androidAlreadyInNewChat' }, 2130)
                return
              }
              newChat()
            }}
          />
          {android ? (
            <IconButton
              size="xl"
              tone="primary"
              className={styles.sound}
              data-read-state={reading ? readStatus : undefined}
              icon={<AndroidSound muted={!autoRead && !reading} />}
              aria-label={t('androidAutoRead')}
              aria-pressed={autoRead}
              onClick={() => {
                setAutoRead(!autoRead)
                if (autoRead) {
                  stopReadAloud()
                }
                showToast({ key: autoRead ? 'androidAutoReadDisabled' : 'androidAutoReadEnabled' })
              }}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

/* ============================================================================
 * 功能区：会话主视图 / MobileHeader 结束
 * ========================================================================== */
