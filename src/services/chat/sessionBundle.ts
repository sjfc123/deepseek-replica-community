/* ============================================================================
 * 功能区：会话与角色核心 / sessionBundle 开始
 * 职责：sessionBundle 服务实现，负责会话状态、角色档案、角色卡、世界书、记忆、上下文或草稿操作中的该子能力。
 * 导出：SESSION_BUNDLE_FORMAT、SESSION_BUNDLE_VERSION、SessionBundleMemory、SessionBundle、loadSessionForExport、buildSessionBundle 等 10 个导出。
 * ========================================================================== */

import * as db from './db.js'
import type { Session, SessionSummary } from './types.js'
import type { MemoryCard } from './memory.js'
import type { CharacterCard, WorldbookEntry, SceneState } from './roleplay.js'
import { EMPTY_SCENE, findSessionCharacterCard, normalizeScene } from './roleplay.js'
import { useSettings } from '../settings.js'
import { useChatStore } from './store.js'
import { createId } from '../../utils/id.js'
import { replyPlainText } from './memory.js'
import { toSessionSummary } from './types.js'

/** 单会话设定包的格式标识与版本，导入端按这两个字段校验 */
export const SESSION_BUNDLE_FORMAT = 'deepseek-replica-session-bundle'
export const SESSION_BUNDLE_VERSION = 1

export type SessionBundleMemory = MemoryCard & { messageId: string }

/** 一份可单独迁移的单会话包：对话本身、当轮启用的角色卡、相关世界书、场景与会话内记忆 */
export type SessionBundle = {
  format: typeof SESSION_BUNDLE_FORMAT
  version: number
  exportedAt: number
  /** 会话标题与时间只作展示，导入时以 session 内字段为准 */
  title: string
  session: Session
  card: CharacterCard | null
  worldbook: WorldbookEntry[]
  scene: SceneState
  memories: SessionBundleMemory[]
}

/**
 * 会话内记忆：挂在消息上的卡片按消息顺序摊平，保留 messageId 便于定位。
 * 只取当前选中的分支路径，另一条分支的记忆不混进来。
 */
const collectMemories = (path: Session['messages']): SessionBundleMemory[] => {
  const rows: SessionBundleMemory[] = []
  for (const message of path) {
    for (const memory of message.memories ?? []) {
      rows.push({ ...memory, messageId: message.id })
    }
  }
  return rows
}

