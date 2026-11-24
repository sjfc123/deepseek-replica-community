/* ============================================================================
 * 功能区：消息渲染 / JumpToBottomButton 开始
 * 职责：JumpToBottomButton 组件，负责该组件的渲染、状态与交互出口。
 * 导出：JumpToBottomButton。
 * ========================================================================== */

import clsx from 'clsx'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconChevronDownOutline20 } from '../base/icons.js'
import styles from './JumpToBottomButton.module.css'
import { prefersReducedMotion, stepCriticallyDampedSpring, type SpringState } from './spring.js'

const BUTTON_STIFFNESS = 1500
const BUTTON_SLIDE_OFFSET = 17
const HALO_CYCLE_MS = 2000
const HALO_UNMOUNT_DELAY_MS = 220

const applyButtonVisual = (el: HTMLButtonElement, progress: number) => {
  const clamped = Math.max(0, Math.min(1, progress))
  el.style.opacity = String(Number(clamped.toFixed(4)))
  el.style.transform = `translate3d(0, ${((1 - clamped) * BUTTON_SLIDE_OFFSET).toFixed(3)}px, 0)`
}

const isButtonSettled = (state: SpringState, target: number) =>
  Math.abs(target - state.value) < 0.001 && Math.abs(state.velocity) < 0.005

/** 流式回复期间显示在回到底部按钮外圈的旋转渐变光环（4 象限 SVG 以兼容 WebView 74） */
const HaloRing = ({ visible }: { visible: boolean }) => {
  const rawId = useId().replace(/:/g, '')
  const [animationDelay] = useState(() => `-${(performance.now() % HALO_CYCLE_MS).toFixed(1)}ms`)
  const q1Id = `halo-q1-${rawId}`
  const q2Id = `halo-q2-${rawId}`
  const q3Id = `halo-q3-${rawId}`
  const q4Id = `halo-q4-${rawId}`

  return (
    <span className={clsx(styles.halo, visible && styles.haloVisible)} aria-hidden="true">
      <svg
        className={styles.haloSvg}
        style={{ animationDelay }}
        width={34}
        height={34}
        viewBox="0 0 34 34"
        fill="none"
        overflow="visible"
      >
        <defs>
          <linearGradient
            id={q1Id}
            gradientUnits="userSpaceOnUse"
            x1="33.75"
            y1="17"
            x2="17"
            y2="33.75"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient
            id={q2Id}
            gradientUnits="userSpaceOnUse"
            x1="17"
            y1="33.75"
            x2="0.25"
            y2="17"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.7" />
          </linearGradient>
          <linearGradient
            id={q3Id}
            gradientUnits="userSpaceOnUse"
            x1="0.25"
            y1="17"
            x2="17"
            y2="0.25"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.7" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.85" />
          </linearGradient>
          <linearGradient
            id={q4Id}
            gradientUnits="userSpaceOnUse"
            x1="17"
            y1="0.25"
            x2="33.75"
            y2="17"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.85" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
          </linearGradient>
        </defs>
        <path
          d="M 33.75 17 A 16.75 16.75 0 0 1 17 33.75"
          stroke={`url(#${q1Id})`}
          strokeWidth="1.5"
        />
        <path
          d="M 17 33.75 A 16.75 16.75 0 0 1 0.25 17"
          stroke={`url(#${q2Id})`}
          strokeWidth="1.5"
        />
        <path
          d="M 0.25 17 A 16.75 16.75 0 0 1 17 0.25"
          stroke={`url(#${q3Id})`}
          strokeWidth="1.5"
        />
        <path
          d="M 17 0.25 A 16.75 16.75 0 0 1 33.75 17"
          stroke={`url(#${q4Id})`}
          strokeWidth="1.5"
        />
        <circle cx="33.75" cy="17" r="0.75" fill="currentColor" />
      </svg>
    </span>
  )
}

