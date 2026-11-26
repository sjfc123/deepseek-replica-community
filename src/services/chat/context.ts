/* ============================================================================
 * 功能区：会话与角色核心 / context · 上下文预算与历史窗口
 * 职责：上下文预算与历史窗口：Token 预算、输出上限、问题估算、前缀截断、检查点与分支缩放；不拼接 system。
 * 分区：01 类型、常量与模块依赖；02 读取与解析（estimateBranchScale、roundText、fitRecent…）；
 *    03 写入与状态变更（saveContextCheckpoint、prepareHistoryContext、summaryTokens）；
 *    04 功能实现（summaryTokens）
 * 关联：依赖 services/api/errors、services/chat/reply、services/chat/tokenEstimator、services/chat/types；
 *    被 scripts/test-context-compaction、services/chat/contextSummary、services/chat/store 引用。
 * 导出：WINDOW_TOKENS、SUMMARY_OUTPUT_TOKENS、contextBudget、resolveMaxOutputTokens、estimateQuestionTokens、textPrefixLength、HistoryContext、estimateBranchScale、saveContextCheckpoint、prepareHistoryContext、estimateTextTokens
 * 边界：只处理聊天领域的数据、状态转换与提示词装配；不直接渲染视图，不发起职责外的网络请求。
 * ========================================================================== */

import { isContextOverflow } from '../api/errors.js'
import { getContextRounds, getReplyText } from './reply.js'
import { estimateTextTokens } from './tokenEstimator.js'
import type {
  AssistantMessage,
  ContextCheckpoint,
  FileAttachment,
  Message,
  UserMessage,
} from './types.js'

export { estimateTextTokens }

/* ---- 01 类型、常量与模块依赖 ---- */
export const WINDOW_TOKENS = 1_048_576
/** 参考 Codex CLI：有效窗口留 5% 缓冲，自动压缩在 90% 触发。 */
const EFFECTIVE_WINDOW_RATIO = 0.95
const AUTO_COMPACT_RATIO = 0.9
const RECENT_RETENTION_RATIO = 0.16
const FIXED_PROMPT_OVERHEAD = 256
const MIN_CALIBRATION_TOKENS = 2_000
const MIN_CALIBRATION_SCALE = 0.5
const MAX_CALIBRATION_SCALE = 2
export const SUMMARY_OUTPUT_TOKENS = 4_096
const SUMMARY_BATCH_TOKENS = 96 * 1024
const CHECKPOINT_LIMIT = 16

export const contextBudget = (outputReserve: number, window = WINDOW_TOKENS) => {
  const effectiveWindow = Math.floor(window * EFFECTIVE_WINDOW_RATIO)
  const reserve = Math.min(Math.max(0, outputReserve), Math.floor(effectiveWindow / 2))
  const input = Math.max(
    0,
    Math.min(Math.floor(window * AUTO_COMPACT_RATIO), effectiveWindow - reserve)
  )
  return {
    input,
    recent: Math.floor(input * RECENT_RETENTION_RATIO),
  }
}

/** 按当前估算输入与 5% 安全缓冲动态收敛本轮 max_tokens，避免触发 input + max_tokens > window。 */
export const resolveMaxOutputTokens = (
  requestedMaxOutput: number,
  estimatedInput: number,
  minOutputReserve: number,
  window = WINDOW_TOKENS
) => {
  const effectiveWindow = Math.floor(window * EFFECTIVE_WINDOW_RATIO)
  const available = Math.max(minOutputReserve, effectiveWindow - Math.max(0, estimatedInput))
  return Math.min(requestedMaxOutput, available)
}

const estimateFileTokens = (file: FileAttachment) => {
  // 导入后只有文件名和大小的占位附件不会进入请求。
  if (!file.serverId && !file.mimeType) {
    return 0
  }
  return file.isImage ? 4_096 : Math.min(131_072, Math.max(512, Math.ceil(file.size / 2)))
}

export const estimateQuestionTokens = ({ content, files }: UserMessage) =>
  16 +
  estimateTextTokens(content) +
  files.reduce((total, file) => total + estimateFileTokens(file), 0)

