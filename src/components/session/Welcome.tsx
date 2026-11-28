/* ============================================================================
 * 功能区：视图与交互 / Welcome
 * 职责：Welcome 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、常量与模块依赖；02 功能实现（Welcome）
 * 关联：依赖 app/android、app/viewport、components/base/icons、components/chatInput/ChatInput 等 13 个模块；
 *    被 app/App 引用。
 * 导出：Welcome
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useEffect, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { android } from '../../app/android.js'
import fatFishIcon from '../../assets/dafeiyu-icon.png'
import { getPeakHint } from '../../services/peak.js'
import { selectSession, useChatStore } from '../../services/chat/store.js'
import { FAT_FISH_ALL_LINES } from '../../services/chat/easterEgg.js'
import { useSettings } from '../../services/settings.js'
import {
  useAndroidWelcomeMessages,
  useTranslate,
} from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { BalanceUsageAnchor } from '../balance/BalanceUsageAnchor.js'
import { IconChevronRightOutline14 } from '../base/icons.js'
import { FeatureIcon } from '../settings/FeatureIcon.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { MobileHeader } from './MobileHeader.js'
import { PeakWindowHint } from './PeakWindowHint.js'
import styles from './Welcome.module.css'

/* ---- 01 类型、常量与模块依赖 ---- */
let coldStartGreetingPending = true


