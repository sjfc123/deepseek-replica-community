/* ============================================================================
 * 功能区：会话与角色核心 / settingArchive · 设定存档
 * 职责：设定存档：角色卡、档案、头像、世界书与场景的构建、解析与应用；不导入聊天历史。
 * 分区：01 类型、契约与依赖；
 *    02 核心实现：parseSettingArchive、SettingArchiveResult、applySettingArchive；
 *    03 对外入口与收尾
 * 关联：依赖 services/chat/characterProfile、services/chat/roleplay；
 *    被 components/settings/AndroidSettings 引用。
 * 导出：SETTING_ARCHIVE_FORMAT、SETTING_ARCHIVE_VERSION、SettingArchive、SettingArchiveInput、SettingArchiveErrorCode、SettingArchiveError、settingArchiveName、buildSettingArchive、parseSettingArchive、SettingArchiveResult、applySettingArchive
 * 边界：只处理聊天领域的数据、状态转换与提示词装配；不直接渲染视图，不发起职责外的网络请求。
 * ========================================================================== */

import {
  CHARACTER_CARD_MAX,
  WORLDBOOK_MAX,
  normalizeCharacterCards,
  normalizeScene,
  normalizeWorldbook,
  type CharacterCard,
  type SceneState,
  type WorldbookEntry,
} from './roleplay.js'
import {
  characterProfileHasContent,
  normalizeCharacterProfile,
  type CharacterProfile,
} from './characterProfile.js'

/* ---- 01 类型、契约与依赖 ---- */
/**
 * 设定存档：把基础档案、角色卡、卡头像、世界书与场景打成一个 JSON 文件。
 * 与记忆归档分离——设定属于模板，换机或分享设定时单独迁移，不随对话导出。
 */
export const SETTING_ARCHIVE_FORMAT = 'deepseek-replica-settings'
export const SETTING_ARCHIVE_VERSION = 1
const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/

export type SettingArchive = {
  format: string
  version: number
  exportedAt: string
  /** 手写角色基础档案；旧版存档没有这一项，导入时按空档案处理 */
  profile?: CharacterProfile
  /** 档案是否进入 system；旧版存档没有这一项，按开启处理 */
  profileEnabled?: boolean
  cards: CharacterCard[]
  avatars: Record<string, string>
  worldbook: WorldbookEntry[]
  /** 场景快照：导出时取当前打开会话；恢复时写回当前会话，没有会话则不写入 */
  scene: SceneState
}

export type SettingArchiveInput = {
  profile: CharacterProfile
  profileEnabled: boolean
  cards: CharacterCard[]
  avatars: Record<string, string>
  worldbook: WorldbookEntry[]
  scene: SceneState
}

export type SettingArchiveErrorCode = 'json' | 'format' | 'version' | 'empty' | 'write'

export class SettingArchiveError extends Error {
  code: SettingArchiveErrorCode

  constructor(code: SettingArchiveErrorCode) {
    super(code)
    this.code = code
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** 文件名带导出时间与卡片数，便于区分多次导出 */
export const settingArchiveName = (cards: number, at: Date = new Date()) =>
  `deepseek_settings-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(
    at.getHours()
  )}${pad(at.getMinutes())}-${cards}cards.json`

export const buildSettingArchive = (
  input: SettingArchiveInput,
  exportedAt = new Date()
): SettingArchive => ({
  format: SETTING_ARCHIVE_FORMAT,
  version: SETTING_ARCHIVE_VERSION,
  exportedAt: exportedAt.toISOString(),
  profile: input.profile,
  profileEnabled: input.profileEnabled,
  cards: input.cards,
  avatars: input.avatars,
  worldbook: input.worldbook,
  scene: input.scene,
})

const pickAvatars = (raw: unknown): Record<string, string> => {
  const result: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') {
    return result
  }
  for (const [cardId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof cardId !== 'string' || typeof value !== 'string') {
      continue
    }
    // 只接受本应用写入的图片数据，外部文件里的其它取值一律丢弃
    if (AVATAR_DATA_URL.test(value)) {
      result[cardId] = value
    }
  }
  return result
}

/* ---- 02 核心实现：parseSettingArchive、SettingArchiveResult、applySettingArchive ---- */
/** 解析并归一化外部存档；结构与版本不符时抛错，由调用方给出对应提示 */
export const parseSettingArchive = (raw: string): SettingArchive => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new SettingArchiveError('json')
  }
  if (!value || typeof value !== 'object') {
    throw new SettingArchiveError('json')
  }
  const record = value as Record<string, unknown>
  if (record.format !== SETTING_ARCHIVE_FORMAT) {
    throw new SettingArchiveError('format')
  }
  if (record.version !== SETTING_ARCHIVE_VERSION) {
    throw new SettingArchiveError('version')
  }
  const cards = normalizeCharacterCards(record.cards)
  const worldbook = normalizeWorldbook(record.worldbook)
  const profile = normalizeCharacterProfile(record.profile)
  if (cards.length === 0 && worldbook.length === 0 && !characterProfileHasContent(profile)) {
    throw new SettingArchiveError('empty')
  }
  return {
    format: SETTING_ARCHIVE_FORMAT,
    version: SETTING_ARCHIVE_VERSION,
    exportedAt: typeof record.exportedAt === 'string' ? record.exportedAt : '',
    profile,
    profileEnabled: record.profileEnabled !== false,
    cards,
    avatars: pickAvatars(record.avatars),
    worldbook,
    scene: normalizeScene(record.scene),
  }
}

