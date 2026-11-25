/* ============================================================================
 * 功能区：会话与角色核心 / suggestions 开始
 * 职责：按当前角色卡与最近对话生成三条玩家回复建议，只读会话，不写入消息。
 * 导出：generateReplySuggestions、parseReplySuggestions。
 * ========================================================================== */

import { DEFAULT_CHAT_MODEL } from '../api/chatConfig.js'
import { streamChatMessage } from '../api/client.js'
import type { CreateMessageRequest, MessageParam } from '../api/types.js'
import { useSettings, resolveUserName } from '../settings.js'
import { useChatStore } from './store.js'
import { getVisibleMessages } from './branches.js'
import { formatCharacterCard, findSessionCharacterCard } from './roleplay.js'
import { formatStoryTurnBlock } from './story.js'

const SUGGESTION_SYSTEM = [
  '你是互动角色扮演的回复建议器。只替玩家写下一句可发送的回复，不替角色回答，不写旁白总结。',
  '每条建议都必须是玩家第一人称能直接说出口的话，可以带少量动作，10–45 个汉字。',
  '三条建议必须方向不同：一条试探、一条情绪推进、一条换角度行动或拖延；不要三条同义。',
  '根据最近对话里已经出现的线索写，不要把角色卡秘密直接说破；玩家还没掌握的证据只能写成怀疑或试探。',
  '不要出现“建议”“选项”“你可以”等元话术，不要解释理由，不要使用 Markdown。',
  '只输出一个 JSON 数组，三个字符串，例如 ["……","……","……"]。',
].join('\n')

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
  const recent = getVisibleMessages(session)
    .map(messageText)
    .filter(Boolean)
    .slice(-10)
  const visible = getVisibleMessages(session).slice(-5)
  const history: MessageParam[] = []
  for (const message of visible) {
    const content = messageText(message).trim()
    if (!content) {
      continue
    }
    history.push(
      message.role === 'user'
        ? { role: 'user', content }
        : { role: 'assistant', content: [{ type: 'text', text: content }] }
    )
  }
  const cardText = formatCharacterCard(card, resolveUserName())
  const storyText = formatStoryTurnBlock(card.story, session)
  const ask = [
    `角色卡：${card.name}`,
    cardText ? `【角色与演出约束】\n${cardText}` : '',
    storyText ? `【本轮剧情状态】\n${storyText}` : '',
    recent.length ? `【最近对话】\n${recent.join('\n')}` : '',
    draft.trim() ? `【玩家已经输入到一半的话】\n${draft.trim()}` : '',
    '请给玩家三条下一步可发送的回复，只输出 JSON 数组。',
  ]
    .filter(Boolean)
    .join('\n\n')
  const body: CreateMessageRequest = {
    model: settings.chatConfig.model || DEFAULT_CHAT_MODEL,
    max_tokens: 600,
    system: SUGGESTION_SYSTEM,
    messages: [
      ...history,
      { role: 'user', content: ask },
    ],
    thinking: { type: 'disabled' },
    temperature: 0.9,
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
