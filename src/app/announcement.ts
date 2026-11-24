/**
 * 启动公告数据：版本变化、分类分组与使用提醒。
 * 每个版本只在首次启动时弹出一次，ANNOUNCEMENT_ID 变化即重新弹出。
 * 条目按「新增 / 优化 / 修复 / 说明」四类组织；文案保持可读，
 * 只说明改动位置、实际行为与使用边界，不评价、不宣传。
 */
export const ANNOUNCEMENT_ID = '0.8.70'
export const ANNOUNCEMENT_VERSION = '0.8.70'

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
    '这一版在保留角色记忆与普通记忆隔离的基础上，重点处理设置页快速点击后的假死：转场不再无限等待，旧内核缺少动画能力时直接切换，导出或备份等待中原生文件选择变慢也不会再把返回键一起锁住。',
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
      category: 'opt',
      heading: '优化',
      items: [
        '设置页转场增加超时收尾：动画完成事件迟迟不返回、系统挂起或渲染停帧时，最多等待约 0.9 秒就完成返回，不再让“正在返回”的状态永久挡住后续点击。',
        '旧 WebView 没有 Element.animate，或 animate 调用抛错时，设置页直接走无动画切换，不再出现“界面这次没画出来”或进入设置后整页无响应。',
        '导出、备份等待原生文件选择时，返回键仍能退出当前设置页；只有导入、删除这类会改动本机数据的动作才暂时阻止返回。',
        '导出 ZIP 时每写入一批分片就让出一次主线程，长会话、图片较多的归档在写入期间仍能响应点击和返回。',
      ],
    },
    {
      category: 'fix',
      heading: '修复',
      items: [
        '快速点击设置项、连续按返回后按钮全部失灵：根因是设置页转场锁 exiting.current 只在动画 Promise 正常结束时释放；Promise 被暂停、取消或旧内核不支持动画时，开页和返回会一起失效。现在动画完成、取消、抛错和超时都会解锁。',
        '旧内核进入设置直接报 e.animate is not a function：转场代码没有判断 Web Animations 是否可用。现在先检测能力，再决定动画或直接切换。',
        '导出或备份的 busy 状态会连 back() 一起拦住，原生文件选择长时间不回执时，返回键看起来完全没反应；现在把“按钮禁用”和“阻止返回”拆开。',
      ],
    },
    {
      category: 'note',
      heading: '说明',
      items: [
        '设置页转场约 300ms；在这段时间内重复点击仍可能被忽略，等页面切换完成再点即可，这不是按钮失效。',
        '导出进行中离开设置页，后台仍会继续完成文件写入；失败或取消会在完成后给出提示。',
        '本轮修复主要在浏览器桩和转场异常模拟中验证；老机器上的实际帧率、系统返回手势与文件选择器行为仍需真机复验。',
      ],
    },
  ],
}
