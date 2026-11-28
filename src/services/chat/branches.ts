/* ============================================================================
 * 功能区：会话与角色核心 / branches · 消息分支
 * 职责：消息分支：版本构建、可见消息、追加、切换与可达节点；只处理分支图，不渲染消息。
 * 分区：01 类型、契约与依赖；
 *    02 核心实现：selectVersion、getReachableMessageIds、activateBranch；03 对外入口与收尾
 * 关联：依赖 services/chat/types；
 *    被 scripts/test-content-search、scripts/test-history-merge、components/memory/MemoryPanel、components/messages/BranchSwitcher 等 13 个模块 引用。
 * 导出：normalizeSession、getVisibleMessages、MessageVersions、buildMessageVersions、appendBranch、selectVersion、getReachableMessageIds、activateBranch
 * 边界：只处理聊天领域的数据、状态转换与提示词装配；不直接渲染视图，不发起职责外的网络请求。
 * ========================================================================== */

import type { Message, Session } from './types.js'

/* ---- 01 类型、契约与依赖 ---- */
/** 最近一次算出的可见路径：会话对象变化时重新计算，单条正文更新时只替换路径中对应的一端。 */
let pathCache: { session: Session; path: Message[] } | null = null
/** 将线性消息列表规范化为单分支，保留消息 ID、内容及时间。 */
export const normalizeSession = (session: Session): Session =>
  session.rootMessageId !== undefined
    ? session
    : {
        ...session,
        rootMessageId: session.messages[0]?.id ?? null,
        messages: session.messages.map((message, index, messages) => ({
          ...message,
          parentId: messages[index - 1]?.id ?? null,
          selectedChildId: messages[index + 1]?.id,
        })),
      }

