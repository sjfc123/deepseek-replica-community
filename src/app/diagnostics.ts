import { android, saveAndroidHistory } from './android.js'
import { useChatStore } from '../services/chat/store.js'
import { useSettings } from '../services/settings.js'
import { readMigrationReport } from '../services/dataMigration.js'
import { getUnreadableRecordCount } from '../services/chat/db.js'

/** 最近错误只留摘要，避免诊断包变大；不记录任何消息正文或 API Key */
type DiagnosticError = { at: string; source: string; message: string }

const errors: DiagnosticError[] = []
let installed = false

const pushError = (source: string, message: string) => {
  errors.push({ at: new Date().toISOString(), source, message: message.slice(0, 300) })
  if (errors.length > 20) {
    errors.shift()
  }
}

/** 在 App 挂载时调用一次；重复调用不会重复注册 */
type InteractionRecord = { at: string; action: string; target: string; gapMs: number }
type StallRecord = { at: string; ms: number; during: string }

const interactions: InteractionRecord[] = []
const stalls: StallRecord[] = []
let lastActionAt = performance.now()
let lastFrameAt = performance.now()
let persistTimer = 0

const readDeviceStats = (): Record<string, unknown> | null => {
  const bridge = (window as Window & { DeepSeekAndroid?: { deviceStats?: () => string } })
    .DeepSeekAndroid
  if (typeof bridge?.deviceStats !== 'function') {
    return null
  }
  try {
    return JSON.parse(bridge.deviceStats()) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 把按钮上的可读文案压成一行，日志里能看出点的是哪个功能 */
const describeTarget = (target: EventTarget | null): string => {
  const element = target instanceof Element ? target : null
  if (!element) {
    return '未知目标'
  }
  // 只认可交互控件，正文区域只记标签名，避免把聊天内容写进日志
  const control = element.closest(
    'button, a, [role="menuitem"], [role="button"], [role="switch"], input, textarea'
  ) as HTMLElement | null
  if (!control) {
    return element.tagName.toLowerCase()
  }
  const label = control.getAttribute('aria-label')
  if (label) {
    return label.slice(0, 40)
  }
  const text = (control.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 40) : control.tagName.toLowerCase()
}

/** 每 30 秒或每 8 次操作落一次盘，强退时最多丢最近几秒 */
const persistSessionLog = (cleanExit = false) => {
  try {
    localStorage.setItem(
      'replica:last-session-log',
      JSON.stringify({
        at: new Date().toISOString(),
        cleanExit,
        device: readDeviceStats(),
        interactions: interactions.slice(-40),
        stalls: stalls.slice(-20),
        errors: errors.slice(-10),
      })
    )
  } catch {
    // 存储已满时放弃这次落盘，不影响主流程
  }
}

const schedulePersist = () => {
  if (persistTimer) {
    return
  }
  persistTimer = window.setTimeout(() => {
    persistTimer = 0
    persistSessionLog()
  }, 3000)
}

let tapTimes: number[] = []

const recordInteraction = (action: string, target: EventTarget | null) => {
  if (action === 'tap') {
    const now = performance.now()
    tapTimes = tapTimes.filter((time) => now - time < 1500)
    tapTimes.push(now)
    if (tapTimes.length >= 8) {
      stalls.push({
        at: new Date().toISOString(),
        ms: Math.round(now - tapTimes[0]),
        during: `1.5 秒内连点 ${tapTimes.length} 次：${describeTarget(target)}`,
      })
      if (stalls.length > 20) {
        stalls.shift()
      }
      persistSessionLog()
      tapTimes = []
    }
  }
  const now = performance.now()
  const gapMs = Math.round(now - lastActionAt)
  lastActionAt = now
  interactions.push({
    at: new Date().toISOString(),
    action,
    target: describeTarget(target),
    gapMs,
  })
  if (interactions.length > 40) {
    interactions.shift()
  }
  schedulePersist()
}

const recordStall = (ms: number, during: string) => {
  stalls.push({ at: new Date().toISOString(), ms: Math.round(ms), during })
  if (stalls.length > 20) {
    stalls.shift()
  }
  persistSessionLog()
}

/** 主线程卡顿看门狗：两帧间隔超过 200ms 就记一次，能看出卡在哪个界面 */
const watchFrames = (now: number) => {
  if (document.visibilityState === 'visible') {
    const gap = now - lastFrameAt
    // 超过 8 秒的空档基本是切到后台、系统文件面板或锁屏，rAF 本来就停了，
    // 不能当成应用无响应，否则会把在系统界面停留的时间算成卡死。
    if (gap > 200 && gap < 8000) {
      const last = interactions.at(-1)?.target ?? describeTarget(document.activeElement)
      recordStall(gap, gap > 1000 ? `无响应 ${Math.round(gap)}ms，最后操作：${last}` : last)
    }
  }
  lastFrameAt = now
  window.requestAnimationFrame(watchFrames)
}

/** 在 App 挂载时调用一次；重复调用不会重复注册 */
export const installDiagnostics = () => {
  if (installed) {
    return
  }
  installed = true
  window.addEventListener('error', (event) => {
    pushError('error', event.message || String(event.error ?? 'unknown'))
    schedulePersist()
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    pushError('promise', reason instanceof Error ? reason.message : String(reason))
    schedulePersist()
  })
  // 任何点击都留一条，包含功能和两次操作之间的间隔
  window.addEventListener(
    'pointerdown',
    (event) => recordInteraction('tap', event.target),
    { capture: true, passive: true }
  )
  // 返回键、抽屉、弹窗这类不一定有 pointerdown 的入口也记
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Back' || event.key === 'Escape') {
      recordInteraction(`key:${event.key}`, event.target)
    }
  })
  // 启动即开始记录，先判断上次是否非正常退出
  recordInteraction('boot', document.body)
  try {
    const previous = JSON.parse(localStorage.getItem('replica:last-session-log') ?? 'null') as {
      cleanExit?: boolean
      stalls?: Array<{ ms: number }>
        at?: string
    } | null
    if (previous && previous.cleanExit === false) {
      pushError(
        'crash',
        `上次运行未正常退出（${previous.at ?? '时间未知'}，记录到 ${
          previous.stalls?.length ?? 0
        } 次停顿），已保留上次快照供诊断`
      )
    }
  } catch {
    // 旧格式快照读不动就忽略
  }

  // 长任务：超过 50ms 的脚本占用单独记，和帧间隔互为补充
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= 50 && entry.duration < 10_000) {
          recordStall(entry.duration, '长任务')
        }
      }
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    // 内核不支持 longtask 就只靠帧看门狗
  }

  // 渲染异常：WebGL 上下文丢失会让画面停住但点击可能还在响应
  window.addEventListener(
    'webglcontextlost',
    (event) => {
      pushError('render', `WebGL 上下文丢失：${describeTarget(event.target)}`)
      recordStall(0, '渲染上下文丢失')
    },
    true
  )

  window.requestAnimationFrame(watchFrames)
  window.setInterval(persistSessionLog, 30_000)
  window.addEventListener('pagehide', () => persistSessionLog(true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      persistSessionLog()
    } else {
      lastFrameAt = performance.now()
    }
  })
}

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // WebView 或旧内核的 clipboard 可能被拒绝，退回隐藏 textarea 实现
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = (() => {
    try {
      return document.execCommand('copy')
    } catch {
      return false
    }
  })()
  area.remove()
  return ok
}

