/* ============================================================================
 * 功能区：附件与文件预览 / usePreviewZoom 开始
 * 职责：预览缩放 Hook：双指缩放、平移边界与复位。
 * 导出：usePreviewZoom。
 * ========================================================================== */

import { useEffect, useRef, useState, type PointerEvent, type MouseEvent } from 'react'
import { clamp, type Point, type Size } from './imageCrop.js'

const DEFAULT = { x: 0, y: 0, scale: 1 }
const MAX_ZOOM = 5
const DOUBLE_TAP_MS = 275

const span = (first: Point, second: Point) =>
  Math.max(1, Math.hypot(first.x - second.x, first.y - second.y))
const midpoint = (first: Point, second: Point) => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2,
})

export const usePreviewZoom = (image: Size | undefined, onClose: () => void) => {
  const [position, setPosition] = useState(DEFAULT)
  const [controlsHidden, setControlsHidden] = useState(false)
  const current = useRef(DEFAULT)
  const fingers = useRef(new Map<number, Point>())
  const start = useRef({ point: { x: 0, y: 0 }, position: DEFAULT, span: 0 })
  const moved = useRef(false)
  const pinching = useRef(false)
  const firstTap = useRef<{ timer: number; point: Point }>()

  const cancelTap = () => {
    window.clearTimeout(firstTap.current?.timer)
    firstTap.current = undefined
  }
  useEffect(() => () => window.clearTimeout(firstTap.current?.timer), [])

  const set = (next: typeof DEFAULT) => {
    current.current = next
    setPosition(next)
  }
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!image || event.button !== 0 || fingers.current.size >= 2) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const [first, second] = fingers.current.values()
    if (first && second) {
      start.current = {
        point: midpoint(first, second),
        position: current.current,
        span: span(first, second),
      }
      moved.current = true
      pinching.current = true
      cancelTap()
    } else {
      start.current = { point: first, position: current.current, span: 0 }
      moved.current = false
    }
  }

  const move = (bounds: DOMRect, origin: typeof start.current, point: Point, scale: number) => {
    if (!image) {
      return
    }
    const ratio = scale / origin.position.scale
    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2
    const base = Math.min(bounds.width / image.width, bounds.height / image.height)
    const limitX = Math.max(0, (base * image.width * scale - bounds.width) / 2)
    const limitY = Math.max(0, (base * image.height * scale - bounds.height) / 2)
    set({
      scale,
      x: clamp(
        point.x - centerX - (origin.point.x - centerX - origin.position.x) * ratio,
        -limitX,
        limitX
      ),
      y: clamp(
        point.y - centerY - (origin.point.y - centerY - origin.position.y) * ratio,
        -limitY,
        limitY
      ),
    })
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!image || !fingers.current.has(event.pointerId)) {
      return
    }
    fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const [first, second] = fingers.current.values()
    const point = second ? midpoint(first, second) : first
    const origin = start.current
    if (!moved.current && Math.hypot(point.x - origin.point.x, point.y - origin.point.y) < 5) {
      return
    }
    moved.current = true
    cancelTap()
    const bounds = event.currentTarget.getBoundingClientRect()
    const scale = second
      ? clamp((origin.position.scale * span(first, second)) / origin.span, 1, MAX_ZOOM)
      : origin.position.scale
    move(bounds, origin, point, scale)
  }
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (!fingers.current.delete(event.pointerId)) {
      return
    }
    const [remaining] = fingers.current.values()
    if (remaining) {
      start.current = { point: remaining, position: current.current, span: 0 }
    } else if (pinching.current) {
      setControlsHidden(current.current.scale > 1.01)
      pinching.current = false
    }
  }
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!image || event.detail === 0) {
      onClose()
      return
    }
    if (moved.current) {
      return
    }
    const point = { x: event.clientX, y: event.clientY }
    const previous = firstTap.current
    cancelTap()
    if (previous && span(previous.point, point) < 32) {
      const bounds = event.currentTarget.getBoundingClientRect()
      const widthScale = bounds.width / image.width
      const heightScale = bounds.height / image.height
      const fill = Math.max(widthScale, heightScale) / Math.min(widthScale, heightScale)
      const scale = current.current.scale > 1.01 ? 1 : Math.min(MAX_ZOOM, Math.max(2, fill))
      move(bounds, { point, position: current.current, span: 0 }, point, scale)
      setControlsHidden(false)
    } else {
      firstTap.current = { point, timer: window.setTimeout(onClose, DOUBLE_TAP_MS) }
    }
  }

  return {
    position,
    controlsHidden,
    cancelTap,
    bindings: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onLostPointerCapture: onPointerUp,
      onClick,
    },
  }
}

/* ============================================================================
 * 功能区：附件与文件预览 / usePreviewZoom 结束
 * ========================================================================== */
