import { useEffect, useRef, type PointerEvent, type RefObject } from 'react'
import { android } from '../../app/android.js'
import { closeMobileSider, openMobileSider, useMobileSider } from './mobileSiderState.js'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const touchSlop = 8
const velocityWindow = 60
const maxFlingPause = 56
const minFlingVelocity = 0.33

type Sample = { x: number; time: number }

type Gesture = {
  id: number
  x: number
  y: number
  startedOpen: boolean
  canScrollVertically: boolean
  edge: number
  start: number | null
  current: number
  samples: Sample[]
}

function recordSample(samples: Sample[], x: number, time: number) {
  if (time <= samples[samples.length - 1].time) {
    return
  }
  samples.push({ x, time })
  while (samples.length > 1 && time - samples[0].time > velocityWindow) {
    samples.shift()
  }
}

function releaseVelocity(samples: Sample[], time: number) {
  const first = samples[0]
  const last = samples[samples.length - 1]
  // 用最近一段位移估速，采样停顿以后按静止处理。
  return first !== last && time - last.time < maxFlingPause
    ? (last.x - first.x) / (last.time - first.time)
    : 0
}

export const useAndroidDrawerGesture = (
  frameRef: RefObject<HTMLDivElement | null>,
  enabled: boolean
) => {
  const gesture = useRef<Gesture | null>(null)

  useEffect(() => {
    const frame = frameRef.current
    const clearDrag = () => {
      gesture.current = null
      if (!frame) {
        return
      }
      delete frame.dataset.drawerDragging
      frame.style.removeProperty('--drawer-progress')
      frame.style.removeProperty('--drawer-radius')
    }
    if (!enabled || !frame) {
      clearDrag()
      return
    }
    // 抽屉横向拖动接管手势后阻止默认 touchmove，避免松手后 WebView 产生残留 fling 吞掉首次点击。
    const onTouchMove = (event: TouchEvent) => {
      const drag = gesture.current
      if (drag && drag.start !== null && event.cancelable) {
        event.preventDefault()
      }
    }
    frame.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
    return () => {
      clearDrag()
      frame.removeEventListener('touchmove', onTouchMove, { capture: true })
    }
  }, [enabled, frameRef])

  const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (
      !android ||
      !event.isPrimary ||
      event.pointerType === 'mouse' ||
      document.documentElement.hasAttribute('data-keyboard') ||
      target?.closest('input, textarea, [data-drawer-gesture-ignore], [data-sider-selecting]')
    ) {
      return
    }
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startedOpen: useMobileSider.getState().open,
      canScrollVertically: !target?.closest('[data-drawer-free-pan]'),
      edge: 0,
      start: null,
      current: 0,
      samples: [{ x: event.clientX, time: event.timeStamp }],
    }
  }

  const onPointerMoveCapture = (event: PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current
    if (!drag || drag.id !== event.pointerId) {
      return
    }
    const frame = event.currentTarget
    const dx = event.clientX - drag.x
    const horizontal = Math.abs(dx)
    for (const sample of event.nativeEvent.getCoalescedEvents?.() ?? []) {
      recordSample(drag.samples, sample.clientX, sample.timeStamp)
    }
    recordSample(drag.samples, event.clientX, event.timeStamp)
    let start = drag.start
    if (start === null) {
      const dy = Math.abs(event.clientY - drag.y)
      if (drag.canScrollVertically && dy >= touchSlop && dy > horizontal) {
        gesture.current = null
        return
      }
      if (horizontal <= touchSlop || (drag.canScrollVertically && horizontal < dy)) {
        return
      }
      const horizontalScroller =
        event.target instanceof Element
          ? event.target.closest(
              'pre, .markdown-table-wrapper, .ds-markdown-math, .md-mermaid-diagram'
            )
          : null
      if (horizontalScroller && horizontalScroller.scrollWidth > horizontalScroller.clientWidth) {
        gesture.current = null
        return
      }
      const drawer = frame.querySelector<HTMLElement>('[data-android-drawer]')
      const main = frame.querySelector('main')
      const edge = drawer?.getBoundingClientRect().width ?? 0
      if (!main || edge === 0) {
        gesture.current = null
        return
      }
      // 动画未结束时，从手指接管这一刻的实际位置继续。
      start = clamp((main.getBoundingClientRect().left - frame.getBoundingClientRect().left) / edge)
      if ((start <= 0.001 && dx < 0) || (start >= 0.999 && dx > 0)) {
        return
      }
      drag.start = start
      drag.edge = edge
      frame.dataset.drawerDragging = ''
      frame.setPointerCapture(event.pointerId)
    }
    const distance = Math.sign(dx) * Math.max(0, horizontal - touchSlop)
    drag.current = clamp(start + (1.031 * distance) / drag.edge)
    // Pointer events 已按绘制帧合并，当帧直接更新位置。
    frame.style.setProperty('--drawer-progress', String(drag.current))
    frame.style.setProperty('--drawer-radius', `${Math.min(1, drag.current * 6) * 36}px`)
  }

  const settle = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = gesture.current
    if (!drag || drag.id !== event.pointerId) {
      return
    }
    gesture.current = null
    if (drag.start === null) {
      return
    }
    const frame = event.currentTarget
    const velocity = releaseVelocity(drag.samples, event.timeStamp)
    const flick = Math.abs(velocity) >= minFlingVelocity
    const open = cancelled ? drag.startedOpen : flick ? velocity > 0 : drag.current >= 0.5
    frame.dataset.drawerOpen = String(open)
    delete frame.dataset.drawerDragging
    // Let the transition start at the last rendered drag position.
    frame.getBoundingClientRect()
    frame.style.removeProperty('--drawer-progress')
    frame.style.removeProperty('--drawer-radius')
    event.preventDefault()
    if (open) {
      openMobileSider()
    } else {
      closeMobileSider()
    }
  }

  return {
    onPointerDownCapture,
    onPointerMoveCapture,
    onPointerUpCapture: (event: PointerEvent<HTMLDivElement>) => settle(event, false),
    onPointerCancelCapture: (event: PointerEvent<HTMLDivElement>) => settle(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        settle(event, true)
      }
    },
  }
}
