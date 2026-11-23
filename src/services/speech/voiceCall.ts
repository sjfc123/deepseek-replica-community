import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { ApiError } from '../api/client.js'
import { classifyApiError } from '../api/errors.js'
import { synthesize, transcribe } from '../api/speech.js'
import { describeReply } from '../chat/describe.js'
import { maskAsides } from '../chat/aside.js'
import { getReplyText } from '../chat/reply.js'
import { sendVoicePrompt, stopReply, useChatStore } from '../chat/store.js'
import type { AssistantMessage } from '../chat/types.js'
import { matchRefusalKeyword, useSettings } from '../settings.js'
import {
  scheduleTtsStream,
  setReadAloudBlocked,
  stopReadAloud,
} from './readAloud.js'
import { encodeWav, MAX_SECONDS, SAMPLE_RATE } from './recorder.js'

export type VoiceCallPhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'muted'
  | 'error'

/** 麦克风采集链的可用状态：pending 等待开流，ready 已拿到活动音轨，failed 开流失败 */
export type VoiceCallMicState = 'idle' | 'pending' | 'ready' | 'failed'

type VoiceCallState = {
  active: boolean
  sessionId: string | null
  phase: VoiceCallPhase
  micReady: VoiceCallMicState
  muted: boolean
  speechDetected: boolean
  level: number
  userText: string
  assistantText: string
  error: string | null
}

export const useVoiceCall = create<VoiceCallState>(() => ({
  active: false,
  sessionId: null,
  phase: 'idle',
  micReady: 'idle',
  muted: false,
  speechDetected: false,
  level: 0,
  userText: '',
  assistantText: '',
  error: null,
}))

const FRAME_SIZE = 2048
const PRE_ROLL_FRAMES = 3
const SPEECH_START_FRAMES = 2
const SILENCE_END_FRAMES = 9
const MIN_SPEECH_FRAMES = 3
const SPEECH_RMS_THRESHOLD = 0.018
const SILENCE_RMS_THRESHOLD = 0.012
/** 播放中检测到用户插话：阈值更高、连续两帧才算，避开回声与尾音 */
const BARGE_RMS_THRESHOLD = 0.05
const BARGE_START_FRAMES = 2
/** 采集上下文拿到的实际采样率可能不同于编码目标，按比例换算帧上限，避免截断时长随设备变化 */
const maxCaptureFramesFor = (rate: number) => Math.floor((MAX_SECONDS * rate) / FRAME_SIZE)
const MAX_CAPTURE_FRAMES = maxCaptureFramesFor(SAMPLE_RATE)
const TTS_START_DELAY = 0.06
const SENTENCE_END_RE = /[。！？.!?\n]/

const computeRms = (samples: Float32Array) => {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i]
  }
  return Math.sqrt(sum / samples.length)
}

