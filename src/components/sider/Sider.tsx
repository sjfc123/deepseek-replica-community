/* ============================================================================
 * 功能区：视图与交互 / Sider · 侧栏
 * 职责：侧栏：会话列表、分组、搜索、多选、抽屉手势与移动端壳。
 * 分区：01 类型、常量与模块依赖；02 桌面侧栏；03 功能实现（Sider）；04 核心实现；05 移动端侧栏
 * 关联：依赖 app/android、app/viewport、components/base/IconButton、components/base/icons 等 18 个模块；
 *    被 app/App 引用。
 * 导出：Sider、MobileSider
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import clsx from 'clsx'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { android, saveAndroidHistory } from '../../app/android.js'
import { useIsAndroidWide } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import {
  IconPanelLeftOutline16,
  IconPinOutline16,
  IconSearchOutline16,
  IconCloseOutline16,
  IconEllipsisOutline16,
  IconTrashOutline16,
  NewChatIcon,
} from '../base/icons.js'
import {
  assignSessionFolder,
  createSessionFolder,
  removeSessionFolder,
  setPinnedSessions,
  setSessionArchived,
  setSiderCollapsed,
  useSettings,
} from '../../services/settings.js'
import { groupSessionsByCharacter, type SessionSection } from '../../services/chat/sessionGroups.js'
import { forkSession, newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import {
  buildSessionBundle,
  sessionBundleName,
  sessionBundleToMarkdown,
} from '../../services/chat/sessionBundle.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { showToast } from '../base/toastState.js'
import { ProfileAvatar } from '../settings/ProfileAvatar.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, openDrawerSearch, useMobileSider } from './mobileSiderState.js'
import { AndroidContentSearch } from './AndroidContentSearch.js'
import { SessionActionDialog } from './SessionActionDialog.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/* ---- 01 类型、常量与模块依赖 ---- */
const ROW_OVERSCAN = 10
const COLLAPSED_SESSION_GROUPS_KEY = 'replica:collapsed-session-groups'

/** 折叠状态只保存在本机；损坏或旧格式直接按全部展开处理。 */
const readCollapsedSessionGroups = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COLLAPSED_SESSION_GROUPS_KEY) ?? '[]')
    return new Set(
      Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    )
  } catch {
    return new Set<string>()
  }
}

/** 创建分支的三步：命名 → 是否分组 → 选择分组；分支在命名确认后就已经落盘 */
type ForkFlow = {
  target: SessionSummary
  step: 'name' | 'groupAsk' | 'groupPick'
  branchId: string | null
  branchTitle: string
}

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
/* ---- 02 桌面侧栏 ---- */
const SessionSectionHeader = ({
  group,
  collapsed,
  ariaLabel,
  onToggle,
  onPressStart,
  onPressMove,
  onPressEnd,
  onContextMenu,
}: {
  group: SessionSection
  collapsed: boolean
  ariaLabel: string
  onToggle: (group: SessionSection) => void
  onPressStart: (event: ReactPointerEvent<HTMLButtonElement>, group: SessionSection) => void
  onPressMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPressEnd: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, group: SessionSection) => void
}) => {
  const button = (
    <button
      type="button"
      className={clsx(
        styles.sectionHeader,
        group.parentKey && styles.characterHeader,
        group.kind === 'normal' && styles.normalHeader
      )}
      aria-expanded={!collapsed}
      aria-label={ariaLabel}
      onClick={() => onToggle(group)}
      onPointerDown={(event) => onPressStart(event, group)}
      onPointerMove={onPressMove}
      onPointerUp={onPressEnd}
      onPointerLeave={onPressEnd}
      onPointerCancel={onPressEnd}
      onContextMenu={(event) => onContextMenu(event, group)}
    >
      <span
        className={styles.sectionChevron}
        data-collapsed={collapsed || undefined}
        aria-hidden="true"
      />
      <span className={styles.sectionLabel}>{group.label}</span>
      <span className={styles.sectionCount} aria-hidden="true">
        {group.total}
      </span>
    </button>
  )
  // 时间父组吸顶，子组保持普通行内标题；整条背景只铺在时间标签下，避免滚动时文字从标签两侧穿出。
  return group.parentKey ? (
    button
  ) : (
    <div className={styles.sectionHeaderBar}>{button}</div>
  )
}

