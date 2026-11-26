/* ============================================================================
 * 功能区：历史归档 / zipReader · ZIP 读取
 * 职责：ZIP 读取：条目遍历、CRC 与大小限制、跳过损坏项与流式读取。
 * 分区：01 类型、常量与模块依赖；02 类型与契约（ArchiveEntry、ArchiveReadOptions）；
 *    03 读取与解析（readEntry、skipEntry）；04 功能实现（skipEntry）
 * 关联：依赖 utils/blob；
 *    被 scripts/test-data-management、services/chat/history/importArchive、services/chat/officeText 引用。
 * 导出：ArchiveError、isZipFile、ArchiveEntry、ArchiveReadOptions、readEntry、skipEntry
 * 边界：只处理导入导出格式、ZIP、合并与还原；不承担在线会话状态，也不负责自动备份调度。
 * ========================================================================== */

import { Inflate, inflateSync } from 'fflate'
import { readBlobBuffer } from '../../../utils/blob.js'

/* ---- 01 类型、常量与模块依赖 ---- */
const READ_CHUNK_BYTES = 256 * 1024
const READ_AHEAD_BYTES = 2 * 1024 * 1024
// 控制每轮同步解压的工作量；输出交给调用方保存后才继续读取。
const INFLATE_CHUNK_BYTES = 8 * 1024
const SMALL_ENTRY_BYTES = 256 * 1024

/** ZIP 结构损坏或使用了不支持的特性 */
export class ArchiveError extends Error {
  constructor() {
    super('Invalid or unsupported history archive')
    this.name = 'ArchiveError'
  }
}

const invalid = (): never => {
  throw new ArchiveError()
}

/** 本地文件头签名 PK\x03\x04，用于在解析前区分 ZIP 与其他文件。 */
export const isZipFile = async (file: File) => {
  const bytes = new Uint8Array(await readBlobBuffer(file.slice(0, 4)))
  return bytes.length === 4 && bytes.every((byte, index) => byte === [0x50, 0x4b, 3, 4][index])
}

const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return crc >>> 0
})

const nextCrcTable = (table: Uint32Array) =>
  table.map((value) => crcTable[value & 0xff] ^ (value >>> 8))
const crcTable1 = nextCrcTable(crcTable)
const crcTable2 = nextCrcTable(crcTable1)
const crcTable3 = nextCrcTable(crcTable2)

const updateCrc = (crc: number, bytes: Uint8Array) => {
  const view = viewOf(bytes)
  let offset = 0
  for (; offset + 4 <= bytes.length; offset += 4) {
    const word = crc ^ view.getUint32(offset, true)
    crc =
      crcTable3[word & 0xff] ^
      crcTable2[(word >>> 8) & 0xff] ^
      crcTable1[(word >>> 16) & 0xff] ^
      crcTable[word >>> 24]
  }
  for (; offset < bytes.length; offset++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[offset]) & 0xff]
  }
  return crc
}

// 系统文件选择器返回的 File 可能来自 content URI：复用相邻读取，避免为每个 ZIP 字段重新打开文档。
const createReader = (file: Blob) => {
  let offset = 0
  let buffer = new Uint8Array()
  return async (start: number, length: number) => {
    if (start < 0 || length < 0 || start + length > file.size) {
      invalid()
    }
    if (length === 0) {
      return buffer.subarray(0, 0)
    }
    if (start < offset || start + length > offset + buffer.length) {
      const end = Math.min(file.size, start + Math.max(READ_AHEAD_BYTES, length))
      buffer = new Uint8Array(await readBlobBuffer(file.slice(start, end)))
      if (buffer.length !== end - start) {
        invalid()
      }
      offset = start
    }
    return buffer.subarray(start - offset, start - offset + length)
  }
}

type ReadBytes = ReturnType<typeof createReader>