const cleanSpeechText = (text: string) =>
  text
    .replace(/[*_`#>~]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()

/**
 * 把 getUserMedia 的失败原因翻译成可执行提示。
 * 旧内核常见 NotReadableError / TrackStartError（通道被占用）与 OverconstrainedError（约束不支持），
 * 这两类此前都被压成「麦克风打开失败」，无法区分是权限、占用还是参数问题。
 */
const describeMicError = (error: unknown) => {
  if (!navigator.mediaDevices?.getUserMedia) {
    return '当前环境不支持录音'
  }
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '没有麦克风权限，请在系统设置里允许录音后重试'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '没有找到麦克风'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '麦克风通道被占用：关闭其他录音类应用后重试；刚结束一次通话时请稍等再点重试'
  }
  if (name === 'AbortError') {
    return '麦克风启动被中断，请重试'
  }
  if (name === 'OverconstrainedError') {
    return '麦克风不支持当前录音参数'
  }
  if (error instanceof Error && error.message === '麦克风授权超时') {
    return '等待麦克风授权超时，请点重试'
  }
  return name ? `麦克风打开失败（${name}）` : '麦克风打开失败'
}

type MicProbe = {
  ok?: boolean
  perm?: boolean
  stage?: string
  error?: string
  read?: number
  mode?: number
  sdk?: number
}

/**
 * 原生自检：由宿主真开一次 AudioRecord 并读一块数据。
 * WebView 报 NotReadableError 时用它区分两种情况——系统录音通道真的被别处占着，
 * 还是通道空闲、只是 WebView 内核拒绝采集。桌面环境没有这个桥，返回 null。
 */
const readMicProbe = (): MicProbe | null => {
  try {
    const bridge = (window as Window & { DeepSeekAndroid?: { probeMicrophone?: () => string } })
      .DeepSeekAndroid
    const raw = bridge?.probeMicrophone?.()
    if (!raw) {
      return null
    }
    return JSON.parse(raw) as MicProbe
  } catch {
    return null
  }
}

/** 把自检结果换成短句；真机弹窗里不展示采样数、阶段名这类排障字段 */
const describeMicFailure = (error: unknown): string => {
  const base = describeMicError(error)
  const name = error instanceof Error ? error.name : ''
  if (!MIC_CHANNEL_BUSY.has(name)) {
    return base
  }
  const probe = readMicProbe()
  if (!probe) {
    return base
  }
  if (probe.ok) {
    return '网页采集未能启动，系统直录也没有拿到通道；请重启应用，或先关闭其他录音类应用后点重试。'
  }
  if (probe.perm === false) {
    return '系统没有给本应用录音权限，请到系统设置里打开「麦克风」后重试'
  }
  return '麦克风被其他应用占用了，关掉录音类应用后点重试；刚挂断通话时等两秒再试。'
}

/** 通话录音的偏好参数；回声消除与降噪在部分设备上不可用，失败后退回最简约束 */
const CALL_AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
}

const constraintName = (error: unknown) =>
  error instanceof Error ? error.name : ''

/** 采集通道被上一路录音占用时立即返回的两种错误名 */
const MIC_CHANNEL_BUSY = new Set(['NotReadableError', 'TrackStartError'])

/** 约束不被内核接受时的错误名，可直接退回最简约束 */
const MIC_CONSTRAINT_REJECT = new Set(['OverconstrainedError', 'NotSupportedError', 'TypeError'])

/**
 * 采集通道释放有延迟：上一路的音频轨道 stop 之后，AudioRecord 往往仍被持有数百毫秒，
 * 紧接着申请会立刻得到 NotReadableError。这里等一个采集周期再用最简约束重试一次，
 * 把「上一路尚未释放」与「真的被其他应用占用」区分开——后者重试同样会失败。
 */
const MIC_RELEASE_DELAY = 360
const waitForChannelRelease = (delay = MIC_RELEASE_DELAY) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, delay))

/**
 * 打开麦克风：先按通话优化参数申请。
 * 约束不被接受时立刻退回 {audio:true}；通道被占用（含上一路未释放）时先等待再重试一次最简约束；
 * 权限拒绝等其余错误原样抛出，交给 describeMicError 给出对应提示。
 */
/** 依次尝试的等待间隔：上一路采集彻底释放、系统服务回收 AudioRecord 都需要时间 */
const MIC_RETRY_DELAYS = [0, 520, 1100]

/**
 * 打开麦克风：先按通话优化参数申请，失败后逐级退回最简约束并退避重试。
 * 每次重试前都重新放掉原生录音，避免同一进程内两路 AudioRecord 互相抢设备。
 */
/** getUserMedia 在某些 ROM 上会一直挂着不返回，超时后按失败处理，避免通话界面永远停在授权中 */
const MIC_OPEN_TIMEOUT = 8000
const withOpenTimeout = (pending: Promise<MediaStream>): Promise<MediaStream> => {
  let timedOut = false
  const stopStream = (stream: MediaStream) => {
    for (const track of stream.getTracks()) {
      track.stop()
    }
  }
  return new Promise<MediaStream>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      timedOut = true
      reject(new Error('麦克风授权超时'))
    }, MIC_OPEN_TIMEOUT)
    // 超时后 getUserMedia 仍可能迟到返回：这里立刻释放轨道，避免下一轮采集被自己占住。
    pending.then(
      (stream) => {
        window.clearTimeout(timer)
        if (timedOut) {
          stopStream(stream)
          return
        }
        resolve(stream)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        if (!timedOut) {
          reject(error)
        }
      }
    )
  })
}

const openMicrophoneStream = async (): Promise<MediaStream> => {
  let lastError: unknown = null
  for (const delay of MIC_RETRY_DELAYS) {
    if (delay > 0) {
      await waitForChannelRelease(delay)
    }
    // 原生录音（语音输入那条路径）若还持有设备，WebView 采集会直接得到 NotReadableError
    try {
      const bridge = (window as Window & {
        DeepSeekAndroid?: { prepareMicrophone?: () => boolean; releaseNativeRecorder?: () => boolean }
      }).DeepSeekAndroid
      // prepareMicrophone 除了放掉原生录音，还会退出通话模式、放弃音频焦点；
      // 部分 ROM 只在这几项清干净之后才允许 WebView 采集。
      bridge?.prepareMicrophone?.()
      bridge?.releaseNativeRecorder?.()
    } catch {
      // 桥没注入时按桌面环境处理
    }
    const constraints: MediaStreamConstraints = delay === 0 ? CALL_AUDIO_CONSTRAINTS : { audio: true }
    try {
      return await withOpenTimeout(navigator.mediaDevices.getUserMedia(constraints))
    } catch (error) {
      lastError = error
      const name = constraintName(error)
      // 权限拒绝、没有设备这类错误重试也没用，直接抛出
      if (!MIC_CHANNEL_BUSY.has(name) && !MIC_CONSTRAINT_REJECT.has(name)) {
        throw error
      }
    }
  }
  throw lastError ?? new Error('麦克风打开失败')
}

/**
 * 建立采集上下文：优先指定 16 kHz，便于与 WAV 编码一致；
 * 内核不支持任意采样率时退回默认采样率，并把实际采样率交给编码与帧上限使用。
 */
const createCaptureContext = (): AudioContext => {
  try {
    return new AudioContext({ sampleRate: SAMPLE_RATE })
  } catch {
    return new AudioContext()
  }
}

/** 系统直录轮询状态：carry 保存不足一帧的尾部样本 */
type NativeCallCapture = {
  timer: number
  carry: Float32Array
  failures: number
  emptyPolls: number
  restarts: number
}

type CallSession = {
  epoch: number
  stream: MediaStream | null
  captureCtx: AudioContext | null
  captureSource: MediaStreamAudioSourceNode | null
  captureProcessor: ScriptProcessorNode | null
  nativeCapture: NativeCallCapture | null
  playbackCtx: AudioContext | null
  playbackAnalyser: AnalyserNode | null
  playbackSources: Set<AudioBufferSourceNode>
  nextPlayTime: number
  levelFrame: number
  turnController: AbortController | null
  storeUnsubscribe: (() => void) | null
  replySessionId: string | null
  preRoll: Float32Array[]
  bargeFrames: Float32Array[]
  bargeSpeech: number
  chunks: Float32Array[]
  totalSamples: number
  /** 采集上下文实际采样率，编码 WAV 头部与帧上限都以它为准 */
  captureRate: number
  maxCaptureFrames: number
  speechFrames: number
  consecutiveSpeech: number
  consecutiveSilence: number
  speakingInMic: boolean
}

let activeCall: CallSession | null = null
let callEpoch = 0
/** 点击电话按钮时先建好的播放上下文；等权限回来再建会丢失用户手势，部分 ROM 不允许出声 */
let primedPlaybackCtx: AudioContext | null = null

export const primeVoiceCallAudio = () => {
  if (primedPlaybackCtx && primedPlaybackCtx.state !== 'closed') {
    if (primedPlaybackCtx.state === 'suspended') {
      void primedPlaybackCtx.resume().catch(() => {})
    }
    return
  }
  try {
    primedPlaybackCtx = new AudioContext({ sampleRate: 24000 })
  } catch {
    try {
      primedPlaybackCtx = new AudioContext()
    } catch {
      primedPlaybackCtx = null
      return
    }
  }
  if (primedPlaybackCtx.state === 'suspended') {
    void primedPlaybackCtx.resume().catch(() => {})
  }
}

const resetVad = (call: CallSession) => {
  call.preRoll = []
  call.chunks = []
  call.totalSamples = 0
  call.speechFrames = 0
  call.consecutiveSpeech = 0
  call.consecutiveSilence = 0
  call.speakingInMic = false
  useVoiceCall.setState({ speechDetected: false })
}

const stopPlayback = (call: CallSession) => {
  for (const source of call.playbackSources) {
    source.onended = null
    try {
      source.stop()
      source.disconnect()
    } catch {
      // 已结束的节点重复停止会抛错，这里忽略
    }
  }
  call.playbackSources.clear()
  call.nextPlayTime = 0
}

const cleanupTurn = (call: CallSession) => {
  call.turnController?.abort()
  call.turnController = null
  call.storeUnsubscribe?.()
  call.storeUnsubscribe = null
  stopPlayback(call)
}

const releaseAudioBridge = () => {
  const bridge = (window as Window & { DeepSeekAndroid?: { abandonCallAudioFocus?: () => void } })
    .DeepSeekAndroid
  bridge?.abandonCallAudioFocus?.()
}

/** 采集成功后再拿播放焦点：先拿焦点会被 prepareMicrophone 立刻放弃，还会把出声路由到听筒 */
const requestAudioBridge = () => {
  const bridge = (window as Window & { DeepSeekAndroid?: { requestCallAudioFocus?: () => void } })
    .DeepSeekAndroid
  bridge?.requestCallAudioFocus?.()
}

const teardownCall = (call: CallSession) => {
  callEpoch++
  stopNativeCapture(call)
  releaseAudioBridge()
  cancelAnimationFrame(call.levelFrame)
  cleanupTurn(call)
  if (call.captureProcessor) {
    call.captureProcessor.onaudioprocess = null
  }
  for (const node of [call.captureProcessor, call.captureSource, call.playbackAnalyser]) {
    try {
      node?.disconnect()
    } catch {
      // 忽略断开错误
    }
  }
  if (call.stream) {
    for (const track of call.stream.getTracks()) {
      track.stop()
    }
  }
  void call.captureCtx?.close().catch(() => {})
  void call.playbackCtx?.close().catch(() => {})
  if (activeCall === call) {
    activeCall = null
  }
}

const resumeListening = (call: CallSession) => {
  if (activeCall !== call || callEpoch !== call.epoch) {
    return
  }
  resetVad(call)
  const { muted } = useVoiceCall.getState()
  useVoiceCall.setState({ phase: muted ? 'muted' : 'listening', level: 0, error: null })
}

const findReply = (sessionId: string, replyId: string): AssistantMessage | undefined => {
  const session = useChatStore.getState().sessionCache[sessionId]
  const message = session?.messages.find((item) => item.id === replyId)
  return message?.role === 'assistant' ? message : undefined
}

/** 把回复正文按句切块交给 TTS，边流式出字边播放 */
const streamReplyWithTts = async (
  call: CallSession,
  sessionId: string,
  replyId: string,
  controller: AbortController
) => {
  const queue: string[] = []
  let spokenOffset = 0
  let streamFinished = false
  let refusalHandled = false
  let wakeRunner: (() => void) | null = null
  const notifyRunner = () => {
    wakeRunner?.()
    wakeRunner = null
  }
  const waitForNext = () =>
    new Promise<void>((resolve) => {
      wakeRunner = resolve
    })

  const enqueueChunk = (raw: string) => {
    const cleaned = cleanSpeechText(raw)
    if (cleaned) {
      queue.push(cleaned)
      notifyRunner()
    }
  }

  const syncReply = () => {
    if (controller.signal.aborted || activeCall !== call) {
      streamFinished = true
      notifyRunner()
      return
    }
    const reply = findReply(sessionId, replyId)
    if (!reply) {
      return
    }
    const isSettled =
      reply.status === 'done' || reply.status === 'stopped' || reply.status === 'error'

    if (reply.stopReason === 'refusal' && !useSettings.getState().keepRefusedContent) {
      if (isSettled && !refusalHandled) {
        refusalHandled = true
        const notice = describeReply(reply)
        const refusalText = notice?.text ?? ''
        useVoiceCall.setState({ assistantText: refusalText })
        queue.length = 0
        stopPlayback(call)
        if (refusalText) {
          enqueueChunk(refusalText)
        }
        streamFinished = true
        notifyRunner()
      }
      return
    }

    const fullText = getReplyText(reply)
    if (fullText) {
      useVoiceCall.setState({ assistantText: fullText })
    }
    // 界面保留原文，合成用的文本把内心独白换成等长空白：偏移不变，独白不会被读出来
    const speechText = useSettings.getState().thoughtAside ? maskAsides(fullText) : fullText

    if (isSettled) {
      const remaining = speechText.slice(spokenOffset)
      spokenOffset = fullText.length
      if (remaining.trim()) {
        enqueueChunk(remaining)
      } else if (!fullText.trim()) {
        const notice = describeReply(reply)
        if (notice?.text) {
          useVoiceCall.setState({ assistantText: notice.text })
          if (reply.status !== 'error') {
            enqueueChunk(notice.text)
          } else {
            useVoiceCall.setState({ error: notice.text })
          }
        }
      }
      streamFinished = true
      notifyRunner()
      return
    }

    for (;;) {
      const slice = speechText.slice(spokenOffset)
      if (!slice) {
        break
      }
      const match = SENTENCE_END_RE.exec(slice)
      if (!match) {
        break
      }
      const end = match.index + 1
      if (end < 10 && match[0] !== '\n') {
        const nextMatch = SENTENCE_END_RE.exec(slice.slice(end))
        if (!nextMatch) {
          break
        }
        const totalEnd = end + nextMatch.index + 1
        spokenOffset += totalEnd
        enqueueChunk(slice.slice(0, totalEnd))
        continue
      }
      spokenOffset += end
      enqueueChunk(slice.slice(0, end))
    }
  }

  call.storeUnsubscribe = useChatStore.subscribe(syncReply)
  syncReply()

  const playbackCtx = call.playbackCtx
  const playbackAnalyser = call.playbackAnalyser
  if (playbackCtx?.state === 'suspended') {
    await playbackCtx.resume().catch(() => {})
  }

  try {
    while (!controller.signal.aborted && activeCall === call) {
      const sentence = queue.shift()
      if (!sentence) {
        if (streamFinished) {
          break
        }
        await waitForNext()
        continue
      }
      if (!playbackCtx || !playbackAnalyser) {
        continue
      }
      const { apiKey, ttsVoice } = useSettings.getState()
      const stream = await synthesize(apiKey ?? '', sentence, ttsVoice, controller.signal)
      const result = await scheduleTtsStream({
        context: playbackCtx,
        destination: playbackAnalyser,
        stream,
        signal: controller.signal,
        initialNextTime: call.nextPlayTime,
        startDelay: call.playbackSources.size === 0 ? TTS_START_DELAY : 0,
        onSource: (source) => {
          call.playbackSources.add(source)
          source.onended = () => {
            call.playbackSources.delete(source)
          }
        },
        onFirstAudio: () => {
          if (useVoiceCall.getState().phase !== 'speaking') {
            useVoiceCall.setState({ phase: 'speaking' })
          }
        },
      })
      call.nextPlayTime = result.nextTime
    }

    // 待最后一段播放完毕再恢复聆听，避免麦克风采集到扬声器输出。
    if (!controller.signal.aborted && activeCall === call && playbackCtx) {
      const remainingMs = Math.max(0, (call.nextPlayTime - playbackCtx.currentTime) * 1000)
      if (remainingMs > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, remainingMs + 120)
          controller.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              resolve()
            },
            { once: true }
          )
        })
      }
    }
  } catch (error) {
    if (!controller.signal.aborted && activeCall === call) {
      const message = describeTurnError(error)
      useVoiceCall.setState({ error: message })
      await new Promise((resolve) => setTimeout(resolve, 1200))
    }
  } finally {
    call.storeUnsubscribe?.()
    call.storeUnsubscribe = null
    if (call.turnController === controller) {
      call.turnController = null
    }
    call.replySessionId = null
  }

  if (!controller.signal.aborted && activeCall === call) {
    resumeListening(call)
  }
}

/** 用户开口打断 TTS：停播、停生成，并把已经录到的开头接回正常采集 */
const startBargeIn = (call: CallSession) => {
  if (activeCall !== call) {
    return
  }
  if (call.replySessionId) {
    stopReply(call.replySessionId)
    call.replySessionId = null
  }
  cleanupTurn(call)
  call.bargeSpeech = 0
  const frames = call.bargeFrames
  call.bargeFrames = []
  call.speakingInMic = true
  call.speechFrames = frames.length
  call.chunks = frames.slice()
  call.totalSamples = frames.length * FRAME_SIZE
  call.consecutiveSilence = 0
  useVoiceCall.setState({ phase: 'listening', speechDetected: true, error: null })
}

/** 听写/生成阶段失败：这些错误与麦克风无关，不能再用「麦克风打开失败」糊在一起 */
const describeTurnError = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.kind === 'protocol') {
      return '语音服务返回了无法识别的内容，请稍后重试'
    }
    const condition = classifyApiError(error)
    if (condition === 'unauthorized') {
      return '接口密钥无效或已过期，请到设置里检查语音接口'
    }
    if (condition === 'insufficientBalance') {
      return '语音接口余额不足，请充值后再试'
    }
    if (condition === 'rateLimited') {
      return '语音接口请求太频繁，等几秒再说'
    }
    if (condition === 'serverBusy') {
      return '语音服务暂时不可用，请稍后重试'
    }
    if (condition === 'network') {
      return '网络连接失败，检查网络后再试'
    }
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return '这一轮已取消'
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return '网络已断开，连上网络后再试'
  }
  return '这次没听清，请再说一遍'
}

const runSpeechTurn = async (call: CallSession, wav: Blob) => {
  cleanupTurn(call)
  const controller = new AbortController()
  call.turnController = controller
  useVoiceCall.setState({ phase: 'transcribing', speechDetected: false, level: 0, error: null })

  try {
    const { apiKey } = useSettings.getState()
    const transcript = (await transcribe(apiKey ?? '', wav, controller.signal)).trim()
    if (controller.signal.aborted || activeCall !== call) {
      return
    }
    if (!transcript) {
      // 服务端没返回文字时给一句明确反馈，再回到聆听；旧版本这里是静默恢复，
      // 用户会以为说话没被采集。
      const notice = '这次没听清，我还在听，再说一遍'
      useVoiceCall.setState({ error: notice, speechDetected: false, level: 0 })
      window.setTimeout(() => {
        if (
          activeCall === call &&
          !controller.signal.aborted &&
          useVoiceCall.getState().error === notice
        ) {
          resumeListening(call)
        }
      }, 1600)
      return
    }
    useVoiceCall.setState({ userText: transcript, assistantText: '', phase: 'thinking' })

    const submitted = sendVoicePrompt(useVoiceCall.getState().sessionId, transcript)
    if (!submitted) {
      resumeListening(call)
      return
    }
    call.replySessionId = submitted.sessionId
    useVoiceCall.setState({ sessionId: submitted.sessionId })
    // 无文字会话时由通话新建：首条转写同时充当列表标题，挂断后能在会话列表找到。
    noteVoiceCallMessage(transcript)
    if (matchRefusalKeyword(transcript)) {
      // 本地拒答同样走流式订阅，界面读回拒答话术
      await streamReplyWithTts(call, submitted.sessionId, submitted.replyId, controller)
      return
    }
    await streamReplyWithTts(call, submitted.sessionId, submitted.replyId, controller)
  } catch (error) {
    if (controller.signal.aborted || activeCall !== call) {
      return
    }
    const message = describeTurnError(error)
    // 密钥、余额、协议这类问题重说也不会好，停在错误态让用户去设置或重试；
    // 网络抖动与普通的没听清则自动回到聆听。
    const condition = classifyApiError(error)
    const needsAction =
      error instanceof ApiError &&
      (error.kind === 'protocol' ||
        condition === 'unauthorized' ||
        condition === 'insufficientBalance')
    if (needsAction) {
      useVoiceCall.setState({ phase: 'error', error: message })
      return
    }
    useVoiceCall.setState({ error: message, level: 0 })
    window.setTimeout(() => {
      if (
        activeCall === call &&
        !controller.signal.aborted &&
        useVoiceCall.getState().error === message
      ) {
        resumeListening(call)
      }
    }, 1600)
  }
}

const flushCapturedSpeech = (call: CallSession) => {
  if (!call.speakingInMic || call.speechFrames < MIN_SPEECH_FRAMES || call.totalSamples === 0) {
    resetVad(call)
    return
  }
  const chunks = call.chunks
  const totalSamples = call.totalSamples
  resetVad(call)
  const wav = encodeWav(chunks, totalSamples, call.captureRate)
  void runSpeechTurn(call, wav)
}

/**
 * 进入通话页前先取得录音授权：
 * Android 走原生 requestMicrophone（同时解决 WebView 默认拒绝录音的问题），
 * 浏览器先调用一次 getUserMedia，取得后立即释放，避免进入页面后才失败。
 */
export const ensureMicrophonePermission = (): Promise<boolean> => {
  const bridge = (window as Window & { DeepSeekAndroid?: { requestMicrophone?: () => void } })
    .DeepSeekAndroid
  if (typeof bridge?.requestMicrophone === 'function') {
    const host = bridge as { requestMicrophone: () => void }
    return new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (allowed: boolean) => {
        if (settled) {
          return
        }
        settled = true
        window.clearTimeout(timer)
        window.removeEventListener('android-microphone', onResult)
        resolve(allowed)
      }
      const onResult = (event: Event) => {
        finish((event as CustomEvent<string>).detail === 'granted')
      }
      const timer = window.setTimeout(() => finish(false), 15_000)
      window.addEventListener('android-microphone', onResult)
      // 必须通过注入对象本身的属性调用：取出方法再调用会丢失宿主对象，
      // WebView 报 "Java bridge method can't be invoked on a non-injected object"。
      try {
        host.requestMicrophone()
      } catch {
        finish(false)
      }
    })
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.resolve(false)
  }
  return navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      for (const track of stream.getTracks()) {
        track.stop()
      }
      return true
    })
    .catch(() => false)
}

export const startVoiceCall = (sessionId: string | null) => {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    useVoiceCall.setState({
      active: true,
      sessionId,
      phase: 'error',
      error: '当前页面不是安全上下文，无法录音',
    })
    return
  }
  if (activeCall) {
    teardownCall(activeCall)
  }
  setReadAloudBlocked(true)
  stopReadAloud()
  // 进入通话先清场：停掉可能仍在排队的合成语音，再放掉语音输入那条路持有的 AudioRecord。
  // 通道释放有延迟，这里不等待，后续采集本身带三次退避重试。
  try {
    window.speechSynthesis?.cancel()
  } catch {
    // 没有合成器时忽略
  }
  try {
    const bridge = (window as Window & { DeepSeekAndroid?: { releaseNativeRecorder?: () => boolean } })
      .DeepSeekAndroid
    bridge?.releaseNativeRecorder?.()
  } catch {
    // 桌面环境没有桥
  }

  const epoch = ++callEpoch
  const call: CallSession = {
    epoch,
    stream: null,
    captureCtx: null,
    captureSource: null,
    captureProcessor: null,
    nativeCapture: null,
    playbackCtx: null,
    playbackAnalyser: null,
    playbackSources: new Set(),
    nextPlayTime: 0,
    levelFrame: 0,
    turnController: null,
    storeUnsubscribe: null,
    replySessionId: null,
    preRoll: [],
    bargeFrames: [],
    bargeSpeech: 0,
    chunks: [],
    totalSamples: 0,
    captureRate: SAMPLE_RATE,
    maxCaptureFrames: MAX_CAPTURE_FRAMES,
    speechFrames: 0,
    consecutiveSpeech: 0,
    consecutiveSilence: 0,
    speakingInMic: false,
  }
  activeCall = call

  // 优先用点击电话按钮时同步建好的上下文；没有预热时才新建。
  let playbackCtx: AudioContext
  if (primedPlaybackCtx && primedPlaybackCtx.state !== 'closed') {
    playbackCtx = primedPlaybackCtx
  } else {
    try {
      playbackCtx = new AudioContext({ sampleRate: 24000 })
    } catch {
      try {
        playbackCtx = new AudioContext()
      } catch (error) {
        useVoiceCall.setState({
          active: true,
          sessionId,
          phase: 'error',
          error: `音频初始化失败：${error instanceof Error ? error.message : String(error)}`,
        })
        return
      }
    }
  }
  primedPlaybackCtx = null
  const playbackAnalyser = playbackCtx.createAnalyser()
  playbackAnalyser.fftSize = 256
  playbackAnalyser.connect(playbackCtx.destination)
  call.playbackCtx = playbackCtx
  call.playbackAnalyser = playbackAnalyser
  if (playbackCtx.state === 'suspended') {
    void playbackCtx.resume().catch(() => {})
  }

  useVoiceCall.setState({
    active: true,
    sessionId,
    phase: 'listening',
    micReady: 'pending',
    muted: false,
    speechDetected: false,
    level: 0,
    userText: '',
    assistantText: '',
    error: null,
  })

  const freqData = new Uint8Array(playbackAnalyser.frequencyBinCount)
  const updateSpeakingLevel = () => {
    if (activeCall !== call || callEpoch !== epoch) {
      return
    }
    if (useVoiceCall.getState().phase === 'speaking' && call.playbackAnalyser) {
      call.playbackAnalyser.getByteFrequencyData(freqData)
      let sum = 0
      for (let i = 0; i < freqData.length; i++) {
        sum += freqData[i]
      }
      useVoiceCall.setState({ level: Math.min(1, sum / (freqData.length * 80)) })
    }
    call.levelFrame = requestAnimationFrame(updateSpeakingLevel)
  }
  call.levelFrame = requestAnimationFrame(updateSpeakingLevel)

  if (!navigator.mediaDevices?.getUserMedia) {
    useVoiceCall.setState({ phase: 'error', error: '当前环境不支持录音' })
    return
  }

  void startCapture(call, epoch)
}

/** 一帧 PCM 的断句逻辑：页面采集与系统直录共用，避免两条链路行为不一致 */
const processCaptureFrame = (call: CallSession, frame: Float32Array) => {
  const { phase, muted } = useVoiceCall.getState()
  if (muted) {
    return
  }
  const rms = computeRms(frame)

  if (phase === 'speaking') {
    // 播放中保持一小段滚动缓冲，判定插话后能把你已经说出的开头接上
    if (call.playbackSources.size > 0) {
      call.bargeFrames.push(frame)
      if (call.bargeFrames.length > 4) {
        call.bargeFrames.shift()
      }
      if (rms >= BARGE_RMS_THRESHOLD) {
        call.bargeSpeech++
        if (call.bargeSpeech >= BARGE_START_FRAMES) {
          startBargeIn(call)
        }
      } else {
        call.bargeSpeech = 0
      }
    }
    return
  }

  if (phase !== 'listening') {
    return
  }
  useVoiceCall.setState({ level: Math.min(1, rms * 10) })

  if (!call.speakingInMic) {
    call.preRoll.push(frame)
    if (call.preRoll.length > PRE_ROLL_FRAMES) {
      call.preRoll.shift()
    }
    if (rms >= SPEECH_RMS_THRESHOLD) {
      call.consecutiveSpeech++
      if (call.consecutiveSpeech >= SPEECH_START_FRAMES) {
        call.speakingInMic = true
        call.speechFrames = call.preRoll.length
        call.chunks = [...call.preRoll]
        call.totalSamples = call.preRoll.length * frame.length
        call.preRoll = []
        call.consecutiveSilence = 0
        useVoiceCall.setState({ speechDetected: true, error: null })
      }
    } else {
      call.consecutiveSpeech = 0
    }
    return
  }

  call.chunks.push(frame)
  call.totalSamples += frame.length
  if (rms >= SILENCE_RMS_THRESHOLD) {
    call.speechFrames++
    call.consecutiveSilence = 0
  } else {
    call.consecutiveSilence++
  }
  if (
    call.consecutiveSilence >= SILENCE_END_FRAMES ||
    call.chunks.length >= call.maxCaptureFrames
  ) {
    flushCapturedSpeech(call)
  }
}

/** 把已打开的麦克风流接入 VAD 采集链；采样率与帧上限按上下文实际值计算 */
const attachCapture = (call: CallSession, stream: MediaStream, epoch: number) => {
  if (activeCall !== call || callEpoch !== epoch) {
    for (const track of stream.getTracks()) {
      track.stop()
    }
    return
  }
  // 媒体流返回了但音轨未处于活动状态：多见于通道刚被释放或系统回收，
  // 此时接入采集只会得到空数据，直接释放并提示重试。
  const audioTrack = stream.getAudioTracks()[0]
  if (!audioTrack || audioTrack.readyState !== 'live') {
    for (const track of stream.getTracks()) {
      track.stop()
    }
    call.stream = null
    useVoiceCall.setState({
      active: true,
      phase: 'error',
      micReady: 'failed',
      error: '麦克风通道未就绪，已释放设备；请点重试',
    })
    return
  }
  // 采集上下文单独初始化：构造失败属于音频引擎问题，不能归为麦克风失败
  let captureCtx: AudioContext
  try {
    captureCtx = createCaptureContext()
  } catch (error) {
    for (const track of stream.getTracks()) {
      track.stop()
    }
    call.stream = null
    useVoiceCall.setState({
      active: true,
      phase: 'error',
      micReady: 'failed',
      error: `音频引擎初始化失败：${
        error instanceof Error ? error.message : String(error)
      }`,
    })
    return
  }
  call.stream = stream
  call.captureRate = captureCtx.sampleRate
  call.maxCaptureFrames = maxCaptureFramesFor(captureCtx.sampleRate)
  const captureSource = captureCtx.createMediaStreamSource(stream)
  const captureProcessor = captureCtx.createScriptProcessor(FRAME_SIZE, 1, 1)
  call.captureCtx = captureCtx
  call.captureSource = captureSource
  call.captureProcessor = captureProcessor

  captureProcessor.onaudioprocess = (event) => {
    if (activeCall !== call || callEpoch !== epoch) {
      return
    }
    processCaptureFrame(call, new Float32Array(event.inputBuffer.getChannelData(0)))
  }

  captureSource.connect(captureProcessor)
  captureProcessor.connect(captureCtx.destination)
  if (captureCtx.state === 'suspended') {
    void captureCtx.resume().catch(() => {})
  }
  // 采集链建成后回写就绪状态，界面据此显示麦克风指示。
  // 部分 ROM 会在亮屏/熄屏切换、系统回收或音频模式变化时把音轨置为 ended，
  // 此前只把状态改成 failed，通话就停在错误页；这里自行重建一次采集，成功则无缝继续。
  let recovering = false
  const recoverCapture = () => {
    if (recovering || activeCall !== call || callEpoch !== epoch) {
      return
    }
    recovering = true
    useVoiceCall.setState({ micReady: 'pending', error: '麦克风信号中断，正在重新连接…' })
    try {
      call.captureProcessor?.disconnect()
      call.captureSource?.disconnect()
      call.stream?.getTracks().forEach((track) => track.stop())
      void call.captureCtx?.close().catch(() => {})
    } catch {
      // 旧采集链已经失效，清不掉也不影响后面的新链路
    }
    call.captureProcessor = null
    call.captureSource = null
    call.captureCtx = null
    call.stream = null
    window.setTimeout(() => {
      if (activeCall !== call || callEpoch !== epoch) {
        return
      }
      void startCapture(call, epoch).finally(() => {
        recovering = false
      })
    }, 600)
  }
  audioTrack.onended = recoverCapture
  audioTrack.onmute = recoverCapture
  requestAudioBridge()
  useVoiceCall.setState({ micReady: 'ready', error: null })
}

/**
 * Android 上系统已授予录音权限、但 WebView 的页面请求未被放行时，
 * 向宿主再确认一次授权状态并重试采集；宿主立即回报 granted 才重试，避免无意义重复弹框。
 */
const retryMicrophoneAfterHostGrant = async (error: unknown): Promise<MediaStream | null> => {
  const denied = error instanceof Error && error.name === 'NotAllowedError'
  if (!denied) {
    return null
  }
  const host = (window as Window & { DeepSeekAndroid?: { requestMicrophone?: () => void } })
    .DeepSeekAndroid
  if (typeof host?.requestMicrophone !== 'function') {
    return null
  }
  const granted = await new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(timer)
      window.removeEventListener('android-microphone', onResult)
      resolve(value)
    }
    const onResult = (event: Event) => finish((event as CustomEvent<string>).detail === 'granted')
    const timer = window.setTimeout(() => finish(false), 1500)
    window.addEventListener('android-microphone', onResult)
    try {
      // 必须经宿主对象调用，直接取方法会丢失注入桥的 this
      host.requestMicrophone!()
    } catch {
      finish(false)
    }
  })
  if (!granted) {
    return null
  }
  try {
    return await openMicrophoneStream()
  } catch {
    return null
  }
}

/** 系统直录桥：WebView 采集被 ROM 拦截时的兜底通道 */
type CallCaptureBridge = {
  startCallCapture?: () => boolean
  readCallCapture?: () => string
  stopCallCapture?: () => void
  callCaptureStatus?: () => string
}

const callCaptureBridge = (): CallCaptureBridge | undefined =>
  (window as Window & { DeepSeekAndroid?: CallCaptureBridge }).DeepSeekAndroid

const stopNativeCapture = (call: CallSession) => {
  const native = call.nativeCapture
  if (!native) {
    return
  }
  call.nativeCapture = null
  window.clearInterval(native.timer)
  try {
    callCaptureBridge()?.stopCallCapture?.()
  } catch {
    // 宿主已销毁时忽略释放异常
  }
}

/** 原生通道输出 PCM16LE 的 Base64，转换为与页面采集一致的 [-1, 1] 浮点样本 */
const decodeNativePcm = (value: string): Float32Array => {
  const binary = atob(value)
  const length = Math.floor(binary.length / 2)
  const samples = new Float32Array(length)
  for (let index = 0; index < length; index++) {
    const low = binary.charCodeAt(index * 2)
    const high = binary.charCodeAt(index * 2 + 1)
    const signed = (high << 8) | low
    samples[index] = (signed & 0x8000 ? signed - 0x10000 : signed) / 0x8000
  }
  return samples
}

/**
 * 启动系统直录并轮询 PCM。原生线程按 2,048 样本一块采集，轮询取回后重新切成
 * 同样的帧长，沿用页面的能量阈值、预卷缓冲与静音断句。
 *
 * 读取异常或连续两秒没有拿到 PCM 时，先重建一次原生通道；重建两次仍失败才结束通话，
 * 避免一次系统回收就让整个界面停在错误页。
 */
const startNativeCapture = (call: CallSession, epoch: number, restarts = 0): boolean => {
  if (activeCall !== call || callEpoch !== epoch) {
    return false
  }
  const bridge = callCaptureBridge()
  if (typeof bridge?.startCallCapture !== 'function' || typeof bridge.readCallCapture !== 'function') {
    return false
  }
  const start = bridge.startCallCapture.bind(bridge)
  const read = bridge.readCallCapture.bind(bridge)
  const status = typeof bridge.callCaptureStatus === 'function' ? bridge.callCaptureStatus.bind(bridge) : null
  stopNativeCapture(call)
  let started = false
  try {
    started = start()
  } catch {
    started = false
  }
  if (!started) {
    return false
  }
  call.captureRate = SAMPLE_RATE
  call.maxCaptureFrames = MAX_CAPTURE_FRAMES
  const native: NativeCallCapture = {
    timer: 0,
    carry: new Float32Array(0),
    failures: 0,
    emptyPolls: 0,
    restarts,
  }
  call.nativeCapture = native
  const currentPhase = useVoiceCall.getState().phase
  const busyPhase =
    currentPhase === 'speaking' || currentPhase === 'thinking' || currentPhase === 'transcribing'
  useVoiceCall.setState({
    phase: busyPhase ? currentPhase : 'listening',
    micReady: 'ready',
    level: 0,
    error: null,
  })
  requestAudioBridge()

  const failNative = (message: string) => {
    native.failures++
    if (native.failures < 4) {
      return
    }
    if (native.restarts < 2 && startNativeCapture(call, epoch, native.restarts + 1)) {
      return
    }
    stopNativeCapture(call)
    useVoiceCall.setState({
      phase: 'error',
      micReady: 'failed',
      error: message,
    })
  }

  native.timer = window.setInterval(() => {
    if (activeCall !== call || callEpoch !== epoch || call.nativeCapture !== native) {
      stopNativeCapture(call)
      return
    }
    let payload = ''
    try {
      payload = read()
    } catch {
      failNative('系统直录通道中断，请点重试')
      return
    }
    if (payload.startsWith('ERR|')) {
      failNative('系统直录通道中断，请点重试')
      return
    }
    if (!payload) {
      native.emptyPolls++
      // 正常采集约 128 ms 产出一块；连续两秒没有数据说明线程已停或设备被回收。
      if (native.emptyPolls >= 22) {
        let report = ''
        try {
          report = status?.() ?? ''
        } catch {
          report = ''
        }
        if (!report || report.startsWith('0|') || native.restarts < 2) {
          if (native.restarts < 2 && startNativeCapture(call, epoch, native.restarts + 1)) {
            return
          }
        }
        stopNativeCapture(call)
        useVoiceCall.setState({
          phase: 'error',
          micReady: 'failed',
          error: '系统直录没有返回音频，请点重试',
        })
      }
      return
    }
    native.emptyPolls = 0
    native.failures = 0
    let pcm: Float32Array
    try {
      pcm = decodeNativePcm(payload)
    } catch {
      failNative('系统直录数据无法解码，请点重试')
      return
    }
    if (pcm.length === 0) {
      return
    }
    const merged = new Float32Array(native.carry.length + pcm.length)
    merged.set(native.carry, 0)
    merged.set(pcm, native.carry.length)
    let offset = 0
    while (merged.length - offset >= FRAME_SIZE) {
      processCaptureFrame(call, merged.subarray(offset, offset + FRAME_SIZE))
      offset += FRAME_SIZE
    }
    native.carry = merged.slice(offset)
  }, 95)
  return true
}

const startCapture = async (call: CallSession, epoch: number) => {
  let stream: MediaStream
  try {
    stream = await openMicrophoneStream()
  } catch (error) {
    const retried = await retryMicrophoneAfterHostGrant(error)
    if (!retried) {
      // 系统通道自检可用、WebView 仍拿不到流时，直接用原生采集继续通话
      if (readMicProbe()?.ok && startNativeCapture(call, epoch)) {
        return
      }
      if (activeCall === call && callEpoch === epoch) {
        useVoiceCall.setState({
          phase: 'error',
          micReady: 'failed',
          error: describeMicFailure(error),
        })
      }
      return
    }
    stream = retried
  }
  if (activeCall !== call || callEpoch !== epoch) {
    for (const track of stream.getTracks()) {
      track.stop()
    }
    return
  }
  attachCapture(call, stream, epoch)
}

/** 错误态重试：保留会话，重新建音频与采集 */
export const retryVoiceCall = () => {
  const { sessionId } = useVoiceCall.getState()
  startVoiceCall(sessionId)
}

export const toggleVoiceCallMute = () => {
  const call = activeCall
  if (!call) {
    return
  }
  const { muted, phase } = useVoiceCall.getState()
  if (!muted) {
    resetVad(call)
    useVoiceCall.setState({ muted: true, phase: phase === 'listening' ? 'muted' : phase, level: 0 })
  } else {
    useVoiceCall.setState({ muted: false, phase: phase === 'muted' ? 'listening' : phase })
  }
}

export const flushVoiceCallSpeech = () => {
  const call = activeCall
  if (!call || useVoiceCall.getState().phase !== 'listening') {
    return
  }
  flushCapturedSpeech(call)
}

export const interruptVoiceCall = () => {
  const call = activeCall
  if (!call) {
    return
  }
  const { phase } = useVoiceCall.getState()
  if (phase === 'thinking' || phase === 'speaking' || phase === 'transcribing') {
    if (call.replySessionId) {
      stopReply(call.replySessionId)
      call.replySessionId = null
    }
    cleanupTurn(call)
    resumeListening(call)
  } else if (phase === 'listening' && call.speakingInMic) {
    flushCapturedSpeech(call)
  }
}

export const endVoiceCall = () => {
  setReadAloudBlocked(false)
  const call = activeCall
  if (call) {
    if (call.replySessionId) {
      stopReply(call.replySessionId)
    }
    teardownCall(call)
  }
  useVoiceCall.setState({
    active: false,
    phase: 'idle',
    micReady: 'idle',
    muted: false,
    speechDetected: false,
    level: 0,
    userText: '',
    assistantText: '',
    error: null,
  })
}

/** 通话里新会话没有标题时，用第一条转写补一个，方便回列表能找到 */
export const noteVoiceCallMessage = (text: string) => {
  const { sessionId } = useVoiceCall.getState()
  if (!sessionId) {
    return
  }
  const store = useChatStore.getState()
  const session = store.sessionCache[sessionId]
  if (!session || session.title) {
    return
  }
  const preview = Array.from(text.trim()).slice(0, 40).join('')
  useChatStore.setState((state) => ({
    sessionCache: {
      ...state.sessionCache,
      [sessionId]: { ...session, title: preview },
    },
    sessions: state.sessions.map((item) =>
      item.id === sessionId ? { ...item, title: preview } : item
    ),
  }))
}

// 避免未使用告警：createId 保留给后续扩展通话附件时使用
void createId


/** 页面切后台/锁屏时释放麦克风与播放，避免占用录音通道 */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && activeCall) {
      endVoiceCall()
    }
  })
}
