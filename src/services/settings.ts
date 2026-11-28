/* ============================================================================
 * 功能区：本地服务 / settings · 设置状态
 * 职责：设置状态：本机配置读写、迁移、角色卡/档案/世界书存档与全局开关。
 * 分区：01 自动备份参数与默认提示词；02 记忆与世界书预算；03 本机存储读写与状态初始化；04 设置状态与通用 Setter；
 *    05 角色卡、世界书与场景操作；06 会话分组、归档与设定存档；07 角色身份与基础档案；08 Token 限额与使用统计
 * 关联：依赖 app/android、services/api/chatConfig、services/api/speech、services/chat/builtinAvatars 等 11 个模块；
 *    被 scripts/test-context-compaction、scripts/test-history-merge、app/App、app/diagnostics 等 41 个模块 引用。
 * 导出：SessionFolder、AUTO_BACKUP_MINUTES_DEFAULT、AUTO_BACKUP_MINUTES_MIN、AUTO_BACKUP_MINUTES_MAX、Locale、LocalePreference、AccentColor、BubbleRadius、MessageSpacing、ThemePreference、ChatLayout、MEMORY_LIMIT_MIN 等 114 项
 * 边界：只维护设置状态、存档与迁移；不实现设置页控件与路由。
 * ========================================================================== */

import { create } from 'zustand'
import {
  DEFAULT_SYSTEM_PROMPT,
  LEGACY_SYSTEM_PROMPT,
} from './chat/systemPrompt.js'
import { android } from '../app/android.js'
import { DEFAULT_CHAT_CONFIG, readChatConfig, type ChatConfig } from './api/chatConfig.js'
import { NORMAL_MEMORY_MAX_CARDS, NORMAL_MEMORY_MAX_CHARS, type MemoryMode } from './chat/memory.js'
import {
  BUILTIN_ID_PREFIX,
  CHARACTER_CARD_MAX,
  dedupeWorldbookEntries,
  EMPTY_SCENE,
  canEnableRoleplay,
  ensureBuiltinCharacterCards,
  isAvatarDataUrl,
  normalizeCharacterCards,
  normalizeScene,
  normalizeWorldbook,
  WORLDBOOK_MAX,
  type CharacterCard,
  type SceneState,
  type WorldbookEntry,
} from './chat/roleplay.js'
import { ensureBuiltinCardAvatars } from './chat/builtinAvatars.js'
import {
  emptyCharacterProfile,
  normalizeCharacterProfile,
  type CharacterProfile,
} from './chat/characterProfile.js'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import { migrateLocalData } from './dataMigration.js'
import { markDataChanged } from './dataRevision.js'

/** 会话分组：给大量对话分类，只影响侧栏的筛选与显示 */
export type SessionFolder = {
  id: string
  name: string
  createdAt: number
}

/** 自动备份间隔：以分钟为存储单位，默认 2 小时，允许 5 分钟–168 小时 */
/* ---- 01 自动备份参数与默认提示词 ---- */
export const AUTO_BACKUP_MINUTES_DEFAULT = 120
export const AUTO_BACKUP_MINUTES_MIN = 5
export const AUTO_BACKUP_MINUTES_MAX = 10080

const clampBackupMinutes = (minutes: number) =>
  Math.min(AUTO_BACKUP_MINUTES_MAX, Math.max(AUTO_BACKUP_MINUTES_MIN, Math.round(minutes)))

/** 读取间隔（分钟）：新键优先；旧版小时键按 60 倍迁移一次；非法值回落默认 */
function readAutoBackupMinutes(): number {
  const own = Number(read(KEYS.autoBackupMinutes))
  if (Number.isFinite(own) && own > 0) {
    return clampBackupMinutes(own)
  }
  const legacyHours = Number(read(KEYS.autoBackupHoursLegacy))
  if (Number.isFinite(legacyHours) && legacyHours > 0) {
    const migrated = clampBackupMinutes(legacyHours * 60)
    write(KEYS.autoBackupMinutes, String(migrated))
    return migrated
  }
  return AUTO_BACKUP_MINUTES_DEFAULT
}

export type Locale = 'zh-CN' | 'en-US'
export type LocalePreference = Locale | 'system'

/** 主题偏好；默认跟随系统 */
export type AccentColor = 'blue' | 'teal' | 'violet' | 'amber' | 'rose' | 'green'
export type BubbleRadius = 'compact' | 'standard' | 'round'
export type MessageSpacing = 'compact' | 'normal' | 'loose'

export type ThemePreference = 'light' | 'dark' | 'system'

/** 聊天布局：原版卡片、微信式气泡、蓝白气泡；后两者共用一套气泡结构，只换配色 */
export type ChatLayout = 'card' | 'wechat' | 'blue'

/** 余额与用量悬浮胶囊位置：底部居中 / 输入框上方 / 顶栏 */
export type BalanceChipPosition = 'bottom' | 'aboveInput' | 'top'

/** 胶囊长按拖拽后的自定义落点；x/y 为视口百分比（0–100），null 表示走槽位默认位置 */
export type BalanceChipPoint = { x: number; y: number }

export { DEFAULT_SYSTEM_PROMPT, LEGACY_SYSTEM_PROMPT } from './chat/systemPrompt.js'

type AccountProfile = {
  username: string
  avatar: string | null
}

