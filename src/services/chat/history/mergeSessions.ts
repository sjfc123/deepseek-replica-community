/* ============================================================================
 * 功能区：历史归档 / mergeSessions 开始
 * 职责：mergeSessions 服务实现，负责历史归档的 ZIP 读写、结构校验、会话转换与导入导出中的该子能力。
 * 导出：MergeSessionOptions、MergeSessionResult、mergeSessions。
 * ========================================================================== */

import { createId } from '../../../utils/id.js'
import { getVisibleMessages, normalizeSession } from '../branches.js'
import type {
  AssistantMessage,
  FileAttachment,
  Message,
  ReplyBlock,
  Session,
  UserMessage,
} from '../types.js'

export type MergeSessionOptions = {
  fileTypes?: ReadonlyMap<string, string>
  createMessageId?: () => string
}

export type MergeSessionResult = {
  session: Session
  changed: boolean
  addedMessages: number
  updatedMessages: number
}

type StatusBucket = 'done' | 'refusal' | 'incomplete' | 'error'

const STATUS_RANK: Record<StatusBucket, number> = {
  done: 4,
  refusal: 3,
  incomplete: 2,
  error: 1,
}

type CanonicalUser = {
  role: 'user'
  createdAt: number
  content: string
  filesKey: string
}

type CanonicalAssistant = {
  role: 'assistant'
  createdAt: number
  text: string
  thinking: string
  templates: string
  hasTemplate: boolean
  canSynthesizeTemplate: boolean
  tools: string[]
  statusBucket: StatusBucket
}

const isHttpUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const getStatusBucket = (message: AssistantMessage): StatusBucket => {
  if (message.stopReason === 'refusal') {
    return 'refusal'
  }
  if (message.status === 'error') {
    return 'error'
  }
  if (message.status === 'done' && message.stopReason !== 'max_tokens') {
    return 'done'
  }
  return 'incomplete'
}

/** 提取对导出/导入往返保持不变的工具调用规范表示（与 toArchive / toLocal 语义一致）。 */
const canonicalTools = (blocks: ReplyBlock[]): string[] => {
  const results = new Map<string, ReplyBlock>()
  for (const block of blocks) {
    if (block.type === 'web_search_tool_result' || block.type === 'web_fetch_tool_result') {
      results.set(block.tool_use_id, block)
    }
  }
  const tools: string[] = []
  for (const block of blocks) {
    if (block.type !== 'server_tool_use') {
      continue
    }
    const result = results.get(block.id)
    const { input } = block
    if (input.action === 'search') {
      const items = result?.type === 'web_search_tool_result' ? result.content : []
      const status =
        result?.type !== 'web_search_tool_result'
          ? 'WIP'
          : items.some((item) => item.type === 'web_search_tool_result_error')
            ? 'FAILED'
            : 'FINISHED'
      const urls =
        status === 'FINISHED'
          ? items.flatMap((item) =>
              item.type === 'web_search_result' && isHttpUrl(item.url) ? [item.url] : []
            )
          : []
      tools.push(`search:${JSON.stringify(input.queries)}:${status}:${JSON.stringify(urls)}`)
      continue
    }
    if (input.action === 'read_link') {
      if (
        result?.type === 'web_fetch_tool_result' &&
        result.kind === 'read_link' &&
        result.content.type === 'web_fetch_result' &&
        result.signature?.trim()
      ) {
        const rawUrl = result.content.url || input.url || ''
        const url = rawUrl && isHttpUrl(rawUrl) ? rawUrl : ''
        tools.push(`read_link:${url}:${result.signature}`)
      }
      continue
    }
    const content = result?.type === 'web_fetch_tool_result' ? result.content : undefined
    const page = content?.type === 'web_fetch_result' ? content : undefined
    const status = !content ? 'WIP' : page ? 'FINISHED' : 'FAILED'
    if (input.action === 'find_in_page') {
      tools.push(`find:${status}:${input.pattern ?? ''}`)
      continue
    }
    const rawUrl = input.url || page?.url || ''
    if (rawUrl && isHttpUrl(rawUrl)) {
      tools.push(`open:${status}:${rawUrl}`)
    }
  }
  return tools
}

