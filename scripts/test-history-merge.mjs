/* ============================================================================
 * 功能区：回归与构建辅助 / test-history-merge · 历史合并
 * 职责：历史合并：分支匹配、冲突、置顶分组与本地回退。
 * 分区：01 夹具与固定输入；02 验证场景；03 断言与清理
 * 关联：被测或辅助模块 i18n/en、i18n/zh、services/chat/backup、services/chat/branches 等 13 个模块；
 *    由 pnpm 脚本直接执行。
 * 导出：dbState、resetDbMock、resetDbMetrics、loadSessionSummaries、loadSession、saveSession、renameSession、deleteSession、saveFiles、loadFile、stagingWriter、beginStaging、reportStorageError
 * 边界：只执行回归、构建与像素比对；不写入产品数据，临时目录在结束时清理。
 * ========================================================================== */

/* ---- 01 夹具与固定输入 ---- */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { strToU8, unzipSync, zipSync } from 'fflate'

// node --experimental-transform-types --test scripts/test-history-merge.mjs
// 覆盖深度合并引擎（mergeSessions）、归档往返（pinned / 附件 / 工具 / 分支）以及双槽位端到端合并与替换流程。
const source = new URL('../src/', import.meta.url)
const dbUrl = new URL('./services/chat/db.ts', source).href
const mergeUrl = new URL('./services/chat/history/mergeSessions.ts', source).href

const databaseMock = new URL(
  'data:text/javascript,' +
    encodeURIComponent(
      `
import { mergeSessions } from ${JSON.stringify(mergeUrl)}

const createSlot = () => ({
  sessions: new Map(),
  summaries: new Map(),
  files: new Map(),
})

export const dbState = {
  slots: { primary: createSlot(), alternate: createSlot() },
  activeSlot: 'primary',
  importId: undefined,
  metrics: {
    stagedFilesAdded: 0,
    commitMergeFilesCopied: 0,
    activeSessionsWritten: 0,
    getActiveFileTypesCalls: 0,
  },
}

const inactive = (slot) => (slot === 'primary' ? 'alternate' : 'primary')
const active = () => dbState.slots[dbState.activeSlot]
const staged = () => dbState.slots[inactive(dbState.activeSlot)]

const fileIdsOf = (session) => {
  const ids = new Set()
  for (const m of session.messages) {
    if (m.role === 'user') {
      for (const f of m.files) ids.add(f.id)
    }
  }
  return [...ids]
}

const toSummary = (s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt })

export const resetDbMock = () => {
  dbState.slots = { primary: createSlot(), alternate: createSlot() }
  dbState.activeSlot = 'primary'
  dbState.importId = undefined
  resetDbMetrics()
}

export const resetDbMetrics = () => {
  dbState.metrics.stagedFilesAdded = 0
  dbState.metrics.commitMergeFilesCopied = 0
  dbState.metrics.activeSessionsWritten = 0
  dbState.metrics.getActiveFileTypesCalls = 0
}

export const loadSessionSummaries = async () =>
  [...active().summaries.values()].map(toSummary)

export const loadSession = async (id) => {
  const s = active().sessions.get(id)
  return s ? structuredClone(s) : undefined
}

export const saveSession = async (session, files = []) => {
  for (const { id, blob } of files) active().files.set(id, blob)
  active().sessions.set(session.id, structuredClone(session))
  active().summaries.set(session.id, { ...toSummary(session), fileIds: fileIdsOf(session) })
  dbState.metrics.activeSessionsWritten += 1
}

export const renameSession = async (id, title) => {
  const s = active().sessions.get(id)
  if (s) {
    s.title = title
    active().summaries.set(id, { ...toSummary(s), fileIds: fileIdsOf(s) })
  }
}

export const deleteSession = async (id) => {
  const summary = active().summaries.get(id)
  active().sessions.delete(id)
  active().summaries.delete(id)
  for (const fileId of summary?.fileIds ?? []) {
    const used = [...active().summaries.values()].some((item) => item.fileIds.includes(fileId))
    if (!used) active().files.delete(fileId)
  }
}

export const saveFiles = async (files) => {
  for (const { id, blob } of files) active().files.set(id, blob)
}

export const loadFile = async (id) => active().files.get(id)

export const stagingWriter = (importId) => {
  const summaries = []
  const assertImport = () => {
    if (dbState.importId !== importId) throw new Error('stale importId')
  }
  return {
    summaries,
    async getActiveFileTypes(ids) {
      assertImport()
      dbState.metrics.getActiveFileTypesCalls += 1
      const map = new Map()
      for (const id of ids) {
        const blob = active().files.get(id)
        if (blob) map.set(id, blob.type)
      }
      return map
    },
    async addSessions(list) {
      assertImport()
      for (const s of list) {
        const cloned = structuredClone(s)
        staged().sessions.set(s.id, cloned)
        staged().summaries.set(s.id, { ...toSummary(cloned), fileIds: fileIdsOf(cloned) })
        summaries.push(toSummary(cloned))
      }
    },
    async addFiles(files) {
      assertImport()
      dbState.metrics.stagedFilesAdded += files.length
      for (const { id, blob } of files) staged().files.set(id, blob)
    },
    async updateFileTypes(ids, types) {
      assertImport()
      for (const id of ids) {
        const s = staged().sessions.get(id)
        if (!s) continue
        for (const m of s.messages) {
          if (m.role !== 'user') continue
          for (const f of m.files) f.mimeType = types.get(f.id) ?? ''
        }
      }
    },
  }
}

export const beginStaging = async () => {
  const importId = crypto.randomUUID()
  dbState.importId = importId
  dbState.slots[inactive(dbState.activeSlot)] = createSlot()
  return {
    importId,
    async commit() {
      dbState.activeSlot = inactive(dbState.activeSlot)
      dbState.slots[inactive(dbState.activeSlot)] = createSlot()
      dbState.importId = undefined
    },
    async commitMerge({ localOverrides } = {}) {
      if (dbState.importId !== importId) throw new Error('stale importId')
      for (const [id, blob] of staged().files) {
        if (!active().files.has(id)) {
          active().files.set(id, blob)
          dbState.metrics.commitMergeFilesCopied += 1
        }
      }
      let added = 0
      let merged = 0
      let unchanged = 0
      const updatedIds = []
      const newIds = []
      const overlapIds = []
      for (const id of staged().summaries.keys()) {
        if (active().summaries.has(id) || localOverrides?.has(id)) overlapIds.push(id)
        else newIds.push(id)
      }
      for (const id of overlapIds) {
        for (const { id: fid, blob } of localOverrides?.get(id)?.files ?? []) {
          active().files.set(fid, blob)
        }
      }
      for (const id of newIds) {
        const incoming = structuredClone(staged().sessions.get(id))
        active().sessions.set(id, incoming)
        active().summaries.set(id, { ...toSummary(incoming), fileIds: fileIdsOf(incoming) })
        dbState.metrics.activeSessionsWritten += 1
        added += 1
      }
      for (const id of overlapIds) {
        const incoming = structuredClone(staged().sessions.get(id))
        const override = localOverrides?.get(id)
        const local = override?.session ?? structuredClone(active().sessions.get(id))
        const fileTypes = new Map()
        for (const s of [local, incoming]) {
          for (const m of s.messages) {
            if (m.role !== 'user') continue
            for (const f of m.files) {
              const blob = active().files.get(f.id)
              if (blob?.type) fileTypes.set(f.id, blob.type)
            }
          }
        }
        const res = mergeSessions(local, incoming, { fileTypes })
        if (res.changed || override) {
          active().sessions.set(id, structuredClone(res.session))
          active().summaries.set(id, { ...toSummary(res.session), fileIds: fileIdsOf(res.session) })
          dbState.metrics.activeSessionsWritten += 1
          if (res.changed) merged += 1
          else unchanged += 1
          updatedIds.push(id)
        } else {
          unchanged += 1
        }
      }
      dbState.slots[inactive(dbState.activeSlot)] = createSlot()
      dbState.importId = undefined
      return {
        summaries: [...active().summaries.values()].map(toSummary),
        added,
        merged,
        unchanged,
        updatedIds,
      }
    },
    async discard() {
      dbState.slots[inactive(dbState.activeSlot)] = createSlot()
      dbState.importId = undefined
    },
  }
}

export const reportStorageError = () => (error) => {
  throw error
}
`
    )
).href