/** ZIP64、分卷与加密文件不属于导出格式，一律拒绝。 */
const checkExtra = (bytes: Uint8Array) => {
  const view = viewOf(bytes)
  let offset = 0
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length || view.getUint16(offset, true) === 1) {
      invalid()
    }
    offset += 4 + view.getUint16(offset + 2, true)
    if (offset > bytes.length) {
      invalid()
    }
  }
}

const pathDecoder = new TextDecoder('utf-8', { fatal: true })
const decodePath = (bytes: Uint8Array, flags: number) => {
  // 非 UTF-8 编码的 ZIP 文件名仅接受 ASCII，确保附件路径解码准确。
  if (!(flags & 0x800) && bytes.some((byte) => byte > 0x7f)) {
    invalid()
  }
  const path = pathDecoder.decode(bytes).normalize('NFC')
  if (!path || path.includes('\\') || path.includes('\0') || /^[A-Za-z]:/.test(path)) {
    invalid()
  }
  const parts = (path.endsWith('/') ? path.slice(0, -1) : path).split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    invalid()
  }
  return path
}

type Entry = {
  path: string
  name: Uint8Array
  flags: number
  method: number
  crc: number
  compressedSize: number
  size: number
  offset: number
}

/* ---- 02 类型与契约（ArchiveEntry、ArchiveReadOptions） ---- */
const readDirectory = async (
  fileSize: number,
  readBytes: ReadBytes
): Promise<{ entries: Entry[]; offset: number }> => {
  if (fileSize < 22) {
    invalid()
  }
  const tailStart = Math.max(0, fileSize - 22 - 0xffff)
  const tail = await readBytes(tailStart, fileSize - tailStart)
  const tailView = viewOf(tail)
  let end = tail.length - 22
  while (
    end >= 0 &&
    (tailView.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + tailView.getUint16(end + 20, true) !== tail.length)
  ) {
    end--
  }
  if (end < 0) {
    invalid()
  }
  const count = tailView.getUint16(end + 10, true)
  const size = tailView.getUint32(end + 12, true)
  const offset = tailView.getUint32(end + 16, true)
  if (
    tailView.getUint16(end + 4, true) !== 0 ||
    tailView.getUint16(end + 6, true) !== 0 ||
    tailView.getUint16(end + 8, true) !== count ||
    count === 0xffff ||
    size === 0xffffffff ||
    offset === 0xffffffff ||
    offset + size !== tailStart + end
  ) {
    invalid()
  }
  const entries: Entry[] = []
  const paths = new Set<string>()
  let cursor = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > size) {
      invalid()
    }
    const view = viewOf(await readBytes(offset + cursor, 46))
    if (view.getUint32(0, true) !== 0x02014b50) {
      invalid()
    }
    const flags = view.getUint16(8, true)
    const method = view.getUint16(10, true)
    const compressedSize = view.getUint32(20, true)
    const entrySize = view.getUint32(24, true)
    const nameLength = view.getUint16(28, true)
    const extraLength = view.getUint16(30, true)
    const next = cursor + 46 + nameLength + extraLength + view.getUint16(32, true)
    const entryOffset = view.getUint32(42, true)
    // 只允许 deflate 选项、data descriptor 与 UTF-8 标志。
    if (
      flags & ~0x80e ||
      (method !== 0 && method !== 8) ||
      compressedSize === 0xffffffff ||
      entrySize === 0xffffffff ||
      (method === 0 && compressedSize !== entrySize) ||
      entryOffset >= offset ||
      view.getUint16(34, true) !== 0 ||
      ((view.getUint32(38, true) >>> 16) & 0xf000) === 0xa000 ||
      next > size
    ) {
      invalid()
    }
    const name = await readBytes(offset + cursor + 46, nameLength)
    const path = decodePath(name, flags)
    // 目录与同名文件视为冲突，写入前必须拒绝，防止覆盖已有条目。
    const identity = path.endsWith('/') ? path.slice(0, -1) : path
    if (paths.has(identity) || (path.endsWith('/') && entrySize !== 0)) {
      invalid()
    }
    paths.add(identity)
    checkExtra(await readBytes(offset + cursor + 46 + nameLength, extraLength))
    entries.push({
      path,
      name,
      flags,
      method,
      crc: view.getUint32(16, true),
      compressedSize,
      size: entrySize,
      offset: entryOffset,
    })
    cursor = next
  }
  if (cursor !== size) {
    invalid()
  }
  return { entries: entries.sort((a, b) => a.offset - b.offset), offset }
}