/** 本机设置，Android 上的 API Key 和账号资料交给原生层存储。 */
type Settings = {
  apiKey: string | null
  chatConfig: ChatConfig
  accountProfile: AccountProfile
  locale: Locale
  localePreference: LocalePreference
  themePreference: ThemePreference
  /** 主题色：只换强调色，深浅模式仍单独控制 */
  accentColor: AccentColor
  /** 气泡圆角：紧凑 / 标准 / 大圆角 */
  bubbleRadius: BubbleRadius
  /** 消息间距：紧凑 / 标准 / 宽松 */
  messageSpacing: MessageSpacing
  location: UserLocation | null
  ttsVoice: TtsVoice
  autoRead: boolean
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  fontSize: number | null
  foldThinking: boolean
  pinnedSessions: string[]
  /** 系统提示词：只对选中会话生效；null 表示旧版未迁移记录，暂按全部会话继承 */
  systemPrompt: string
  /** 系统提示词绑定的会话 id；显式数组外的会话不再收到该提示词 */
  promptSessionIds: string[] | null
  /** 采样参数，null 表示沿用服务端默认值 */
  temperature: number | null
  topP: number | null
  maxTokens: number | null
  /** 角色扮演单独一套采样参数：启用角色卡时优先使用，null 表示沿用上面的通用值 */
  rpTemperature: number | null
  rpTopP: number | null
  rpMaxTokens: number | null
  /** 被安全拒绝时保留已下发的正文，避免整轮内容消失导致角色断戏 */
  keepRefusedContent: boolean
  /** 长对话自动压缩为摘要；关闭后只按预算丢弃最旧的轮次 */
  autoCompact: boolean
  /** 推理强度：仅 OpenAI 协议在开启深度思考时下发 reasoning_effort，null 表示不传 */
  thinkingEffort: 'low' | 'high' | 'max' | null
  /** 自定义请求头，每行 Key: Value，或 JSON 对象；随所有请求发出 */
  customHeaders: string
  /** 请求附带 safety_check: high；第三方网关不接受扩展字段时可关 */
  safetyCheck: boolean
  /** 每轮附带日期、星期、位置与语言快照 latest_reminder */
  sendLatestReminder: boolean
  /** 首轮请求服务端生成标题；关闭后用首行文本做标题 */
  autoTitle: boolean
  /** 被拒轮次进入上下文；关闭时沿用原版丢弃策略 */
  allowRefusedContext: boolean
  /** 关键词拒答：命中时本地直接返回拒答话术，不请求接口 */
  refusalEnabled: boolean
  refusalKeywords: string
  refusalCaseSensitive: boolean
  /** 自定义拒答话术，留空使用内置文案 */
  refusalMessage: string
  /** 每次启动时把历史自动备份到下载目录，覆盖安装或重装后可导入找回 */
  autoBackup: boolean
  /** 自动备份间隔（小时），1–168；默认 2 小时 */
  /** 自动备份间隔（分钟），5–10080 */
  autoBackupMinutes: number
  /** 手写角色档案名：档案关闭后仍保留并用于 system 身份行；角色卡启用时不会被卡名覆盖 */
  characterName: string
  /** 角色基础档案：只描述人物本身，与提示词、世界书、场景分开保存 */
  characterProfile: CharacterProfile
  /** 基础档案开关：默认开启；关闭后档案只保留在本地，不进入 system */
  profileEnabled: boolean
  /** 普通官方助手友好语气：默认开启；只追加固定语气约束，不覆盖角色卡或自定义提示词 */
  friendlyTone: boolean
  /** 默认系统提示词开关：开启时发送官方助手身份与应用功能索引；关闭后不发送，自定义提示词/基础扮演同级作为 system，都没有则用内置兜底人设 */
  defaultPromptEnabled: boolean
  /** 手写系统提示词开关：关闭后不注入手写 system 提示词（文本保留在本机），按空提示词走身份判定 */
  systemPromptEnabled: boolean
  /** 角色头像，data URL；空表示用首字母占位 */
  characterAvatar: string | null
  /** 聊天区显示头像：助手用角色头像，用户用账号头像 */
  avatarInChat: boolean
  /** 内心独白：括号片段置灰，朗读与通话不读取该片段 */
  thoughtAside: boolean
  /** 顶栏记忆胶囊入口 */
  memoryBadge: boolean
  /** 消息下方的记忆标记 */
  memoryInline: boolean
  /** 基础扮演模式：空/默认提示词且没有角色卡、档案时，用内置或自定义基础扮演预设进入角色扮演；关闭后回到普通助手 */
  basicRoleplayEnabled: boolean
  /** 角色扮演时在 system 末尾追加强制约束，压制「按设定」「分析用户意图」这类元叙述 */
  suppressMetaTalk: boolean
  /** 压制设定开启且提示词为空/默认时，用自定义预设替换内置大学青梅竹马 */
  suppressionPersonaEnabled: boolean
  /** 自定义基础角色扮演预设；只在内置预设被替换时生效 */
  suppressionPersona: string
  /** 聊天区外观：卡片或气泡（气泡只换配色，结构一套） */
  chatLayout: ChatLayout
  /** 聊天区角色头像边长（px），20–36 */
  characterAvatarSize: number
  /** 聊天区玩家头像边长（px），20–36 */
  userAvatarSize: number
  /** 流式输出时是否自动跟随到底；关闭后只在发送新消息时跳到底部 */
  autoFollow: boolean
  /** 聊天头像形状：圆形或圆角方形 */
  avatarShape: 'circle' | 'rounded'
  /** 单个会话的 token 提醒上限，0 表示不提醒 */
  tokenLimit: number
  /** 回复完成后是否显示输入/输出/缓存命中明细 */
  showUsage: boolean
  /** 用量明细显示在回复下方；默认 false，显示在回复上方 */
  usageBelow: boolean
  /** 主页与对话页悬浮「余额 + 上下文用量」胶囊；关闭后不在界面显示 */
  balanceChipEnabled: boolean
  /** 悬浮胶囊的预设位置；主页默认底部居中，对话页按位置落到可见槽位 */
  balanceChipPosition: BalanceChipPosition
  /** 胶囊上是否附带当前上下文用量；关闭后只显示余额，点进面板仍可看明细 */
  balanceChipShowUsage: boolean
  /** 胶囊长按拖拽后的自定义落点；null 走槽位默认位置 */
  balanceChipPos: BalanceChipPoint | null
  /** 主页 LOGO 自定义图（data URL）；null 沿用内置彩蛋头像 */
  homeLogo: string | null
  /** 主页问候大标题自定义文字；空串沿用按时段 / 彩蛋的默认文案 */
  /** 主页台词池：点头像随机取一条；空数组合集时回退内置台词 */
  homeGreetings: string[]
  /** 长期记忆：关闭 / 每轮整段记录 / 每轮记录后模型提炼合并 */
  memoryMode: MemoryMode
  /** 长期记忆保留上限（自动卡片），10–9999；超出后最早的自动卡片归档 */
  memoryLimit: number
  /** 长期记忆总字数上限，同时也是单次注入的字符预算；超出后最早的自动卡片归档 */
  memoryChars: number
  /** 普通记忆独立注入开关：关闭后普通卡片保留，但不进入请求 */
  normalMemoryEnabled: boolean
  /** 普通记忆独立卡片上限 */
  normalMemoryLimit: number
  /** 普通记忆独立字数上限 */
  normalMemoryChars: number
  /** 角色卡：多角色切换；启用中的卡会注入姓名、身份、关系、风格等字段 */
  characterCards: CharacterCard[]
  activeCharacterId: string | null
  /** 角色扮演模式：开启时注入当前启用卡；关闭后不再注入卡，按档案开关决定是否保留手写基础档案 */
  roleplayEnabled: boolean
  /** 角色卡头像：按卡片 id 单独存一份 data URL，与卡片正文分开，删除卡片时随之清理 */
  cardAvatars: Record<string, string>
  /** 世界书：关键词命中的设定才注入，常驻条目每轮必进 */
  worldbook: WorldbookEntry[]
  /** 世界书单轮注入字符预算：默认 1,000，可自定义；只限制拼进 system 的标题与正文 */
  worldbookChars: number
  /** 世界书是否进入请求：关闭后保留条目与预算，但不拼进 system */
  worldbookInject: boolean
  /** 旧版全局场景草稿，仅用于升级兼容与旧存档；当前场景已改为会话自己的 scene 字段 */
  scene: SceneState
  /** 每轮结束后自动提取场景变化；会多发一次小请求 */
  sceneAutoUpdate: boolean
  /** 会话分组：名称与创建时间，仅本机使用 */
  sessionFolders: SessionFolder[]
  /** 会话归属的分组：sessionId → folderId，未记录表示未分组 */
  sessionFolderMap: Record<string, string>
  /** 已归档的会话：保留数据，默认不显示，也不参与备份导出 */
  archivedSessions: string[]
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  chatConfig: 'replica:chat-config',
  accountProfile: 'replica:account-profile',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  accentColor: 'replica:accent-color',
  bubbleRadius: 'replica:bubble-radius',
  messageSpacing: 'replica:message-spacing',
  ttsVoice: 'chat-demo:tts-voice',
  autoRead: 'replica:auto-read',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  fontSize: 'replica:font-size',
  foldThinking: 'replica:fold-thinking',
  pinnedSessions: 'replica:pinned-sessions',
  systemPrompt: 'replica:system-prompt',
  /** 用户主动清空过提示词：区分「没设置过」和「设置为空」 */
  systemPromptEmpty: 'replica:system-prompt-empty',
  /** 系统提示词按会话绑定；null 表示旧版全局记录，尚未在选择弹窗里落盘 */
  promptSessionIds: 'replica:prompt-session-ids',
  temperature: 'replica:temperature',
  topP: 'replica:top-p',
  maxTokens: 'replica:max-tokens',
  rpTemperature: 'replica:rp-temperature',
  rpTopP: 'replica:rp-top-p',
  rpMaxTokens: 'replica:rp-max-tokens',
  keepRefusedContent: 'replica:keep-refused-content',
  autoCompact: 'replica:auto-compact',
  thinkingEffort: 'replica:thinking-effort',
  customHeaders: 'replica:custom-headers',
  safetyCheck: 'replica:safety-check',
  sendLatestReminder: 'replica:latest-reminder',
  autoTitle: 'replica:auto-title',
  allowRefusedContext: 'replica:allow-refused-context',
  refusalEnabled: 'replica:refusal-enabled',
  refusalKeywords: 'replica:refusal-keywords',
  refusalCaseSensitive: 'replica:refusal-case-sensitive',
  refusalMessage: 'replica:refusal-message',
  autoBackup: 'replica:auto-backup',
  autoBackupMinutes: 'replica:auto-backup-minutes',
  /** 旧版以小时为单位存储，仅用于一次性迁移 */
  autoBackupHoursLegacy: 'replica:auto-backup-hours',
  characterName: 'replica:character-name',
  /** 角色基础档案：结构固定，单键保存整份 JSON */
  characterProfile: 'replica:character-profile',
  /** 基础档案开关：无历史值时默认开启；该口径自 0.8.84 引入独立开关起生效 */
  profileEnabled: 'replica:character-profile-enabled',
  /** 普通助手友好语气开关：无历史值时默认开启，只有明确保存过 0 才算关闭 */
  friendlyTone: 'replica:friendly-tone',
  /** 默认系统提示词开关：无历史值时默认开启，只有明确保存过 0 才算关闭 */
  defaultPromptEnabled: 'replica:default-prompt-enabled',
  /** 手写系统提示词开关：无历史值时默认开启，只有明确保存过 0 才算关闭 */
  systemPromptEnabled: 'replica:system-prompt-enabled',
  characterAvatar: 'replica:character-avatar',
  avatarInChat: 'replica:avatar-in-chat',
  thoughtAside: 'replica:thought-aside',
  memoryBadge: 'replica:memory-badge',
  memoryInline: 'replica:memory-inline',
  basicRoleplayEnabled: 'replica:basic-roleplay-enabled',
  suppressMetaTalk: 'replica:suppress-meta',
  suppressionPersonaEnabled: 'replica:suppression-persona-enabled',
  suppressionPersona: 'replica:suppression-persona',
  chatLayout: 'replica:chat-layout',
  characterAvatarSize: 'replica:character-avatar-size',
  userAvatarSize: 'replica:user-avatar-size',
  /** 旧版统一头像尺寸，只用于迁移读取 */
  avatarSizeLegacy: 'replica:avatar-size',
  autoFollow: 'replica:auto-follow',
  avatarShape: 'replica:avatar-shape',
  tokenLimit: 'replica:token-limit',
  showUsage: 'replica:show-usage',
  usageBelow: 'replica:usage-below',
  balanceChipEnabled: 'replica:balance-chip-enabled',
  balanceChipPosition: 'replica:balance-chip-position',
  balanceChipShowUsage: 'replica:balance-chip-show-usage',
  balanceChipPos: 'replica:balance-chip-pos',
  homeLogo: 'replica:home-logo',
  homeGreeting: 'replica:home-greeting',
  tokenChipClosed: 'replica:token-chip-closed',
  memoryMode: 'replica:memory-mode',
  memoryLimit: 'replica:memory-limit',
  memoryChars: 'replica:memory-chars',
  normalMemoryEnabled: 'replica:normal-memory-enabled',
  normalMemoryLimit: 'replica:normal-memory-limit',
  normalMemoryChars: 'replica:normal-memory-chars',
  characterCards: 'replica:character-cards',
  cardAvatars: 'replica:card-avatars',
  /** 用户显式移除过的内置卡默认头像：下次启动不再补回，自定义头像不受影响 */
  builtinCardAvatarsRemoved: 'replica:builtin-card-avatars-removed',
  /** 用户显式删除过的内置角色卡 id：启动时不再回填，体检清空则照常补回 */
  builtinCardsRemoved: 'replica:builtin-cards-removed',
  activeCharacterId: 'replica:active-character',
  roleplayEnabled: 'replica:roleplay-enabled',
  worldbook: 'replica:worldbook',
  worldbookChars: 'replica:worldbook-chars',
  worldbookInject: 'replica:worldbook-inject',
  scene: 'replica:scene',
  sceneAutoUpdate: 'replica:scene-auto',
  sessionFolders: 'replica:session-folders',
  sessionFolderMap: 'replica:session-folder-map',
  archivedSessions: 'replica:session-archived',
} as const