/** 读本机留存的启动/渲染错误摘要；读不到就返回 null，不影响诊断生成 */
const readStoredJson = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

/** 生成可分享的诊断文本：版本、平台、关键设置、数据规模与最近错误 */
export const buildDiagnostics = async () => {
  const settings = useSettings.getState()
  const store = useChatStore.getState()
  let storage: { usage?: number; quota?: number } = {}
  try {
    storage = (await navigator.storage?.estimate?.()) ?? {}
  } catch {
    storage = {}
  }
  const device = readDeviceStats()
  const previous = readStoredJson('replica:last-session-log')
  return {
    generatedAt: new Date().toISOString(),
    device,
    previousSession: previous,
    recentInteractions: interactions.slice(-30),
    stalls: stalls.slice(-20),
    version:
      document.querySelector('meta[name="application-version"]')?.getAttribute('content') ?? null,
    platform: android ? 'android-webview' : 'web',
    secureContext: window.isSecureContext,
    userAgent: navigator.userAgent,
    screen: { width: window.innerWidth, height: window.innerHeight, dpr: devicePixelRatio },
    data: {
      sessions: store.sessions.length,
      pinnedSessions: settings.pinnedSessions.length,
      streaming: Object.keys(store.streaming).length,
      ready: store.ready,
      initError: store.initError,
      storageUsage: storage.usage ?? null,
      storageQuota: storage.quota ?? null,
      unreadableRecords: getUnreadableRecordCount(),
    },
    startup: {
      patchedApis:
        (window as Window & { __replicaCompat?: { patched: string[] } }).__replicaCompat?.patched ??
        [],
      dataMigration: readMigrationReport(),
      lastBootError: readStoredJson('replica:last-boot-error'),
      lastRenderError: readStoredJson('replica:last-render-error'),
    },
    settings: {
      locale: settings.locale,
      theme: settings.themePreference,
      chatLayout: settings.chatLayout,
      avatarShape: settings.avatarShape,
      autoFollow: settings.autoFollow,
      autoCompact: settings.autoCompact,
      keepRefusedContent: settings.keepRefusedContent,
      refusalEnabled: settings.refusalEnabled,
      safetyCheck: settings.safetyCheck,
      tokenLimit: settings.tokenLimit,
      showUsage: settings.showUsage,
      memoryMode: settings.memoryMode,
      worldbookInject: settings.worldbookInject,
      memoryLimit: settings.memoryLimit,
      autoBackup: settings.autoBackup,
      autoBackupMinutes: settings.autoBackupMinutes,
      characterCards: settings.characterCards.length,
      activeCharacter: Boolean(settings.activeCharacterId),
      roleplayEnabled: settings.roleplayEnabled,
      worldbookEntries: settings.worldbook.length,
      sceneAutoUpdate: settings.sceneAutoUpdate,
    },
    recentErrors: errors,
  }
}