const readEntryOffset = async (readBytes: ReadBytes, entry: Entry, boundary: number) => {
  if (entry.offset + 30 > boundary) {
    invalid()
  }
  const view = viewOf(await readBytes(entry.offset, 30))
  const nameLength = view.getUint16(26, true)
  const extraLength = view.getUint16(28, true)
  const start = entry.offset + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (
    view.getUint32(0, true) !== 0x04034b50 ||
    view.getUint16(6, true) !== entry.flags ||
    view.getUint16(8, true) !== entry.method ||
    nameLength !== entry.name.length ||
    end > boundary
  ) {
    invalid()
  }
  for (const [position, expected] of [
    [14, entry.crc],
    [18, entry.compressedSize],
    [22, entry.size],
  ]) {
    const actual = view.getUint32(position, true)
    if (actual !== expected && (!(entry.flags & 8) || actual !== 0)) {
      invalid()
    }
  }
  const metadata = await readBytes(entry.offset + 30, nameLength + extraLength)
  if (entry.name.some((byte, index) => byte !== metadata[index])) {
    invalid()
  }
  checkExtra(metadata.subarray(nameLength))
  if (entry.flags & 8) {
    if (end + 12 > boundary) {
      invalid()
    }
    const descriptor = viewOf(await readBytes(end, Math.min(16, boundary - end)))
    const shift = descriptor.getUint32(0, true) === 0x08074b50 ? 4 : 0
    if (
      shift + 12 > descriptor.byteLength ||
      descriptor.getUint32(shift, true) !== entry.crc ||
      descriptor.getUint32(shift + 4, true) !== entry.compressedSize ||
      descriptor.getUint32(shift + 8, true) !== entry.size
    ) {
      invalid()
    }
  }
  return start
}

export type ArchiveEntry = {
  path: string
  size: number
  stream: AsyncIterable<Uint8Array>
}

/* ---- 03 读取与解析（readEntry、skipEntry） ---- */
/** 宽松读取：单个条目的本地头或 CRC 损坏时跳过该条目，继续读取后续条目。 */
export type ArchiveReadOptions = {
  continueOnEntryError?: boolean
  onEntryError?: (path: string) => void
}

/**
 * 按条目在文件中的物理顺序逐条、逐块解压，跳过目录条目。
 * 调用方必须消费完当前条目的数据，再请求下一个条目。
 */
