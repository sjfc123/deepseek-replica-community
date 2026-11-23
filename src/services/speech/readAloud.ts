import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { ApiError } from '../api/client.js'
import { classifyApiError } from '../api/errors.js'
import { synthesize, TTS_SAMPLE_RATE } from '../api/speech.js'
import { useSettings } from '../settings.js'
import { stripAsides } from '../chat/aside.js'
import { android } from '../../app/android.js'
import { showToast } from '../../components/base/toastState.js'

/**
 * 朗读：同一时间只读一条回复。
 * 请求 TTS 的裸 PCM 流，边收边用 AudioContext 按顺序排程播放，首帧到达即出声。
 * 状态：loading（已请求、未出声）→ playing → 结束回到 idle。
 */
export type ReadAloudStatus = 'idle' | 'loading' | 'playing'

type ReadAloudState = {
  /** 正在朗读的回复 id */
  messageId: string | null
  status: ReadAloudStatus
}

export const useReadAloud = create<ReadAloudState>(() => ({ messageId: null, status: 'idle' }))

/** 首帧前多缓冲一点，减少网络抖动造成的断续 */
const START_DELAY = 0.1

let current: { controller: AbortController; context: AudioContext } | null = null

const finish = (controller: AbortController) => {
  if (current?.controller !== controller) {
    return
  }
  void current.context.close()
  current = null
  useReadAloud.setState({ messageId: null, status: 'idle' })
}

/** 停止当前朗读（发送、停止生成、切换会话等场景调用） */
export const stopReadAloud = () => {
  if (current) {
    const { controller } = current
    controller.abort()
    finish(controller)
  }
}

/** 16-bit 小端 PCM 转成 Float32；奇数字节留到下一段 */
const toFloat32 = (bytes: Uint8Array) => {
  const samples = new Float32Array(bytes.length >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return samples
}

let readAloudBlocked = false

/** 通话期间屏蔽并立刻打断自动/手动朗读，避免两路音频叠在一起 */
export const setReadAloudBlocked = (blocked: boolean) => {
  readAloudBlocked = blocked
  if (blocked) {
    stopReadAloud()
  }
}

/** 把 TTS 流按顺序排到 AudioContext；通话逐句合成时会多次调用，靠 nextTime 续排 */
export const scheduleTtsStream = async ({
  context,
  destination,
  stream,
  signal,
  initialNextTime,
  startDelay = START_DELAY,
  onSource,
  onFirstAudio,
}: {
  context: AudioContext
  destination: AudioNode
  stream: ReadableStream<Uint8Array>
  signal: AbortSignal
  initialNextTime: number
  startDelay?: number
  onSource: (source: AudioBufferSourceNode) => void
  onFirstAudio?: () => void
}): Promise<{ nextTime: number; lastSource: AudioBufferSourceNode | null }> => {
  const reader = stream.getReader()
  const onAbort = () => void reader.cancel().catch(() => {})
  signal.addEventListener('abort', onAbort, { once: true })
  let nextTime = initialNextTime
  let lastSource: AudioBufferSourceNode | null = null
  let firstFired = false

  const enqueue = (buffer: AudioBuffer) => {
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(destination)
    nextTime = Math.max(
      nextTime,
      context.currentTime + (!lastSource && nextTime === 0 ? startDelay : 0)
    )
    onSource(source)
    source.start(nextTime)
    nextTime += buffer.duration
    lastSource = source
    if (!firstFired) {
      firstFired = true
      onFirstAudio?.()
    }
  }

  try {
    let rest = new Uint8Array(0)
    for (;;) {
      const { done, value } = await reader.read()
      if (done || signal.aborted) {
        break
      }
      const bytes = new Uint8Array(rest.length + value.length)
      bytes.set(rest)
      bytes.set(value, rest.length)
      const samples = toFloat32(bytes)
      rest = bytes.slice(samples.length * 2)
      if (samples.length === 0) {
        continue
      }
      const buffer = context.createBuffer(1, samples.length, TTS_SAMPLE_RATE)
      buffer.copyToChannel(samples, 0)
      enqueue(buffer)
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  return { nextTime, lastSource }
}

export const describeReadAloudError = (error: unknown): TranslationMessage | string => {
  if (error instanceof ApiError && error.kind === 'protocol') {
    return error.message
  }
  // 400 表示这段正文服务端无法合成，与其余失败区分开
  if (error instanceof ApiError && error.status === 400) {
    return { key: 'ttsUnavailable' }
  }
  switch (classifyApiError(error)) {
    case 'unauthorized':
      return { key: 'apiKeyInvalidRetry' }
    case 'insufficientBalance':
      return { key: 'insufficientBalance' }
    case 'rateLimited':
      return { key: 'rateLimited' }
    default:
      return { key: 'ttsFailed' }
  }
}

/**
 * 开始朗读指定回复的正文；对同一条回复重复调用视为停止。
 * 必须在点击事件内同步调用：AudioContext 需用户手势方可发声。
 */
export const toggleReadAloud = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void
) => {
  if (readAloudBlocked) {
    return
  }
  const reading = useReadAloud.getState().messageId
  stopReadAloud()
  if (reading === messageId) {
    return
  }
  const controller = new AbortController()
  const context = new AudioContext({ sampleRate: TTS_SAMPLE_RATE })
  current = { controller, context }
  useReadAloud.setState({ messageId, status: 'loading' })
  // 音色在开始朗读时读取，设置中切换后下一次朗读生效
  const { apiKey, ttsVoice, thoughtAside } = useSettings.getState()
  // 括号里的内心独白不合成：整条只有独白时直接提示并复位
  const spoken = thoughtAside ? stripAsides(text) : text
  if (!spoken) {
    finish(controller)
    showToast({ key: 'ttsAsidesOnly' })
    return
  }

  void (async () => {
    let nextTime = 0
    let lastSource: AudioBufferSourceNode | null = null
    let rest = new Uint8Array(0)
    try {
      const stream = await synthesize(apiKey ?? '', spoken, ttsVoice, controller.signal)
      const reader = stream.getReader()
      controller.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}))
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        const bytes = new Uint8Array(rest.length + value.length)
        bytes.set(rest)
        bytes.set(value, rest.length)
        const samples = toFloat32(bytes)
        rest = bytes.slice(samples.length * 2)
        if (samples.length === 0) {
          continue
        }
        const buffer = context.createBuffer(1, samples.length, TTS_SAMPLE_RATE)
        buffer.copyToChannel(samples, 0)
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        // 网络慢于播放时从当前时间续上，不补播过去的时间
        nextTime = Math.max(nextTime, context.currentTime + (lastSource ? 0 : START_DELAY))
        source.start(nextTime)
        nextTime += buffer.duration
        lastSource = source
        if (useReadAloud.getState().status === 'loading') {
          useReadAloud.setState({ status: 'playing' })
          if (android?.getMusicVolume?.() === 0) {
            showToast({ key: 'readAloudLowVolume' }, 1900)
          }
        }
      }
      if (lastSource) {
        lastSource.onended = () => finish(controller)
      } else {
        finish(controller)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        finish(controller)
        onError(error)
      }
    }
  })()
}
