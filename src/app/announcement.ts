/**
 * 启动公告数据：版本变化、分类分组与使用提醒。
 * 每个版本只在首次启动时弹出一次，ANNOUNCEMENT_ID 变化即重新弹出。
 * 条目按「新增 / 优化 / 修复 / 说明」四类组织；文案保持可读，
 * 只说明改动位置、实际行为与使用边界，不评价、不宣传。
 */
export const ANNOUNCEMENT_ID = '0.8.62'
export const ANNOUNCEMENT_VERSION = '0.8.62'

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
    '欢迎回来。这一版让语音通话可以直接开：不必先发文字，第一次开口后自动新建会话。',
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
    '本软件为二次创作。二次开源之后，不负责往后的任何更新，也不分发 APK；下一个接力交给下一个人。自重！',
  ].join('\n'),
  sections: [
    {
      category: 'new',
      heading: '新增',
      items: [
        '关闭角色扮演时不再撤掉当前角色卡：姓名、身份、关系与表达方式继续进入请求，世界书、场景和演出规则暂停；重新打开即可恢复完整扮演。',
        '角色卡面板新增「人设保留」状态，可一键恢复角色扮演；手写提示词在两种状态下都会发送，旧对话不会被清空。',
      ],
    },
    {
      category: 'fix',
      heading: '修复',
      items: [
        'Android 13 以下系统直录第一次拿到音频就报「通道中断」的问题已修复：旧实现用了 Android 13 才提供的 writeBytes，现在改为所有版本都支持的写入方式。',
        '补上 MODIFY_AUDIO_SETTINGS 权限与麦克风特性声明，和标准 Capacitor 录音授权流程对齐，减少部分系统对网页录音的拦截。',
      ],
    },
    {
      category: 'opt',
      heading: '优化',
      items: [
        '系统直录遇到读取异常，或连续两秒没有音频时，自动重建通道，最多两次；仍无数据才提示错误，不会因为一次系统回收就停在错误页。',
        '读取异常不再穿过网页桥，改为带原因的状态值；挂断、切后台或关闭应用时，录音通道立即释放。',
        '语音通话不再要求先发一条文字：没有活动会话也能直接开麦，首条转写会新建会话，并用这段内容生成列表标题。',
      ],
    },
    {
      category: 'note',
      heading: '说明',
      items: [
        '审核开关不是装饰。开启时，敏感内容会在服务端被拦下；关闭时，这层拦截被拿掉，自由度扩大，责任也随之回到使用者身上。',
        '软件能做的，是把开关状态和边界如实说清楚；不能做的，是替每个人判断某一段内容是否适合被看见、保存或转发。',
        '如果确实需要发送对话，请发送正常的聊天内容；私密、深情或只属于你和它的部分，留在本机更稳妥。',
      ],
    },
  ],
}