/** 展示内容与请求上下文共用当前选中的分支路径。 */
export const getVisibleMessages = (session: Session): Message[] => {
  if (session.rootMessageId === undefined) {
    return session.messages
  }
  const cached = pathCache
  if (cached?.session === session) {
    return cached.path
  }
  // 流式输出每帧只替换最后一条消息：复用上一帧的路径，避免整段历史重建 Map。
  const previous = cached?.session
  if (
    previous &&
    previous.rootMessageId === session.rootMessageId &&
    previous.messages.length === session.messages.length
  ) {
    let changedIndex = -1
    let changedCount = 0
    for (let index = 0; index < session.messages.length; index++) {
      if (previous.messages[index] !== session.messages[index]) {
        changedIndex = index
        changedCount++
        if (changedCount > 1) {
          break
        }
      }
    }
    if (changedCount === 1 && changedIndex >= 0) {
      const before = previous.messages[changedIndex]
      const after = session.messages[changedIndex]
      const pathIndex = cached.path.findIndex((message) => message.id === before.id)
      if (
        pathIndex >= 0 &&
        before.parentId === after.parentId &&
        before.selectedChildId === after.selectedChildId
      ) {
        const path = cached.path.slice()
        path[pathIndex] = after
        pathCache = { session, path }
        return path
      }
      if (pathIndex < 0) {
        // 改动落在旁支：当前可见路径不受影响，原样复用。
        pathCache = { session, path: cached.path }
        return cached.path
      }
    }
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const path: Message[] = []
  let id = session.rootMessageId
  while (id) {
    const message = byId.get(id)
    if (!message) {
      break
    }
    path.push(message)
    byId.delete(id)
    id = message.selectedChildId ?? null
  }
  pathCache = { session, path }
  return path
}

/**
 * 判断两次消息数组是否只改了正文（没有增删、没有换父/换分支）。
 * 流式输出每帧只替换最后一条内容，此时版本表无需重建。
 */
export const isContentOnlyChange = (previous: Message[], next: Message[]): boolean => {
  if (previous.length !== next.length) {
    return false
  }
  let changed = -1
  for (let index = 0; index < next.length; index++) {
    if (previous[index] !== next[index]) {
      if (changed >= 0) {
        return false
      }
      changed = index
    }
  }
  if (changed < 0) {
    return true
  }
  const before = previous[changed]
  const after = next[changed]
  return before.parentId === after.parentId && before.selectedChildId === after.selectedChildId
}

export type MessageVersions = { ids: string[]; index: number }

/** 一次遍历收集兄弟版本；版本列表未变化时复用旧对象与索引，避免流式正文更新重绘历史消息。 */
export const buildMessageVersions = (
  session: Session,
  previous: ReadonlyMap<string, MessageVersions>
): ReadonlyMap<string, MessageVersions> => {
  const groups = new Map<string | null | undefined, string[]>()
  for (const message of session.messages) {
    const key = session.rootMessageId === undefined ? message.id : message.parentId
    const ids = groups.get(key)
    if (ids) {
      ids.push(message.id)
    } else {
      groups.set(key, [message.id])
    }
  }

  const versions = new Map<string, MessageVersions>()
  let unchanged = previous.size === session.messages.length
  for (const ids of groups.values()) {
    const cachedIds = previous.get(ids[0])?.ids
    const stableIds =
      cachedIds?.length === ids.length && ids.every((id, index) => id === cachedIds[index])
        ? cachedIds
        : ids
    ids.forEach((id, index) => {
      const cached = previous.get(id)
      const version =
        cached?.ids === stableIds && cached.index === index ? cached : { ids: stableIds, index }
      versions.set(id, version)
      if (version !== cached) {
        unchanged = false
      }
    })
  }
  return unchanged ? previous : versions
}

/** 新消息挂在指定父节点下，并选择新分支；原节点与其后续对话保持不变。 */
export const appendBranch = (
  original: Session,
  parentId: string | null,
  messages: Message[]
): Session => {
  const session = normalizeSession(original)
  const first = messages[0]
  if (!first) {
    return session
  }
  return {
    ...session,
    rootMessageId: parentId === null ? first.id : session.rootMessageId,
    messages: [
      ...session.messages.map((message) =>
        message.id === parentId ? { ...message, selectedChildId: first.id } : message
      ),
      ...messages.map((message, index) => ({
        ...message,
        parentId: messages[index - 1]?.id ?? parentId,
        selectedChildId: messages[index + 1]?.id,
      })),
    ],
  }
}

/* ---- 02 核心实现：selectVersion、getReachableMessageIds、activateBranch ---- */
/** 仅允许切换当前路径上某一节点的兄弟版本，恢复该版本已选中的后续分支。 */
export const selectVersion = (original: Session, messageId: string): Session => {
  const session = normalizeSession(original)
  const message = session.messages.find((item) => item.id === messageId)
  if (!message || !getVisibleMessages(session).some((item) => item.parentId === message.parentId)) {
    return original
  }
  return {
    ...session,
    rootMessageId: message.parentId === null ? message.id : session.rootMessageId,
    messages: session.messages.map((item) =>
      item.id === message.parentId ? { ...item, selectedChildId: message.id } : item
    ),
  }
}

/** 收集所有能沿 parentId 回到有效根节点的消息 ID，过滤孤立或成环的损坏节点。 */
export const getReachableMessageIds = (original: Session): Set<string> => {
  const session = normalizeSession(original)
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const memo = new Map<string, boolean>()
  const reachable = new Set<string>()

  const isReachable = (id: string): boolean => {
    const cached = memo.get(id)
    if (cached !== undefined) {
      return cached
    }
    const chain: string[] = []
    const visiting = new Set<string>()
    let currentId: string | null | undefined = id
    let valid = false

    while (currentId) {
      const known = memo.get(currentId)
      if (known !== undefined) {
        valid = known
        break
      }
      if (visiting.has(currentId)) {
        valid = false
        break
      }
      const message = byId.get(currentId)
      if (!message) {
        valid = false
        break
      }
      visiting.add(currentId)
      chain.push(currentId)
      if (message.parentId === null) {
        valid = true
        break
      }
      currentId = message.parentId
    }

    for (const itemId of chain) {
      memo.set(itemId, valid)
    }
    return valid
  }

  for (const message of session.messages) {
    if (isReachable(message.id)) {
      reachable.add(message.id)
    }
  }
  return reachable
}

/* ---- 03 对外入口与收尾 ---- */
/**
 * 激活通往目标消息（含非当前分支深层节点）的整条祖先路径，同时保留该节点下已选中的后续子分支。
 * 若目标消息已在当前可见路径上或无法从根到达，原样返回。
 */
export const activateBranch = (original: Session, messageId: string): Session => {
  const session = normalizeSession(original)
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const target = byId.get(messageId)
  if (!target) {
    return original
  }

  const desiredChild = new Map<string, string>()
  const visited = new Set<string>([target.id])
  let current = target
  while (current.parentId !== null) {
    const parentId = current.parentId
    if (!parentId || visited.has(parentId)) {
      return original
    }
    const parent = byId.get(parentId)
    if (!parent) {
      return original
    }
    visited.add(parent.id)
    desiredChild.set(parent.id, current.id)
    current = parent
  }

  const rootId = current.id
  let changed = session.rootMessageId !== rootId
  if (!changed) {
    for (const [parentId, childId] of desiredChild) {
      if (byId.get(parentId)?.selectedChildId !== childId) {
        changed = true
        break
      }
    }
  }
  if (!changed) {
    return original
  }

  return {
    ...session,
    rootMessageId: rootId,
    messages: session.messages.map((message) => {
      const nextChild = desiredChild.get(message.id)
      return nextChild !== undefined && message.selectedChildId !== nextChild
        ? { ...message, selectedChildId: nextChild }
        : message
    }),
  }
}

/* ============================================================================
 * 功能区：会话与角色核心 / branches 结束
 * ========================================================================== */