const canonicalUser = (message: UserMessage): CanonicalUser => ({
  role: 'user',
  createdAt: message.createdAt,
  content: message.content,
  filesKey: JSON.stringify(
    message.files.map((file) => [file.id, file.name, file.size, file.isImage])
  ),
})

const canonicalAssistant = (message: AssistantMessage): CanonicalAssistant => {
  const { blocks } = message
  const refused = message.stopReason === 'refusal'
  const usedWeb = blocks.some((block) => block.type === 'server_tool_use')
  let text = ''
  let thinking = ''
  let templates = ''
  let hasTemplate = false

  for (const block of blocks) {
    if (block.type === 'text') {
      const normalized = usedWeb ? block.text.replace(/\[citation:\d+\]/g, '') : block.text
      if (block.isTemplate) {
        hasTemplate = true
        templates += normalized
      } else if (!refused) {
        text += normalized
      }
    } else if (block.type === 'thinking' && !refused && block.thinking) {
      thinking += block.thinking
    }
  }

  return {
    role: 'assistant',
    createdAt: message.createdAt,
    text,
    thinking,
    templates,
    hasTemplate,
    canSynthesizeTemplate: Boolean(
      (message.status === 'error' && message.error) || (!hasTemplate && refused)
    ),
    tools: canonicalTools(blocks),
    statusBucket: getStatusBucket(message),
  }
}

const canonicalMatch = (
  a: CanonicalUser | CanonicalAssistant,
  b: CanonicalUser | CanonicalAssistant
): boolean => {
  if (a.role !== b.role || a.createdAt !== b.createdAt) {
    return false
  }
  if (a.role === 'user' && b.role === 'user') {
    return a.content === b.content && a.filesKey === b.filesKey
  }
  if (a.role === 'assistant' && b.role === 'assistant') {
    if (
      a.text !== b.text ||
      a.thinking !== b.thinking ||
      a.statusBucket !== b.statusBucket ||
      a.tools.length !== b.tools.length ||
      a.tools.some((tool, index) => tool !== b.tools[index])
    ) {
      return false
    }
    // 导出 error/refusal 时自动生成当前界面的 TEMPLATE_RESPONSE；仅在本地原文与导出模板对等比较时放宽模板文本差异。
    if (a.canSynthesizeTemplate !== b.canSynthesizeTemplate) {
      return true
    }
    return a.templates === b.templates
  }
  return false
}

/** 仅允许未完成或出错中的同时间点回复向更完整快照演化；已完成或被拒绝回复不再就地膨胀。 */
const isSubsumedBy = (older: CanonicalAssistant, newer: CanonicalAssistant): boolean => {
  if (older.statusBucket !== 'incomplete' && older.statusBucket !== 'error') {
    return false
  }
  if (!newer.text.startsWith(older.text) || !newer.thinking.startsWith(older.thinking)) {
    return false
  }
  if (
    older.tools.length > newer.tools.length ||
    older.tools.some((tool, index) => tool !== newer.tools[index])
  ) {
    return false
  }
  return (
    newer.text.length > older.text.length ||
    newer.thinking.length > older.thinking.length ||
    newer.tools.length > older.tools.length ||
    STATUS_RANK[newer.statusBucket] > STATUS_RANK[older.statusBucket]
  )
}

const buildChildrenIndex = (messages: Message[]): Map<string | null, Message[]> => {
  const children = new Map<string | null, Message[]>()
  for (const message of messages) {
    const parentId = message.parentId ?? null
    const list = children.get(parentId)
    if (list) {
      list.push(message)
    } else {
      children.set(parentId, [message])
    }
  }
  return children
}

const backfillFileTypes = (
  files: FileAttachment[],
  incomingFiles?: FileAttachment[],
  fileTypes?: ReadonlyMap<string, string>
): { files: FileAttachment[]; changed: boolean } => {
  let changed = false
  const nextFiles = files.map((file, index) => {
    if (file.mimeType) {
      return file
    }
    const candidate = incomingFiles?.[index]?.mimeType || fileTypes?.get(file.id) || ''
    if (!candidate) {
      return file
    }
    changed = true
    return { ...file, mimeType: candidate }
  })
  return { files: changed ? nextFiles : files, changed }
}

