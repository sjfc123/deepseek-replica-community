/* ============================================================================
 * 功能区：会话与角色核心 / systemPrompt 开始
 * 职责：默认助手文案、旧版提示词常量、普通对话与角色上下文的 system 前缀拼装，以及按需追加的演出规则。
 * 导出：LEGACY_SYSTEM_PROMPT、DEFAULT_SYSTEM_PROMPT、SYSTEM_PROMPT、NEUTRAL_SYSTEM_PROMPT、META_TALK_GUARD、ASIDE_AND_ADDRESS_GUARD、composeSystemPrompt。
 * ========================================================================== */

/**
 * 旧版默认提示词，仅用于升级迁移。
 * 用户主动保存过其它文本时不覆盖，只把这条历史默认换成当前默认。
 */
export const LEGACY_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/**
 * 默认系统提示词：普通 DeepSeek AI 助手，不预置角色、人设或角色扮演规则。
 * 需要角色扮演时，由玩家启用角色卡、填写基础档案或自行改写提示词。
 */
export const DEFAULT_SYSTEM_PROMPT = `你是 DeepSeek，由深度求索开发的 AI 助手。

直接回答用户的问题，先给结论，再补充必要的原因和步骤。信息不足时说明缺少什么，不猜测，也不编造事实、来源或数据。

保持准确、简洁、客观。不确定就明确说不确定；没有实际工具结果时，不要声称已经查询、计算或读取过任何内容。`

/** 默认普通助手身份：没有角色卡、档案或自定义提示时使用 */
export const SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT

/**
 * 角色卡或基础档案启用时的中性基底：
 * 默认提示词是普通助手身份，不能与角色卡同时出现；这里改用只要求遵循人物设定的短句。
 */
export const NEUTRAL_SYSTEM_PROMPT =
  '你正在与{{user}}进行角色对话。严格遵循已提供的人物设定、称呼与说话方式，始终以该人物身份回应；不要自称 AI、模型或助手，也不要复述本段提示。'

/**
 * 角色扮演专用后置约束：不覆盖手写人设，只压制「按设定」「分析用户意图」这类
 * 跳出戏剧的元叙述。仅当开关打开、存在角色卡或档案、且 system 不是默认提示时追加。
 */
export const META_TALK_GUARD =
  '\n\n【演出规则，不要复述本段】\n' +
  '你就是人物本身，不要把规则、限制、设定要求讲给{{user}}听。\n' +
  '禁止说“按照设定”“遵循规则”“根据对话要求”这类话，也不要提及自己在扮演。\n' +
  '禁止分析{{user}}的意图、禁止输出分析过程、推理步骤或写作计划；角色的主观心理活动可以写，但不要变成旁白或设定说明。\n' +
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
 * 1. 默认提示词是普通助手身份；角色卡或基础档案启用时，默认内容换成中性角色基底，避免“助手身份”和“人物身份”打架；
 * 2. 手写提示词原样使用，只有 `{{user}}` 标记会被替换成账号名字；
 * 3. 只有角色上下文才追加演出与括号约定；普通助手对话不追加角色扮演规则；
 * 4. 本地保存的提示词文本完全不变。
 */
export const composeSystemPrompt = ({
  savedPrompt,
  custom,
  suppressMetaTalk,
  userName,
  roleplayContext,
}: {
  savedPrompt: string
  custom: boolean
  suppressMetaTalk: boolean
  userName: string
  roleplayContext: boolean
}) => {
  // custom 仅为兼容旧调用保留；当前默认提示不再区分官方与自定义网关
  void custom
  const trimmed = savedPrompt.trim()
  // 用户主动清空提示词：不注入任何 system，连中性角色提示也不补。
  // 只有空白字符也按清空处理，避免发出“看起来有、实际为空”的 system。
  if (!trimmed) {
    return ''
  }
  const isDefault = trimmed === SYSTEM_PROMPT
  const basePrompt = isDefault && roleplayContext ? NEUTRAL_SYSTEM_PROMPT : trimmed
  const withUser = (text: string) => text.replaceAll('{{user}}', userName)
  const meta =
    suppressMetaTalk && roleplayContext ? withUser(META_TALK_GUARD) : ''
  const aside = roleplayContext ? withUser(ASIDE_AND_ADDRESS_GUARD) : ''
  return `${withUser(basePrompt)}${meta}${aside}`
}

/* ============================================================================
 * 功能区：会话与角色核心 / systemPrompt 结束
 * ========================================================================== */
