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

/** 一轮台词播完后的短暂冷却；冷却结束重新洗牌，不从“永久静音”状态卡住 */
const WHALE_CYCLE_COOLDOWN_MS = 360

/** 随机牌堆：每张台词一轮只出现一次，用完再重新洗牌 */
const shuffleWhaleDeck = (exclude: number) => {
  const deck = WHALE_RANDOM_LINES.map((_, index) => index)
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

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const coldStartGreeting = useAndroidColdStartGreeting()
  const androidMessages = useAndroidWelcomeMessages()
  const [coldStart] = useState(coldStartGreetingPending)
  const [peak, setPeak] = useState(() => getPeakHint().peak)
  const [manualGreeting, setManualGreeting] = useState(false)
  const whaleDeck = useRef<number[]>([])
  const whaleDeckPos = useRef(0)
  const whaleCooldownUntil = useRef(0)
  const whaleFirstClick = useRef(true)
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
    const now = Date.now()
    setManualGreeting(true)
    if (whaleFirstClick.current) {
      whaleFirstClick.current = false
      setGreeting(coldStartGreeting)
      return
    }
    if (whaleDeckPos.current >= whaleDeck.current.length) {
      if (now < whaleCooldownUntil.current) {
        // 冷却期只限制“重新洗牌”，不吞掉点击：快速点击仍然继续换一句
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
        return
      }
      whaleDeck.current = shuffleWhaleDeck(whaleLastLine.current)
      whaleDeckPos.current = 0
    }
    const pointer = whaleDeckPos.current
    let index = whaleDeck.current[pointer]
    // 牌堆相邻两张不重复；单次点击也一定换成另一句
    if (index === whaleLastLine.current) {
      const alternate = whaleDeck.current.findIndex(
        (line, position) => position >= pointer && line !== whaleLastLine.current
      )
      if (alternate >= 0) {
        const swap = whaleDeck.current[alternate]
        whaleDeck.current[alternate] = whaleDeck.current[pointer]
        whaleDeck.current[pointer] = swap
        index = swap
      }
    }
    whaleDeckPos.current = pointer + 1
    whaleLastLine.current = index
    setGreeting(
      t(WHALE_RANDOM_LINES[index], {
        phase: t(peak ? 'peakHoursShort' : 'offpeakHoursShort'),
      })
    )
    if (whaleDeckPos.current >= whaleDeck.current.length) {
      whaleCooldownUntil.current = now + WHALE_CYCLE_COOLDOWN_MS
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