/** 卡片上限允许 10–9999；9999 近似「一直记」，实际仍受存储与注入预算约束 */

/* ---- 02 记忆与世界书预算 ---- */
export const MEMORY_LIMIT_MIN = 10
export const MEMORY_LIMIT_MAX = 9999
/** 每次注入的字符预算：默认 1,000,000，允许 1,000–5,000,000 */
export const MEMORY_CHARS_MIN = 1000
export const MEMORY_CHARS_MAX = 5_000_000
export const MEMORY_CHARS_DEFAULT = 1_000_000

/** 世界书单轮注入预算：默认 1,000，允许 500–20,000 字 */
export const WORLDBOOK_BUDGET_MIN = 500
export const WORLDBOOK_BUDGET_MAX = 20_000
export const WORLDBOOK_BUDGET_DEFAULT = 1000

/* ---- 02b 全局取值边界与默认档位 ---- */
/* 本分区集中维护跨组件复用的数值边界、默认值与可选档位；设置页控件与服务端读写统一引用，
   不在组件内重复硬编码。调整取值范围或档位时只改本分区，避免多处口径不一致。 */

/** 聊天区头像边长（px）：允许 20–36，默认 24；角色头像与玩家头像共用同一档位 */
export const AVATAR_SIZE_MIN = 20
export const AVATAR_SIZE_MAX = 36
export const AVATAR_SIZE_DEFAULT = 24
/** 头像边长可选档位（px），与 min/max 边界一致 */
export const AVATAR_SIZE_OPTIONS: readonly number[] = [20, 24, 30, 36]

/** 采样参数 · 温度 temperature：允许 0–2，步进 0.1；null 表示不发送该字段，沿用服务端默认 */
export const TEMPERATURE_MIN = 0
export const TEMPERATURE_MAX = 2
export const TEMPERATURE_STEP = 0.1

/** 采样参数 · Top P：允许 0–1，步进 0.05；null 表示不发送该字段 */
export const TOP_P_MIN = 0
export const TOP_P_MAX = 1
export const TOP_P_STEP = 0.05

/** 采样参数 · 最大输出 tokens：允许 1–1,000,000，步进 1；null 表示不发送该字段 */
export const MAX_TOKENS_MIN = 1
export const MAX_TOKENS_MAX = 1_000_000
export const MAX_TOKENS_STEP = 1

/** Token 提醒上限：未设置（0，不提醒）时，输入框草稿填入的建议值 */
export const TOKEN_LIMIT_DRAFT_DEFAULT = 256_000

/** Token 提醒上限快捷档位（tokens），纯本地提醒阈值，不改变服务端计费 */
export const TOKEN_LIMIT_PRESETS: readonly number[] = [50_000, 256_000, 512_000, 1_000_000]

/** 长期记忆卡片上限快捷档位（张），末尾取允许上限 */
export const MEMORY_LIMIT_PRESETS: readonly number[] = [60, 200, 1000, MEMORY_LIMIT_MAX]

/** 长期记忆字符预算快捷档位（字），依次取常用值、默认值与允许上限 */
export const MEMORY_CHARS_PRESETS: readonly number[] = [
  10_000,
  50_000,
  100_000,
  MEMORY_CHARS_DEFAULT,
  MEMORY_CHARS_MAX,
]

/* ---- 03 本机存储读写与状态初始化 ---- */
const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
    // 设置与角色卡、世界书、长期记忆偏好都会进入备份；任何真实改动都算新数据。
    markDataChanged()
    return true
  } catch {
    return false
  }
}

const initialAccountProfile = (): AccountProfile => {
  try {
    const value = android ? android.readAccountProfile() : read(KEYS.accountProfile)
    const profile = JSON.parse(value ?? 'null') as Partial<AccountProfile> | null
    return {
      username: typeof profile?.username === 'string' ? profile.username : '',
      avatar:
        typeof profile?.avatar === 'string' &&
        /^data:image\/(webp|png);base64,/.test(profile.avatar)
          ? profile.avatar
          : null,
    }
  } catch {
    return { username: '', avatar: null }
  }
}

const initialAvatarSize = (role: 'character' | 'user') => {
  const own = Number(read(role === 'user' ? KEYS.userAvatarSize : KEYS.characterAvatarSize))
  if (Number.isFinite(own) && own >= AVATAR_SIZE_MIN && own <= AVATAR_SIZE_MAX) {
    return own
  }
  // 旧版只有一个统一尺寸，首次升级时两边都沿用它
  const legacy = Number(read(KEYS.avatarSizeLegacy))
  return Number.isFinite(legacy) &&
    legacy >= AVATAR_SIZE_MIN &&
    legacy <= AVATAR_SIZE_MAX
    ? legacy
    : AVATAR_SIZE_DEFAULT
}

const initialChatLayout = (): ChatLayout => {
  const saved = read(KEYS.chatLayout)
  return saved === 'wechat' || saved === 'blue' ? saved : 'card'
}

const initialBalanceChipPosition = (): BalanceChipPosition => {
  const saved = read(KEYS.balanceChipPosition)
  return saved === 'aboveInput' || saved === 'top' ? saved : 'bottom'
}

const initialBalanceChipPos = (): BalanceChipPoint | null => {
  const raw = readJson(KEYS.balanceChipPos)
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const point = raw as Record<string, unknown>
  const x = Number(point.x)
  const y = Number(point.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }
  return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) }
}

const initialHomeLogo = (): string | null => {
  const saved = read(KEYS.homeLogo)
  return isAvatarDataUrl(saved) ? saved : null
}

/** 台词池上限：防止误粘贴超长清单把主页与设置页拖慢。 */
export const HOME_GREETINGS_LIMIT = 30
/** 单条台词上限；超出部分直接截断，避免主页一行铺满整屏。 */
export const HOME_GREETING_CHARS = 200

/**
 * 兼容旧版单条台词与本机设置备份：
 * - 旧值是非 JSON 的一段文字 → 视为一条台词；
 * - 新值是 JSON 字符串数组 → 逐条清洗；
 * - 其他非法值 → 空池，回退内置台词。
 */
export const normalizeHomeGreetings = (saved: unknown): string[] => {
  let source: unknown = saved
  if (typeof saved === 'string') {
    const text = saved.trim()
    if (!text) {
      return []
    }
    if (text.startsWith('[')) {
      try {
        source = JSON.parse(text)
      } catch {
        source = [text]
      }
    } else {
      source = [text]
    }
  }
  if (!Array.isArray(source)) {
    return []
  }
  const lines: string[] = []
  for (const item of source) {
    if (typeof item !== 'string') {
      continue
    }
    const line = item.replace(/\r\n/g, '\n').trim().slice(0, HOME_GREETING_CHARS)
    if (line && !lines.includes(line)) {
      lines.push(line)
    }
    if (lines.length >= HOME_GREETINGS_LIMIT) {
      break
    }
  }
  return lines
}

const initialHomeGreetings = (): string[] => normalizeHomeGreetings(read(KEYS.homeGreeting))

/** 布局落在根节点上，消息组件靠 CSS 属性选择器切换样式，避免每个组件重渲染判断 */
const applyChatLayout = (chatLayout: ChatLayout) => {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.chatLayout = chatLayout
  }
}

const applyAvatarShape = (avatarShape: 'circle' | 'rounded') => {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty(
      '--chat-avatar-radius',
      avatarShape === 'rounded' ? '6px' : '50%'
    )
  }
}

const applyAvatarSizes = () => {
  if (typeof document === 'undefined') {
    return
  }
  const { characterAvatarSize, userAvatarSize } = useSettings.getState()
  const root = document.documentElement
  root.style.setProperty('--chat-avatar-size-ai', `${characterAvatarSize}px`)
  root.style.setProperty('--chat-avatar-size-user', `${userAvatarSize}px`)
}

/** 角色头像：只接受本地压缩后的 data URL，避免记住失效的外链 */
const readJson = (key: string): unknown => {
  try {
    return JSON.parse(read(key) ?? 'null')
  } catch {
    return null
  }
}

