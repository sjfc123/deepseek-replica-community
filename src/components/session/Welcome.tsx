import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { android } from '../../app/android.js'
import whale from '../../assets/deepseek-whale.svg'
import { getPeakHint } from '../../services/peak.js'
import {
  useAndroidColdStartGreeting,
  useAndroidWelcomeMessages,
  useTranslate,
  type TranslationKey,
} from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import { PeakWindowHint } from './PeakWindowHint.js'
import styles from './Welcome.module.css'

let coldStartGreetingPending = true

const WHALE_RANDOM_LINES = [
  'whaleLinePhase1',
  'whaleLinePhase2',
  'whaleLinePhase3',
  'whaleLineTease1',
  'whaleLineTease2',
  'whaleLineTease3',
  'whaleLineTease4',
  'whaleLineTease5',
  'whaleLineTease6',
  'whaleLineTease7',
] as const satisfies readonly TranslationKey[]

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const coldStartGreeting = useAndroidColdStartGreeting()
  const androidMessages = useAndroidWelcomeMessages()
  const [coldStart] = useState(coldStartGreetingPending)
  const [peak, setPeak] = useState(() => getPeakHint().peak)
  const [manualGreeting, setManualGreeting] = useState(false)
  const whaleClicks = useRef(0)
  const whaleLastClick = useRef(0)
  const whaleSilent = useRef(false)
  const whaleLastLine = useRef(-1)
  const [greeting, setGreeting] = useState(() => {
    if (!android) {
      return t('welcomeMessageChat250808')
    }
    if (coldStart) {
      return t(peak ? 'peakWelcomeMessage' : 'offpeakWelcomeMessage')
    }
    return androidMessages[Math.floor(Math.random() * androidMessages.length)]
  })

  useEffect(() => {
    if (android) {
      coldStartGreetingPending = false
    }
  }, [])

  const handleWhaleClick = () => {
    if (whaleSilent.current) {
      return
    }
    const now = Date.now()
    if (now - whaleLastClick.current > 500) {
      whaleClicks.current = 0
      whaleLastLine.current = -1
    }
    whaleLastClick.current = now
    whaleClicks.current += 1
    setManualGreeting(true)
    if (whaleClicks.current === 1) {
      setGreeting(coldStartGreeting)
      return
    }
    if (whaleClicks.current > 5) {
      whaleSilent.current = true
      return
    }
    let index = Math.floor(Math.random() * WHALE_RANDOM_LINES.length)
    if (index === whaleLastLine.current) {
      index = (index + 1 + Math.floor(Math.random() * (WHALE_RANDOM_LINES.length - 1))) %
        WHALE_RANDOM_LINES.length
    }
    whaleLastLine.current = index
    setGreeting(
      t(WHALE_RANDOM_LINES[index], {
        phase: t(peak ? 'peakHoursShort' : 'offpeakHoursShort'),
      })
    )
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
              className={styles.whaleButton}
              aria-label={t('whaleInteraction')}
              title={t('whaleInteraction')}
              onClick={handleWhaleClick}
            >
              <img src={whale} alt="" />
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
        {isMobile && !android ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
