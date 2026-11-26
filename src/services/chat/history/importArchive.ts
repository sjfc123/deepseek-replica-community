/* ============================================================================
 * 功能区：历史归档 / importArchive · 历史归档导入
 * 职责：历史归档导入：ZIP 读取、结构校验、图片回填与本地落库。
 * 分区：01 类型、常量与模块依赖；02 写入与状态变更（importArchive）
 * 关联：依赖 i18n/index、services/chat/db、services/chat/history/errors、services/chat/history/format 等 10 个模块；
 *    被 scripts/test-history-merge、services/chat/backup、services/chat/history/import.worker、services/chat/history/importOffMainThread 等 5 个模块 引用。
 * 导出：ImportIssue、ArchiveProgress、ImportMode、ImportArchiveResult、ArchiveSourceError、importArchive
 * 边界：只处理导入导出格式、ZIP、合并与还原；不承担在线会话状态，也不负责自动备份调度。
 * ========================================================================== */

import { stagingWriter, type StoredFile } from '../db.js'
import type { Session, SessionSummary } from '../types.js'
import type { TranslationKey } from '../../../i18n/index.js'
import { BackupError, fail } from './errors.js'
import type { SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, USER_PATH, parseSessionPath } from './paths.js'
import { checkManifest, readSessionFile, readSessionIndex } from './schema.js'
import { toLocalSession } from './toLocal.js'
import { verifySessionIntegrity } from './integrity.js'
import {
  ArchiveError,
  isZipFile,
  readArchive,
  readEntry,
  skipEntry,
  type ArchiveEntry,
} from './zipReader.js'

/* ---- 01 类型、常量与模块依赖 ---- */
/** 从原件字节补充图片 MIME；无法识别时为空字符串，图片身份仍由归档的 is_image 决定。 */
const imageType = (bytes: Uint8Array): string => {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 12))
  if (startsWith(0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png'
  }
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (startsWith(0x42, 0x4d)) {
    return 'image/bmp'
  }
  if (startsWith(0x49, 0x49, 0x2a, 0) || startsWith(0x4d, 0x4d, 0, 0x2a)) {
    return 'image/tiff'
  }
  if (header.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(header.slice(8, 12))) {
    return 'image/avif'
  }
  return ''
}

const readText = async (entry: ArchiveEntry): Promise<string> => {
  const decoder = new TextDecoder()
  let text = ''
  for await (const chunk of entry.stream) {
    text += decoder.decode(chunk, { stream: true })
  }
  return text + decoder.decode()
}

const readJson = async (entry: ArchiveEntry): Promise<unknown> => {
  const text = await readText(entry)
  try {
    return JSON.parse(text)
  } catch {
    return fail('backupInvalidJson')
  }
}

/** 会话 JSON 损坏时仍尽量从原文里取标题，导入报告才能指出是哪一个对话。 */
const titleFromText = (text: string): string | null => {
  const match = /"title"\s*:\s*("(?:\\.|[^"\\])*")/.exec(text)
  if (!match) {
    return null
  }
  try {
    const value: unknown = JSON.parse(match[1])
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null
  } catch {
    return null
  }
}

const titleOf = (value: unknown): string | null =>
  value && typeof value === 'object' && typeof (value as { title?: unknown }).title === 'string'
    ? ((value as { title: string }).title.trim().slice(0, 200) || null)
    : null

/** 单个对话损坏：不导入该对话，报告标题与原因，其余对话继续导入。 */
export type ImportIssue = {
  /** 会话 id；路径里能解析出来就有 */
  id: string | null
  /** 归档里的标题；index 或 JSON 里有就能拿到 */
  title: string | null
  path: string
  reason: TranslationKey
}

const sessionReason = (error: unknown): TranslationKey => {
  if (error instanceof BackupError) {
    switch (error.key) {
      case 'backupInvalidJson':
        return 'backupSessionJson'
      case 'backupInvalidBranches':
        return 'backupSessionBranches'
      case 'backupInvalidFiles':
        return 'backupSessionFiles'
      default:
        return 'backupSessionIncomplete'
    }
  }
  return error instanceof ArchiveError ? 'backupSessionEntry' : 'backupSessionIncomplete'
}

export type ArchiveProgress = { bytes: number; total: number; count: number } | null

export type ImportMode = 'merge' | 'replace'
export type ImportArchiveResult = {
  summaries: SessionSummary[]
  pinnedIds: string[]
  /** 因 JSON、分支、附件或 ZIP 条目损坏而没有导入的对话 */
  skipped: ImportIssue[]
}

/** 第一次读取就失败时，暂存尚未写入，可以从另一个线程重试。 */
export class ArchiveSourceError extends Error {}

/* ---- 02 写入与状态变更（importArchive） ---- */
/**
 * 流式导入：manifest → user（略过）→ 全部会话 JSON → index → 全部图片。
 * 同时兼容会话与图片交错排列、index 位于末尾的条目顺序。
 * 批量暂存会话和图片；图片全部读完后只读取可能需要回填 MIME 的会话。
 * 合并模式下不再写入已在当前库存在的图片，仍完成 ZIP 大小与 CRC 校验。
 */