const readBuiltinRemoved = (): string[] => {
  const raw = readJson(KEYS.builtinCardsRemoved)
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
}

/** 用户移除过的内置默认头像；只影响默认值回填，不影响自定义头像 */
const readBuiltinAvatarRemoved = (): string[] => {
  const raw = readJson(KEYS.builtinCardAvatarsRemoved)
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
}

/**
 * 读取本机角色卡，并按墓碑补齐缺失的内置卡。
 * 墓碑仅由用户删除动作写入：数据体检清空后仍会补回，用户主动删除则不再出现。
 */
const initialCharacterCards = (): CharacterCard[] => {
  const stored = normalizeCharacterCards(readJson(KEYS.characterCards)).slice(0, CHARACTER_CARD_MAX)
  const seeded = ensureBuiltinCharacterCards(stored, readBuiltinRemoved())
  if (seeded !== stored) {
    write(KEYS.characterCards, JSON.stringify(seeded))
  }
  // 清理早期版本写入的种子标记，避免残留键误判注入状态
  write('replica:builtin-cards-seeded', null)
  return seeded
}

/**
 * 读取角色卡头像表：只有通过格式校验的 data URL 才会留下，
 * 卡片删除后对应键由 deleteCharacterCard 清理，避免残留占用存储。
 */
const initialCardAvatars = (): Record<string, string> => {
  const raw = readJson(KEYS.cardAvatars)
  const stored =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const result: Record<string, string> = {}
  Object.entries(stored).forEach(([id, value]) => {
    if (isAvatarDataUrl(value)) {
      result[id] = value
    }
  })
  const cards = initialCharacterCards()
  const seeded = ensureBuiltinCardAvatars(
    result,
    cards.map((card) => card.id),
    readBuiltinAvatarRemoved()
  )
  if (seeded.added > 0 || seeded.replaced > 0) {
    write(KEYS.cardAvatars, JSON.stringify(seeded.avatars))
  }
  return seeded.avatars
}

const initialActiveCharacterId = (): string | null => {
  const saved = read(KEYS.activeCharacterId)
  return saved && initialCharacterCards().some((card) => card.id === saved) ? saved : null
}

/**
 * 角色名字属于「手写角色基础档案」，与当前角色卡完全分开。
 * 启用、关闭或编辑角色卡均不写入该键；该键只保存用户手动填写的档案名。
 */
const initialCharacterName = (): string => read(KEYS.characterName)?.trim() ?? ''

/** 角色扮演开关必须依附一张有效角色卡：没有启用卡时一律视为关闭 */
const initialRoleplayEnabled = (activeId: string | null): boolean => {
  if (!activeId) {
    return false
  }
  const saved = read(KEYS.roleplayEnabled)
  return saved === null ? true : saved === '1'
}

const initialWorldbook = (): WorldbookEntry[] => normalizeWorldbook(readJson(KEYS.worldbook))

const initialScene = (): SceneState => normalizeScene(readJson(KEYS.scene))

/** 基础档案随设置一起读回；损坏或旧结构统一归一化成空档案，不阻断启动 */
const initialCharacterProfile = (): CharacterProfile =>
  normalizeCharacterProfile(readJson(KEYS.characterProfile))

/** 档案开关默认开启；只有明确存过 '0' 才视为关闭 */
const initialProfileEnabled = (): boolean => read(KEYS.profileEnabled) !== '0'
/** 友好助手语气默认开启；只有用户明确关过才为关 */
const initialFriendlyTone = (): boolean => read(KEYS.friendlyTone) !== '0'

const initialCharacterAvatar = (): string | null => {
  const saved = read(KEYS.characterAvatar)
  return saved && /^data:image\/(webp|png|jpeg);base64,/.test(saved) ? saved : null
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocalePreference = (): LocalePreference => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return 'system'
}

const resolveLocale = (preference: LocalePreference): Locale =>
  preference === 'system' ? (isChineseBrowser() ? 'zh-CN' : 'en-US') : preference

const initialFontSize = () => {
  const saved = read(KEYS.fontSize)
  if (saved === null || saved === 'system') {
    return null
  }
  return /^[0-6]$/.test(saved) ? Number(saved) : 2
}