export type SettingArchiveResult = {
  cards: number
  cardsSkipped: number
  worldbook: number
  worldbookSkipped: number
  avatars: number
  scene: boolean
  profile: boolean
}

/* ---- 03 对外入口与收尾 ---- */
/**
 * 合并导入：同 id 覆盖，新条目按剩余名额追加，超出上限的部分不导入并计数。
 * 逐条调用设置层的保存接口，保证内存状态与本地存储同时更新。
 */
export const applySettingArchive = (
  archive: SettingArchive,
  current: { cards: CharacterCard[]; worldbook: WorldbookEntry[] },
  api: {
    saveCard: (card: CharacterCard) => boolean
    saveAvatar: (cardId: string, avatar: string) => boolean
    saveEntry: (entry: WorldbookEntry) => boolean
    saveScene: (scene: SceneState) => boolean
    saveProfile: (profile: CharacterProfile) => void
    saveProfileEnabled: (enabled: boolean) => void
  }
): SettingArchiveResult => {
  const cardIds = new Set(current.cards.map((card) => card.id))
  const worldbookIds = new Set(current.worldbook.map((entry) => entry.id))
  let cardRoom = Math.max(0, CHARACTER_CARD_MAX - current.cards.length)
  let worldbookRoom = Math.max(0, WORLDBOOK_MAX - current.worldbook.length)
  let cards = 0
  let cardsSkipped = 0
  let worldbook = 0
  let worldbookSkipped = 0
  let avatars = 0

  for (const card of archive.cards) {
    if (!cardIds.has(card.id)) {
      if (cardRoom <= 0) {
        cardsSkipped++
        continue
      }
      cardRoom--
    }
    if (!api.saveCard(card)) {
      throw new SettingArchiveError('write')
    }
    cardIds.add(card.id)
    cards++
    const avatar = archive.avatars[card.id]
    if (avatar && api.saveAvatar(card.id, avatar)) {
      avatars++
    }
  }

  for (const entry of archive.worldbook) {
    if (!worldbookIds.has(entry.id)) {
      if (worldbookRoom <= 0) {
        worldbookSkipped++
        continue
      }
      worldbookRoom--
    }
    if (!api.saveEntry(entry)) {
      throw new SettingArchiveError('write')
    }
    worldbookIds.add(entry.id)
    worldbook++
  }

  const scene = api.saveScene(archive.scene)
  // 旧存档没有基础档案时保留当前手写内容，不用空值覆盖
  const profile = Boolean(archive.profile && characterProfileHasContent(archive.profile))
  if (profile && archive.profile) {
    api.saveProfile(archive.profile)
  }
  api.saveProfileEnabled(archive.profileEnabled !== false)
  return { cards, cardsSkipped, worldbook, worldbookSkipped, avatars, scene, profile }
}

/* ============================================================================
 * 功能区：会话与角色核心 / settingArchive 结束
 * ========================================================================== */