/* ---- 03 功能实现（Sider） ---- */
export const Sider = memo(function Sider({ mobile = false }: { mobile?: boolean }) {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const pinnedIds = useSettings((state) => state.pinnedSessions)
  const folders = useSettings((state) => state.sessionFolders)
  const folderMap = useSettings((state) => state.sessionFolderMap)
  const archivedIds = useSettings((state) => state.archivedSessions)
  const characterCards = useSettings((state) => state.characterCards)
  const profile = useSettings((state) => state.accountProfile)
  const username = profile.username || t('profileDefaultUsername')
  const androidDrawer = Boolean(mobile && android)
  const searchOpen = useMobileSider((state) => state.searchOpen)
  const showAndroidSearch = Boolean(androidDrawer && searchOpen)
  const [now, setNow] = useState(Date.now)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(readCollapsedSessionGroups)
  const [selecting, setSelecting] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [rangeMode, setRangeMode] = useState(false)
  const [rangeAnchorId, setRangeAnchorId] = useState<string | null>(null)
  const [groupDelete, setGroupDelete] = useState<{
    group: SessionSection
    sessions: SessionSummary[]
    roleSessions: SessionSummary[]
  } | null>(null)
  const [pinning, setPinning] = useState<{ ids: Set<string>; unpin: boolean } | null>(null)
  /** 分组筛选：'' 全部、'__none' 未分组，其余为分组 id */
  const [folderFilter, setFolderFilter] = useState('')
  /** 归档默认隐藏：点开后才和普通会话一起列出 */
  const [showArchived, setShowArchived] = useState(false)
  /** 更多操作默认收起，点开在分组条下方展开 */
  const [toolsOpen, setToolsOpen] = useState(false)
  const [folderTarget, setFolderTarget] = useState<SessionSummary | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [forkFlow, setForkFlow] = useState<ForkFlow | null>(null)
  const [forkName, setForkName] = useState('')
  const [newFolderAssign, setNewFolderAssign] = useState<{
    sessionId: string
    branchName: string
  } | null>(null)
  const [bulkFolderOpen, setBulkFolderOpen] = useState(false)
  const [bulkConfirm, setBulkConfirm] = useState<'copy' | 'archive' | null>(null)
  const newFolderInput = useRef<HTMLInputElement>(null)
  const forkNameInput = useRef<HTMLInputElement>(null)
  const groupPressTimer = useRef<number | undefined>(undefined)
  const groupPressStart = useRef({ x: 0, y: 0 })
  const groupPressFired = useRef(false)
  const unpin = checked.size > 0 && [...checked].every((id) => pinnedIds.includes(id))
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    try {
      window.localStorage.setItem(
        COLLAPSED_SESSION_GROUPS_KEY,
        JSON.stringify([...collapsedGroups])
      )
    } catch {
      // 隐私模式或存储已满时保持内存状态，不阻断会话列表。
    }
  }, [collapsedGroups])
  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])
  /** 分组与归档只影响这里，后面的虚拟列表按过滤结果算偏移 */
  const visibleSessions = useMemo(() => {
    const archived = new Set(archivedIds)
    return sessions.filter((session) => {
      if (!showArchived && archived.has(session.id)) {
        return false
      }
      if (folderFilter === '__none') {
        return !folderMap[session.id]
      }
      if (folderFilter) {
        return folderMap[session.id] === folderFilter
      }
      return true
    })
  }, [sessions, archivedIds, showArchived, folderFilter, folderMap])
  const groups = useMemo(() => {
    const characterNameFor = (id: string) =>
      characterCards.find((card) => card.id === id)?.name.trim() || undefined
    if (!androidDrawer || pinnedIds.length === 0) {
      return groupSessionsByCharacter(visibleSessions, now, t, characterNameFor)
    }
    const pinned = visibleSessions.filter((session) => pinnedIds.includes(session.id))
    const rest = groupSessionsByCharacter(
      visibleSessions.filter((session) => !pinnedIds.includes(session.id)),
      now,
      t,
      characterNameFor
    )
    return pinned.length
      ? [
          {
            key: 'pinned',
            label: t('androidPinned'),
            sessions: pinned,
            total: pinned.length,
            kind: 'time' as const,
          },
          ...rest,
        ]
      : rest
  }, [androidDrawer, visibleSessions, now, pinnedIds, t, characterCards])
  const listRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 720 })
  const rowHeight = androidDrawer ? (selecting ? 48 : 44.8) : mobile ? 44 : 40
  /** 时间父组折叠时直接移除其子组，避免虚拟列表继续为不可见行留位置。 */
  const visibleGroups = useMemo(
    () => groups.filter((group) => !group.parentKey || !collapsedGroups.has(group.parentKey)),
    [groups, collapsedGroups]
  )
  /** 批量全选与范围选择只取当前可见、且没有折叠的会话，避免把隐藏的归档一并删掉。 */
  const selectableSessions = useMemo(() => {
    const seen = new Set<string>()
    const result: SessionSummary[] = []
    for (const group of visibleGroups) {
      if (collapsedGroups.has(group.key)) {
        continue
      }
      for (const session of group.sessions) {
        if (!seen.has(session.id)) {
          seen.add(session.id)
          result.push(session)
        }
      }
    }
    return result
  }, [collapsedGroups, visibleGroups])
  /** 时间父组本身不放会话行，删除时要连同普通子组与各角色子组一起收集。 */
  const collectGroupSessions = useCallback(
    (group: SessionSection) => {
      const children = group.parentKey
        ? []
        : groups.filter((item) => item.parentKey === group.key)
      const source = children.length
        ? children.flatMap((item) => item.sessions)
        : group.sessions
      const seen = new Set<string>()
      return source.filter((session) => {
        if (seen.has(session.id)) {
          return false
        }
        seen.add(session.id)
        return true
      })
    },
    [groups]
  )
  const clearGroupPress = useCallback(() => {
    window.clearTimeout(groupPressTimer.current)
    groupPressTimer.current = undefined
  }, [])
  useEffect(() => clearGroupPress, [clearGroupPress])
  const openGroupDelete = useCallback(
    (group: SessionSection) => {
      if (group.key === 'pinned') {
        return
      }
      const targets = collectGroupSessions(group)
      if (targets.length === 0) {
        return
      }
      setGroupDelete({
        group,
        sessions: targets,
        roleSessions: targets.filter((session) => Boolean(session.characterId)),
      })
      setPinning(null)
      setSelecting(false)
      setChecked(new Set())
      setRangeAnchorId(null)
    },
    [collectGroupSessions]
  )
  const startGroupPress = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, group: SessionSection) => {
      if (group.key === 'pinned' || (event.pointerType === 'mouse' && event.button !== 0)) {
        return
      }
      clearGroupPress()
      groupPressFired.current = false
      groupPressStart.current = { x: event.clientX, y: event.clientY }
      groupPressTimer.current = window.setTimeout(() => {
        groupPressFired.current = true
        openGroupDelete(group)
      }, 520)
    },
    [clearGroupPress, openGroupDelete]
  )
  const moveGroupPress = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!groupPressTimer.current) {
        return
      }
      const distance = Math.hypot(
        event.clientX - groupPressStart.current.x,
        event.clientY - groupPressStart.current.y
      )
      if (distance > 10) {
        clearGroupPress()
      }
    },
    [clearGroupPress]
  )
  const clickGroup = useCallback(
    (group: SessionSection) => {
      if (groupPressFired.current) {
        groupPressFired.current = false
        return
      }
      toggleGroup(group.key)
    },
    [toggleGroup]
  )
  const contextGroup = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, group: SessionSection) => {
      event.preventDefault()
      if (!android || groupPressFired.current || group.key === 'pinned') {
        return
      }
      clearGroupPress()
      groupPressFired.current = true
      openGroupDelete(group)
    },
    [clearGroupPress, openGroupDelete]
  )
  const positionedGroups = useMemo(() => {
    let end = 0
    return visibleGroups.map((group, index) => {
      const collapsed = collapsedGroups.has(group.key)
      const subgroup = Boolean(group.parentKey)
      // 子组是时间组内部的角色/普通分区：间距缩小，标题高度沿用同一行高。
      const top = androidDrawer
        ? end + (index ? 6.4 : 5.6889) + 22.4
        : end + (index ? (subgroup ? 6 : 16) : 0) + (subgroup ? 0 : 4) + (mobile ? 29 : 22)
      end = top + (collapsed ? 0 : group.sessions.length * rowHeight)
      if (group.key === 'pinned' && !collapsed) {
        end += 29
      }
      return { ...group, top, collapsed }
    })
  }, [androidDrawer, collapsedGroups, visibleGroups, mobile, rowHeight])
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) {
      return
    }
    const bucketSize = rowHeight * 2
    let frame = 0
    const sync = () => {
      // 按两行高度量化滚动位置，避免 120Hz 滚动时每像素触发整个侧边栏重渲染。
      const top = Math.floor(list.scrollTop / bucketSize) * bucketSize
      const height = list.clientHeight
      setViewport((previous) =>
        previous.top === top && previous.height === height ? previous : { top, height }
      )
    }
    const schedule = () => {
      if (frame) {
        return
      }
      frame = requestAnimationFrame(() => {
        frame = 0
        sync()
      })
    }
    const observer = new ResizeObserver(sync)
    observer.observe(list)
    list.addEventListener('scroll', schedule, { passive: true })
    sync()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      list.removeEventListener('scroll', schedule)
    }
  }, [rowHeight, showAndroidSearch])
  const [deleting, setDeleting] = useState<SessionSummary[]>([])
  const deleteOne = useCallback((session: SessionSummary) => setDeleting([session]), [])
  const togglePinned = useCallback(
    (session: SessionSummary) => {
      setPinnedSessions(
        pinnedIds.includes(session.id)
          ? pinnedIds.filter((id) => id !== session.id)
          : [...new Set([...pinnedIds, session.id])]
      )
    },
    [pinnedIds]
  )
  /** 归档切换：只改显示与筛选，不动对话内容 */
  const toggleArchive = useCallback(
    (session: SessionSummary) => {
      const next = !archivedIds.includes(session.id)
      setSessionArchived(session.id, next)
      showToast({
        key: next ? 'sessionArchivedToast' : 'sessionUnarchivedToast',
        params: { name: session.title || t('untitledChat') },
      })
    },
    [archivedIds, t]
  )
  /** 单会话导出：对话 + 当前角色卡 + 相关世界书 + 场景 + 本会话记忆 */
  const exportBundle = useCallback(async (session: SessionSummary) => {
    try {
      const bundle = await buildSessionBundle(session)
      if (!bundle) {
        showToast({ key: 'sessionBundleMissing', type: 'error' })
        return
      }
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const name = sessionBundleName(bundle.title)
      if (android) {
        const saved = await saveAndroidHistory(name, blob)
        showToast(
          saved
            ? { key: 'sessionBundleExported', params: { name } }
            : { key: 'sessionBundleCanceled' }
        )
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      showToast({ key: 'sessionBundleExported', params: { name } })
    } catch {
      showToast({ key: 'sessionBundleFailed', type: 'error' })
    }
  }, [])
  /** 导出为可读文本：标题、角色名、逐条消息与记忆，便于存成笔记 */
  const exportText = useCallback(async (session: SessionSummary) => {
    try {
      const bundle = await buildSessionBundle(session)
      if (!bundle) {
        showToast({ key: 'sessionBundleMissing', type: 'error' })
        return
      }
      const text = sessionBundleToMarkdown(bundle)
      const name = sessionBundleName(bundle.title).replace(/\.json$/, '.md')
      const blob = new Blob([text], { type: 'text/markdown' })
      if (android) {
        const saved = await saveAndroidHistory(name, blob)
        showToast(
          saved
            ? { key: 'sessionTextExported', params: { name } }
            : { key: 'sessionBundleCanceled' }
        )
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      showToast({ key: 'sessionTextExported', params: { name } })
    } catch {
      showToast({ key: 'sessionBundleFailed', type: 'error' })
    }
  }, [])
  /** 打开创建分支的第一步：先给分支命名，不填则沿用原会话名加后缀 */
  const beginFork = useCallback((session: SessionSummary) => {
    setForkName('')
    setForkFlow({ target: session, step: 'name', branchId: null, branchTitle: '' })
  }, [])

  /** 命名确认后立即创建分支；是否分组放到下一步询问 */
  const confirmForkName = useCallback(async () => {
    const flow = forkFlow
    if (!flow || flow.step !== 'name') {
      return
    }
    const requested = forkName.trim()
    const defaultTitle = `${flow.target.title || t('untitledChat')} · ${t('sessionForkSuffix')}`
    const title = requested || defaultTitle
    const id = await forkSession(flow.target.id, requested || undefined)
    if (!id) {
      showToast({ key: 'sessionForkFailed', type: 'error' })
      setForkFlow(null)
      return
    }
    setForkFlow({
      target: flow.target,
      step: 'groupAsk',
      branchId: id,
      branchTitle: title,
    })
  }, [forkFlow, forkName, t])

  /** 关闭创建分支流程；已创建的分支不会回滚 */
  const finishFork = useCallback(
    (folderName?: string) => {
      const flow = forkFlow
      setForkFlow(null)
      setForkName('')
      if (!flow?.branchId) {
        return
      }
      showToast({
        key: folderName ? 'sessionForkGrouped' : 'sessionForkCreated',
        params: folderName
          ? { name: flow.branchTitle, folder: folderName }
          : { name: flow.branchTitle },
      })
    },
    [forkFlow]
  )
  /** 多选批量：复制选中会话，每条走 forkSession 生成独立分支，完成后提示条数 */
  const bulkCopy = useCallback(async () => {
    const ids = sessions.filter((session) => checked.has(session.id)).map((session) => session.id)
    let copied = 0
    for (const id of ids) {
      const newId = await forkSession(id)
      if (newId) {
        copied += 1
      }
    }
    setSelecting(false)
    setChecked(new Set())
    setRangeMode(false)
    setRangeAnchorId(null)
    showToast({
      key: 'androidBulkCopied',
      params: { count: copied },
    })
  }, [checked, sessions])

  /** 多选批量：归档选中会话，保持原数据不动 */
  const bulkArchive = useCallback(() => {
    const picked = sessions.filter((session) => checked.has(session.id))
    picked.forEach((session) => setSessionArchived(session.id, true))
    setSelecting(false)
    setChecked(new Set())
    setRangeMode(false)
    setRangeAnchorId(null)
    showToast({
      key: 'androidBulkArchived',
      params: { count: picked.length },
    })
  }, [checked, sessions])

  const startSelection = useCallback((session: SessionSummary) => {
    setSelecting(true)
    setChecked(new Set([session.id]))
    setRangeMode(false)
    setRangeAnchorId(session.id)
    setPinning(null)
  }, [])
  const toggleChecked = useCallback(
    (session: SessionSummary, range = false) => {
      const ids = selectableSessions.map((item) => item.id)
      const anchor = rangeAnchorId
      const from = anchor ? ids.indexOf(anchor) : -1
      const to = ids.indexOf(session.id)
      setChecked((previous) => {
        const next = new Set(previous)
        if ((range || rangeMode) && from >= 0 && to >= 0) {
          const start = Math.min(from, to)
          const end = Math.max(from, to)
          for (let index = start; index <= end; index += 1) {
            next.add(ids[index])
          }
          return next
        }
        if (next.has(session.id)) {
          next.delete(session.id)
        } else {
          next.add(session.id)
        }
        return next
      })
      setRangeAnchorId(session.id)
    },
    [rangeAnchorId, rangeMode, selectableSessions]
  )
  const allSelectableChecked =
    selectableSessions.length > 0 &&
    selectableSessions.every((session) => checked.has(session.id))
  const toggleAll = useCallback(() => {
    setChecked(
      allSelectableChecked ? new Set() : new Set(selectableSessions.map((session) => session.id))
    )
    setRangeAnchorId(null)
  }, [allSelectableChecked, selectableSessions])
  const [deletePending, setDeletePending] = useState(false)
  const drawerOpen = useMobileSider((state) => state.open)
  /** 单条、批量与整组共用同一条删除链路，避免某条失败后其余状态错位。 */
  const deleteSessions = useCallback(
    async (items: SessionSummary[]) => {
      setDeletePending(true)
      try {
        const remaining: SessionSummary[] = []
        const deleted = new Set<string>()
        for (const session of items) {
          if (await removeSession(session.id)) {
            deleted.add(session.id)
          } else {
            remaining.push(session)
          }
        }
        if (deleted.size) {
          setPinnedSessions(pinnedIds.filter((id) => !deleted.has(id)))
        }
        return { deleted, remaining }
      } finally {
        setDeletePending(false)
      }
    },
    [pinnedIds]
  )
  const archiveGroup = useCallback(() => {
    if (!groupDelete) {
      return
    }
    groupDelete.sessions.forEach((session) => setSessionArchived(session.id, true))
    showToast({
      key: 'sessionGroupArchived',
      params: { label: groupDelete.group.label, count: groupDelete.sessions.length },
    })
    setGroupDelete(null)
  }, [groupDelete])
  const deleteGroup = useCallback(
    async (roleOnly: boolean) => {
      if (!groupDelete) {
        return
      }
      const target = groupDelete
      const items = roleOnly ? target.roleSessions : target.sessions
      const result = await deleteSessions(items)
      setGroupDelete(null)
      if (result.remaining.length) {
        showToast({ key: 'sessionDeleteFailed', type: 'error' })
      } else if (result.deleted.size) {
        showToast({
          key: 'sessionGroupDeleted',
          params: { label: target.group.label, count: result.deleted.size },
        })
      }
    },
    [deleteSessions, groupDelete]
  )
  const closeSelection = useCallback(() => {
    setSelecting(false)
    setChecked((previous) => (previous.size === 0 ? previous : new Set()))
    setPinning(null)
    setRangeMode(false)
    setRangeAnchorId(null)
  }, [])

  useEffect(() => {
    if (!drawerOpen || searchOpen) {
      closeSelection()
      setGroupDelete(null)
    }
  }, [closeSelection, drawerOpen, searchOpen])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  if (showAndroidSearch) {
    return (
      <div className={clsx(styles.sider, styles.mobile)}>
        <AndroidContentSearch />
      </div>
    )
  }

  return (
    <div
      className={clsx(styles.sider, mobile && styles.mobile)}
      data-sider-selecting={selecting ? '' : undefined}
    >
      {selecting ? (
        <div className={styles.selectionHeader}>
          <span className={styles.selectionHeaderLabel}>
            {checked.size
              ? t('androidSelectedChats', { count: checked.size })
              : t('androidSelectChats')}
          </span>
          <div className={styles.selectionTools}>
            <button
              type="button"
              disabled={!selectableSessions.length}
              onClick={toggleAll}
            >
              {t(allSelectableChecked ? 'androidUnselectAll' : 'androidSelectAll')}
            </button>
            <button
              type="button"
              data-on={rangeMode ? '' : undefined}
              aria-pressed={rangeMode}
              title={t('androidRangeSelectHint')}
              onClick={() => {
                const next = !rangeMode
                setRangeMode(next)
                if (next && !rangeAnchorId) {
                  setRangeAnchorId(checked.values().next().value ?? null)
                }
              }}
            >
              {t('androidRangeSelect')}
            </button>
          </div>
          <IconButton
            tone="primary"
            icon={<IconCloseOutline16 />}
            aria-label={t('close')}
            onClick={closeSelection}
          />
        </div>
      ) : androidDrawer ? (
        <button
          type="button"
          className={styles.search}
          aria-label={t('androidSearchChats')}
          onClick={openDrawerSearch}
        >
          <IconSearchOutline16 />
          <span className={styles.searchPlaceholder}>{t('androidSearchChats')}</span>
        </button>
      ) : (
        <>
          <div className={styles.top}>
            <div className={styles.appName}>{t('appName')}</div>
            <IconButton
              size="m"
              icon={<IconPanelLeftOutline16 />}
              tooltip={t('collapseSiderbarButton')}
              tooltipPlacement="bottom"
              onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
            />
          </div>
          <button
            type="button"
            className={styles.newChat}
            onClick={() => {
              newChat()
              closeMobileSider()
            }}
          >
            <span className={styles.newChatIcon}>
              <NewChatIcon />
            </span>
            {t('newChat')}
          </button>
        </>
      )}
      <div className={styles.folderBar} aria-label={t('sessionFolderFilter')}>
        <div className={styles.folderScroller}>
          <button
            type="button"
            data-on={folderFilter === '' ? '' : undefined}
            onClick={() => setFolderFilter('')}
          >
            {t('sessionFolderAll')}
          </button>
          <button
            type="button"
            data-on={folderFilter === '__none' ? '' : undefined}
            onClick={() => setFolderFilter('__none')}
          >
            {t('sessionFolderNone')}
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              data-on={folderFilter === folder.id ? '' : undefined}
              onClick={() => setFolderFilter(folderFilter === folder.id ? '' : folder.id)}
            >
              {folder.name}
            </button>
          ))}
        </div>
        <div className={styles.folderTools}>
          {androidDrawer && !selecting ? (
            <button
              type="button"
              className={styles.folderMulti}
              aria-label={t('androidMultiSelect')}
              onClick={() => setSelecting(true)}
            >
              {t('androidMultiSelect')}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.folderMore}
            aria-label={t('more')}
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen((previous) => !previous)}
          >
            {t('more')}
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M3 4.6 6 7.6 9 4.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                style={{ transform: toolsOpen ? 'rotate(180deg)' : undefined }}
              />
            </svg>
          </button>
        </div>
      </div>
      {toolsOpen ? (
        <div className={styles.folderPanel}>
          <button
            type="button"
            onClick={() => {
              setToolsOpen(false)
              setNewFolderAssign(null)
              setNewFolderOpen(true)
            }}
          >
            <span className={styles.folderPanelIcon}>＋</span>
            {t('sessionFolderNew')}
          </button>
          <button
            type="button"
            data-on={showArchived ? '' : undefined}
            onClick={() => setShowArchived((previous) => !previous)}
          >
            <span className={styles.folderPanelIcon}>▤</span>
            {t(showArchived ? 'sessionArchiveHide' : 'sessionArchiveShow')}
          </button>
        </div>
      ) : null}
      <div className={styles.listWrap}>
        <div ref={listRef} className={styles.list}>
          {positionedGroups.map((group) => {
            const limit = group.sessions.length
            const start = group.collapsed
              ? 0
              : Math.min(
                  limit,
                  Math.max(0, Math.floor((viewport.top - group.top) / rowHeight) - ROW_OVERSCAN)
                )
            const end = group.collapsed
              ? 0
              : Math.min(
                  limit,
                  Math.max(
                    start,
                    Math.ceil((viewport.top + viewport.height - group.top) / rowHeight) +
                      ROW_OVERSCAN
                  )
                )
            return (
              <div
                key={group.key}
                className={clsx(
                  styles.section,
                  group.key === 'pinned' && styles.pinnedSection,
                  group.parentKey && styles.characterSection
                )}
              >
                <SessionSectionHeader
                  group={group}
                  collapsed={group.collapsed}
                  ariaLabel={t(
                    group.collapsed ? 'sessionHistoryExpandGroup' : 'sessionHistoryCollapseGroup',
                    { label: group.label }
                  )}
                  onToggle={clickGroup}
                  onPressStart={startGroupPress}
                  onPressMove={moveGroupPress}
                  onPressEnd={clearGroupPress}
                  onContextMenu={contextGroup}
                />
                {group.collapsed ? null : start ? (
                  <div aria-hidden="true" style={{ height: start * rowHeight }} />
                ) : null}
                {group.collapsed
                  ? null
                  : group.sessions.slice(start, end).map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        active={session.id === activeId}
                        pinned={pinnedIds.includes(session.id)}
                        archived={archivedIds.includes(session.id)}
                        onTogglePin={togglePinned}
                        onMultiSelect={startSelection}
                        onDelete={deleteOne}
                        onToggleArchive={toggleArchive}
                        onMoveFolder={setFolderTarget}
                        onExport={exportBundle}
                        onFork={beginFork}
                        onExportText={(item) => void exportText(item)}
                        selection={
                          selecting
                            ? {
                                checked: checked.has(session.id),
                                toggle: (range?: boolean) => toggleChecked(session, range),
                              }
                            : undefined
                        }
                      />
                    ))}
                {!group.collapsed && end < limit ? (
                  <div aria-hidden="true" style={{ height: (limit - end) * rowHeight }} />
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
      <div className={styles.bottom}>
        {selecting ? (
          <div className={styles.selectionActions}>
            <button
              type="button"
              disabled={!checked.size}
              onClick={() => setPinning({ ids: checked, unpin })}
            >
              <IconPinOutline16 />
              {t(unpin ? 'androidUnpin' : 'androidPinned')}
            </button>
            <button type="button" disabled={!checked.size} onClick={() => setBulkFolderOpen(true)}>
              {t('androidMoveFolder')}
            </button>
            <button type="button" disabled={!checked.size} onClick={() => setBulkConfirm('copy')}>
              {t('androidCopy')}
            </button>
            <button
              type="button"
              disabled={!checked.size}
              onClick={() => setBulkConfirm('archive')}
            >
              {t('androidArchive')}
            </button>
            <button
              type="button"
              data-danger=""
              disabled={!checked.size}
              onClick={() => setDeleting(sessions.filter((session) => checked.has(session.id)))}
            >
              <IconTrashOutline16 />
              {t('delete')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.settings}
            aria-label={`${username} · ${t('settings')}`}
            onClick={() => {
              openSettings('general')
            }}
          >
            <ProfileAvatar src={profile.avatar} />
            <span className={styles.settingsLabel}>{username}</span>
            {androidDrawer ? <IconEllipsisOutline16 /> : null}
          </button>
        )}
      </div>
      {bulkConfirm ? (
        <SessionActionDialog
          title={
            bulkConfirm === 'copy'
              ? t('androidBulkCopyConfirmTitle', { count: checked.size })
              : t('androidBulkArchiveConfirmTitle', { count: checked.size })
          }
          description={
            bulkConfirm === 'copy'
              ? t('androidBulkCopyConfirmBody')
              : t('androidBulkArchiveConfirmBody')
          }
          cancelLabel={t('cancel')}
          confirmLabel={bulkConfirm === 'copy' ? t('androidCopy') : t('androidArchive')}
          danger={bulkConfirm === 'archive'}
          stacked
          onCancel={() => setBulkConfirm(null)}
          onConfirm={() => {
            const action = bulkConfirm
            setBulkConfirm(null)
            if (action === 'copy') {
              void bulkCopy()
            } else {
              bulkArchive()
            }
          }}
        />
      ) : null}
      {bulkFolderOpen ? (
        <SessionActionDialog
          title={t('androidMoveFolderTitle', { count: checked.size })}
          cancelLabel={t('cancel')}
          confirmLabel={t('sessionFolderPickDone')}
          onCancel={() => setBulkFolderOpen(false)}
          onConfirm={() => setBulkFolderOpen(false)}
        >
          <div className={styles.folderPicker}>
            {folders.map((folder) => (
              <div key={folder.id} className={styles.folderPickRow}>
                <button
                  type="button"
                  onClick={() => {
                    sessions
                      .filter((session) => checked.has(session.id))
                      .forEach((session) => assignSessionFolder(session.id, folder.id))
                    setBulkFolderOpen(false)
                    closeSelection()
                    showToast({
                      key: 'androidBulkMoved',
                      params: { count: checked.size, name: folder.name },
                    })
                  }}
                >
                  {folder.name}
                </button>
              </div>
            ))}
            {folders.length === 0 ? (
              <div className={styles.folderEmpty}>{t('sessionFolderEmpty')}</div>
            ) : null}
            <button
              type="button"
              className={styles.folderAdd}
              onClick={() => {
                setBulkFolderOpen(false)
                setNewFolderAssign(null)
                setNewFolderOpen(true)
              }}
            >
              ＋ {t('sessionFolderNew')}
            </button>
          </div>
        </SessionActionDialog>
      ) : null}
      {folderTarget ? (
        <SessionActionDialog
          title={t('sessionFolderPickTitle', { name: folderTarget.title || t('untitledChat') })}
          cancelLabel={t('cancel')}
          confirmLabel={t('sessionFolderPickDone')}
          onCancel={() => setFolderTarget(null)}
          onConfirm={() => setFolderTarget(null)}
        >
          <div className={styles.folderPicker}>
            <div className={styles.folderPickRow}>
              <button
                type="button"
                data-on={!folderMap[folderTarget.id] ? '' : undefined}
                onClick={() => {
                  assignSessionFolder(folderTarget.id, null)
                  setFolderTarget(null)
                }}
              >
                {t('sessionFolderNone')}
              </button>
            </div>
            {folders.map((folder) => (
              <div key={folder.id} className={styles.folderPickRow}>
                <button
                  type="button"
                  data-on={folderMap[folderTarget.id] === folder.id ? '' : undefined}
                  onClick={() => {
                    assignSessionFolder(folderTarget.id, folder.id)
                    setFolderTarget(null)
                  }}
                >
                  {folder.name}
                </button>
                <button
                  type="button"
                  className={styles.folderRemove}
                  aria-label={t('sessionFolderRemove', { name: folder.name })}
                  onClick={() => {
                    removeSessionFolder(folder.id)
                    if (folderFilter === folder.id) {
                      setFolderFilter('')
                    }
                    showToast({
                      key: 'sessionFolderRemoved',
                      params: { name: folder.name },
                    })
                  }}
                >
                  删
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.folderAdd}
              onClick={() => {
                setNewFolderAssign(null)
                setNewFolderOpen(true)
              }}
            >
              ＋ {t('sessionFolderNew')}
            </button>
          </div>
        </SessionActionDialog>
      ) : null}
      {forkFlow?.step === 'name' ? (
        <SessionActionDialog
          title={t('sessionForkNameTitle')}
          description={t('sessionForkNameDescription', {
            name: forkFlow.target.title || t('untitledChat'),
          })}
          cancelLabel={t('cancel')}
          confirmLabel={t('sessionForkNameConfirm')}
          onCancel={() => {
            setForkFlow(null)
            setForkName('')
          }}
          onConfirm={() => void confirmForkName()}
        >
          <input
            ref={forkNameInput}
            className={styles.folderInput}
            placeholder={t('sessionForkNamePlaceholder')}
            value={forkName}
            maxLength={80}
            autoFocus
            onChange={(event) => setForkName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void confirmForkName()
              }
            }}
          />
        </SessionActionDialog>
      ) : null}
      {forkFlow?.step === 'groupAsk' ? (
        <SessionActionDialog
          title={t('sessionForkGroupAskTitle', { name: forkFlow.branchTitle })}
          description={t('sessionForkGroupAskBody')}
          cancelLabel={t('sessionForkGroupSkip')}
          confirmLabel={t('sessionForkGroupPick')}
          onCancel={() => finishFork()}
          onConfirm={() => setForkFlow({ ...forkFlow, step: 'groupPick' })}
        />
      ) : null}
      {forkFlow?.step === 'groupPick' ? (
        <SessionActionDialog
          title={t('sessionFolderPickTitle', { name: forkFlow.branchTitle })}
          cancelLabel={t('sessionForkGroupSkip')}
          confirmLabel={t('sessionFolderPickDone')}
          onCancel={() => finishFork()}
          onConfirm={() => finishFork()}
        >
          <div className={styles.folderPicker}>
            {folders.map((folder) => (
              <div key={folder.id} className={styles.folderPickRow}>
                <button
                  type="button"
                  onClick={() => {
                    if (!forkFlow.branchId) {
                      return
                    }
                    assignSessionFolder(forkFlow.branchId, folder.id)
                    finishFork(folder.name)
                  }}
                >
                  {folder.name}
                </button>
              </div>
            ))}
            {folders.length === 0 ? (
              <div className={styles.folderEmpty}>{t('sessionForkGroupEmpty')}</div>
            ) : null}
            <button
              type="button"
              className={styles.folderAdd}
              onClick={() => {
                if (!forkFlow.branchId) {
                  return
                }
                setNewFolderAssign({
                  sessionId: forkFlow.branchId,
                  branchName: forkFlow.branchTitle,
                })
                setForkFlow(null)
                setNewFolderOpen(true)
              }}
            >
              ＋ {t('sessionFolderNew')}
            </button>
          </div>
        </SessionActionDialog>
      ) : null}
      {newFolderOpen ? (
        <SessionActionDialog
          title={t('sessionFolderNew')}
          cancelLabel={t('cancel')}
          confirmLabel={t('sessionFolderCreate')}
          stacked
          onCancel={() => {
            const pending = newFolderAssign
            setNewFolderOpen(false)
            setNewFolderAssign(null)
            if (pending) {
              showToast({ key: 'sessionForkCreated', params: { name: pending.branchName } })
            }
          }}
          onConfirm={() => {
            const name = newFolderInput.current?.value.trim() ?? ''
            const folder = createSessionFolder(name)
            if (folder) {
              if (folderTarget) {
                assignSessionFolder(folderTarget.id, folder.id)
              }
              if (newFolderAssign) {
                assignSessionFolder(newFolderAssign.sessionId, folder.id)
                showToast({
                  key: 'sessionForkGrouped',
                  params: { name: newFolderAssign.branchName, folder: folder.name },
                })
              } else {
                showToast({ key: 'sessionFolderCreated', params: { name: folder.name } })
              }
            }
            setNewFolderOpen(false)
            setNewFolderAssign(null)
          }}
        >
          <input
            ref={newFolderInput}
            className={styles.folderInput}
            placeholder={t('sessionFolderNamePlaceholder')}
            maxLength={24}
            autoFocus
          />
        </SessionActionDialog>
      ) : null}
      {pinning ? (
        <SessionActionDialog
          title={t(pinning.unpin ? 'androidUnpinConfirm' : 'androidPinConfirm', {
            count: pinning.ids.size,
          })}
          cancelLabel={t(pinning.unpin ? 'androidKeepPinned' : 'cancel')}
          confirmLabel={t(pinning.unpin ? 'androidUnpin' : 'androidPinned')}
          onCancel={() => setPinning(null)}
          onConfirm={() => {
            const ids = sessions.filter((session) => pinning.ids.has(session.id))
            setPinnedSessions(
              pinning.unpin
                ? pinnedIds.filter((id) => !pinning.ids.has(id))
                : [...new Set([...pinnedIds, ...ids.map(({ id }) => id)])]
            )
            showToast({
              key: pinning.unpin ? 'androidUnpinnedChats' : 'androidPinnedChats',
              params: { count: ids.length },
            })
            closeSelection()
          }}
        />
      ) : null}
      {groupDelete ? (
        <SessionActionDialog
          title={t('sessionGroupDeleteTitle', {
            label: groupDelete.group.label,
            count: groupDelete.sessions.length,
          })}
          description={t('sessionGroupDeleteBody')}
          cancelLabel={t('cancel')}
          confirmLabel={t('sessionGroupDeleteConfirm')}
          secondaryLabel={
            groupDelete.roleSessions.length > 0 &&
            groupDelete.roleSessions.length < groupDelete.sessions.length
              ? t('sessionGroupDeleteCharacters', { count: groupDelete.roleSessions.length })
              : undefined
          }
          secondaryDanger
          danger
          stacked
          closeDisabled={deletePending}
          confirmDisabled={deletePending}
          onCancel={() => setGroupDelete(null)}
          onConfirm={() => void deleteGroup(false)}
          onSecondary={() => void deleteGroup(true)}
        >
          <div className={styles.groupDeleteAlt}>
            <button type="button" disabled={deletePending} onClick={archiveGroup}>
              {t('sessionGroupArchiveAction')}
            </button>
            <p>{t('sessionGroupArchiveHint')}</p>
          </div>
        </SessionActionDialog>
      ) : null}
      {deleting.length ? (
        <SessionActionDialog
          title={
            deleting.length === 1
              ? t('androidDeleteOneTitle')
              : t('androidDeleteManyTitle', { count: deleting.length })
          }
          description={
            deleting.length === 1
              ? t('androidDeleteOneDescription')
              : t('androidDeleteManyDescription')
          }
          cancelLabel={t('cancel')}
          confirmLabel={
            deleting.length === 1 ? t('androidDeleteOneConfirm') : t('androidDeleteManyConfirm')
          }
          danger
          stacked
          closeDisabled={deletePending}
          confirmDisabled={deletePending}
          onCancel={() => setDeleting([])}
          onConfirm={async () => {
            const result = await deleteSessions(deleting)
            setDeleting(result.remaining)
            if (result.remaining.length) {
              showToast({ key: 'sessionDeleteFailed', type: 'error' })
            } else {
              closeSelection()
            }
          }}
        />
      ) : null}
    </div>
  )
})

/** 移动端侧边栏：窄屏为浮层抽屉（点遮罩关闭）；Android 宽屏为左侧分栏（无遮罩）。 */

/* ---- 04 核心实现 ---- */
/* ---- 05 移动端侧栏 ---- */
export const MobileSider = memo(function MobileSider() {
  const t = useTranslate()
  const open = useMobileSider((state) => state.open)
  const searchOpen = useMobileSider((state) => state.searchOpen)
  const androidWide = useIsAndroidWide()
  const drawer = useRef<HTMLDivElement>(null)
  // 抽屉收起由 CSS 移出视野，不再使用 inert：状态错位时会让可见区域也跟着点不动
  if (!android && !open) {
    return null
  }
  return (
    <>
      {open && !androidWide && !searchOpen ? (
        <div
          className={styles.drawerMask}
          role="button"
          aria-label={t('closeSiderbarButton')}
          onClick={closeMobileSider}
        />
      ) : null}
      <div className={styles.drawer} ref={drawer} data-android-drawer={android ? '' : undefined}>
        <Sider mobile />
      </div>
    </>
  )
})

/* ============================================================================
 * 功能区：侧栏与会话管理 / Sider 结束
 * ========================================================================== */
