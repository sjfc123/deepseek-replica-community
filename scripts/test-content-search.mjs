import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

// node --experimental-transform-types --test scripts/test-content-search.mjs
// 覆盖官方 2.8.0 对标内容搜索：标题/正文/思考/多分支匹配、片段与高亮、日期格式、分支激活与存储端到端跳转。
const source = new URL('../src/', import.meta.url)
const dbUrl = new URL('./services/chat/db.ts', source).href

const databaseMock = new URL(
  'data:text/javascript,' +
    encodeURIComponent(`
export const dbState = {
  sessions: new Map(),
  summaries: new Map(),
  scanCount: 0,
  saveCount: 0,
}

export const resetDbMock = () => {
  dbState.sessions.clear()
  dbState.summaries.clear()
  dbState.scanCount = 0
  dbState.saveCount = 0
}

export const seedSession = (session) => {
  dbState.sessions.set(session.id, structuredClone(session))
  dbState.summaries.set(session.id, {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  })
}

export const loadSessionSummaries = async () => [...dbState.summaries.values()]

export const loadSession = async (id) => {
  const s = dbState.sessions.get(id)
  return s ? structuredClone(s) : undefined
}

export const scanSessions = async (onSession, skipIds) => {
  for (const [id, session] of dbState.sessions.entries()) {
    if (skipIds?.has(id)) continue
    dbState.scanCount += 1
    if (!onSession(structuredClone(session))) break
  }
}

export const saveSession = async (session) => {
  dbState.saveCount += 1
  seedSession(session)
}

export const renameSession = async (id, title) => {
  const s = dbState.sessions.get(id)
  if (s) {
    s.title = title
    dbState.summaries.set(id, { id: s.id, title, createdAt: s.createdAt, updatedAt: s.updatedAt })
  }
}

export const deleteSession = async (id) => {
  dbState.sessions.delete(id)
  dbState.summaries.delete(id)
}

export const saveFiles = async () => {}
export const loadFile = async () => undefined
export const beginStaging = async () => { throw new Error('unused') }
export const stagingWriter = () => { throw new Error('unused') }
export const reportStorageError = () => (error) => { throw error }
`)
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
globalThis.document = { visibilityState: 'hidden' }
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => storageData.get(key) ?? null,
    setItem: (key, value) => storageData.set(key, String(value)),
    removeItem: (key) => storageData.delete(key),
  },
})
globalThis.cancelAnimationFrame = () => {}
globalThis.__API_ORIGIN__ = 'https://mock.invalid'

const { activateBranch, getReachableMessageIds, getVisibleMessages } =
  await import('../src/services/chat/branches.ts')
const { buildSearchSnippet, formatSearchDate, searchLocalHistory, searchSessionContent } =
  await import('../src/services/chat/contentSearch.ts')
const { clearPendingJump, initChat, selectSession, selectSessionMessage, useChatStore } =
  await import('../src/services/chat/store.ts')
const { dbState, resetDbMock, seedSession } = await import(databaseMock)

const userMsg = (id, parentId, createdAt, content, selectedChildId) => ({
  id,
  parentId,
  ...(selectedChildId ? { selectedChildId } : {}),
  role: 'user',
  content,
  files: [],
  createdAt,
})

const assistantMsg = (id, parentId, createdAt, blocks, { selectedChildId, stopReason } = {}) => ({
  id,
  parentId,
  ...(selectedChildId ? { selectedChildId } : {}),
  role: 'assistant',
  createdAt,
  model: 'deepseek-flash',
  prefix: true,
  status: 'done',
  ...(stopReason ? { stopReason } : {}),
  blocks,
})

test('1. 标题、用户消息、助手正文与思考内容按官方规则匹配，单条消息至多返回一条结果', () => {
  const session = {
    id: 's1',
    title: 'Schrodinger equation',
    createdAt: 1000,
    updatedAt: 5000,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 1000, 'Output only the Schrodinger equation as LaTeX.', 'a1'),
      assistantMsg(
        'a1',
        'u1',
        2000,
        [
          { type: 'thinking', thinking: 'Need integral equation in display math.' },
          { type: 'text', text: 'Mass and energy are related by E = mc^2.' },
        ],
        { selectedChildId: 'u2' }
      ),
      userMsg('u2', 'a1', 3000, 'Explain both thinking and answer.', 'a2'),
      assistantMsg('a2', 'u2', 4000, [
        { type: 'thinking', thinking: 'Thinking also mentions equation.' },
        { type: 'text', text: 'Answer mentions Equation clearly.' },
      ]),
    ],
  }

  const hits = searchSessionContent(session, 'EQUATION')
  assert.equal(hits.length, 4)
  assert.deepEqual(
    hits.map((h) =>
      h.kind === 'session' ? `session:${h.timestamp}` : `${h.role}:${h.messageId}:${h.timestamp}`
    ),
    ['session:5000', 'assistant:a2:4000', 'assistant:a1:2000', 'user:u1:1000']
  )
  // a1 仅思考命中，a2 正文与思考都命中时优先正文片段且不重复返回两条，省略号后无多余空格
  assert.equal(hits[1].kind, 'message')
  assert.equal(hits[1].snippet, '...mentions Equation clearly.')
  assert.equal(hits[2].kind, 'message')
  assert.match(hits[2].snippet, /integral equation in display math/)
})