registerHooks({
  resolve(specifier, context, next) {
    if (
      context.parentURL?.startsWith(source.href) &&
      specifier.startsWith('.') &&
      specifier.endsWith('.js')
    ) {
      const target = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
      if (target.href === dbUrl) {
        return next(databaseMock, context)
      }
      if (existsSync(target)) {
        return next(target.href, context)
      }
    }
    return next(specifier, context)
  },
})

const storageData = new Map()
globalThis.window = new EventTarget()
globalThis.window.setTimeout = setTimeout
globalThis.window.clearTimeout = clearTimeout
globalThis.document = {
  visibilityState: 'hidden',
  documentElement: {
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
  },
}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => storageData.get(key) ?? null,
    setItem: (key, value) => storageData.set(key, String(value)),
    removeItem: (key) => storageData.delete(key),
  },
})
globalThis.cancelAnimationFrame = () => {}
globalThis.__API_ORIGIN__ = 'https://mock.invalid'

const { mergeSessions } = await import('../src/services/chat/history/mergeSessions.ts')
const { exportArchive } = await import('../src/services/chat/history/exportArchive.ts')
const { importArchive } = await import('../src/services/chat/history/importArchive.ts')
const { readSessionFile, readSessionIndex } = await import('../src/services/chat/history/schema.ts')
const { toSessionFile } = await import('../src/services/chat/history/toArchive.ts')
const { toLocalSession } = await import('../src/services/chat/history/toLocal.ts')
const { getVisibleMessages, selectVersion } = await import('../src/services/chat/branches.ts')
const { exportHistory, formatImportResult, importHistory, clearHistory } =
  await import('../src/services/chat/backup.ts')
const { getDraft, setDraftText } = await import('../src/services/chat/drafts.ts')
const { initChat, mergeHistory, replaceHistory, selectSession, useChatStore } =
  await import('../src/services/chat/store.ts')
const { setPinnedSessions, useSettings } = await import('../src/services/settings.ts')
const { en } = await import('../src/i18n/en.ts')
const { zh } = await import('../src/i18n/zh.ts')
const { dbState, loadFile, loadSession, resetDbMetrics, resetDbMock, saveFiles, saveSession } =
  await import(databaseMock)

const userMsg = (id, parentId, createdAt, content, { selectedChildId, files = [] } = {}) => ({
  id,
  parentId,
  ...(selectedChildId ? { selectedChildId } : {}),
  role: 'user',
  content,
  files,
  createdAt,
})

const assistantMsg = (
  id,
  parentId,
  createdAt,
  blocks,
  {
    selectedChildId,
    status = 'done',
    stopReason,
    thinking = false,
    search = false,
    model = 'deepseek-flash',
    latestReminder,
    usage,
    error,
  } = {}
) => ({
  id,
  parentId,
  ...(selectedChildId ? { selectedChildId } : {}),
  role: 'assistant',
  createdAt,
  model,
  thinking,
  search,
  ...(latestReminder !== undefined ? { latestReminder } : {}),
  status,
  ...(stopReason !== undefined ? { stopReason } : {}),
  blocks,
  ...(usage !== undefined ? { usage } : {}),
  ...(error !== undefined ? { error } : {}),
})

