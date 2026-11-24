/* ============================================================================
 * 功能区：会话与角色核心 / settingArchive 开始
 * 职责：settingArchive 服务实现，负责会话状态、角色档案、角色卡、世界书、记忆、上下文或草稿操作中的该子能力。
 * 导出：SETTING_ARCHIVE_FORMAT、SETTING_ARCHIVE_VERSION、SettingArchive、SettingArchiveInput、SettingArchiveErrorCode、SettingArchiveError 等 13 个导出。
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

export type SettingArchivePreview = {
  cards: number
  newCards: number
  worldbook: number
  newWorldbook: number
  avatars: number
  /** 存档里是否带基础档案；旧版存档为 false */
  profile: boolean
  exportedAt: string
}

/** 导入前的预览：分出新卡、覆盖卡与超出上限的数量，导入动作与预览共用同一套判定 */
export const previewSettingArchive = (
  archive: SettingArchive,
  current: { cards: CharacterCard[]; worldbook: WorldbookEntry[] }
): SettingArchivePreview => {
  const cardIds = new Set(current.cards.map((card) => card.id))
  const newCards = archive.cards.filter((card) => !cardIds.has(card.id)).length
  const cardRoom = Math.max(0, CHARACTER_CARD_MAX - current.cards.length)
  const worldbookIds = new Set(current.worldbook.map((entry) => entry.id))
  const newWorldbook = archive.worldbook.filter((entry) => !worldbookIds.has(entry.id)).length
  const worldbookRoom = Math.max(0, WORLDBOOK_MAX - current.worldbook.length)
  return {
    cards: Math.min(archive.cards.length, cardRoom + (archive.cards.length - newCards)),
    newCards: Math.min(newCards, cardRoom),
    worldbook: Math.min(
      archive.worldbook.length,
      worldbookRoom + (archive.worldbook.length - newWorldbook)
    ),
    newWorldbook: Math.min(newWorldbook, worldbookRoom),
    avatars: Object.keys(archive.avatars).length,
    profile: Boolean(archive.profile && characterProfileHasContent(archive.profile)),
    exportedAt: archive.exportedAt,
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

/**
 * 合并导入：同 id 覆盖，新条目按剩余名额追加，超出上限的部分跳过并计数。
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
