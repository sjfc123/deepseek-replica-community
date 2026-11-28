/* ============================================================================
 * 功能区：回归与构建辅助 / test-import-attachments · 导入会话附件口径
 * 职责：导入会话带入的历史附件，本地无原件（serverId 为 null）时只展示、不进入请求；
 *    已有 serverId 的附件正常组装为文件块。锁定“残缺附件不阻断纯文本对话”的消息层口径。
 * 关联：被测 services/chat/reply；不写入产品数据。
 * ========================================================================== */
import assert from 'node:assert/strict'

const memory = new Map()
globalThis.window = globalThis.window ?? {}
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
}

const { toRequestMessages } = await import('../src/services/chat/reply.ts')

const orphanFile = {
  id: 'orphan-1',
  serverId: null,
  name: '导入残留图片.png',
  size: 1024,
  isImage: true,
  mimeType: '',
}
const liveImage = {
  id: 'live-1',
  serverId: 'file-api-live-image',
  name: '现场图片.png',
  size: 2048,
  isImage: true,
  mimeType: 'image/png',
}
const liveDoc = {
  id: 'live-2',
  serverId: 'file-api-live-doc',
  name: '文档.txt',
  size: 512,
  isImage: false,
  mimeType: 'text/plain',
}

const user = (id, content, files) => ({ id, role: 'user', content, files, createdAt: 0 })
const assistant = (id, text) => ({
  id,
  role: 'assistant',
  createdAt: 0,
  model: null,
  status: 'done',
  blocks: [{ type: 'text', text }],
})

// 第一轮：纯残缺附件、无文字 —— 整轮连同回答省略。
// 第二轮：文字 + 残缺附件 + 两个有效附件 —— 只保留有效附件块。
const history = [
  user('u1', '', [orphanFile]),
  assistant('a1', '上一轮回答'),
  user('u2', '继续聊', [orphanFile, liveImage, liveDoc]),
  assistant('a2', '这一轮回答'),
]

const question = user('q1', '那好啊', [])
const messages = toRequestMessages(history, question, undefined, undefined, '')

const fileIds = messages
  .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
  .filter((block) => block?.type === 'image' || block?.type === 'document')
  .map((block) => block.source.file_id)

// 残缺附件不产生任何文件块；有效图片与文档保留。
assert.equal(fileIds.includes('file-api-live-image'), true)
assert.equal(fileIds.includes('file-api-live-doc'), true)
assert.equal(fileIds.length, 2)

// 第一轮空提问被省略；第二轮文字在文件块之后的文本块里。
const userText = (m) =>
  typeof m.content === 'string'
    ? m.content
    : (m.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')
const userContents = messages.filter((m) => m.role === 'user').map(userText)
assert.deepEqual(userContents, ['继续聊', '那好啊'])

console.log('import attachments regression: ok')
