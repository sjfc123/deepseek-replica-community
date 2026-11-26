/* ============================================================================
 * 功能区：视图与交互 / Welcome
 * 职责：Welcome 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、常量与模块依赖；02 功能实现（Welcome）
 * 关联：依赖 app/android、app/viewport、components/base/icons、components/chatInput/ChatInput 等 13 个模块；
 *    被 app/App 引用。
 * 导出：Welcome
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { android } from '../../app/android.js'
import fatFishIcon from '../../assets/dafeiyu-icon.png'
import { getPeakHint } from '../../services/peak.js'
import { selectSession, useChatStore } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import {
  useAndroidWelcomeMessages,
  useTranslate,
  type TranslationKey,
} from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { IconChevronRightOutline14 } from '../base/icons.js'
import { FeatureIcon } from '../settings/FeatureIcon.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { MobileHeader } from './MobileHeader.js'
import { PeakWindowHint } from './PeakWindowHint.js'
import styles from './Welcome.module.css'

/* ---- 01 类型、常量与模块依赖 ---- */
let coldStartGreetingPending = true

const FAT_FISH_RANDOM_LINES = [
  'fatFishLinePhase1',
  'fatFishLinePhase2',
  'fatFishLinePhase3',
  'fatFishLineTease1',
  'fatFishLineTease2',
  'fatFishLineTease3',
  'fatFishLineTease4',
  'fatFishLineTease5',
  'fatFishLineTease6',
  'fatFishLineTease7',
  'fatFishLineTease8',
  'fatFishLineTease9',
  'fatFishLineTease10',
] as const satisfies readonly TranslationKey[]

/** 一轮台词播完后的短暂冷却；冷却结束重新洗牌，不从“永久静音”状态卡住 */
const FAT_FISH_CYCLE_COOLDOWN_MS = 360

/** 随机牌堆：每张台词一轮只出现一次，用完再重新洗牌 */
const shuffleFatFishDeck = (exclude: number) => {
  const deck = FAT_FISH_RANDOM_LINES.map((_, index) => index)
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = deck[i]
    deck[i] = deck[j]
    deck[j] = swap
  }
  if (deck.length > 1 && deck[0] === exclude) {
    const swap = deck[0]
    deck[0] = deck[1]
    deck[1] = swap
  }
  return deck
}

/* ---- 02 功能实现（Welcome） ---- */
/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const sessions = useChatStore((state) => state.sessions)
  const archivedSessions = useSettings((state) => state.archivedSessions)
  const apiKey = useSettings((state) => state.apiKey)
  const chatConfig = useSettings((state) => state.chatConfig)
  const androidMessages = useAndroidWelcomeMessages()
  const [coldStart] = useState(coldStartGreetingPending)
  const [peak, setPeak] = useState(() => getPeakHint().peak)
  const [manualGreeting, setManualGreeting] = useState(false)
  const fatFishDeck = useRef<number[]>([])
  const fatFishDeckPos = useRef(0)
  const fatFishCooldownUntil = useRef(0)
  const fatFishFirstClick = useRef(true)
  const fatFishLastLine = useRef(-1)
  const [greeting, setGreeting] = useState(() => {
    if (!android) {
      return t('welcomeMessageChat250808')
    }
    if (coldStart) {
      return t(peak ? 'peakWelcomeMessage' : 'offpeakWelcomeMessage')
    }
    return androidMessages[Math.floor(Math.random() * androidMessages.length)]
  })

  const recentSessions = sessions
    .filter((session) => !archivedSessions.includes(session.id))
    .slice(0, 3)
  const configured = Boolean(apiKey || chatConfig.endpoint)
  const modelLabel = configured
    ? chatConfig.model || t('welcomeApiConfigured')
    : t('welcomeApiNotConfigured')

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

  const handleFatFishClick = () => {
    const now = Date.now()
    setManualGreeting(true)
    if (fatFishFirstClick.current) {
      fatFishFirstClick.current = false
      setGreeting(t('fatFishLineFirst'))
      return
    }
    if (fatFishDeckPos.current >= fatFishDeck.current.length) {
      if (now < fatFishCooldownUntil.current) {
        // 冷却期只限制“重新洗牌”，不吞掉点击：快速点击仍然继续换一句
        let index = Math.floor(Math.random() * FAT_FISH_RANDOM_LINES.length)
        if (index === fatFishLastLine.current) {
          index =
            (index + 1 + Math.floor(Math.random() * (FAT_FISH_RANDOM_LINES.length - 1))) %
            FAT_FISH_RANDOM_LINES.length
        }
        fatFishLastLine.current = index
        setGreeting(
          t(FAT_FISH_RANDOM_LINES[index], {
            phase: t(peak ? 'peakHoursShort' : 'offpeakHoursShort'),
          })
        )
        return
      }
      fatFishDeck.current = shuffleFatFishDeck(fatFishLastLine.current)
      fatFishDeckPos.current = 0
    }
    const pointer = fatFishDeckPos.current
    let index = fatFishDeck.current[pointer]
    // 牌堆相邻两张不重复；单次点击也一定换成另一句
    if (index === fatFishLastLine.current) {
      const alternate = fatFishDeck.current.findIndex(
        (line, position) => position >= pointer && line !== fatFishLastLine.current
      )
      if (alternate >= 0) {
        const swap = fatFishDeck.current[alternate]
        fatFishDeck.current[alternate] = fatFishDeck.current[pointer]
        fatFishDeck.current[pointer] = swap
        index = swap
      }
    }
    fatFishDeckPos.current = pointer + 1
    fatFishLastLine.current = index
    setGreeting(
      t(FAT_FISH_RANDOM_LINES[index], {
        phase: t(peak ? 'peakHoursShort' : 'offpeakHoursShort'),
      })
    )
    if (fatFishDeckPos.current >= fatFishDeck.current.length) {
      fatFishCooldownUntil.current = now + FAT_FISH_CYCLE_COOLDOWN_MS
    }
  }

  useEffect(() => {
    if (!android) {
      return
    }
    const refresh = () => {
      const nextPeak = getPeakHint().peak
      setPeak(nextPeak)
      if (!manualGreeting) {
        setGreeting(t(nextPeak ? 'peakWelcomeMessage' : 'offpeakWelcomeMessage'))
      }
    }
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
  }, [manualGreeting, t])

  return (
    <div className={styles.container} data-drawer-free-pan={android ? '' : undefined}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome} data-side-shift={android ? 'center' : undefined}>
        <div className={styles.greeting}>
          {android ? (
            <button
              type="button"
              className={styles.fatFishButton}
              aria-label={t('fatFishInteraction')}
              title={t('fatFishInteraction')}
              onClick={handleFatFishClick}
            >
              <img src={fatFishIcon} alt="" />
            </button>
          ) : null}
          {android ? (
            <div className={styles.greetingCopy}>
              <span className={styles.greetingText}>{greeting}</span>
              <PeakWindowHint />
            </div>
          ) : (
            greeting
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