const pngFile = (id, name = 'pic.png') => ({
  id,
  serverId: `srv-${id}`,
  serverImage: { width: 100, height: 100, converted: false },
  name,
  size: 16,
  isImage: true,
  mimeType: 'image/png',
})

const makePngBlob = () =>
  new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])], {
    type: 'image/png',
  })

const roundtripViaArchive = (session, exportImage = () => null) =>
  toLocalSession(readSessionFile(JSON.parse(JSON.stringify(toSessionFile(session, exportImage)))))
    .session

const makeFile = (blob, name = 'backup.zip') => new File([blob], name, { type: 'application/zip' })

test('1. 归档导出再导入与原本地会话深度合并完全幂等，且无损保留本地元数据', () => {
  const local = {
    id: 'sess-roundtrip',
    title: '深度搜索与思考',
    createdAt: 1000,
    updatedAt: 5000,
    rootMessageId: 'u-uuid-1',
    contextCheckpoints: [{ replyId: 'a-uuid-1', summary: '前文摘要' }],
    messages: [
      userMsg('u-uuid-1', null, 1000, '查一下文档', {
        selectedChildId: 'a-uuid-1',
        files: [pngFile('file-1')],
      }),
      assistantMsg(
        'a-uuid-1',
        'u-uuid-1',
        2000,
        [
          {
            type: 'thinking',
            thinking: '正在检索并读取页面',
            signature: 'sig-xyz-keep',
            startedAt: 2000,
            endedAt: 4500,
          },
          {
            type: 'server_tool_use',
            id: 'tool-search-1',
            name: 'deepseek_web_search',
            input: { action: 'search', query: 'DeepSeek', queries: ['DeepSeek'] },
            kind: 'search',
            caller: { type: 'direct' },
          },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'tool-search-1',
            kind: 'search',
            content: [
              {
                type: 'web_search_result',
                url: 'https://deepseek.com/docs',
                title: 'Docs',
                snippet: 'snippet',
                site_name: 'DeepSeek',
                site_icon: null,
                page_age: '2026-11-19T00:00:00.000Z',
                encrypted_content: '',
              },
            ],
          },
          {
            type: 'server_tool_use',
            id: 'tool-open-1',
            name: 'deepseek_read_url',
            input: { action: 'read_link', url: 'https://deepseek.com/docs' },
            kind: 'read_link',
            caller: { type: 'direct' },
          },
          {
            type: 'web_fetch_tool_result',
            tool_use_id: 'tool-open-1',
            kind: 'read_link',
            content: {
              type: 'web_fetch_result',
              url: 'https://deepseek.com/docs',
              content: {
                type: 'document',
                source: { type: 'text', media_type: 'text/plain', data: '' },
                title: 'Docs',
              },
              published_at: null,
            },
            signature: 'encrypted-page-sig',
          },
          {
            type: 'text',
            text: '第一段',
            citations: [{ index: 1, title: 'Docs', url: 'https://deepseek.com/docs' }],
          },
          { type: 'text', text: '结论[citation:1]。' },
        ],
        {
          thinking: true,
          search: true,
          model: 'deepseek-pro',
          latestReminder: '2026-11-20,星期五,,Web,中文',
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 50,
            output_tokens: 40,
          },
        }
      ),
    ],
  }

  const incoming = roundtripViaArchive(
    local,
    ({ id, name }) => `chat_sessions/${local.id}_files/${id}_${name}`
  )
  incoming.messages[0].files[0].mimeType = 'image/png'

  const snapshot = structuredClone(local)
  const merged = mergeSessions(local, incoming)

  assert.equal(merged.changed, false)
  assert.equal(merged.addedMessages, 0)
  assert.equal(merged.updatedMessages, 0)
  assert.strictEqual(merged.session, local)
  assert.deepEqual(local, snapshot)
  assert.equal(merged.session.messages[1].blocks[0].signature, 'sig-xyz-keep')
  assert.equal(merged.session.messages[1].latestReminder, '2026-11-20,星期五,,Web,中文')
  assert.deepEqual(merged.session.contextCheckpoints, snapshot.contextCheckpoints)
})

test('2. 导入包含共同前缀的新续聊，保留本地前缀元数据并把活动分支推进到最新轮次', () => {
  const local = {
    id: 'sess-extend',
    title: '数学',
    createdAt: 1000,
    updatedAt: 2000,
    rootMessageId: 'u1',
    contextCheckpoints: [{ replyId: 'a1', summary: '第一轮摘要' }],
    messages: [
      userMsg('u1', null, 1000, '1+1等于几', { selectedChildId: 'a1' }),
      assistantMsg('a1', 'u1', 1500, [{ type: 'text', text: '2' }], { model: 'deepseek-pro' }),
    ],
  }

  const remoteBeforeExport = {
    ...structuredClone(local),
    updatedAt: 4000,
    messages: [
      userMsg('u1', null, 1000, '1+1等于几', { selectedChildId: 'a1' }),
      assistantMsg('a1', 'u1', 1500, [{ type: 'text', text: '2' }], { selectedChildId: 'u2' }),
      userMsg('u2', 'a1', 3000, '2+2呢', { selectedChildId: 'a2' }),
      assistantMsg('a2', 'u2', 3500, [{ type: 'text', text: '4' }]),
    ],
  }

  const incoming = roundtripViaArchive(remoteBeforeExport)
  const res = mergeSessions(local, incoming)

  assert.equal(res.changed, true)
  assert.equal(res.addedMessages, 2)
  assert.equal(res.session.updatedAt, 4000)
  assert.deepEqual(res.session.contextCheckpoints, local.contextCheckpoints)
  assert.equal(res.session.messages[1].id, 'a1')
  assert.equal(res.session.messages[1].model, 'deepseek-pro')

  const visible = getVisibleMessages(res.session)
  assert.deepEqual(
    visible.map((m) => (m.role === 'user' ? m.content : m.blocks[0].text)),
    ['1+1等于几', '2', '2+2呢', '4']
  )
})