const cloneMessage = (message: Message): Message =>
  message.role === 'user'
    ? { ...message, files: message.files.map((file) => ({ ...file })) }
    : { ...message, blocks: message.blocks.slice() }

/**
 * 以导出往返不变的语义深度合并同一会话：
 * - 完全匹配的节点保留本地 ID 与独有元数据（模型、用量、思考签名、citations、latestReminder 等）；
 * - 同一未完成/失败节点出现更完整快照时就地升级；
 * - 分叉子树或新增根消息以兄弟分支挂载，避免 ID 冲突；
 * - 栈安全迭代实现，支持数千轮长对话；绝不原地修改输入对象。
 */
export const mergeSessions = (
  localInput: Session,
  incomingInput: Session,
  options?: MergeSessionOptions
): MergeSessionResult => {
  const fileTypes = options?.fileTypes
  const nextId = options?.createMessageId ?? createId

  const local = normalizeSession(localInput)
  const incoming = normalizeSession(incomingInput)

  const createdAt = Math.min(local.createdAt, incoming.createdAt)
  const updatedAt = Math.max(local.updatedAt, incoming.updatedAt)
  let title = local.title
  if (!local.title && incoming.title) {
    title = incoming.title
  } else if (local.title && incoming.title && local.title !== incoming.title) {
    title = incoming.updatedAt > local.updatedAt ? incoming.title : local.title
  }

  let changed =
    createdAt !== localInput.createdAt ||
    updatedAt !== localInput.updatedAt ||
    title !== localInput.title
  let addedMessages = 0
  let updatedMessages = 0
  let localContentMutated = false

  const localChildren = buildChildrenIndex(local.messages)
  const incomingChildren = buildChildrenIndex(incoming.messages)

  const usedIds = new Set(local.messages.map((message) => message.id))
  const mergedById = new Map<string, Message>()
  const originalSelected = new Map<string, string | undefined>()
  for (const message of local.messages) {
    mergedById.set(message.id, cloneMessage(message))
    originalSelected.set(message.id, message.selectedChildId)
  }

  const incomingToMergedId = new Map<string, string>()
  const incomingById = new Map(incoming.messages.map((message) => [message.id, message]))
  const appendedMessages: Message[] = []
  const appendedIds = new Set<string>()

  const canonicalCache = new WeakMap<Message, CanonicalUser | CanonicalAssistant>()
  const getCanonical = (message: Message) => {
    const cached = canonicalCache.get(message)
    if (cached) {
      return cached
    }
    const computed = message.role === 'user' ? canonicalUser(message) : canonicalAssistant(message)
    canonicalCache.set(message, computed)
    return computed
  }

  const graftSubtree = (incomingRoot: Message, targetParentId: string | null) => {
    const grafted: Array<{ incoming: Message; merged: Message }> = []
    const stack: Array<{ node: Message; parentId: string | null }> = [
      { node: incomingRoot, parentId: targetParentId },
    ]
    const visited = new Set<string>()
    while (stack.length > 0) {
      const entry = stack.pop()
      if (!entry) {
        continue
      }
      const { node, parentId } = entry
      if (visited.has(node.id)) {
        continue
      }
      visited.add(node.id)
      let mergedId = node.id
      if (usedIds.has(mergedId)) {
        do {
          mergedId = nextId()
        } while (usedIds.has(mergedId))
      }
      usedIds.add(mergedId)
      incomingToMergedId.set(node.id, mergedId)

      let cloned: Message
      if (node.role === 'user') {
        const { files } = backfillFileTypes(node.files, undefined, fileTypes)
        cloned = { ...node, id: mergedId, parentId, selectedChildId: undefined, files }
      } else {
        cloned = {
          ...node,
          id: mergedId,
          parentId,
          selectedChildId: undefined,
          blocks: node.blocks.slice(),
        }
      }
      mergedById.set(mergedId, cloned)
      appendedMessages.push(cloned)
      appendedIds.add(mergedId)
      grafted.push({ incoming: node, merged: cloned })
      addedMessages += 1
      changed = true

      const children = incomingChildren.get(node.id)
      if (children) {
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push({ node: children[i], parentId: mergedId })
        }
      }
    }
    for (const item of grafted) {
      if (item.incoming.selectedChildId !== undefined) {
        const mappedChild = incomingToMergedId.get(item.incoming.selectedChildId)
        if (mappedChild) {
          item.merged.selectedChildId = mappedChild
        }
      }
    }
  }

  // 显式队列自顶向下对齐共同前缀（防深层会话递归爆栈）。
  const pairQueue: Array<{ localParentId: string | null; incomingParentId: string | null }> = [
    { localParentId: null, incomingParentId: null },
  ]
  const visitedIncomingParents = new Set<string | null>()
  for (let head = 0; head < pairQueue.length; head++) {
    const { localParentId, incomingParentId } = pairQueue[head]
    if (visitedIncomingParents.has(incomingParentId)) {
      continue
    }
    visitedIncomingParents.add(incomingParentId)

    const inList = incomingChildren.get(incomingParentId) ?? []
    const locList = localChildren.get(localParentId) ?? []
    const matchedLocalIds = new Set<string>()

    for (const inChild of inList) {
      const inCanon = getCanonical(inChild)

      // Tier 1：导出往返不变的语义精确匹配
      let matchedLocal: Message | undefined
      for (const locChild of locList) {
        if (matchedLocalIds.has(locChild.id)) {
          continue
        }
        if (canonicalMatch(getCanonical(locChild), inCanon)) {
          matchedLocal = locChild
          break
        }
      }

      if (matchedLocal) {
        matchedLocalIds.add(matchedLocal.id)
        incomingToMergedId.set(inChild.id, matchedLocal.id)
        if (matchedLocal.role === 'user' && inChild.role === 'user') {
          const target = mergedById.get(matchedLocal.id) as UserMessage
          const { files, changed: mimeBackfilled } = backfillFileTypes(
            target.files,
            inChild.files,
            fileTypes
          )
          if (mimeBackfilled) {
            target.files = files
            changed = true
            updatedMessages += 1
          }
        }
        pairQueue.push({ localParentId: matchedLocal.id, incomingParentId: inChild.id })
        continue
      }

      // Tier 2：同一回复从中断/错误态向更完整快照演化
      if (inChild.role === 'assistant' && inCanon.role === 'assistant') {
        let evolvedLocal: AssistantMessage | undefined
        let upgradeWithIncoming = false
        for (const locChild of locList) {
          if (matchedLocalIds.has(locChild.id) || locChild.role !== 'assistant') {
            continue
          }
          if (locChild.createdAt !== inChild.createdAt) {
            continue
          }
          const locCanon = getCanonical(locChild) as CanonicalAssistant
          if (isSubsumedBy(locCanon, inCanon)) {
            evolvedLocal = locChild
            upgradeWithIncoming = true
            break
          }
          if (isSubsumedBy(inCanon, locCanon)) {
            evolvedLocal = locChild
            upgradeWithIncoming = false
            break
          }
        }

        if (evolvedLocal) {
          matchedLocalIds.add(evolvedLocal.id)
          incomingToMergedId.set(inChild.id, evolvedLocal.id)
          if (upgradeWithIncoming) {
            const target = mergedById.get(evolvedLocal.id) as AssistantMessage
            mergedById.set(evolvedLocal.id, {
              ...target,
              model: target.model ?? inChild.model,
              latestReminder: target.latestReminder ?? inChild.latestReminder,
              thinking: inChild.thinking,
              search: inChild.search,
              status: inChild.status,
              stopReason: inChild.stopReason,
              stopDetails: inChild.stopDetails,
              blocks: inChild.blocks.slice(),
              ...(inChild.status === 'error' ? { error: inChild.error } : { error: undefined }),
            })
            changed = true
            updatedMessages += 1
            localContentMutated = true
          }
          pairQueue.push({ localParentId: evolvedLocal.id, incomingParentId: inChild.id })
          continue
        }
      }

      // Tier 3：未匹配，整体嫁接为新的兄弟分支或新根节点
      graftSubtree(inChild, localParentId)
    }
  }

  // 解析当前选中分支（rootMessageId 与 selectedChildId）
  const localVisible = getVisibleMessages(local)
  const incomingVisible = getVisibleMessages(incoming)
  const localLeafId = localVisible.at(-1)?.id
  const mappedIncomingVisible = incomingVisible
    .map((message) => incomingToMergedId.get(message.id))
    .filter((id): id is string => Boolean(id))
  const mappedIncomingLeafId = mappedIncomingVisible.at(-1)

  const isAncestor = (ancestorId: string, descendantId: string): boolean => {
    let cursor: string | null | undefined = descendantId
    const visited = new Set<string>()
    while (cursor && !visited.has(cursor)) {
      if (cursor === ancestorId) {
        return true
      }
      visited.add(cursor)
      cursor = mergedById.get(cursor)?.parentId
    }
    return false
  }

  let selectIncomingPath = false
  if (localLeafId === undefined) {
    selectIncomingPath = mappedIncomingLeafId !== undefined
  } else if (mappedIncomingLeafId !== undefined && mappedIncomingLeafId !== localLeafId) {
    if (isAncestor(localLeafId, mappedIncomingLeafId)) {
      selectIncomingPath = true
    } else if (isAncestor(mappedIncomingLeafId, localLeafId)) {
      selectIncomingPath = false
    } else {
      selectIncomingPath = incoming.updatedAt > local.updatedAt
    }
  }

  let rootMessageId = local.rootMessageId
  if (selectIncomingPath && mappedIncomingVisible.length > 0) {
    if (rootMessageId !== mappedIncomingVisible[0]) {
      rootMessageId = mappedIncomingVisible[0]
      changed = true
    }
    for (let i = 0; i < mappedIncomingVisible.length - 1; i++) {
      const node = mergedById.get(mappedIncomingVisible[i])
      const next = mappedIncomingVisible[i + 1]
      if (node && node.selectedChildId !== next) {
        node.selectedChildId = next
      }
    }
    const incomingLeaf = mappedIncomingLeafId ? mergedById.get(mappedIncomingLeafId) : undefined
    if (incomingLeaf && incomingVisible.at(-1)?.selectedChildId === undefined) {
      incomingLeaf.selectedChildId = undefined
    }
  }

  // 对未在当前可见路径上的已匹配节点，若本地原本没有选中子分支而导入包有，则顺手补全其默认子分支指针
  const localVisibleIds = new Set(localVisible.map((message) => message.id))
  for (const [inId, mergedId] of incomingToMergedId) {
    if (appendedIds.has(mergedId) || localVisibleIds.has(mergedId)) {
      continue
    }
    const localNode = mergedById.get(mergedId)
    const inNode = incomingById.get(inId)
    if (!localNode || !inNode) {
      continue
    }
    if (localNode.selectedChildId === undefined && inNode.selectedChildId !== undefined) {
      const mappedChild = incomingToMergedId.get(inNode.selectedChildId)
      if (mappedChild) {
        localNode.selectedChildId = mappedChild
      }
    }
  }

  for (const message of local.messages) {
    const updated = mergedById.get(message.id)
    if (updated && updated.selectedChildId !== originalSelected.get(message.id)) {
      changed = true
    }
  }

  if (!changed) {
    return { session: localInput, changed: false, addedMessages: 0, updatedMessages: 0 }
  }

  const messages: Message[] = [
    ...local.messages.map((message) => mergedById.get(message.id) ?? message),
    ...appendedMessages,
  ]

  const mergedSession: Session = {
    id: local.id,
    title,
    createdAt,
    updatedAt,
    messages,
    rootMessageId,
    ...(localContentMutated || !local.contextCheckpoints
      ? {}
      : { contextCheckpoints: local.contextCheckpoints }),
  }

  return { session: mergedSession, changed: true, addedMessages, updatedMessages }
}

/* ============================================================================
 * 功能区：历史归档 / mergeSessions 结束
 * ========================================================================== */
