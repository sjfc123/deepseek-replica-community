/* ============================================================================
 * 功能区：模型接口 / parseEvent · 上游 SSE 事件解析
 * 职责：上游 SSE 事件解析：把消息增量、usage 与工具块归一为统一事件；不维护会话状态。
 * 分区：01 类型、常量与模块依赖；02 读取与解析（readDelta、readUsage）；03 读取与解析（readMessageEvent）
 * 关联：依赖 services/api/types；
 *    被 scripts/test-cache-diagnostics、services/api/client 引用。
 * 导出：readMessageEvent
 * 边界：只处理 HTTP 协议、请求头、流式帧与错误归一化；不维护会话状态、不渲染视图、不写业务数据库。
 * ========================================================================== */

import type {
  ContentBlockDelta,
  MessageStreamEvent,
  MessageUsage,
  OutputBlockStart,
  TextCitation,
} from './types.js'

/* ---- 01 类型、常量与模块依赖 ---- */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'
const isOptionalString = (value: unknown) => value === undefined || isString(value)
const isNullableString = (value: unknown) => value == null || isString(value)
const isIndex = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0

const isCitation = (value: unknown): value is TextCitation =>
  isRecord(value) &&
  value.type === 'web_search_result_location' &&
  isString(value.url) &&
  isNullableString(value.title)

/** 只检查消费内容所需的字段，签名及服务端附带的信息保持原样。 */
const readBlock = (value: unknown): OutputBlockStart | null => {
  if (!isRecord(value)) {
    return null
  }
  switch (value.type) {
    case 'text':
      if (!isString(value.text)) {
        return null
      }
      return {
        ...value,
        type: 'text',
        text: value.text,
        ...(value.citations === undefined
          ? {}
          : {
              citations: Array.isArray(value.citations) ? value.citations.filter(isCitation) : [],
            }),
      }
    case 'thinking':
      if (!isString(value.thinking)) {
        return null
      }
      return {
        ...value,
        signature: isOptionalString(value.signature) ? value.signature : undefined,
      } as OutputBlockStart
    case 'server_tool_use': {
      const input = value.input
      if (
        !isString(value.id) ||
        !['search', 'deep_search', 'read_link', 'image_search', 'deep_image_search'].includes(
          value.kind as string
        ) ||
        !['deepseek_web_search', 'deepseek_read_url'].includes(value.name as string) ||
        !isRecord(input)
      ) {
        return null
      }
      switch (input.action) {
        case 'search':
          if (!Array.isArray(input.queries) || !input.queries.every(isString)) {
            return null
          }
          break
        case 'open_page':
        case 'read_link':
          if (!isString(input.url)) {
            return null
          }
          break
        case 'find_in_page':
          if (!isString(input.url) || !isString(input.pattern)) {
            return null
          }
          break
        default:
          return null
      }
      break
    }
    case 'web_search_tool_result':
      if (
        !isString(value.tool_use_id) ||
        !['search', 'deep_search', 'image_search', 'deep_image_search'].includes(
          value.kind as string
        ) ||
        !Array.isArray(value.content)
      ) {
        return null
      }
      return {
        ...value,
        content: value.content.filter((item) => {
          if (!isRecord(item)) {
            return false
          }
          if (item.type === 'web_search_tool_result_error') {
            return isString(item.error_code)
          }
          return (
            item.type === 'web_search_result' &&
            isString(item.url) &&
            isString(item.title) &&
            isNullableString(item.snippet) &&
            isNullableString(item.site_name) &&
            isNullableString(item.site_icon) &&
            isNullableString(item.page_age)
          )
        }),
      } as OutputBlockStart
    case 'web_fetch_tool_result': {
      const content = value.content
      if (
        !isString(value.tool_use_id) ||
        !['read_link', 'deep_search'].includes(value.kind as string) ||
        !isRecord(content)
      ) {
        return null
      }
      if (content.type === 'web_fetch_tool_result_error') {
        if (!isString(content.error_code)) {
          return null
        }
      } else if (
        content.type !== 'web_fetch_result' ||
        !isString(content.url) ||
        !isRecord(content.content) ||
        !isNullableString(content.content.title) ||
        !isNullableString(content.published_at)
      ) {
        return null
      }
      return {
        ...value,
        signature: isOptionalString(value.signature) ? value.signature : undefined,
      } as OutputBlockStart
    }
    case 'tool_use':
      // 不展示客户端工具内容。
      break
    default:
      return null
  }
  return value as OutputBlockStart
}

