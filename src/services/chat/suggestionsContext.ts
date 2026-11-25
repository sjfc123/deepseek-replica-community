/* ============================================================================
 * 功能区：会话与角色核心 / suggestionsContext 开始
 * 职责：回复建议的纯文本装配：身份边界、阶段行为、最近轮次、上一批建议与去重。
 * 导出：SUGGESTION_SYSTEM、buildSuggestionCardContext、buildSuggestionTranscript、
 *       buildSuggestionAsk、filterPrematureSuggestions、pickFreshSuggestions。
 * ========================================================================== */

import type { CharacterCard } from './roleplay.js'

export const SUGGESTION_SYSTEM = [
  '你是玩家回复建议器，不扮演角色，也不写旁白。你唯一的工作是替玩家拟下一句要发给角色的话。',
  '每条建议的说话人必须是玩家，收话人必须是角色：玩家向角色提问、试探、回应、行动或拒绝。',
  '写之前逐条自检：这句话是不是更像角色会说的？是不是在替角色回答、解释角色自己、续写角色反应？只要有一项成立，立刻删掉重写。',
  '禁止写角色的台词、动作、表情、心理、括号内心独白或旁白；建议里只能出现玩家这一侧能看到、能做到、能说出口的内容。',
  '称呼方向不能反：角色平时怎么称呼玩家，不等于玩家也这样称呼角色。角色叫玩家“哥”“主人”或“老师”时，建议里若用这个称呼去叫对方，基本就是写成了角色。',
  '每条建议都能直接发送。可以带少量单星号动作，但不要括号独白，不要写“建议”“选项”“你可以”等元话术，不要解释理由，不要用 Markdown。',
  '角色卡设定只用来判断她的称呼、语气、习惯和边界，是参考不是素材库；不要把设定里的旧事、物件和背景每条都搬进建议。',
  '实际生成依据是最近一轮对话、当前剧情阶段和角色此刻的行为；每条只回应当前这一小步，不跳步、不替下一轮写剧情。',
  '三条建议必须方向不同、句式不同、开头不同：可以分别落在生活细节、情绪回应、具体行动/验证上；不要三条都问同一个物件，也不要把同一句话换词复述。',
  '上一批建议里的句子不能再出现，也不要用近义改写复读；玩家已经看过的建议视为过期。',
  '正常阶段顺着本人语气回应，不要提前把异变、替身或后续线索说破；异变阶段用已经出现过的细节做验证，不要空泛地问“你是不是假的”；截止阶段只写识破、拒绝承认和救人。',
  '只能使用最近对话里玩家已经看到的信息。不要把角色卡秘密、真相、后续线索或完整线索链直接说破；玩家还没掌握的证据只能写成怀疑或试探。',
  '只输出一个 JSON 数组，四个字符串候选，例如 ["……","……","……","……"]。不要给角色配音，不要续写下一轮。',
].join('\n')

/** 只保留玩家能感知的角色侧信息；不读取秘密、备注、卡内系统指令与剧情真相。 */
export const buildSuggestionCardContext = (card: CharacterCard) =>
  [
    `角色名：${card.name}`,
    // 不把 identity 放进来：里面可能夹着旧疤、暗号等后续线索，容易让建议提前点破。
    card.relationship ? `与玩家的关系：${card.relationship}` : '',
    card.temperament ? `性格底色：${card.temperament}` : '',
    card.style ? `说话方式：${card.style}` : '',
    card.tics ? `小习惯：${card.tics}` : '',
  ]
    .filter(Boolean)
    .join('\n')

/** 把对话改写成有说话人标签的记录，避免模型把上一句角色台词继续当成自己的回合。 */
export const buildSuggestionTranscript = (
  cardName: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
) =>
  messages
    .map((message) => `${message.role === 'user' ? '玩家' : cardName}：${message.content}`)
    .join('\n')