/** 返回可放入预算的前缀长度，优先在换行处结束，避免截断 Unicode 字符。 */
export const textPrefixLength = (text: string, budget: number): number => {
  if (budget <= 0) {
    return 0
  }
  let length = Math.min(text.length, budget * 6)
  for (;;) {
    const next = text.charCodeAt(length)
    if (length > 0 && next >= 0xdc00 && next <= 0xdfff) {
      length--
    }
    const cost = estimateTextTokens(text, length)
    if (cost <= budget || length === 0) {
      break
    }
    length = Math.min(length - 1, Math.floor((length * budget) / cost))
  }
  if (length > 0 && length < text.length) {
    const newline = text.lastIndexOf('\n', length - 1) + 1
    if (newline > length / 2) {
      return newline
    }
  }
  return length
}

type Round = [UserMessage, AssistantMessage]
type Cursor = { index: number; offset: number }
type SummaryRequest = { previous?: string; excerpts: string[] }
export type HistoryContext = { history: Message[]; summary?: string; tokens: number }

const roundTokens = ([user, reply]: Round) => {
  const links = reply.blocks.filter((block) => block.type === 'web_fetch_tool_result').length
  return estimateQuestionTokens(user) + estimateTextTokens(getReplyText(reply)) + links * 8_192 + 32
}

const scaleTokens = (tokens: number, scale: number) =>
  scale === 1 ? tokens : Math.ceil(tokens * scale)

/* ---- 02 读取与解析（estimateBranchScale、roundText、fitRecent…） ---- */
/**
 * 以当前分支最近一条无工具、无附件、未截断的同模型回复 usage 校准本地估算倍率。
 * 可吸收文本估算的残余误差，并自适应第三方模型的不同分词器。
 */
export const estimateBranchScale = (
  history: Message[],
  model: string,
  checkpoints?: ContextCheckpoint[]
): number => {
  const rounds = getContextRounds(history)
  if (!rounds.length) {
    return 1
  }
  if (checkpoints?.length) {
    const byReply = new Set(checkpoints.map(({ replyId }) => replyId))
    if (rounds.some(([, reply]) => byReply.has(reply.id))) {
      return 1
    }
  }
  let historyEstimate = 0
  let calibrated = 1
  for (const round of rounds) {
    const [user, reply] = round
    if (user.files.some((file) => Boolean(file.serverId || file.mimeType))) {
      return calibrated
    }
    const hasTools = reply.blocks.some(
      (block) =>
        block.type === 'server_tool_use' ||
        block.type === 'web_search_tool_result' ||
        block.type === 'web_fetch_tool_result'
    )
    if (hasTools) {
      return calibrated
    }
    const promptEstimate = historyEstimate + estimateQuestionTokens(user)
    const textBlocks = reply.blocks.filter((block) => block.type === 'text' && !block.isTemplate)
    if (
      reply.status === 'done' &&
      reply.usage &&
      reply.model === model &&
      textBlocks.length <= 1 &&
      promptEstimate >= MIN_CALIBRATION_TOKENS
    ) {
      const actualPrompt =
        reply.usage.input_tokens +
        reply.usage.cache_creation_input_tokens +
        reply.usage.cache_read_input_tokens
      if (
        Number.isFinite(actualPrompt) &&
        actualPrompt >= MIN_CALIBRATION_TOKENS &&
        actualPrompt > FIXED_PROMPT_OVERHEAD
      ) {
        const ratio = (actualPrompt - FIXED_PROMPT_OVERHEAD) / promptEstimate
        calibrated = Math.min(MAX_CALIBRATION_SCALE, Math.max(MIN_CALIBRATION_SCALE, ratio))
      }
    }
    historyEstimate += roundTokens(round)
  }
  return calibrated
}

const roundText = ([user, reply]: Round) => {
  const files = user.files.map(({ name }) => name)
  const links = reply.blocks.flatMap((block) =>
    block.type === 'server_tool_use' && 'url' in block.input && block.input.url
      ? [block.input.url]
      : []
  )
  return [
    '用户',
    user.content,
    ...(files.length ? ['附件', JSON.stringify(files)] : []),
    '助手',
    getReplyText(reply),
    ...(links.length ? ['参考链接', JSON.stringify(links)] : []),
  ].join('\n')
}

const fitRecent = (costs: number[], after: number, budget: number) => {
  let index = costs.length
  let tokens = 0
  while (index > after && tokens + costs[index - 1] <= budget) {
    tokens += costs[--index]
  }
  return { index, tokens }
}

