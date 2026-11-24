/* ============================================================================
 * 功能区：语音链路 / recorder 开始
 * 职责：recorder 服务实现，负责语音朗读、录音采集或连续通话链路中的该子能力。
 * 导出：SAMPLE_RATE、MAX_SECONDS、Recording、startRecording、encodeWav。
 * ========================================================================== */

import { android } from '../../app/android.js'

/**
 * 录音并编码为 ASR 接受的 WAV（单声道、16-bit PCM、16kHz）。
 *
 * AudioContext 以 16kHz 创建，浏览器负责重采样；ScriptProcessorNode 采集 PCM 样本。
 * 录音处理在页面内完成。
 */
export const SAMPLE_RATE = 16000
/** ASR 单次时长上限 120 秒 */
export const MAX_SECONDS = 120

const BUFFER_SIZE = 4096

export type Recording = {
  /** 停止录音并返回 WAV；没有采到声音时返回 null */
  stop: () => Promise<Blob | null>
  /** 放弃录音，释放麦克风 */
  cancel: () => void
  /** 频谱分析节点，只读；采样率与录音一致 */
  analyser?: AnalyserNode
  level?: () => number
}

const startAndroidRecording = async (
  device: NonNullable<typeof android>,
  onLimit: () => void
): Promise<Recording> => {
  const state = await new Promise<string>((resolve) => {
    window.addEventListener(
      'android-recording',
      (event) => {
        resolve((event as CustomEvent<string>).detail)
      },
      { once: true }
    )
    device.requestRecording()
  })
  if (state !== 'ready') {
    throw new DOMException(
      'Android microphone unavailable',
      state === 'denied' ? 'NotAllowedError' : 'NotReadableError'
    )
  }
  let finished = false
  const timer = setTimeout(onLimit, MAX_SECONDS * 1000)
  const close = (keep: boolean) => {
    if (finished) {
      return false
    }
    finished = true
    clearTimeout(timer)
    return device.finishRecording(keep)
  }
  return {
    stop: async () => {
      if (!close(true)) {
        return null
      }
      const response = await fetch('/recording.wav', { cache: 'no-store' })
      return response.ok ? response.blob() : null
    },
    cancel: () => {
      close(false)
    },
    level: () => device.recordingLevel(),
  }
}

/** 开始录音；到达时长上限时调用 onLimit，由调用方决定何时 stop */
export const startRecording = async (onLimit: () => void): Promise<Recording> => {
  if (android) {
    return startAndroidRecording(android, onLimit)
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let processor: ScriptProcessorNode | undefined
  let analyser: AnalyserNode | undefined
  let released = false

  const release = () => {
    if (released) {
      return
    }
    released = true
    if (processor) {
      processor.onaudioprocess = null
    }
    // 初始化可能仅部分完成；单个节点断开失败不得阻断麦克风释放。
    for (const node of [processor, analyser, source]) {
      try {
        node?.disconnect()
      } catch {
        // 继续释放其余资源。
      }
    }
    for (const track of stream.getTracks()) {
      track.stop()
    }
    void context?.close().catch(() => {})
  }

  try {
    context = new AudioContext({ sampleRate: SAMPLE_RATE })
    source = context.createMediaStreamSource(stream)
    processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1)
    // 频谱分析用：串在录音链路中间（原样透传），WebKit 不会处理未连到输出的分析节点
    analyser = context.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.2
    const chunks: Float32Array[] = []
    let length = 0
    let limited = false
    processor.onaudioprocess = (event) => {
      if (limited) {
        return
      }
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      length += BUFFER_SIZE
      if (length >= MAX_SECONDS * SAMPLE_RATE) {
        limited = true
        onLimit()
      }
    }
    source.connect(analyser)
    analyser.connect(processor)
    // ScriptProcessorNode 只有连到输出才会持续回调；输出缓冲保持静音
    processor.connect(context.destination)
    // 在 await getUserMedia 之后创建，iOS 上可能处于 suspended
    if (context.state === 'suspended') {
      void context.resume().catch(() => {})
    }

    return {
      stop: async () => {
        release()
        return length === 0 ? null : encodeWav(chunks, length)
      },
      cancel: release,
      analyser,
    }
  } catch (error) {
    release()
    throw error
  }
}

export const encodeWav = (
  chunks: Float32Array[],
  length: number,
  sampleRate: number = SAMPLE_RATE
) => {
  const samples = Math.min(length, MAX_SECONDS * sampleRate)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 单声道
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, samples * 2, true)
  let offset = 44
  let written = 0
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length && written < samples; i++, written++) {
      const sample = Math.max(-1, Math.min(1, chunk[i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/* ============================================================================
 * 功能区：语音链路 / recorder 结束
 * ========================================================================== */
