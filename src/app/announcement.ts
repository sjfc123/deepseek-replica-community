/**
 * 启动公告数据：版本变化、分类分组与使用提醒。
 * 每个版本只在首次启动时弹出一次，ANNOUNCEMENT_ID 变化即重新弹出。
 * 条目按「新增 / 优化 / 修复 / 说明」四类组织；文案保持可读，
 * 只说明改动位置、实际行为与使用边界，不评价、不宣传。
 */
export const ANNOUNCEMENT_ID = '0.8.73'
export const ANNOUNCEMENT_VERSION = '0.8.73'

export type AnnouncementCategory = 'new' | 'opt' | 'fix' | 'note'

/** 分类定义：名称用于标签，说明用于筛选栏下方的一句话解释 */
export const ANNOUNCEMENT_CATEGORIES: Record<
  AnnouncementCategory,
  { label: string; hint: string }
> = {
  new: { label: '新增', hint: '这一版新提供的能力' },
  opt: { label: '优化', hint: '行为不变，交互与视觉调整' },
  fix: { label: '修复', hint: '已定位并处理的故障' },
  note: { label: '说明', hint: '使用边界、存放位置与风险' },
}

export type AnnouncementSection = {
  category: AnnouncementCategory
  heading: string
  items: string[]
}

export const ANNOUNCEMENT: {
  title: string
  version: string
  intro: string
  warningTitle: string
  warningLead: string
  warning: string[]
  wish: string
  sections: AnnouncementSection[]
} = {
  title: '更新公告',
  version: ANNOUNCEMENT_VERSION,
  intro: [
    '这一版修复关闭角色扮演后语音通话仍沿用角色卡名字和头像的问题；鲸鱼图标改为台词牌堆循环，快速点击不再永久静默；回复完成时在“重新生成”左侧新增“继续生成”。',
  ].join('\n'),
  warningTitle: '用之前，先说清楚几件事',
  warningLead: '下面的内容不复杂，但和你怎么用、要承担什么有关，尤其是审核开关。',
  warning: [
    '安全审核默认开启：请求会携带 safety_check，由服务端按平台规则检查并过滤敏感内容。这是默认的省心路径，代价是部分表达会被拦下。',
    '关闭后，请求不再携带审核字段，软件也不再替你过滤敏感内容。你会得到更大的表达空间，也会同时接手这份空间带来的风险。',
    '需要说明：关闭的只是本应用附加的这一层审核标记，不等于模型或网关绝对不再审核；服务商自身的兜底策略仍可能存在，以对方规则为准。',
    '关闭审核后，模型说出的任何内容与行为、你主动发送的任何内容，以及由此产生的后果，都由使用者自行承担。自由是有代价的，关闭之前请确认你愿意承担这个代价。',
    '如果要把对话发给别人，请只发送正常的聊天内容。私密、深情或只属于你和它的部分，不要转发、截图分享，或上传到公开平台。',
    '上下文提醒会发送当前日期与大致位置；不想携带这些信息，可以在「接口与请求」里关闭。',
    '卡片、世界书和记忆只保存在本机；导出包与备份不包含 API Key。自定义请求头可能覆盖内置 Authorization，填写前确认来源可信。',
  ],
  wish: [
    '不少功能还不能保证稳定，也不能保证完全没有 bug，请在实际使用过程中观察；发现问题请联系作者，或等待后续版本。',
    '本软件为二次创作。二次开源之后，后续更新、编译、签名与分发由接手的人自行决定，并承担相应责任。',
  ].join('\n'),
  sections: [
    {
      category: 'new',
      heading: '新增',
      items: [
        '模型回复完成后，在“重新生成”左侧增加“继续生成”：沿用当前对话和这条回复的结尾继续写，不覆盖原回答，也不重新发一遍问题。',
      ],
    },
    {
      category: 'opt',
      heading: '优化',
      items: [
        '鲸鱼图标改为随机牌堆：单次点击也会换一句，快速连续点击会沿着牌堆不断切换；10 句全部用完后短暂冷却，再重新洗牌，不再出现点到后面永久没反应的情况。',
      ],
    },
    {
      category: 'fix',
      heading: '修复',
      items: [
        '关闭角色扮演或角色卡后，语音通话不再显示角色卡的名字和头像；优先使用提示词侧配置的角色名字与头像，没有可用名字时显示“语音通话”。',
        '语音通话的提示、请求装配和普通聊天保持一致：角色卡关闭后不再把卡名、卡头像当成当前通话身份。',
      ],
    },
    {
      category: 'note',
      heading: '说明',
      items: [
        '作者可能在闲余时间继续更新，也可能不更新，更新与否随缘；如果项目已有人接手，以接手方的仓库和发布页为准。本项目不承诺固定更新节奏。',
        '“继续生成”只在最后一条已完成回复、内置 Anthropic Messages 格式下出现；自定义网关或 OpenAI 格式暂不提供。',
      ],
    },
  ],
}