const readBatch = (rounds: Round[], cursor: Cursor, end: number, budget: number, scale: number) => {
  const excerpts: string[] = []
  let { index, offset } = cursor
  while (index < end && budget >= 128) {
    const content = roundText(rounds[index]).slice(offset)
    const rawBudget = Math.floor((budget - 64) / scale)
    const length = textPrefixLength(content, rawBudget)
    if (length < content.length && excerpts.length) {
      break
    }
    const excerpt = content.slice(0, length)
    excerpts.push(excerpt)
    budget -= scaleTokens(estimateTextTokens(excerpt), scale) + 64
    if (length < content.length) {
      offset += length
      break
    }
    index++
    offset = 0
  }
  return { excerpts, next: { index, offset } }
}

/* ---- 03 写入与状态变更（saveContextCheckpoint、prepareHistoryContext、summaryTokens） ---- */
export const saveContextCheckpoint = (
  checkpoints: ContextCheckpoint[] | undefined,
  checkpoint: ContextCheckpoint
) =>
  [
    ...(checkpoints ?? []).filter(({ replyId }) => replyId !== checkpoint.replyId),
    checkpoint,
  ].slice(-CHECKPOINT_LIMIT)

export const prepareHistoryContext = async ({
  history,
  checkpoints,
  budget,
  recentBudget,
  summarize,
  save,
  signal,
  batchBudget = SUMMARY_BATCH_TOKENS,
  scale = 1,
}: {
  history: Message[]
  checkpoints?: ContextCheckpoint[]
  budget: number
  recentBudget: number
  summarize: (request: SummaryRequest) => Promise<string | null>
  save: (checkpoint: ContextCheckpoint) => void
  signal: AbortSignal
  batchBudget?: number
  scale?: number
}): Promise<HistoryContext> => {
  signal.throwIfAborted()
  if (budget < 64) {
    return { history: [], tokens: 0 }
  }
  const rounds = getContextRounds(history)
  const costs = rounds.map((round) => scaleTokens(roundTokens(round), scale))
  const byReply = new Map(checkpoints?.map((checkpoint) => [checkpoint.replyId, checkpoint]))
  let index = rounds.findLastIndex(([, reply]) => byReply.has(reply.id))
  let checkpoint = index >= 0 ? byReply.get(rounds[index][1].id) : undefined
  if (!checkpoint?.offset) {
    index++
  }
  let cursor = { index, offset: checkpoint?.offset ?? 0 }
  const remaining = fitRecent(
    costs,
    cursor.index,
    budget - summaryTokens(checkpoint?.summary, scale)
  )
  if (remaining.index > cursor.index || cursor.offset) {
    const summaryReserve = Math.max(
      Math.min(SUMMARY_OUTPUT_TOKENS, Math.floor(budget / 4)),
      summaryTokens(checkpoint?.summary, scale)
    )
    const recentTarget = Math.max(recentBudget, costs.at(-1) ?? 0)
    const end = Math.max(
      cursor.index + Number(cursor.offset > 0),
      fitRecent(costs, cursor.index, Math.min(budget - summaryReserve, recentTarget)).index
    )
    const firstBatchBudget = batchBudget
    while (cursor.index < end && batchBudget >= 128) {
      signal.throwIfAborted()
      const { excerpts, next } = readBatch(rounds, cursor, end, batchBudget, scale)
      try {
        const summary = await summarize({ previous: checkpoint?.summary, excerpts })
        signal.throwIfAborted()
        if (!summary) {
          break
        }
        cursor = next
        checkpoint = {
          replyId: rounds[cursor.offset ? cursor.index : cursor.index - 1][1].id,
          summary,
          offset: cursor.offset || undefined,
        }
        save(checkpoint)
        batchBudget = firstBatchBudget
      } catch (error) {
        signal.throwIfAborted()
        if (!isContextOverflow(error)) {
          break
        }
        batchBudget = Math.floor(batchBudget / 2)
      }
    }
  }
  const after = cursor.index + Number(cursor.offset > 0)
  const latest = after < costs.length ? (costs.at(-1) ?? 0) : 0
  const summaryBudget = latest <= budget ? budget - latest : budget
  const summary =
    checkpoint && summaryTokens(checkpoint.summary, scale) <= summaryBudget
      ? checkpoint.summary
      : undefined
  const retained = fitRecent(costs, after, budget - summaryTokens(summary, scale))
  return {
    history: rounds.slice(retained.index).flat(),
    summary,
    tokens: retained.tokens + summaryTokens(summary, scale),
  }
}

/* ---- 04 功能实现（summaryTokens） ---- */
const summaryTokens = (summary: string | undefined, scale = 1) =>
  summary ? scaleTokens(estimateTextTokens(summary), scale) + 64 : 0

/* ============================================================================
 * 功能区：会话与角色核心 / context 结束
 * ========================================================================== */