export const copyDiagnostics = async () => {
  const text = JSON.stringify(await buildDiagnostics(), null, 2)
  return copyText(text)
}

/* ------------------------------------------------------------------ */
/* 主动诊断：每项都真跑一遍，只写实际结果，跑不动的写「跳过：原因」 */
/* ------------------------------------------------------------------ */

export type DiagnosticFinding = { level: 'problem'; area: string; detail: string }
export type DiagnosticFact = { area: string; detail: string }

const JSON_KEYS = [
  ['replica:character-cards', '角色卡'],
  ['replica:worldbook', '世界书'],
  ['replica:session-folders', '会话分组'],
  ['replica:session-folder-map', '分组归属'],
  ['replica:session-archived', '归档列表'],
  ['replica:pinned-sessions', '置顶会话'],
] as const

const probeIndexedDb = (): Promise<{ ok: boolean; detail: string }> =>
  new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve({ ok: false, detail: '当前环境没有 indexedDB' })
      return
    }
    let settled = false
    const finish = (ok: boolean, detail: string) => {
      if (!settled) {
        settled = true
        resolve({ ok, detail })
      }
    }
    try {
      const request = indexedDB.open('chat-demo')
      request.onsuccess = () => {
        const db = request.result
        const names = Array.from(db.objectStoreNames)
        db.close()
        finish(true, `可打开，${names.length} 个表：${names.join('、') || '空'}`)
      }
      request.onerror = () =>
        finish(false, `打开失败：${request.error?.name ?? '未知错误'} ${request.error?.message ?? ''}`)
      request.onblocked = () => finish(false, '被其它标签页占用，打开被阻塞')
      window.setTimeout(() => finish(false, '4 秒内没有打开，可能被阻塞'), 4000)
    } catch (error) {
      finish(false, error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    }
  })

const probeLocalStorage = (): { ok: boolean; detail: string } => {
  try {
    const key = 'replica:diag-probe'
    localStorage.setItem(key, '1')
    const read = localStorage.getItem(key)
    localStorage.removeItem(key)
    return { ok: read === '1', detail: read === '1' ? '读写正常' : '写入后读不回' }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  }
}

const probeAudioContext = (): { ok: boolean; detail: string } => {
  const Ctor = window.AudioContext
  if (!Ctor) {
    return { ok: false, detail: '当前环境没有 AudioContext' }
  }
  try {
    const ctx = new Ctor()
    const rate = ctx.sampleRate
    void ctx.close?.()
    return { ok: true, detail: `可创建，采样率 ${rate} Hz，状态 ${ctx.state}` }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  }
}

