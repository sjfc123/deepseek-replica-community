/* ============================================================================
 * 功能区：消息渲染 / AssistantMessage 开始
 * 职责：助手消息：正文、推理、用量、朗读、长按菜单与版本切换。
 * ========================================================================== */

import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { android } from '../../app/android.js'
import {
  IconBrowseOutline16,
  IconCopyOutline16,
  IconEditOutline16,
  IconMultiSelectOutline16,
  IconPlayMediaOutline16,
  IconRefreshOutline16,
  IconSelectAllOutline16,
  IconSelectTextOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
} from '../base/icons.js'
import { formatTokenCount } from '../../services/chat/tokenUsage.js'
import { describeReply } from '../../services/chat/describe.js'
import { findActiveCharacterCard, findSessionCharacterCard } from '../../services/chat/roleplay.js'
import {
  deleteMessage,
  editAssistantMessage,
  regenerateReply,
  useChatStore,
} from '../../services/chat/store.js'
import {
  describeReadAloudError,
  stopReadAloud,
  toggleReadAloud,
} from '../../services/speech/readAloud.js'
import { useSettings } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'
import type { AssistantMessage as AssistantMessageType } from '../../services/chat/types.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { copyText as copyToClipboard } from '../../utils/clipboard.js'
import { IconButton } from '../base/IconButton.js'
import { Button } from '../base/Button.js'
import { Menu } from '../base/Menu.js'
import { Markdown } from '../markdown/Markdown.js'
import { formatAndroidCopyText } from '../../services/markdown/copyText.js'
import { SiteThumbnails } from '../search/SiteLogo.js'
import { toggleSearchPanel, useSearchPanel } from '../search/searchPanelState.js'
import { AndroidTextSelection } from './AndroidTextSelection.js'
import { MessageIllustration } from './MessageIllustration.js'
import { generateIllustration } from '../../services/illustration/generate.js'
import { putIllustration } from '../../services/illustration/store.js'
import { ReadAloudButton } from './ReadAloudButton.js'
import { CopyButton } from './CopyButton.js'
import { MemoryChip } from '../memory/MemoryChip.js'
import { openMemoryPanel } from '../memory/memoryPanelState.js'
import { MessageAvatar } from './MessageAvatar.js'
import { ReplyArea } from './ReplyArea.js'
import { useReplyView } from './useReplyView.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import styles from './AssistantMessage.module.css'

const TOP_UP_URL = 'https://platform.deepseek.com/top_up'