/** 取当前选中分支：与界面展示保持同一套规则，避免导出另一条分支 */
const selectedPath = (session: Session): Session['messages'] => {
  if (session.rootMessageId === undefined) {
    return session.messages
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const path: Session['messages'] = []
  let id = session.rootMessageId
  while (id) {
    const message = byId.get(id)
    if (!message) {
      break
    }
    path.push(message)
    byId.delete(id)
    id = message.selectedChildId ?? null
  }
  return path
}

/** 读取会话正文：优先用内存缓存，未打开过的从本地库读，避免把详情都塞进缓存 */
export const loadSessionForExport = async (id: string): Promise<Session | undefined> => {
  const cached = useChatStore.getState().sessionCache[id]
  if (cached) {
    return cached
  }
  return db.loadSession(id)
}

/** 组装单会话包：角色卡优先取本会话绑定人物，其次才用全局启用卡；世界书只带走相关或全局的可用条目 */
export const buildSessionBundle = async (
  summary: SessionSummary,
  now = Date.now()
): Promise<SessionBundle | null> => {
  const session = await loadSessionForExport(summary.id)
  if (!session) {
    return null
  }
  const { characterCards, activeCharacterId, worldbook } = useSettings.getState()
  const card =
    findSessionCharacterCard(characterCards, session) ??
    (activeCharacterId
      ? (characterCards.find((item) => item.id === activeCharacterId) ?? null)
      : null)
  const related = worldbook.filter(
    (entry) => entry.enabled && (!entry.cardId || entry.cardId === (card?.id ?? ''))
  )
  return {
    format: SESSION_BUNDLE_FORMAT,
    version: SESSION_BUNDLE_VERSION,
    exportedAt: now,
    title: session.title || summary.title,
    session,
    card,
    worldbook: related,
    scene: session.scene ? normalizeScene(session.scene) : { ...EMPTY_SCENE },
    memories: collectMemories(selectedPath(session)),
  }
}

const isBundle = (value: unknown): value is SessionBundle => {
  const bundle = value as Partial<SessionBundle> | null
  return Boolean(
    bundle &&
    bundle.format === SESSION_BUNDLE_FORMAT &&
    typeof bundle.version === 'number' &&
    bundle.version <= SESSION_BUNDLE_VERSION &&
    bundle.session &&
    Array.isArray(bundle.session.messages)
  )
}

/** 读取并校验单会话包；格式不符、版本更新、缺少消息都直接报错，不做猜测性修复 */
export const parseSessionBundle = async (file: File): Promise<SessionBundle> => {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  if (!isBundle(parsed)) {
    throw new Error('这不是本应用的会话包（缺少 format 或版本不符）')
  }
  if ((parsed.version as number) > SESSION_BUNDLE_VERSION) {
    throw new Error('会话包来自更新的版本，当前版本读不了')
  }
  if (parsed.session.messages.length === 0) {
    throw new Error('会话包里没有消息')
  }
  return parsed
}

/**
 * 导入单会话包：整体复制成一个新会话，消息 ID 全部换新，避免与本机已有消息撞 ID。
 * 只写会话与消息（记忆与场景随会话走）；角色卡、世界书不自动写入，由使用者决定是否手动套用。
 */
export const importSessionBundle = async (bundle: SessionBundle): Promise<Session> => {
  const { messages: source } = bundle.session
  const idMap = new Map<string, string>()
  source.forEach((message) => idMap.set(message.id, createId()))
  const now = Date.now()
  const messages = source.map((message, index) => {
    const id = idMap.get(message.id)
    if (!id) {
      throw new Error('导入会话包失败：消息 ID 映射缺失')
    }
    return {
      ...message,
      id,
      parentId:
        index === 0
          ? null
          : message.parentId
            ? (idMap.get(message.parentId) ?? null)
            : (idMap.get(source[index - 1].id) ?? null),
      selectedChildId: message.selectedChildId
        ? idMap.get(message.selectedChildId)
        : index === source.length - 1
          ? undefined
          : idMap.get(source[index + 1].id),
      memories: message.memories ? message.memories.map((card) => ({ ...card })) : undefined,
    }
  })
  const next: Session = {
    id: createId(),
    title: `${bundle.title || bundle.session.title || '导入的对话'}`,
    createdAt: bundle.session.createdAt || now,
    updatedAt: now,
    messages,
    rootMessageId: messages[0]?.id ?? null,
    contextCheckpoints: bundle.session.contextCheckpoints
      ? bundle.session.contextCheckpoints.map((checkpoint) => ({ ...checkpoint }))
      : undefined,
    characterId: bundle.session.characterId,
    scene: normalizeScene(bundle.session.scene ?? bundle.scene),
  }
  await db.saveSession(next)
  useChatStore.setState((state) => ({
    sessions: [toSessionSummary(next), ...state.sessions],
    sessionCache: { ...state.sessionCache, [next.id]: next },
  }))
  return next
}

/** 单会话导出为可读文本：角色名 + 逐条消息，独白与动作按原文保留 */
export const sessionBundleToMarkdown = (bundle: SessionBundle, now = new Date()) => {
  const name = bundle.card?.name || '角色'
  const lines = [
    `# ${bundle.title || '未命名对话'}`,
    '',
    `- 导出时间：${now.toLocaleString('zh-CN')}`,
    `- 角色：${name}`,
    `- 消息：${bundle.session.messages.length} 条`,
    '',
  ]
  const path = selectedPath(bundle.session)
  for (const message of path) {
    const who = message.role === 'user' ? '我' : name
    lines.push(`## ${who}`, '', replyPlainText(message).trim() || '（空）', '')
    const cards = message.memories ?? []
    if (cards.length > 0) {
      lines.push(`> 记忆：${cards.map((card) => card.text.replace(/\n/g, ' ')).join('；')}`, '')
    }
  }
  return lines.join('\n')
}

/** 文件名：去掉路径分隔符与空白，保留标题便于辨认 */
export const sessionBundleName = (title: string, now = new Date()) => {
  const safe = (title || 'untitled').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 32)
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}`
  return `deepseek_session-${safe}-${stamp}.json`
}

/* ============================================================================
 * 功能区：会话与角色核心 / sessionBundle 结束
 * ========================================================================== */
