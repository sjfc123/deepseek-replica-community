/* ============================================================================
 * 功能区：会话与角色核心 / suggestions 开始
 * 职责：按当前场景、在场人物、玩家站位与最近对话生成三条回复建议，只读会话，不写入消息。
 * 导出：generateReplySuggestions、parseReplySuggestions、ReplySuggestion。
 * ========================================================================== */

import { DEFAULT_CHAT_MODEL } from '../api/chatConfig.js'
import { streamChatMessage } from '../api/client.js'
import type { CreateMessageRequest } from '../api/types.js'
import { useSettings } from '../settings.js'
import { useChatStore } from './store.js'
import { getVisibleMessages } from './branches.js'
import { findSessionCharacterCard } from './roleplay.js'
import {
  formatStoryClock,
  formatStorySuggestionContext,
  futureStoryClueTerms,
} from './story.js'
import {
  SUGGESTION_SYSTEM,
  buildSuggestionAsk,
  buildSuggestionCastContext,
  buildSuggestionSceneContext,
  buildSuggestionTranscript,
  detectSuggestionPresence,
  filterPrematureSuggestions,
  parseReplySuggestions,
  pickFreshReplySuggestions,
  resolvePresentCast,
  type ReplySuggestion,
} from './suggestionsContext.js'

export { parseReplySuggestions } from './suggestionsContext.js'
export type { ReplySuggestion, ReplySuggestionMode } from './suggestionsContext.js'

const messageText = (message: ReturnType<typeof getVisibleMessages>[number]) => {
  if (message.role === 'user') {
    return message.content
  }
  return message.blocks
    .filter(
      (block): block is { type: 'text'; text: string; isTemplate?: boolean } =>
        block.type === 'text'
    )
    .filter((block) => !block.isTemplate)
    .map((block) => block.text)
    .join('')
}

/** 同一会话最近一次成功生成的建议；只在内存里保留，用于下一轮/换一批去重。 */
const recentSuggestions = new Map<string, ReplySuggestion[]>()

const requestSuggestionText = async ({
  body,
  settings,
  signal,
}: {
  body: CreateMessageRequest
  settings: ReturnType<typeof useSettings.getState>
  signal?: AbortSignal
}) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  if (signal) {
    if (signal.aborted) {
      controller.abort()
    } else {
      signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }
  let text = ''
  try {
    for await (const event of streamChatMessage(
      settings.chatConfig,
      settings.apiKey ?? '',
      body,
      controller.signal
    )) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
      }
    }
  } finally {
    clearTimeout(timeout)
  }
  return text
}

/** 对象版线索词过滤：保留 mode/target，只替换候选文本。 */
const filterPrematureReplySuggestions = (
  candidates: ReplySuggestion[],
  blockedTerms: string[]
): ReplySuggestion[] => {
  const allowed = new Set(filterPrematureSuggestions(candidates.map((item) => item.text), blockedTerms))
  return candidates.filter((item) => allowed.has(item.text))
}

