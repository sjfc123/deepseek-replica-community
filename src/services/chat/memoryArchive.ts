import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { formatDate } from '../../utils/format.js'
import { readBlobBuffer } from '../../utils/blob.js'
import { useSettings } from '../settings.js'
import * as db from './db.js'
import type { MemoryCard, MemoryMode } from './memory.js'
import { useChatStore } from './store.js'
import type { Message, Session } from './types.js'

/**
 * 记忆归档：把各会话里的长期记忆卡片单独打包，便于换机或备份到别处。
 * 只含卡片本身与所属位置，不含对话正文、附件与 API Key。
 */
const MEMORY_FORMAT = 'deepseek-replica-memory'
const MEMORY_VERSION = 1
const MEMORY_ENTRY = 'memory.json'
const README_ENTRY = 'README.txt'

type ArchivedCards = {
  /** 挂卡的消息 id；导入时据此把卡片放回原位置 */
  messageId: string
  cards: MemoryCard[]
}

type ArchivedSession = {
  id: string
  title: string
  messages: ArchivedCards[]
}

export type MemoryArchiveFile = {
  format: typeof MEMORY_FORMAT
  version: number
  exportedAt: number
  mode: MemoryMode
  limit: number
  cards: number
  sessions: ArchivedSession[]
}

export type MemoryExportResult = {
  name: string
  blob: Blob
  /** 实际写入归档的卡片数 */
  cards: number
  /** 含记忆的会话数 */
  sessions: number
}

export type MemoryImportResult = {
  cards: number
  sessions: number
  /** 原会话已不存在而跳过的卡片数 */
  skippedCards: number
  skippedSessions: number
  /** 覆盖模式下被清掉的旧卡片数量 */
  cleared: number
}

const memoryFileName = (date: Date, cards: number) =>
  `deepseek_memory-${formatDate(date)}-${cards}cards.zip`

/** 收集一条消息上可导出的卡片；空数组视为没有记忆 */
const cardsOf = (message: Message): MemoryCard[] => {
  const cards = message.memories ?? []
  return cards.filter((card) => card.text.trim().length > 0)
}

const buildArchive = async (sessions: Session[]) => {
  const archived: ArchivedSession[] = []
  let total = 0
  for (const session of sessions) {
    const messages: ArchivedCards[] = []
    for (const message of session.messages) {
      const cards = cardsOf(message)
      if (cards.length === 0) {
        continue
      }
      total += cards.length
      messages.push({ messageId: message.id, cards })
    }
    if (messages.length > 0) {
      archived.push({ id: session.id, title: session.title, messages })
    }
  }
  return { archived, total }
}

const readme = (cards: number, sessions: number) => `DeepSeek Replica 记忆归档
=================================

导出时间：${new Date().toISOString()}
卡片数量：${cards}
含记忆的会话：${sessions}

文件说明
--------
memory.json  机器可读的卡片数据，请勿手工改成其它格式后再导入。
README.txt   本说明，导入时不读取。

包含什么
--------
每条会话下按消息 id 列出挂在该消息上的长期记忆卡片，含文本、来源
（auto/refine/manual）、创建时间、是否启用、是否置顶、是否已被提炼取代。
不包含对话正文、附件、API Key 与设置项。

导入规则
--------
1. 只按会话 id 与消息 id 匹配；找不到原会话的整段跳过，找不到原消息的卡片跳过。
2. 同 id 的卡片不会重复写入；本机已有卡片保持原样，不会被覆盖或删除。
3. 导入后立即生效，下次打开对应会话即可看到。

注意事项
--------
卡片越多，导出与导入所需时间越长；几千张卡片时请等进度提示走完再退出应用。
导出的文件可放回本机「下载」目录，用数据管理里的「导入记忆」选择即可。
`

/** 导出全部会话的记忆卡片；未打开的会话按需从数据库读取 */
export const exportMemory = async (
  onProgress?: (done: number, total: number) => void
): Promise<MemoryExportResult> => {
  const { sessions, sessionCache } = useChatStore.getState()
  const loaded: Session[] = []
  for (const [index, summary] of sessions.entries()) {
    const session = Object.hasOwn(sessionCache, summary.id)
      ? sessionCache[summary.id]
      : await db.loadSession(summary.id)
    if (session) {
      loaded.push(session)
    }
    onProgress?.(index + 1, sessions.length)
  }
  const { archived, total } = await buildArchive(loaded)
  const { memoryMode, memoryLimit } = useSettings.getState()
  const payload: MemoryArchiveFile = {
    format: MEMORY_FORMAT,
    version: MEMORY_VERSION,
    exportedAt: Date.now(),
    mode: memoryMode,
    limit: memoryLimit,
    cards: total,
    sessions: archived,
  }
  const zip = zipSync(
    {
      [MEMORY_ENTRY]: strToU8(JSON.stringify(payload)),
      [README_ENTRY]: strToU8(readme(total, archived.length)),
    },
    { level: 6 }
  )
  return {
    name: memoryFileName(new Date(), total),
    blob: new Blob([zip], { type: 'application/zip' }),
    cards: total,
    sessions: archived.length,
  }
}