test('3. 导入更早的旧备份时不会覆盖本地新对话，当前分支保持不变', () => {
  const local = {
    id: 'sess-local-newer',
    title: '新对话',
    createdAt: 1000,
    updatedAt: 6000,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 1000, '你好', { selectedChildId: 'a1' }),
      assistantMsg('a1', 'u1', 1500, [{ type: 'text', text: '你好！' }], { selectedChildId: 'u2' }),
      userMsg('u2', 'a1', 5000, '继续', { selectedChildId: 'a2' }),
      assistantMsg('a2', 'u2', 5500, [{ type: 'text', text: '好的。' }]),
    ],
  }
  const olderBackup = roundtripViaArchive({
    id: 'sess-local-newer',
    title: '旧标题',
    createdAt: 1000,
    updatedAt: 2000,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 1000, '你好', { selectedChildId: 'a1' }),
      assistantMsg('a1', 'u1', 1500, [{ type: 'text', text: '你好！' }]),
    ],
  })
/* ---- 02 验证场景 ---- */

  const res = mergeSessions(local, olderBackup)
  assert.equal(res.changed, false)
  assert.strictEqual(res.session, local)
  assert.equal(res.session.title, '新对话')
  assert.equal(getVisibleMessages(res.session).length, 4)
})

test('4. 两端在共同前缀后分叉，保留双分支并按 updatedAt 选择当前分支、同时间保留本地', () => {
  const base = [
    userMsg('u1', null, 1000, '写一首诗', { selectedChildId: 'a1' }),
    assistantMsg('a1', 'u1', 1500, [{ type: 'text', text: '版本A' }], { selectedChildId: 'u2' }),
  ]

  const localOlder = {
    id: 'sess-diverge',
    title: '诗歌',
    createdAt: 1000,
    updatedAt: 3000,
    rootMessageId: 'u1',
    messages: [
      ...structuredClone(base),
      userMsg('u2', 'a1', 2500, '本地追问', { selectedChildId: 'a2' }),
      assistantMsg('a2', 'u2', 2800, [{ type: 'text', text: '本地回复' }]),
    ],
  }

  const incomingNewer = roundtripViaArchive({
    id: 'sess-diverge',
    title: '诗歌',
    createdAt: 1000,
    updatedAt: 5000,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 1000, '写一首诗', { selectedChildId: 'a1' }),
      assistantMsg('a1', 'u1', 1500, [{ type: 'text', text: '版本A' }], { selectedChildId: 'u2r' }),
      userMsg('u2r', 'a1', 4000, '远端追问', { selectedChildId: 'a2r' }),
      assistantMsg('a2r', 'u2r', 4500, [{ type: 'text', text: '远端回复' }]),
    ],
  })

  const res = mergeSessions(localOlder, incomingNewer)
  assert.equal(res.changed, true)
  assert.equal(res.addedMessages, 2)
  assert.equal(res.session.messages.length, 6)
  // incoming updatedAt 更新，默认选中远端分支
  assert.deepEqual(
    getVisibleMessages(res.session).map((m) => (m.role === 'user' ? m.content : m.blocks[0].text)),
    ['写一首诗', '版本A', '远端追问', '远端回复']
  )
  // 切换版本后可切回本地分支
  const switched = selectVersion(res.session, 'u2')
  assert.deepEqual(
    getVisibleMessages(switched).map((m) => (m.role === 'user' ? m.content : m.blocks[0].text)),
    ['写一首诗', '版本A', '本地追问', '本地回复']
  )

  // 同 updatedAt 冲突保留本地分支
  const equalTimeLocal = structuredClone(localOlder)
  equalTimeLocal.updatedAt = 5000
  const tieRes = mergeSessions(equalTimeLocal, incomingNewer)
  assert.equal(tieRes.addedMessages, 2)
  assert.deepEqual(
    getVisibleMessages(tieRes.session).map((m) =>
      m.role === 'user' ? m.content : m.blocks[0].text
    ),
    ['写一首诗', '版本A', '本地追问', '本地回复']
  )
})

test('5. 首轮即分叉时生成多根节点，支持 BranchSwitcher 在根消息间切换', () => {
  const local = {
    id: 'sess-root-diverge',
    title: '分支',
    createdAt: 1000,
    updatedAt: 2000,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 1000, '方案一', { selectedChildId: 'a1' }),
      assistantMsg('a1', 'u1', 1500, [{ type: 'text', text: '答一' }]),
    ],
  }
  const incoming = {
    id: 'sess-root-diverge',
    title: '分支',
    createdAt: 1000,
    updatedAt: 3000,
    rootMessageId: 'u1b',
    messages: [
      userMsg('u1b', null, 2500, '方案二', { selectedChildId: 'a1b' }),
      assistantMsg('a1b', 'u1b', 2800, [{ type: 'text', text: '答二' }]),
    ],
  }

  const res = mergeSessions(local, incoming)
  assert.equal(res.addedMessages, 2)
  const roots = res.session.messages.filter((m) => m.parentId === null)
  assert.equal(roots.length, 2)
  assert.equal(getVisibleMessages(res.session)[0].content, '方案二')

  const switchedToFirst = selectVersion(res.session, 'u1')
  assert.equal(getVisibleMessages(switchedToFirst)[0].content, '方案一')
})

