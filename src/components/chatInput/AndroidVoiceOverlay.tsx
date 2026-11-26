/* ============================================================================
 * 功能区：视图与交互 / AndroidVoiceOverlay
 * 职责：AndroidVoiceOverlay 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、契约与依赖；02 对外入口与收尾
 * 关联：依赖 components/chatInput/AndroidVoiceOverlay.module、components/chatInput/voiceMaskShader、components/messages/spring、i18n/index；
 *    被 components/chatInput/ChatInput 引用。
 * 导出：AndroidVoiceOverlay
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { prefersReducedMotion } from '../messages/spring.js'
import {
  createVoiceMaskRenderer,
  type VoiceMaskRenderer,
  type VoiceTouchPoint,
} from './voiceMaskShader.js'
import styles from './AndroidVoiceOverlay.module.css'

/* ---- 01 类型、契约与依赖 ---- */
const bars = Array.from({ length: 48 }, (_, index) => index)
const EXIT_FADE_MS = 180

/* ---- 02 对外入口与收尾 ---- */
export const AndroidVoiceOverlay = ({
  active,
  canceling,
  level,
  touch,
}: {
  active: boolean
  canceling: boolean
  level: () => number
  touch: RefObject<VoiceTouchPoint | null>
}) => {
  const t = useTranslate()
  const overlayRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const waveform = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<VoiceMaskRenderer | null>(null)
  const shaderCheckedRef = useRef(false)
  const [shaderReady, setShaderReady] = useState(false)
  const [keepAlive, setKeepAlive] = useState(false)
  const activeRef = useRef(active)
  activeRef.current = active
  const cancelingRef = useRef(canceling)
  cancelingRef.current = canceling

  useEffect(() => {
    if (active) {
      setKeepAlive(true)
      rendererRef.current?.reset(touch.current, window.devicePixelRatio || 1)
      return
    }
    const timer = window.setTimeout(() => setKeepAlive(false), EXIT_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [active, touch])

  useEffect(
    () => () => {
      rendererRef.current?.destroy()
      rendererRef.current = null
      shaderCheckedRef.current = false
    },
    []
  )

  useEffect(() => {
    const overlay = overlayRef.current
    if (!keepAlive || !overlay) {
      return
    }
    const canvas = canvasRef.current
    if (canvas && !shaderCheckedRef.current) {
      shaderCheckedRef.current = true
      const created = createVoiceMaskRenderer(canvas)
      rendererRef.current = created
      setShaderReady(Boolean(created))
      if (created && activeRef.current) {
        created.reset(touch.current, window.devicePixelRatio || 1)
      }
    }
    const renderer = rendererRef.current

    const elements = waveform.current
      ? (Array.from(waveform.current.children) as HTMLElement[])
      : []
    const samples = new Float32Array(elements.length / 2)
    let lastSample = 0
    let lastTime = performance.now()
    let frame = 0

    const draw = (now: number) => {
      const dt = Math.max(0, Math.min(0.1, (now - lastTime) / 1000))
      lastTime = now
      const currentLevel = activeRef.current ? level() : 0
      const currentTouch = touch.current

      if (elements.length > 0 && now - lastSample >= 26) {
        lastSample = now
        samples.copyWithin(1, 0, -1)
        samples[0] = currentLevel
      }
      for (let index = 0; index < elements.length; index++) {
        const distance = Math.abs(index - (elements.length - 1) / 2)
        const amplitude = samples[Math.floor(distance)] * Math.pow(1 - distance / 24, 2)
        elements[index].style.transform = `scaleY(${1 + amplitude * 4.9})`
      }

      if (renderer && canvas) {
        const rect = overlay.getBoundingClientRect()
        const fullHeight = Math.max(1, rect.bottom)
        const ok = renderer.render({
          dt,
          audioLevel: currentLevel,
          canceling: cancelingRef.current,
          touch: currentTouch,
          dark: document.body.hasAttribute('data-ds-dark-theme'),
          reducedMotion: prefersReducedMotion(),
          fullWidth: Math.max(1, rect.width || window.innerWidth),
          fullHeight,
          canvasHeight: Math.max(1, rect.height),
          dpr: window.devicePixelRatio || 1,
        })
        if (!ok) {
          renderer.destroy()
          rendererRef.current = null
          setShaderReady(false)
        }
      } else {
        // WebGL 不可用时的 CSS 降级：同步手指坐标驱动径向光晕
        if (currentTouch) {
          const rect = overlay.getBoundingClientRect()
          overlay.style.setProperty('--voice-touch-x', `${currentTouch.x - rect.left}px`)
          overlay.style.setProperty('--voice-touch-y', `${currentTouch.y - rect.top}px`)
          overlay.dataset.touchActive = 'true'
        } else {
          delete overlay.dataset.touchActive
        }
      }

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [keepAlive, level, touch])

  return createPortal(
    <div
      ref={overlayRef}
      className={styles.overlay}
      data-recording={active}
      data-canceling={canceling}
      data-shader={shaderReady ? 'true' : undefined}
      aria-hidden={!active}
    >
      <div className={styles.backdrop} aria-hidden="true" />
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      <div className={styles.color} data-color="blue" />
      <div className={styles.color} data-color="red" />
      <div className={styles.fallbackHalo} aria-hidden="true" />
      <div className={styles.hint} role="status">
        {t(canceling ? 'androidReleaseToCancel' : 'androidSlideToCancel')}
      </div>
      <div className={styles.wave} ref={waveform} aria-hidden="true">
        {bars.map((index) => (
          <span key={index} />
        ))}
      </div>
    </div>,
    document.body
  )
}

/* ============================================================================
 * 功能区：输入与语音控件 / AndroidVoiceOverlay 结束
 * ========================================================================== */
