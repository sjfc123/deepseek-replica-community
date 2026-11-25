/* ============================================================================
 * 功能区：会话与角色核心 / cardFormats 开始
 * 职责：cardFormats 服务实现，负责会话状态、角色档案、角色卡、世界书、记忆、上下文或草稿操作中的该子能力。
 * 导出：readCharacterFile、parseCharacterPayload、parseWorldbookPayload。
 * ========================================================================== */

import {
  findPlayStyle,
  findWorldbookAuthority,
  findWorldbookKind,
  newRoleplayId,
  normalizeKeywords,
  normalizeTags,
  WORLDBOOK_WEIGHT_DEFAULT,
  type CharacterCard,
  type WorldbookEntry,
} from './roleplay.js'

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const candidate = text(value)
    if (candidate) {
      return candidate
    }
  }
  return ''
}

const stringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => text(item)).filter(Boolean)
  }
  const raw = text(value)
  return raw
    ? raw
        .split(/[，,、;；|]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

const decodeBase64Utf8 = (value: string) => {
  const clean = value.replace(/\s+/g, '')
  const binary = atob(clean)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const parseJsonText = (value: string): unknown | null => {
  const raw = value.trim().replace(/^\uFEFF/, '')
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    try {
      return JSON.parse(decodeBase64Utf8(raw))
    } catch {
      return null
    }
  }
}

/** 读取 PNG tEXt / iTXt 中由 SillyTavern 写入的 chara 元数据。 */
const readPngCharacter = async (file: File): Promise<unknown | null> => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length < 16) {
    return null
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!signature.every((byte, index) => bytes[index] === byte)) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = new TextDecoder('latin1').decode(bytes.subarray(offset + 4, offset + 8))
    const start = offset + 8
    const end = start + length
    if (end > bytes.length) {
      break
    }
    if (type === 'tEXt' || type === 'iTXt') {
      const chunk = new TextDecoder('latin1').decode(bytes.subarray(start, end))
      const keywordEnd = chunk.indexOf('\0')
      if (keywordEnd < 0) {
        offset = end + 4
        continue
      }
      const keyword = chunk.slice(0, keywordEnd).toLowerCase()
      let payload = ''
      if (type === 'tEXt') {
        payload = chunk.slice(keywordEnd + 1)
      } else {
        const compressionFlag = chunk.charCodeAt(keywordEnd + 1)
        const compressionMethodEnd = keywordEnd + 3
        const languageEnd = chunk.indexOf('\0', compressionMethodEnd)
        const translatedEnd = chunk.indexOf('\0', languageEnd + 1)
        payload = chunk.slice(translatedEnd + 1)
        if (compressionFlag !== 0) {
          offset = end + 4
          continue
        }
      }
      if (keyword === 'chara' || keyword === 'ccv3' || keyword === 'character') {
        const parsed = parseJsonText(payload)
        if (parsed) {
          return parsed
        }
      }
    }
    offset = end + 4
  }
  return null
}

/** 读取角色卡文件：JSON 直接解析，PNG 读取 tEXt/iTXt 中的 chara 字段。 */
export const readCharacterFile = async (file: File): Promise<unknown | null> => {
  const name = file.name.toLowerCase()
  if (name.endsWith('.png') || file.type === 'image/png') {
    return readPngCharacter(file)
  }
  return parseJsonText(await file.text())
}

