/* ============================================================================
 * 功能区：会话与角色核心 / pdfSummary 开始
 * 职责：pdfSummary 服务实现，负责会话状态、角色档案、角色卡、世界书、记忆、上下文或草稿操作中的该子能力。
 * 导出：summarizePdfPages。
 * ========================================================================== */

import { readBlobBuffer } from '../../utils/blob.js'
import { ApiError, deleteFile, uploadFile } from '../api/client.js'
import { isContextOverflow } from '../api/errors.js'

const PDF_BATCH_PAGES = 32
const CLEANUP_TIMEOUT_MS = 4_000

const discardChunk = async (apiKey: string, id: string) => {
  // 即使用户已经取消，也给已知 ID 的临时附件留一次独立的清理机会。
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CLEANUP_TIMEOUT_MS)
  try {
    await deleteFile(apiKey, id, controller.signal)
  } catch {
    // 清理失败不影响已经完成的摘要。
  } finally {
    clearTimeout(timer)
  }
}

export const summarizePdfPages = async ({
  original,
  name,
  originalFileId,
  apiKey,
  previous,
  summarize,
  signal,
}: {
  original: Blob
  name: string
  originalFileId: string
  apiKey: string
  previous?: string
  summarize: (fileId: string, label: string, previous?: string) => Promise<string | null>
  signal: AbortSignal
}): Promise<string | null> => {
  signal.throwIfAborted()
  const { PDFDocument } = await import('pdf-lib')
  const source = await PDFDocument.load(await readBlobBuffer(original), {
    updateMetadata: false,
  }).catch(() => null)
  signal.throwIfAborted()
  if (!source) {
    return null
  }
  const total = source.getPageCount()
  if (total < 2) {
    return null
  }
  let batchSize = Math.min(PDF_BATCH_PAGES, Math.ceil(total / 2))
  const stem = name.replace(/\.pdf$/i, '')
  for (let start = 0; start < total; ) {
    signal.throwIfAborted()
    const end = Math.min(total, start + batchSize)
    const indices = Array.from({ length: end - start }, (_, offset) => start + offset)
    const chunk = await PDFDocument.create()
    const pages = await chunk.copyPages(source, indices)
    pages.forEach((page) => chunk.addPage(page))
    const bytes = await chunk.save()
    const file = new File([new Uint8Array(bytes)], stem + '-' + (start + 1) + '-' + end + '.pdf', {
      type: 'application/pdf',
    })
    signal.throwIfAborted()
    let temporaryId: string | undefined
    try {
      const uploaded = await uploadFile(apiKey, file, 'rich_layout_recognition', signal)
      temporaryId = uploaded.id
      signal.throwIfAborted()
      const label = name + '（原文第 ' + (start + 1) + '–' + end + ' 页，共 ' + total + ' 页）'
      const result = await summarize(temporaryId, label, previous)
      signal.throwIfAborted()
      if (!result) {
        return null
      }
      previous = result
      start = end
    } catch (error) {
      signal.throwIfAborted()
      const shouldSplit =
        isContextOverflow(error) || (error instanceof ApiError && error.status === 413)
      if (!shouldSplit || end - start < 2) {
        throw error
      }
      batchSize = Math.ceil((end - start) / 2)
    } finally {
      if (temporaryId && temporaryId !== originalFileId) {
        await discardChunk(apiKey, temporaryId)
      }
    }
  }
  return previous ?? null
}

/* ============================================================================
 * 功能区：会话与角色核心 / pdfSummary 结束
 * ========================================================================== */
