/* ============================================================================
 * 功能区：历史归档 / integrity 开始
 * 职责：为单个会话生成与校验完整性摘要，定位 JSON 语法正常但消息被截断或篡改的对话。
 * 导出：SessionIntegrity、createSessionIntegrity、verifySessionIntegrity。
 * ========================================================================== */

/** 摘要随会话写在归档 JSON 内；旧备份没有该字段时跳过比对。 */
export type SessionIntegrity = {
  /** 固定版本，便于后续升级算法时识别旧摘要。 */
  version: 1
  algorithm: 'fnv1a32x2'
  message_count: number
  /** 两段 32 位摘要拼接，只用于发现传输或存储损坏，不作为密码学签名。 */
  digest: string
}

export type IntegrityCheck = 'ok' | 'count' | 'digest'

const encoder = new TextEncoder()
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const SECOND_SEED = 0x9e3779b9

/** FNV-1a 32 位；第二遍用不同种子，拼成 64 位左右的抗随机碰撞摘要。 */
const fnv1a = (bytes: Uint8Array, seed: number) => {
  let hash = seed >>> 0
  for (let index = 0; index < bytes.length; index++) {
    hash ^= bytes[index]
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash >>> 0
}

const digestOf = (bytes: Uint8Array) =>
  `${fnv1a(bytes, FNV_OFFSET).toString(16).padStart(8, '0')}${fnv1a(bytes, SECOND_SEED)
    .toString(16)
    .padStart(8, '0')}`

/** 去掉 integrity 自身后序列化，避免校验值参与摘要计算。 */
const payloadOf = (value: unknown): string => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify(value)
  }
  const rest = { ...(value as Record<string, unknown>) }
  delete rest.integrity
  return JSON.stringify(rest)
}

const messageCountOf = (value: unknown) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const messages = (value as Record<string, unknown>).messages
  return Array.isArray(messages) ? messages.length : null
}

/**
 * 导出时计算：摘要覆盖除 integrity 外的整个会话对象，消息数量单独记录，
 * 因此数组被截断或正文被改写都能定位到具体会话。
 */
export const createSessionIntegrity = (payload: unknown): SessionIntegrity => {
  const bytes = encoder.encode(payloadOf(payload))
  const messageCount = messageCountOf(payload)
  return {
    version: 1,
    algorithm: 'fnv1a32x2',
    message_count: messageCount ?? -1,
    digest: digestOf(bytes),
  }
}

/** 导入时校验：先看消息数量，再看完整摘要，便于区分截断与内容改写。 */
export const verifySessionIntegrity = (
  payload: unknown,
  integrity: SessionIntegrity
): IntegrityCheck => {
  const messageCount = messageCountOf(payload)
  if (messageCount === null || messageCount !== integrity.message_count) {
    return 'count'
  }
  return digestOf(encoder.encode(payloadOf(payload))) === integrity.digest ? 'ok' : 'digest'
}

/* ============================================================================
 * 功能区：历史归档 / integrity 结束
 * ========================================================================== */
