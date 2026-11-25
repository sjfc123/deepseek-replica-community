/* ============================================================================
 * 功能区：侧栏与会话管理 / SessionItem 开始
 * 职责：SessionItem 组件，负责该组件的渲染、状态与交互出口。
 * 导出：SessionItem。
 * ========================================================================== */

import clsx from 'clsx'
import { memo, useEffect, useRef, useState } from 'react'
import { android } from '../../app/android.js'
import { isAndroidWide } from '../../app/viewport.js'
import { useTranslate, type TranslationKey, type TranslationParams } from '../../i18n/index.js'
import {
  IconCopyOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconMultiSelectOutline16,
  IconPanelLeftOutline16,
  IconPinOutline16,
  IconSelectTextOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { renameSession, selectSession } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import { SessionActionDialog } from './SessionActionDialog.js'
import styles from './SessionItem.module.css'

/** 需要二次确认的会话动作；改状态、写文件、复制分支都不该点一下就执行 */
type PendingAction =
  | 'pin'
  | 'unpin'
  | 'folder'
  | 'export'
  | 'exportText'
  | 'archive'
  | 'unarchive'

const pendingCopy = (
  action: PendingAction,
  name: string,
  tr: (key: TranslationKey, params?: TranslationParams) => string
) => {
  const map: Record<
    PendingAction,
    { title: string; body: string; confirm: string; danger?: boolean }
  > = {
    pin: {
      title: tr('sessionConfirmPinTitle', { name }),
      body: tr('sessionConfirmPinBody'),
      confirm: tr('androidPinned'),
    },
    unpin: {
      title: tr('sessionConfirmUnpinTitle', { name }),
      body: tr('sessionConfirmUnpinBody'),
      confirm: tr('androidUnpin'),
    },
    folder: {
      title: tr('sessionConfirmFolderTitle', { name }),
      body: tr('sessionConfirmFolderBody'),
      confirm: tr('sessionMenuMoveFolder'),
    },
    export: {
      title: tr('sessionConfirmExportTitle', { name }),
      body: tr('sessionConfirmExportBody'),
      confirm: tr('sessionMenuExportBundle'),
    },
    exportText: {
      title: tr('sessionConfirmExportTextTitle', { name }),
      body: tr('sessionConfirmExportTextBody'),
      confirm: tr('sessionMenuExportText'),
    },
    archive: {
      title: tr('sessionConfirmArchiveTitle', { name }),
      body: tr('sessionConfirmArchiveBody'),
      confirm: tr('sessionMenuArchive'),
    },
    unarchive: {
      title: tr('sessionConfirmUnarchiveTitle', { name }),
      body: tr('sessionConfirmUnarchiveBody'),
      confirm: tr('sessionMenuUnarchive'),
    },
  }
  return map[action]
}

export const SessionItem = memo(function SessionItem({
  session,
  active,
  pinned,
  archived = false,
  onDelete,
  onTogglePin,
  onMultiSelect,
  onToggleArchive,
  onMoveFolder,
  onExport,
  onFork,
  onExportText,
  selection,
}: {
  session: SessionSummary
  active: boolean
  pinned: boolean
  archived?: boolean
  onDelete: (session: SessionSummary) => void
  onTogglePin: (session: SessionSummary) => void
  onMultiSelect: (session: SessionSummary) => void
  onToggleArchive?: (session: SessionSummary) => void
  onMoveFolder?: (session: SessionSummary) => void
  onExport?: (session: SessionSummary) => void
  onFork?: (session: SessionSummary) => void
  onExportText?: (session: SessionSummary) => void
  selection?: { checked: boolean; toggle: () => void }
}) {
  const t = useTranslate()
  const [renaming, setRenaming] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const [tapHighlight, setTapHighlight] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<number | undefined>(undefined)
  const highlightTimerRef = useRef<number | undefined>(undefined)
  const displayTitle = session.title || t('untitledChat')
  const openSession = () => {
    selectSession(session.id)
    if (!android) {
      closeMobileSider()
      return
    }
    if (isAndroidWide()) {
      return
    }
    window.clearTimeout(closeTimerRef.current)
    window.clearTimeout(highlightTimerRef.current)
    setTapHighlight(true)
    closeTimerRef.current = window.setTimeout(closeMobileSider, 170)
    highlightTimerRef.current = window.setTimeout(() => setTapHighlight(false), 350)
  }

  useEffect(
    () => () => {
      window.clearTimeout(closeTimerRef.current)
      window.clearTimeout(highlightTimerRef.current)
    },
    []
  )

  if (selection) {
    return (
      <div
        className={styles.select}
        role="checkbox"
        tabIndex={0}
        aria-checked={selection.checked}
        onClick={selection.toggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            selection.toggle()
          }
        }}
      >
        <span aria-hidden="true" />
        <div className={styles.title}>{displayTitle}</div>
      </div>
    )
  }

  const finishRename = () => {
    const title = renameInputRef.current?.value.trim() ?? ''
    setRenaming(false)
    if (title && title !== displayTitle) {
      renameSession(session.id, title)
    }
  }

  return (
    <>
      <div
        className={clsx(styles.item, active && styles.active, tapHighlight && styles.tapHighlight)}
        onContextMenu={(event) => {
          if (android) {
            event.preventDefault()
            setMenuPoint({ x: event.clientX, y: event.clientY })
            requestAnimationFrame(() => actionsRef.current?.querySelector('button')?.click())
          }
        }}
        onClick={openSession}
        onKeyDown={(event) => {
          if (android && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            openSession()
          }
        }}
      >
        <div className={styles.title}>{displayTitle}</div>
        <div
          ref={actionsRef}
          className={clsx(styles.action, active && styles.actionActive)}
          onClick={(event) => event.stopPropagation()}
        >
          <Menu
            variant="sidebar"
            anchorPoint={menuPoint}
            onOpenChange={(next) => {
              if (!next) {
                setMenuPoint(null)
              }
            }}
            options={[
              {
                key: 'rename',
                label: t('sessionItemMenuRenameOption'),
                icon: <IconEditOutline16 />,
                onSelect: () => setRenaming(true),
              },
              {
                key: pinned ? 'unpin' : 'pin',
                label: t(pinned ? 'androidUnpin' : 'androidPinned'),
                icon: <IconPinOutline16 />,
                onSelect: () => setPendingAction(pinned ? 'unpin' : 'pin'),
              },
              {
                key: 'multiselect',
                label: t('androidMultiSelect'),
                icon: <IconMultiSelectOutline16 />,
                onSelect: () => onMultiSelect(session),
              },
              ...(onMoveFolder
                ? [
                    {
                      key: 'folder',
                      label: t('sessionMenuMoveFolder'),
                      sectionStart: true,
                      icon: <IconPanelLeftOutline16 />,
                      onSelect: () => setPendingAction('folder'),
                    },
                  ]
                : []),
              ...(onExport
                ? [
                    {
                      key: 'export',
                      label: t('sessionMenuExportBundle'),
                      icon: <IconDownloadOutline16 />,
                      onSelect: () => setPendingAction('export'),
                    },
                  ]
                : []),
              ...(onExportText
                ? [
                    {
                      key: 'exportText',
                      label: t('sessionMenuExportText'),
                      icon: <IconSelectTextOutline16 />,
                      onSelect: () => setPendingAction('exportText'),
                    },
                  ]
                : []),
              ...(onFork
                ? [
                    {
                      key: 'fork',
                      label: t('sessionMenuFork'),
                      icon: <IconCopyOutline16 />,
                      onSelect: () => onFork(session),
                    },
                  ]
                : []),
              ...(onToggleArchive
                ? [
                    {
                      key: 'archive',
                      label: t(archived ? 'sessionMenuUnarchive' : 'sessionMenuArchive'),
                      sectionStart: true,
                      icon: <IconDataOutline16 />,
                      onSelect: () => setPendingAction(archived ? 'unarchive' : 'archive'),
                    },
                  ]
                : []),
              {
                key: 'delete',
                label: t('delete'),
                icon: <IconTrashOutline16 />,
                danger: true,
                sectionStart: true,
                onSelect: () => onDelete(session),
              },
            ]}
          >
            {({ toggle }) =>
              android ? (
                active ? (
                  <button
                    type="button"
                    className={clsx(styles.actionTrigger, styles.activeTrigger)}
                    aria-label={t('androidShowMenu')}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={toggle}
                  >
                    <span className={styles.activeTriggerIcon}>
                      <IconEllipsisOutline16 />
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.actionTrigger}
                    aria-hidden="true"
                    tabIndex={-1}
                    onClick={toggle}
                  />
                )
              ) : (
                <IconButton
                  icon={<IconEllipsisOutline16 />}
                  aria-label={t('more')}
                  onClick={toggle}
                />
              )
            }
          </Menu>
        </div>
      </div>
      {renaming ? (
        <SessionActionDialog
          title={t('renameSessionTitle')}
          cancelLabel={t('cancel')}
          confirmLabel={t('renameSessionConfirm')}
          onCancel={() => setRenaming(false)}
          onConfirm={finishRename}
        >
          <input
            ref={renameInputRef}
            className={styles.renameInput}
            defaultValue={displayTitle}
            autoFocus
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                finishRename()
              }
            }}
          />
        </SessionActionDialog>
      ) : null}
      {pendingAction ? (
        <SessionActionDialog
          title={pendingCopy(pendingAction, displayTitle, t).title}
          description={pendingCopy(pendingAction, displayTitle, t).body}
          cancelLabel={t('cancel')}
          confirmLabel={pendingCopy(pendingAction, displayTitle, t).confirm}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            const action = pendingAction
            setPendingAction(null)
            if (action === 'pin' || action === 'unpin') {
              onTogglePin(session)
            } else if (action === 'folder') {
              onMoveFolder?.(session)
            } else if (action === 'export') {
              onExport?.(session)
            } else if (action === 'exportText') {
              onExportText?.(session)
            } else if (action === 'archive' || action === 'unarchive') {
              onToggleArchive?.(session)
            }
          }}
        />
      ) : null}
    </>
  )
})

/* ============================================================================
 * 功能区：侧栏与会话管理 / SessionItem 结束
 * ========================================================================== */