test('6. 未完成或已停止回复遇到更完整快照时就地升级，已完成的不同回答仍保留为兄弟分支', () => {
  const localPartial = {
    id: 'sess-evolve',
    title: '演化',
    createdAt: 1000,
    updatedAt: 2000,
    rootMessageId: 'u1',
    contextCheckpoints: [{ replyId: 'a1', summary: '应失效的旧摘要' }],
    messages: [
      userMsg('u1', null, 1000, '继续', { selectedChildId: 'a1' }),
      assistantMsg('a1', 'u1', 1500, [{ type: 'text', text: '第一段' }], {
        status: 'stopped',
        model: 'deepseek-flash',
      }),
    ],
  }
  const incomingFull = {
    id: 'sess-evolve',
    title: '演化',
    createdAt: 1000,
    updatedAt: 2500,
    rootMessageId: '1',
    messages: [
      userMsg('1', null, 1000, '继续', { selectedChildId: '2' }),
      assistantMsg('2', '1', 1500, [{ type: 'text', text: '第一段\n第二段' }], {
        status: 'done',
        model: null,
      }),
    ],
  }

  const upgraded = mergeSessions(localPartial, incomingFull)
  assert.equal(upgraded.changed, true)
  assert.equal(upgraded.addedMessages, 0)
  assert.equal(upgraded.updatedMessages, 1)
  assert.equal(upgraded.session.messages.length, 2)
  assert.equal(upgraded.session.messages[1].id, 'a1')
  assert.equal(upgraded.session.messages[1].status, 'done')
  assert.equal(upgraded.session.messages[1].model, 'deepseek-flash')
  assert.equal(upgraded.session.messages[1].blocks[0].text, '第一段\n第二段')
  assert.equal(upgraded.session.contextCheckpoints, undefined)

  // 反向：本地已更完整时导入停机旧快照，保持本地不变
  const reverse = mergeSessions(upgraded.session, {
    ...localPartial,
    updatedAt: 1800,
  })
  assert.equal(reverse.changed, false)

  // 两条均已完成的同 createdAt 不同回答不会误合并，保留为兄弟分支
  const doneA = {
    id: 'sess-done-pair',
    title: 'Pair',
    createdAt: 0,
    updatedAt: 100,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 0, 'Hi', { selectedChildId: 'a1' }),
      assistantMsg('a1', 'u1', 0, [{ type: 'text', text: 'Hello' }], { status: 'done' }),
    ],
  }
  const doneB = {
    id: 'sess-done-pair',
    title: 'Pair',
    createdAt: 0,
    updatedAt: 200,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 0, 'Hi', { selectedChildId: 'a2' }),
      assistantMsg('a2', 'u1', 0, [{ type: 'text', text: 'Hello world' }], { status: 'done' }),
    ],
  }
  const siblingRes = mergeSessions(doneA, doneB)
  assert.equal(siblingRes.addedMessages, 1)
  assert.equal(siblingRes.session.messages.length, 3)
})

test('7. error / refusal / max_tokens 经导出往返后再次合并严格幂等，不复制模板消息', () => {
  const local = {
    id: 'sess-states',
    title: '异常态',
    createdAt: 1000,
    updatedAt: 4000,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 1000, 'q1', { selectedChildId: 'a1' }),
      assistantMsg('a1', 'u1', 1500, [], {
        status: 'error',
        error: { kind: 'connection', message: 'Network lost' },
        selectedChildId: 'u2',
      }),
      userMsg('u2', 'a1', 2000, 'q2', { selectedChildId: 'a2' }),
      assistantMsg(
        'a2',
        'u2',
        2500,
        [
          { type: 'thinking', thinking: 'should hide' },
          { type: 'text', text: 'hidden text' },
          { type: 'text', text: '安全拒绝模板', isTemplate: true },
        ],
        { status: 'done', stopReason: 'refusal', selectedChildId: 'u3' }
      ),
      userMsg('u3', 'a2', 3000, 'q3', { selectedChildId: 'a3' }),
      assistantMsg('a3', 'u3', 3500, [{ type: 'text', text: '截断正文' }], {
        status: 'done',
        stopReason: 'max_tokens',
      }),
    ],
  }

  const incoming = roundtripViaArchive(local)
  const merged = mergeSessions(local, incoming)
  assert.equal(merged.changed, false)
  assert.equal(merged.addedMessages, 0)
  assert.equal(merged.updatedMessages, 0)
})

