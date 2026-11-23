import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAndroidBackInterception } from '../../app/useAndroidBackInterception.js'
import { useSettings } from '../../services/settings.js'
import {
  endVoiceCall,
  flushVoiceCallSpeech,
  interruptVoiceCall,
  retryVoiceCall,
  toggleVoiceCallMute,
  useVoiceCall,
} from '../../services/speech/voiceCall.js'
import { IconCloseOutline16, IconMicOutline16, IconSendOutline16, IconStopFill16 } from '../base/icons.js'
import styles from './VoiceCallOverlay.module.css'

/** 角色语音通话：全屏浮层，连续「听 → 想 → 说」循环 */
export const VoiceCallOverlay = () => {
  const active = useVoiceCall((state) => state.active)
  const phase = useVoiceCall((state) => state.phase)
  const error = useVoiceCall((state) => state.error)
  const speechDetected = useVoiceCall((state) => state.speechDetected)
  const micReady = useVoiceCall((state) => state.micReady)
  const muted = useVoiceCall((state) => state.muted)
  const userText = useVoiceCall((state) => state.userText)
  const assistantText = useVoiceCall((state) => state.assistantText)
  const characterName = useSettings((state) => state.characterName)
  const characterAvatar = useSettings((state) => state.characterAvatar)
  const centerRef = useRef<HTMLDivElement | null>(null)

  useAndroidBackInterception(active)

  useEffect(() => {
    const syncLevel = (level: number) => {
      centerRef.current?.style.setProperty('--orb-level', String(level))
    }
    syncLevel(useVoiceCall.getState().level)
    return useVoiceCall.subscribe((state, prev) => {
      if (state.level !== prev.level) {
        syncLevel(state.level)
      }
    })
  }, [active])

  useEffect(() => {
    if (!active) {
      return
    }
    const onBack = () => {
      endVoiceCall()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        endVoiceCall()
      } else if (event.code === 'Space' && !event.repeat) {
        const target = event.target as HTMLElement | null
        if (
          target?.closest('button, a, input, textarea, select, [role="button"], [contenteditable]')
        ) {
          return
        }
        event.preventDefault()
        interruptVoiceCall()
      }
    }
    window.addEventListener('android-back', onBack)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('android-back', onBack)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [active])

  if (!active) {
    return null
  }

  const busy = phase === 'transcribing' || phase === 'thinking' || phase === 'speaking'
  const statusLabel = error
    ? error
    : phase === 'muted'
      ? '已静音'
      : phase === 'transcribing'
        ? '正在听写…'
        : phase === 'thinking'
          ? '正在思考…'
          : phase === 'speaking'
            ? '正在说话'
            : speechDetected
              ? '听到了，继续说'
              : '在听你说'

  return createPortal(
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="语音通话">
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={clsx(styles.liveDot, muted && styles.liveDotMuted)} />
          <span className={styles.title}>
            {characterName ? `与${characterName}通话` : '语音通话'}
          </span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.micState} data-state={micReady} aria-live="polite">
            <IconMicOutline16 />
            <span className={styles.micText}>
              {micReady === 'ready'
                ? '麦克风已就绪'
                : micReady === 'failed'
                  ? '麦克风未就绪'
                  : '麦克风开启中'}
            </span>
          </span>
          <button
            type="button"
            className={styles.controlBtn}
            style={{ width: 38, height: 38 }}
            aria-label="挂断"
            onClick={endVoiceCall}
          >
            <IconCloseOutline16 />
          </button>
        </div>
      </div>

      <div ref={centerRef} className={styles.center}>
        <button
          type="button"
          className={styles.orbButton}
          aria-label={busy ? '打断' : statusLabel}
          onClick={() => {
            if (busy || speechDetected) {
              interruptVoiceCall()
            }
          }}
        >
          <span className={styles.orbHalo} />
          <span
            className={clsx(
              styles.orbCore,
              speechDetected && phase === 'listening' && styles.orbCoreHearing,
              (phase === 'transcribing' || phase === 'thinking') && styles.orbCoreBusy,
              phase === 'muted' && styles.orbCoreMuted,
              phase === 'error' && styles.orbCoreError
            )}
          >
            <span className={styles.orbInnerIcon}>
              {characterAvatar ? (
                <img className={styles.orbAvatar} src={characterAvatar} alt="" aria-hidden="true" />
              ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 4a2.2 2.2 0 0 1 2.2 2.2v4.4a2.2 2.2 0 1 1-4.4 0V6.2A2.2 2.2 0 0 1 12 4Z"
                  fill="currentColor"
                />
                <path
                  d="M5.6 10.6a.9.9 0 1 1 1.8 0 4.6 4.6 0 1 0 9.2 0 .9.9 0 0 1 1.8 0 6.4 6.4 0 0 1-5 6.2V19a.9.9 0 0 1-1.8 0v-2.2a6.4 6.4 0 0 1-5-6.2Z"
                  fill="currentColor"
                />
              </svg>
              )}
            </span>
          </span>
        </button>

        <div className={clsx(styles.statusText, error && styles.errorText)}>{statusLabel}</div>

        {userText || assistantText ? (
          <div className={styles.transcriptBox}>
            {userText ? <div className={styles.userCaption}>{userText}</div> : null}
            {assistantText ? <div className={styles.assistantCaption}>{assistantText}</div> : null}
          </div>
        ) : null}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={clsx(styles.controlBtn, muted && styles.controlBtnActive)}
          aria-label={muted ? '取消静音' : '静音'}
          aria-pressed={muted}
          onClick={toggleVoiceCallMute}
        >
          <IconMicOutline16 />
          {muted ? <span className={styles.muteSlash} aria-hidden="true" /> : null}
        </button>

        {phase === 'error' ? (
          <button
            type="button"
            className={styles.controlBtn}
            aria-label="重试"
            onClick={retryVoiceCall}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.2h-4.2"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}

        {busy ? (
          <button
            type="button"
            className={styles.controlBtn}
            aria-label="打断"
            onClick={interruptVoiceCall}
          >
            <IconStopFill16 />
          </button>
        ) : phase === 'listening' && speechDetected ? (
          <button
            type="button"
            className={styles.controlBtn}
            aria-label="现在发送"
            onClick={flushVoiceCallSpeech}
          >
            <IconSendOutline16 />
          </button>
        ) : null}

        <button
          type="button"
          className={clsx(styles.controlBtn, styles.hangupBtn)}
          aria-label="挂断"
          onClick={endVoiceCall}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M2.6 9.4c5.3-4.6 13.5-4.6 18.8 0 .7.6.9 1.6.5 2.4l-1.2 2.4c-.4.8-1.3 1.1-2.1.8l-2.2-.8c-.7-.3-1.1-1-1.1-1.8v-1.6a10.9 10.9 0 0 0-6.6 0v1.6c0 .8-.4 1.5-1.1 1.8l-2.2.8c-.8.3-1.7 0-2.1-.8L.8 11.8c-.4-.8-.2-1.8.5-2.4Z" />
          </svg>
        </button>
      </div>
    </div>,
    document.body
  )
}
