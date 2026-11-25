/* ============================================================================
 * 功能区：会话与角色核心 / suggestions 开始
 * 职责：按当前角色卡与最近对话生成三条玩家回复建议，只读会话，不写入消息。
 * 导出：generateReplySuggestions、parseReplySuggestions。
 * ========================================================================== */

import { DEFAULT_CHAT_MODEL } from '../api/chatConfig.js'
import { streamChatMessage } from '../api/client.js'
import type { CreateMessageRequest } from '../api/types.js'
import { useSettings } from '../settings.js'
import { useChatStore } from './store.js'
import { getVisibleMessages } from './branches.js'
import { findSessionCharacterCard } from './roleplay.js'
import { formatStoryPublicStatus } from './story.js'
import {
  SUGGESTION_SYSTEM,
  buildSuggestionAsk,
  buildSuggestionTranscript,
} from './suggestionsContext.js'

const messageText = (message: ReturnType<typeof getVisibleMessages>[number]) => {
  if (message.role === 'user') {
    return message.content
  }
  return message.blocks
    .filter((block): block is { type: 'text'; text: string; isTemplate?: boolean } => block.type === 'text')
    .filter((block) => !block.isTemplate)
    .map((block) => block.text)
    .join('')
}

/** 从模型输出里取三条建议；允许 JSON 代码块与编号列表两种格式。 */
export const parseReplySuggestions = (raw: string): string[] => {
  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
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
          return [...new Set(list)].slice(0, 3)
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
  const transcriptMessages = getVisibleMessages(session)
    .map((message) => ({ role: message.role, content: messageText(message).trim() }))
    .filter((message): message is { role: 'user' | 'assistant'; content: string } => Boolean(message.content))
    .slice(-8)
  const ask = buildSuggestionAsk({
    card,
    storyText: formatStoryPublicStatus(card.story, session),
    draft,
    transcript: buildSuggestionTranscript(card.name, transcriptMessages),
  })
  const body: CreateMessageRequest = {
    model: settings.chatConfig.model || DEFAULT_CHAT_MODEL,
    max_tokens: 500,
    system: SUGGESTION_SYSTEM,
    messages: [{ role: 'user', content: ask }],
    thinking: { type: 'disabled' },
    temperature: 0.7,
  }
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
  const list = parseReplySuggestions(text)
  if (list.length < 3) {
    throw new Error('回复建议数量不足')
  }
  return list
}

/* ============================================================================
 * 功能区：会话与角色核心 / suggestions 结束
 * ========================================================================== */
