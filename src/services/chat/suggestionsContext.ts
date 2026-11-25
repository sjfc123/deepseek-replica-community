/* ============================================================================
 * 功能区：会话与角色核心 / suggestionsContext 开始
 * 职责：回复建议的纯文本装配：身份边界、公开剧情状态与带说话人标签的对话记录。
 * 导出：SUGGESTION_SYSTEM、buildSuggestionCardContext、buildSuggestionTranscript、buildSuggestionAsk。
 * ========================================================================== */

import type { CharacterCard } from './roleplay.js'

export const SUGGESTION_SYSTEM = [
  '你是玩家回复建议器，不扮演角色，也不写旁白。你唯一的工作是替玩家拟下一句要发给角色的话。',
  '每条建议的说话人必须是玩家，收话人必须是角色：玩家向角色提问、试探、回应、行动或拒绝。',
  '写之前逐条自检：这句话是不是更像角色会说的？是不是在替角色回答、解释角色自己、续写角色反应？只要有一项成立，立刻删掉重写。',
  '禁止写角色的台词、动作、表情、心理、括号内心独白或旁白；建议里只能出现玩家这一侧能看到、能做到、能说出口的内容。',
  '称呼方向不能反：角色平时怎么称呼玩家，不等于玩家也这样称呼角色。角色叫玩家“哥”“主人”或“老师”时，建议里若用这个称呼去叫对方，基本就是写成了角色。',
  '每条建议都能直接发送。可以带少量单星号动作，但不要括号独白，不要写“建议”“选项”“你可以”等元话术，不要解释理由，不要用 Markdown。',
  '三条方向必须不同：一条用细节试探，一条追问或给情绪，一条换角度行动或拖延。',
  '只能使用最近对话里玩家已经看到的信息。不要把角色卡秘密、真相、后续线索直接说破；玩家还没掌握的证据只能写成怀疑或试探。',
  '只输出一个 JSON 数组，三个字符串，例如 ["……","……","……"]。不要给角色配音，不要续写下一轮。',
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

/** 可单独回归的完整提问，确保身份约束与公开线索边界不会在后续改动中丢失。 */
export const buildSuggestionAsk = ({
  card,
  storyText,
  draft,
  transcript,
}: {
  card: CharacterCard
  storyText: string
  draft: string
  transcript: string
}) => {
  const cardText = buildSuggestionCardContext(card)
  return [
    `你是玩家这一侧，正在对「${card.name}」说话。替玩家写三条可以立刻发送的回复。`,
    '再次确认：不是替角色写，不是替角色接话，不是旁白，不是角色内心独白。',
    cardText ? `【角色资料，只用于理解对话对象】\n${cardText}` : '',
    storyText ? `【公开剧情状态】\n${storyText}` : '',
    transcript ? `【已有对话，角色的话只能当成她在对玩家说】\n${transcript}` : '',
    draft.trim() ? `【玩家已经输入到一半的话】\n${draft.trim()}` : '',
    '三条建议都必须是玩家口吻。若某一句话放到角色嘴里也成立，就说明身份错了，必须重写。只输出 JSON 数组。',
  ]
    .filter(Boolean)
    .join('\n\n')
}
/* ============================================================================
 * 功能区：会话与角色核心 / suggestionsContext 结束
 * ========================================================================== */
