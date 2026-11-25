/* ============================================================================
 * 功能区：会话与角色核心 / suggestions 开始
 * 职责：按当前轮次、剧情阶段与最近对话生成三条玩家回复建议，只读会话，不写入消息。
 * 导出：generateReplySuggestions、parseReplySuggestions。
 * ========================================================================== */

import { DEFAULT_CHAT_MODEL } from '../api/chatConfig.js'
import { streamChatMessage } from '../api/client.js'
import type { CreateMessageRequest } from '../api/types.js'
import { useSettings } from '../settings.js'
import { useChatStore } from './store.js'
import { getVisibleMessages } from './branches.js'
import { findSessionCharacterCard } from './roleplay.js'
import { formatStorySuggestionContext, futureStoryClueTerms } from './story.js'
import {
  SUGGESTION_SYSTEM,
  buildSuggestionAsk,
  buildSuggestionTranscript,
  filterPrematureSuggestions,
  pickFreshSuggestions,
} from './suggestionsContext.js'

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

/** 从模型输出里取三条建议；允许 JSON 代码块与编号列表两种格式。 */
export const parseReplySuggestions = (raw: string): string[] => {
  const cleaned = raw
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1))
      if (Array.isArray(parsed)) {
        const list = parsed
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean)
          .map((item) => item.slice(0, 120))
        if (list.length >= 3) {
          return [...new Set(list)].slice(0, 4)
        }
      }
    } catch {
      // JSON 不完整时继续按行解析
    }
  }
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.、)])\s*/, '').trim())
    .map((line) => line.replace(/^["“]|["”]$/g, '').trim())
    .filter((line) => {
      if (!line) {
        return false
      }
      const wrappers = new Set(['[', ']', '{', '}'])
      return ![...line].every((char) => wrappers.has(char))
    })
  return [...new Set(lines)].slice(0, 3)
}

/** 同一会话最近一次成功生成的建议；只在内存里保留，用于下一轮/换一批去重。 */
const recentSuggestions = new Map<string, string[]>()

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

export const generateReplySuggestions = async ({
  sessionId,
  draft = '',
  signal,
}: {
  sessionId: string
  draft?: string
  signal?: AbortSignal
}): Promise<string[]> => {
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
  const transcriptMessages = getVisibleMessages(session)
    .map((message) => ({ role: message.role, content: messageText(message).trim() }))
    .filter((message): message is { role: 'user' | 'assistant'; content: string } =>
      Boolean(message.content)
    )
    .slice(-4)
  const previous = recentSuggestions.get(sessionId) ?? []
  // 尚未到点的线索词做硬过滤，防止建议提前说出旧疤、暗号、储物间等后续内容。
  const blockedTerms = futureStoryClueTerms(card.story, session)
  const ask = buildSuggestionAsk({
    card,
    stageText: formatStorySuggestionContext(card.story, session),
    draft,
    transcript: buildSuggestionTranscript(card.name, transcriptMessages),
    previous,
  })
  const makeBody = (temperature: number): CreateMessageRequest => ({
    model: settings.chatConfig.model || DEFAULT_CHAT_MODEL,
    max_tokens: 500,
    system: SUGGESTION_SYSTEM,
    messages: [{ role: 'user', content: ask }],
    thinking: { type: 'disabled' },
    temperature,
  })
  const first = filterPrematureSuggestions(
    parseReplySuggestions(await requestSuggestionText({ body: makeBody(0.72), settings, signal })),
    blockedTerms
  )
  let picked = pickFreshSuggestions(first, previous)
  if (picked.length < 3) {
    // 只在本批与上一批或彼此太像时重试一次，并明确要求换开头与方向。
    const retryText = filterPrematureSuggestions(
      parseReplySuggestions(
        await requestSuggestionText({
          body: {
            ...makeBody(0.9),
            messages: [
              {
                role: 'user',
                content: `${ask}\n\n上一批结果重复或方向过于接近。请完全换三个切入点，不要复现上一批句式和开头。`,
              },
            ],
          },
          settings,
          signal,
        })
      ),
      blockedTerms
    )
    picked = pickFreshSuggestions([...picked, ...retryText], previous)
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
