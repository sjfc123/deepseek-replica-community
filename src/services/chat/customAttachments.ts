import { readBlobBuffer } from '../../utils/blob.js'
import type { ChatApiFormat } from '../api/chatConfig.js'
import { ApiError } from '../api/client.js'
import type { InlineFileBlockParam, TextBlockParam } from '../api/types.js'
import { getFileExt } from '../attachments.js'
import { prepareImageUpload } from '../imageUpload.js'
import { readPlainText } from './contextSummary.js'
import { getContextRounds } from './reply.js'
import type { FileAttachment, Message, UserMessage } from './types.js'

type CustomAttachment = InlineFileBlockParam | TextBlockParam

const toBase64 = async (blob: Blob, signal: AbortSignal) => {
  const chunks: string[] = []
  const size = 24_576
  for (let offset = 0; offset < blob.size; offset += size) {
    signal.throwIfAborted()
    // 每段按三个字节分组，只有最后一段需要 Base64 填充。
    const part = new Uint8Array(await readBlobBuffer(blob.slice(offset, offset + size)))
    chunks.push(btoa(String.fromCharCode(...part)))
  }
  return chunks.join('')
}

const toInlineBlock = async (
  format: ChatApiFormat,
  file: FileAttachment,
  blob: Blob,
  signal: AbortSignal
): Promise<CustomAttachment | undefined> => {
  if (file.isImage) {
    const original = new File([blob], file.name, { type: file.mimeType || blob.type })
    const { file: image } = await prepareImageUpload(original, signal, 4096, true)
    if (image && /^image\/(jpeg|png|gif|webp)$/.test(image.type)) {
      return {
        type: 'image',
        source: { type: 'base64', media_type: image.type, data: await toBase64(image, signal) },
      }
    }
    return undefined
  }
  const extension = getFileExt(file.name)
  if (extension === 'pdf' && format !== 'chat') {
    return {
      type: 'document',
      title: file.name,
      source: { type: 'base64', media_type: 'application/pdf', data: await toBase64(blob, signal) },
    }
  }
  const text =
    extension === 'docx' || extension === 'pptx' || extension === 'xlsx'
      ? await import('./officeText.js').then(({ readOfficeText }) =>
          readOfficeText(extension, blob, signal)
        )
      : await readPlainText(file, async () => blob)
  return text === undefined ? undefined : { type: 'text', text: `${file.name}\n${text}` }
}

export const prepareCustomAttachments = async (
  format: ChatApiFormat,
  history: Message[],
  question: UserMessage,
  loadFile: (id: string) => Promise<Blob | undefined>,
  signal: AbortSignal
) => {
  const inline = new Map<string, CustomAttachment[]>()
  for (const user of [...getContextRounds(history).map(([user]) => user), question]) {
    const blocks: CustomAttachment[] = []
    for (const file of user.files) {
      signal.throwIfAborted()
      const blob = await loadFile(file.id)
      const part = blob ? await toInlineBlock(format, file, blob, signal) : undefined
      if (part) {
        blocks.push(part)
      } else if (user === question) {
        throw new ApiError('protocol', {
          key: 'advancedAttachmentUnsupported',
          params: { name: file.name },
        })
      }
    }
    inline.set(user.id, blocks)
  }
  return inline
}
