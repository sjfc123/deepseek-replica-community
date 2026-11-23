export const DEFAULT_CHAT_MODEL = 'deepseek-flash'

export const CHAT_API_FORMATS = {
  messages: 'Anthropic Messages',
  chat: 'OpenAI Chat Completions',
  responses: 'OpenAI Responses',
} as const

export type ChatApiFormat = keyof typeof CHAT_API_FORMATS
/** endpoint 保存实际请求地址，供网页与 Android 共用。 */
export type ChatConfig = {
  model: string
  endpoint: string
  format: ChatApiFormat
  apiKey: string
  /** 生成配图使用的模型名，留空则按 gpt-image-1 请求 */
  imageModel?: string
  /** 生成配图的尺寸，留空则按 1024x1024 请求 */
  imageSize?: string
}

export const CHAT_API_PATHS: Record<ChatApiFormat, string> = {
  messages: '/messages',
  chat: '/chat/completions',
  responses: '/responses',
}

export const DEFAULT_CHAT_CONFIG: ChatConfig = {
  model: '',
  endpoint: '',
  format: 'messages',
  apiKey: '',
  imageModel: '',
  imageSize: '',
}

const parseChatEndpoint = (value: string) => {
  if (!/^https?:\/\//i.test(value)) {
    return null
  }
  try {
    const url = new URL(value)
    if (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password &&
      !url.href.includes('#')
    ) {
      return url.href
    }
  } catch {
    // 无效地址由设置表单提示。
  }
  return null
}

export const chatBaseUrl = (value: string, format: ChatApiFormat) => {
  const endpoint = parseChatEndpoint(value.trim())
  if (!endpoint) {
    return null
  }
  const url = new URL(endpoint)
  const path = url.pathname.replace(/\/+$/, '')
  const suffix = CHAT_API_PATHS[format]
  url.pathname = path.endsWith(suffix) ? path.slice(0, -suffix.length) : path
  return url.href
}

export const resolveChatEndpoint = (
  value: string,
  format: ChatApiFormat,
  previous = DEFAULT_CHAT_CONFIG
) => {
  if (!value.trim()) {
    return ''
  }
  const base = chatBaseUrl(value, format)
  if (!base) {
    return null
  }
  // 原来保存的是完整地址。编辑其他设置时沿用该地址，兼容网关的自定义路由。
  if (format === previous.format && base === chatBaseUrl(previous.endpoint, format)) {
    return previous.endpoint
  }
  const url = new URL(base)
  const path = url.pathname.replace(/\/+$/, '')
  const version = format === 'messages' && !path.endsWith('/v1') ? '/v1' : ''
  url.pathname = path + version + CHAT_API_PATHS[format]
  return url.href
}

export const readChatConfig = (stored: string | null): ChatConfig => {
  try {
    const value = JSON.parse(stored ?? 'null') as Partial<ChatConfig> | null
    const model = typeof value?.model === 'string' ? value.model.trim() : ''
    const endpoint = typeof value?.endpoint === 'string' ? parseChatEndpoint(value.endpoint) : null
    const format = value?.format
    if (format === 'messages' || format === 'chat' || format === 'responses') {
      return {
        model,
        endpoint: endpoint ?? '',
        format,
        apiKey: endpoint && typeof value?.apiKey === 'string' ? value.apiKey : '',
        imageModel: typeof value?.imageModel === 'string' ? value.imageModel.trim() : '',
        imageSize: typeof value?.imageSize === 'string' ? value.imageSize.trim() : '',
      }
    }
    return { ...DEFAULT_CHAT_CONFIG, model }
  } catch {
    return DEFAULT_CHAT_CONFIG
  }
}
