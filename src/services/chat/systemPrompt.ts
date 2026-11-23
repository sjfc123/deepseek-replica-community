import { DEFAULT_SYSTEM_PROMPT } from '../settings.js'

/** 未配置角色设定时的官方助手身份 */
export const SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT

/**
 * 自定义网关且没改过提示词时使用的中性提示：
 * 不注入官方身份，改为要求模型遵循用户给出的角色设定，避免角色扮演时自称 AI。
 */
export const NEUTRAL_SYSTEM_PROMPT =
  '你正在与{{user}}进行角色扮演对话。严格遵循{{user}}在对话中给出的人物设定、称呼与说话风格，始终以角色身份回应；不要自称 AI、模型或助手，也不要复述本段提示。'

/**
 * 角色扮演专用后置约束：不覆盖手写人设，只压制「按设定」「分析用户意图」这类
 * 跳出戏剧的元叙述。仅当开关打开且 system 不是官方默认身份时追加。
 */
export const META_TALK_GUARD =
  '\n\n【演出规则，不要复述本段】\n' +
  '你就是人物本身，不要把规则、限制、设定要求讲给{{user}}听。\n' +
  '禁止说“按照设定”“遵循规则”“根据对话要求”这类话，也不要提及自己在扮演。\n' +
  '禁止分析{{user}}的意图、禁止输出思考过程、不要解释你接下来要怎么做。\n' +
  '只写人物的对话、动作与心理，全部表达都来自这个角色的主观视角。'

/**
 * 对话格式与称呼约定：括号内容是消息发送方没说出口的心理活动，
 * 人称按消息来源归属，避免把玩家自称与角色自称混为一谈。
 * 只约束解读方式，不改写任何一方的原文。
 */
export const ASIDE_AND_ADDRESS_GUARD =
  '\n\n【对话格式与称呼，不要复述本段】\n' +
  '{{user}}消息里用圆括号（中英文括号都算）包住的部分是{{user}}的内心独白，没有说出口；你读得到，但不要当成台词接住，也不要复述成{{user}}说过的话。\n' +
  '人称按消息来源判断：{{user}}消息里的「我」指{{user}}本人，「你」指你；你消息里的「我」指你，「你」指{{user}}。\n' +
  '{{user}}独白里出现角色名或「你」，是{{user}}在心里称呼你；出现「我」，是{{user}}在说自己。两者不能当成同一个人，也不要把{{user}}的自称改成你的自称。\n' +
  '你写内心活动同样放进圆括号，动作放进单星号，台词不加标记。'

/**
 * 拼出本次请求的 system：
 * 1. 手写的提示词原样使用，只有 `{{user}}` 标记会被替换成账号名字；
 * 2. 打开出戏压制时，在角色提示词后追加演出规则（官方默认身份不追加）；
 * 3. 本地保存的提示词文本完全不变。
 */
export const composeSystemPrompt = ({
  savedPrompt,
  custom,
  suppressMetaTalk,
  userName,
}: {
  savedPrompt: string
  custom: boolean
  suppressMetaTalk: boolean
  userName: string
}) => {
  // custom 只影响旧版中性提示，新默认人设两端通用，这里保留参数以兼容调用方
  void custom
  const trimmed = savedPrompt.trim()
  // 用户主动清空提示词：不注入任何 system，连中性角色提示也不补
  if (!trimmed && !savedPrompt) {
    return ''
  }
  // 新默认提示词本身不含公司身份，自定义网关也直接用它，保证「默认不为空且是活人设定」
  const roleplay = trimmed && trimmed !== SYSTEM_PROMPT
    ? trimmed
    : SYSTEM_PROMPT
  const withUser = (text: string) => text.replaceAll('{{user}}', userName)
  const base =
    suppressMetaTalk && roleplay !== SYSTEM_PROMPT
      ? `${withUser(roleplay)}${withUser(META_TALK_GUARD)}`
      : withUser(roleplay)
  // 格式约定对所有非空 system 生效：玩家在普通对话里也可能用括号表达心理活动
  return `${base}${withUser(ASIDE_AND_ADDRESS_GUARD)}`
}
