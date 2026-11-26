/* ============================================================================
 * 功能区：会话与角色核心 / cacheDiagnostics
 * 职责：记录每次请求的前缀指纹与 usage，区分静态 system、动态尾部和历史段；命中正常时不报警，连续骤降时给出原因分析。
 * 分区：01 类型、常量与模块依赖；
 *    02 读取与解析（findPrefixDrift、auditSystemText、buildPromptConfigFingerprint…）；
 *    03 读取与解析（readAll、isSample、recordPromptCacheSample…）；
 *    04 类型与契约（CacheDiagnosis）；05 类型与契约（PromptCacheStatus）
 * 关联：依赖 services/api/types；
 *    被 scripts/test-cache-diagnostics、app/diagnostics、components/settings/TokenUsagePanel、services/chat/store 引用。
 * 导出：PROMPT_CACHE_STORAGE_KEY、hashPromptText、RequestFingerprint、fingerprintRequestMessages、fingerprintWireRequest、SystemAudit、auditSystemText、buildPromptConfigFingerprint、PromptCacheSample、PromptCacheSampleInput、recordPromptCacheSample、readPromptCacheSamples 等 17 项
 * 边界：只处理聊天领域的数据、状态转换与提示词装配；不直接渲染视图，不发起职责外的网络请求。
 * ========================================================================== */

import type { MessageUsage } from '../api/types.js'

/* ---- 01 类型、常量与模块依赖 ---- */
export const PROMPT_CACHE_STORAGE_KEY = 'replica:prompt-cache-samples'
const MAX_SAMPLES = 80
/** 消息链只在最近两条样本保留：诊断只比较相邻两轮，旧样本不再占存储。 */
const KEEP_CHAIN_SAMPLES = 2
/** 单条样本最多逐条比对的 messages 数；超出后仍保留整轮 requestHash，但不无限膨胀数组。 */
const MAX_CHAIN_MESSAGES = 512
const LOW_RATE = 0.12
const HEALTHY_RATE = 0.4

