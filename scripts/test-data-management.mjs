/**
 * 数据管理回归：
 * 1. 自动备份的数据版本只在真实写入时前进，备份基线不会把导出期间的新数据吞掉；
 * 2. ZIP 写入按内容字节报告进度，最终值与总字节一致；
 * 3. 单个条目 CRC 损坏时宽松读取会跳过该条目，继续返回后续正常条目。
 */
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'

const memory = new Map()
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
}

const {
  currentDataRevision,
  flushDataRevision,
  markBackupRevision,
  markDataChanged,
  readBackupRevision,
} = await import('../src/services/dataRevision.ts')
const { readArchive } = await import('../src/services/chat/history/zipReader.ts')
const { writeArchive } = await import('../src/services/chat/history/zipWriter.ts')
const { createSessionIntegrity, verifySessionIntegrity } = await import(
  '../src/services/chat/history/integrity.ts'
)

assert.equal(currentDataRevision(), 0)
assert.equal(readBackupRevision(), 0)

markDataChanged()
assert.equal(currentDataRevision(), 1)
markDataChanged()
flushDataRevision()
assert.equal(memory.get('replica:data-revision'), '2')

// 导出开始时的版本是 2；导出期间又有新数据，基线仍写 2，当前版本不能被回退。
markBackupRevision(2)
markDataChanged()
flushDataRevision()
assert.equal(readBackupRevision(), 2)
assert.equal(currentDataRevision(), 3)
assert.equal(memory.get('replica:data-revision'), '3')

// 会话完整性摘要：JSON 合法但消息被截断或内容被改写时，必须能分出 count / digest 两种原因。
const payload = {
  id: 'integrity-session',
  title: '完整性测试',
  messages: [
    { id: 1, role: 'USER', content: '原始提问' },
    { id: 2, role: 'ASSISTANT', content: '原始回答' },
  ],
}
const integrity = createSessionIntegrity(payload)
assert.equal(integrity.version, 1)
assert.equal(integrity.algorithm, 'fnv1a32x2')
assert.equal(integrity.message_count, 2)
assert.match(integrity.digest, /^[0-9a-f]{16}$/)
assert.equal(verifySessionIntegrity(payload, integrity), 'ok')
assert.equal(verifySessionIntegrity({ ...payload, integrity }, integrity), 'ok')

const truncated = { ...payload, messages: payload.messages.slice(0, 1) }
assert.equal(verifySessionIntegrity(truncated, integrity), 'count')

const rewritten = structuredClone(payload)
rewritten.messages[1].content = '被改写的内容'
assert.equal(verifySessionIntegrity(rewritten, integrity), 'digest')

const blobs = [
  { name: 'a.txt', blob: new Blob([strToU8('alpha')]) },
  { name: 'b.txt', blob: new Blob([strToU8('bravo')]) },
]
let lastBytes = 0
let lastTotal = 0
const archive = await writeArchive(blobs, (bytes, total) => {
  assert.ok(bytes >= lastBytes, '进度不能倒退')
  lastBytes = bytes
  lastTotal = total
})
assert.equal(lastTotal, 10)
assert.equal(lastBytes, 10)
assert.ok(archive.size > 0)

const broken = zipSync(
  {
    'bad.txt': strToU8('BROKEN_ENTRY_CONTENT_9f31'),
    'good.txt': strToU8('good entry survives'),
  },
  { level: 0 }
)
const marker = strToU8('BROKEN_ENTRY_CONTENT_9f31')
const offset = broken.findIndex(
  (_, index) => marker.every((byte, inner) => broken[index + inner] === byte)
)
assert.ok(offset > 0)
broken[offset] ^= 0xff

const recovered = []
const entryErrors = []
const file = new Blob([broken], { type: 'application/zip' })
for await (const entry of readArchive(file, undefined, undefined, {
  continueOnEntryError: true,
  onEntryError: (path) => entryErrors.push(path),
})) {
  let text = ''
  try {
    for await (const chunk of entry.stream) {
      text += new TextDecoder().decode(chunk)
    }
    recovered.push(entry.path)
  } catch {
    // 损坏条目由调用方捕获后继续循环，读取器应跳过它并保留后续条目。
  }
}
assert.deepEqual(recovered, ['good.txt'])
assert.deepEqual(entryErrors, ['bad.txt'])

console.log('data management regression: ok')