/** 复刻官方客户端右下角「回到底部」悬浮按钮（含临界阻尼弹簧出入场与流式旋转光环） */
export const JumpToBottomButton = ({
  visible,
  streaming,
  resetKey,
  onClick,
}: {
  visible: boolean
  streaming: boolean
  resetKey: string
  onClick: () => void
}) => {
  const t = useTranslate()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [prevResetKey, setPrevResetKey] = useState(resetKey)
  const [mounted, setMounted] = useState(visible)

  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey)
    setMounted(visible)
  } else if (visible && !mounted) {
    setMounted(true)
  }

  const appliedResetKeyRef = useRef(resetKey)
  const springRef = useRef<SpringState>({ value: visible ? 1 : 0, velocity: 0 })
  const frameRef = useRef(0)

  const [haloMounted, setHaloMounted] = useState(mounted && streaming)
  const [haloVisible, setHaloVisible] = useState(mounted && streaming)
  const prevMountedRef = useRef(mounted)
  const haloMountedRef = useRef(haloMounted)
  haloMountedRef.current = haloMounted
  const haloFrameRef = useRef(0)
  const haloTimerRef = useRef(0)

  useLayoutEffect(() => {
    if (appliedResetKeyRef.current !== resetKey) {
      appliedResetKeyRef.current = resetKey
      springRef.current = { value: visible ? 1 : 0, velocity: 0 }
    }
    cancelAnimationFrame(frameRef.current)
    frameRef.current = 0
    const el = buttonRef.current
    if (!mounted || !el) {
      return
    }

    const target = visible ? 1 : 0
    if (prefersReducedMotion() || isButtonSettled(springRef.current, target)) {
      springRef.current = { value: target, velocity: 0 }
      applyButtonVisual(el, target)
      if (target === 0) {
        setMounted(false)
      }
      return
    }

    applyButtonVisual(el, springRef.current.value)
    let lastTime = performance.now()
    let frames = 0
    const step = (now: number) => {
      frames += 1
      const stepTime = now > lastTime ? now : lastTime
      const dt = Math.min(0.05, (stepTime - lastTime) / 1000)
      lastTime = stepTime
      const next = stepCriticallyDampedSpring(springRef.current, target, BUTTON_STIFFNESS, dt)
      springRef.current = next
      if (isButtonSettled(next, target) || frames > 900) {
        springRef.current = { value: target, velocity: 0 }
        applyButtonVisual(el, target)
        frameRef.current = 0
        if (target === 0) {
          setMounted(false)
        }
        return
      }
      applyButtonVisual(el, next.value)
      frameRef.current = requestAnimationFrame(step)
    }

    frameRef.current = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
  }, [visible, mounted, resetKey])

  useLayoutEffect(() => {
    window.clearTimeout(haloTimerRef.current)
    cancelAnimationFrame(haloFrameRef.current)
    haloFrameRef.current = 0

    if (!mounted) {
      prevMountedRef.current = false
      setHaloMounted(false)
      setHaloVisible(false)
      return
    }

    const justMounted = !prevMountedRef.current
    prevMountedRef.current = true

    if (streaming) {
      if (justMounted || haloMountedRef.current || prefersReducedMotion()) {
        setHaloMounted(true)
        setHaloVisible(true)
      } else {
        // 先以 opacity: 0 挂载光环并绘制一帧，再触发 200ms 线性交叉淡入
        setHaloMounted(true)
        setHaloVisible(false)
        haloFrameRef.current = requestAnimationFrame(() => {
          haloFrameRef.current = requestAnimationFrame(() => {
            haloFrameRef.current = 0
            setHaloVisible(true)
          })
        })
      }
      return () => {
        window.clearTimeout(haloTimerRef.current)
        cancelAnimationFrame(haloFrameRef.current)
        haloFrameRef.current = 0
      }
    }

    setHaloVisible(false)
    if (prefersReducedMotion()) {
      setHaloMounted(false)
    } else if (haloMountedRef.current) {
      haloTimerRef.current = window.setTimeout(() => {
        setHaloMounted(false)
      }, HALO_UNMOUNT_DELAY_MS)
    }

    return () => {
      window.clearTimeout(haloTimerRef.current)
      cancelAnimationFrame(haloFrameRef.current)
      haloFrameRef.current = 0
    }
  }, [mounted, streaming])

  if (!mounted) {
    return null
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      className={clsx(styles.button, !visible && styles.hidden, haloVisible && styles.streaming)}
      aria-label={t('jumpToBottom')}
      aria-hidden={!visible}
      tabIndex={-1}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (visible) {
          onClick()
        }
      }}
    >
      <span className={styles.pressOverlay} aria-hidden="true" />
      <span className={styles.border} aria-hidden="true" />
      {haloMounted ? <HaloRing visible={haloVisible} /> : null}
      <span className={styles.icon} aria-hidden="true">
        <IconChevronDownOutline20 />
      </span>
    </button>
  )
}

/* ============================================================================
 * 功能区：消息渲染 / JumpToBottomButton 结束
 * ========================================================================== */