/** 可单独回归的完整提问，确保身份约束、阶段边界与去重规则不会在后续改动中丢失。 */
export const buildSuggestionAsk = ({
  card,
  stageText,
  draft,
  transcript,
  previous = [],
}: {
  card: CharacterCard
  stageText: string
  draft: string
  transcript: string
  previous?: string[]
}) => {
  const cardText = buildSuggestionCardContext(card)
  return [
    `你是玩家这一侧，正在对「${card.name}」说话。替玩家写三条可以立刻发送的回复。`,
    '再次确认：不是替角色写，不是替角色接话，不是旁白，不是角色内心独白。',
    cardText ? `【角色参考，只用于理解她怎么说话；禁止把设定条目逐条搬进建议】\n${cardText}` : '',
    stageText ? `【当前轮次与阶段行为】\n${stageText}` : '',
    transcript ? `【最近两轮对话，角色的话只能当成她在对玩家说】\n${transcript}` : '',
    previous.length
      ? `【上一批建议，禁止原句复现或换词复读】\n${previous.map((line) => `- ${line}`).join('\n')}`
      : '',
    draft.trim() ? `【玩家已经输入到一半的话】\n${draft.trim()}` : '',
    [
      '【本批生成约束】',
      '1. 先判断玩家上一句在回应什么、角色此刻处于什么阶段，再决定三条建议的切入点。',
      '2. 三条必须分别是不同方向：细节追问、情绪或态度、具体行动/验证；不要都写成问句，也不要都提同一个物件。',
      '3. 每条都要能在当前阶段直接发送，不提前说出尚未出现的线索、真相或完整线索链。',
      '4. 每条必须是玩家口吻；若放到角色嘴里也成立，就说明身份错了，必须重写。',
      '5. 先写四条候选，覆盖不同方向；系统会去掉重复、未来线索和跑偏的一条，最终只展示三条。',
    ].join('\n'),
    '只输出 JSON 数组，四个字符串。',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** 去掉标点和空格后比较；两句只差标点或语气词时视为同一句。 */
const suggestionFingerprint = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** 双字重合度用于拦截“换词复述”，避免同一句只改一两个字又出现。 */
const suggestionSimilarity = (left: string, right: string) => {
  const a = suggestionFingerprint(left)
  const b = suggestionFingerprint(right)
  if (!a || !b) {
    return 0
  }
  if (a === b) {
    return 1
  }
  if (a.length < 2 || b.length < 2) {
    return 0
  }
  const grams = (value: string) => {
    const chars = [...value]
    return new Set(chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`))
  }
  const leftGrams = grams(a)
  const rightGrams = grams(b)
  let shared = 0
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) {
      shared += 1
    }
  }
  return shared / Math.max(1, Math.min(leftGrams.size, rightGrams.size))
}

/**
 * 硬过滤尚未到点的线索词：模型即使从卡设里看见旧疤、暗号或储物间，
 * 也不能把它们写成玩家此刻的建议。只比较已归一化的关键词，不做语义扩写。
 */
export const filterPrematureSuggestions = (
  candidates: string[],
  blockedTerms: string[] = []
): string[] => {
  if (blockedTerms.length === 0) {
    return candidates
  }
  return candidates.filter((candidate) => {
    const normalized = suggestionFingerprint(candidate)
    return !blockedTerms.some((term) => normalized.includes(term))
  })
}

/**
 * 候选去重：先排除上一批建议，再保证本批三条彼此不像。
 * 模型偶尔会只改一个词复读，因此用双字重合度而不是简单的字符串相等。
 */
export const pickFreshSuggestions = (candidates: string[], previous: string[] = []): string[] => {
  const picked: string[] = []
  for (const candidate of candidates) {
    const text = candidate.trim()
    if (!text || picked.length >= 3) {
      continue
    }
    if (picked.some((item) => suggestionSimilarity(item, text) >= 0.76)) {
      continue
    }
    if (previous.some((item) => suggestionSimilarity(item, text) >= 0.7)) {
      continue
    }
    picked.push(text)
  }
  return picked
}
/* ============================================================================
 * 功能区：会话与角色核心 / suggestionsContext 结束
 * ========================================================================== */
