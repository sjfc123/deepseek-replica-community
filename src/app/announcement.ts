/**
 * 启动公告数据：版本变化、分类分组与使用提醒。
 * 每个版本只在首次启动时弹出一次，ANNOUNCEMENT_ID 变化即重新弹出。
 * 条目按「新增 / 优化 / 修复 / 说明」四类组织；文案保持可读，
 * 只说明改动位置、实际行为与使用边界，不评价、不宣传。
 */
export const ANNOUNCEMENT_ID = '0.8.78'
export const ANNOUNCEMENT_VERSION = '0.8.78'

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
    '这一版继续收紧“继续生成”：上游只回放原回答、没有产生新正文时，保留原回答并明确提示，不再当成成功续写，也不会重复写入记忆；续写前缀改为按实际请求的 assistant 序列化拼接，多文本段回放也能正确剥离。',
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
      category: 'fix',
      heading: '修复',
      items: [
        '继续生成只回放原文、没有新正文时，不再按正常完成收尾：原回答保留，界面提示“没有产生新内容”，本次不写入记忆，也不生成第二张记忆卡。',
        '续写前缀不再用简单的文本块拼接，而是按真正发给接口的 assistant 序列化结果生成；被思考或工具隔开的多段正文也能正确剥掉回放前缀，避免原句被再追加一遍。',
        '角色卡开场白固定留在 system 里，不再因为消息条数达到 2 条就从 system 消失；文案改为“只在第一条回复使用，后续自然延续”，角色卡与历史的前缀不再第二轮突然变化。',
        '纯空白提示词按“主动清空”处理，不再悄悄回落到默认人格；清空后请求体第一条就是 user，不会发出只有空格的 system。',
        '手写角色名和卡名都为空时，`{{char}}` 回退为 `AI`，不再把字面占位符留在 system 或背景资料里。',
        '默认人格与演出规则对“括号内容”的说法统一：旁白、分析、推理步骤和写作计划不写；角色自己的主观心理活动可以放进圆括号。',
        'Chat、Responses、Messages 三种协议统一拦截空白 system：Chat 不插入 system 消息，Responses 不写空 instructions，Messages 不写空 system。',
      ],
    },
    {
      category: 'opt',
      heading: '优化',
      items: [
        'system 在进入请求前一次固定，只由启用中的角色卡、手写提示词和固定演出规则组成；记忆、场景和本轮世界书作为本轮背景资料接在当前 user 消息末尾；上下文提醒是当前 user 之前的独立消息，两者都不进入 system。',
        '新增 `pnpm test:system` 回归测试，固定角色卡前缀、开场白存在性和三种协议的 system 位置；装配顺序与缓存边界写在 `SYSTEM-PROMPT-PIPELINE.md`。',
      ],
    },
    {
      category: 'note',
      heading: '说明',
      items: [
        '主动切换或关闭角色卡、修改手写提示词、修改角色名、开关“抑制元叙述”时，system 会按新设定变化，这是预期行为；继续生成会在本次请求临时追加续写约束，下一轮普通请求恢复原 system。',
        'system 不变不等于整个请求前缀不变：自动压缩或预算裁剪会丢弃最旧轮次，开启自动压缩时摘要会插入首条 user 消息；编辑或删除历史、切换分支、latest_reminder 内容变化也会改变请求前缀。请求体逐字稳定只证明客户端没有制造前缀差异，不代表服务商一定命中缓存。',
        '0.8.75 的会话菜单实心底板与内部滚动继续保留，本次不改菜单行为。',
      ],
    },
  ]}
