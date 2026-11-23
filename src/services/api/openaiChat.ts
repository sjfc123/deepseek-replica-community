import type { ChatApiFormat } from './chatConfig.js'
import type {
  CreateMessageRequest,
  MessageParam,
  MessageUsage,
  StopReason,
  UserBlockParam,
} from './types.js'

type OpenAIFormat = Exclude<ChatApiFormat, 'messages'>

const userPart = (format: OpenAIFormat, block: UserBlockParam, deepSeek: boolean) => {
  if (block.type === 'text') {
    return { type: format === 'chat' ? 'text' : 'input_text', text: block.text }
  }
  const { source } = block
  if (source.type === 'file') {
    if (!deepSeek) {
      return null
    }
    const type = format === 'chat' ? 'file' : block.type === 'image' ? 'input_image' : 'input_file'
    return { type, file_id: source.file_id }
  }
  const url = `data:${source.media_type};base64,${source.data}`
  if (block.type === 'image') {
    return format === 'chat'
      ? { type: 'image_url', image_url: { url } }
      : { type: 'input_image', image_url: url, detail: 'auto' }
  }
  return format === 'responses' && 'title' in block
    ? { type: 'input_file', filename: block.title, file_data: url }
    : null
}

export const openAIRequest = (
  format: OpenAIFormat,
  body: CreateMessageRequest,
  deepSeek: boolean
) => {
  type InputMessage = {
    role: MessageParam['role']
    content: string | NonNullable<ReturnType<typeof userPart>>[]
  }
  const messages = body.messages.flatMap<InputMessage>(({ role, content }) => {
    if (role === 'latest_reminder') {
      return deepSeek && format === 'chat' ? [{ role, content }] : []
    }
    if (typeof content === 'string') {
      return [{ role, content }]
    }
    const parts =
      role === 'assistant'
        ? content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
        : content.map((block) => userPart(format, block, deepSeek)).filter((part) => part !== null)
    return parts.length ? [{ role, content: parts }] : []
  })

  const common = {
    model: body.model,
    stream: true,
    ...(body.reasoning_effort ? { reasoning_effort: body.reasoning_effort } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(deepSeek
      ? {
          safety_check: body.safety_check,
          title: body.title,
          tools: body.tools?.map(({ type }) => ({ type })),
        }
      : {}),
  }
  if (format === 'chat') {
    return {
      ...common,
      messages: body.system ? [{ role: 'system', content: body.system }, ...messages] : messages,
      ...(deepSeek
        ? { max_tokens: body.max_tokens, thinking: body.thinking }
        : { max_completion_tokens: body.max_tokens }),
    }
  }
  return {
    ...common,
    input: messages,
    instructions: body.system || undefined,
    max_output_tokens: body.max_tokens,
    reasoning: body.reasoning_effort
      ? { effort: body.reasoning_effort }
      : deepSeek
        ? { effort: body.thinking.type === 'enabled' ? 'high' : 'none' }
        : undefined,
    store: false,
  }
}

type OpenAIFrame = {
  text?: string
  thinking?: string
  stop?: StopReason
  done?: boolean
  usage?: MessageUsage
  title?: string
  error?: { message: string; code?: string }
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

const asString = (value: unknown) => (typeof value === 'string' ? value : undefined)

const openAIUsage = (value: unknown, format: OpenAIFormat): MessageUsage | undefined => {
  const usage = record(value)
  const input = format === 'chat' ? usage.prompt_tokens : usage.input_tokens
  const output = format === 'chat' ? usage.completion_tokens : usage.output_tokens
  const details = format === 'chat' ? usage.prompt_tokens_details : usage.input_tokens_details
  const cached = record(details).cached_tokens
  if (typeof input !== 'number' || typeof output !== 'number') {
    return
  }
  const cache = typeof cached === 'number' ? cached : 0
  return {
    input_tokens: Math.max(0, input - cache),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cache,
    output_tokens: output,
  }
}

const stopReasons: Record<string, StopReason> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  content_filter: 'refusal',
}

const readChatChunk = (payload: Record<string, unknown>): OpenAIFrame => {
  const choice = record(Array.isArray(payload.choices) ? payload.choices[0] : null)
  const delta = record(choice.delta)
  const finish = asString(choice.finish_reason)
  return {
    text: asString(delta.content) ?? asString(delta.refusal),
    thinking: asString(delta.reasoning_content) ?? asString(delta.reasoning),
    stop: finish && Object.hasOwn(stopReasons, finish) ? stopReasons[finish] : undefined,
    usage: openAIUsage(payload.usage, 'chat'),
    title: asString(delta.title),
  }
}

const readResponseEvent = (payload: Record<string, unknown>): OpenAIFrame => {
  const response = record(payload.response)
  switch (payload.type) {
    case 'response.output_text.delta':
    case 'response.refusal.delta':
      return { text: asString(payload.delta) }
    case 'response.reasoning_text.delta':
    case 'response.reasoning_summary_text.delta':
      return { thinking: asString(payload.delta) }
    case 'response.completed':
      return {
        done: true,
        stop: 'end_turn',
        usage: openAIUsage(response.usage, 'responses'),
        title: asString(response.title),
      }
    case 'response.incomplete': {
      const reason = record(response.incomplete_details).reason
      return {
        done: true,
        stop: reason === 'content_filter' ? 'refusal' : 'max_tokens',
        usage: openAIUsage(response.usage, 'responses'),
        title: asString(response.title),
      }
    }
    case 'response.failed':
    case 'error': {
      const error = payload.type === 'error' ? payload : record(response.error)
      return {
        error: { message: asString(error.message) ?? '', code: asString(error.code) },
      }
    }
    default:
      return {}
  }
}

export const readOpenAIFrame = (format: OpenAIFormat, payload: unknown): OpenAIFrame =>
  format === 'chat' ? readChatChunk(record(payload)) : readResponseEvent(record(payload))