/** 两段 32 位 FNV-1a，避免只靠短哈希在长提示词里撞车 */
export const hashPromptText = (text: string): string => {
  let left = 0x811c9dc5
  let right = 0x9e3779b9
  for (const char of Array.from(text)) {
    const code = char.codePointAt(0) ?? 0
    left = Math.imul(left ^ code, 16777619)
    right = Math.imul(right ^ code, 2246822519)
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0)
    .toString(16)
    .padStart(8, '0')}`
}

export type RequestFingerprint = {
  messageChain: string[]
  messageRoles: string[]
  requestHash: string
  chainTruncated: boolean
  messageCount: number
}

/**
 * 给实际要发的 messages 建逐条累计指纹。`system` 只是前缀的一小段，
 * 历史 user/assistant 任何一条被改写、删除或重排都要能在断点处定位。
 */
export const fingerprintRequestMessages = (
  messages: readonly { role: string; content: unknown }[]
): RequestFingerprint => {
  let chain = hashPromptText('replica:request-prefix:v1')
  const messageChain: string[] = []
  const messageRoles: string[] = []
  for (const message of messages) {
    chain = hashPromptText(`${chain}\n${message.role}\n${JSON.stringify(message.content)}`)
    if (messageChain.length < MAX_CHAIN_MESSAGES) {
      messageChain.push(chain)
      messageRoles.push(message.role)
    }
  }
  return {
    messageChain,
    messageRoles,
    requestHash: chain,
    chainTruncated: messages.length > MAX_CHAIN_MESSAGES,
    messageCount: messages.length,
  }
}

/**
 * 直接对协议层最终请求对象建指纹。不同协议会删掉 latest_reminder、
 * 把内容块压成文本或把 system 搬到 instructions；只有看最终 wire 才能避免
 * 把“本地消息变了但实际请求没变”误报成前缀断点。
 */
export const fingerprintWireRequest = (body: unknown): RequestFingerprint | null => {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  try {
    const payload = body as Record<string, unknown>
    const wire: { role: string; content: unknown }[] = []
    if (typeof payload.instructions === 'string' && payload.instructions.trim()) {
      wire.push({ role: 'system', content: payload.instructions })
    }
    const list = Array.isArray(payload.messages)
      ? payload.messages
      : Array.isArray(payload.input)
        ? payload.input
        : []
    for (const item of list) {
      if (typeof item !== 'object' || item === null) {
        continue
      }
      wire.push({
        role: typeof item.role === 'string' ? item.role : String(item.type ?? 'unknown'),
        content: item,
      })
    }
    return fingerprintRequestMessages(wire)
  } catch {
    return null
  }
}

type PrefixDrift = {
  index: number
  role: string
  previousRole: string
  previousLength: number
  currentLength: number
  shortened: boolean
}

/* ---- 02 读取与解析（findPrefixDrift、auditSystemText、buildPromptConfigFingerprint…） ---- */
/** 同一会话、同一配置下，找当前请求与上一轮请求最早不一致的历史消息。 */
const findPrefixDrift = (
  previous: PromptCacheSample,
  current: PromptCacheSample
): PrefixDrift | null => {
  if (!previous.messageChain?.length || !current.messageChain?.length) {
    return null
  }
  const shared = Math.min(previous.messageChain.length, current.messageChain.length)
  for (let index = 0; index < shared; index += 1) {
    if (previous.messageChain[index] !== current.messageChain[index]) {
      return {
        index,
        role: current.messageRoles?.[index] ?? 'unknown',
        previousRole: previous.messageRoles?.[index] ?? 'unknown',
        previousLength: previous.messageChain.length,
        currentLength: current.messageChain.length,
        shortened: false,
      }
    }
  }
  if (current.messageChain.length < previous.messageChain.length) {
    return {
      index: current.messageChain.length,
      role: '窗口末尾',
      previousRole: previous.messageRoles?.[current.messageChain.length] ?? 'unknown',
      previousLength: previous.messageChain.length,
      currentLength: current.messageChain.length,
      shortened: true,
    }
  }
  return null
}

export type SystemAudit = {
  chars: number
  hash: string
  /** 本应只在尾部出现的动态段，若出现在 system 就说明静态前缀被污染 */
  dynamicMarkers: string[]
  unresolvedPlaceholders: string[]
}

const DYNAMIC_MARKERS: Array<{ label: string; test: (text: string) => boolean }> = [
  { label: '本轮背景资料', test: (text) => text.includes('这一轮附带的背景资料') },
  { label: '记忆块', test: (text) => /【(?:长期记忆|角色记忆|普通记忆|记忆片段)/.test(text) },
  { label: '场景块', test: (text) => text.includes('眼下是这样的') },
  { label: '世界书块', test: (text) => text.includes('这些背景你本来就知道') },
  {
    label: 'latest_reminder',
    // 默认提示词的功能说明也会提到 latest_reminder；只认块标记或字段行，避免正常文本误报
    test: (text) => /(?:^|\n)\s*(?:【latest_reminder】|\[latest_reminder\]|latest_reminder\s*[:：])/i.test(text),
  },
  { label: '上下文摘要', test: (text) => text.includes('较早的对话摘要（历史资料）') },
]

export const auditSystemText = (text: string): SystemAudit => {
  const dynamicMarkers = DYNAMIC_MARKERS.filter((item) => item.test(text)).map((item) => item.label)
  const unresolvedPlaceholders = Array.from(
    new Set(
      (text.match(/{{(?:user|char)}}|\${(?:user_name|char_name)}/g) ?? []).map((item) => item)
    )
  )
  return {
    chars: text.length,
    hash: hashPromptText(text),
    dynamicMarkers,
    unresolvedPlaceholders,
  }
}

/** 只放不会随轮次变化、但会影响缓存 namespace 的配置；不记录 API Key 和完整地址 */
export const buildPromptConfigFingerprint = (value: Record<string, unknown>): string =>
  hashPromptText(JSON.stringify(value))

export type PromptCacheSample = {
  at: number
  sessionId: string
  model: string
  format: string
  custom: boolean
  endpointHash: string
  /** 同一模型、协议和地址才允许比较命中率 */
  scope: string
  /** system 与请求形态的配置指纹；相同配置下 system hash 变化才是异常 */
  configHash: string
  systemHash: string
  systemChars: number
  systemDynamicMarkers: string[]
  unresolvedPlaceholders: string[]
  turnContextHash: string
  turnContextChars: number
  latestReminderHash: string
  latestReminderChars: number
  messageCount: number
  historyTurns: number
  /** 逐条消息的累计前缀指纹；用于确认历史段是否被改写，不记录正文。旧样本可缺省 */
  messageChain?: string[]
  /** 与 messageChain 对齐的角色名，只用于定位断点 */
  messageRoles?: string[]
  /** 整轮请求的最终指纹；只比对，不落正文 */
  requestHash?: string
  /** 消息数超过逐条比对上限；前 MAX_CHAIN_MESSAGES 条仍可比较 */
  chainTruncated?: boolean
  compacted: boolean
  /** 本轮插进首条 user 的摘要指纹；连续压缩时用它判断摘要是否又改写 */
  contextSummaryHash: string
  contextSummaryChars: number
  thinking: boolean
  search: boolean
  usage: Pick<
    MessageUsage,
    | 'input_tokens'
    | 'cache_creation_input_tokens'
    | 'cache_read_input_tokens'
    | 'output_tokens'
    | 'cache_fields_present'
  >
  cacheRate: number
}

/* ---- 03 读取与解析（readAll、isSample、recordPromptCacheSample…） ---- */
export type PromptCacheSampleInput = Omit<
  PromptCacheSample,
  'at' | 'systemHash' | 'systemChars' | 'systemDynamicMarkers' | 'unresolvedPlaceholders' | 'cacheRate'
> & {
  systemAudit: SystemAudit
}

const readAll = (): PromptCacheSample[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROMPT_CACHE_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as PromptCacheSample[]).filter(isSample) : []
  } catch {
    return []
  }
}

const isSample = (value: unknown): value is PromptCacheSample => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const item = value as Partial<PromptCacheSample>
  return (
    typeof item.at === 'number' &&
    typeof item.sessionId === 'string' &&
    typeof item.systemHash === 'string' &&
    typeof item.configHash === 'string' &&
    typeof item.cacheRate === 'number' &&
    typeof item.usage === 'object' &&
    item.usage !== null
  )
}

export const recordPromptCacheSample = (input: PromptCacheSampleInput): void => {
  const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens } = input.usage
  const total = Math.max(0, input_tokens) + Math.max(0, cache_creation_input_tokens) + Math.max(0, cache_read_input_tokens)
  const sample: PromptCacheSample = {
    ...input,
    at: Date.now(),
    systemHash: input.systemAudit.hash,
    systemChars: input.systemAudit.chars,
    systemDynamicMarkers: input.systemAudit.dynamicMarkers,
    unresolvedPlaceholders: input.systemAudit.unresolvedPlaceholders,
    cacheRate: total > 0 ? Math.max(0, cache_read_input_tokens) / total : 0,
  }
  try {
    const samples = [...readAll(), sample].slice(-MAX_SAMPLES)
    const cutoff = samples.length - KEEP_CHAIN_SAMPLES
    // 旧样本去掉大数组后再写回，避免每次回复都把几十条完整链重复序列化。
    const stored = samples.map((item, index) =>
      index < cutoff ? { ...item, messageChain: [], messageRoles: [] } : item
    )
    localStorage.setItem(PROMPT_CACHE_STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // 存储已满或隐私模式不可写时放弃记录，不影响请求
  }
}

export const readPromptCacheSamples = (): PromptCacheSample[] => readAll()

export const clearPromptCacheSamples = (): void => {
  try {
    localStorage.removeItem(PROMPT_CACHE_STORAGE_KEY)
  } catch {
    // 存储不可写时不更新时间戳，诊断数据本身仍保留在内存中。
  }
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`