test('2. 安全拒绝消息不泄露已丢弃的思考与正文块', () => {
  const session = {
    id: 's-refuse',
    title: '测试',
    createdAt: 1000,
    updatedAt: 2000,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 1000, '问题', 'a1'),
      assistantMsg(
        'a1',
        'u1',
        2000,
        [
          { type: 'thinking', thinking: 'secret keyword hidden' },
          { type: 'text', text: 'discarded keyword hidden' },
          { type: 'text', text: '安全拒绝模板', isTemplate: true },
        ],
        { stopReason: 'refusal' }
      ),
    ],
  }

  assert.equal(searchSessionContent(session, 'keyword').length, 0)
  const templateHits = searchSessionContent(session, '拒绝模板')
  assert.equal(templateHits.length, 1)
  assert.equal(templateHits[0].kind, 'message')
})

test('3. 覆盖非当前激活分支并标出 1/3、2/3、3/3 版本号，过滤不可达孤立节点', () => {
  const session = {
    id: 's-branch',
    title: 'Find n square condition',
    createdAt: 1000,
    updatedAt: 5000,
    rootMessageId: 'u1',
    messages: [
      userMsg('u1', null, 1000, 'Solve n^2 + 2^n', 'a3'),
      assistantMsg('a1', 'u1', 2000, [{ type: 'text', text: 'Equation version one' }], {
        selectedChildId: 'u2-old',
      }),
      userMsg('u2-old', 'a1', 2500, 'Follow-up equation on branch one'),
      assistantMsg('a2', 'u1', 3000, [{ type: 'text', text: 'Check equation version two' }]),
      assistantMsg('a3', 'u1', 4000, [{ type: 'text', text: 'Final equation version three' }]),
      // 孤立损坏节点
      userMsg('orphan', 'missing-parent', 4500, 'Orphan equation should be skipped'),
    ],
  }

  assert.equal(getReachableMessageIds(session).has('orphan'), false)

  const hits = searchSessionContent(session, 'equation')
  assert.deepEqual(
    hits.map((h) => `${h.messageId}:${h.branchLabel}`),
    ['a3:3/3', 'a2:2/3', 'u2-old:null', 'a1:1/3']
  )

  // 激活深层非当前分支节点 u2-old：应同时把 u1.selectedChildId 切到 a1，保留 a1 -> u2-old
  const activated = activateBranch(session, 'u2-old')
  assert.deepEqual(
    getVisibleMessages(activated).map((m) => m.id),
    ['u1', 'a1', 'u2-old']
  )
  // 已在当前可见路径上再次激活应原样返回同一引用
  assert.strictEqual(activateBranch(activated, 'u2-old'), activated)
})

test('4. 摘要片段构建：前置省略、多处大小写无关高亮、换行折叠与 emoji 代理对安全', () => {
  const short = buildSearchSnippet('latest DeepSeek news', 'deepseek')
  assert.ok(short)
  assert.equal(short.snippet, 'latest DeepSeek news')
  assert.deepEqual(short.highlights, [{ start: 7, end: 15 }])

  const multi = buildSearchSnippet(
    '开头铺垫很长一段无关文字用于测试截断边界。R1，我是**DeepSeek-V3**。\nDeepSeek-V3 由深度求索开发。',
    'deepseek'
  )
  assert.ok(multi)
  assert.ok(multi.snippet.startsWith('...'))
  assert.equal(multi.highlights.length, 2)
  assert.equal(multi.snippet.slice(multi.highlights[0].start, multi.highlights[0].end), 'DeepSeek')
  assert.equal(multi.snippet.slice(multi.highlights[1].start, multi.highlights[1].end), 'DeepSeek')

  const schrodinger = buildSearchSnippet(
    'Output only the Schrodinger equation as a single LaTeX display block formula.',
    'equation'
  )
  assert.ok(schrodinger)
  assert.ok(schrodinger.snippet.startsWith('...Schrodinger equation'))

  // Emoji 代理对不被截断产生乱码
  const emojiText = '😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀 DeepSeek test'
  const emojiRes = buildSearchSnippet(emojiText, 'deepseek')
  assert.ok(emojiRes)
  assert.equal(emojiRes.snippet.includes('\uFFFD'), false)
  assert.equal(
    emojiRes.snippet.slice(emojiRes.highlights[0].start, emojiRes.highlights[0].end),
    'DeepSeek'
  )
})