test('8. 会话元数据与附件 MIME 回填：空标题补齐、时间冲突按 updatedAt、回填缺失 mimeType 并保留 serverId', () => {
  const localEmptyTitle = {
    id: 'sess-meta',
    title: '',
    createdAt: 2000,
    updatedAt: 3000,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 2000, '看图', {
        files: [
          {
            id: 'img-1',
            serverId: 'keep-srv-id',
            name: 'photo.png',
            size: 16,
            isImage: true,
            mimeType: '',
          },
        ],
      }),
    ],
  }
  const incomingWithTitle = {
    id: 'sess-meta',
    title: '图片问答',
    createdAt: 1500,
    updatedAt: 2500,
    rootMessageId: '1',
    messages: [
      userMsg('1', null, 2000, '看图', {
        files: [
          {
            id: 'img-1',
            serverId: null,
            name: 'photo.png',
            size: 16,
            isImage: true,
            mimeType: 'image/png',
          },
        ],
      }),
    ],
  }

  const res = mergeSessions(localEmptyTitle, incomingWithTitle)
  assert.equal(res.changed, true)
  assert.equal(res.session.title, '图片问答')
  assert.equal(res.session.createdAt, 1500)
  assert.equal(res.session.updatedAt, 3000)
  assert.equal(res.session.messages[0].files[0].mimeType, 'image/png')
  assert.equal(res.session.messages[0].files[0].serverId, 'keep-srv-id')

  // 双方都有标题，updatedAt 相等时保留本地标题；updatedAt 更新时采用更新方标题
  const bothTitled = { ...res.session, title: '本地标题', updatedAt: 4000 }
  const tie = mergeSessions(bothTitled, {
    ...incomingWithTitle,
    title: '远端标题',
    updatedAt: 4000,
  })
  assert.equal(tie.session.title, '本地标题')
  const newerWins = mergeSessions(bothTitled, {
    ...incomingWithTitle,
    title: '远端新标题',
    updatedAt: 4500,
  })
  assert.equal(newerWins.session.title, '远端新标题')
})

test('9. 数字 ID 冲突重分配不破坏树，且合并结果可再次无错导出往返', () => {
  const local = {
    id: 'sess-id-collision',
    title: 'ID 冲突',
    createdAt: 1000,
    updatedAt: 2000,
    rootMessageId: '1',
    messages: [
      userMsg('1', null, 1000, '问题1', { selectedChildId: '2' }),
      assistantMsg('2', '1', 1100, [{ type: 'text', text: '回答1' }], { selectedChildId: '3' }),
      userMsg('3', '2', 1200, '本地追问', { selectedChildId: '4' }),
      assistantMsg('4', '3', 1300, [{ type: 'text', text: '本地答案' }]),
    ],
  }
  const incoming = {
    id: 'sess-id-collision',
    title: 'ID 冲突',
    createdAt: 1000,
    updatedAt: 3000,
    rootMessageId: '1',
    messages: [
      userMsg('1', null, 1000, '问题1', { selectedChildId: '2' }),
      assistantMsg('2', '1', 1100, [{ type: 'text', text: '回答1' }], { selectedChildId: '3' }),
      // 注意这里的 incoming id='3','4' 与本地 '3','4' 撞 ID 但内容不同
      userMsg('3', '2', 2000, '远端追问', { selectedChildId: '4' }),
      assistantMsg('4', '3', 2100, [{ type: 'text', text: '远端答案' }]),
    ],
  }

  let seq = 100
  const merged = mergeSessions(local, incoming, { createMessageId: () => `gen-${++seq}` })
  assert.equal(merged.changed, true)
  assert.equal(merged.addedMessages, 2)

  const ids = merged.session.messages.map((m) => m.id)
  assert.equal(new Set(ids).size, 6)
  assert.ok(ids.includes('gen-101'))
  assert.ok(ids.includes('gen-102'))

  // 再导出成 ZIP 结构并重新读取，校验 parent_id < id 等全树合法性
  const reExported = roundtripViaArchive(merged.session)
  assert.equal(reExported.messages.length, 6)
})

test('10. 4,000+ 消息深层长对话迭代合并无爆栈且性能充裕', () => {
  const buildChain = (turns) => {
    const messages = []
    let parentId = null
    for (let i = 0; i < turns; i++) {
      const uid = `u-${i}`
      const aid = `a-${i}`
      messages.push(userMsg(uid, parentId, i * 2 + 1, `Q${i}`, { selectedChildId: aid }))
      messages.push(
        assistantMsg(aid, uid, i * 2 + 2, [{ type: 'text', text: `A${i}` }], {
          selectedChildId: i + 1 < turns ? `u-${i + 1}` : undefined,
        })
      )
      parentId = aid
    }
    return {
      id: 'sess-deep',
      title: 'Deep',
      createdAt: 1,
      updatedAt: turns * 2,
      rootMessageId: 'u-0',
      messages,
    }
  }

  const local = buildChain(2000) // 4,000 条消息
  const incoming = buildChain(2100) // 4,200 条消息
  const start = performance.now()
  const merged = mergeSessions(local, incoming)
  const elapsed = performance.now() - start

  assert.equal(merged.changed, true)
  assert.equal(merged.addedMessages, 200)
  assert.equal(merged.session.messages.length, 4200)
  assert.ok(elapsed < 2000, `4,200 条消息合并不应超时: ${elapsed}ms`)
})

test('11. pinned 置顶状态完整随归档导出与校验读取，兼容省略 pinned 的旧测试输入', () => {
  const s1 = {
    id: 'pin-1',
    title: '置顶会话',
    createdAt: 1000,
    updatedAt: 2000,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 1000, 'hi', { selectedChildId: 'a1' }),
      assistantMsg('a1', 'u1', 1500, [{ type: 'text', text: 'ok' }]),
    ],
  }
  const fPinned = toSessionFile(s1, () => null, true)
  assert.equal(fPinned.pinned, true)
  assert.equal(readSessionFile(JSON.parse(JSON.stringify(fPinned))).pinned, true)

  const withoutPinned = JSON.parse(JSON.stringify(fPinned))
  delete withoutPinned.pinned
  assert.equal(readSessionFile(withoutPinned).pinned, false)

  const idx = readSessionIndex([
    {
      id: 'pin-1',
      title: '置顶会话',
      pinned: true,
      message_count: 2,
      inserted_at: fPinned.inserted_at,
      updated_at: fPinned.updated_at,
    },
    {
      id: 'pin-2',
      title: null,
      message_count: 0,
      inserted_at: fPinned.inserted_at,
      updated_at: fPinned.updated_at,
    },
  ])
  assert.equal(idx[0].pinned, true)
  assert.equal(idx[1].pinned, false)
})