const sampleLabel = (sample: PromptCacheSample, index: number) =>
  `#${index + 1} ${new Date(sample.at).toLocaleTimeString()} · ${sample.messageCount} 条消息 · ${percent(
    sample.cacheRate
  )}`

/* ---- 04 类型与契约（CacheDiagnosis） ---- */
export type CacheDiagnosis = {
  level: 'warning' | 'problem'
  area: string
  detail: string
  causes: string[]
  evidence: string[]
  rate: number | null
  samples: number
}

/**
 * 只对同一会话、同一模型/协议/地址的连续请求做判断：
 * - 配置刚变化、首轮、刚压缩：视为预期重建，不报警；
 * - 相同配置下 system hash 变了：静态前缀被污染，直接报问题；
 * - 相同配置连续三轮低命中，或从健康值骤降到 0：报问题并列出可能原因；
 * - 自定义网关完全没有缓存字段：报“无法判断/可能不支持”，不冒充系统提示词丢失。
 */
export const diagnosePromptCache = (
  samples: PromptCacheSample[],
  sessionId?: string,
  scope?: string
): CacheDiagnosis | null => {
  const usable = samples
    .filter((item) => item.usage && item.usage.input_tokens >= 0)
    .filter((item) => (!sessionId || item.sessionId === sessionId) && (!scope || item.scope === scope))
    .sort((a, b) => a.at - b.at)
  if (usable.length < 2) {
    return null
  }
  const last = usable[usable.length - 1]
  const previous = usable[usable.length - 2]
  const lastTotal =
    Math.max(0, last.usage.input_tokens) +
    Math.max(0, last.usage.cache_creation_input_tokens) +
    Math.max(0, last.usage.cache_read_input_tokens)
  if (lastTotal <= 0) {
    return null
  }
  const expectedReasons: string[] = []
  if (last.configHash !== previous.configHash) {
    expectedReasons.push('切换模型、协议、提示词、角色卡或请求开关后，本轮属于预期重建')
  }
  const continuousCompaction =
    last.compacted &&
    previous.compacted &&
    last.contextSummaryHash !== previous.contextSummaryHash
  if (last.compacted && !previous.compacted) {
    expectedReasons.push('本轮首次插入上下文摘要；摘要位于首条 user 消息，会把整段历史前缀改写，首次压缩后低命中属于预期')
  }
  if (last.historyTurns === 0) {
    expectedReasons.push('这是会话首轮，没有可复用的历史前缀')
  }
  const low = last.cacheRate < LOW_RATE
  const cacheRead = Math.max(0, last.usage.cache_read_input_tokens)
  const cacheWrite = Math.max(0, last.usage.cache_creation_input_tokens)
  const hasCacheSignal = cacheRead > 0 || cacheWrite > 0
  // 旧样本没有该标记：有命中就视为已知，避免升级后把历史样本全当成未知。
  const cacheFieldsPresent = last.usage.cache_fields_present ?? hasCacheSignal
  if (!cacheFieldsPresent && low) {
    return {
      level: 'warning',
      area: '缓存命中',
      detail: '上游没有返回缓存命中字段，无法判断是前缀失效还是接口不支持。',
      causes: [
        '接口可能只返回 prompt_tokens，没有 prompt_tokens_details.cached_tokens 或 prompt_cache_hit_tokens',
        '部分网关会吞掉或改名缓存字段，需在网关日志确认 usage',
      ],
      evidence: [`最近请求输入 ${lastTotal} tokens，命中字段缺失`, sampleLabel(last, usable.length - 1)],
      rate: 0,
      samples: usable.length,
    }
  }

  const systemChangedSameConfig =
    last.systemHash !== previous.systemHash && last.configHash === previous.configHash
  const activeMarkers = [...last.systemDynamicMarkers, ...last.unresolvedPlaceholders]
  if (systemChangedSameConfig || activeMarkers.length > 0) {
    return {
      level: 'problem',
      area: '提示词前缀',
      detail: systemChangedSameConfig
        ? '同一套提示词、角色卡和开关下，system 指纹发生了变化；静态前缀被逐轮内容污染，后续历史会从该段开始全部未命中。'
        : `system 静态前缀中出现了动态段或未替换占位符：${activeMarkers.join('、')}。`,
      causes: [
        '检查日期、星期、位置、记忆、场景、世界书、上下文摘要或随机文本是否被拼进 system',
        '检查角色卡、基础档案或自定义提示词是否被热更新写入',
        '检查占位符替换是否在拼装前完成',
      ],
      evidence: [
        `system ${last.systemChars} 字，${last.systemHash}`,
        systemChangedSameConfig ? `上一条 system ${previous.systemHash}` : `标记：${activeMarkers.join('、')}`,
      ],
      rate: last.cacheRate,
      samples: usable.length,
    }
  }

  const recent = usable.slice(-4)
  const lowStreak = recent.filter((item) => item.cacheRate < LOW_RATE && item.configHash === last.configHash)
  const previousHealthy = usable
    .slice(-5, -1)
    .some((item) => item.cacheRate >= HEALTHY_RATE && item.configHash === last.configHash && !item.compacted)
  const lowHistory = recent.filter(
    (item) => item.cacheRate < LOW_RATE && item.historyTurns >= 1 && item.configHash === last.configHash
  )
  const previousSample = usable[usable.length - 2]
  const sameConfig = previousSample?.configHash === last.configHash
  const prefixDrift = sameConfig ? findPrefixDrift(previousSample, last) : null
  const shouldReport =
    low &&
    last.historyTurns >= 1 &&
    (lowStreak.length >= 2 ||
      (previousHealthy && lowHistory.length >= 1) ||
      Boolean(prefixDrift) ||
      continuousCompaction)

  if (!shouldReport) {
    return null
  }
  const causes = [
    '检查历史消息是否被编辑、删除或重排；任何早于当前提问的改动都会改变缓存起点',
    '检查是否刚切换深度思考、智能搜索或模型；这些会改变请求形态，需要重新建缓存',
    '检查 latest_reminder 是否在本轮被插入到历史开头；它应只出现在当前提问附近',
    '检查上游网关是否支持前缀缓存；部分网关命中率恒为 0，不代表系统提示词丢失',
    '如果只有首条回复低、后续恢复，通常是网关冷启动或缓存写入延迟，不必改提示词',
  ]
  if (prefixDrift) {
    const position = `第 ${prefixDrift.index + 1} 条（${prefixDrift.role}）`
    causes.unshift(
      prefixDrift.shortened
        ? `历史窗口从${position}处缩短，上一轮之后的消息被删除或窗口起点前移，缓存只能命中缩短后的旧前缀`
        : `历史前缀从${position}开始与上一轮不同，缓存从该位置之后全部失效`
    )
    if (prefixDrift.index <= 1) {
      causes.unshift(
        '断点在开头：历史窗口起点前移、首条 user 被摘要改写或分支切换都会让缓存从第 0 个 token 后失效'
      )
    } else if (prefixDrift.role === 'user' && last.compacted) {
      causes.unshift(
        '断点在 user：上下文摘要可能被写入首条 user；摘要变化会连带改写后续全部历史'
      )
    } else if (prefixDrift.role === 'assistant') {
      causes.unshift(
        '断点在 assistant：历史回复回放时被规范化、截断或重新生成，与上一轮实际发送的内容不一致'
      )
    }
  }
  if (continuousCompaction) {
    causes.unshift(
      '连续两轮都在改写上下文摘要，摘要位于首条 user 消息，历史前缀每轮都从该段重建；需降低自动压缩频率或增大上下文预算'
    )
  }
  // 只有“已经解释得通的重建”（首次压缩、配置刚切换）降为提醒；
  // 连续压缩、出现前缀断点或从健康值骤降仍然按问题报。
  const expectedOnly =
    !prefixDrift && !continuousCompaction && expectedReasons.length > 0 && !previousHealthy
  return {
    level: expectedOnly ? 'warning' : 'problem',
    area: '缓存命中',
    detail:
      previousHealthy
        ? `缓存命中率从健康值骤降到 ${percent(last.cacheRate)}，最近 ${lowHistory.length} 轮持续偏低。`
        : `最近 ${lowStreak.length} 轮连续低命中，最新仅 ${percent(last.cacheRate)}。`,
    causes,
    evidence: [
      sampleLabel(last, usable.length - 1),
      `最近 ${recent.length} 轮命中率：${recent.map((item) => percent(item.cacheRate)).join(' / ')}`,
      `system ${last.systemChars} 字，turnContext ${last.turnContextChars} 字，历史 ${last.historyTurns} 轮`,
      prefixDrift
        ? `前缀断点：第 ${prefixDrift.index + 1} 条 ${prefixDrift.previousRole}→${prefixDrift.role}，上一轮 ${prefixDrift.previousLength} 条，本轮 ${prefixDrift.currentLength} 条`
        : last.chainTruncated || previousSample?.chainTruncated
          ? `前缀连续性：前 ${MAX_CHAIN_MESSAGES} 条与上一轮一致（超出上限未逐条比对）`
          : '前缀连续性：与上一轮一致',
      `上下文摘要 ${last.contextSummaryChars} 字，摘要指纹 ${last.contextSummaryHash || '无'}`,
      `输入 ${lastTotal} tokens，命中 ${cacheRead}，写入 ${cacheWrite}`,
      ...expectedReasons,
    ],
    rate: last.cacheRate,
    samples: usable.length,
  }
}

/* ---- 05 类型与契约（PromptCacheStatus） ---- */
export type PromptCacheStatus = {
  samples: number
  latest: PromptCacheSample | null
  latestRate: number | null
  averageRate: number | null
}

export const readPromptCacheStatus = (sessionId?: string): PromptCacheStatus => {
  const samples = readPromptCacheSamples()
    .filter((item) => !sessionId || item.sessionId === sessionId)
    .sort((a, b) => a.at - b.at)
  if (samples.length === 0) {
    return { samples: 0, latest: null, latestRate: null, averageRate: null }
  }
  const latest = samples[samples.length - 1]
  const averageRate = samples.reduce((sum, item) => sum + item.cacheRate, 0) / samples.length
  return {
    samples: samples.length,
    latest,
    latestRate: latest.cacheRate,
    averageRate,
  }
}

/* ============================================================================
 * 功能区：会话与角色核心 / cacheDiagnostics 结束
 * ========================================================================== */