/** 原生麦克风自检：真开一次 AudioRecord。返回解析后的对象或 null */
const probeNativeMic = (): Record<string, unknown> | null => {
  const bridge = (window as Window & { DeepSeekAndroid?: { probeMicrophone?: () => string } })
    .DeepSeekAndroid
  if (typeof bridge?.probeMicrophone !== 'function') {
    return null
  }
  try {
    const raw = bridge.probeMicrophone()
    return JSON.parse(raw) as Record<string, unknown>
  } catch (error) {
    return { ok: false, stage: 'bridge', error: error instanceof Error ? error.message : String(error) }
  }
}

const bridgeMethods = () => {
  const bridge = (window as Window & { DeepSeekAndroid?: Record<string, unknown> }).DeepSeekAndroid
  if (!bridge) {
    return null
  }
  return Object.keys(bridge)
    .filter((key) => typeof bridge[key] === 'function')
    .sort()
}

/** 跑一次完整自检，返回问题清单、实测事实与已排版的日志正文 */
export const collectDiagnosticReport = async () => {
  const findings: DiagnosticFinding[] = []
  const facts: DiagnosticFact[] = []
  const started = performance.now()

  const idb = await probeIndexedDb()
  facts.push({ area: '本地数据库', detail: idb.detail })
  if (!idb.ok) {
    findings.push({ level: 'problem', area: '本地数据库', detail: idb.detail })
  }

  const ls = probeLocalStorage()
  facts.push({ area: '本机设置存储', detail: ls.detail })
  if (!ls.ok) {
    findings.push({ level: 'problem', area: '本机设置存储', detail: ls.detail })
  }

  for (const [key, label] of JSON_KEYS) {
    const raw = localStorage.getItem(key)
    if (raw === null) {
      facts.push({ area: label, detail: '没有这份数据（未使用过）' })
      continue
    }
    try {
      const parsed = JSON.parse(raw)
      const size = Array.isArray(parsed) ? `${parsed.length} 项` : typeof parsed
      facts.push({ area: label, detail: `JSON 正常，${size}，${raw.length} 字节` })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      facts.push({ area: label, detail: `JSON 解析失败：${detail}` })
      findings.push({ level: 'problem', area: label, detail: `数据损坏，解析失败：${detail}` })
    }
  }

  const audio = probeAudioContext()
  facts.push({ area: '音频引擎', detail: audio.detail })
  if (!audio.ok) {
    findings.push({ level: 'problem', area: '音频引擎', detail: audio.detail })
  }

  const mic = probeNativeMic()
  if (mic === null) {
    facts.push({ area: '麦克风自检', detail: '跳过：当前环境没有 probeMicrophone 桥（浏览器）' })
  } else {
    const detail = mic.ok
      ? `通道正常，原生录到 ${String(mic.read ?? 0)} 个采样，AudioManager 模式 ${String(mic.mode ?? -1)}`
      : `失败于 ${String(mic.stage ?? '未知')} 阶段：${String(mic.error ?? '无错误信息')}（权限 ${
          mic.perm ? '已授予' : '未授予'
        }）`
    facts.push({ area: '麦克风自检', detail })
    if (!mic.ok) {
      findings.push({ level: 'problem', area: '麦克风', detail })
    }
  }

  const methods = bridgeMethods()
  facts.push({
    area: '原生桥',
    detail: methods ? `${methods.length} 个方法：${methods.join('、')}` : '跳过：当前是浏览器环境',
  })

  let storage: { usage?: number; quota?: number } = {}
  try {
    storage = (await navigator.storage?.estimate?.()) ?? {}
  } catch (error) {
    facts.push({
      area: '存储配额',
      detail: `读取失败：${error instanceof Error ? error.message : String(error)}`,
    })
  }
  if (storage.quota) {
    const percent = ((storage.usage ?? 0) / storage.quota) * 100
    const detail = `已用 ${((storage.usage ?? 0) / 1048576).toFixed(1)} MB / ${(
      storage.quota / 1048576
    ).toFixed(1)} MB（${percent.toFixed(1)}%）`
    facts.push({ area: '存储配额', detail })
    if (percent > 90) {
      findings.push({ level: 'problem', area: '存储配额', detail: `接近上限：${detail}` })
    }
  }

  const jsMemory = (performance as Performance & {
    memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number }
  }).memory
  const device = readDeviceStats()
  if (device === null) {
    facts.push({ area: '设备资源', detail: '跳过：当前环境没有 deviceStats 桥（浏览器）' })
  } else if (typeof device.error === 'string') {
    facts.push({ area: '设备资源', detail: `原生读取失败：${device.error}` })
    findings.push({ level: 'problem', area: '设备资源', detail: `读取失败：${device.error}` })
  } else {
    const mb = (value: unknown) =>
      typeof value === 'number' ? `${(value / 1048576).toFixed(1)} MB` : '未知'
    const total = Number(device.totalMem ?? 0)
    const avail = Number(device.availMem ?? 0)
    const free = Number(device.storageFree ?? 0)
    const cache = Number(device.cacheBytes ?? 0)
    const dataBytes = Number(device.dataBytes ?? 0)
    const heapUsed = Number(device.heapUsed ?? 0)
    const heapMax = Number(device.heapMax ?? 0)
    const detail = `内存 可用 ${mb(avail)} / 共 ${mb(total)}，低内存标记 ${
      device.lowMemory ? '是' : '否'
    }；应用缓存 ${mb(cache)}，应用数据 ${mb(dataBytes)}，WebView 存储 ${mb(
      Number(device.webviewBytes ?? 0)
    )}；机身剩余 ${mb(free)}；Java 堆 ${mb(
      heapUsed
    )} / ${mb(heapMax)}；JS 堆 ${
      jsMemory ? `${mb(jsMemory.usedJSHeapSize)} / ${mb(jsMemory.jsHeapSizeLimit)}` : '当前内核不提供'
    }`
    facts.push({ area: '设备资源', detail })
    if (device.lowMemory) {
      findings.push({ level: 'problem', area: '设备内存', detail: '系统报告当前处于低内存状态' })
    }
    if (total > 0 && avail / total < 0.12) {
      findings.push({ level: 'problem', area: '设备内存', detail: `可用内存低于 12%：${detail}` })
    }
    if (free > 0 && free < 500 * 1048576) {
      findings.push({ level: 'problem', area: '设备存储', detail: `机身剩余不足 500 MB：${mb(free)}` })
    }
    if (cache > 200 * 1048576) {
      findings.push({ level: 'problem', area: '应用缓存', detail: `缓存偏大：${mb(cache)}` })
    }
  }

  const previous = readStoredJson('replica:last-session-log')
  facts.push({
    area: '上次运行快照',
    detail: previous ? '有一份，已一并写入日志正文' : '没有（本次是首次记录或已清空）',
  })

  const unreadable = getUnreadableRecordCount()
  facts.push({ area: '不可读记录', detail: `${unreadable} 条` })
  if (unreadable > 0) {
    findings.push({ level: 'problem', area: '本地记录', detail: `${unreadable} 条记录读不出来` })
  }

  const state = useChatStore.getState()
  facts.push({
    area: '对话数据',
    detail: `会话 ${state.sessions.length} 个，缓存 ${Object.keys(state.sessionCache).length} 个，正在生成 ${
      Object.keys(state.streaming).length
    } 个`,
  })
  if (state.sessions.length > 800) {
    findings.push({
      level: 'problem',
      area: '会话数量',
      detail: `${state.sessions.length} 个会话，列表与启动加载会明显变慢，建议归档或导出旧会话`,
    })
  }
  if (state.initError) {
    findings.push({ level: 'problem', area: '初始化', detail: String(state.initError) })
  }
  if (!state.ready) {
    findings.push({ level: 'problem', area: '初始化', detail: '数据层尚未就绪' })
  }

  facts.push({
    area: '网络',
    detail: navigator.onLine ? '系统报告在线' : '系统报告离线',
  })
  if (!navigator.onLine) {
    findings.push({ level: 'problem', area: '网络', detail: '系统报告当前离线，请求会直接失败' })
  }

  const report = {
    generatedAt: new Date().toISOString(),
    version:
      document.querySelector('meta[name="application-version"]')?.getAttribute('content') ?? null,
    platform: android ? 'android-webview' : 'web',
    userAgent: navigator.userAgent,
    screen: `${window.innerWidth}×${window.innerHeight}@${devicePixelRatio}`,
    secureContext: window.isSecureContext,
    elapsedMs: Math.round(performance.now() - started),
    findings,
    facts,
    recentErrors: errors,
    device,
    interactions: interactions.slice(-40),
    stalls: stalls.slice(-20),
    previousSession: previous,
  }

  const lines: string[] = [
    'DeepSeek Replica 诊断日志',
    '======================',
    `生成时间：${report.generatedAt}`,
    `版本：${report.version ?? '未知'}`,
    `平台：${report.platform}`,
    `屏幕：${report.screen}`,
    `安全上下文：${report.secureContext ? '是' : '否'}`,
    `自检耗时：${report.elapsedMs} ms`,
    '',
    `一、发现的问题（${findings.length} 项）`,
  ]
  if (findings.length === 0) {
    lines.push('本次自检没有发现异常。这不代表功能都正常，只代表下面这些检查项都通过。')
  } else {
    findings.forEach((item, index) => {
      lines.push(`${index + 1}. [${item.area}] ${item.detail}`)
    })
  }
  lines.push('', '二、实测项（每项都是本次真实执行的结果）')
  for (const fact of facts) {
    lines.push(`- ${fact.area}：${fact.detail}`)
  }
  lines.push('', `三、界面捕获的错误（${errors.length} 条，最多保留 20 条）`)
  if (errors.length === 0) {
    lines.push('- 本次运行没有捕获到未处理异常')
  } else {
    for (const item of errors) {
      lines.push(`- ${item.at} [${item.source}] ${item.message}`)
    }
  }
  lines.push('', '四、设备与应用占用（判断软件还是设备）')
  if (device === null || typeof device.error === 'string') {
    lines.push('- 当前环境读不到原生设备数据')
  } else {
    const mb = (value: unknown) =>
      typeof value === 'number' ? `${(value / 1048576).toFixed(1)} MB` : '未知'
    lines.push(
      `- 运行内存：可用 ${mb(device.availMem)} / 共 ${mb(device.totalMem)}，低内存=${
        device.lowMemory ? '是' : '否'
      }，阈值 ${mb(device.threshold)}`,
      `- Java 堆：${mb(device.heapUsed)} / 上限 ${mb(device.heapMax)}`,
      `- JS 堆：${jsMemory ? `${mb(jsMemory.usedJSHeapSize)} / 上限 ${mb(jsMemory.jsHeapSizeLimit)}` : '当前内核不提供'}`,
      `- 应用缓存：${mb(device.cacheBytes)}`,
      `- 应用数据：${mb(device.dataBytes)}`,
      `- WebView 存储：${mb(Number(device.webviewBytes ?? 0))}`,
      `- 机身存储：剩余 ${mb(device.storageFree)} / 共 ${mb(device.storageTotal)}`
    )
  }

  lines.push('', `五、最近操作轨迹（${interactions.length} 条，最多 40 条）`)
  if (interactions.length === 0) {
    lines.push('- 没有记录到操作')
  } else {
    for (const item of interactions.slice(-30)) {
      lines.push(
        `- ${item.at} ${item.action}「${item.target}」，距上次操作 ${item.gapMs} ms`
      )
    }
  }

  lines.push('', `六、卡顿记录（${stalls.length} 条，两帧间隔超过 200ms 记一次）`)
  if (stalls.length === 0) {
    lines.push('- 本次运行没有出现超过 200ms 的主线程停顿')
  } else {
    for (const item of stalls) {
      lines.push(`- ${item.at} 停顿 ${item.ms} ms，发生在「${item.during}」`)
    }
  }

  lines.push('', '七、上次运行留下的快照（强制退出前落盘）')
  if (previous) {
    lines.push(JSON.stringify(previous, null, 2))
  } else {
    lines.push('- 没有')
  }

  lines.push('', '八、环境', `- UA：${navigator.userAgent}`)

  return { report, text: lines.join('\n') }
}

/** 跑自检并把日志写成文件；Android 走系统保存，浏览器直接下载 */
export const saveDiagnosticReport = async () => {
  const { report, text } = await collectDiagnosticReport()
  const stamp = new Date()
  const name = `deepseek_diagnose-${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(
    stamp.getDate()
  ).padStart(2, '0')}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(
    2,
    '0'
  )}.txt`
  const blob = new Blob([text], { type: 'text/plain' })
  if (android) {
    const saved = await saveAndroidHistory(name, blob)
    return { saved, name, findings: report.findings }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { saved: true, name, findings: report.findings }
}
