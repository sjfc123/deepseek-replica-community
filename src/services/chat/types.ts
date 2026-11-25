/* ============================================================================
 * 功能区：会话与角色核心 / types 开始
 * 职责：types 服务实现，负责会话状态、角色档案、角色卡、世界书、记忆、上下文或草稿操作中的该子能力。
 * 导出：FileAttachment、UserMessage、ThinkingPart、TextPart、ReplyBlock、ReplyStatus 等 14 个导出。
 * ========================================================================== */

import type { TranslationMessage } from '../../i18n/index.js'
import type { ApiErrorKind } from '../api/client.js'
import type {
  ChatModel,
  MessageUsage,
  ServerToolBlock,
  StopDetails,
  StopReason,
  TextCitation,
} from '../api/types.js'
import type { UploadedImage } from '../imageUpload.js'
import type { MemoryCard } from './memory.js'

/**
 * 消息附件。id 是本地标识（IndexedDB files 表的主键，原件按它存储，所有引用同一 id 的消息共用一份），
 * 导入的附件沿用导出产物里的文件 ID；本地没有原件的附件只展示文件名，不进入请求。
 * serverId 是 Files API 返回的 file_id，导入的数据或尚未上传成功的文件为 null，发送前补传。
 */
export type FileAttachment = {
  id: string
  serverId: string | null
  /** 当前 file_id 对应的上传尺寸和转码状态，旧记录可能没有。 */
  serverImage?: UploadedImage
  name: string
  size: number
  /** 附件类别；导入时沿用归档的 is_image，不由 MIME 识别结果决定。 */
  isImage: boolean
  /** 具体 MIME；导入时没有原件或无法识别的为空字符串，不影响图片身份。 */
  mimeType: string
}

/** 本地消息的分支关系；字段缺省时按线性消息列表处理。 */
type MessageBranch = {
  parentId?: string | null
  /** 当前选中的下一条消息；切换版本时保留每条分支原有的选择。 */
  selectedChildId?: string
  /** 挂在这条消息上的长期记忆卡片，随分支隔离；见 chat/memory.ts */
  memories?: MemoryCard[]
}

export type UserMessage = MessageBranch & {
  id: string
  role: 'user'
  content: string
  files: FileAttachment[]
  createdAt: number
}

/** 思考块：thinking_delta 累积，签名随 signature_delta 到达；历史轮次的思考服务端会丢弃，不回传 */
export type ThinkingPart = {
  type: 'thinking'
  thinking: string
  signature?: string
  /** content_block_start 的时间；没有事件时间的历史块缺省 */
  startedAt?: number
  /** content_block_stop（或回复结束）的时间 */
  endedAt?: number
  /** 仅有耗时、没有事件时间时保存秒数。 */
  elapsedSeconds?: number
}

/** 文本块：text_delta 累积，citations_delta 追加引用 */
export type TextPart = {
  type: 'text'
  text: string
  citations?: TextCitation[]
  /** 服务端提示文案，仅用于展示，不作为模型回答参与上下文。 */
  isTemplate?: boolean
}

/** 服务端工具调用与结果块按协议原样保存；历史请求只回传 read_link 调用与结果 */
export type ReplyBlock = ThinkingPart | TextPart | ServerToolBlock

/**
 * pending：已发出请求，还没收到事件；streaming：正在接收；
 * done：收到 message_stop；stopped：用户停止或页面关闭；error：请求或流出错
 */
export type ReplyStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error'

export type AssistantMessage = MessageBranch & {
  id: string
  role: 'assistant'
  createdAt: number
  /** 未记录模型时为 null，缺失时使用当前默认模型。 */
  model: ChatModel | null
  /** 请求时是否开启深度思考 */
  thinking?: boolean
  /** 请求时是否声明 deepseek_web_search；关闭时仍声明 deepseek_read_url */
  search?: boolean
  /** 本轮请求的系统信息快照；各回答版本独立保存。历史消息中缺省的快照保持为空。 */
  latestReminder?: string
  status: ReplyStatus
  /** 可识别的内容块按接收顺序排列 */
  blocks: ReplyBlock[]
  stopReason?: StopReason
  stopDetails?: StopDetails
  /** 最近一次请求的用量 */
  usage?: MessageUsage
  /**
   * 每次请求结束时的接口用量快照。重新生成会覆盖 usage，但该字段按请求顺序保留，
   * 供会话级精确统计；旧版本回复没有这个字段时退回 usage 单次值。
   */
  usageHistory?: MessageUsage[]
  error?: {
    /** upload：发送前补传附件失败，请求没有发出 */
    kind: ApiErrorKind | 'upload'
    message: string
    status?: number
    localMessage?: TranslationMessage
    /** 仅 upload：重新上传是否可能成功（网络、限流、服务端繁忙）；过大、格式不支持为 false */
    retryable?: boolean
  }
}

export type Message = UserMessage | AssistantMessage

export type ContextCheckpoint = {
  replyId: string
  summary: string
  /** 该轮原文未压完时，记录下一段在摘要材料中的字符位置。 */
  offset?: number
}

export type Session = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** 包含所有分支的消息，按创建顺序存储。 */
  messages: Message[]
  /** undefined 表示线性消息列表；null 表示空会话。 */
  rootMessageId?: string | null
  contextCheckpoints?: ContextCheckpoint[]
  /** 已进入本会话的角色卡；关闭全局角色扮演后仍按这张卡延续人物 */
  characterId?: string
  /** 限时推理卡的虚拟时钟，单位分钟；普通会话不写 */
  storyClockMinute?: number
  /** active：可继续；bad_end / good_end：结局已定，输入与 regenerate 都锁死 */
  storyState?: 'active' | 'bad_end' | 'good_end'
  /** 本轮已推进到截止时间，等待模型给出最后一幕或前端兜底判定 */
  storyFinalTurn?: boolean
}

/** 会话列表元数据；消息只在打开会话时加载。 */
export type SessionSummary = Pick<Session, 'id' | 'title' | 'createdAt' | 'updatedAt'> & {
  /** 会话绑定的角色卡；侧栏据此在时间分组内再按角色分组 */
  characterId?: string
}

/** 显式提取字段，避免将完整会话的消息带进列表。 */
export const toSessionSummary = (session: SessionSummary): SessionSummary => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  characterId: session.characterId,
})

/**
 * 旧版本写入的记录可能缺少字段或类型不符。此处仅判定是否可安全读取，
 * 不修改内容：非法记录由调用方单独跳过，不影响整个列表。
 */
export const isReadableSummary = (value: unknown): value is SessionSummary => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.title === 'string' &&
    typeof record.createdAt === 'number' &&
    Number.isFinite(record.createdAt) &&
    typeof record.updatedAt === 'number' &&
    Number.isFinite(record.updatedAt)
  )
}

/** 会话正文可读的最低要求：id 对得上、messages 是数组、每条消息有 id 与 role */
export const isReadableSession = (value: unknown): value is Session => {
  if (!isReadableSummary(value)) {
    return false
  }
  const record = value as unknown as Record<string, unknown>
  if (!Array.isArray(record.messages)) {
    return false
  }
  return record.messages.every(
    (message) =>
      Boolean(message) &&
      typeof message === 'object' &&
      typeof (message as Record<string, unknown>).id === 'string' &&
      typeof (message as Record<string, unknown>).role === 'string'
  )
}

/* ============================================================================
 * 功能区：会话与角色核心 / types 结束
 * ========================================================================== */