export const AssistantMessage = memo(function AssistantMessage({
  sessionId,
  message,
  isLast,
  streaming,
  busy,
  searchHighlightNonce = null,
  versions,
  onSelectVersion,
  onStartMemorySelect,
  modeSwitch = false,
}: {
  sessionId: string
  message: AssistantMessageType
  isLast: boolean
  streaming: boolean
  busy: boolean
  searchHighlightNonce?: number | null
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
  /** 长按菜单进入记忆选择：one=本轮，all=当前分支全部 */
  onStartMemorySelect?: (scope: 'one' | 'all') => void
  /** 本条回复是否紧跟在思考/非思考模式切换之后 */
  modeSwitch?: boolean
}) {
  const t = useTranslate()
  const customEndpoint = useSettings((state) => Boolean(state.chatConfig.endpoint))
  const avatarInChat = useSettings((state) => state.avatarInChat)
  const showUsage = useSettings((state) => state.showUsage)
  const usageBelow = useSettings((state) => state.usageBelow)
  const roleplayEnabled = useSettings((state) => state.roleplayEnabled)
  const characterCards = useSettings((state) => state.characterCards)
  const activeCharacterId = useSettings((state) => state.activeCharacterId)
  const session = useChatStore((state) => state.sessionCache[sessionId])
  // 会话已绑定人物时优先沿用它；关闭全局开关不会把头像和称呼切回手写角色
  const activeCard =
    findSessionCharacterCard(characterCards, session) ??
    (roleplayEnabled ? findActiveCharacterCard(characterCards, activeCharacterId) : undefined)
  const cardAvatars = useSettings((state) => state.cardAvatars)
  const characterAvatar = useSettings((state) => state.characterAvatar)
  const cardAvatar = activeCard ? (cardAvatars[activeCard.id] ?? null) : null
  const characterName = useSettings((state) => state.characterName)
  const thoughtAside = useSettings((state) => state.thoughtAside)
  const memoryInline = useSettings((state) => state.memoryInline)
  const canReadAloud = useSettings((state) => Boolean(state.apiKey))
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [draft, setDraft] = useState('')
  const editRef = useRef<HTMLTextAreaElement>(null)
  const view = useReplyView(message, streaming)
  // 长回复默认折叠：只限视觉高度，正文完整渲染，复制仍是全文
  const longMessage = !streaming && (view.answer?.markdown.length ?? 0) > 1200
  const collapsed = longMessage && !expanded
  const panelEntry = useSearchPanel((state) => state.entry)
  const notice = streaming ? null : describeReply(message)
  // 安全拒绝：已下发的思考与正文按协议丢弃，只显示模板答复。
  const refused = message.stopReason === 'refusal'
  const answer = refused ? null : view.answer
  const responseText = [answer?.text, notice?.presentation === 'response' ? notice.text : null]
    .filter(Boolean)
    .join('\n\n')
  const copyText = useMemo(() => {
    if (!android) {
      return responseText || notice?.text
    }
    if (responseText) {
      return formatAndroidCopyText(responseText) || responseText
    }
    return notice?.text
  }, [notice?.text, responseText])
  const [selecting, setSelecting] = useState(false)
  const [selectionPoint, setSelectionPoint] = useState<{ x: number; y: number } | undefined>()
  const [menuOffset, setMenuOffset] = useState<{ x: number; y: number } | undefined>()
  const lastTouchRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const selectableRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const wasStreaming = useRef(streaming)

  const stopSelecting = useCallback(() => {
    setSelecting(false)
  }, [])

  const startSelecting = () => {
    setSelecting(true)
  }

  const copyAssistantText = () => {
    if (!copyText) {
      return
    }
    void copyToClipboard(copyText).then((copied) =>
      showToast({ key: copied ? 'copied' : 'copyFailed' }, copied ? 1990 : undefined)
    )
  }
  useEffect(() => {
    if (
      android &&
      wasStreaming.current &&
      !streaming &&
      !customEndpoint &&
      isLast &&
      responseText &&
      message.stopReason === 'end_turn' &&
      useSettings.getState().autoRead
    ) {
      toggleReadAloud(message.id, responseText, (error) => showToast(describeReadAloudError(error)))
    }
    wasStreaming.current = streaming
  }, [customEndpoint, isLast, message.id, message.stopReason, responseText, streaming])
  const waiting =
    streaming && view.steps.length === 0 && !view.answer && (android || !message.thinking)
  const summaryEntry = `${message.id}-summary`
  const usage = message.usage
  const cacheRead = usage ? Math.max(0, usage.cache_read_input_tokens || 0) : 0
  const cacheMiss = usage
    ? Math.max(0, usage.input_tokens || 0) + Math.max(0, usage.cache_creation_input_tokens || 0)
    : 0
  const cacheTotal = cacheRead + cacheMiss
  const cacheHitRate = cacheTotal > 0 ? (cacheRead / cacheTotal) * 100 : 0
  // 用量行只保留一个节点，位置由 data-position 和消息容器的 order 控制。
  const renderUsageLine = (position: 'above' | 'below') =>
    showUsage && message.status === 'done' && message.usage ? (
      <div className={styles.usageLine} data-position={position}>
        <span>
          输入{' '}
          {formatTokenCount(
            message.usage.input_tokens +
              message.usage.cache_creation_input_tokens +
              message.usage.cache_read_input_tokens
          )}
        </span>
        <span>输出 {formatTokenCount(message.usage.output_tokens)}</span>
        <span>缓存命中 {formatTokenCount(message.usage.cache_read_input_tokens)}</span>
        <span>
          未命中{' '}
          {formatTokenCount(message.usage.input_tokens + message.usage.cache_creation_input_tokens)}
        </span>
        <span>
          {t('cacheHitRateShort')} {cacheHitRate.toFixed(1)}%
        </span>
        {modeSwitch ? (
          <span className={styles.cacheModeSwitch}>{t('cacheModeSwitchRebuild')}</span>
        ) : null}
      </div>
    ) : null
  return (
    <div
      className={clsx(styles.message, searchHighlightNonce !== null && styles.searchHighlighted)}
      data-message-id={message.id}
    >
      {searchHighlightNonce !== null ? (
        <div key={searchHighlightNonce} className={styles.searchHighlight} aria-hidden="true" />
      ) : null}
      {avatarInChat ? (
        <MessageAvatar
          src={cardAvatar || characterAvatar}
          name={activeCard?.name || characterName || (customEndpoint ? 'AI' : 'DeepSeek')}
          align="start"
        />
      ) : null}
      {refused || editing ? null : (
        <ReplyArea
          message={message}
          view={view}
          streaming={streaming}
          hasResponse={!!responseText}
        />
      )}
      {renderUsageLine(usageBelow ? 'below' : 'above')}
      {confirmDelete
        ? createPortal(
            <div
              className={styles.confirmOverlay}
              role="dialog"
              aria-modal="true"
              aria-label="删除这条回复"
              onClick={() => setConfirmDelete(false)}
            >
              <section className={styles.confirmCard} onClick={(event) => event.stopPropagation()}>
                <h4>删除这条回复？</h4>
                <p>它后面的对话会一起删掉，提问保留；同一个提问下还有别的版本会自动切过去。</p>
                <div className={styles.confirmActions}>
                  <button
                    className={styles.confirmCancel}
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                  >
                    {t('cancel')}
                  </button>
                  <button
                    className={styles.confirmDanger}
                    type="button"
                    onClick={() => {
                      setConfirmDelete(false)
                      if (deleteMessage(sessionId, message.id)) {
                        showToast('已删除')
                      } else {
                        showToast('删除失败，生成中或已结束', 2500)
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
      {editing ? (
        <div className={styles.editor}>
          <textarea
            ref={editRef}
            className={styles.editorInput}
            value={draft}
            rows={Math.min(12, draft.split('\n').length + 2)}
            autoFocus
            aria-label={t('editMessage')}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className={styles.editorActions}>
            <Button size="s" variant="outlined" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
            <Button
              size="s"
              onClick={() => {
                const text = draft.trim()
                setEditing(false)
                if (!text || text === responseText.trim()) {
                  return
                }
                if (editAssistantMessage(sessionId, message.id, text)) {
                  showToast('已保存为新分支，可在回复下方切换')
                } else {
                  showToast('保存失败，请稍后再试', 2500)
                }
              }}
            >
              保存
            </Button>
          </div>
        </div>
      ) : null}
      <div
        ref={selectableRef}
        className={styles.selectable}
        data-editing={editing ? 'true' : undefined}
        onPointerDown={(event) => {
          if (android) {
            lastTouchRef.current = { x: event.clientX, y: event.clientY }
          }
        }}
        onContextMenu={(event) => {
          if (!android || !responseText) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          stopSelecting()
          const point =
            event.clientX || event.clientY
              ? { x: event.clientX, y: event.clientY }
              : lastTouchRef.current
          setSelectionPoint(point)
          const rect = selectableRef.current?.getBoundingClientRect()
          if (point && rect) {
            setMenuOffset({
              x: Math.max(0, Math.min(rect.width, point.x - rect.left)),
              y: Math.max(0, Math.min(rect.height, point.y - rect.top)),
            })
          }
          requestAnimationFrame(() => menuTriggerRef.current?.click())
        }}
        onClickCapture={(event) => {
          if (selecting && contentRef.current?.contains(event.target as Node)) {
            event.preventDefault()
            event.stopPropagation()
            stopSelecting()
          }
        }}
      >
        {android && responseText ? (
          <span
            className={styles.menuAnchor}
            style={menuOffset ? { left: menuOffset.x, top: menuOffset.y } : undefined}
          >
            <Menu
              variant="assistantMessage"
              anchorPoint={selectionPoint}
              onOpenChange={(next) => {
                if (!next) {
                  setSelectionPoint(undefined)
                }
              }}
              options={[
                {
                  key: 'copy',
                  label: t('copy'),
                  icon: <IconCopyOutline16 />,
                  onSelect: copyAssistantText,
                },
                {
                  key: 'selectText',
                  label: t('androidSelectText'),
                  icon: <IconSelectTextOutline16 />,
                  onSelect: startSelecting,
                },
                ...(onStartMemorySelect
                  ? [
                      {
                        key: 'memorySelectOne',
                        label: '选择这条对话',
                        sectionStart: true,
                        icon: <IconMultiSelectOutline16 />,
                        onSelect: () => {
                          stopSelecting()
                          stopReadAloud()
                          onStartMemorySelect('one')
                        },
                      },
                      {
                        key: 'memorySelectAll',
                        label: '全选本对话',
                        icon: <IconSelectAllOutline16 />,
                        onSelect: () => {
                          stopSelecting()
                          stopReadAloud()
                          onStartMemorySelect('all')
                        },
                      },
                    ]
                  : []),
                {
                  key: 'editReply',
                  label: '编辑这条回复',
                  sectionStart: true,
                  icon: <IconEditOutline16 />,
                  onSelect: () => {
                    stopReadAloud()
                    setDraft(responseText)
                    setEditing(true)
                  },
                },
                {
                  key: 'illustrate',
                  label: '生成配图',
                  sectionStart: true,
                  icon: <IconBrowseOutline16 />,
                  onSelect: () => {
                    if (!customEndpoint) {
                      showToast(
                        '当前使用内置接口，未配置绘图地址；到「接口与请求」填写自定义接口后再试'
                      )
                      return
                    }
                    showToast('正在根据这段剧情生成插画…')
                    void generateIllustration(responseText, 'message').then((result) => {
                      if (result.ok) {
                        putIllustration(message.id, result.url, responseText.slice(0, 200))
                      } else {
                        showToast(result.message)
                      }
                    })
                  },
                },
                {
                  key: 'regenerate',
                  label: t('regenerate'),
                  icon: <IconRefreshOutline16 />,
                  onSelect: () => {
                    stopReadAloud()
                    regenerateReply(sessionId, message.id)
                  },
                },
                ...(!customEndpoint || canReadAloud
                  ? [
                      {
                        key: 'read',
                        label: t('ttsPlay'),
                        icon: <IconPlayMediaOutline16 />,
                        onSelect: () =>
                          toggleReadAloud(message.id, responseText, (error) =>
                            showToast(describeReadAloudError(error))
                          ),
                      },
                    ]
                  : []),
                {
                  key: 'delete',
                  sectionStart: true,
                  label: '删除本条',
                  icon: <IconTrashOutline16 />,
                  onSelect: () => {
                    stopReadAloud()
                    setConfirmDelete(true)
                  },
                },
              ]}
            >
              {({ toggle }) => (
                <button
                  ref={menuTriggerRef}
                  className={styles.menuTrigger}
                  type="button"
                  aria-hidden="true"
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggle()
                  }}
                />
              )}
            </Menu>
          </span>
        ) : null}
        <div ref={contentRef} className={styles.selectableContent}>
          {answer ? (
            <>
              <div
                className={styles.answerBody}
                data-collapsed={collapsed ? '' : undefined}
                key={collapsed ? 'collapsed' : 'expanded'}
              >
                <Markdown
                  className={clsx(
                    'ds-assistant-message-main-content',
                    !thoughtAside && 'ds-asides-off'
                  )}
                  content={answer.markdown}
                  loading={streaming}
                  cacheKey={message.id}
                  disableLink={false}
                  sources={view.sources}
                />
              </div>
              <MessageIllustration messageId={message.id} />
              {longMessage ? (
                <button
                  type="button"
                  className={styles.expandToggle}
                  onClick={() => setExpanded((value) => !value)}
                  aria-expanded={expanded}
                >
                  {expanded ? '收起' : `展开全文 · 共 ${answer.markdown.length} 字`}
                </button>
              ) : null}
            </>
          ) : null}
          {notice?.presentation === 'response' ? (
            <Markdown
              className="ds-assistant-message-main-content"
              content={notice.text}
              loading={false}
              cacheKey={`${message.id}-template`}
              disableLink={false}
            />
          ) : notice ? (
            <div className={styles.notice}>
              <IconWarningOutline16 />
              <span>
                {notice.text}
                {notice.action === 'apiKey' ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className={styles.noticeAction}
                      onClick={() => openSettings(customEndpoint ? 'advanced' : 'data')}
                    >
                      {t('changeApiKey')}
                    </button>
                  </>
                ) : null}
                {notice.action === 'topUp' && !customEndpoint ? (
                  <>
                    {' '}
                    <a
                      className={styles.noticeAction}
                      href={TOP_UP_URL}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('topUp')}
                    </a>
                  </>
                ) : null}
              </span>
            </div>
          ) : null}
        </div>
        {android ? (
          <AndroidTextSelection
            active={selecting}
            containerRef={selectableRef}
            contentRef={contentRef}
            initialMode="block"
            initialPoint={selectionPoint}
            fullCopyText={copyText}
            onExit={stopSelecting}
          />
        ) : null}
      </div>
      {waiting ? (
        <div className={styles.waiting}>
          {[0, 1, 2].map((index) => (
            <span key={index} className={styles.waitingDot} />
          ))}
        </div>
      ) : null}
      {!streaming && !refused && view.searchResults.length > 0 ? (
        <div
          className={clsx(styles.summary, panelEntry === summaryEntry && styles.summaryActive)}
          role="button"
          tabIndex={0}
          aria-expanded={panelEntry === summaryEntry}
          onClick={() => toggleSearchPanel(summaryEntry, view.searchResults)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              toggleSearchPanel(summaryEntry, view.searchResults)
            }
          }}
        >
          <SiteThumbnails sources={view.searchResults} />
          <span>
            {t(
              view.searchResults.length === 1 ? 'messageSearchSummary' : 'messageSearchSummaries',
              { count: view.searchResults.length }
            )}
          </span>
        </div>
      ) : null}
      {!streaming && memoryInline && (message.memories?.length ?? 0) > 0 ? (
        <div className={styles.memoryRow}>
          <MemoryChip
            variant="inline"
            count={message.memories?.length ?? 0}
            onClick={openMemoryPanel}
          />
          <span className={styles.memoryHint}>
            {message.memories?.some((card) => card.source === 'manual')
              ? '这一轮手动记下的内容'
              : '这一轮自动记下，可在长期记忆里查看'}
          </span>
        </div>
      ) : null}
      {streaming ? null : (
        <div className={styles.bottom}>
          <BranchSwitcher versions={versions} disabled={busy} onSelect={onSelectVersion} />
          <div className={clsx(styles.actions, isLast && styles.alwaysShow)}>
            {copyText ? (
              <CopyButton
                text={copyText}
                buttonProps={
                  android
                    ? {
                        tabIndex: -1,
                        onMouseDown: (event) => event.preventDefault(),
                      }
                    : undefined
                }
              />
            ) : null}
            {responseText && !refused && (!customEndpoint || canReadAloud) ? (
              <ReadAloudButton messageId={message.id} text={responseText} />
            ) : null}
            <div className={styles.rightActions}>
              <IconButton
                className={styles.regenerate}
                icon={<IconRefreshOutline16 />}
                tooltip={t('regenerate')}
                tooltipPlacement="bottom"
                disabled={busy || refused}
                onClick={() => {
                  stopReadAloud()
                  regenerateReply(sessionId, message.id)
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

/* ============================================================================
 * 功能区：消息渲染 / AssistantMessage 结束
 * ========================================================================== */