export const generateReplySuggestions = async ({
  sessionId,
  draft = '',
  signal,
}: {
  sessionId: string
  draft?: string
  signal?: AbortSignal
}): Promise<ReplySuggestion[]> => {
  const session = useChatStore.getState().sessionCache[sessionId]
  if (!session) {
    throw new Error('会话尚未加载')
  }
  const settings = useSettings.getState()
  const card = findSessionCharacterCard(settings.characterCards, session)
  if (!card) {
    throw new Error('当前会话没有角色卡')
  }
  // 实际对话只看最近两轮，避免旧轮次把建议拉回已经过去的情节。
  const visible = getVisibleMessages(session)
  const transcriptMessages = visible
    .map((message) => ({ role: message.role, content: messageText(message).trim() }))
    .filter((message): message is { role: 'user' | 'assistant'; content: string } =>
      Boolean(message.content)
    )
    .slice(-4)
  const transcript = buildSuggestionTranscript(card.name, transcriptMessages)
  const lastCharacterLine =
    [...transcriptMessages].reverse().find((message) => message.role === 'assistant')?.content ??
    ''
  const lastPlayerLine =
    [...transcriptMessages].reverse().find((message) => message.role === 'user')?.content ?? ''
  const cast = resolvePresentCast(card.name, session.scene?.participants)
  const { presence, reason } = detectSuggestionPresence({
    lastCharacterLine,
    lastPlayerLine,
    castCount: cast.length,
  })
  const clockText =
    card.story && session.storyClockMinute !== undefined
      ? `${formatStoryClock(session.storyClockMinute)}（${session.scene?.time ? `场景记录 ${session.scene.time}` : '剧情时间'}）`
      : session.scene?.time
  const sceneText = buildSuggestionSceneContext({
    scene: session.scene,
    clockText,
    cast,
    presence,
    presenceReason: reason,
    lastCharacterLine,
  })
  const castText = buildSuggestionCastContext(cast, settings.characterCards, card.name)
  const previous = recentSuggestions.get(sessionId) ?? []
  const previousText = previous.map((item) => item.text)
  // 尚未到点的线索词做硬过滤，防止建议提前说出旧疤、暗号、储物间等后续内容。
  const blockedTerms = futureStoryClueTerms(card.story, session)
  const ask = buildSuggestionAsk({
    card,
    stageText: formatStorySuggestionContext(card.story, session),
    sceneText,
    castText,
    presence,
    draft,
    transcript,
    previous: previousText,
  })
  const makeBody = (temperature: number): CreateMessageRequest => ({
    model: settings.chatConfig.model || DEFAULT_CHAT_MODEL,
    max_tokens: 700,
    system: SUGGESTION_SYSTEM,
    messages: [{ role: 'user', content: ask }],
    thinking: { type: 'disabled' },
    temperature,
  })
  const first = filterPrematureReplySuggestions(
    parseReplySuggestions(
      await requestSuggestionText({ body: makeBody(0.72), settings, signal }),
      cast,
      card.name
    ),
    blockedTerms
  )
  let picked = pickFreshReplySuggestions(first, previousText)
  const asideGap =
    presence === 'leaving' && picked.filter((item) => item.mode === 'aside').length < 2
  if (picked.length < 3 || asideGap) {
    // 数量不足、或在离开场景里旁白不够时重试一次，明确要求换开头、换方向、换说话对象，并补齐旁白。
    const retryText = filterPrematureReplySuggestions(
      parseReplySuggestions(
        await requestSuggestionText({
          body: {
            ...makeBody(0.9),
            messages: [
              {
                role: 'user',
                content: `${ask}\n\n上一批结果${asideGap ? '缺少玩家侧旁白' : '重复或方向过于接近'}。请完全换三个切入点，不要复现上一批句式和开头；多角色场景要换一个说话对象。${asideGap ? '当前玩家正在离开，至少两条必须以“（”开头写玩家自己的动作或内心。' : ''}`,
              },
            ],
          },
          settings,
          signal,
        }),
        cast,
        card.name
      ),
      blockedTerms
    )
    const merged = [...picked, ...retryText]
    // 离开场景优先保留旁白，否则重试新增的两条旁白会在去重排序里被前三条对白挤掉。
    picked = pickFreshReplySuggestions(
      presence === 'leaving'
        ? [
            ...merged.filter((item) => item.mode === 'aside'),
            ...merged.filter((item) => item.mode !== 'aside'),
          ]
        : merged,
      previousText
    )
  }
  if (picked.length < 3) {
    throw new Error('回复建议数量不足')
  }
  const list = picked.slice(0, 3)
  recentSuggestions.set(sessionId, list)
  return list
}

/* ============================================================================
 * 功能区：会话与角色核心 / suggestions 结束
 * ========================================================================== */