const toCard = (source: unknown): CharacterCard | null => {
  const outer = record(source)
  if (!outer) {
    return null
  }
  const data = record(outer.data) ?? record(outer.card) ?? outer
  const name = firstText(data.name, outer.name, data.char_name, outer.char_name).slice(0, 30)
  if (!name) {
    return null
  }
  const description = firstText(
    data.description,
    outer.description,
    data.char_persona,
    outer.char_persona,
    data.persona
  )
  const personality = firstText(data.personality, outer.personality)
  const scenario = firstText(
    data.scenario,
    outer.scenario,
    data.world_scenario,
    outer.world_scenario
  )
  const greeting = firstText(
    data.first_mes,
    outer.first_mes,
    data.char_greeting,
    outer.char_greeting,
    data.greeting,
    outer.greeting
  )
  const example = firstText(
    data.mes_example,
    outer.mes_example,
    data.example_dialogue,
    outer.example_dialogue
  )
  const creatorNotes = firstText(
    data.creator_notes,
    outer.creator_notes,
    data.creatorcomment,
    outer.creatorcomment
  )
  const systemPrompt = firstText(data.system_prompt, outer.system_prompt)
  const postInstruction = firstText(data.post_history_instructions, outer.post_history_instructions)
  const identity = description.slice(0, 1200)
  const systemDirective = [systemPrompt, postInstruction ? `后置指令：${postInstruction}` : '']
    .filter(Boolean)
    .join('\n')
  const creator = firstText(data.creator, outer.creator)
  return {
    id: newRoleplayId(),
    name,
    age: firstText(data.age, outer.age).slice(0, 80),
    gender: firstText(data.gender, outer.gender).slice(0, 40),
    pronouns: firstText(data.pronouns, outer.pronouns).slice(0, 20),
    species: firstText(data.species, outer.species, data.race, outer.race).slice(0, 40),
    height: firstText(data.height, outer.height).slice(0, 40),
    weight: firstText(data.weight, outer.weight).slice(0, 40),
    birthday: firstText(data.birthday, outer.birthday).slice(0, 40),
    occupation: firstText(data.occupation, outer.occupation, data.job, outer.job).slice(0, 80),
    residence: firstText(data.residence, outer.residence, data.home, outer.home).slice(0, 80),
    languages: firstText(data.languages, outer.languages, data.language, outer.language).slice(
      0,
      80
    ),
    favoriteFoods: firstText(
      data.favoriteFoods,
      outer.favoriteFoods,
      data.likes,
      outer.likes
    ).slice(0, 200),
    dislikedFoods: firstText(
      data.dislikedFoods,
      outer.dislikedFoods,
      data.dislikes,
      outer.dislikes
    ).slice(0, 200),
    favoriteDrinks: firstText(data.favoriteDrinks, outer.favoriteDrinks).slice(0, 200),
    hobbies: firstText(data.hobbies, outer.hobbies).slice(0, 200),
    dailyRoutine: firstText(data.dailyRoutine, outer.dailyRoutine).slice(0, 300),
    possessions: firstText(data.possessions, outer.possessions, data.items, outer.items).slice(
      0,
      200
    ),
    pet: firstText(data.pet, outer.pet).slice(0, 80),
    temperament: firstText(data.temperament, outer.temperament).slice(0, 300),
    values: firstText(data.values, outer.values).slice(0, 300),
    petPeeves: firstText(data.petPeeves, outer.petPeeves).slice(0, 200),
    boundaries: firstText(data.boundaries, outer.boundaries).slice(0, 300),
    cooperation: firstText(data.cooperation, outer.cooperation).slice(0, 300),
    identity,
    relationship: firstText(data.relationship, outer.relationship).slice(0, 800),
    style: personality.slice(0, 800),
    tics: firstText(data.tics, outer.tics).slice(0, 600),
    greeting: greeting.slice(0, 2000),
    notes: creatorNotes,
    genre: firstText(data.genre, outer.genre, data.category, outer.category).slice(0, 12),
    playStyle: findPlayStyle(firstText(data.play_style, outer.play_style)).key,
    scenario: scenario.slice(0, 3000),
    systemDirective: systemDirective.slice(0, 3000),
    appearance: firstText(data.appearance, outer.appearance).slice(0, 1000),
    background: firstText(data.background, outer.background, data.backstory, outer.backstory).slice(
      0,
      4000
    ),
    goal: firstText(data.goal, outer.goal, data.objective, outer.objective).slice(0, 1000),
    secret: firstText(data.secret, outer.secret).slice(0, 3000),
    speechExamples: example.slice(0, 6000),
    tags: normalizeTags(data.tags ?? outer.tags),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: `导入 · ${creator || '外部角色卡'}`.slice(0, 160),
  }
}