/* ---- 02 读取与解析（readDelta、readUsage） ---- */
const readDelta = (value: unknown): ContentBlockDelta | null => {
  if (!isRecord(value)) {
    return null
  }
  switch (value.type) {
    case 'text_delta':
      return isString(value.text) ? (value as ContentBlockDelta) : null
    case 'thinking_delta':
      return isString(value.thinking) ? (value as ContentBlockDelta) : null
    case 'signature_delta':
      return isString(value.signature) ? (value as ContentBlockDelta) : null
    case 'citations_delta':
      return isCitation(value.citation) ? (value as ContentBlockDelta) : null
    default:
      return null
  }
}

/** 缓存字段允许缺失：部分兼容接口只回 input/output，不能把缺失当成真实 0 命中。 */
const readUsage = (value: unknown): MessageUsage | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const input = value.input_tokens
  const output = value.output_tokens
  if (
    typeof input !== 'number' ||
    !Number.isFinite(input) ||
    typeof output !== 'number' ||
    !Number.isFinite(output)
  ) {
    return undefined
  }
  const present =
    ['cache_creation_input_tokens', 'cache_read_input_tokens'].some(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key])
    )
  return {
    input_tokens: input,
    cache_creation_input_tokens: present ? Number(value.cache_creation_input_tokens ?? 0) : 0,
    cache_read_input_tokens: present ? Number(value.cache_read_input_tokens ?? 0) : 0,
    output_tokens: output,
    cache_fields_present: present,
  }
}

/* ---- 03 读取与解析（readMessageEvent） ---- */
/** 未识别或无法安全消费的事件静默丢弃，不影响后续有效内容与正常结束。 */
export const readMessageEvent = (value: unknown): MessageStreamEvent | null => {
  if (!isRecord(value)) {
    return null
  }
  switch (value.type) {
    case 'message_start':
      if (!isRecord(value.message)) {
        return null
      }
      return {
        ...value,
        message: {
          ...value.message,
          usage: readUsage(value.message.usage),
        },
      } as MessageStreamEvent
    case 'content_block_start': {
      const block = readBlock(value.content_block)
      return isIndex(value.index) && block
        ? { type: 'content_block_start', index: value.index as number, content_block: block }
        : null
    }
    case 'content_block_delta': {
      const delta = readDelta(value.delta)
      return isIndex(value.index) && delta
        ? { type: 'content_block_delta', index: value.index as number, delta }
        : null
    }
    case 'content_block_stop':
      if (!isIndex(value.index)) {
        return null
      }
      break
    case 'message_delta': {
      if (!isRecord(value.delta)) {
        return null
      }
      const reason = value.delta.stop_reason
      const stopReason =
        reason === 'model_context_window_exceeded' || reason === 'pause_turn'
          ? 'max_tokens'
          : reason === 'stop_sequence'
            ? 'end_turn'
            : reason
      if (!['end_turn', 'max_tokens', 'tool_use', 'refusal'].includes(stopReason as string)) {
        return null
      }
      return {
        ...value,
        delta: {
          ...value.delta,
          stop_reason: stopReason,
          title: isOptionalString(value.delta.title) ? value.delta.title : undefined,
        },
        usage: readUsage(value.usage),
      } as MessageStreamEvent
    }
    case 'message_stop':
      break
    default:
      return null
  }
  return value as MessageStreamEvent
}

/* ============================================================================
 * 功能区：模型接口 / parseEvent 结束
 * ========================================================================== */