/* ---- 02 功能实现（Welcome） ---- */
/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const homeLogo = useSettings((state) => state.homeLogo)
  const homeGreetings = useSettings((state) => state.homeGreetings)
  const sessions = useChatStore((state) => state.sessions)
  const archivedSessions = useSettings((state) => state.archivedSessions)
  const apiKey = useSettings((state) => state.apiKey)
  const chatConfig = useSettings((state) => state.chatConfig)
  const androidMessages = useAndroidWelcomeMessages()
  const [coldStart] = useState(coldStartGreetingPending)
  const [peak, setPeak] = useState(() => getPeakHint().peak)
  /** 主页台词池：本机保存的台词优先；没有保存过就用内置台词。 */
  const greetingPool = homeGreetings.length
    ? homeGreetings
    : FAT_FISH_ALL_LINES.map((key) =>
        t(key, { phase: t(peak ? 'peakHoursShort' : 'offpeakHoursShort') })
      )
  const [greeting, setGreeting] = useState(() => {
    if (!android) {
      return t('welcomeMessageChat250808')
    }
    if (coldStart) {
      return t(peak ? 'peakWelcomeMessage' : 'offpeakWelcomeMessage')
    }
    return greetingPool.length
      ? greetingPool[Math.floor(Math.random() * greetingPool.length)]
      : androidMessages[Math.floor(Math.random() * androidMessages.length)]
  })

  const recentSessions = sessions
    .filter((session) => !archivedSessions.includes(session.id))
    .slice(0, 3)
  const configured = Boolean(apiKey || chatConfig.endpoint)
  const modelLabel = configured
    ? chatConfig.model || t('welcomeApiConfigured')
    : t('welcomeApiNotConfigured')
  const logoSrc = homeLogo ?? fatFishIcon
  const displayGreeting = greeting
  /** 内联双语：按当前语言取中文或英文文案，避免为短文案新增字典键 */
  const tr = (chinese: string, english: string) => (locale === 'zh-CN' ? chinese : english)

  const formatRecentTime = (updatedAt: number) => {
    const date = new Date(updatedAt)
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    if (updatedAt >= startOfToday) {
      return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
    }
    if (updatedAt >= startOfToday - 86_400_000) {
      return t('sessionHistoryTimelineLabelYesterday')
    }
    return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(date)
  }

  useEffect(() => {
    if (android) {
      coldStartGreetingPending = false
    }
  }, [])

  /** 点头像只换一句：从台词池随机取，尽量避开当前这句；不再弹编辑框 */
  const showRandomGreeting = () => {
    if (!greetingPool.length) {
      return
    }
    let index = Math.floor(Math.random() * greetingPool.length)
    if (greetingPool.length > 1 && greetingPool[index] === greeting) {
      index = (index + 1) % greetingPool.length
    }
    setGreeting(greetingPool[index])
  }

  useEffect(() => {
    if (!android) {
      return
    }
    const refresh = () => setPeak(getPeakHint().peak)
    const timer = window.setInterval(refresh, 30_000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <div className={styles.container} data-drawer-free-pan={android ? '' : undefined}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome} data-side-shift={android ? 'center' : undefined}>
        <div className={styles.greeting}>
          {android ? (
            <button
              type="button"
              className={styles.fatFishButton}
              aria-label={tr('随机一句主页台词', 'Show another home line')}
              title={tr('随机一句主页台词', 'Show another home line')}
              onClick={showRandomGreeting}
            >
              <img src={logoSrc} alt="" data-custom={homeLogo ? '' : undefined} />
            </button>
          ) : null}
          <BalanceUsageAnchor session={null} context="home" layout="inline" />
          {android ? (
            <div className={styles.greetingCopy}>
              <span className={styles.greetingText}>{displayGreeting}</span>
              <PeakWindowHint />
            </div>
          ) : (
            displayGreeting
          )}
        </div>
        <ChatInput sessionId={null} />
        {!android && !isMobile ? (
          <div className={styles.desktopExtras}>
            <section className={styles.extrasPanel} aria-label={t('welcomeRecentChats')}>
              <div className={styles.extrasHeader}>
                <span>{t('welcomeRecentChats')}</span>
                {recentSessions.length > 0 ? (
                  <span className={styles.extrasCount}>{recentSessions.length}</span>
                ) : null}
              </div>
              {recentSessions.length > 0 ? (
                <div className={styles.recentList}>
                  {recentSessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className={styles.recentItem}
                      onClick={() => selectSession(session.id)}
                    >
                      <span className={styles.recentTitle}>{session.title || t('untitledChat')}</span>
                      <span className={styles.recentTime}>{formatRecentTime(session.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className={styles.recentEmpty}>{t('welcomeRecentEmpty')}</div>
              )}
            </section>
            <section className={styles.extrasPanel} aria-label={t('welcomeQuickActions')}>
              <div className={styles.extrasHeader}>
                <span>{t('welcomeQuickActions')}</span>
              </div>
              <div className={styles.quickList}>
                <button
                  type="button"
                  className={styles.quickItem}
                  onClick={() => openSettings('roleplay')}
                >
                  <span className={styles.quickIcon}>
                    <FeatureIcon label="角色卡与世界书" />
                  </span>
                  <span className={styles.quickLabel}>{t('welcomeQuickRoleplay')}</span>
                  <span className={styles.quickArrow}>
                    <IconChevronRightOutline14 />
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.quickItem}
                  onClick={() => openSettings('memory')}
                >
                  <span className={styles.quickIcon}>
                    <FeatureIcon label={t('welcomeQuickMemory')} />
                  </span>
                  <span className={styles.quickLabel}>{t('welcomeQuickMemory')}</span>
                  <span className={styles.quickArrow}>
                    <IconChevronRightOutline14 />
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.quickItem}
                  onClick={() => openSettings('data')}
                >
                  <span className={styles.quickIcon}>
                    <FeatureIcon label="DeepSeek API Key" />
                  </span>
                  <span className={styles.quickLabel}>{t('welcomeQuickApi')}</span>
                  <span
                    className={styles.apiStatus}
                    data-configured={configured ? '' : undefined}
                    title={modelLabel}
                  >
                    {modelLabel}
                  </span>
                  <span className={styles.quickArrow}>
                    <IconChevronRightOutline14 />
                  </span>
                </button>
              </div>
            </section>
          </div>
        ) : null}
        {isMobile && !android ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}

/* ============================================================================
 * 功能区：会话主视图 / Welcome 结束
 * ========================================================================== */