/** 解析单卡、角色卡数组与 character_book；返回可直接保存的卡与随卡世界书。 */
export const parseCharacterPayload = (
  payload: unknown
): Array<{
  card: CharacterCard
  worldbook: WorldbookEntry[]
}> => {
  const outer = record(payload)
  if (!outer) {
    return []
  }
  const cardsRaw = Array.isArray(outer.characters)
    ? outer.characters
    : Array.isArray(outer.cards)
      ? outer.cards
      : [payload]
  return cardsRaw
    .map((item) => {
      const itemRecord = record(item)
      if (!itemRecord) {
        return null
      }
      const book =
        record(itemRecord.character_book) ??
        record(itemRecord.characterBook) ??
        record(record(itemRecord.data)?.character_book) ??
        record(record(itemRecord.data)?.characterBook)
      const worldbook = book ? parseWorldbookPayload(book.entries ?? book) : []
      const card = toCard(item)
      if (!card) {
        return null
      }
      const bound = worldbook.map((entry) => ({ ...entry, cardId: card.id }))
      return { card, worldbook: bound }
    })
    .filter((item): item is { card: CharacterCard; worldbook: WorldbookEntry[] } => Boolean(item))
}

const toWorldbookEntry = (
  source: unknown,
  index: number,
  cardId: string
): WorldbookEntry | null => {
  const item = record(source)
  if (!item) {
    return null
  }
  const content = firstText(item.content, item.entry, item.text, item.description)
  if (!content) {
    return null
  }
  const title =
    firstText(item.title, item.comment, item.name, item.key).slice(0, 60) || `条目 ${index + 1}`
  const keys = stringList(item.keywords ?? item.keys ?? item.key)
  const weightRaw = Number(item.weight)
  const weight = Number.isFinite(weightRaw)
    ? Math.min(100, Math.max(0, Math.round(weightRaw)))
    : WORLDBOOK_WEIGHT_DEFAULT
  const position = firstText(item.position)
  const kind = findWorldbookKind(firstText(item.kind, item.category, item.type, item.group)).key
  const scope =
    firstText(item.scope) === 'session' || item.scanDepth === 'session' ? 'session' : 'recent'
  return {
    id: text(item.id) || newRoleplayId(),
    title,
    keywords: normalizeKeywords(keys),
    content,
    enabled: item.disable === true ? false : item.enabled !== false,
    always: item.constant === true || item.always === true,
    match: item.regex === true || item.match === 'regex' ? 'regex' : 'keyword',
    cardId: text(item.cardId) || cardId,
    weight,
    position:
      position.toLowerCase().includes('after') || item.position === 'tail' ? 'tail' : 'context',
    kind,
    authority: findWorldbookAuthority(firstText(item.authority, item.reliability)),
    scope,
    excludeKeywords: normalizeKeywords(
      stringList(item.excludeKeywords ?? item.exclude_keys ?? item.avoid)
    ),
    createdAt: Number(item.createdAt) || Date.now(),
    updatedAt: Number(item.updatedAt) || Date.now(),
  }
}

/** 解析世界书：兼容本应用、SillyTavern world info（entries 数组或对象键值）及角色卡 character_book。 */
export const parseWorldbookPayload = (payload: unknown, cardId = ''): WorldbookEntry[] => {
  const outer = record(payload)
  let list: unknown[] = []
  if (Array.isArray(payload)) {
    list = payload
  } else if (outer) {
    const data = record(outer.data)
    const entries =
      outer.entries ??
      data?.entries ??
      record(data?.character_book)?.entries ??
      record(data?.characterBook)?.entries ??
      record(outer.character_book)?.entries ??
      record(outer.characterBook)?.entries
    if (Array.isArray(entries)) {
      list = entries
    } else if (record(entries)) {
      list = Object.values(record(entries) ?? {})
    } else if (entryLike(outer)) {
      list = [payload]
    }
  }
  return list
    .map((item, index) => toWorldbookEntry(item, index, cardId))
    .filter((entry): entry is WorldbookEntry => Boolean(entry))
    .slice(0, 100)
}

const entryLike = (value: Record<string, unknown>) =>
  Boolean(value.content || value.entry || value.text || value.keys || value.key || value.keywords)

/* ============================================================================
 * 功能区：会话与角色核心 / cardFormats 结束
 * ========================================================================== */