export const importArchive = async (
  file: File,
  importId: string,
  onProgress: (progress: ArchiveProgress) => void,
  mode: ImportMode = 'replace'
): Promise<ImportArchiveResult> => {
  const recognized = await isZipFile(file).catch((cause: unknown) => {
    throw new ArchiveSourceError('Unable to read the history archive', { cause })
  })
  if (!recognized) {
    fail('backupUnrecognized')
  }
  const imported = new Set<string>()
  const pinnedIds = new Set<string>()
  const images = new Map<string, string>()
  /** 已保存的原件或当前库已存在的原件：文件 ID → MIME。同一图片出现在多个会话目录时只处理一次。 */
  const stored = new Map<string, string>()
  const activeFileTypes = new Map<string, string | null>()
  const uncheckedImageIds = new Set<string>()
  const sessionsWithFiles: { id: string; size: number }[] = []
  let sessions: Session[] = []
  let files: StoredFile[] = []
  let sessionBytes = 0
  let fileBytes = 0
  let lastProgress = 0
  let manifest = false
  let index: SessionIndexEntry[] | undefined
  let indexSeen = false
  const staging = stagingWriter(importId)
  let pendingSessions: Promise<{ error: unknown } | undefined> | undefined
  const issues: ImportIssue[] = []
  const issuePaths = new Set<string>()
  const skippedSessions = new Set<string>()

  const recordIssue = (
    path: string,
    id: string | null,
    title: string | null,
    reason: TranslationKey
  ) => {
    if (issuePaths.has(path)) {
      return
    }
    issuePaths.add(path)
    issues.push({ path, id, title, reason })
    if (id) {
      skippedSessions.add(id)
    }
  }
  // 条目 CRC 或本地头损坏时，ZIP 读取器会排除该条目；只把会话文件记成“损坏对话”。
  const onEntryError = (path: string) => {
    const id = parseSessionPath(path)
    if (id !== null) {
      recordIssue(path, id, null, 'backupSessionEntry')
    }
  }

  const waitForSessions = async () => {
    const result = await pendingSessions
    pendingSessions = undefined
    if (result) {
      throw result.error
    }
  }

  const flushSessions = async () => {
    await waitForSessions()
    const batch = sessions
    sessions = []
    const bytes = sessionBytes
    sessionBytes = 0
    if (!batch.length) {
      return
    }
    // 只保留一批待写入数据，解析下一批时让 IndexedDB 完成上一批。
    pendingSessions = staging.addSessions(batch).then(
      () => undefined,
      (error: unknown) => ({ error })
    )
    if (bytes > 8 * 1024 * 1024) {
      await waitForSessions()
    }
  }
  const flushFiles = async () => {
    if (files.length) {
      await staging.addFiles(files)
    }
    files = []
    fileBytes = 0
  }
  const reportRead = (bytes: number, total: number) => {
    const now = performance.now()
    if (lastProgress && now - lastProgress < 200) {
      return
    }
    lastProgress = now
    onProgress({ bytes, total, count: imported.size })
    // 缓存命中时 ZIP 条目之间不一定有浏览器任务边界，留出绘制进度的机会。
    return typeof document === 'undefined'
      ? undefined
      : new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  const saveImage = async (entry: ArchiveEntry, id: string) => {
    if (stored.has(id)) {
      await skipEntry(entry)
      return
    }
    if (mode === 'merge') {
      if (!activeFileTypes.has(id)) {
        uncheckedImageIds.add(id)
        const activeTypes = await staging.getActiveFileTypes([...uncheckedImageIds])
        for (const uncheckedId of uncheckedImageIds) {
          activeFileTypes.set(uncheckedId, activeTypes.get(uncheckedId) ?? null)
        }
        uncheckedImageIds.clear()
      }
      const existingType = activeFileTypes.get(id)
      if (existingType !== null && existingType !== undefined) {
        stored.set(id, existingType)
        await skipEntry(entry)
        return
      }
    }
    const blob = await readEntry(entry, imageType)
    files.push({ id, blob })
    fileBytes += blob.size
    stored.set(id, blob.type)
    if (files.length >= 32 || fileBytes >= 8 * 1024 * 1024) {
      await flushFiles()
    }
  }

  try {
    for await (const entry of readArchive(file, reportRead, undefined, {
      continueOnEntryError: true,
      onEntryError,
    })) {
      const { path } = entry
      const sessionId = parseSessionPath(path)
      if (!manifest) {
        if (path !== MANIFEST_PATH) {
          fail('backupUnrecognized')
        }
        checkManifest(await readJson(entry))
        manifest = true
        continue
      }
      if (path === USER_PATH) {
        // 账号信息（已脱敏）不导入；文件可能缺失。
        await skipEntry(entry).catch(() => {})
        continue
      }
      if (sessionId !== null) {
        if (entry.size > 8 * 1024 * 1024) {
          await flushSessions()
          await waitForSessions()
        }
        let text = ''
        try {
          text = await readText(entry)
        } catch (error) {
          recordIssue(path, sessionId, null, sessionReason(error))
          continue
        }
        let value: unknown
        try {
          value = JSON.parse(text)
        } catch {
          recordIssue(path, sessionId, titleFromText(text), 'backupSessionJson')
          continue
        }
        let parsed: ReturnType<typeof readSessionFile>
        let local: ReturnType<typeof toLocalSession>
        try {
          parsed = readSessionFile(value)
          // 先比对导出时写入的消息数量与摘要，能识别 JSON 合法但内容被截断/改写的会话。
          if (parsed.integrity) {
            const check = verifySessionIntegrity(value, parsed.integrity)
            if (check !== 'ok') {
              recordIssue(
                path,
                sessionId,
                parsed.title,
                check === 'count' ? 'backupSessionIntegrityCount' : 'backupSessionIntegrityDigest'
              )
              continue
            }
          }
          local = toLocalSession(parsed)
        } catch (error) {
          recordIssue(path, sessionId, titleOf(value), sessionReason(error))
          continue
        }
        if (local.session.id !== sessionId) {
          recordIssue(path, sessionId, parsed.title, 'backupSessionIncomplete')
          continue
        }
        if (imported.has(sessionId)) {
          recordIssue(path, sessionId, parsed.title, 'backupSessionDuplicate')
          continue
        }
        imported.add(sessionId)
        if (parsed.pinned) {
          pinnedIds.add(sessionId)
        }
        for (const [imagePath, id] of local.images) {
          images.set(imagePath, id)
          if (mode === 'merge' && !activeFileTypes.has(id)) {
            uncheckedImageIds.add(id)
          }
        }
        if (
          local.session.messages.some((message) => message.role === 'user' && message.files.length)
        ) {
          sessionsWithFiles.push({ id: sessionId, size: entry.size })
        }
        sessions.push(local.session)
        sessionBytes += entry.size
        if (sessions.length >= 512 || sessionBytes >= 4 * 1024 * 1024) {
          await flushSessions()
        }
        continue
      }
      if (path === INDEX_PATH) {
        if (!indexSeen) {
          indexSeen = true
          try {
            index = readSessionIndex(await readJson(entry))
            for (const item of index) {
              if (item.pinned) {
                pinnedIds.add(item.id)
              }
            }
          } catch {
            // index 损坏或 CRC 错误不影响会话本身：按已成功读取的会话继续导入。
            index = undefined
          }
        }
        continue
      }
      const filesOwner = /^chat_sessions\/([^/]+)_files\//.exec(path)?.[1]
      if (filesOwner) {
        // 没有被引用的条目不保存，引用了但缺失的图片只展示文件名。
        const id = images.get(path)
        try {
          await (id === undefined || skippedSessions.has(filesOwner)
            ? skipEntry(entry)
            : saveImage(entry, id))
        } catch (error) {
          // 单张图片损坏不应连带整个会话失败。
          if (!(error instanceof ArchiveError)) {
            throw error
          }
        }
        continue
      }
      // 未知条目不进入导入，不因为多一个文件就让整个归档不可导入。
      await skipEntry(entry).catch((error: unknown) => {
        if (!(error instanceof ArchiveError)) {
          throw error
        }
      })
    }
  } catch (error) {
    await pendingSessions
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  if (!manifest) {
    fail('backupUnrecognized')
  }
  // index 可能缺失或损坏；用实际成功导入的会话作为结果，并从 index 补全报告标题。
  for (const issue of issues) {
    if (!issue.title && issue.id) {
      issue.title = index?.find((item) => item.id === issue.id)?.title ?? null
    }
    if (!issue.id) {
      issue.id = parseSessionPath(issue.path)
    }
  }
  for (const id of [...pinnedIds]) {
    if (!imported.has(id)) {
      pinnedIds.delete(id)
    }
  }
  if (imported.size === 0 && issues.length > 0) {
    await pendingSessions
    fail('backupIncomplete')
  }
  onProgress(null)
  await flushSessions()
  await waitForSessions()
  await flushFiles()
  if (stored.size) {
    let ids: string[] = []
    let bytes = 0
    for (const item of sessionsWithFiles) {
      ids.push(item.id)
      bytes += item.size
      if (ids.length >= 64 || bytes >= 4 * 1024 * 1024) {
        await staging.updateFileTypes(ids, stored)
        ids = []
        bytes = 0
      }
    }
    if (ids.length) {
      await staging.updateFileTypes(ids, stored)
    }
  }
  return { summaries: staging.summaries, pinnedIds: [...pinnedIds], skipped: issues }
}

/* ============================================================================
 * 功能区：历史归档 / importArchive 结束
 * ========================================================================== */