const parseArchive = async (file: File): Promise<MemoryArchiveFile> => {
  const bytes = new Uint8Array(await readBlobBuffer(file))
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('不是有效的 ZIP 文件')
  }
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new Error('压缩包结构损坏，无法解压')
  }
  const entry = entries[MEMORY_ENTRY]
  if (!entry) {
    throw new Error('压缩包里没有记忆数据（memory.json）')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(strFromU8(entry))
  } catch {
    throw new Error('记忆数据不是有效的 JSON')
  }
  const archive = parsed as Partial<MemoryArchiveFile>
  if (archive.format !== MEMORY_FORMAT || typeof archive.version !== 'number') {
    throw new Error('这不是记忆归档文件')
  }
  if (!Array.isArray(archive.sessions)) {
    throw new Error('记忆数据缺少会话列表')
  }
  if (archive.version > MEMORY_VERSION) {
    throw new Error('归档来自更新的版本，当前版本读不了')
  }
  return archive as MemoryArchiveFile
}

const mergeCards = (existing: MemoryCard[], incoming: MemoryCard[]) => {
  const known = new Set(existing.map((card) => card.id))
  const added = incoming.filter((card) => card.id && !known.has(card.id))
  return { merged: [...existing, ...added], added: added.length }
}

/** 导入模式：merge 只追加同 id 缺失的卡片；replace 先清空本机已有记忆再写入 */
export type MemoryImportMode = 'merge' | 'replace'

/** 导入记忆归档：按会话与消息定位，同 id 跳过，不覆盖本机已有卡片 */
export const importMemory = async (
  file: File,
  onProgress?: (done: number, total: number) => void,
  mode: MemoryImportMode = 'merge'
): Promise<MemoryImportResult> => {
  const archive = await parseArchive(file)
  const { sessionCache } = useChatStore.getState()
  let cards = 0
  let sessions = 0
  let skippedCards = 0
  let skippedSessions = 0
  let cleared = 0

  for (const [index, archived] of archive.sessions.entries()) {
    const cached = Object.hasOwn(sessionCache, archived.id)
      ? sessionCache[archived.id]
      : await db.loadSession(archived.id)
    if (!cached) {
      skippedSessions++
      skippedCards += archived.messages.reduce((sum, item) => sum + item.cards.length, 0)
      onProgress?.(index + 1, archive.sessions.length)
      continue
    }
    let touched = false
    let addedHere = 0
    const matchedIds = new Set<string>()
    // 覆盖模式：先摘掉这条会话上所有旧卡片，再按归档重建，相当于整份记忆回滚到导出时刻
    const baseMessages =
      mode === 'replace'
        ? cached.messages.map((message) => {
            if (!message.memories || message.memories.length === 0) {
              return message
            }
            cleared += message.memories.length
            touched = true
            return { ...message, memories: undefined }
          })
        : cached.messages
    const nextMessages = baseMessages.map((message) => {
      const incoming = archived.messages.find((item) => item.messageId === message.id)
      if (!incoming || incoming.cards.length === 0) {
        return message
      }
      matchedIds.add(incoming.messageId)
      const { merged, added } = mergeCards(message.memories ?? [], incoming.cards)
      if (added === 0) {
        skippedCards += incoming.cards.length
        return message
      }
      touched = true
      addedHere += added
      skippedCards += incoming.cards.length - added
      return { ...message, memories: merged }
    })
    // 归档里指向本机已不存在的消息：卡片无处安放，按跳过计数并说明
    for (const item of archived.messages) {
      if (!matchedIds.has(item.messageId)) {
        skippedCards += item.cards.length
      }
    }
    if (touched) {
      const nextSession: Session = { ...cached, messages: nextMessages }
      await db.saveSession(nextSession)
      if (Object.hasOwn(sessionCache, cached.id)) {
        useChatStore.setState((state) => ({
          sessionCache: { ...state.sessionCache, [cached.id]: nextSession },
        }))
      }
      cards += addedHere
      sessions++
    }
    onProgress?.(index + 1, archive.sessions.length)
  }

  return { cards, sessions, skippedCards, skippedSessions, cleared }
}