export async function* readArchive(
  file: Blob,
  onRead?: (bytes: number, total: number) => Promise<void> | undefined,
  select?: (path: string) => boolean,
  options?: ArchiveReadOptions
): AsyncGenerator<ArchiveEntry> {
  const readBytes = createReader(file)
  const directory = await readDirectory(file.size, readBytes)
  const recoverable = (path: string, error: unknown) => {
    if (!(options?.continueOnEntryError && error instanceof ArchiveError)) {
      return false
    }
    options.onEntryError?.(path)
    return true
  }
  for (const [index, entry] of directory.entries.entries()) {
    const boundary = directory.entries[index + 1]?.offset ?? directory.offset
    if (entry.path.endsWith('/') || (select && !select(entry.path))) {
      continue
    }
    let start: number
    try {
      start = await readEntryOffset(readBytes, entry, boundary)
    } catch (error) {
      if (recoverable(entry.path, error)) {
        continue
      }
      throw error
    }
    let completed = false
    const stream = async function* (): AsyncGenerator<Uint8Array> {
      if (
        entry.method === 8 &&
        entry.compressedSize > 0 &&
        entry.compressedSize <= INFLATE_CHUNK_BYTES &&
        entry.size <= SMALL_ENTRY_BYTES
      ) {
        // 多留一字节以识别超出 ZIP 声明大小的输出，避免接受被截断的内容。
        const compressed = await readBytes(start, entry.compressedSize)
        const chunk = inflateSync(compressed, { out: new Uint8Array(entry.size + 1) })
        if (
          chunk.length !== entry.size ||
          (updateCrc(0xffffffff, chunk) ^ 0xffffffff) >>> 0 !== entry.crc
        ) {
          invalid()
        }
        const repaint = onRead?.(start + entry.compressedSize, directory.offset)
        if (repaint) {
          await repaint
        }
        if (chunk.length) {
          yield chunk
        }
        completed = true
        return
      }
      let written = 0
      let crc = 0xffffffff
      const pending: Uint8Array[] = []
      const append = (chunk: Uint8Array) => {
        written += chunk.length
        if (written > entry.size) {
          invalid()
        }
        crc = updateCrc(crc, chunk)
        if (chunk.length) {
          pending.push(chunk)
        }
      }
      const inflate = entry.method === 8 ? new Inflate(append) : null
      for (let offset = 0; offset < entry.compressedSize; offset += READ_CHUNK_BYTES) {
        const chunk = await readBytes(
          start + offset,
          Math.min(READ_CHUNK_BYTES, entry.compressedSize - offset)
        )
        if (!inflate) {
          append(chunk)
          yield* pending.splice(0)
        } else {
          for (let cursor = 0; cursor < chunk.length; cursor += INFLATE_CHUNK_BYTES) {
            const end = Math.min(cursor + INFLATE_CHUNK_BYTES, chunk.length)
            inflate.push(chunk.subarray(cursor, end), offset + end === entry.compressedSize)
            // yield 暂停解压，等待调用方完成异步写入；不缓存整个条目。
            yield* pending.splice(0)
          }
        }
        const repaint = onRead?.(start + offset + chunk.length, directory.offset)
        if (repaint) {
          await repaint
        }
      }
      if (inflate && entry.compressedSize === 0) {
        inflate.push(new Uint8Array(), true)
        yield* pending.splice(0)
      }
      if (written !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc) {
        invalid()
      }
      completed = true
    }
    yield { path: entry.path, size: entry.size, stream: stream() }
    if (!completed) {
      const error = new ArchiveError()
      if (recoverable(entry.path, error)) {
        continue
      }
      throw error
    }
  }
}

/** 读取图片原件并用头部识别 MIME，分段交给 Blob 存储以限制 JS 缓冲区大小。 */
export const readEntry = async (
  entry: ArchiveEntry,
  imageType: (header: Uint8Array) => string
): Promise<Blob> => {
  const header = new Uint8Array(Math.min(entry.size, 16))
  const parts: Blob[] = []
  let chunks: Uint8Array<ArrayBuffer>[] = []
  let partSize = 0
  let headerSize = 0
  for await (const chunk of entry.stream) {
    if (headerSize < header.length) {
      const prefix = chunk.subarray(0, header.length - headerSize)
      header.set(prefix, headerSize)
      headerSize += prefix.length
    }
    chunks.push(chunk as Uint8Array<ArrayBuffer>)
    partSize += chunk.length
    if (partSize >= READ_AHEAD_BYTES) {
      parts.push(new Blob(chunks))
      chunks = []
      partSize = 0
    }
  }
  return new Blob([...parts, ...chunks], { type: imageType(header) })
}

/* ---- 04 功能实现（skipEntry） ---- */
/** 不需要的条目也要读完，以校验大小与 CRC。 */
export const skipEntry = async (entry: ArchiveEntry): Promise<void> => {
  const reader = entry.stream[Symbol.asyncIterator]()
  while (!(await reader.next()).done) {
    // 条目声明的大小或 CRC 与数据不符时丢弃该条目，防止把损坏内容交给上层。
  }
}

/* ============================================================================
 * 功能区：历史归档 / zipReader 结束
 * ========================================================================== */
