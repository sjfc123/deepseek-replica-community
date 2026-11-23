import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { useVoiceInput } from './useVoiceInput.js'
import type { VoiceTouchPoint } from './voiceMaskShader.js'

type Hold = {
  pointer: number
  startY: number
  x: number
  y: number
  active: boolean
  canceling: boolean
}

export const useHoldToTalk = (
  voice: ReturnType<typeof useVoiceInput>,
  beforeStart: () => boolean
) => {
  const gesture = useRef<Hold | null>(null)
  const touch = useRef<VoiceTouchPoint | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [canceling, setCanceling] = useState(false)
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      touch.current = null
    },
    []
  )

  const begin = (event: PointerEvent<HTMLElement>, delay: number) => {
    if (!event.isPrimary || event.button !== 0 || gesture.current || voice.status !== 'idle') {
      return
    }
    const element = event.currentTarget
    const held: Hold = {
      pointer: event.pointerId,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      canceling: false,
    }
    gesture.current = held
    element.setPointerCapture(held.pointer)
    const start = () => {
      if (gesture.current === held && beforeStart()) {
        held.active = true
        touch.current = { x: held.x, y: held.y }
        setCanceling(false)
        void voice.start()
      }
    }
    if (delay) {
      timer.current = setTimeout(start, delay)
    } else {
      start()
    }
  }

  const finish = (event: PointerEvent<HTMLElement>, interrupted: boolean) => {
    const held = gesture.current
    if (!held || held.pointer !== event.pointerId) {
      return
    }
    clearTimeout(timer.current)
    gesture.current = null
    touch.current = null
    if (held.active) {
      event.preventDefault()
      if (interrupted || held.canceling) {
        voice.cancel()
      } else {
        void voice.finish()
      }
    }
  }

  const events = {
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const held = gesture.current
      if (held?.pointer !== event.pointerId) {
        return
      }
      held.x = event.clientX
      held.y = event.clientY
      if (held.active) {
        touch.current = { x: held.x, y: held.y }
        held.canceling = held.startY - event.clientY >= 72
        setCanceling(held.canceling)
      } else if (Math.abs(held.startY - event.clientY) > 12) {
        clearTimeout(timer.current)
      }
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finish(event, true),
  }
  return {
    canceling,
    touch,
    direct: { ...events, onPointerDown: (event: PointerEvent<HTMLElement>) => begin(event, 0) },
    delayed: { ...events, onPointerDown: (event: PointerEvent<HTMLElement>) => begin(event, 380) },
  }
}