test('12. 端到端合并与覆盖流程：增量写盘、复用已有附件、保留草稿与当前会话、置顶并集、坏包零破坏', async () => {
  resetDbMock()
  setPinnedSessions([])
  storageData.clear()

  const blobA = makePngBlob()
  const imgA = pngFile('img-a', 'a.png')

  const sCommon = {
    id: 's-common',
    title: '共有会话',
    createdAt: 1000,
    updatedAt: 2000,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 1000, '看图A', { selectedChildId: 'a1', files: [imgA] }),
      assistantMsg('a1', 'u1', 1500, [{ type: 'text', text: '收到图A' }]),
    ],
  }
  const sLocalOnly = {
    id: 's-local-only',
    title: '仅本地会话',
    createdAt: 1000,
    updatedAt: 3000,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 1000, '本地独有', { selectedChildId: 'a1' }),
      assistantMsg('a1', 'u1', 1500, [{ type: 'text', text: '本地回答' }]),
    ],
  }
  const sSame = {
    id: 's-same',
    title: '无变更会话',
    createdAt: 1000,
    updatedAt: 2500,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 1000, '不变', { selectedChildId: 'a1' }),
/* ---- 03 断言与清理 ---- */
      assistantMsg('a1', 'u1', 1500, [{ type: 'text', text: '一样' }]),
    ],
  }

  await saveSession(sLocalOnly, [])
  await saveSession(sCommon, [{ id: 'img-a', blob: blobA }])
  await saveSession(sSame, [])
  setPinnedSessions(['s-local-only'])

  useChatStore.setState({
    ready: false,
    initError: false,
    activeId: null,
    sessionCache: {},
    sessions: [],
  })
  await initChat()
  selectSession('s-common')
  await new Promise((r) => setTimeout(r, 10))
  setDraftText('s-local-only', '没发出去的草稿')

  // 构造远端导出包：sCommon 追加新轮次 + 引用同一张图 img-a；sSame 完全一致；新增 sRemoteOnly（置顶）
  const remoteCommonExtended = {
    ...structuredClone(sCommon),
    updatedAt: 4000,
    messages: [
      userMsg('u1', null, 1000, '看图A', { selectedChildId: 'a1', files: [imgA] }),
      assistantMsg('a1', 'u1', 1500, [{ type: 'text', text: '收到图A' }], {
        selectedChildId: 'u2',
      }),
      userMsg('u2', 'a1', 3500, '继续聊', { selectedChildId: 'a2' }),
      assistantMsg('a2', 'u2', 3900, [{ type: 'text', text: '好的继续' }]),
    ],
  }
  const sRemoteOnly = {
    id: 's-remote-only',
    title: '远端新增',
    createdAt: 2000,
    updatedAt: 5000,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 2000, '远端提问', { selectedChildId: 'a1' }),
      assistantMsg('a1', 'u1', 2500, [{ type: 'text', text: '远端回复' }]),
    ],
  }

  // 先把远端包数据暂存到一个临时 DB 快照，用 exportArchive 生成标准 ZIP
  const remoteFiles = new Map([['img-a', blobA]])
  const zipBlob = await (() => {
    const origFiles = dbState.slots.primary.files
    dbState.slots.primary.files = remoteFiles
    return exportArchive(
      [remoteCommonExtended, sSame, sRemoteOnly],
      new Set(['s-remote-only']),
      3
    ).finally(() => {
      dbState.slots.primary.files = origFiles
    })
  })()

  resetDbMetrics()
  const mergeRes = await importHistory(makeFile(zipBlob), undefined, 'merge')
  assert.deepEqual(mergeRes, {
    mode: 'merge',
    added: 1,
    merged: 1,
    unchanged: 1,
    skipped: [],
  })
  assert.deepEqual(formatImportResult(mergeRes), {
    key: 'historyMergedSummary',
    params: { added: 1, merged: 1, unchanged: 1 },
  })

  // 验证性能优化：重复图片 img-a 被 getActiveFileTypes 识别为重复并排除，没有重新入暂存或写活跃文件表
  assert.ok(dbState.metrics.getActiveFileTypesCalls >= 1)
  assert.equal(dbState.metrics.stagedFilesAdded, 0)
  assert.equal(dbState.metrics.commitMergeFilesCopied, 0)
  // 只写入了 1 个新增（sRemoteOnly）和 1 个变更（sCommon）；sLocalOnly 与 sSame 未重写
  assert.equal(dbState.metrics.activeSessionsWritten, 2)

  // 验证草稿保留、当前打开会话保持在 s-common 且已实时刷新新消息、置顶取并集
  assert.equal(getDraft('s-local-only').text, '没发出去的草稿')
  const storeAfterMerge = useChatStore.getState()
  assert.equal(storeAfterMerge.activeId, 's-common')
  assert.equal(storeAfterMerge.sessions.length, 4)
  assert.equal(getVisibleMessages(storeAfterMerge.sessionCache['s-common']).length, 4)
  assert.deepEqual(useSettings.getState().pinnedSessions, ['s-local-only', 's-remote-only'])

  // 再次导入同一个 ZIP：0 新增、0 更新、3 项未导入，0 写盘
  resetDbMetrics()
  const repeatRes = await importHistory(makeFile(zipBlob), undefined, 'merge')
  assert.deepEqual(repeatRes, {
    mode: 'merge',
    added: 0,
    merged: 0,
    unchanged: 3,
    skipped: [],
  })
  assert.equal(dbState.metrics.activeSessionsWritten, 0)
  assert.deepEqual(formatImportResult(repeatRes), {
    key: 'historyMergedNoChange',
    params: { unchanged: 3 },
  })

  // 损坏的 ZIP 不影响任何已有会话、草稿与置顶
  await assert.rejects(() => importHistory(makeFile(new Blob(['not-a-zip'])), undefined, 'merge'))
  assert.equal(useChatStore.getState().sessions.length, 4)
  assert.equal(getDraft('s-local-only').text, '没发出去的草稿')

  // 覆盖模式：清空现有记录并替换成 ZIP 中的记录，清空草稿，重置 activeId 与置顶列表
  const replaceRes = await importHistory(makeFile(zipBlob), undefined, 'replace')
  assert.deepEqual(replaceRes, { mode: 'replace', count: 3, skipped: [] })
  const storeAfterReplace = useChatStore.getState()
  assert.equal(storeAfterReplace.activeId, null)
  assert.equal(storeAfterReplace.sessions.length, 3)
  assert.equal(getDraft('s-local-only').text, '')
  assert.deepEqual(useSettings.getState().pinnedSessions, ['s-remote-only'])
  assert.ok(await loadFile('img-a'))
  assert.equal(await loadSession('s-local-only'), undefined)

  // 单个会话 JSON 损坏：不导入该会话并报告标题与原因，其余会话照常合并。
  const brokenFiles = unzipSync(new Uint8Array(await zipBlob.arrayBuffer()))
  brokenFiles['chat_sessions/s-same.json'] = strToU8('{ this is not valid json')
  const brokenZip = new Blob([zipSync(brokenFiles)], { type: 'application/zip' })
  const partialRes = await importHistory(makeFile(brokenZip), undefined, 'merge')
  assert.equal(partialRes.mode, 'merge')
  assert.equal(partialRes.skipped.length, 1)
  assert.equal(partialRes.skipped[0].id, 's-same')
  assert.equal(partialRes.skipped[0].title, '无变更会话')
  assert.equal(partialRes.skipped[0].reason, 'backupSessionJson')
  assert.equal(useChatStore.getState().sessions.length, 3)

  // JSON 合法但消息数量被截断：完整性摘要应报 count，而不是当成正常会话合并。
  const archiveBytes = new Uint8Array(await zipBlob.arrayBuffer())
  const mutateSession = (mutator) => {
    const files = unzipSync(archiveBytes)
    const doc = JSON.parse(new TextDecoder().decode(files['chat_sessions/s-same.json']))
    assert.ok(doc.integrity, '新导出的会话必须写入完整性摘要')
    mutator(doc)
    files['chat_sessions/s-same.json'] = strToU8(JSON.stringify(doc))
    return new Blob([zipSync(files)], { type: 'application/zip' })
  }

  const truncatedRes = await importHistory(
    makeFile(
      mutateSession((doc) => {
        doc.messages.pop()
      })
    ),
    undefined,
    'merge'
  )
  assert.equal(truncatedRes.skipped.length, 1)
  assert.equal(truncatedRes.skipped[0].id, 's-same')
  assert.equal(truncatedRes.skipped[0].title, '无变更会话')
  assert.equal(truncatedRes.skipped[0].reason, 'backupSessionIntegrityCount')

  // JSON 合法但正文被改写：摘要应报 digest，并保留其余会话正常导入。
  const rewrittenRes = await importHistory(
    makeFile(
      mutateSession((doc) => {
        doc.messages[0].fragments[0].content = '被改写的问题'
      })
    ),
    undefined,
    'merge'
  )
  assert.equal(rewrittenRes.skipped.length, 1)
  assert.equal(rewrittenRes.skipped[0].id, 's-same')
  assert.equal(rewrittenRes.skipped[0].reason, 'backupSessionIntegrityDigest')

  // 旧版归档没有 integrity 字段：不能因为无法校验就拒绝导入。
  const legacyRes = await importHistory(
    makeFile(
      mutateSession((doc) => {
        delete doc.integrity
      })
    ),
    undefined,
    'merge'
  )
  assert.equal(legacyRes.skipped.length, 0)
  assert.equal(legacyRes.unchanged, 3)

  // 清空全部记录同时清空置顶列表
  await clearHistory()
  assert.equal(useChatStore.getState().sessions.length, 0)
  assert.deepEqual(useSettings.getState().pinnedSessions, [])
})