const initialPinnedSessions = (): string[] => {
  try {
    const value: unknown = JSON.parse(read(KEYS.pinnedSessions) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** 采样参数：空串表示跟随服务端默认，非法或越界值回落到默认 */
const readNumberParam = (key: string, min: number, max: number, integer = false) => {
  const saved = read(key)
  if (saved === null || saved === '') {
    return null
  }
  const value = Number(saved)
  if (!Number.isFinite(value) || value < min || value > max) {
    return null
  }
  return integer ? Math.round(value) : value
}

const initialTokenLimit = () => {
  const saved = Number(read(KEYS.tokenLimit))
  return Number.isFinite(saved) && saved >= 0 ? Math.round(saved) : 0
}

const initialSystemPrompt = () => {
  if (read(KEYS.systemPromptEmpty) === '1') {
    return ''
  }
  const saved = read(KEYS.systemPrompt)
  // 键不存在 = 新用户：可编辑系统提示词默认留空，由内置助手提示词接管；
  // 键存在但只有空白 = 主动清空，保持空。
  if (saved === null) {
    return ''
  }
  if (!saved.trim()) {
    return ''
  }
  if (saved === LEGACY_SYSTEM_PROMPT) {
    return ''
  }
  return saved
}

const initialPromptSessionIds = (): string[] | null => {
  const raw = readJson(KEYS.promptSessionIds)
  if (raw === null) {
    return null
  }
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter((item): item is string => typeof item === 'string')
}

/** 推理强度：非法或未保存时返回 null，表示不向接口发送 reasoning_effort */
const initialThinkingEffort = (): 'low' | 'high' | 'max' | null => {
  const saved = read(KEYS.thinkingEffort)
  return saved === 'low' || saved === 'high' || saved === 'max' ? saved : null
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialAccentColor = (): AccentColor => {
  const saved = read(KEYS.accentColor)
  return saved === 'blue' ||
    saved === 'teal' ||
    saved === 'violet' ||
    saved === 'amber' ||
    saved === 'rose' ||
    saved === 'green'
    ? saved
    : 'blue'
}

const initialBubbleRadius = (): BubbleRadius => {
  const saved = read(KEYS.bubbleRadius)
  return saved === 'compact' || saved === 'round' ? saved : 'standard'
}

const initialMessageSpacing = (): MessageSpacing => {
  const saved = read(KEYS.messageSpacing)
  return saved === 'compact' || saved === 'loose' ? saved : 'normal'
}

const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/* 建立设置状态之前先体检本机数据：覆盖安装带来的旧值在这里修好或隔离，不让它进读取链路 */
migrateLocalData()


/* ---- 04 设置状态与通用 Setter ---- */
export const useSettings = create<Settings>(() => ({
  apiKey: android ? android.readApiKey() : read(KEYS.apiKey),
  chatConfig: readChatConfig(
    android ? (android.readChatConfig?.() ?? null) : read(KEYS.chatConfig)
  ),
  accountProfile: initialAccountProfile(),
  locale: resolveLocale(initialLocalePreference()),
  localePreference: initialLocalePreference(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  accentColor: initialAccentColor(),
  bubbleRadius: initialBubbleRadius(),
  messageSpacing: initialMessageSpacing(),
  ttsVoice: initialTtsVoice(),
  autoRead: read(KEYS.autoRead) === 'true',
  thinking: read(KEYS.thinking) === 'true',
  search: (read(KEYS.search) ?? (android ? 'true' : 'false')) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  fontSize: initialFontSize(),
  foldThinking: read(KEYS.foldThinking) !== 'false',
  pinnedSessions: initialPinnedSessions(),
  systemPrompt: initialSystemPrompt(),
  promptSessionIds: initialPromptSessionIds(),
  temperature: readNumberParam(KEYS.temperature, 0, 2),
  topP: readNumberParam(KEYS.topP, 0, 1),
  maxTokens: readNumberParam(KEYS.maxTokens, 1, 1_000_000, true),
  rpTemperature: readNumberParam(KEYS.rpTemperature, 0, 2),
  rpTopP: readNumberParam(KEYS.rpTopP, 0, 1),
  rpMaxTokens: readNumberParam(KEYS.rpMaxTokens, 1, 1_000_000, true),
  keepRefusedContent: read(KEYS.keepRefusedContent) === 'true',
  autoCompact: read(KEYS.autoCompact) !== 'false',
  thinkingEffort: initialThinkingEffort(),
  customHeaders: read(KEYS.customHeaders) ?? '',
  safetyCheck: read(KEYS.safetyCheck) !== 'false',
  sendLatestReminder: read(KEYS.sendLatestReminder) !== 'false',
  autoTitle: read(KEYS.autoTitle) !== 'false',
  allowRefusedContext: read(KEYS.allowRefusedContext) === 'true',
  refusalEnabled: read(KEYS.refusalEnabled) === 'true',
  refusalKeywords: read(KEYS.refusalKeywords) ?? '',
  refusalCaseSensitive: read(KEYS.refusalCaseSensitive) === 'true',
  refusalMessage: read(KEYS.refusalMessage) ?? '',
  autoBackup: read(KEYS.autoBackup) !== 'false',
  autoBackupMinutes: readAutoBackupMinutes(),
  characterName: initialCharacterName(),
  characterProfile: initialCharacterProfile(),
  profileEnabled: initialProfileEnabled(),
  friendlyTone: initialFriendlyTone(),
  defaultPromptEnabled: read(KEYS.defaultPromptEnabled) !== '0',
  systemPromptEnabled: read(KEYS.systemPromptEnabled) !== '0',
  characterAvatar: initialCharacterAvatar(),
  avatarInChat: read(KEYS.avatarInChat) !== 'false',
  thoughtAside: read(KEYS.thoughtAside) !== 'false',
  memoryBadge: read(KEYS.memoryBadge) !== 'false',
  memoryInline: read(KEYS.memoryInline) !== 'false',
  // 旧版「出戏压制」同时承担基础扮演开关；迁移时把旧值带入新开关，避免老用户基础扮演被静默关闭。
  basicRoleplayEnabled: (read(KEYS.basicRoleplayEnabled) ?? read(KEYS.suppressMetaTalk)) === 'true',
  suppressMetaTalk: read(KEYS.suppressMetaTalk) === 'true',
  suppressionPersonaEnabled: read(KEYS.suppressionPersonaEnabled) === 'true',
  suppressionPersona: read(KEYS.suppressionPersona) ?? '',
  chatLayout: initialChatLayout(),
  characterAvatarSize: initialAvatarSize('character'),
  userAvatarSize: initialAvatarSize('user'),
  autoFollow: read(KEYS.autoFollow) === '0' ? false : true,
  avatarShape: read(KEYS.avatarShape) === 'rounded' ? 'rounded' : 'circle',
  tokenLimit: initialTokenLimit(),
  showUsage: read(KEYS.showUsage) === '0' ? false : true,
  usageBelow: read(KEYS.usageBelow) === 'true',
  balanceChipEnabled: read(KEYS.balanceChipEnabled) !== '0',
  balanceChipPosition: initialBalanceChipPosition(),
  balanceChipShowUsage: read(KEYS.balanceChipShowUsage) !== '0',
  balanceChipPos: initialBalanceChipPos(),
  homeLogo: initialHomeLogo(),
  homeGreetings: initialHomeGreetings(),
  memoryMode: readMemoryMode(),
  memoryLimit: readMemoryLimit(),
  memoryChars: readMemoryChars(),
  normalMemoryEnabled: read(KEYS.normalMemoryEnabled) !== 'false',
  normalMemoryLimit: readNormalMemoryLimit(),
  normalMemoryChars: readNormalMemoryChars(),
  characterCards: initialCharacterCards(),
  activeCharacterId: initialActiveCharacterId(),
  roleplayEnabled: initialRoleplayEnabled(initialActiveCharacterId()),
  cardAvatars: initialCardAvatars(),
  worldbook: initialWorldbook(),
  worldbookChars: readWorldbookChars(),
  worldbookInject: read(KEYS.worldbookInject) !== 'false',
  scene: initialScene(),
  sceneAutoUpdate: read(KEYS.sceneAutoUpdate) === '1',
  sessionFolders: initialSessionFolders(),
  sessionFolderMap: initialSessionFolderMap(),
  archivedSessions: initialArchivedSessions(),
}))

export const setAccountProfile = (accountProfile: AccountProfile) => {
  const { username, avatar } = accountProfile
  const value = username || avatar ? JSON.stringify(accountProfile) : null
  const persisted = android ? android.writeAccountProfile(value) : write(KEYS.accountProfile, value)
  if (!persisted) {
    return false
  }
  useSettings.setState({ accountProfile })
  return true
}

export const setPinnedSessions = (pinnedSessions: string[]) => {
  write(KEYS.pinnedSessions, JSON.stringify(pinnedSessions))
  useSettings.setState({ pinnedSessions })
}
export const setLocale = (localePreference: LocalePreference) => {
  write(KEYS.locale, localePreference)
  useSettings.setState({ localePreference, locale: resolveLocale(localePreference) })
}

export const setFontSize = (fontSize: number | null) => {
  write(KEYS.fontSize, fontSize?.toString() ?? 'system')
  useSettings.setState({ fontSize })
}

export const setFoldThinking = (foldThinking: boolean) => {
  write(KEYS.foldThinking, String(foldThinking))
  useSettings.setState({ foldThinking })
}
export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setAccentColor = (accentColor: AccentColor) => {
  write(KEYS.accentColor, accentColor)
  useSettings.setState({ accentColor })
}

export const setBubbleRadius = (bubbleRadius: BubbleRadius) => {
  write(KEYS.bubbleRadius, bubbleRadius)
  useSettings.setState({ bubbleRadius })
}

export const setMessageSpacing = (messageSpacing: MessageSpacing) => {
  write(KEYS.messageSpacing, messageSpacing)
  useSettings.setState({ messageSpacing })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setAutoRead = (autoRead: boolean) => {
  write(KEYS.autoRead, String(autoRead))
  useSettings.setState({ autoRead })
}

export const setApiKey = (apiKey: string | null) => {
  if (android) {
    if (!android.writeApiKey(apiKey)) {
      return false
    }
  } else {
    write(KEYS.apiKey, apiKey)
  }
  useSettings.setState({ apiKey })
  return true
}

export const setChatConfig = (chatConfig: ChatConfig) => {
  const value =
    chatConfig.model || chatConfig.endpoint || chatConfig.format !== DEFAULT_CHAT_CONFIG.format
      ? JSON.stringify(chatConfig)
      : null
  const persisted = android ? android.writeChatConfig(value) : write(KEYS.chatConfig, value)
  if (persisted) {
    useSettings.setState({ chatConfig })
  }
  return persisted
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

/**
 * 角色提示词。清空不写回默认文本，只记录「主动清空」状态；发送时由 composeSystemPrompt
 * 回退默认官方助手，并同步停用角色卡、档案与身份行。想恢复可见的默认文本走复位按钮。
 */
export const setSystemPrompt = (systemPrompt: string) => {
  const cleared = !systemPrompt.trim()
  const isDefault = !cleared && systemPrompt === DEFAULT_SYSTEM_PROMPT
  const previous = useSettings.getState().systemPrompt.trim()
  write(KEYS.systemPromptEmpty, cleared ? '1' : null)
  write(KEYS.systemPrompt, cleared || isDefault ? null : systemPrompt)
  // 新填入的提示词先不继承旧版全局范围；进入选择弹窗并确认后才绑定到具体会话。
  const nextBinding = cleared
    ? []
    : previous
      ? useSettings.getState().promptSessionIds
      : []
  write(KEYS.promptSessionIds, nextBinding ? JSON.stringify(nextBinding) : null)
  useSettings.setState({ systemPrompt: cleared ? '' : systemPrompt, promptSessionIds: nextBinding })
}

/** 保存提示词与历史会话的绑定关系；null 仅用于内部旧版继承状态，界面确认后落盘为数组 */
export const setSystemPromptBinding = (promptSessionIds: string[] | null) => {
  write(KEYS.promptSessionIds, promptSessionIds === null ? null : JSON.stringify(promptSessionIds))
  useSettings.setState({ promptSessionIds })
}

export const setTemperature = (temperature: number | null) => {
  write(KEYS.temperature, temperature === null ? null : String(temperature))
  useSettings.setState({ temperature })
}

export const setTopP = (topP: number | null) => {
  write(KEYS.topP, topP === null ? null : String(topP))
  useSettings.setState({ topP })
}

export const setMaxTokens = (maxTokens: number | null) => {
  write(KEYS.maxTokens, maxTokens === null ? null : String(maxTokens))
  useSettings.setState({ maxTokens })
}

/** 角色扮演参数：与通用参数分开存，启用角色卡时优先 */
export const setRpTemperature = (rpTemperature: number | null) => {
  write(KEYS.rpTemperature, rpTemperature === null ? null : String(rpTemperature))
  useSettings.setState({ rpTemperature })
}

export const setRpTopP = (rpTopP: number | null) => {
  write(KEYS.rpTopP, rpTopP === null ? null : String(rpTopP))
  useSettings.setState({ rpTopP })
}

export const setRpMaxTokens = (rpMaxTokens: number | null) => {
  write(KEYS.rpMaxTokens, rpMaxTokens === null ? null : String(rpMaxTokens))
  useSettings.setState({ rpMaxTokens })
}

export const setKeepRefusedContent = (keepRefusedContent: boolean) => {
  write(KEYS.keepRefusedContent, String(keepRefusedContent))
  useSettings.setState({ keepRefusedContent })
}

export const setAutoCompact = (autoCompact: boolean) => {
  write(KEYS.autoCompact, String(autoCompact))
  useSettings.setState({ autoCompact })
}

/** 推理强度：null 表示不发送 reasoning_effort */
export const setThinkingEffort = (thinkingEffort: 'low' | 'high' | 'max' | null) => {
  write(KEYS.thinkingEffort, thinkingEffort)
  useSettings.setState({ thinkingEffort })
}

export const setCustomHeaders = (customHeaders: string) => {
  write(KEYS.customHeaders, customHeaders.trim() ? customHeaders : null)
  useSettings.setState({ customHeaders })
}

export const setSafetyCheck = (safetyCheck: boolean) => {
  write(KEYS.safetyCheck, String(safetyCheck))
  useSettings.setState({ safetyCheck })
}

export const setSendLatestReminder = (sendLatestReminder: boolean) => {
  write(KEYS.sendLatestReminder, String(sendLatestReminder))
  useSettings.setState({ sendLatestReminder })
}

export const setAutoTitle = (autoTitle: boolean) => {
  write(KEYS.autoTitle, String(autoTitle))
  useSettings.setState({ autoTitle })
}

export const setAllowRefusedContext = (allowRefusedContext: boolean) => {
  write(KEYS.allowRefusedContext, String(allowRefusedContext))
  useSettings.setState({ allowRefusedContext })
}

export const setRefusalEnabled = (refusalEnabled: boolean) => {
  write(KEYS.refusalEnabled, String(refusalEnabled))
  useSettings.setState({ refusalEnabled })
}

export const setRefusalKeywords = (refusalKeywords: string) => {
  write(KEYS.refusalKeywords, refusalKeywords.trim() ? refusalKeywords : null)
  useSettings.setState({ refusalKeywords })
}

export const setRefusalCaseSensitive = (refusalCaseSensitive: boolean) => {
  write(KEYS.refusalCaseSensitive, String(refusalCaseSensitive))
  useSettings.setState({ refusalCaseSensitive })
}

export const setRefusalMessage = (refusalMessage: string) => {
  write(KEYS.refusalMessage, refusalMessage.trim() ? refusalMessage : null)
  useSettings.setState({ refusalMessage })
}

export const setAutoBackup = (autoBackup: boolean) => {
  write(KEYS.autoBackup, String(autoBackup))
  useSettings.setState({ autoBackup })
}

export const setAutoBackupMinutes = (minutes: number) => {
  const next = clampBackupMinutes(minutes)
  write(KEYS.autoBackupMinutes, String(next))
  useSettings.setState({ autoBackupMinutes: next })
}

/** 命中本地拒答关键词时返回触发词，未命中返回 null */
export const matchRefusalKeyword = (text: string): string | null => {
  const { refusalEnabled, refusalKeywords, refusalCaseSensitive } = useSettings.getState()
  if (!refusalEnabled || !text) {
    return null
  }
  const words = refusalKeywords
    .split(/[\n,，]+/)
    .map((word) => word.trim())
    .filter(Boolean)
  if (words.length === 0) {
    return null
  }
  const haystack = refusalCaseSensitive ? text : text.toLowerCase()
  return (
    words.find((word) => haystack.includes(refusalCaseSensitive ? word : word.toLowerCase())) ??
    null
  )
}

/** 角色档案与表达页：只复位系统提示词 */


/* ---- 05 角色卡、世界书与场景操作 ---- */
const persistCharacterCards = (cards: CharacterCard[]) =>
  write(KEYS.characterCards, cards.length > 0 ? JSON.stringify(cards) : null)

/** 保存或更新一张角色卡；卡名只用于卡本身，不改写手写基础档案的名字 */
export const saveCharacterCard = (card: CharacterCard) => {
  const cards = useSettings.getState().characterCards
  const next = cards.some((item) => item.id === card.id)
    ? cards.map((item) => (item.id === card.id ? card : item))
    : [...cards, card].slice(-CHARACTER_CARD_MAX)
  if (!persistCharacterCards(next)) {
    return false
  }
  useSettings.setState({ characterCards: next })
  return true
}

/**
 * 写入或清除某张角色卡的头像。
 * 头像单独存放：卡片列表只关心文本字段，头像走独立键，删除卡片时一并清理。
 */
export const setCardAvatar = (cardId: string, avatar: string | null) => {
  const current = useSettings.getState().cardAvatars
  const saved = avatar && isAvatarDataUrl(avatar) ? avatar : null
  const next = saved
    ? { ...current, [cardId]: saved }
    : Object.fromEntries(Object.entries(current).filter(([id]) => id !== cardId))
  const payload = Object.keys(next).length > 0 ? JSON.stringify(next) : null
  if (!write(KEYS.cardAvatars, payload)) {
    return false
  }
  if (cardId.startsWith(BUILTIN_ID_PREFIX)) {
    const removed = readBuiltinAvatarRemoved()
    const nextRemoved = saved
      ? removed.filter((id) => id !== cardId)
      : [...new Set([...removed, cardId])]
    if (JSON.stringify(nextRemoved) !== JSON.stringify(removed)) {
      write(
        KEYS.builtinCardAvatarsRemoved,
        nextRemoved.length > 0 ? JSON.stringify(nextRemoved) : null
      )
    }
  }
  useSettings.setState({ cardAvatars: next })
  return true
}

/** 启用角色卡：卡名由运行时按「当前启用卡」解析，不覆盖手写基础档案的名字 */
export const activateCharacterCard = (id: string | null) => {
  const card = id ? useSettings.getState().characterCards.find((item) => item.id === id) : undefined
  write(KEYS.activeCharacterId, card ? card.id : null)
  write(KEYS.roleplayEnabled, card ? '1' : '0')
  useSettings.setState({
    activeCharacterId: card?.id ?? null,
    roleplayEnabled: Boolean(card),
  })
}

/**
 * 只切换角色扮演模式：开启必须有一张有效角色卡。
 * 没有有效卡时不写入开启状态，避免出现“开关已开、system 没有人物”的空转状态。
 */
export const setRoleplayEnabled = (roleplayEnabled: boolean) => {
  const state = useSettings.getState()
  const next = canEnableRoleplay(state.characterCards, state.activeCharacterId, roleplayEnabled)
  write(KEYS.roleplayEnabled, next ? '1' : '0')
  useSettings.setState({ roleplayEnabled: next })
}

/** 补齐缺失的内置角色卡；返回新增数量，写入失败返回 -1 */
export const restoreBuiltinCharacterCards = () => {
  const cards = useSettings.getState().characterCards
  const next = ensureBuiltinCharacterCards(cards)
  const added = next.length - cards.length
  const changed = JSON.stringify(next) !== JSON.stringify(cards)
  if (!changed) {
    return 0
  }
  if (!write(KEYS.characterCards, JSON.stringify(next))) {
    return -1
  }
  write(KEYS.builtinCardsRemoved, null)
  useSettings.setState({ characterCards: next })
  const avatars = useSettings.getState().cardAvatars
  const seeded = ensureBuiltinCardAvatars(
    avatars,
    next.map((card) => card.id),
    readBuiltinAvatarRemoved()
  )
  if ((seeded.added > 0 || seeded.replaced > 0) && write(KEYS.cardAvatars, JSON.stringify(seeded.avatars))) {
    useSettings.setState({ cardAvatars: seeded.avatars })
  }
  return added
}

export const deleteCharacterCard = (id: string) => {
  const next = useSettings.getState().characterCards.filter((card) => card.id !== id)
  if (!persistCharacterCards(next)) {
    return false
  }
  if (id.startsWith(BUILTIN_ID_PREFIX)) {
    const removed = [...new Set([...readBuiltinRemoved(), id])]
    write(KEYS.builtinCardsRemoved, JSON.stringify(removed))
  }
  const wasActive = useSettings.getState().activeCharacterId === id
  const active = wasActive ? null : useSettings.getState().activeCharacterId
  write(KEYS.activeCharacterId, active)
  if (active === null) {
    write(KEYS.roleplayEnabled, '0')
  }
  const currentAvatars = useSettings.getState().cardAvatars
  const avatars = Object.fromEntries(
    Object.entries(currentAvatars).filter(([avatarId]) => avatarId !== id)
  )
  const avatarRemoved = Boolean(currentAvatars[id])
  if (avatarRemoved) {
    write(KEYS.cardAvatars, Object.keys(avatars).length > 0 ? JSON.stringify(avatars) : null)
  }
  useSettings.setState({
    characterCards: next,
    activeCharacterId: active,
    ...(active === null ? { roleplayEnabled: false } : {}),
    ...(avatarRemoved ? { cardAvatars: avatars } : {}),
  })
  return true
}

const persistWorldbook = (entries: WorldbookEntry[]) =>
  write(KEYS.worldbook, entries.length > 0 ? JSON.stringify(entries) : null)

export const saveWorldbookEntry = (entry: WorldbookEntry) => {
  const entries = useSettings.getState().worldbook
  const next = dedupeWorldbookEntries(
    entries.some((item) => item.id === entry.id)
      ? entries.map((item) => (item.id === entry.id ? entry : item))
      : [...entries, entry]
  ).slice(-WORLDBOOK_MAX)
  if (!persistWorldbook(next)) {
    return false
  }
  useSettings.setState({ worldbook: next })
  return true
}

export const deleteWorldbookEntry = (id: string) => {
  const next = useSettings.getState().worldbook.filter((entry) => entry.id !== id)
  if (!persistWorldbook(next)) {
    return false
  }
  useSettings.setState({ worldbook: next })
  return true
}

/** 仅清掉旧版全局场景草稿；当前场景由会话自己的 scene 字段保存。 */
export const clearScene = () => {
  write(KEYS.scene, null)
  useSettings.setState({ scene: { ...EMPTY_SCENE } })
}

export const setSceneAutoUpdate = (sceneAutoUpdate: boolean) => {
  write(KEYS.sceneAutoUpdate, sceneAutoUpdate ? '1' : null)
  useSettings.setState({ sceneAutoUpdate })
}

/** 会话分组与归档的读取：坏数据直接丢弃，避免侧栏整体读不出来 */

/* ---- 06 会话分组、归档与设定存档 ---- */
function initialSessionFolders(): SessionFolder[] {
  try {
    const parsed: unknown = JSON.parse(read(KEYS.sessionFolders) ?? '[]')
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        id: String(item.id ?? ''),
        name: String(item.name ?? '').slice(0, 24),
        createdAt: Number(item.createdAt) || Date.now(),
      }))
      .filter((folder) => folder.id && folder.name)
      .slice(0, 50)
  } catch {
    return []
  }
}

function initialSessionFolderMap(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(read(KEYS.sessionFolderMap) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const map: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value) {
        map[key] = value
      }
    }
    return map
  } catch {
    return {}
  }
}

function initialArchivedSessions(): string[] {
  try {
    const parsed: unknown = JSON.parse(read(KEYS.archivedSessions) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

const persistSessionFolders = (sessionFolders: SessionFolder[]) => {
  write(KEYS.sessionFolders, JSON.stringify(sessionFolders))
  useSettings.setState({ sessionFolders })
}

/** 新建分组；同名直接返回已有项，避免出现两个重名 */
export const createSessionFolder = (name: string) => {
  const trimmed = name.trim().slice(0, 24)
  if (!trimmed) {
    return null
  }
  const current = useSettings.getState().sessionFolders
  const existing = current.find((folder) => folder.name === trimmed)
  if (existing) {
    return existing
  }
  const folder: SessionFolder = {
    id: `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: trimmed,
    createdAt: Date.now(),
  }
  persistSessionFolders([...current, folder])
  return folder
}

/** 删除分组：该组会话回到未分组，不改动对话本身 */
export const removeSessionFolder = (id: string) => {
  const current = useSettings.getState().sessionFolders
  persistSessionFolders(current.filter((folder) => folder.id !== id))
  const currentMap = useSettings.getState().sessionFolderMap
  const map = Object.fromEntries(
    Object.entries(currentMap).filter(([, folderId]) => folderId !== id)
  )
  write(KEYS.sessionFolderMap, JSON.stringify(map))
  useSettings.setState({ sessionFolderMap: map })
}

/** 把会话放进某个分组；传 null 表示移出分组 */
export const assignSessionFolder = (sessionId: string, folderId: string | null) => {
  const current = useSettings.getState().sessionFolderMap
  const map = folderId
    ? { ...current, [sessionId]: folderId }
    : Object.fromEntries(Object.entries(current).filter(([id]) => id !== sessionId))
  write(KEYS.sessionFolderMap, JSON.stringify(map))
  useSettings.setState({ sessionFolderMap: map })
}

/** 归档：数据留在本机，侧栏默认不显示，也不进自动备份 */
export const setSessionArchived = (sessionId: string, archived: boolean) => {
  const current = useSettings.getState().archivedSessions
  const next = archived
    ? [...new Set([...current, sessionId])]
    : current.filter((id) => id !== sessionId)
  write(KEYS.archivedSessions, JSON.stringify(next))
  useSettings.setState({ archivedSessions: next })
}


/* ---- 07 角色身份与基础档案 ---- */
export const setCharacterName = (characterName: string) => {
  const value = characterName.trim()
  write(KEYS.characterName, value || null)
  useSettings.setState({ characterName: value })
}

/** 默认系统提示词开关：关闭后不发送官方助手身份与功能索引；系统提示词/基础扮演同级作为 system，都没有则用内置兜底人设 */
export const setDefaultPromptEnabled = (defaultPromptEnabled: boolean) => {
  write(KEYS.defaultPromptEnabled, defaultPromptEnabled ? '1' : '0')
  useSettings.setState({ defaultPromptEnabled })
}

/** 手写系统提示词开关：关闭后不注入手写 system 提示词，文本保留；重新开启才恢复注入 */
export const setSystemPromptEnabled = (systemPromptEnabled: boolean) => {
  write(KEYS.systemPromptEnabled, systemPromptEnabled ? '1' : '0')
  useSettings.setState({ systemPromptEnabled })
}

/** 基础档案开关：关闭后文本保留但不注入，界面只读；重新开启才恢复编辑与注入 */
export const setCharacterProfileEnabled = (profileEnabled: boolean) => {
  write(KEYS.profileEnabled, profileEnabled ? '1' : '0')
  useSettings.setState({ profileEnabled })
}

/** 普通助手友好语气：默认开启，只影响默认官方助手；角色卡、档案与自定义提示词不受覆盖 */
export const setFriendlyTone = (friendlyTone: boolean) => {
  write(KEYS.friendlyTone, friendlyTone ? '1' : '0')
  useSettings.setState({ friendlyTone })
}

/** 基础档案逐字段写入：只更新当前字段，不清掉其它已填内容 */
export const setCharacterProfileField = (
  key: keyof Omit<CharacterProfile, 'updatedAt'>,
  value: string
) => {
  const current = useSettings.getState().characterProfile
  const next: CharacterProfile = {
    ...current,
    [key]: value,
    updatedAt: Date.now(),
  }
  write(KEYS.characterProfile, JSON.stringify(next))
  useSettings.setState({ characterProfile: next })
}

/** 导入设定存档或整体替换时使用；外部字段先归一化，避免脏键写入 */
export const replaceCharacterProfile = (raw: unknown) => {
  const next = normalizeCharacterProfile(raw)
  next.updatedAt = next.updatedAt || Date.now()
  write(KEYS.characterProfile, JSON.stringify(next))
  useSettings.setState({ characterProfile: next })
}

export const clearCharacterProfile = () => {
  const next = emptyCharacterProfile()
  write(KEYS.characterProfile, JSON.stringify(next))
  useSettings.setState({ characterProfile: next })
}

export const setCharacterAvatar = (characterAvatar: string | null) => {
  write(KEYS.characterAvatar, characterAvatar)
  useSettings.setState({ characterAvatar })
}

/** 重新开启用量提醒时同步恢复此前关闭的顶部小窗 */

/* ---- 08 Token 限额与使用统计 ---- */
export const setTokenLimit = (tokenLimit: number) => {
  const limit = Number.isFinite(tokenLimit) ? Math.max(0, Math.round(tokenLimit)) : 0
  write(KEYS.tokenLimit, String(limit))
  if (limit > 0) {
    write(KEYS.tokenChipClosed, null)
  }
  useSettings.setState({ tokenLimit: limit })
}

export const tokenUsageChipDismissed = () => read(KEYS.tokenChipClosed) === '1'

export const dismissTokenUsageChip = () => {
  write(KEYS.tokenChipClosed, '1')
}

function readMemoryMode(): MemoryMode {
  const saved = read(KEYS.memoryMode)
  return saved === 'off' || saved === 'refine' || saved === 'turn' ? saved : 'turn'
}

export const setMemoryMode = (memoryMode: MemoryMode) => {
  write(KEYS.memoryMode, memoryMode)
  useSettings.setState({ memoryMode })
}

function readMemoryLimit(): number {
  const raw = Number(read(KEYS.memoryLimit))
  if (!Number.isFinite(raw) || raw <= 0) {
    return 60
  }
  return Math.min(MEMORY_LIMIT_MAX, Math.max(MEMORY_LIMIT_MIN, Math.round(raw)))
}

export const setMemoryLimit = (memoryLimit: number) => {
  const next = Math.min(MEMORY_LIMIT_MAX, Math.max(MEMORY_LIMIT_MIN, Math.round(memoryLimit)))
  write(KEYS.memoryLimit, String(next))
  useSettings.setState({ memoryLimit: next })
}

function readMemoryChars(): number {
  const raw = Number(read(KEYS.memoryChars))
  if (!Number.isFinite(raw) || raw <= 0) {
    return MEMORY_CHARS_DEFAULT
  }
  return Math.min(MEMORY_CHARS_MAX, Math.max(MEMORY_CHARS_MIN, Math.round(raw)))
}

export const setMemoryChars = (memoryChars: number) => {
  const next = Math.min(MEMORY_CHARS_MAX, Math.max(MEMORY_CHARS_MIN, Math.round(memoryChars)))
  write(KEYS.memoryChars, String(next))
  useSettings.setState({ memoryChars: next })
}

function readNormalMemoryLimit(): number {
  const raw = Number(read(KEYS.normalMemoryLimit))
  if (!Number.isFinite(raw) || raw <= 0) {
    return NORMAL_MEMORY_MAX_CARDS
  }
  return Math.min(MEMORY_LIMIT_MAX, Math.max(MEMORY_LIMIT_MIN, Math.round(raw)))
}

export const setNormalMemoryLimit = (normalMemoryLimit: number) => {
  const next = Math.min(MEMORY_LIMIT_MAX, Math.max(MEMORY_LIMIT_MIN, Math.round(normalMemoryLimit)))
  write(KEYS.normalMemoryLimit, String(next))
  useSettings.setState({ normalMemoryLimit: next })
}

function readNormalMemoryChars(): number {
  const raw = Number(read(KEYS.normalMemoryChars))
  if (!Number.isFinite(raw) || raw <= 0) {
    return NORMAL_MEMORY_MAX_CHARS
  }
  return Math.min(MEMORY_CHARS_MAX, Math.max(MEMORY_CHARS_MIN, Math.round(raw)))
}

export const setNormalMemoryChars = (normalMemoryChars: number) => {
  const next = Math.min(MEMORY_CHARS_MAX, Math.max(MEMORY_CHARS_MIN, Math.round(normalMemoryChars)))
  write(KEYS.normalMemoryChars, String(next))
  useSettings.setState({ normalMemoryChars: next })
}

export const setNormalMemoryEnabled = (normalMemoryEnabled: boolean) => {
  write(KEYS.normalMemoryEnabled, String(normalMemoryEnabled))
  useSettings.setState({ normalMemoryEnabled })
}

function readWorldbookChars(): number {
  const raw = Number(read(KEYS.worldbookChars))
  if (!Number.isFinite(raw) || raw <= 0) {
    return WORLDBOOK_BUDGET_DEFAULT
  }
  return Math.min(WORLDBOOK_BUDGET_MAX, Math.max(WORLDBOOK_BUDGET_MIN, Math.round(raw)))
}

export const setWorldbookChars = (worldbookChars: number) => {
  const next = Math.min(
    WORLDBOOK_BUDGET_MAX,
    Math.max(WORLDBOOK_BUDGET_MIN, Math.round(worldbookChars))
  )
  write(KEYS.worldbookChars, String(next))
  useSettings.setState({ worldbookChars: next })
}

export const setWorldbookInject = (worldbookInject: boolean) => {
  write(KEYS.worldbookInject, String(worldbookInject))
  useSettings.setState({ worldbookInject })
}

export const setShowUsage = (showUsage: boolean) => {
  write(KEYS.showUsage, showUsage ? '1' : '0')
  useSettings.setState({ showUsage })
}

export const setUsageBelow = (usageBelow: boolean) => {
  write(KEYS.usageBelow, String(usageBelow))
  useSettings.setState({ usageBelow })
}

export const setBalanceChipEnabled = (balanceChipEnabled: boolean) => {
  write(KEYS.balanceChipEnabled, balanceChipEnabled ? '1' : '0')
  useSettings.setState({ balanceChipEnabled })
}

export const setBalanceChipPosition = (balanceChipPosition: BalanceChipPosition) => {
  write(KEYS.balanceChipPosition, balanceChipPosition)
  useSettings.setState({ balanceChipPosition })
}

export const setBalanceChipShowUsage = (balanceChipShowUsage: boolean) => {
  write(KEYS.balanceChipShowUsage, balanceChipShowUsage ? '1' : '0')
  useSettings.setState({ balanceChipShowUsage })
}

export const setBalanceChipPos = (balanceChipPos: BalanceChipPoint | null) => {
  write(KEYS.balanceChipPos, balanceChipPos ? JSON.stringify(balanceChipPos) : null)
  useSettings.setState({ balanceChipPos })
}

export const setHomeLogo = (homeLogo: string | null) => {
  write(KEYS.homeLogo, homeLogo && isAvatarDataUrl(homeLogo) ? homeLogo : null)
  useSettings.setState({ homeLogo: homeLogo && isAvatarDataUrl(homeLogo) ? homeLogo : null })
}

export const setHomeGreetings = (homeGreetings: string[]) => {
  const next = normalizeHomeGreetings(homeGreetings)
  write(KEYS.homeGreeting, next.length ? JSON.stringify(next) : null)
  useSettings.setState({ homeGreetings: next })
}

export const resetHomeAppearance = () => {
  write(KEYS.homeLogo, null)
  write(KEYS.homeGreeting, null)
  useSettings.setState({ homeLogo: null, homeGreetings: [] })
}

export const setAvatarShape = (avatarShape: 'circle' | 'rounded') => {
  write(KEYS.avatarShape, avatarShape)
  useSettings.setState({ avatarShape })
  applyAvatarShape(avatarShape)
}

export const setAutoFollow = (autoFollow: boolean) => {
  write(KEYS.autoFollow, autoFollow ? '1' : '0')
  useSettings.setState({ autoFollow })
}

const clampAvatarSize = (size: number) =>
  Math.min(AVATAR_SIZE_MAX, Math.max(AVATAR_SIZE_MIN, Math.round(size)))

/** 角色档案页改的是 AI 头像，账户页改的是玩家自己的头像，两边互不影响 */
export const setCharacterAvatarSize = (size: number) => {
  const next = clampAvatarSize(size)
  write(KEYS.characterAvatarSize, String(next))
  useSettings.setState({ characterAvatarSize: next })
  applyAvatarSizes()
}

export const setUserAvatarSize = (size: number) => {
  const next = clampAvatarSize(size)
  write(KEYS.userAvatarSize, String(next))
  useSettings.setState({ userAvatarSize: next })
  applyAvatarSizes()
}

export const setChatLayout = (chatLayout: ChatLayout) => {
  write(KEYS.chatLayout, chatLayout)
  useSettings.setState({ chatLayout })
  applyChatLayout(chatLayout)
}

export const setSuppressMetaTalk = (suppressMetaTalk: boolean) => {
  write(KEYS.suppressMetaTalk, String(suppressMetaTalk))
  useSettings.setState({ suppressMetaTalk })
}

/** 基础扮演模式开关：关闭后空/默认提示词回到普通助手，已有角色卡不受影响 */
export const setBasicRoleplayEnabled = (basicRoleplayEnabled: boolean) => {
  write(KEYS.basicRoleplayEnabled, String(basicRoleplayEnabled))
  useSettings.setState({ basicRoleplayEnabled })
}

/** 自定义压制预设开关：关闭后立刻回到内置的大学青梅竹马，不改已写文本 */
export const setSuppressionPersonaEnabled = (suppressionPersonaEnabled: boolean) => {
  write(KEYS.suppressionPersonaEnabled, String(suppressionPersonaEnabled))
  useSettings.setState({ suppressionPersonaEnabled })
}

/** 自定义预设正文；清空后再开启自定义会继续用内置预设，不会变成空人设 */
export const setSuppressionPersona = (suppressionPersona: string) => {
  const trimmed = suppressionPersona.trim()
  write(KEYS.suppressionPersona, trimmed ? suppressionPersona : null)
  useSettings.setState({ suppressionPersona: trimmed ? suppressionPersona : '' })
}

/**
 * 提示词里 `{{user}}` 的替身：账号名字优先，填的是占位名或空则回退「用户」。
 * 只处理模板标记，手写的人名原样保留。
 */
export const resolveUserName = (): string => {
  const name = useSettings.getState().accountProfile.username.trim()
  if (!name || name === '用户' || name === '本地用户' || name === 'Local user') {
    return '用户'
  }
  return name
}

export const setAvatarInChat = (avatarInChat: boolean) => {
  write(KEYS.avatarInChat, String(avatarInChat))
  useSettings.setState({ avatarInChat })
}

/** 顶栏记忆入口：关闭后只在会话页内与长期记忆面板里显示 */
export const setMemoryBadge = (memoryBadge: boolean) => {
  write(KEYS.memoryBadge, String(memoryBadge))
  useSettings.setState({ memoryBadge })
}

/** 消息内记忆标记：关闭后回复下面不再挂「记忆」胶囊 */
export const setMemoryInline = (memoryInline: boolean) => {
  write(KEYS.memoryInline, String(memoryInline))
  useSettings.setState({ memoryInline })
}

/** 内心独白识别：关闭后括号内容按普通正文显示，朗读也不再读取括号内容 */
export const setThoughtAside = (thoughtAside: boolean) => {
  write(KEYS.thoughtAside, String(thoughtAside))
  useSettings.setState({ thoughtAside })
}

/** 角色档案与表达页：提示词、角色名与基础档案复位；头像和显示开关属于形象资产，保留 */
export const resetCharacterSettings = () => {
  setSystemPrompt('')
  setCharacterName('')
  setSuppressMetaTalk(false)
  setSuppressionPersonaEnabled(false)
  setSuppressionPersona('')
  setFriendlyTone(true)
  setDefaultPromptEnabled(true)
  setSystemPromptEnabled(true)
  clearCharacterProfile()
  setCharacterProfileEnabled(true)
}

/** 生成参数页：温度、Top P、最大输出、推理强度 */
export const resetSamplingSettings = () => {
  setTemperature(null)
  setTopP(null)
  setMaxTokens(null)
  setRpTemperature(null)
  setRpTopP(null)
  setRpMaxTokens(null)
  setThinkingEffort(null)
}

/** 接口与请求页：请求头、安全审核、上下文提醒、自动标题 */
export const resetRequestSettings = () => {
  setCustomHeaders('')
  setSafetyCheck(true)
  setSendLatestReminder(true)
  setAutoTitle(true)
}

/** 上下文与拒答页：压缩、保留正文、被拒轮次 */
export const resetContextSettings = () => {
  setAutoCompact(true)
  setKeepRefusedContent(false)
  setAllowRefusedContext(false)
}

/** 关键词拒答页 */
export const resetRefusalSettings = () => {
  setRefusalEnabled(false)
  setRefusalKeywords('')
  setRefusalCaseSensitive(false)
  setRefusalMessage('')
}

applyChatLayout(useSettings.getState().chatLayout)
applyAvatarSizes()
applyAvatarShape(useSettings.getState().avatarShape)

/* ============================================================================
 * 功能区：本地服务 / settings 结束
 * ========================================================================== */
