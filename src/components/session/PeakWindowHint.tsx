/* ============================================================================
 * 功能区：视图与交互 / PeakWindowHint
 * 职责：PeakWindowHint 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 实现：PeakWindowHint
 * 关联：依赖 components/session/PeakWindowHint.module、services/peak；
 *    被 components/session/Welcome 引用。
 * 导出：PeakWindowHint
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useEffect, useState } from 'react'
import { getPeakHint } from '../../services/peak.js'
import styles from './PeakWindowHint.module.css'

/* ---- 01 实现：PeakWindowHint ---- */
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

/* ============================================================================
 * 功能区：会话主视图 / PeakWindowHint 结束
 * ========================================================================== */