test('13. 中英文文案键集合保持完全一致，且文案格式化边界覆盖全面', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  assert.deepEqual(formatImportResult({ mode: 'merge', added: 0, merged: 0, unchanged: 0 }), {
    key: 'historyMergedEmpty',
  })
  assert.deepEqual(formatImportResult({ mode: 'merge', added: 1, merged: 0, unchanged: 0 }), {
    key: 'historyMergedAddedOne',
  })
  assert.deepEqual(formatImportResult({ mode: 'merge', added: 2, merged: 0, unchanged: 0 }), {
    key: 'historyMergedAddedOnly',
    params: { added: 2 },
  })
  assert.deepEqual(formatImportResult({ mode: 'merge', added: 0, merged: 1, unchanged: 0 }), {
    key: 'historyMergedUpdatedOne',
  })
  assert.deepEqual(formatImportResult({ mode: 'merge', added: 0, merged: 3, unchanged: 0 }), {
    key: 'historyMergedUpdatedOnly',
    params: { merged: 3 },
  })
  assert.deepEqual(formatImportResult({ mode: 'replace', count: 1 }), {
    key: 'historyImportedOne',
    params: { count: 1 },
  })
  assert.deepEqual(formatImportResult({ mode: 'replace', count: 4 }), {
    key: 'historyImported',
    params: { count: 4 },
  })
})
