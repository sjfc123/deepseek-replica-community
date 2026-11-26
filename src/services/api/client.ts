/* ============================================================================
 * 功能区：模型接口 / client 开始
 * 职责：模型请求客户端：协议分发、流式读取、取消与错误归一化。
 * ========================================================================== */

import { android } from '../../app/android.js'
import { translate, type TranslationMessage } from '../../i18n/index.js'
import { CHAT_API_PATHS, type ChatConfig } from './chatConfig.js'
import { openAIRequest, readOpenAIFrame } from './openaiChat.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
  MessageUsage,
  StopReason,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__
/** Anthropic 兼容接口的前缀 */
const ANTHROPIC_BASE_URL = `${API_ORIGIN}/anthropic/v1`
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number,
    readonly code?: string
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  let code: string | undefined
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
      code = typeof body.error.code === 'string' ? body.error.code : undefined
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status, code)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** 用 GET /models 校验 API Key（不产生费用） */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  await request(`${API_ORIGIN}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${ANTHROPIC_BASE_URL}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (
  apiKey: string,
  fileId: string,
  signal?: AbortSignal
): Promise<void> => {
  await request(`${ANTHROPIC_BASE_URL}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
    signal,
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      message.role === 'user' &&
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type !== 'text' && block.source.type === 'file')
  )