test('5. 日期格式化与官方 2.8.0 中英文实机一致', () => {
  const now = new Date(2026, 10, 22, 15, 0, 0).getTime() // 2026-11-22
  const today = new Date(2026, 10, 22, 9, 30, 0).getTime()
  const yesterday = new Date(2026, 10, 21, 23, 59, 0).getTime()
  const sameYear = new Date(2026, 10, 19, 10, 0, 0).getTime()
  const prevYear = new Date(2025, 1, 6, 12, 0, 0).getTime()

  assert.equal(formatSearchDate(today, now, 'zh-CN'), '今天')
  assert.equal(formatSearchDate(yesterday, now, 'zh-CN'), '昨天')
  assert.equal(formatSearchDate(sameYear, now, 'zh-CN'), '11月19日')
  assert.equal(formatSearchDate(prevYear, now, 'zh-CN'), '2025年2月6日')

  assert.equal(formatSearchDate(today, now, 'en-US'), 'Today')
  assert.equal(formatSearchDate(yesterday, now, 'en-US'), 'Yesterday')
  assert.equal(formatSearchDate(sameYear, now, 'en-US'), 'Nov 19')
  assert.equal(formatSearchDate(prevYear, now, 'en-US'), 'Feb 6, 2025')
})

test('6. 全库搜索优先使用内存缓存、跳过已缓存 ID 并在取消时中止游标，跳转端到端激活分支', async () => {
  resetDbMock()
  const sCached = {
    id: 's-cached',
    title: '旧标题',
    createdAt: 1000,
    updatedAt: 2000,
    rootMessageId: 'u1',
    messages: [userMsg('u1', null, 1500, 'disk old text')],
  }
  const sDisk = {
    id: 's-disk',
    title: '磁盘分支会话',
    createdAt: 1000,
    updatedAt: 6000,
    rootMessageId: 'du1',
    messages: [
      userMsg('du1', null, 1000, '问题', 'da2'),
      assistantMsg('da1', 'du1', 2500, [{ type: 'text', text: '分支一命中 targetword' }]),
      assistantMsg('da2', 'du1', 5000, [{ type: 'text', text: '分支二未命中' }]),
    ],
  }
  seedSession(sCached)
  seedSession(sDisk)

  const liveCached = {
    ...sCached,
    title: '最新标题 targetword',
    updatedAt: 7000,
    messages: [userMsg('u1', null, 6500, 'live cached targetword')],
  }
  const summaries = [
    { id: liveCached.id, title: liveCached.title, createdAt: 1000, updatedAt: 7000 },
    { id: sDisk.id, title: sDisk.title, createdAt: 1000, updatedAt: 6000 },
  ]

  const results = await searchLocalHistory('targetword', summaries, { [liveCached.id]: liveCached })
  assert.equal(dbState.scanCount, 1) // 仅扫描了未缓存的 s-disk
  assert.deepEqual(
    results.map((r) => r.key),
    ['session:s-cached', 'message:s-cached:u1', 'message:s-disk:da1']
  )
  assert.equal(results[2].kind, 'message')
  assert.equal(results[2].branchLabel, '1/2')

  // 取消信号生效
  const aborted = new AbortController()
  aborted.abort()
  assert.deepEqual(await searchLocalHistory('targetword', summaries, {}, aborted.signal), [])

  // 端到端 store：从未加载会话的非激活分支消息 da1 跳转时自动加载并激活 da1 分支
  useChatStore.setState({
    ready: false,
    sessions: [],
    sessionCache: {},
    activeId: null,
    pendingJump: null,
    streaming: {},
  })
  await initChat()
  selectSessionMessage('s-disk', 'da1')
  const jump = useChatStore.getState().pendingJump
  assert.ok(jump)
  assert.equal(jump.sessionId, 's-disk')
  assert.equal(jump.messageId, 'da1')

  // 等待异步 loadSession 完成
  await new Promise((resolve) => setTimeout(resolve, 20))
  const loaded = useChatStore.getState().sessionCache['s-disk']
  assert.ok(loaded)
  assert.deepEqual(
    getVisibleMessages(loaded).map((m) => m.id),
    ['du1', 'da1']
  )

  clearPendingJump(jump.nonce)
  assert.equal(useChatStore.getState().pendingJump, null)

  // 普通打开会话（标题结果点击）清除 pendingJump
  selectSessionMessage('s-disk', 'da2')
  assert.ok(useChatStore.getState().pendingJump)
  selectSession('s-disk')
  assert.equal(useChatStore.getState().pendingJump, null)
})
