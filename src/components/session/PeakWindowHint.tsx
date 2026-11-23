import { useEffect, useState } from 'react'
import { getPeakHint } from '../../services/peak.js'
import styles from './PeakWindowHint.module.css'

/**
 * 冷启动问候语下方的计费时段提示。
 * 只读本地时间，不发请求；每 30 秒刷新一次，回到前台时立刻重算。
 */
export const PeakWindowHint = () => {
  const [hint, setHint] = useState(() => getPeakHint())

  useEffect(() => {
    const refresh = () => setHint(getPeakHint())
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
    <div className={styles.hint} data-phase={hint.peak ? 'peak' : 'offpeak'}>
      <div className={styles.phaseLine}>
        <span className={styles.dot} />
        <span className={styles.phase}>{hint.phaseLabel}</span>
        <span className={styles.now}>{hint.nowLabel}</span>
      </div>
      <div className={styles.detail}>
        <span>{hint.nextLabel}</span>
        <span className={styles.range}>{hint.rangeLabel}</span>
      </div>
    </div>
  )
}