const openMessageStream = (apiKey: string, body: CreateMessageRequest, signal: AbortSignal) =>
  request(`${ANTHROPIC_BASE_URL}/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })

const withDeepSeekExtensionsFallback = (
  body: CreateMessageRequest,
  send: (requestBody: CreateMessageRequest) => Promise<Response>
) =>
  send(body).catch((error: unknown) => {
    if (
      !(body.tools?.length || body.safety_check || body.title?.enabled) ||
      !(error instanceof ApiError) ||
      error.status !== 400 ||
      !/\buser input too long, \d+ tokens exceeds max 32768 tokens\b/i.test(error.message)
    ) {
      throw error
    }
    // 扩展模式在生成前拒绝长输入时，用同一协议的基础模式发送同一上下文。
    return send({ ...body, tools: undefined, safety_check: undefined, title: undefined })
  })

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
async function* streamMessage(apiKey: string, body: CreateMessageRequest, signal: AbortSignal) {
  const response = await withDeepSeekExtensionsFallback(body, (requestBody) =>
    openMessageStream(apiKey, requestBody, signal)
  )
  yield* readAnthropicStream(response, signal)
}

async function* readStreamPayloads(response: Response, signal: AbortSignal) {
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.toLowerCase().includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    signal.throwIfAborted()
    if (data === '[DONE]') {
      yield { done: true } as const
      return
    }
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      const { message, code } = payload.error
      throw new ApiError('stream', message, undefined, typeof code === 'string' ? code : undefined)
    }
    if (eventName === 'error' && !payload) {
      throw new ApiError('stream', data)
    }
    yield { done: false, payload, eventName, data } as const
  }
  signal.throwIfAborted()
}

async function* readAnthropicStream(response: Response, signal: AbortSignal) {
  for await (const frame of readStreamPayloads(response, signal)) {
    if (frame.done) {
      break
    }
    const { payload, eventName, data } = frame
    if (eventName === 'error') {
      const detail = payload as { error?: { message?: unknown; type?: unknown } } | null
      const error = detail?.error
      throw new ApiError(
        'stream',
        typeof error?.message === 'string' ? error.message : data,
        undefined,
        typeof error?.type === 'string' ? error.type : undefined
      )
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}

const customMessagesRequest = ({
  model,
  system,
  messages,
  max_tokens,
  thinking,
  temperature,
  top_p,
}: CreateMessageRequest) => ({
  model,
  system: system.trim() ? system : undefined,
  max_tokens,
  // 自定义 Anthropic Messages 端点同样要带思考开关，否则上游按默认开启处理。
  thinking,
  ...(temperature !== undefined ? { temperature } : {}),
  ...(top_p !== undefined ? { top_p } : {}),
  messages: messages.flatMap((message): CreateMessageRequest['messages'] => {
    if (message.role === 'latest_reminder') {
      return []
    }
    if (message.role === 'assistant') {
      const content = message.content.filter((block) => block.type === 'text')
      return content.length ? [{ ...message, content }] : []
    }
    return [message]
  }),
  stream: true,
})

type NativeChatEvent = { id: string } & (
  | { type: 'headers'; status: number; mime: string }
  | { type: 'data'; bytes: string }
  | { type: 'end' | 'error' }
)

const openAndroidChat = (
  device: NonNullable<typeof android>,
  config: ChatConfig,
  body: string,
  signal: AbortSignal,
  headers: string
) => {
  let id: string | null = null
  let headersReceived = false
  let receiver: ReadableStreamDefaultController<Uint8Array>
  let resolve: (response: Response) => void
  let reject: (error: unknown) => void
  const response = new Promise<Response>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  const close = () => {
    window.removeEventListener('android-custom-chat', onChunk)
    signal.removeEventListener('abort', onAbort)
    if (id) {
      device.cancelChatRequest(id)
      id = null
    }
  }
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      receiver = controller
    },
    cancel: close,
  })
  const fail = (error: unknown) => {
    close()
    if (headersReceived) {
      receiver.error(error)
    } else {
      reject(error)
    }
  }
  const onAbort = () => fail(signal.reason)
  const onChunk = (event: Event) => {
    const chunk = (event as CustomEvent<NativeChatEvent>).detail
    if (chunk?.id !== id) {
      return
    }
    switch (chunk.type) {
      case 'headers': {
        headersReceived = true
        const bodyStream = chunk.status === 204 || chunk.status === 205 ? null : stream
        resolve(
          new Response(bodyStream, {
            status: chunk.status,
            headers: { 'Content-Type': chunk.mime },
          })
        )
        break
      }
      case 'data':
        receiver.enqueue(Uint8Array.from(atob(chunk.bytes), (char) => char.charCodeAt(0)))
        break
      case 'end':
        close()
        receiver.close()
        break
      case 'error':
        fail(new ApiError('network', ''))
        break
    }
  }
  window.addEventListener('android-custom-chat', onChunk)
  signal.addEventListener('abort', onAbort, { once: true })
  id = device.beginChatRequest(config.endpoint, config.format, body, headers)
  if (!id) {
    fail(new ApiError('protocol', { key: 'advancedConnectionChanged' }))
  }
  return { response, close }
}

export const streamChatMessage = (
  config: ChatConfig,
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  customHeaders: Record<string, string> = {},
  onWireBody?: (wireBody: unknown) => void
) => {
  const headers = JSON.stringify(customHeaders)
  if (config.endpoint) {
    return streamCompatibleMessage(config, body, signal, false, headers, onWireBody)
  }
  if (config.format === 'messages') {
    return streamMessage(apiKey, body, signal)
  }
  const endpoint = `${API_ORIGIN}${CHAT_API_PATHS[config.format]}`
  return streamCompatibleMessage({ ...config, endpoint, apiKey }, body, signal, true, headers, onWireBody)
}

/** 原生传回的是 JSON 字符串；解析失败按没有自定义头处理 */
const parseHeadersJson = (value: string): Record<string, string> => {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
  } catch {
    return {}
  }
}

async function* streamCompatibleMessage(
  config: ChatConfig,
  body: CreateMessageRequest,
  signal: AbortSignal,
  deepSeek: boolean,
  headers: string,
  onWireBody?: (wireBody: unknown) => void
): AsyncGenerator<MessageStreamEvent> {
  const { endpoint, format, apiKey } = config
  const extraHeaders = parseHeadersJson(headers)
  const buildRequest = (requestBody: CreateMessageRequest) =>
    format === 'messages'
      ? customMessagesRequest(requestBody)
      : openAIRequest(format, requestBody, deepSeek)
  const serialize = (requestBody: CreateMessageRequest) => JSON.stringify(buildRequest(requestBody))
  signal.throwIfAborted()
  const wireBody = buildRequest(body)
  const serializedBody = JSON.stringify(wireBody)
  onWireBody?.(wireBody)
  const native =
    android && !deepSeek
      ? openAndroidChat(android, config, serializedBody, signal, headers)
      : undefined
  try {
    const send = (requestBody: CreateMessageRequest) =>
      request(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(format === 'messages'
            ? {
                'anthropic-version': '2023-06-01',
                ...(apiKey ? { 'x-api-key': apiKey } : {}),
                ...(new URL(endpoint).hostname === 'api.anthropic.com'
                  ? { 'anthropic-dangerous-direct-browser-access': 'true' }
                  : {}),
              }
            : apiKey
              ? { Authorization: `Bearer ${apiKey}` }
              : {}),
          ...extraHeaders,
        },
        body: serialize(requestBody),
        credentials: 'omit',
        redirect: 'error',
        signal,
      })
    const response = native
      ? await native.response
      : deepSeek
        ? await withDeepSeekExtensionsFallback(body, send)
        : await send(body)
    if (!response.ok) {
      throw await readErrorResponse(response, 'http', `HTTP ${response.status}`)
    }
    if (format === 'messages') {
      yield* readAnthropicStream(response, signal)
      return
    }
    let block: 'text' | 'thinking' | undefined
    let index = -1
    let stop: StopReason | undefined
    let usage: MessageUsage | undefined
    let title: string | undefined
    let complete = false
    for await (const packet of readStreamPayloads(response, signal)) {
      if (packet.done) {
        complete = format === 'chat' && (index >= 0 || stop !== undefined)
        break
      }
      const frame = readOpenAIFrame(format, packet.payload)
      if (frame.error) {
        throw new ApiError('stream', frame.error.message, undefined, frame.error.code)
      }
      if (packet.eventName === 'error') {
        throw new ApiError('stream', packet.data)
      }
      const deltas = [
        ['thinking', frame.thinking],
        ['text', frame.text],
      ] as const
      for (const [type, delta] of deltas) {
        if (!delta) {
          continue
        }
        if (block !== type) {
          if (block) {
            yield { type: 'content_block_stop', index }
          }
          block = type
          index += 1
          yield {
            type: 'content_block_start',
            index,
            content_block:
              type === 'text' ? { type, text: '' } : { type, thinking: '', signature: '' },
          }
        }
        yield {
          type: 'content_block_delta',
          index,
          delta:
            type === 'text'
              ? { type: 'text_delta', text: delta }
              : { type: 'thinking_delta', thinking: delta },
        }
      }
      stop = frame.stop ?? stop
      usage = frame.usage ?? usage
      title = frame.title ?? title
      if (frame.done) {
        complete = true
        break
      }
    }
    if (!complete && !(format === 'chat' && stop)) {
      throw new ApiError('interrupted', '')
    }
    if (block) {
      yield { type: 'content_block_stop', index }
    }
    yield {
      type: 'message_delta',
      delta: { stop_reason: stop ?? 'end_turn', stop_sequence: null, title },
      usage,
    }
    yield { type: 'message_stop' }
  } finally {
    native?.close()
  }
}

/* ============================================================================
 * 功能区：模型接口 / client 结束
 * ========================================================================== */
