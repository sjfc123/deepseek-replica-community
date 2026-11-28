/* ============================================================================
 * 功能区：会话与角色核心 / suggestions
 * 职责：按当前场景、在场人物、玩家站位与最近对话生成三条回复建议，只读会话，不写入消息。
 * 分区：01 类型、常量与模块依赖；
 *    02 功能实现（filterPrematureReplySuggestions、generateReplySuggestions）
 * 关联：依赖 services/api/chatConfig、services/api/client、services/api/types、services/chat/branches 等 10 个模块；
 *    被 components/chatInput/ChatInput 引用。
 * 导出：generateReplySuggestions、parseReplySuggestions
 * 边界：只处理聊天领域的数据、状态转换与提示词装配；不直接渲染视图，不发起职责外的网络请求。
 * ========================================================================== */

import { DEFAULT_CHAT_MODEL } from '../api/chatConfig.js'
import { streamChatMessage } from '../api/client.js'
import type { CreateMessageRequest } from '../api/types.js'
import { useSettings } from '../settings.js'
import { useChatStore } from './store.js'
import { getVisibleMessages } from './branches.js'
import { findSessionCharacterCard } from './roleplay.js'
import type { CharacterCard } from './roleplay.js'
import { basicRoleplayActive, DEFAULT_SUPPRESSION_PERSONA_NAME, SYSTEM_PROMPT } from './systemPrompt.js'
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
  filterSuggestionFit,
  hasSuggestionMix,
  parseReplySuggestions,
  pickFreshReplySuggestions,
  resolvePresentCast,
  type ReplySuggestion,
} from './suggestionsContext.js'

export { parseReplySuggestions } from './suggestionsContext.js'
/* ---- 01 类型、常量与模块依赖 ---- */
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

/** 无实体卡的基础角色扮演：只提供建议生成需要的名字与语气参考，不参与请求装配。 */
const createSuppressionSuggestionCard = (name: string): CharacterCard => ({
  id: 'suppression-suggestion-persona',
  name,
  age: '',
  gender: '',
  pronouns: '她',
  species: '',
  height: '',
  weight: '',
  birthday: '',
  occupation: '',
  residence: '',
  languages: '',
  favoriteFoods: '',
  dislikedFoods: '',
  favoriteDrinks: '',
  hobbies: '',
  dailyRoutine: '',
  possessions: '',
  pet: '',
  temperament: '温和但不软，会照顾人，有时黏人，有时嘴硬',
  values: '',
  petPeeves: '',
  boundaries: '',
  cooperation: '',
  identity: '',
  relationship: '大学时期就认识的青梅竹马',
  style: '像真人当面聊天，先接住情绪和处境，不要客服腔',
  tics: '',
  greeting: '',
  notes: '',
  genre: '',
  playStyle: 'immersive',
  scenario: '',
  systemDirective: '',
  appearance: '',
  background: '',
  goal: '',
  secret: '',
  speechExamples: '',
  createdAt: 0,
  updatedAt: 0,
  tags: [],
})

/* ---- 02 功能实现（filterPrematureReplySuggestions、generateReplySuggestions） ---- */
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
  const prompt = settings.systemPrompt.trim()
  const promptBound = settings.promptSessionIds === null || settings.promptSessionIds.includes(sessionId)
  const personaBound = settings.personaSessionIds === null || settings.personaSessionIds.includes(sessionId)
  // 系统提示词未绑定到本会话时视同空提示词，与主请求装配保持同一口径。
  const handwrittenActive = settings.systemPromptEnabled && Boolean(prompt) && promptBound
  const promptEmpty = !handwrittenActive
  const promptIsDefault = !promptEmpty && prompt === SYSTEM_PROMPT
  const activeCard = findSessionCharacterCard(settings.characterCards, session)
  const sessionHasMessages = (session.messages.length ?? 0) > 0
  const personaExplicit = settings.personaSessionIds !== null
  const personaConfigured = Boolean(
    settings.suppressionPersonaEnabled &&
      settings.basicRoleplayEnabled &&
      settings.suppressionPersona.trim()
  )
  const personaActive = (personaExplicit || !sessionHasMessages) && personaBound && personaConfigured && !activeCard
  // 基础扮演接管空/默认提示词时没有实体卡，这里补一张只用于读懂语气的轻量卡。
  const basicRoleplay =
    personaActive ||
    basicRoleplayActive({
      basicRoleplayEnabled: settings.basicRoleplayEnabled,
      promptEmpty,
      promptIsDefault,
      hasActiveCard: Boolean(activeCard),
    })
  const card =
    activeCard ??
    (basicRoleplay
      ? createSuppressionSuggestionCard(settings.characterName.trim() || DEFAULT_SUPPRESSION_PERSONA_NAME)
      : undefined)
  if (!card) {
    throw new Error('当前会话没有角色卡')
  }
  // 建议依据最近若干轮对话：既保持当前节拍与剧情走向，又不让过早的旧情节把话题拉回。
  const visible = getVisibleMessages(session)
  const allMessages = visible
    .map((message) => ({ role: message.role, content: messageText(message).trim() }))
    .filter((message): message is { role: 'user' | 'assistant'; content: string } =>
      Boolean(message.content)
    )
  const transcriptMessages = allMessages.slice(-6)
  const presenceMessages = allMessages.slice(-20)
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
    recentMessages: presenceMessages,
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
  const first = filterSuggestionFit(
    filterPrematureReplySuggestions(
      parseReplySuggestions(
        await requestSuggestionText({ body: makeBody(0.72), settings, signal }),
        cast,
        card.name
      ),
      blockedTerms
    ),
    presence
  )
  let picked = pickFreshReplySuggestions(first, previousText, { presence })
  const asideGap =
    presence === 'leaving' && picked.filter((item) => item.mode === 'aside').length < 2
  if (picked.length < 3 || asideGap || !hasSuggestionMix(picked)) {
    // 数量不足、或在离开场景里旁白不够时重试一次，明确要求换开头、换方向、换说话对象，并补齐旁白。
    const retryText = filterSuggestionFit(
      filterPrematureReplySuggestions(
        parseReplySuggestions(
          await requestSuggestionText({
            body: {
              ...makeBody(0.9),
              messages: [
                {
                  role: 'user',
                  content: `${ask}\n\n上一批结果${asideGap ? '缺少玩家侧旁白' : '重复或方向过于接近'}。请完全换三个切入点：至少一条回她的情绪或身体，至少一条落到另一件具体东西，不要三条都在“报纸、眼镜、窗户”里打转，不要复现上一批句式和“先/别”开头；多角色场景要换一个说话对象。${asideGap ? '当前玩家正在离开，至少两条必须以“（”开头写玩家自己的动作或内心。' : ''}`,
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
      ),
      presence
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
      previousText,
      { presence }
    )
  }
  if (picked.length < 3 || !hasSuggestionMix(picked)) {
    throw new Error('回复建议方向过于接近，请再试一次')
  }
  const list = picked.slice(0, 3)
  recentSuggestions.set(sessionId, list)
  return list
}

/* ============================================================================
 * 功能区：会话与角色核心 / suggestions 结束
 * ========================================================================== */
