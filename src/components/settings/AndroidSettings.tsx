/* ============================================================================
 * 功能区：设置页 / AndroidSettings 开始
 * 职责：Android 设置页：分区导航、账户、角色档案、记忆、数据与外观配置。
 * ========================================================================== */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { android, saveAndroidHistory } from '../../app/android.js'
import {
  exportMemory,
  importMemory,
  type MemoryExportOptions,
  type MemoryImportMode,
} from '../../services/chat/memoryArchive.js'
import {
  NORMAL_MEMORY_KINDS,
  normalMemoryLabel,
  type NormalMemoryKind,
} from '../../services/chat/memory.js'
import { importSessionBundle, parseSessionBundle } from '../../services/chat/sessionBundle.js'
import {
  SettingArchiveError,
  applySettingArchive,
  buildSettingArchive,
  parseSettingArchive,
  settingArchiveName,
} from '../../services/chat/settingArchive.js'
import { openAndroidPage } from '../../app/openAndroidPage.js'
import {
  subscribeToAndroidBackPreview,
  useAndroidBackInterception,
} from '../../app/useAndroidBackInterception.js'
import { useTranslate, type LinkedMessage } from '../../i18n/index.js'
import type { TtsVoice } from '../../services/api/speech.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  formatImportResult,
  importHistory,
  type ImportMode,
} from '../../services/chat/backup.js'
import { parseCustomHeaders } from '../../services/api/headers.js'
import { prepareAvatar } from '../../utils/imageAvatar.js'
import {
  readAutoBackupMeta,
  readAutoBackupStatus,
  runAutoBackup,
  type AutoBackupResult,
  type AutoBackupStatus,
} from '../../services/chat/autoBackup.js'
import { readMigrationReport } from '../../services/dataMigration.js'
import { getUnreadableRecordCount } from '../../services/chat/db.js'
import { findActiveCharacterCard } from '../../services/chat/roleplay.js'
import {
  CHARACTER_PROFILE_EN,
  CHARACTER_PROFILE_FIELDS,
  CHARACTER_PROFILE_GROUPS,
  characterProfileFieldCount,
  resolveSystemCharacterName,
} from '../../services/chat/characterProfile.js'
import { selectSession, useChatStore } from '../../services/chat/store.js'
import { formatTokenCount } from '../../services/chat/tokenUsage.js'
import { TokenUsagePanel } from './TokenUsagePanel.js'
import { FeatureIcon } from './FeatureIcon.js'
import { saveDiagnosticReport } from '../../app/diagnostics.js'
import {
  DEFAULT_SYSTEM_PROMPT,
  setApiKey,
  resetCharacterSettings,
  setAvatarInChat,
  setThoughtAside,
  setMemoryBadge,
  setMemoryInline,
  setCharacterAvatar,
  setCardAvatar,
  setCharacterName,
  setCharacterProfileEnabled,
  setCharacterProfileField,
  replaceCharacterProfile,
  saveCharacterCard,
  saveWorldbookEntry,
  replaceScene,
  setAutoFollow,
  setTokenLimit,
  setShowUsage,
  setUsageBelow,
  setAccentColor,
  setBubbleRadius,
  setMessageSpacing,
  setAvatarShape,
  setCharacterAvatarSize,
  setUserAvatarSize,
  setChatLayout,
  setSuppressMetaTalk,
  resetContextSettings,
  resetRefusalSettings,
  resetRequestSettings,
  resetSamplingSettings,
  setRpTemperature,
  setRpTopP,
  setRpMaxTokens,
  setAllowRefusedContext,
  setAutoBackup,
  setAutoBackupMinutes,
  AUTO_BACKUP_MINUTES_MAX,
  AUTO_BACKUP_MINUTES_MIN,
  setAutoCompact,
  setAutoTitle,
  setChatConfig,
  setCustomHeaders,
  setFoldThinking,
  setFontSize,
  setKeepRefusedContent,
  setLocale,
  setMaxTokens,
  setMemoryChars,
  setMemoryLimit,
  setMemoryMode,
  setNormalMemoryChars,
  setNormalMemoryEnabled,
  setNormalMemoryLimit,
  MEMORY_LIMIT_MAX,
  MEMORY_LIMIT_MIN,
  MEMORY_CHARS_DEFAULT,
  MEMORY_CHARS_MAX,
  MEMORY_CHARS_MIN,
  setRefusalCaseSensitive,
  setRefusalEnabled,
  setRefusalKeywords,
  setRefusalMessage,
  setSafetyCheck,
  setSearch,
  setSendLatestReminder,
  setSceneAutoUpdate,
  setThinking,
  setWorldbookInject,
  setSystemPrompt,
  setTemperature,
  setThemePreference,
  setTopP,
  setTtsVoice,
  useSettings,
  type ChatLayout,
  type LocalePreference,
  type ThemePreference,
} from '../../services/settings.js'
import {
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconDataOutline16,
  IconGlobeLanguageOutline14,
  IconLightOutline16,
} from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { closeOverlaySider } from '../sider/mobileSiderState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { AdvancedApiSettings } from './AdvancedApiSettings.js'
import { createSettingsPageMotion } from './androidSettingsMotion.js'
import { ProfileIcon } from './ProfileAvatar.js'
import { ProfileEditor } from './ProfileEditor.js'
import { RoleplayPanel } from './RoleplayPanel.js'
import { closeSettings, useSettingsDialog } from './settingsDialogState.js'
import styles from './AndroidSettings.module.css'

const appVersion = document.querySelector<HTMLMetaElement>(
  'meta[name="application-version"]'
)?.content
const policiesUrl = 'https://cdn.deepseek.com/policies'
const chinesePoliciesUrl = `${policiesUrl}/zh-CN`
const faqUrl = 'https://static.deepseek.com/faq/index.html'
/* -------------------- 功能区：页面类型与通用控件 开始 -------------------- */
type Page =
  | 'root'
  | 'account'
  | 'advanced'
  | 'character'
  | 'roleplay'
  | 'sampling'
  | 'request'
  | 'context'
  | 'cost'
  | 'memory'
  | 'refusal'
  | 'data'
  | 'export'
  | 'font'
  | 'personalization'
  | 'agreements'
type Popup =
  | 'locale'
  | 'theme'
  | 'layout'
  | 'avatarCharacter'
  | 'avatarUser'
  | 'avatarShape'
  | 'accent'
  | 'bubbleRadius'
  | 'messageSpacing'
  | 'tokenLimit'
  | 'backupInterval'
  | 'memoryExport'
  | 'voice'
  | 'logout'
  | 'delete'
  | 'import'

const parentPage: Record<Page, Page | null> = {
  root: null,
  account: 'root',
  advanced: 'account',
  character: 'root',
  roleplay: 'root',
  sampling: 'root',
  request: 'root',
  context: 'root',
  cost: 'root',
  memory: 'root',
  refusal: 'root',
  data: 'root',
  export: 'data',
  font: 'root',
  personalization: 'root',
  agreements: 'root',
}

const PersonalizationIcon = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
    <path
      fillRule="evenodd"
      d="M6.374 5.017 4.897 4.499c-.247-.086-.484.151-.398.398l.518 1.477c.349.992.174 2.093-.463 2.929l-.95 1.244c-.158.208-.006.508.256.502l1.564-.037c1.052-.024 2.045.481 2.643 1.346l.89 1.287c.149.216.481.163.556-.088l.448-1.499a3.32 3.32 0 0 1 2.097-2.097l1.499-.448c.251-.075.304-.407.088-.556l-1.287-.89a3.32 3.32 0 0 1-1.346-2.643l.037-1.564c.006-.262-.294-.414-.502-.256l-1.244.95a3.32 3.32 0 0 1-2.929.463Zm-1.573-2.207c-1.236-.433-2.424.755-1.991 1.991l.734 2.09a1.32 1.32 0 0 1-.232 1.465l-1.344 1.761c-.794 1.041-.031 2.539 1.279 2.508l2.214-.052c.526-.012 1.022.241 1.321.674l1.26 1.821c.745 1.078 2.405.815 2.781-.44l.635-2.122c.15-.504.544-.898 1.048-1.048l2.122-.635c1.255-.376 1.518-2.036.44-2.781l-1.821-1.26a1.32 1.32 0 0 1-.674-1.321l.052-2.214c.031-1.31-1.467-2.073-2.509-1.279l-1.76 1.344a1.32 1.32 0 0 1-1.465.232l-2.09-.734Z"
    />
    <path d="M12.387 13.729a.9.9 0 1 1 1.344-1.344l3.384 2.722a1.5 1.5 0 1 1-1.885 2.007l-2.72-3.385Z" />
  </svg>
)

const PolicyIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4.4 2.75h6.8c.8 0 1.4.6 1.4 1.4v5.9" />
    <path d="M4.4 2.75c-.8 0-1.4.6-1.4 1.4v9.1c0 .8.6 1.4 1.4 1.4h2.9" />
    <path d="M6 5.8h5M6 8.5h3.3" />
    <path d="m10.1 13.3 3.65-3.65 1.55 1.55-3.65 3.65-2.05.5.5-2.05Z" />
  </svg>
)

const LogoutIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8.2 3H5.6A1.6 1.6 0 0 0 4 4.6v8.8A1.6 1.6 0 0 0 5.6 15h2.6" />
    <path d="M10.7 5.7 14 9l-3.3 3.3M7.5 9H14" />
  </svg>
)

const VoiceIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3.2 7.2h2.1l3.1-2.5v8.6L5.3 10.8H3.2V7.2Z" />
    <path d="M11 6.1c1.55 1.6 1.55 4.2 0 5.8" />
    <path d="M12.6 4.5c2 2.5 2 6.5 0 9" />
  </svg>
)

/** 页尾的「恢复本页默认」：居中的弱化按钮，避免和可跳转的设置项混淆 */
const ResetRow = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" className={styles.resetRow} onClick={onClick}>
    {label}
  </button>
)

const Group = ({
  label,
  children,
  spaced,
}: {
  label?: string
  children: ReactNode
  spaced?: boolean
}) => (
  <section className={styles.group} data-spaced={spaced ? '' : undefined}>
    {label ? <h2>{label}</h2> : null}
    <div className={styles.card}>{children}</div>
  </section>
)

const Row = ({
  label,
  icon,
  value,
  onClick,
  href,
  control,
  danger = false,
  disabled = false,
  arrow = Boolean(onClick || href),
}: {
  label: string
  icon?: ReactNode
  value?: string
  onClick?: () => void
  href?: string
  control?: ReactNode
  danger?: boolean
  disabled?: boolean
  arrow?: boolean
}) => {
  const contents = (
    <>
      <span className={styles.icon}>{icon ?? <FeatureIcon label={label} />}</span>
      <span className={styles.rowLabel}>{label}</span>
      {value ? <span className={styles.value}>{value}</span> : null}
      {control}
      {arrow ? (
        <span className={styles.arrow}>
          <IconChevronRightOutline14 />
        </span>
      ) : null}
    </>
  )
  if (href) {
    return (
      <a className={styles.row} href={href}>
        {contents}
      </a>
    )
  }
  if (onClick) {
    return (
      <button
        type="button"
        className={styles.row}
        data-danger={danger}
        disabled={disabled}
        onClick={onClick}
      >
        {contents}
      </button>
    )
  }
  return <div className={styles.row}>{contents}</div>
}

const Switch = ({
  label,
  checked,
  toggle,
}: {
  label: string
  checked: boolean
  toggle?: () => void
}) => (
  <button
    type="button"
    className={styles.switch}
    role="switch"
    aria-label={label}
    aria-checked={checked}
    disabled={!toggle}
    onClick={toggle}
  >
    <span />
  </button>
)

const CostRow = ({
  label,
  description,
  impact,
  checked,
  toggle,
  disabled = false,
}: {
  label: string
  description: string
  impact: 'high' | 'mid' | 'low'
  checked: boolean
  toggle?: () => void
  disabled?: boolean
}) => (
  <div className={styles.costRow} data-disabled={disabled ? '' : undefined}>
    <div className={styles.costCopy}>
      <div className={styles.costTitle}>
        <strong>{label}</strong>
        <i data-impact={impact}>
          {impact === 'high' ? '高开销' : impact === 'mid' ? '中等' : '很低'}
        </i>
      </div>
      <p>{description}</p>
    </div>
    <Switch label={label} checked={checked} toggle={disabled ? undefined : toggle} />
  </div>
)

const ParamField = ({
  label,
  value,
  placeholder,
  min,
  max,
  step,
  integer = false,
  onChange,
}: {
  label: string
  value: number | null
  placeholder: string
  min: number
  max: number
  step: number
  integer?: boolean
  onChange: (value: number | null) => void
}) => {
  const [text, setText] = useState(value === null ? '' : String(value))
  useEffect(() => {
    setText(value === null ? '' : String(value))
  }, [value])
  const commit = () => {
    const raw = text.trim()
    if (!raw) {
      onChange(null)
      return
    }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) {
      setText(value === null ? '' : String(value))
      return
    }
    const next = Math.min(max, Math.max(min, integer ? Math.round(parsed) : parsed))
    setText(String(next))
    onChange(next)
  }
  return (
    <label className={styles.paramRow}>
      <span className={styles.paramLabel}>{label}</span>
      <input
        className={styles.paramInput}
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

const Choice = <T extends string>({
  title,
  icon,
  value,
  fields,
  confirmLabel,
  confirm,
  onSelect,
  hint,
  dismiss,
}: {
  title: string
  icon?: ReactNode
  value: T
  fields: ReadonlyArray<{ id: T; label: string; description?: string }>
  confirmLabel?: string
  confirm: (value: T) => void
  /** 点选项时立即应用，不等确认，用来做即时预览 */
  onSelect?: (value: T) => void
  hint?: string
  dismiss: () => void
}) => {
  const t = useTranslate()
  const [next, setNext] = useState(value)
  return (
    <div
      className={styles.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          dismiss()
        }
      }}
    >
      <section className={styles.choice} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          {icon}
          {title}
        </header>
        <div className={styles.options} role="radiogroup" aria-label={title}>
          {fields.map((field) => (
            <button
              key={field.id}
              type="button"
              role="radio"
              aria-checked={next === field.id}
              onClick={() => {
                setNext(field.id)
                onSelect?.(field.id)
              }}
            >
              <span className={styles.optionText}>
                <span>{field.label}</span>
                {field.description ? <small>{field.description}</small> : null}
              </span>
            </button>
          ))}
        </div>
        {hint ? <p className={styles.choiceHint}>{hint}</p> : null}
        <button type="button" className={styles.confirm} onClick={() => confirm(next)}>
          {confirmLabel ?? t('confirm')}
        </button>
      </section>
    </div>
  )
}

type BackupText = (zh: string, en: string) => string

/** 间隔显示：不足一小时用分钟，整小时用小时，跨小时零头按「x 小时 y 分钟」 */
/** 备份间隔数值显示：最多两位小数，去掉无意义的尾零 */
export const formatIntervalNumber = (value: number) => {
  const rounded = Math.round(value * 100) / 100
  return String(rounded)
}

export const formatBackupInterval = (minutes: number, tr: BackupText) => {
  if (minutes < 60) {
    return tr(`${minutes} 分钟`, `${minutes} min`)
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return tr(`${hours} 小时`, `${hours} h`)
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return tr(`${hours} 小时 ${rest} 分钟`, `${hours} h ${rest} min`)
}

/** 备份间隔预设（分钟）：10 分钟到 1 天 */
const BACKUP_PRESETS = [10, 30, 60, 120, 240, 480, 720, 1440]

/** 备份失败按失败位置给不同说明：建文件、写入、收尾各自的原因不同 */
const describeBackupFailure = (result: AutoBackupResult, tr: BackupText) => {
  const tail = result.detail ? tr(`（${result.detail}）`, ` (${result.detail})`) : ''
  switch (result.failure) {
    case 'bridge':
      return tr(
        '当前安装包不支持备份到下载目录，可用「导出历史」保存一份',
        'This build cannot back up to Downloads; use Export history instead'
      )
    case 'begin':
      return tr(
        `系统没能创建备份文件，请确认「下载」目录可用${tail}`,
        `The system could not create the file${tail}`
      )
    case 'write':
      return tr(
        `备份写入中断，检查剩余存储空间${tail}`,
        `Writing was interrupted; check free space${tail}`
      )
    case 'verify':
      return tr(
        `备份文件未通过完整性校验，临时文件已删除，可重新备份${tail}`,
        `The backup failed its integrity check; the temporary file was removed${tail}`
      )
    case 'finish':
      return tr(
        `完整文件没能发布到下载目录，未完成文件已删除，请稍后重试${tail}`,
        `The complete file could not be published; the unfinished file was removed${tail}`
      )
    default:
      return tr('备份没有完成，请稍后重试', 'Backup did not finish, try again later')
  }
}

/* -------------------- 功能区：页面类型与通用控件 结束 -------------------- */

/* -------------------- 功能区：设置模块入口 开始 -------------------- */
export const AndroidSettings = ({ chatFrame }: { chatFrame: RefObject<HTMLDivElement> }) => {
  const open = useSettingsDialog((state) => state.open)
  const section = useSettingsDialog((state) => state.section)
  const start: Page =
    section === 'general'
      ? 'root'
      : section === 'advanced'
        ? 'advanced'
        : section === 'data'
          ? 'data'
          : section === 'roleplay'
            ? 'roleplay'
            : section === 'memory'
              ? 'memory'
              : section === 'sampling'
                ? 'sampling'
                : 'account'
  return open ? <Settings start={start} chatFrame={chatFrame} key={section} /> : null
}

/* -------------------- 功能区：设置模块入口 结束 -------------------- */

/* -------------------- 功能区：设置页状态、派生数据与副作用 开始 -------------------- */
const Settings = ({ start, chatFrame }: { start: Page; chatFrame: RefObject<HTMLDivElement> }) => {
  const t = useTranslate()
  const [imageModel, setImageModel] = useState('')
  const [imageSize, setImageSize] = useState('')
  const {
    accountProfile,
    locale,
    localePreference,
    themePreference,
    accentColor,
    bubbleRadius,
    messageSpacing,
    fontSize,
    foldThinking,
    ttsVoice,
    chatConfig,
    systemPrompt,
    temperature,
    topP,
    maxTokens,
    rpTemperature,
    rpTopP,
    rpMaxTokens,
    keepRefusedContent,
    autoCompact,
    thinkingEffort,
    thinking,
    search,
    customHeaders,
    safetyCheck,
    sendLatestReminder,
    autoTitle,
    allowRefusedContext,
    refusalEnabled,
    refusalKeywords,
    refusalCaseSensitive,
    refusalMessage,
    autoBackup,
    autoBackupMinutes,
    characterName,
    characterProfile,
    profileEnabled,
    characterAvatar,
    avatarInChat,
    thoughtAside,
    memoryBadge,
    memoryInline,
    suppressMetaTalk,
    chatLayout,
    characterAvatarSize,
    userAvatarSize,
    avatarShape,
    tokenLimit,
    showUsage,
    usageBelow,
    autoFollow,
    memoryMode,
    memoryLimit,
    memoryChars,
    normalMemoryEnabled,
    normalMemoryLimit,
    normalMemoryChars,
    characterCards,
    activeCharacterId,
    roleplayEnabled,
    worldbook,
    worldbookInject,
    sceneAutoUpdate,
  } = useSettings()
  const tr = (chinese: string, english: string) => (locale === 'zh-CN' ? chinese : english)
  // 角色卡启用时，卡名只用于卡本身与当前会话；档案名始终显示手写值，不被卡名替换
  const activeCharacterCard = roleplayEnabled
    ? findActiveCharacterCard(characterCards, activeCharacterId)
    : undefined
  const systemCharacterName = resolveSystemCharacterName(activeCharacterCard?.name, characterName)
  const systemNameSource = activeCharacterCard
    ? tr('当前角色卡（不写入档案）', 'Active card (does not write the profile)')
    : characterName.trim()
      ? profileEnabled
        ? tr('基础档案', 'Base profile')
        : tr('档案名（档案已关闭，仍保留身份行）', 'Profile name (profile off, identity line kept)')
      : tr('默认 AI', 'Default AI')
  const profileFields = characterProfileFieldCount(characterProfile)
  const profileTotal = CHARACTER_PROFILE_FIELDS.length
  const profileGroups = CHARACTER_PROFILE_GROUPS.map((group) => ({
    ...group,
    fields: CHARACTER_PROFILE_FIELDS.filter((field) => field.group === group.key),
  }))
  const promptState = systemPrompt.trim()
    ? systemPrompt === DEFAULT_SYSTEM_PROMPT
      ? tr('提示词默认', 'prompt default')
      : tr('提示词自定义', 'prompt custom')
    : tr('提示词已清空', 'prompt empty')
  const accountName = accountProfile.username || tr('未设置名称', 'No name')
  const compactChars = (value: number) =>
    value >= 1_000_000
      ? `${Number((value / 1_000_000).toFixed(1))}M`
      : `${Math.round(value / 1_000)}K`
  const memoryModeLabel =
    memoryMode === 'off'
      ? tr('已关闭', 'Off')
      : memoryMode === 'refine'
        ? tr('自动提炼', 'Refined')
        : tr('整轮记录', 'Per turn')
  const costItems = [
    thinking,
    search,
    worldbookInject,
    memoryMode !== 'off',
    sceneAutoUpdate,
    memoryMode === 'refine',
    autoCompact,
    autoTitle,
    sendLatestReminder,
  ]
  const costClosed = costItems.filter((item) => !item).length
  const refusalCount = refusalKeywords
    .split(/\r?\n|[，,、;；]/)
    .map((item) => item.trim())
    .filter(Boolean).length
  const [page, setPage] = useState<Page>(start)
  const [popup, setPopup] = useState<Popup | null>(null)
  const [usageOpen, setUsageOpen] = useState(false)
  const [tokenDraft, setTokenDraft] = useState('')
  const [backupDraft, setBackupDraft] = useState('')
  const [backupUnit, setBackupUnit] = useState<'minute' | 'hour'>('minute')
  const [memoryBusy, setMemoryBusy] = useState(false)
  const [memoryExportPool, setMemoryExportPool] = useState<'all' | 'normal' | 'character'>('all')
  const [memoryExportKinds, setMemoryExportKinds] = useState<NormalMemoryKind[]>([
    ...NORMAL_MEMORY_KINDS,
  ])
  const [memoryImportMode, setMemoryImportMode] = useState<MemoryImportMode>('merge')
  const [bundleBusy, setBundleBusy] = useState(false)
  const [diagBusy, setDiagBusy] = useState(false)
  const [rootQuery, setRootQuery] = useState('')
  const bundleInput = useRef<HTMLInputElement | null>(null)
  const [memoryStatus, setMemoryStatus] = useState<{
    type: 'info' | 'done' | 'error'
    text: string
  } | null>(null)
  const [settingBusy, setSettingBusy] = useState(false)
  const [settingStatus, setSettingStatus] = useState<{
    type: 'info' | 'done' | 'error'
    text: string
  } | null>(null)
  const settingInput = useRef<HTMLInputElement>(null)
  const [tone, setTone] = useState(ttsVoice)
  const [busy, setBusy] = useState(false)
  // 只有导入/删除这类会改动本地数据的动作才阻止返回；导出、备份可能等待原生文件选择，
  // 若也用它挡住 back()，用户会在一段时间内看到“按钮和返回都没反应”。
  const [blockingBusy, setBlockingBusy] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const memoryInput = useRef<HTMLInputElement>(null)
  const chooseCharacterAvatar = async (event: { target: HTMLInputElement }) => {
    const picked = event.target.files?.[0]
    event.target.value = ''
    if (!picked) {
      return
    }
    setAvatarBusy(true)
    try {
      setCharacterAvatar(await prepareAvatar(picked))
    } catch {
      showToast({ key: 'profileAvatarInvalid', type: 'error' })
    } finally {
      setAvatarBusy(false)
    }
  }
  const [importMode, setImportMode] = useState<ImportMode>('merge')
  const [importStatus, setImportStatus] = useState<LinkedMessage | null>(null)
  const [exportSavedName, setExportSavedName] = useState<string | null>(null)
  const [backupStatus, setBackupStatus] = useState<AutoBackupStatus | null>(null)
  const [backingUp, setBackingUp] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const motionRef = useRef<ReturnType<typeof createSettingsPageMotion>>()
  const enterNext = useRef(true)
  const exiting = useRef(false)
  const sessions = useChatStore((state) => state.sessions.length)
  const editor = useApiKeyEditor()

  useEffect(() => {
    if (page === 'data') {
      setBackupStatus(readAutoBackupStatus())
    }
  }, [page])

  const labels: Record<Page, string> = {
    root: t('settings'),
    account: t('accountManagement'),
    advanced: t('advancedSettings'),
    character: tr('角色档案与表达', 'Character profile & delivery'),
    roleplay: tr('角色卡与世界书', 'Character cards & lorebook'),
    sampling: tr('生成参数', 'Sampling'),
    request: tr('接口与请求', 'Endpoint & request'),
    context: tr('上下文与拒答', 'Context & refusal'),
    cost: tr('Token 与费用', 'Token & cost'),
    memory: tr('长期记忆', 'Long-term memory'),
    refusal: tr('关键词拒答', 'Keyword refusal'),
    data: tr('数据管理', 'Data management'),
    export: t('exportAllLabel'),
    font: tr('字体大小', 'Text size'),
    personalization: tr('个性化', 'Personalization'),
    agreements: tr('服务协议', 'Service agreement'),
  }
  const desktopNavigation: {
    label: string
    items: { page: Page; label: string; icon: string }[]
  }[] = [
    {
      label: tr('总览', 'Overview'),
      items: [{ page: 'root', label: tr('设置首页', 'Settings home'), icon: tr('设置首页', 'Settings home') }],
    },
    {
      label: tr('账户与数据', 'Account & data'),
      items: [
        { page: 'account', label: labels.account, icon: labels.account },
        { page: 'data', label: labels.data, icon: labels.data },
        { page: 'cost', label: labels.cost, icon: labels.cost },
      ],
    },
    {
      label: tr('角色与扮演', 'Role & role-play'),
      items: [
        { page: 'character', label: labels.character, icon: labels.character },
        { page: 'roleplay', label: labels.roleplay, icon: labels.roleplay },
        { page: 'memory', label: labels.memory, icon: labels.memory },
      ],
    },
    {
      label: tr('生成与请求', 'Generation & request'),
      items: [
        { page: 'sampling', label: labels.sampling, icon: labels.sampling },
        { page: 'context', label: labels.context, icon: labels.context },
        { page: 'request', label: labels.request, icon: labels.request },
        { page: 'refusal', label: labels.refusal, icon: labels.refusal },
      ],
    },
    {
      label: tr('应用与关于', 'App & about'),
      items: [
        {
          page: 'personalization',
          label: labels.personalization,
          icon: labels.personalization,
        },
        { page: 'font', label: labels.font, icon: labels.font },
        { page: 'agreements', label: labels.agreements, icon: labels.agreements },
      ],
    },
  ]
  const activeNavigationPage: Page = page === 'advanced' ? 'account' : page === 'export' ? 'data' : page
  const headerCount = Object.keys(parseCustomHeaders(customHeaders)).length
  const formatBackupTime = (date: number) =>
    new Date(date).toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  const formatBackupSize = (bytes: number) =>
    bytes >= 1_048_576
      ? `${(bytes / 1_048_576).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1_024))} KB`
  const language = tr('语言', 'Language')
  const appearance = tr('外观', 'Appearance')
  const voice = tr('朗读音色', 'Read-aloud voice')
  const autoFold = tr('思考内容自动折叠', 'Collapse thinking automatically')
  const follow = tr('跟随系统', 'Follow system')
  const logout = tr('退出登录', 'Sign out')
  const clear = tr('删除所有历史对话', 'Delete all conversations')
  const themes: { id: ThemePreference; label: string; description: string }[] = [
    {
      id: 'system',
      label: tr('系统', 'System'),
      description: tr(
        '跟随系统深浅设置，系统切换时同步变化。',
        'Follows the system light/dark setting.'
      ),
    },
    {
      id: 'light',
      label: tr('浅色', 'Light'),
      description: tr('固定使用浅色界面，不随系统切换。', 'Always uses the light interface.'),
    },
    {
      id: 'dark',
      label: tr('深色', 'Dark'),
      description: tr('固定使用深色界面，降低暗光环境亮度。', 'Always uses the dark interface.'),
    },
  ]
  const layouts: { id: ChatLayout; label: string; description: string }[] = [
    {
      id: 'card',
      label: tr('原版卡片', 'Cards'),
      description: tr('原版卡片结构，信息密度较高。', 'Original card layout with higher density.'),
    },
    {
      id: 'wechat',
      label: tr('气泡 · 微信配色', 'Bubble · green'),
      description: tr(
        '绿色气泡，接近常见即时通讯样式。',
        'Green bubbles in a familiar messenger style.'
      ),
    },
    {
      id: 'blue',
      label: tr('气泡 · 蓝白配色', 'Bubble · blue'),
      description: tr(
        '蓝白气泡，中性配色，适合浅色与深色主题。',
        'Blue-and-white bubbles for both themes.'
      ),
    },
  ]
  const languages: { id: LocalePreference; label: string; description: string }[] = [
    {
      id: 'system',
      label: tr('系统', 'System'),
      description: tr('跟随系统语言，在中文与英文界面间自动切换。', 'Follows the system language.'),
    },
    {
      id: 'zh-CN',
      label: '中文 (简体中文)',
      description: tr('界面固定为简体中文。', 'Interface fixed to Simplified Chinese.'),
    },
    {
      id: 'en-US',
      label: 'English',
      description: tr('界面固定为英文。', 'Interface fixed to English.'),
    },
  ]
  const tones: { id: TtsVoice; label: string; description: string }[] = [
    {
      id: 'stella',
      label: t('settingsTtsVoiceStella'),
      description: t('settingsTtsVoiceStellaDescription'),
    },
    {
      id: 'tide',
      label: t('settingsTtsVoiceTide'),
      description: t('settingsTtsVoiceTideDescription'),
    },
  ]
  const currentTone = tones.find((item) => item.id === tone) ?? tones[0]
  const systemFontStep = Math.min(
    6,
    Math.max(0, Math.round(((android?.systemFontScale() ?? 1) - 1) / 0.1 + 2))
  )
  const languageLabel = languages.find((item) => item.id === locale)?.label
  const themeLabel = themes.find((item) => item.id === themePreference)?.label
  const layoutLabel = layouts.find((item) => item.id === chatLayout)?.label
  const localizedPoliciesUrl = `${policiesUrl}/${locale}`

  const openPage = (next: Page) => {
    if (exiting.current) {
      return
    }
    closeOverlaySider()
    enterNext.current = true
    setPage(next)
  }

  const back = () => {
    if (exiting.current) {
      return
    }
    if (usageOpen) {
      setUsageOpen(false)
      return
    }
    if (popup) {
      if (blockingBusy) {
        return
      }
      setPopup(null)
      setFile(null)
      return
    }
    if (blockingBusy) {
      return
    }
    const finish = () => {
      const previous = parentPage[page]
      if (previous) {
        enterNext.current = false
        setPage(previous)
      } else {
        closeSettings()
      }
    }
    const motion = motionRef.current
    if (!motion) {
      finish()
      return
    }
    closeOverlaySider()
    exiting.current = true
    let settled = false
    let timer = 0
    const release = (completed: boolean) => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        window.clearTimeout(timer)
        timer = 0
      }
      // 组件或页面 motion 已替换时，旧回调只负责解锁，不再操作新页面。
      if (motionRef.current !== motion) {
        exiting.current = false
        return
      }
      if (completed) {
        finish()
      } else {
        exiting.current = false
      }
    }
    // 动画 Promise 在旧 WebView、系统挂起或渲染线程停帧时可能永远不结束。
    // 超过一次转场的合理等待时间就强制完成返回，避免设置页整页点不动。
    timer = window.setTimeout(() => release(true), 900)
    try {
      const transition = motion.play('back')
      Promise.resolve(transition).then(release, () => release(true))
    } catch {
      release(true)
    }
  }

  const backRef = useRef(back)
  backRef.current = back

  useAndroidBackInterception()
  useLayoutEffect(() => {
    const pages = pagesRef.current
    const getPage = (screen: Page) =>
      pages?.querySelector<HTMLElement>(`[data-settings-page="${screen}"]`)
    const settings = getPage(page)
    const content = settings?.querySelector<HTMLElement>(`.${styles.pageContent}`)
    if (!settings || !content) {
      return
    }
    const parent = parentPage[page]
    const previous = parent
      ? (getPage(parent)?.querySelector<HTMLElement>(`.${styles.pageContent}`) ?? null)
      : chatFrame.current
    exiting.current = false
    const motion = createSettingsPageMotion(settings, content, previous)
    motionRef.current = motion
    if (enterNext.current) {
      void motion.play('enter').then((finished) => {
        if (finished && motionRef.current === motion && !exiting.current) {
          motion.cancel()
          closeOverlaySider()
        }
      })
    }
    return () => {
      motionRef.current = undefined
      motion.cancel()
    }
  }, [chatFrame, page])

  const canPreview = page !== 'font' && popup === null && !busy
  useLayoutEffect(() => {
    const motion = motionRef.current
    if (!canPreview || !motion) {
      return
    }
    let previewing = false
    const unsubscribe = subscribeToAndroidBackPreview((preview) => {
      if (!exiting.current) {
        if (preview && !previewing) {
          closeOverlaySider()
        }
        previewing = Boolean(preview)
        motion.seek(preview?.progress ?? 0)
      }
    })
    return () => {
      unsubscribe?.()
      if (previewing && !exiting.current && motionRef.current === motion) {
        motion.seek(0)
      }
    }
  }, [canPreview, page])

  useEffect(() => {
    const onBack = (event: Event) => {
      event.preventDefault()
      backRef.current()
    }
    window.addEventListener('android-back', onBack)
    return () => window.removeEventListener('android-back', onBack)
  }, [])

  /** 设定存档：基础档案、角色卡、头像、世界书与场景打包成一个 JSON，换机或分享设定时单独迁移 */
  const exportSettings = async () => {
    const { characterCards, cardAvatars, worldbook, scene, characterProfile, profileEnabled } =
      useSettings.getState()
    const archive = buildSettingArchive({
      profile: characterProfile,
      profileEnabled,
      cards: characterCards,
      avatars: cardAvatars,
      worldbook,
      scene,
    })
    const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' })
    const name = settingArchiveName(archive.cards.length)
    setSettingBusy(true)
    setSettingStatus({ type: 'info', text: tr('正在打包设定…', 'Packing settings…') })
    try {
      if (android) {
        if (!(await saveAndroidHistory(name, blob))) {
          setSettingStatus({ type: 'error', text: tr('保存被取消', 'Saving was cancelled') })
          return
        }
      } else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = name
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      }
      setSettingStatus({
        type: 'done',
        text: tr(`已保存 ${name}`, `Saved ${name}`),
      })
    } catch {
      setSettingStatus({
        type: 'error',
        text: tr(
          '导出失败，请重试并确认系统允许本应用写入文件',
          'Export failed. Retry and confirm the app has permission to write files.'
        ),
      })
    } finally {
      setSettingBusy(false)
    }
  }

  /** 导入设定：同 id 覆盖，新条目按剩余名额追加；结果按处理项与跳过项分别说明 */
  const importSettings = async (file: File) => {
    setSettingBusy(true)
    setSettingStatus({ type: 'info', text: tr('正在读取设定…', 'Reading settings…') })
    try {
      const archive = parseSettingArchive(await file.text())
      const state = useSettings.getState()
      const result = applySettingArchive(
        archive,
        { cards: state.characterCards, worldbook: state.worldbook },
        {
          saveCard: saveCharacterCard,
          saveAvatar: (cardId, avatar) => setCardAvatar(cardId, avatar),
          saveEntry: saveWorldbookEntry,
          saveScene: (scene) => replaceScene(scene),
          saveProfile: (profile) => replaceCharacterProfile(profile),
          saveProfileEnabled: setCharacterProfileEnabled,
        }
      )
      const skipped = result.cardsSkipped + result.worldbookSkipped
      setSettingStatus({
        type: 'done',
        text: tr(
          `已导入 ${result.cards} 张角色卡、${result.worldbook} 条世界书、${result.avatars} 张头像${
            result.profile ? '、1 份基础档案' : ''
          }${skipped > 0 ? `，${skipped} 项因超出上限被跳过` : ''}`,
          `Imported ${result.cards} cards, ${result.worldbook} worldbook entries, ${result.avatars} avatars${
            result.profile ? ', 1 base profile' : ''
          }${skipped > 0 ? `; ${skipped} skipped due to limits` : ''}`
        ),
      })
    } catch (error) {
      const code = error instanceof SettingArchiveError ? error.code : null
      const text =
        code === 'json'
          ? tr('文件不是有效的 JSON', 'The file is not valid JSON')
          : code === 'format'
            ? tr('不是本应用的设定存档', 'Not a settings archive from this app')
            : code === 'version'
              ? tr('存档版本与当前版本不一致', 'Archive version does not match this build')
              : code === 'empty'
                ? tr(
                    '存档里没有基础档案、角色卡或世界书',
                    'The archive has no profile, cards or worldbook entries'
                  )
                : code === 'write'
                  ? tr(
                      '写入失败，可能是本机存储空间不足',
                      'Write failed; local storage may be full'
                    )
                  : error instanceof Error
                    ? error.message
                    : String(error)
      setSettingStatus({ type: 'error', text })
    } finally {
      setSettingBusy(false)
    }
  }

  const runExportAction = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      showToast({
        key: 'historyExportFailed',
        params: { message: error instanceof Error ? error.message : String(error) },
        type: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const performMemoryExport = async (options?: MemoryExportOptions) => {
    setMemoryStatus({ type: 'info', text: tr('正在整理记忆…', 'Collecting memories…') })
    setMemoryBusy(true)
    try {
      const exported = await exportMemory((done, total) => {
        if (total > 0) {
          setMemoryStatus({
            type: 'info',
            text: tr(
              `正在整理记忆：${done}/${total} 个对话`,
              `Collecting memories: ${done}/${total} chats`
            ),
          })
        }
      }, options)
      if (exported.cards === 0) {
        setMemoryStatus({
          type: 'info',
          text: tr(
            '所选分类尚无记忆卡片。换一个分类或先保存几条记忆再导出。',
            'No cards in the selected categories. Pick another category or save a few memories first.'
          ),
        })
        return
      }
      if (android) {
        const saved = await saveAndroidHistory(exported.name, exported.blob)
        setMemoryStatus({
          type: saved ? 'done' : 'info',
          text: saved
            ? tr(
                `已导出 ${exported.cards} 张卡片（${exported.sessions} 个对话）：${exported.name}`,
                `Exported ${exported.cards} cards from ${exported.sessions} chats: ${exported.name}`
              )
            : tr('已取消保存', 'Save cancelled'),
        })
        return
      }
      const url = URL.createObjectURL(exported.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = exported.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setMemoryStatus({
        type: 'done',
        text: tr(
          `已导出 ${exported.cards} 张卡片：${exported.name}`,
          `Exported ${exported.cards} cards: ${exported.name}`
        ),
      })
    } catch (error) {
      setMemoryStatus({
        type: 'error',
        text: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setMemoryBusy(false)
    }
  }

  const confirmAction = async () => {
    if (busy) {
      return
    }
    if (popup === 'logout') {
      if (setApiKey(null)) {
        closeSettings()
      } else {
        showToast({ key: 'apiKeyStorageFailed' })
      }
      return
    }
    setBusy(true)
    setBlockingBusy(true)
    try {
      if (popup === 'import' && file) {
        setPopup(null)
        setFile(null)
        setImportStatus({ key: 'historyImporting' })
        const result = await importHistory(file, setImportStatus, importMode)
        setImportStatus(formatImportResult(result))
      } else if (popup === 'delete') {
        await clearHistory()
        showToast({ key: 'historyDeleted' })
        setPopup(null)
      }
    } catch (error) {
      if (popup === 'import') {
        setImportStatus({
          key: error instanceof BackupError ? error.key : 'historyImportFailed',
          type: 'error',
        })
      } else {
        showToast({ key: 'historyDeleteFailed', type: 'error' })
      }
    } finally {
      setBusy(false)
      setBlockingBusy(false)
    }
  }

  useEffect(() => {
    setImageModel(chatConfig.imageModel ?? '')
    setImageSize(chatConfig.imageSize ?? '')
  }, [chatConfig.imageModel, chatConfig.imageSize])

  const searchIndex: Array<{ label: string; keys: string; run: () => void }> = [
    {
      label: labels.character,
      keys: '角色档案 角色设定 基础档案 人设 档案开关 年龄 性别 代词 种族 生日 职业 居住地 语言 身高 体重 外貌 食物 饮品 兴趣 作息 随身物 宠物 性格 价值观 雷点 底线 配合 经历 关系 处境 目标 弱点 说话 秘密 补充设定 system prompt 提示词 独白 动作',
      run: () => openPage('character'),
    },
    {
      label: labels.roleplay,
      keys: '角色卡 世界书 场景 扮演 rp card worldbook',
      run: () => openPage('roleplay'),
    },
    {
      label: labels.memory,
      keys: '长期记忆 记忆卡片 注入 归档 memory',
      run: () => openPage('memory'),
    },
    {
      label: labels.sampling,
      keys: '采样 温度 temperature top p 最大输出 token',
      run: () => openPage('sampling'),
    },
    { label: labels.context, keys: '上下文 压缩 预算 context', run: () => openPage('context') },
    {
      label: labels.cost,
      keys: '省钱 省 token 费用 消耗 关闭 推理 搜索 世界书 记忆 压缩 标题',
      run: () => openPage('cost'),
    },
    {
      label: labels.request,
      keys: '接口 请求 endpoint 请求头 安全审核',
      run: () => openPage('request'),
    },
    {
      label: tr('生成配图', 'Illustration'),
      keys: '生图 绘图 配图 插画 图片模型 图片尺寸 image model size',
      run: () => openPage('request'),
    },
    {
      label: tr('绘图模型', 'Image model'),
      keys: '绘图模型 生图模型 image model gpt-image',
      run: () => openPage('request'),
    },
    {
      label: tr('绘图尺寸', 'Image size'),
      keys: '绘图尺寸 图片大小 image size 1024x1024',
      run: () => openPage('request'),
    },
    { label: labels.refusal, keys: '关键词 拒答 refusal', run: () => openPage('refusal') },
    { label: language, keys: '语言 中文 english locale', run: () => setPopup('locale') },
    {
      label: appearance,
      keys: '外观 深色 浅色 主题 dark light theme',
      run: () => setPopup('theme'),
    },
    {
      label: tr('主题色', 'Accent color'),
      keys: '主题色 强调色 配色 accent color',
      run: () => setPopup('accent'),
    },
    {
      label: tr('气泡圆角', 'Bubble corners'),
      keys: '气泡 圆角 形状 bubble radius',
      run: () => setPopup('bubbleRadius'),
    },
    {
      label: tr('消息间距', 'Message spacing'),
      keys: '间距 紧凑 宽松 spacing gap',
      run: () => setPopup('messageSpacing'),
    },
    {
      label: tr('聊天布局', 'Chat layout'),
      keys: '布局 卡片 气泡 layout',
      run: () => setPopup('layout'),
    },
    {
      label: tr('流式跟随', 'Follow while streaming'),
      keys: '流式 跟随 自动滚动 follow stream',
      run: () => setAutoFollow(!autoFollow),
    },
    {
      label: tr('字体大小', 'Font size'),
      keys: '字体 字号 font size',
      run: () => openPage('font'),
    },
    {
      label: labels.personalization,
      keys: '个性化 折叠 思考 personalization thinking',
      run: () => openPage('personalization'),
    },
    {
      label: labels.account,
      keys: '账号 账户 账户名 用户名 登录 account',
      run: () => openPage('account'),
    },
    {
      label: labels.data,
      keys: '数据 备份 导出 导入 记忆归档 会话包 诊断 backup data',
      run: () => openPage('data'),
    },
    {
      label: tr('Token 统计', 'Token usage'),
      keys: 'Token 用量 统计 usage 输入 输出 缓存 命中 未命中',
      run: () => setUsageOpen(true),
    },
    {
      label: tr('运行诊断并保存日志', 'Run diagnostics & save log'),
      keys: '诊断 日志 排查 diagnose log',
      run: () => openPage('data'),
    },
    {
      label: labels.agreements,
      keys: '协议 隐私 权限 第三方 agreements',
      run: () => openPage('agreements'),
    },
  ]
  const rootMatches = rootQuery.trim()
    ? searchIndex.filter((item) =>
        `${item.label} ${item.keys}`.toLowerCase().includes(rootQuery.trim().toLowerCase())
      )
    : []

  /* -------------------- 功能区：设置页状态、派生数据与副作用 结束 -------------------- */

  /* -------------------- 功能区：各设置页渲染与页面分发 开始 -------------------- */
  const renderPage = (screen: Page) => (
    <>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.back}
          aria-label={tr('返回', 'Back')}
          onClick={back}
        >
          <IconChevronRightOutline14 />
        </button>
        <h1>{labels[screen]}</h1>
      </header>
      <div className={styles.scroll}>
        {screen === 'root' ? (
          <>
            <div className={styles.settingsSearch}>
              <input
                value={rootQuery}
                onChange={(event) => setRootQuery(event.target.value)}
                placeholder={tr('搜索设置，直达对应项', 'Search settings')}
                aria-label={tr('搜索设置', 'Search settings')}
              />
              {rootQuery.trim() ? (
                <button
                  type="button"
                  onClick={() => setRootQuery('')}
                  aria-label={tr('清除搜索', 'Clear')}
                >
                  清除
                </button>
              ) : null}
            </div>
            {rootQuery.trim() ? (
              <Group
                label={tr(`搜索结果 · ${rootMatches.length} 项`, `Results · ${rootMatches.length}`)}
              >
                {rootMatches.map((item) => (
                  <Row
                    key={item.label + item.keys}
                    label={item.label}
                    arrow
                    onClick={() => {
                      item.run()
                      setRootQuery('')
                    }}
                  />
                ))}
                {rootMatches.length === 0 ? (
                  <div className={styles.searchEmpty}>
                    {tr('未找到匹配的设置项，请更换关键词', 'No matching setting')}
                  </div>
                ) : null}
              </Group>
            ) : null}
            <Group label={tr('账户与数据', 'Account & data')}>
              {!android ? (
                <Row
                  label="DeepSeek API Key"
                  value={editor.apiKey ? tr('已保存', 'Saved') : tr('未填写', 'Not set')}
                  onClick={() => {
                    openPage('account')
                    editor.setEditing(true)
                  }}
                />
              ) : null}
              <Row
                label={tr('账户', 'Account')}
                value={accountName}
                icon={<ProfileIcon />}
                onClick={() => openPage('account')}
              />
              <Row
                label={labels.data}
                value={tr(`${sessions} 个对话`, `${sessions} chats`)}
                icon={<IconDataOutline16 />}
                onClick={() => openPage('data')}
              />
              <Row
                label={tr('Token 统计', 'Token usage')}
                value={tr('接口 usage · 无估算', 'API usage · measured')}
                onClick={() => setUsageOpen(true)}
              />
              <Row
                label={labels.cost}
                value={tr(
                  `${costItems.length} 项 · 已关 ${costClosed}`,
                  `${costItems.length} items · ${costClosed} off`
                )}
                onClick={() => openPage('cost')}
              />
            </Group>
            <Group label={tr('角色与扮演', 'Role-play')}>
              <Row
                label={labels.character}
                value={tr(
                  `档案 ${profileFields}/${profileTotal}${profileEnabled ? '' : '（已关闭）'} · ${promptState}`,
                  `${profileFields}/${profileTotal} fields${profileEnabled ? '' : ' (off)'} · ${promptState}`
                )}
                onClick={() => openPage('character')}
              />
              <Row
                label={labels.roleplay}
                value={
                  activeCharacterId
                    ? roleplayEnabled
                      ? tr(`启用 · 书 ${worldbook.length} 条`, `On · ${worldbook.length} entries`)
                      : tr('已关闭 · 卡暂停', 'Off · card paused')
                    : tr(
                        `卡 ${characterCards.length} · 书 ${worldbook.length}`,
                        `${characterCards.length} cards · ${worldbook.length} entries`
                      )
                }
                onClick={() => openPage('roleplay')}
              />
              <Row
                label={labels.memory}
                value={
                  memoryMode === 'off'
                    ? tr('已关闭 · 不记录', 'Off · not recording')
                    : tr(
                        `${memoryModeLabel} · 上限 ${compactChars(memoryChars)} 字`,
                        `${memoryModeLabel} · ${compactChars(memoryChars)} chars`
                      )
                }
                onClick={() => openPage('memory')}
              />
            </Group>
            <Group label={tr('生成与请求', 'Generation')}>
              <Row
                label={labels.sampling}
                value={(() => {
                  const parts: string[] = []
                  if (temperature !== null) {
                    parts.push(tr(`温度 ${temperature}`, `Temp ${temperature}`))
                  }
                  if (topP !== null) {
                    parts.push(`Top P ${topP}`)
                  }
                  if (maxTokens !== null) {
                    parts.push(tr(`输出 ${maxTokens}`, `Max ${maxTokens}`))
                  }
                  if (thinkingEffort) {
                    parts.push(tr('已设思考强度', 'Effort set'))
                  }
                  return parts.length ? parts.join(' · ') : tr('默认', 'Default')
                })()}
                onClick={() => openPage('sampling')}
              />
              <Row
                label={labels.context}
                value={tr(
                  `压缩${autoCompact ? '开' : '关'} · 拒答${keepRefusedContent ? '保留' : '占位'}${allowRefusedContext ? ' · 入上下文' : ''}`,
                  `Compact ${autoCompact ? 'on' : 'off'} · refused ${keepRefusedContent ? 'kept' : 'placeholder'}${allowRefusedContext ? ' · in context' : ''}`
                )}
                onClick={() => openPage('context')}
              />
              <Row
                label={labels.request}
                value={tr(
                  `${safetyCheck ? '审核开' : '审核关'} · ${headerCount > 0 ? `${headerCount} 个请求头` : autoTitle ? '自动标题' : '手动标题'}`,
                  `Safety ${safetyCheck ? 'on' : 'off'} · ${headerCount > 0 ? `${headerCount} headers` : autoTitle ? 'auto title' : 'manual title'}`
                )}
                onClick={() => openPage('request')}
              />
              <Row
                label={labels.refusal}
                value={
                  !refusalEnabled
                    ? tr('已关闭', 'Off')
                    : refusalCount > 0
                      ? tr(`${refusalCount} 个关键词`, `${refusalCount} keywords`)
                      : tr('已开启 · 未设关键词', 'On · no keywords')
                }
                onClick={() => openPage('refusal')}
              />
            </Group>
            <Group label={tr('应用', 'App')}>
              <Row
                label={language}
                value={languageLabel}
                icon={<IconGlobeLanguageOutline14 />}
                onClick={() => setPopup('locale')}
              />
              <Row
                label={appearance}
                value={themeLabel}
                icon={<IconLightOutline16 />}
                onClick={() => setPopup('theme')}
              />
              <Row
                label={tr('流式跟随', 'Follow while streaming')}
                value={autoFollow ? tr('开启', 'On') : tr('关闭', 'Off')}
                arrow={false}
                control={
                  <Switch
                    label={tr('流式跟随', 'Follow while streaming')}
                    checked={autoFollow}
                    toggle={() => setAutoFollow(!autoFollow)}
                  />
                }
              />
              <Row
                label={labels.font}
                icon={<span className={styles.fontIcon}>ᴀA</span>}
                onClick={() => openPage('font')}
              />
              <Row
                label={labels.personalization}
                icon={<PersonalizationIcon />}
                onClick={() => openPage('personalization')}
              />
            </Group>
            <Group label={tr('语音', 'Voice')}>
              <Row
                label={voice}
                icon={<VoiceIcon />}
                arrow={false}
                onClick={() => {
                  setTone(ttsVoice)
                  setPopup('voice')
                }}
              />
            </Group>
            <Group label={tr('关于', 'About')}>
              <Row label={tr('版本信息', 'Version')} value={appVersion} />
              <Row
                label={tr('运行诊断并保存日志', 'Run diagnostics & save log')}
                arrow={false}
                onClick={() => {
                  if (diagBusy) {
                    return
                  }
                  setDiagBusy(true)
                  void saveDiagnosticReport()
                    .then((result) => {
                      const count = result.findings.length
                      showToast(
                        result.saved
                          ? tr(
                              count > 0
                                ? `诊断完成：发现 ${count} 项问题，日志已保存为 ${result.name}`
                                : `诊断完成：未发现问题，日志已保存为 ${result.name}`,
                              count > 0
                                ? `Done: ${count} issues found, saved ${result.name}`
                                : `Done: no issues, saved ${result.name}`
                            )
                          : tr('日志未保存', 'Log not saved')
                      )
                    })
                    .catch((error: unknown) => {
                      showToast(
                        tr(
                          `诊断失败：${error instanceof Error ? error.message : String(error)}`,
                          `Diagnostics failed: ${error instanceof Error ? error.message : String(error)}`
                        )
                      )
                    })
                    .finally(() => setDiagBusy(false))
                }}
              />
              <Row
                label={labels.agreements}
                icon={<PolicyIcon />}
                onClick={() => openPage('agreements')}
              />
            </Group>
            <Group spaced>
              <Row
                label={tr('帮助与反馈', 'Help & Feedback')}
                onClick={() => openAndroidPage(faqUrl, { showBrowserAction: false })}
              />
            </Group>
            {editor.apiKey ? (
              <Group spaced>
                <Row
                  label={logout}
                  icon={<LogoutIcon />}
                  danger
                  arrow={false}
                  onClick={() => setPopup('logout')}
                />
              </Group>
            ) : null}
          </>
        ) : null}
        {screen === 'account' ? (
          <>
            <Group>
              <ProfileEditor />
            </Group>
            <Group label={tr('账户', 'Account')}>
              <Row
                label="DeepSeek API Key"
                value={editor.apiKey ? '••••••••' : undefined}
                onClick={() => editor.setEditing(true)}
              />
              {editor.editing ? (
                <div className={styles.credentials}>
                  <ApiKeyField editor={editor} />
                  <ApiKeyConfirm editor={editor} />
                </div>
              ) : null}
              <Row
                label={tr('我的头像大小', 'My avatar size')}
                value={`${userAvatarSize}px`}
                onClick={() => setPopup('avatarUser')}
              />
              <Row
                label={labels.advanced}
                value={chatConfig.model}
                onClick={() => openPage('advanced')}
              />
              <Row
                label={tr('开放平台', 'Open platform')}
                href="https://platform.deepseek.com/api_keys"
              />
              <Row
                label={tr('开放平台帮助', 'API help')}
                href="https://api-docs.deepseek.com/zh-cn/"
              />
            </Group>
            <p className={styles.legal}>{t('appName')}</p>
          </>
        ) : null}
        {screen === 'advanced' ? (
          <Group>
            <AdvancedApiSettings onSave={back} />
          </Group>
        ) : null}
        {screen === 'character' ? (
          <>
            <p className={styles.pageIntro}>
              {tr(
                '这里放角色的基础档案，只回答「这个人是谁、身体怎样、怎么生活、哪些线不能碰」，不承担表达提示词、世界观、场景或玩法规则。档案与头像、显示、提示词、角色卡分开保存；角色名字也单独保存，角色卡启用时不会用卡名覆盖这里。\n档案开关默认开启。开启时，没有当前人物卡，这份档案进入每轮 system；有当前人物卡，以卡为准，档案不叠加。关闭后，档案字段仍保存在本机，但不会读取、不会进入 system，上面所有档案字段变灰只读；只有角色名字会保留为一条身份行，避免 system 完全失去姓名。重新开启后才能修改档案字段。这样两套身份不会在同一段 system 里互相打架。\n填写顺序：基本档案 → 身体与生活 → 性格与边界 → 剧情与表达。年龄、性别、代词、种族、身高、体重、生日、职业、居住地、语言尽量填全；这几项缺一项，角色就容易在对话里被临时改性别、改年龄或改成人不人鬼不鬼的样子。原创、OC、二创、游戏、动漫、小说角色都按这个顺序写。',
                'This page holds the character base profile: who this person is, what body they live in, how they live and which lines they never cross. It carries no delivery prompt, lore, scene or play-style rules, and is stored separately from avatar, display, prompt and cards. The character name is also stored separately: enabling a card never overwrites it.\nThe profile switch is on by default. When on and no card is active, this profile enters every system turn; an active card wins and the profile is not stacked. When off, the profile fields stay on device but are never read or injected, and every field turns grey and read-only. Only the character name remains as a compact identity line so the system still knows who it is. Turn the switch back on to edit the profile fields. This keeps two identities from fighting inside one system block.\nOrder: basic facts → body & daily life → character & limits → story & voice. Fill age, gender, pronouns, species, height, weight, birthday, occupation, residence and language whenever possible; a missing one lets the character drift in gender, age or species mid-scene. Use the same order for OCs, fan characters, game, anime and novel characters.'
              )}
            </p>
            {profileGroups.map((group, index) => (
              <Group
                key={group.key}
                label={tr(
                  index === 0 ? `角色设定 · ${group.label}` : group.label,
                  index === 0 ? `Character setting · ${group.labelEn}` : group.labelEn
                )}
              >
                {index === 0 ? (
                  <>
                    <Row
                      label={tr('读取基础档案', 'Read base profile')}
                      value={profileEnabled ? tr('开启', 'On') : tr('关闭', 'Off')}
                      arrow={false}
                      control={
                        <Switch
                          label={tr('读取基础档案', 'Read base profile')}
                          checked={profileEnabled}
                          toggle={() => setCharacterProfileEnabled(!profileEnabled)}
                        />
                      }
                    />
                    <div className={styles.inlineField}>
                      <span className={styles.inlineLabel}>{tr('角色名字', 'Name')}</span>
                      <input
                        className={styles.inlineInput}
                        data-disabled={!profileEnabled ? '' : undefined}
                        value={characterName}
                        placeholder={tr('留空则显示 AI', 'Blank shows AI')}
                        aria-label={tr('角色名字', 'Character name')}
                        maxLength={20}
                        readOnly={!profileEnabled}
                        onChange={(event) => profileEnabled && setCharacterName(event.target.value)}
                      />
                    </div>
                    {activeCharacterCard ? (
                      <Row
                        label={tr('当前角色卡', 'Active card')}
                        value={activeCharacterCard.name}
                        arrow={false}
                      />
                    ) : null}
                    <p className={styles.profileNotice} data-off={!profileEnabled ? '' : undefined}>
                      {profileEnabled
                        ? activeCharacterCard
                          ? tr(
                              '档案已开启：当前角色卡「' +
                                activeCharacterCard.name +
                                '」优先进入 system，卡名不会写入上面这行档案名；这里显示与保存的始终是手写名字。',
                              'Profile is on: the active card “' +
                                activeCharacterCard.name +
                                '” wins in system, and its name is never written into the profile name above. This field always shows the hand-written name.'
                            )
                          : tr(
                              '档案已开启：没有当前人物卡时，这份档案每轮进入 system；有当前人物卡时以卡为准。空字段不会注入，档案名独立保存。',
                              'Profile is on: with no active card it enters every system turn; an active card wins. Empty fields are skipped, and the profile name is stored independently.'
                            )
                        : activeCharacterCard
                          ? tr(
                              '档案已关闭：年龄、经历等字段不再读取，但上面的档案名仍会作为一条身份行进入 system；当前角色卡「' +
                                activeCharacterCard.name +
                                '」的卡名不会改写这行档案名。',
                              'Profile is off: age, history and other fields are no longer read, but the profile name above still enters system as one compact identity line. The active card “' +
                                activeCharacterCard.name +
                                '” never rewrites that profile name.'
                            )
                          : tr(
                              '档案已关闭：年龄、经历等字段不再读取，但上面的档案名仍会作为一条身份行进入 system，避免模型完全失去姓名；重新开启后才能修改。',
                              'Profile is off: age, history and other fields are no longer read, but the profile name above still enters system as one compact identity line so the model keeps a name. Turn the switch back on to edit.'
                            )}
                    </p>
                  </>
                ) : null}
                <p className={styles.profileGroupHint}>{tr(group.hint, group.hintEn)}</p>
                {group.fields.map((field) => {
                  const en = CHARACTER_PROFILE_EN[field.key]
                  return (
                    <label
                      className={styles.profileField}
                      data-disabled={!profileEnabled ? '' : undefined}
                      key={field.key}
                    >
                      <span className={styles.profileLabel}>
                        <span>{tr(field.label, en.label)}</span>
                        <span className={styles.profileHint}>{tr(field.hint, en.hint)}</span>
                      </span>
                      <textarea
                        className={styles.profileInput}
                        data-disabled={!profileEnabled ? '' : undefined}
                        rows={field.rows}
                        value={characterProfile[field.key]}
                        placeholder={tr(field.placeholder, en.placeholder)}
                        aria-label={tr(field.label, en.label)}
                        readOnly={!profileEnabled}
                        onChange={(event) =>
                          profileEnabled && setCharacterProfileField(field.key, event.target.value)
                        }
                      />
                    </label>
                  )
                })}
              </Group>
            ))}
            <p className={styles.caption}>
              {tr(
                `已填写 ${profileFields}/${profileTotal} 项（角色名字单独保存，不计入这 ${profileTotal} 项）。档案开关关闭时，以上内容全部只读；重新开启后恢复编辑与注入。空字段不会进入 system，也不会用空白占位。`,
                `${profileFields}/${profileTotal} fields filled (the name is stored separately and not counted). While the profile switch is off every field above is read-only; turning it back on restores editing and injection. Empty fields are skipped instead of sent as blanks.`
              )}
            </p>
            <p className={styles.pageIntro}>
              {tr(
                '头像仅在本机显示，不随请求上传。点击「角色头像」选择图片后，应用会居中裁切为正方形并压缩为 256px JPEG；「对话中显示头像」「角色头像大小」「头像形状」分别控制聊天中的显示、占位尺寸与外框。\n示例：为夜班店员设置冷色调半身像，聊天头像 32px、圆形。\n边界：角色卡之间不共享头像，显示图不进入请求。',
                'The avatar stays on device and is never uploaded. Tapping Avatar crops the image to a centered square and compresses it to 256px JPEG. The rows below control chat display, reserved size and frame.\nExample: a cool-toned portrait for the night-shift clerk, 32px, circular.\nBoundary: cards do not share avatars, and the image never enters a request.'
              )}
            </p>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => void chooseCharacterAvatar(event)}
            />
            <Group label={tr('头像与显示', 'Avatar & display')}>
              <Row
                label={avatarBusy ? tr('正在处理…', 'Processing…') : tr('角色头像', 'Avatar')}
                value={characterAvatar ? tr('已设置', 'Set') : tr('未设置', 'None')}
                disabled={avatarBusy}
                arrow={false}
                control={
                  <span className={styles.avatarPreview}>
                    {characterAvatar ? <img src={characterAvatar} alt="" /> : <span>＋</span>}
                  </span>
                }
                onClick={() => avatarInputRef.current?.click()}
              />
              <Row
                label={tr('对话中显示头像', 'Show avatars in chat')}
                value={avatarInChat ? tr('开启', 'On') : tr('关闭', 'Off')}
                arrow={false}
                control={
                  <Switch
                    label={tr('对话中显示头像', 'Show avatars in chat')}
                    checked={avatarInChat}
                    toggle={() => setAvatarInChat(!avatarInChat)}
                  />
                }
              />
              <Row
                label={tr('角色头像大小', 'Character avatar size')}
                value={`${characterAvatarSize}px`}
                onClick={() => setPopup('avatarCharacter')}
              />
              <Row
                label={tr('头像形状', 'Avatar shape')}
                value={avatarShape === 'rounded' ? tr('圆角方形', 'Rounded') : tr('圆形', 'Circle')}
                onClick={() => setPopup('avatarShape')}
              />
            </Group>
            <p className={styles.pageIntro}>
              {tr(
                '默认提示词是普通 DeepSeek AI 助手，不预置角色、人设或角色扮演规则；新装应用或恢复默认后，直接当普通助手使用。要角色扮演，启用一张角色卡或填写基础档案，也可以自行改写这段提示词。提示词每轮都会发送，是角色行为的最高优先级说明。写法分三层：称呼与语气、动作与对白密度、约束（不替{{user}}决定行动、不复述设定、不出戏）。\n示例：\n称呼{{user}}为「你」，句子偏短，紧张时更沉默。\n用对话和动作推进，每轮只写一个动作落点。\n不复述设定，不替{{user}}决定行动。\n边界：提示词越长，每轮占用越多；世界观与剧情放角色卡、世界书和对话，不塞进这里。',
                'The default prompt is a plain DeepSeek AI assistant with no persona, role or role-play rules. A fresh install or reset behaves as a normal assistant. To role-play, enable one character card, fill the base profile, or rewrite this prompt. The prompt is sent every turn and overrides other behavioural hints. Write it in three layers: address and tone, action and dialogue density, constraints (never decide for {{user}}, never restate the setting, never break character).\nExample:\nCall {{user}} 「你」, keep sentences short, go quieter when nervous.\nAdvance through dialogue and one concrete action per turn.\nNever restate the setting or decide for {{user}}.\nBoundary: longer prompts cost context every turn. Keep lore and plot in cards, the worldbook and the chat.'
              )}
            </p>
            <Group label={tr('system 身份名', 'System identity name')}>
              <Row
                label={tr('本次生效的名字', 'Name used this turn')}
                value={systemCharacterName}
                arrow={false}
              />
              <Row label={tr('名字来源', 'Name source')} value={systemNameSource} arrow={false} />
            </Group>
            <p className={styles.profileNotice}>
              {tr(
                '角色卡名只属于那张卡和当前会话，不会写入基础档案的名字。基础档案关闭后，档案字段全部停止读取，但档案名会保留为一条身份行，system 不会完全失去姓名；名字为空时才回退为 AI。',
                'A card name belongs to that card and the current session; it is never written into the base profile name. When the profile is off, all profile fields stop being read, but the profile name remains as one compact identity line so the system never loses the name completely. Only a blank name falls back to AI.'
              )}
            </p>
            <Group label={tr('表达提示词', 'Delivery prompt')}>
              <div className={styles.promptField}>
                <textarea
                  className={styles.promptInput}
                  rows={10}
                  value={systemPrompt}
                  placeholder={tr('留空则不发送系统提示词', 'Leave empty to send no system prompt')}
                  aria-label={tr('表达提示词', 'Delivery prompt')}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                />
                <div className={styles.promptMeta}>
                  <span>
                    {tr(
                      '{{user}} 表示账号名；直接填写具体名称时优先使用所填名称。账号名为空或占位名为「用户」时回退为「用户」。',
                      'Use {{user}} for the account name; a literal name you typed wins. Blank or placeholder account names fall back to "用户".'
                    )}
                  </span>
                </div>
              </div>
            </Group>
            <Group label={tr('出戏压制', 'Stay in character')}>
              <Row
                label={tr('压制「按设定」这类元叙述', 'Suppress meta narration')}
                value={suppressMetaTalk ? tr('开启', 'On') : tr('关闭', 'Off')}
                arrow={false}
                control={
                  <Switch
                    label={tr('压制「按设定」这类元叙述', 'Suppress meta narration')}
                    checked={suppressMetaTalk}
                    toggle={() => setSuppressMetaTalk(!suppressMetaTalk)}
                  />
                }
              />
              <p className={styles.caption}>
                {tr(
                  '仅在启用角色卡或基础档案时生效：在请求的 system 末尾追加一段演出规则，不提及规则、不复述设定、不分析用户意图、不使用 AI 视角评述。提示词原文保持不变；普通助手对话不追加。',
                  'Only applies when a character card or base profile is active: a short performance rule is appended to the request system, with no rule talk, setting restatement, intent analysis or AI-side commentary. The prompt text stays unchanged; plain assistant chats do not append it.'
                )}
              </p>
            </Group>
            <Group label={tr('演出呈现', 'Presentation')}>
              <Row
                label={tr('角色内心独白', 'Inner monologue')}
                value={
                  thoughtAside
                    ? tr('置灰并跳过朗读', 'Dimmed & skipped in speech')
                    : tr('关闭', 'Off')
                }
                arrow={false}
                control={
                  <Switch
                    label={tr('角色内心独白', 'Inner monologue')}
                    checked={thoughtAside}
                    toggle={() => setThoughtAside(!thoughtAside)}
                  />
                }
              />
              <p className={styles.caption}>
                {tr(
                  '括号里的内容（……）按内心独白处理：聊天里降低对比度，朗读与语音通话自动跳过。关闭后括号与普通台词一样显示，也会被读出来。发给模型的原文不受影响。',
                  'Text in parentheses (…) is treated as inner monologue: dimmed in chat, skipped by read-aloud and voice calls. When off, parentheses read like normal lines and are spoken. What is sent to the model is unchanged.'
                )}
              </p>
            </Group>
            <Group>
              <ResetRow
                label={tr('恢复本页默认', 'Reset this page')}
                onClick={resetCharacterSettings}
              />
            </Group>
          </>
        ) : null}
        {screen === 'roleplay' ? (
          <>
            <details className={styles.helpDetails}>
              <summary>
                {tr(
                  '注入说明：角色卡定义身份与表达，世界书补充可触发设定，场景记录当前状态。世界书单轮默认 1,000 字，最多 6 条。',
                  'Injection model: cards define identity and voice, worldbook supplies triggerable facts, and the scene records the current state. Worldbook defaults to 1,000 chars and at most 6 entries per turn.'
                )}
              </summary>
              <p className={styles.helpBody}>
                {tr(
                  '角色卡：锁定身份、关系与说话方式；启用后与手写提示词叠加生效，不改写提示词原文。\n世界书：保存地点、组织、既往事件等稳定背景；常驻条目每轮发送，关键词条目命中才发送。\n场景：记录当前时间、地点与在场人物，用于维持情节连续性。\n预算：默认 1,000 字，可调 500–20,000 字；单轮最多 6 条，按命中次数与权重排序，未命中不计入。\n示例：条目标题「便利店仓库」，关键词「仓库、后门」，正文「后门锁坏，仅店长知情」；对话提到仓库时才注入。\n边界：空字段不注入；设定存档含基础档案、角色卡、头像、世界书与场景，不含对话和记忆。',
                  'Cards lock identity, relationships and voice; when enabled they layer on top of the manual prompt without rewriting it.\nWorldbook stores places, groups and past events: always-on entries are sent every turn, keyword entries only on a hit.\nScene records time, location and present characters so the situation stays continuous.\nBudget: 1,000 chars by default, adjustable to 500–20,000; at most 6 entries per turn, ordered by hit count and weight, and misses cost nothing.\nExample: an entry titled 「便利店仓库」 with keywords 「仓库、后门」 and text 「后门锁坏，只有店长知道」 is sent only when the warehouse is mentioned.\nBoundary: empty fields are skipped. The archive holds cards, avatars, worldbook and scene, never chats or memories.'
                )}
              </p>
            </details>
            <RoleplayPanel />
            <Group label={tr('设定存档', 'Settings archive')}>
              <Row
                label={tr('导出设定', 'Export settings')}
                value={tr(
                  `${characterCards.length} 张卡 · ${worldbook.length} 条世界书`,
                  `${characterCards.length} cards · ${worldbook.length} entries`
                )}
                arrow={false}
                disabled={settingBusy}
                onClick={() => void exportSettings()}
              />
              <Row
                label={tr('导入设定', 'Import settings')}
                arrow={false}
                disabled={settingBusy}
                onClick={() => settingInput.current?.click()}
              />
              <input
                ref={settingInput}
                hidden
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const selected = event.target.files?.[0]
                  event.target.value = ''
                  if (selected) {
                    void importSettings(selected)
                  }
                }}
              />
            </Group>
            <p
              className={styles.caption}
              role={settingStatus?.type === 'error' ? 'alert' : 'status'}
              data-tone={settingStatus?.type}
            >
              {settingBusy
                ? tr('正在处理…', 'Working…')
                : (settingStatus?.text ??
                  tr(
                    '基础档案、角色卡、头像、世界书与场景打包成一个 JSON；导入按 id 合并，同名的卡不会重复新增，超出上限的部分会跳过。设定存档不含对话与记忆。',
                    'Base profile, cards, avatars, worldbook and scene are packed into one JSON file. Import merges by id, never duplicates a card, and skips what exceeds the limits. Settings archives contain no chats or memories.'
                  ))}
            </p>
          </>
        ) : null}
        {screen === 'sampling' ? (
          <>
            <p className={styles.pageIntro}>
              {tr(
                '采样参数控制回复的发散程度与单轮长度。温度越低输出越稳定，越高发散性越强；Top P 限制候选词范围；最大输出限制单轮 token。角色扮演常用温度 0.8–1.1、Top P 0.9–1。\n示例：回复偏离主题→温度由 1.1 降至 0.9；句式重复→温度上调 0.1 或将 Top P 降至 0.9；回复被截断→提高最大输出。\n边界：留空表示不发送该字段，由服务端使用默认值；不同模型的取值范围不同，超出范围会被接口拒绝。',
                'Sampling controls variation and reply length. Lower temperature is steadier, higher is livelier; Top P narrows the candidate pool; max output caps a single turn. Role-play commonly uses temperature 0.8–1.1 and Top P 0.9–1.\nExample: drifting replies → drop temperature from 1.1 to 0.9; repeated phrasing → raise it by 0.1 or lower Top P to 0.9; truncated replies → raise max output.\nBoundary: blank omits the field and lets the server choose; ranges differ by model and out-of-range values are rejected.'
              )}
            </p>
            <Group label={tr('采样', 'Sampling')}>
              <ParamField
                label={tr('温度 temperature', 'Temperature')}
                value={temperature}
                placeholder={tr('默认', 'auto')}
                min={0}
                max={2}
                step={0.1}
                onChange={setTemperature}
              />
              <ParamField
                label="Top P"
                value={topP}
                placeholder={tr('默认', 'auto')}
                min={0}
                max={1}
                step={0.05}
                onChange={setTopP}
              />
              <ParamField
                label={tr('最大输出 tokens', 'Max output tokens')}
                value={maxTokens}
                placeholder={tr('默认', 'auto')}
                min={1}
                max={1_000_000}
                step={1}
                integer
                onChange={setMaxTokens}
              />
            </Group>
            <Group label={tr('角色扮演参数', 'Role-play sampling')}>
              <p className={styles.caption}>
                {tr(
                  '启用角色卡时优先使用本组，未填写的项继承通用值。通常仅需单独调整温度，Top P 与最大输出沿用通用值；未启用角色卡时不发送角色扮演参数。',
                  'While a character card is active this group wins; blank fields inherit the general values above. Raising temperature alone is usually enough; Top P and max output can stay inherited. RP values are not sent when no card is active.'
                )}
              </p>
              <ParamField
                label={tr('温度 temperature', 'Temperature')}
                value={rpTemperature}
                placeholder={tr('沿用通用值', 'Use general')}
                min={0}
                max={2}
                step={0.1}
                onChange={setRpTemperature}
              />
              <ParamField
                label="Top P"
                value={rpTopP}
                placeholder={tr('沿用通用值', 'Use general')}
                min={0}
                max={1}
                step={0.05}
                onChange={setRpTopP}
              />
              <ParamField
                label={tr('最大输出 tokens', 'Max output tokens')}
                value={rpMaxTokens}
                placeholder={tr('沿用通用值', 'Use general')}
                min={1}
                max={1_000_000}
                step={1}
                integer
                onChange={setRpMaxTokens}
              />
            </Group>
            <Group label={tr('用量提醒', 'Usage alert')}>
              <Row
                label={tr('Token 限额', 'Token limit')}
                value={tokenLimit ? formatTokenCount(tokenLimit) : tr('关闭', 'Off')}
                onClick={() => {
                  setTokenDraft(String(tokenLimit || 256000))
                  setPopup('tokenLimit')
                }}
              />
              <Row
                label={tr('显示用量明细', 'Show token details')}
                value={showUsage ? tr('开启', 'On') : tr('关闭', 'Off')}
                arrow={false}
                control={
                  <Switch
                    label={tr('显示用量明细', 'Show token details')}
                    checked={showUsage}
                    toggle={() => setShowUsage(!showUsage)}
                  />
                }
              />
              <Row
                label={tr('用量明细显示在回复下方', 'Token details below reply')}
                value={usageBelow ? tr('下方', 'Below') : tr('上方', 'Above')}
                arrow={false}
                control={
                  <Switch
                    label={tr('用量明细显示在回复下方', 'Token details below reply')}
                    checked={usageBelow}
                    toggle={() => setUsageBelow(!usageBelow)}
                  />
                }
              />
              <p className={styles.caption}>
                {tr(
                  '默认显示在回复上方；打开后移到回复下方。记忆标记始终在消息末尾，不会被用量明细遮住。输入、输出、缓存命中和未命中显示完整数字并带千分位，达到 100 万后才缩写成 1M / 1.1M。',
                  'Default is above the reply; turn this on to move it below. Memory chips remain at the end of the message and are not covered. Input, output, cache hit and miss use full numbers with separators, switching to 1M / 1.1M only at one million.'
                )}
              </p>
              <p className={styles.caption}>
                {tr(
                  '限额是本地提醒阈值：接口实际累计消耗达到该值时提示一次，并显示顶栏胶囊。胶囊与统计面板只读取接口返回的 usage，不做本地分词估算；未返回 usage 的请求不计入，也不显示胶囊。该值不改变服务端计费上限。',
                  'The limit is a local alert threshold: reaching it triggers one notice and shows the top-bar chip. Both the chip and the report read API usage only, never a local estimate; requests without usage are excluded and the chip stays hidden. The value does not change server-side billing.'
                )}
              </p>
            </Group>
            <Group>
              <ResetRow
                label={tr('恢复本页默认', 'Reset this page')}
                onClick={resetSamplingSettings}
              />
            </Group>
          </>
        ) : null}
        {screen === 'request' ? (
          <>
            <p className={styles.pageIntro}>
              {tr(
                '本页控制每次请求额外发送的扩展字段。官方 DeepSeek 地址保持默认；使用第三方网关时，按网关文档调整模型名、协议与请求头。\n示例：网关返回 400 并提示未知字段→关闭 safety_check 与 latest_reminder；网关要求额外鉴权→在自定义请求头写入 Authorization: Bearer <key>，同名请求头会覆盖内置值。\n边界：格式错误的请求头会被忽略；自定义头覆盖同名默认头，包括 Authorization；API Key 仅保存在本机。',
                'This page controls the extra fields sent in each request. Keep defaults for the official DeepSeek endpoint; for a third-party gateway, follow its docs for model name, protocol and headers.\nExample: a gateway returns 400 for unknown fields → turn off safety_check and latest_reminder; extra auth is required → add Authorization: Bearer <key> under custom headers, which overrides built-ins of the same name.\nBoundary: malformed header lines are dropped; custom headers override built-ins including Authorization; the API key stays on device.'
              )}
            </p>
            <Group label={tr('生成配图', 'Illustration')}>
              <div className={styles.promptField}>
                <input
                  className={styles.promptInputLine}
                  value={imageModel}
                  placeholder="gpt-image-1"
                  aria-label={tr('绘图模型', 'Image model')}
                  spellCheck={false}
                  onChange={(event) => setImageModel(event.target.value)}
                  onBlur={() => {
                    const next = imageModel.trim()
                    if (next !== (chatConfig.imageModel ?? '')) {
                      setChatConfig({ ...chatConfig, imageModel: next })
                    }
                  }}
                />
                <div className={styles.promptMeta}>
                  <span>
                    {tr(
                      '回复菜单里的「生成配图」用这里填的模型名；留空按 gpt-image-1 请求。',
                      'The "Illustrate" reply action sends this model; leave blank to use gpt-image-1.'
                    )}
                  </span>
                </div>
              </div>
              <div className={styles.promptField}>
                <input
                  className={styles.promptInputLine}
                  value={imageSize}
                  placeholder="1024x1024"
                  aria-label={tr('绘图尺寸', 'Image size')}
                  spellCheck={false}
                  onChange={(event) => setImageSize(event.target.value)}
                  onBlur={() => {
                    const next = imageSize.trim()
                    if (next !== (chatConfig.imageSize ?? '')) {
                      setChatConfig({ ...chatConfig, imageSize: next })
                    }
                  }}
                />
                <div className={styles.promptMeta}>
                  <span>
                    {tr(
                      '图片尺寸按接口支持的范围填，例如 1024x1024、1024x1536；留空按 1024x1024。',
                      'Use a size your endpoint supports, e.g. 1024x1024 or 1024x1536; blank means 1024x1024.'
                    )}
                  </span>
                </div>
              </div>
            </Group>
            <Group label={tr('自定义请求头', 'Custom headers')}>
              <div className={styles.promptField}>
                <textarea
                  className={`${styles.promptInput} ${styles.promptInputCompact}`}
                  rows={4}
                  value={customHeaders}
                  placeholder={tr(
                    '每行一个，例：\nx-openai-actor-authorization: xxx\nHTTP-Referer: https://example.com',
                    'One per line, e.g.\nx-openai-actor-authorization: xxx\nHTTP-Referer: https://example.com'
                  )}
                  aria-label={tr('自定义请求头', 'Custom headers')}
                  spellCheck={false}
                  onChange={(event) => setCustomHeaders(event.target.value)}
                />
                <div className={styles.promptMeta}>
                  <span>
                    {tr(
                      '支持 Key: Value 多行格式或 JSON 对象；同名请求头覆盖内置值（含 Authorization），格式错误的条目会被忽略。',
                      'Accepts Key: Value lines or a JSON object. Same-name headers override built-ins (including Authorization).'
                    )}
                  </span>
                </div>
              </div>
            </Group>
            <Group label={tr('请求字段', 'Request fields')}>
              <Row
                label={tr('安全审核 safety_check', 'safety_check')}
                value={safetyCheck ? tr('开启', 'On') : tr('关闭', 'Off')}
                arrow={false}
                control={
                  <Switch
                    label={tr('安全审核 safety_check', 'safety_check')}
                    checked={safetyCheck}
                    toggle={() => setSafetyCheck(!safetyCheck)}
                  />
                }
              />
              <Row
                label={tr('上下文提醒 latest_reminder', 'latest_reminder')}
                value={sendLatestReminder ? tr('开启', 'On') : tr('关闭', 'Off')}
                arrow={false}
                control={
                  <Switch
                    label={tr('上下文提醒 latest_reminder', 'latest_reminder')}
                    checked={sendLatestReminder}
                    toggle={() => setSendLatestReminder(!sendLatestReminder)}
                  />
                }
              />
              <Row
                label={tr('服务端自动生成标题', 'Server-side title')}
                value={autoTitle ? tr('开启', 'On') : tr('关闭', 'Off')}
                arrow={false}
                control={
                  <Switch
                    label={tr('服务端自动生成标题', 'Server-side title')}
                    checked={autoTitle}
                    toggle={() => setAutoTitle(!autoTitle)}
                  />
                }
              />
            </Group>
            <p className={styles.caption}>
              {tr(
                '安全审核：开启后请求体携带 safety_check 字段，由服务端按其规则检查并过滤敏感内容。关闭后不再发送该字段，软件也不再替你过滤敏感内容；网关或服务商自身的兜底审核仍可能存在。关闭后，模型说出的任何内容与行为、你发送的任何内容及由此产生的后果，均由使用者自行承担。自由是有代价的，请确认愿意承担再关闭。如果确实需要发送对话，请只发送正常的聊天内容；私密、深情的内容不要转发、截图分享或上传公开平台。\n上下文提醒：开启后发送当前日期与大致位置，用于时间与地点一致性；对隐私敏感或需要完全虚构时间线时可关闭。\n自动生成标题：在需要标题的首轮请求中携带 title 字段，由服务端生成；关闭后由首条消息文本生成。\n兼容性：网关不识别 DeepSeek 扩展字段并返回 400 时，可关闭 safety_check 与 latest_reminder。',
                'safety_check: when on, the request carries the field and the server checks and filters sensitive content by its rules. When off, the field is omitted and the app no longer filters sensitive content for you; the gateway or provider may still moderate. With it off, any model output and any content you send, plus the consequences, are your responsibility. Freedom has a cost; confirm you accept it before turning this off. If you must send a conversation, send only ordinary chat content; do not forward, screenshot-share, or upload private or intimate content publicly.\nlatest_reminder sends the current date and approximate location for time and place consistency; turn it off when privacy matters or the timeline should stay fictional.\nServer-side title: the first title-bearing request carries a title field; when off, the first message text is used.\nCompatibility: turn off safety_check and latest_reminder if a gateway rejects DeepSeek-specific fields with a 400.'
              )}
            </p>
            <Group>
              <ResetRow
                label={tr('恢复本页默认', 'Reset this page')}
                onClick={resetRequestSettings}
              />
            </Group>
          </>
        ) : null}
        {screen === 'context' ? (
          <>
            <p className={styles.pageIntro}>
              {tr(
                '本页控制历史内容如何进入上下文。自动压缩在历史超出预算时额外发送一次摘要请求，并保留近期原文；关闭后不生成摘要，仅按轮次丢弃最旧内容。\n被拒轮次包含两个独立开关：保留正文用于避免气泡空白；允许进入上下文用于保留该轮。\n示例：长期角色扮演→关闭压缩，将关键设定放入世界书或记忆；日常问答→开启压缩以降低 Token。\n边界：关闭压缩不代表保存全部历史；摘要会改写旧内容；被拒内容进入上下文后可能再次触发拒答。',
                'This page controls how history enters the context. Compaction makes one extra summarisation request when history grows too long and keeps recent turns verbatim; with it off, no summary is written and only the oldest rounds are dropped.\nRefused turns have two independent switches: keeping the text prevents an empty bubble; allowing context keeps that round in history.\nExample: long-form role-play → turn compaction off and put key facts in the worldbook or memory; everyday Q&A → keep it on to save tokens.\nBoundary: off does not mean unlimited history; summaries rewrite older content; refused content in context may trigger another refusal.'
              )}
            </p>
            <Group>
              <Row
                label={tr('自动压缩长对话', 'Compact long chats')}
                value={autoCompact ? tr('开启', 'On') : tr('关闭', 'Off')}
                arrow={false}
                control={
                  <Switch
                    label={tr('自动压缩长对话', 'Compact long chats')}
                    checked={autoCompact}
                    toggle={() => setAutoCompact(!autoCompact)}
                  />
                }
              />
              <Row
                label={tr('保留被拒回复的正文', 'Keep refused reply text')}
                value={keepRefusedContent ? tr('开启', 'On') : tr('关闭', 'Off')}
                arrow={false}
                control={
                  <Switch
                    label={tr('保留被拒回复的正文', 'Keep refused reply text')}
                    checked={keepRefusedContent}
                    toggle={() => setKeepRefusedContent(!keepRefusedContent)}
                  />
                }
              />
              <Row
                label={tr('被拒轮次进入上下文', 'Keep refused turns in context')}
                value={allowRefusedContext ? tr('开启', 'On') : tr('关闭', 'Off')}
                arrow={false}
                control={
                  <Switch
                    label={tr('被拒轮次进入上下文', 'Keep refused turns in context')}
                    checked={allowRefusedContext}
                    toggle={() => setAllowRefusedContext(!allowRefusedContext)}
                  />
                }
              />
            </Group>
            <p className={styles.caption}>
              {tr(
                '关闭压缩后，仅按轮次丢弃最旧内容，且不生成摘要；保留正文可避免整轮空白；允许被拒轮次进入上下文后，该轮保留在历史里。三个开关相互独立，可按需组合。',
                'With compaction off, only the oldest rounds are dropped and no summary is written. Keeping refused text avoids a blank turn; allowing refused turns keeps that round in history. The three switches are independent.'
              )}
            </p>
            <Group>
              <ResetRow
                label={tr('恢复本页默认', 'Reset this page')}
                onClick={resetContextSettings}
              />
            </Group>
          </>
        ) : null}
        {screen === 'cost' ? (
          <>
            <section className={styles.costBanner}>
              <span className={styles.costKicker}>{tr('省钱说明', 'Cost guide')}</span>
              <h3>{tr('只关闭你不需要的消耗', 'Turn off only what you do not need')}</h3>
              <p>
                {tr(
                  '这页把会自动增加 Token 的开关集中列出。改动立即写入设置，下一条请求按新状态发送，不是展示用的假开关。',
                  'This page collects the switches that increase token usage. Changes are saved immediately and apply to the next request; these are real controls.'
                )}
              </p>
              <p className={styles.costPlain}>
                {tr(
                  '想省就关，不想省就保持原样；如果你很有钱，那当我没说，全部不用关。',
                  'Turn them off to save, leave them on if you do not care. If money is no concern, ignore this page entirely.'
                )}
              </p>
              <p className={styles.costFine}>
                {tr(
                  '等级只表示大致消耗量级，不换算金额；实际扣费以接口账单为准。每一项都可以随时恢复。',
                  'Ratings only indicate rough scale, not money; actual charges follow your API bill. Every switch can be restored at any time.'
                )}
              </p>
              <div className={styles.costMeter}>
                <strong>
                  {costClosed} / {costItems.length}
                </strong>
                <span>
                  {tr(
                    `已关闭；剩余 ${costItems.length - costClosed} 项未关闭，按各自触发条件计费`,
                    `off; ${costItems.length - costClosed} still on, billed when triggered`
                  )}
                </span>
              </div>
            </section>
            <Group label={tr('对话请求', 'Chat requests')}>
              <CostRow
                label={tr('深度思考', 'Deep thinking')}
                impact="high"
                checked={thinking}
                toggle={() => setThinking(!thinking)}
                description={tr(
                  '开启后请求携带 thinking.enabled，模型先写推理链再回答；推理与正文都计入输出 Token，耗时也更长。关闭只改默认状态，输入区仍可为单条消息临时开启。缓存按完整请求前缀匹配，来回切换思考模式后首轮会重建缓存。',
                  'Sends thinking.enabled; the model writes a reasoning chain before replying. Reasoning and reply both count as output tokens and take longer. Turning it off changes the default only; the composer can still enable it per message. Cache matching works on the full request prefix, so toggling thinking rebuilds the cache on the first turn.'
                )}
              />
              <CostRow
                label={tr('智能搜索', 'Smart search')}
                impact="high"
                checked={search}
                toggle={() => setSearch(!search)}
                description={tr(
                  '开启后请求携带联网搜索工具，检索结果与引用段落会额外产生 Token；遇到需要实时信息的消息时再开更划算。输入区可随时单独关闭。',
                  'Attaches the web-search tool; retrieved passages and citations add tokens. It is cheaper to enable only for messages that need live information. The composer can turn it off per message.'
                )}
              />
              <CostRow
                label={tr('世界书注入', 'Worldbook injection')}
                impact="mid"
                checked={worldbookInject}
                toggle={() => setWorldbookInject(!worldbookInject)}
                description={tr(
                  '命中的世界书条目会拼进 system，单轮最多 6 条，并受当前字符预算限制。关闭后条目与预算保留，角色卡和场景照常注入。',
                  'Matched worldbook entries are merged into the system prompt, up to 6 per turn and limited by the character budget. When off, entries and budget remain, while cards and scene still inject.'
                )}
              />
              <CostRow
                label={tr('长期记忆（记录并注入）', 'Long-term memory (record + inject)')}
                impact="mid"
                checked={memoryMode !== 'off'}
                toggle={() => setMemoryMode(memoryMode === 'off' ? 'turn' : 'off')}
                description={tr(
                  '每轮对话会写入记忆卡，并在后续请求开头注入，受当前字符预算限制。关闭后停止记录，已有卡片保留但不再进入请求。',
                  'Each turn writes a memory card and injects earlier cards at the top of later requests, limited by the character budget. When off, recording stops; existing cards remain but are not injected.'
                )}
              />
              <CostRow
                label={tr('场景自动更新', 'Automatic scene update')}
                impact="mid"
                checked={sceneAutoUpdate}
                toggle={() => setSceneAutoUpdate(!sceneAutoUpdate)}
                description={tr(
                  '每轮结束后额外发一次小请求，从对话中提取地点、时间与状态。关闭后不会多这一次请求，仍可在角色卡页手动编辑场景。',
                  'Sends one small extra request after each turn to extract place, time and state. Turning it off removes that request; the scene can still be edited manually.'
                )}
              />
            </Group>
            <Group label={tr('额外请求', 'Extra requests')}>
              <CostRow
                label={tr('记忆自动提炼', 'Memory auto refine')}
                impact="mid"
                checked={memoryMode === 'refine'}
                disabled={memoryMode === 'off'}
                toggle={() => setMemoryMode(memoryMode === 'refine' ? 'turn' : 'refine')}
                description={
                  memoryMode === 'off'
                    ? tr(
                        '长期记忆已关闭，先开启上一项后才能使用自动提炼。',
                        'Long-term memory is off. Enable it above before using auto refine.'
                      )
                    : tr(
                        '在整轮记录之外再发一次合并请求，重写旧卡。关闭后回到每轮一张，卡片会更多，但不再多一次请求。',
                        'Sends one extra merge request to rewrite old cards. When off, it writes one card per turn: more cards, but no extra request.'
                      )
                }
              />
              <CostRow
                label={tr('自动压缩摘要', 'Automatic compaction')}
                impact="mid"
                checked={autoCompact}
                toggle={() => setAutoCompact(!autoCompact)}
                description={tr(
                  '历史超出上下文预算时，一次回复内最多发起 6 次分段摘要请求。关闭后不生成摘要，只丢弃最旧内容；超长对话可能丢失前文。',
                  'When history exceeds the context budget, up to 6 staged summary requests can run within one reply. When off, no summary is made and the oldest turns are dropped; long chats may lose earlier context.'
                )}
              />
              <CostRow
                label={tr('自动生成标题', 'Automatic title')}
                impact="low"
                checked={autoTitle}
                toggle={() => setAutoTitle(!autoTitle)}
                description={tr(
                  '首轮请求携带 title 生成字段，由服务端生成会话标题。关闭后直接用首条消息文本截取标题。',
                  'The first request asks the server to generate a chat title. When off, the title is taken from the first message text.'
                )}
              />
            </Group>
            <Group label={tr('附加信息', 'Extra context')}>
              <CostRow
                label={tr('上下文提醒', 'Context reminder')}
                impact="low"
                checked={sendLatestReminder}
                toggle={() => setSendLatestReminder(!sendLatestReminder)}
                description={tr(
                  '每轮附带日期、星期、大致位置与语言。占用极小，通常在需要完全虚构时间线时才关闭。',
                  'Attaches date, weekday, approximate location and language each turn. The cost is very small; turn it off mainly when the timeline must be fully fictional.'
                )}
              />
            </Group>
            <p className={styles.caption}>
              {tr(
                '这里的开关与各功能页读取同一份设置：在「生成参数」「角色卡与世界书」「上下文与拒答」「长期记忆」里改动也会同步到这里，不会出现两套状态。',
                'These switches share the same settings as the feature pages. Changes in Sampling, Cards & worldbook, Context & refusal or Long-term memory are reflected here; there is only one state.'
              )}
            </p>
            <p className={styles.caption}>
              {tr(
                '始终发送、没有提供开关的：系统提示词、当前角色卡、当前场景、历史消息与本次输入。要再降消耗，应缩短这些内容，或在「生成参数」降低最大输出。',
                'Always sent with no switch here: system prompt, active card, current scene, history and the current message. To cut further, shorten those fields or lower max output in Sampling.'
              )}
            </p>
            <p className={styles.caption}>
              {tr(
                '字体大小、主题、头像、气泡、流式跟随只影响本机显示，不产生请求，也不需要为了省钱关闭。',
                'Text size, theme, avatars, bubbles and streaming follow only change local display. They send no request and do not need to be turned off to save money.'
              )}
            </p>
          </>
        ) : null}
        {screen === 'memory' ? (
          <>
            <div className={styles.memoryBanner}>
              <div className={styles.memoryBannerTop}>
                <strong>{tr('长期记忆', 'Long-term memory')}</strong>
                <span className={styles.memoryBadge} data-mode={memoryMode}>
                  {memoryMode === 'off'
                    ? tr('已关闭', 'Off')
                    : memoryMode === 'refine'
                      ? tr('自动提炼', 'Refined')
                      : tr('整轮记录', 'Per turn')}
                </span>
              </div>
              <p>
                {tr(
                  '长期记忆把每轮对话写成一张带时间锚点的卡片，保留完整回合，并关联对应消息，在后续请求开头注入。卡片跟随分支：切换回答版本仅显示该分支的记忆，从旧消息分叉会继承分叉点之前的卡片。\n操作顺序：先选择模式，再设置卡片上限与字数上限；重要卡片手动置顶，过时卡片可关闭注入并保留文本。\n示例：用户说「上周三我们一起吃了火锅」，下一轮提到「上周三」时，对应的完整记忆会被召回，角色可以接着聊那天的细节。\n边界：记忆保存在本机，随对话导入导出；超过卡片或字数上限时，最早自动卡片归档，不删除内容。',
                  'Long-term memory writes each turn into a timestamped card with the full exchange, attaches it to that message, and injects it at the start of later requests. Cards follow branches: switching reply versions shows only that branch, while forking from an older message inherits everything before that point.\nUsage: choose a mode, then set the card and character limits; pin what matters, and switch off stale cards without deleting their text.\nExample: 「上周三我们一起吃了火锅」 becomes a full card, so a later mention of 「上周三」 recalls that day and the character can continue with the details.\nBoundary: memories live on device and travel with chat export; when cards or characters exceed the ceiling, the oldest automatic cards are archived, never deleted.'
                )}
              </p>
            </div>
            <div
              className={styles.memoryModeGrid}
              role="radiogroup"
              aria-label={tr('记忆模式', 'Memory mode')}
            >
              <button
                className={styles.memoryModeCard}
                type="button"
                role="radio"
                aria-checked={memoryMode === 'off'}
                data-active={memoryMode === 'off'}
                onClick={() => setMemoryMode('off')}
              >
                <span className={styles.memoryModeName}>{tr('关闭', 'Off')}</span>
                <span className={styles.memoryModeDesc}>
                  {tr(
                    '停止记录新卡片；已有卡片保留但不注入。适用于短会话或排查记忆干扰。',
                    'Stops new cards. Existing cards stay but are not injected. Use it for short chats or to rule out memory interference.'
                  )}
                </span>
              </button>
              <button
                className={styles.memoryModeCard}
                type="button"
                role="radio"
                aria-checked={memoryMode === 'turn'}
                data-active={memoryMode === 'turn'}
                data-recommend="true"
                onClick={() => setMemoryMode('turn')}
              >
                <span className={styles.memoryModeName}>
                  {tr('整轮记录', 'Per turn')}
                  <i>{tr('推荐 · 长期记录', 'Recommended')}</i>
                </span>
                <span className={styles.memoryModeDesc}>
                  {tr(
                    '每轮一张完整回合卡，保留原文、时间与轮次，不额外调用接口；上限设为 9999 可长期记录。适用于固定角色的长线角色扮演。',
                    'One full-turn card per exchange with original text, time and turn number; no extra request. A 9999 limit keeps recording long term. Best for long-running character play.'
                  )}
                </span>
              </button>
              <button
                className={styles.memoryModeCard}
                type="button"
                role="radio"
                aria-checked={memoryMode === 'refine'}
                data-active={memoryMode === 'refine'}
                onClick={() => setMemoryMode('refine')}
              >
                <span className={styles.memoryModeName}>{tr('自动提炼', 'Auto refine')}</span>
                <span className={styles.memoryModeDesc}>
                  {tr(
                    '每轮先写入整轮卡片，再发送一次合并请求重写旧卡；可减少卡片数量并降低上下文占用，但每轮会增加 Token。适用于卡片重复较多、接近上限的场景。',
                    'Writes the turn card, then makes one small merge request. Fewer, cleaner cards at the cost of extra tokens per turn. Use it when duplicates pile up near the limit.'
                  )}
                </span>
              </button>
            </div>
            <p className={styles.caption}>
              {memoryMode === 'refine'
                ? tr(
                    '自动提炼会多一次合并请求，旧卡归档保留，可在面板查看；Token 消耗随之增加。',
                    'Auto refine makes one extra merge request. Superseded cards are archived and remain visible in the panel; token usage rises accordingly.'
                  )
                : memoryMode === 'turn'
                  ? tr(
                      '整轮记录不额外调用接口，每轮写入一张。上限 9999 表示近似不限；达到上限后才归档最早卡片。',
                      'Per-turn recording adds no request and writes one card per turn. A 9999 limit is effectively unlimited; archiving starts only at the ceiling.'
                    )
                  : tr(
                      '当前关闭：不记新卡片，已有卡片也不进入对话。',
                      'Off: no new cards, and existing cards are not injected.'
                    )}
            </p>
            <Group label={tr('卡片上限', 'Card limit')}>
              <div className={styles.memoryLimitRow}>
                <span className={styles.memoryLimitLabel}>{tr('保留张数', 'Keep up to')}</span>
                <span className={styles.memoryLimitValue}>{memoryLimit}</span>
                <span className={styles.memoryLimitUnit}>{tr('张', 'cards')}</span>
              </div>
              <div
                className={styles.memoryLimitPresets}
                role="radiogroup"
                aria-label={tr('卡片上限预设', 'Card limit presets')}
              >
                {[60, 200, 1000, MEMORY_LIMIT_MAX].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    role="radio"
                    aria-checked={memoryLimit === preset}
                    onClick={() => setMemoryLimit(preset)}
                  >
                    {preset === MEMORY_LIMIT_MAX
                      ? tr('9999 · 近似不限', '9999 · near unlimited')
                      : preset}
                  </button>
                ))}
              </div>
              <div className={styles.memoryLimitCustom}>
                <input
                  className={styles.tokenInput}
                  type="number"
                  inputMode="numeric"
                  min={MEMORY_LIMIT_MIN}
                  max={MEMORY_LIMIT_MAX}
                  defaultValue={memoryLimit}
                  key={`limit-${memoryLimit}`}
                  aria-label={tr('自定义卡片上限', 'Custom card limit')}
                  onBlur={(event) => {
                    const next = Number(event.target.value)
                    if (Number.isFinite(next) && next > 0) {
                      setMemoryLimit(next)
                    } else {
                      event.target.value = String(memoryLimit)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                  }}
                />
                <span>
                  {tr(
                    `可填 ${MEMORY_LIMIT_MIN}–${MEMORY_LIMIT_MAX}`,
                    `${MEMORY_LIMIT_MIN}–${MEMORY_LIMIT_MAX}`
                  )}
                </span>
              </div>
            </Group>
            <p className={styles.caption}>
              {tr(
                '上限仅统计自动记录与提炼出的卡片，手动添加的卡片不占名额。达到上限后，最早一批标记为已归档：文本保留、面板可查，但不再注入。9999 表示近似不限，达到上限后才开始归档。',
                'The limit counts auto-recorded and refined cards only; manually added cards are exempt. Past the ceiling the oldest batch is archived: text stays visible, injection stops. 9999 is effectively unlimited.'
              )}
            </p>
            <Group label={tr('字符预算', 'Character budget')}>
              <div className={styles.memoryLimitRow}>
                <span className={styles.memoryLimitLabel}>
                  {tr('记忆字数上限', 'Memory char ceiling')}
                </span>
                <span className={styles.memoryLimitValue}>
                  {memoryChars.toLocaleString('zh-CN')}
                </span>
                <span className={styles.memoryLimitUnit}>{tr('字', 'chars')}</span>
              </div>
              <div
                className={styles.memoryLimitPresets}
                role="radiogroup"
                aria-label={tr('字符预算预设', 'Character budget presets')}
              >
                {[10_000, 50_000, 100_000, MEMORY_CHARS_DEFAULT, MEMORY_CHARS_MAX].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    role="radio"
                    aria-checked={memoryChars === preset}
                    onClick={() => setMemoryChars(preset)}
                  >
                    {preset === MEMORY_CHARS_DEFAULT
                      ? tr('1M · 默认', '1M · default')
                      : preset.toLocaleString('zh-CN')}
                  </button>
                ))}
              </div>
              <div className={styles.memoryLimitCustom}>
                <input
                  className={styles.tokenInput}
                  type="number"
                  inputMode="numeric"
                  min={MEMORY_CHARS_MIN}
                  max={MEMORY_CHARS_MAX}
                  defaultValue={memoryChars}
                  key={`chars-${memoryChars}`}
                  aria-label={tr('自定义记忆字符预算', 'Custom memory character budget')}
                  onBlur={(event) => {
                    const next = Number(event.target.value)
                    if (Number.isFinite(next) && next > 0) {
                      setMemoryChars(next)
                    } else {
                      event.target.value = String(memoryChars)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                  }}
                />
                <span>
                  {tr(
                    `可填 ${MEMORY_CHARS_MIN.toLocaleString('zh-CN')}–${MEMORY_CHARS_MAX.toLocaleString('zh-CN')}`,
                    `${MEMORY_CHARS_MIN}–${MEMORY_CHARS_MAX}`
                  )}
                </span>
              </div>
            </Group>
            <p className={styles.caption}>
              {tr(
                `${memoryChars.toLocaleString('zh-CN')} 字既是单次请求可拼入的字符上限，也是本会话记忆的总字数上限；不代表每轮都会带满。超过总字数后，最早的自动卡片会归档：文本保留、面板可查，只是不再注入，也不会让保存失败。实际注入量还受卡片条数、模型上下文窗口和当前发言长度约束。卡片总量过大、出现上下文挤占或请求接近窗口上限时，应回调到 50,000–200,000 字。`,
                `${memoryChars.toLocaleString('en-US')} chars is both the per-request ceiling and the total memory character limit for this session; it is not the amount sent every turn. Past the total, the oldest automatic cards are archived: text stays visible, injection stops, and saving never fails. Card count, model context and the current reply also constrain injection. If cards grow too large, lower it to 50,000–200,000.`
              )}
            </p>
            <Group label={tr('普通记忆（开发 / 问答 / 代码）', 'Normal memory (dev / Q&A / code)')}>
              <Row
                label={tr('普通记忆注入', 'Normal memory injection')}
                value={normalMemoryEnabled ? tr('开启', 'On') : tr('关闭', 'Off')}
                arrow={false}
                control={
                  <Switch
                    label={tr('普通记忆注入', 'Normal memory injection')}
                    checked={normalMemoryEnabled}
                    toggle={() => setNormalMemoryEnabled(!normalMemoryEnabled)}
                  />
                }
              />
              <div className={styles.memoryLimitRow}>
                <span className={styles.memoryLimitLabel}>
                  {tr('普通记忆卡片上限', 'Normal card limit')}
                </span>
                <span className={styles.memoryLimitValue}>{normalMemoryLimit}</span>
                <span className={styles.memoryLimitUnit}>{tr('张', 'cards')}</span>
              </div>
              <div
                className={styles.memoryLimitPresets}
                role="radiogroup"
                aria-label={tr('普通记忆卡片预设', 'Normal card presets')}
              >
                {[100, 300, 1000, MEMORY_LIMIT_MAX].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    role="radio"
                    aria-checked={normalMemoryLimit === preset}
                    onClick={() => setNormalMemoryLimit(preset)}
                  >
                    {preset === MEMORY_LIMIT_MAX
                      ? tr('9999 · 近似不限', '9999 · near unlimited')
                      : preset}
                  </button>
                ))}
              </div>
              <div className={styles.memoryLimitCustom}>
                <input
                  className={styles.tokenInput}
                  type="number"
                  inputMode="numeric"
                  min={MEMORY_LIMIT_MIN}
                  max={MEMORY_LIMIT_MAX}
                  defaultValue={normalMemoryLimit}
                  key={`normal-limit-${normalMemoryLimit}`}
                  aria-label={tr('普通记忆卡片上限', 'Normal memory card limit')}
                  onBlur={(event) => {
                    const next = Number(event.target.value)
                    if (Number.isFinite(next) && next > 0) {
                      setNormalMemoryLimit(next)
                    } else {
                      event.target.value = String(normalMemoryLimit)
                    }
                  }}
                />
                <span>
                  {tr(
                    `可填 ${MEMORY_LIMIT_MIN}–${MEMORY_LIMIT_MAX}`,
                    `${MEMORY_LIMIT_MIN}–${MEMORY_LIMIT_MAX}`
                  )}
                </span>
              </div>
              <div className={styles.memoryLimitRow}>
                <span className={styles.memoryLimitLabel}>
                  {tr('普通记忆字数上限', 'Normal char ceiling')}
                </span>
                <span className={styles.memoryLimitValue}>
                  {normalMemoryChars.toLocaleString('zh-CN')}
                </span>
                <span className={styles.memoryLimitUnit}>{tr('字', 'chars')}</span>
              </div>
              <div
                className={styles.memoryLimitPresets}
                role="radiogroup"
                aria-label={tr('普通记忆字数预设', 'Normal char presets')}
              >
                {[50_000, 200_000, 500_000, MEMORY_CHARS_MAX].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    role="radio"
                    aria-checked={normalMemoryChars === preset}
                    onClick={() => setNormalMemoryChars(preset)}
                  >
                    {preset === MEMORY_CHARS_MAX ? '5M' : preset.toLocaleString('zh-CN')}
                  </button>
                ))}
              </div>
              <div className={styles.memoryLimitCustom}>
                <input
                  className={styles.tokenInput}
                  type="number"
                  inputMode="numeric"
                  min={MEMORY_CHARS_MIN}
                  max={MEMORY_CHARS_MAX}
                  defaultValue={normalMemoryChars}
                  key={`normal-chars-${normalMemoryChars}`}
                  aria-label={tr('普通记忆字数上限', 'Normal memory char ceiling')}
                  onBlur={(event) => {
                    const next = Number(event.target.value)
                    if (Number.isFinite(next) && next > 0) {
                      setNormalMemoryChars(next)
                    } else {
                      event.target.value = String(normalMemoryChars)
                    }
                  }}
                />
                <span>
                  {tr(
                    `可填 ${MEMORY_CHARS_MIN.toLocaleString('zh-CN')}–${MEMORY_CHARS_MAX.toLocaleString('zh-CN')}`,
                    `${MEMORY_CHARS_MIN}–${MEMORY_CHARS_MAX}`
                  )}
                </span>
              </div>
            </Group>
            <p className={styles.caption}>
              {tr(
                '普通记忆与角色记忆各算各的配额，互不挤占。普通记忆只按关键词检索，不做时间线、好感或关系阶段召回；角色扮演开启时不注入普通记忆，避免代码与开发日志污染人设。三连反引号代码块会自动归入「代码」，其余可在保存时手动选分类。',
                'Normal and character memories have separate quotas. Normal memory is keyword-only: no timeline, affinity or relationship recall. While role-play is on, normal memory is not injected, so code and dev logs cannot leak into the persona. Triple-backtick code blocks are filed as Code automatically; other categories can be chosen when saving.'
              )}
            </p>
            <Group label={tr('使用方式', 'Usage')}>
              <Row
                label={tr('顶栏记忆胶囊', 'Memory chip in top bar')}
                value={memoryBadge ? tr('显示', 'Shown') : tr('隐藏', 'Hidden')}
                arrow={false}
                control={
                  <Switch
                    label={tr('顶栏记忆胶囊', 'Memory chip in top bar')}
                    checked={memoryBadge}
                    toggle={() => setMemoryBadge(!memoryBadge)}
                  />
                }
              />
              <Row
                label={tr('回复下方记忆标记', 'Memory mark under replies')}
                value={memoryInline ? tr('显示', 'Shown') : tr('隐藏', 'Hidden')}
                arrow={false}
                control={
                  <Switch
                    label={tr('回复下方记忆标记', 'Memory mark under replies')}
                    checked={memoryInline}
                    toggle={() => setMemoryInline(!memoryInline)}
                  />
                }
              />
              <Row
                label={tr('记忆面板入口', 'Memory panel entry')}
                value={tr('顶栏 · 侧栏长期记忆', 'Top bar · sider')}
                arrow={false}
              />
              <Row
                label={tr('放在哪一段', 'Placement')}
                value={tr('最前面', 'Very top')}
                arrow={false}
              />
              <Row
                label={tr('一次最多带', 'Per message')}
                value={tr(
                  `${memoryChars.toLocaleString('zh-CN')} 字`,
                  `${memoryChars.toLocaleString('en-US')} chars`
                )}
                arrow={false}
              />
            </Group>
            <p className={styles.caption}>
              {tr(
                '记忆块放在系统内容最前面，先于基础档案和表达提示词被读到。每轮只携带字符预算内的卡片，避免挤占对话空间。关闭某张卡片只是停止注入，文本仍保存在本机。',
                'The memory block sits at the top of the system content, before the character prompt. Each turn carries only cards that fit the character budget. Switching a card off stops injection; its text remains on device.'
              )}
            </p>
          </>
        ) : null}
        {screen === 'refusal' ? (
          <>
            <p className={styles.pageIntro}>
              {tr(
                '关键词拒答在本地执行：检查用户输入文本，命中任意关键词时立即返回话术，不调用接口。\n操作顺序：开启后每行填写一个关键词；需要区分英文大小写时打开对应开关；话术可使用角色口吻。\n示例：关键词「自杀、自残」；话术「（{{char}}按住你的手）先停一下，告诉我你现在在哪。」\n边界：仅做字面匹配，不识别语义、谐音和变体；关键词留空则不拦截；关闭后请求正常发往接口。',
                'Keyword refusal runs locally: your input is checked, and any hit returns the message without calling the API.\nUsage: enable it, put one keyword per line, turn on case sensitivity only if English casing matters, and write the message in character if you like.\nExample: keywords 「自杀、自残」; message 「({{char}} holds your hand) Stop for a moment. Tell me where you are.」\nBoundary: literal matching only, with no semantics, homophones or variants; an empty list blocks nothing; with it off, requests go to the endpoint as usual.'
              )}
            </p>
            <Group label={tr('本地拒答', 'Local refusal')}>
              <Row
                label={tr('启用关键词拒答', 'Enable keyword refusal')}
                value={refusalEnabled ? tr('开启', 'On') : tr('关闭', 'Off')}
                arrow={false}
                control={
                  <Switch
                    label={tr('启用关键词拒答', 'Enable keyword refusal')}
                    checked={refusalEnabled}
                    toggle={() => setRefusalEnabled(!refusalEnabled)}
                  />
                }
              />
              <Row
                label={tr('关键词区分大小写', 'Case-sensitive keywords')}
                value={refusalCaseSensitive ? tr('开启', 'On') : tr('关闭', 'Off')}
                arrow={false}
                control={
                  <Switch
                    label={tr('关键词区分大小写', 'Case-sensitive keywords')}
                    checked={refusalCaseSensitive}
                    toggle={() => setRefusalCaseSensitive(!refusalCaseSensitive)}
                  />
                }
              />
            </Group>
            <Group label={tr('关键词', 'Keywords')}>
              <div className={styles.promptField}>
                <textarea
                  className={`${styles.promptInput} ${styles.promptInputCompact}`}
                  rows={4}
                  value={refusalKeywords}
                  placeholder={tr(
                    '每行一个关键词，或用逗号分隔',
                    'One keyword per line or comma-separated'
                  )}
                  aria-label={tr('拒答关键词', 'Refusal keywords')}
                  onChange={(event) => setRefusalKeywords(event.target.value)}
                />
                <div className={styles.promptMeta}>
                  <span>
                    {tr(
                      '仅检查当前用户输入文本，命中任意关键词即触发；英文大小写由上方开关控制。',
                      'Only your own input is checked; any hit triggers. English casing follows the switch above.'
                    )}
                  </span>
                </div>
              </div>
            </Group>
            <Group label={tr('拒答话术', 'Refusal message')}>
              <div className={styles.promptField}>
                <textarea
                  className={`${styles.promptInput} ${styles.promptInputCompact}`}
                  rows={3}
                  value={refusalMessage}
                  placeholder={tr(
                    '留空使用内置拒答话术',
                    'Leave blank for the built-in refusal text'
                  )}
                  aria-label={tr('拒答话术', 'Refusal message')}
                  onChange={(event) => setRefusalMessage(event.target.value)}
                />
                <div className={styles.promptMeta}>
                  <span>
                    {tr(
                      '服务端 refusal 与本地关键词拒答共用这段文案；留空时使用内置文本。',
                      'Shared by server refusals and local keyword hits; blank falls back to the built-in text.'
                    )}
                  </span>
                </div>
              </div>
            </Group>
            <Group>
              <ResetRow
                label={tr('恢复本页默认', 'Reset this page')}
                onClick={resetRefusalSettings}
              />
            </Group>
          </>
        ) : null}
        {screen === 'data' ? (
          <>
            <p className={styles.pageIntro}>
              {tr(
                '本页管理本机数据：自动备份、整包导入导出、长期记忆归档与数据结构检查。\n操作建议：根据会话频率设置自动备份间隔，文件保存至「下载/DeepSeek Replica/自动备份」，只保留最近的完整备份；更换设备或重装后，在新设备通过「导入历史对话」选择该 ZIP。\n示例：每日使用→间隔 120 分钟；更换设备→先「导出所有历史对话」，再在新设备导入。\n边界：备份包含对话与设置，不含 API Key；导入前校验 ZIP 结构与 CRC；覆盖安装不会清除数据，系统清理仍可能删除应用数据。',
                'This page manages on-device data: auto backup, full import/export, memory archive and post-update checks.\nDaily use: set a backup interval that matches your chat frequency; complete ZIPs go to Downloads/DeepSeek Replica and only the latest five are kept. After switching or reinstalling, pick that ZIP under Import chat history.\nExample: chat daily → 120-minute interval; new phone → Export all chats first, then import on the new device.\nBoundary: backups contain chats and settings but no API key; imports verify the ZIP structure and CRC; a clean install keeps data, but system cleanup may still remove it.'
              )}
            </p>
            <p className={styles.caption}>
              {tr(
                '历史对话保存在此设备。API 数据处理适用 ',
                'Chat history is stored on this device. API usage is subject to the '
              )}
              <a href={`${chinesePoliciesUrl}/deepseek-open-platform-privacy-policy.html`}>
                {tr('DeepSeek 开放平台隐私政策', 'DeepSeek Open Platform Privacy Policy')}
              </a>
              {tr('。', '.')}
            </p>
            <Group label={tr('自动备份', 'Auto backup')}>
              <Row
                label={tr('自动备份到下载目录', 'Back up to Downloads')}
                value={autoBackup ? tr('开启', 'On') : tr('关闭', 'Off')}
                arrow={false}
                control={
                  <Switch
                    label={tr('自动备份到下载目录', 'Back up to Downloads')}
                    checked={autoBackup}
                    toggle={() => setAutoBackup(!autoBackup)}
                  />
                }
              />
              <Row
                label={tr('备份间隔', 'Backup interval')}
                value={tr(
                  `每 ${formatBackupInterval(autoBackupMinutes, tr)}`,
                  `Every ${formatBackupInterval(autoBackupMinutes, tr)}`
                )}
                onClick={() => {
                  const useHour = autoBackupMinutes >= 60
                  setBackupUnit(useHour ? 'hour' : 'minute')
                  setBackupDraft(
                    String(useHour ? autoBackupMinutes / 60 : autoBackupMinutes).replace(
                      /^\./,
                      '0.'
                    )
                  )
                  setPopup('backupInterval')
                }}
              />
              <Row
                label={backingUp ? tr('正在备份…', 'Backing up…') : tr('立即备份', 'Back up now')}
                value={
                  backupStatus
                    ? `${formatBackupTime(backupStatus.date)} · ${formatBackupSize(backupStatus.size)}`
                    : sessions > 0
                      ? tr(
                          `本机 ${sessions} 个对话 · 尚未自动备份`,
                          `${sessions} chats · not backed up`
                        )
                      : tr('暂无备份', 'None yet')
                }
                disabled={busy || backingUp}
                arrow={false}
                onClick={() => {
                  setBackingUp(true)
                  void runAutoBackup()
                    .then((result) => {
                      setBackupStatus(result.status)
                      if (result.outcome === 'ok') {
                        showToast(
                          tr(
                            `已备份 ${result.sessionCount} 个对话，文件已校验，保存在「下载/DeepSeek Replica/自动备份」`,
                            `Backed up ${result.sessionCount} chats; file verified in Downloads/DeepSeek Replica`
                          )
                        )
                      } else if (result.outcome === 'empty') {
                        showToast(
                          tr(
                            '本机无对话数据，未生成备份',
                            'No chats on this device, nothing to back up'
                          )
                        )
                      } else {
                        showToast(describeBackupFailure(result, tr))
                      }
                    })
                    .catch((error: unknown) => {
                      showToast(
                        tr(
                          `备份失败：${error instanceof Error ? error.message : String(error)}`,
                          `Backup failed: ${error instanceof Error ? error.message : String(error)}`
                        )
                      )
                    })
                    .finally(() => setBackingUp(false))
                }}
              />
              <Row
                label={tr('恢复备份', 'Restore a backup')}
                value={tr('选择 ZIP，先校验再导入', 'Pick a ZIP, verify first')}
                disabled={busy}
                arrow={false}
                onClick={() => importInput.current?.click()}
              />
              <p className={styles.caption}>
                {(() => {
                  const meta = readAutoBackupMeta()
                  return meta?.checksum && (!backupStatus || meta.name === backupStatus.name)
                    ? tr(
                        `上次备份已校验：${meta.sessionCount} 个对话 · SHA-256 ${meta.checksum}…`,
                        `Last backup verified: ${meta.sessionCount} chats · SHA-256 ${meta.checksum}…`
                      )
                    : tr(
                        '每次备份完成后会计算 SHA-256 指纹，用来确认文件内容与本次导出一致；导入前也会校验 ZIP 结构与 CRC。',
                        'A SHA-256 fingerprint is computed after each backup so the file can be matched to that export; imports also verify the ZIP structure and CRC.'
                      )
                })()}
              </p>
              <p className={styles.caption}>
                {(() => {
                  const report = readMigrationReport()
                  const unreadable = getUnreadableRecordCount()
                  if (!report && unreadable === 0) {
                    return tr(
                      '每次更新后执行本机数据结构检查：修正旧设置并隔离无法解析的数据；结果在此显示，对话不会被删除。',
                      'After each update the local data structure is checked: old settings are adjusted and unreadable values parked. Results appear here; chats are not deleted.'
                    )
                  }
                  const fixed = (report?.repaired.length ?? 0) + (report?.removed.length ?? 0)
                  const moved = report?.quarantined.length ?? 0
                  const parts: string[] = []
                  if (fixed > 0) {
                    parts.push(tr(`${fixed} 项旧设置已修正`, `${fixed} old settings adjusted`))
                  }
                  if (moved > 0) {
                    parts.push(
                      tr(`${moved} 项无法解析的数据已隔离保存`, `${moved} unreadable values parked`)
                    )
                  }
                  if (unreadable > 0) {
                    parts.push(
                      tr(
                        `${unreadable} 条旧对话无法读取，已跳过`,
                        `${unreadable} old chats skipped`
                      )
                    )
                  }
                  if (parts.length === 0) {
                    return tr(
                      '数据结构检查：本次没有需要修正或隔离的项目，对话未被删除。',
                      'Update check: nothing needed repair or parking; no chats were deleted.'
                    )
                  }
                  return tr(
                    `数据结构检查：${parts.join('；')}。对话未被删除，隔离数据仍保存在本机。`,
                    `Update check: ${parts.join('; ')}. Nothing was deleted.`
                  )
                })()}
              </p>
              <p className={styles.caption}>
                {tr(
                  `按设置的间隔检查，每 ${formatBackupInterval(autoBackupMinutes, tr)}最多备份一次，只保留最近 5 份完整文件，位置在「下载/DeepSeek Replica/自动备份」。每次成功会提示结果；备份先写应用内临时文件，核对大小并校验 ZIP 后才发布到下载目录，写入中断或进程被杀不会留下半截文件。覆盖安装、重装或系统清理后，通过下方「导入」选择该文件可恢复全部对话；导入前会校验 ZIP 结构与 CRC，API Key 不随备份迁移，需要重新填写。`,
                  `Checked at most once every ${formatBackupInterval(autoBackupMinutes, tr)}; only the latest five complete files stay under Downloads/DeepSeek Replica. A toast confirms every success. The export is written to a temporary file, size-checked and opened as a ZIP before it is published, so an interruption or process kill cannot leave a partial file. After an update, reinstall or cleanup, import one of them below; imports verify the ZIP and CRC, and the API key is not included.`
                )}
              </p>
            </Group>
            <Group>
              <Row
                label={labels.export}
                disabled={busy}
                onClick={() => {
                  setExportSavedName(null)
                  openPage('export')
                }}
              />
            </Group>
            <Group>
              <Row
                label={clear}
                danger
                arrow={false}
                disabled={busy}
                onClick={() => setPopup('delete')}
              />
            </Group>
            <Group>
              <Row
                label={t('historyImport')}
                arrow={false}
                disabled={busy}
                onClick={() => importInput.current?.click()}
              />
              <input
                ref={importInput}
                hidden
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => {
                  const selected = event.target.files?.[0]
                  event.target.value = ''
                  if (selected) {
                    setImportMode('merge')
                    setFile(selected)
                    setPopup('import')
                  }
                }}
              />
            </Group>
            {importStatus ? (
              <p
                className={styles.caption}
                role={importStatus.type === 'error' ? 'alert' : 'status'}
              >
                {t(importStatus.key, importStatus.params)}
              </p>
            ) : null}
            <Group label={tr('长期记忆归档', 'Memory archive')}>
              <Row
                label={tr('导出记忆', 'Export memories')}
                value={tr('选择分类后打包', 'Choose categories')}
                disabled={busy || memoryBusy || !sessions}
                onClick={() => setPopup('memoryExport')}
              />
              <div className={styles.modeRow}>
                <span className={styles.icon}>
                  <FeatureIcon label={tr('导入方式', 'Import mode')} />
                </span>
                <span className={styles.modeLabel}>{tr('导入方式', 'Import mode')}</span>
                <div className={styles.modeSwitch}>
                  <button
                    type="button"
                    data-on={memoryImportMode === 'merge' ? '' : undefined}
                    disabled={busy || memoryBusy}
                    onClick={() => setMemoryImportMode('merge')}
                  >
                    {tr('追加合并', 'Merge')}
                  </button>
                  <button
                    type="button"
                    data-on={memoryImportMode === 'replace' ? '' : undefined}
                    disabled={busy || memoryBusy}
                    onClick={() => setMemoryImportMode('replace')}
                  >
                    {tr('清空覆盖', 'Replace')}
                  </button>
                </div>
              </div>
              <Row
                label={tr('导入记忆', 'Import memories')}
                value={
                  memoryImportMode === 'merge'
                    ? tr('选择 ZIP，按会话合并', 'Pick a ZIP, merge by chat')
                    : tr('选择 ZIP，先清空本机记忆再写入', 'Pick a ZIP, clear local memory first')
                }
                arrow={false}
                disabled={busy || memoryBusy}
                onClick={() => memoryInput.current?.click()}
              />
              <Row
                label={tr('导入单会话包', 'Import a chat bundle')}
                value={
                  bundleBusy
                    ? tr('正在导入…', 'Importing…')
                    : tr('整段对话 + 会话记忆', 'Chat + its memories')
                }
                arrow={false}
                disabled={busy || bundleBusy}
                onClick={() => bundleInput.current?.click()}
              />
              <input
                ref={bundleInput}
                hidden
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const selected = event.target.files?.[0]
                  event.target.value = ''
                  if (!selected) {
                    return
                  }
                  setBundleBusy(true)
                  void parseSessionBundle(selected)
                    .then(async (bundle) => {
                      const session = await importSessionBundle(bundle)
                      setMemoryStatus({
                        type: 'done',
                        text: tr(
                          `已导入「${session.title}」：${session.messages.length} 条消息；角色卡与世界书需自行核对`,
                          `Imported “${session.title}”: ${session.messages.length} messages; apply cards/worldbook yourself`
                        ),
                      })
                      selectSession(session.id)
                    })
                    .catch((error: unknown) => {
                      setMemoryStatus({
                        type: 'error',
                        text: error instanceof Error ? error.message : String(error),
                      })
                    })
                    .finally(() => setBundleBusy(false))
                }}
              />
              <input
                ref={memoryInput}
                hidden
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => {
                  const selected = event.target.files?.[0]
                  event.target.value = ''
                  if (!selected) {
                    return
                  }
                  setMemoryStatus({ type: 'info', text: tr('正在读取记忆…', 'Reading memories…') })
                  setMemoryBusy(true)
                  void importMemory(
                    selected,
                    (done, total) => {
                      if (total > 0) {
                        setMemoryStatus({
                          type: 'info',
                          text: tr(
                            `正在导入记忆：${done}/${total} 个对话`,
                            `Importing memories: ${done}/${total} chats`
                          ),
                        })
                      }
                    },
                    memoryImportMode
                  )
                    .then((result) => {
                      const skipped = result.skippedCards + result.skippedSessions
                      setMemoryStatus({
                        type: result.cards > 0 ? 'done' : 'info',
                        text:
                          result.cards > 0
                            ? tr(
                                `已导入 ${result.cards} 张卡片（${result.sessions} 个对话）${
                                  result.cleared > 0 ? `，覆盖前清掉 ${result.cleared} 张` : ''
                                }${
                                  skipped > 0
                                    ? `，跳过 ${skipped} 项（原会话或消息已不存在、或卡片已存在）`
                                    : ''
                                }`,
                                `Imported ${result.cards} cards across ${result.sessions} chats${
                                  skipped > 0 ? `, skipped ${skipped} items` : ''
                                }`
                              )
                            : tr(
                                `未导入新卡片：${skipped} 项已跳过（会话或消息不存在，或卡片已存在）`,
                                `Nothing new: ${skipped} items skipped (chat or message missing, or already present)`
                              ),
                      })
                    })
                    .catch((error: unknown) => {
                      setMemoryStatus({
                        type: 'error',
                        text: error instanceof Error ? error.message : String(error),
                      })
                    })
                    .finally(() => setMemoryBusy(false))
                }}
              />
            </Group>
            <section
              className={styles.memoryNotice}
              aria-label={tr('记忆归档注意事项', 'Memory archive notes')}
            >
              <strong>{tr('记忆归档注意事项', 'Before you archive memory')}</strong>
              <ul>
                <li>
                  {tr(
                    '耗时随卡片数量增长：数百张通常数秒，上千张需等待进度完成，期间请停留在本页。',
                    'Time grows with card count: hundreds take seconds, thousands need the progress to finish.'
                  )}
                </li>
                <li>
                  {tr(
                    '导入按会话与消息定位：原会话已删除、或那条消息已不存在，对应卡片会被跳过并计数。',
                    'Import matches by chat and message id; cards whose chat or message is gone are skipped.'
                  )}
                </li>
                <li>
                  {tr(
                    '同 id 卡片不重复写入，本机已有记忆只增不减，不会被覆盖或删除。',
                    'Cards with the same id are not written twice; existing memories are never overwritten.'
                  )}
                </li>
                <li>
                  {tr(
                    '压缩包只含卡片本身：文本、来源、时间、启用与置顶状态；不含对话正文、附件和 API Key。',
                    'The ZIP holds cards only: text, source, time and flags. No message text, attachments or API key.'
                  )}
                </li>
                <li data-risk="">
                  {tr(
                    '归档包含本机记忆内容，可能涉及隐私或敏感信息。导出、存放与转交均需自行评估并承担相应风险；请勿存放于公共设备或转交他人。',
                    'The archive contains what you saved locally and may include private or sensitive content. Deciding whether to export it, where to keep it and whom to share it with is your responsibility.'
                  )}
                </li>
              </ul>
            </section>
            {memoryStatus ? (
              <p
                className={styles.caption}
                role={memoryStatus.type === 'error' ? 'alert' : 'status'}
                data-tone={memoryStatus.type}
              >
                {memoryStatus.text}
              </p>
            ) : null}
          </>
        ) : null}
        {screen === 'export' ? (
          <>
            <p className={styles.pageIntro}>
              {tr(
                '导出会将本机全部对话、设置与记忆打包为 ZIP，用于设备迁移或留档。点击「保存到设备」后由系统文件选择器确定位置；Android 默认写入下载目录。\n示例：更换设备前导出一份，在新设备通过「导入历史对话」选择该 ZIP，按会话 id 合并。\n边界：ZIP 不含 API Key；文件可能包含隐私内容，请自行评估存放位置与共享范围。',
                'Export packs all local chats, settings and memories into a ZIP for migration or archiving. Save to device opens the system file picker; on Android the default is Downloads.\nExample: export before switching phones, then import that ZIP on the new device; sessions merge by id.\nBoundary: the ZIP contains no API key; it may hold private content, so choose where it goes and whom to share it with.'
              )}
            </p>
            <Group>
              <Row
                label={tr('保存到设备', 'Save to device')}
                arrow={false}
                disabled={busy || !sessions}
                onClick={() =>
                  void runExportAction(async () => {
                    setExportSavedName(null)
                    const exported = await exportHistory()
                    if (android) {
                      if (await saveAndroidHistory(exported.name, exported.blob)) {
                        setExportSavedName(exported.name)
                      }
                      return
                    }
                    const url = URL.createObjectURL(exported.blob)
                    const link = document.createElement('a')
                    link.href = url
                    link.download = exported.name
                    link.click()
                    setTimeout(() => URL.revokeObjectURL(url), 10_000)
                    setExportSavedName(exported.name)
                  })
                }
              />
            </Group>
            <p className={styles.caption} role="status">
              {busy
                ? t('historyExporting')
                : exportSavedName
                  ? t('historyExportSaved', { name: exportSavedName })
                  : t(sessions ? 'historyExportDescription' : 'androidNoChats')}
            </p>
          </>
        ) : null}
        {screen === 'font' ? (
          <>
            <p className={styles.pageIntro}>
              {tr(
                '字体大小仅影响界面文字，不改变发送给模型的内容。拖动滑块可即时预览；「跟随系统」使用系统字体缩放，关闭后可固定字号。\n示例：系统缩放后仍偏小→关闭跟随并固定为 18px；小屏需要显示更多行→固定为 14px。\n边界：字号过大将导致长设置项换行，气泡内边距与消息间距不随之变化。',
                'Text size affects interface text only, never what is sent to the model. Drag the slider for a live preview; Follow system uses the OS scale, and turning it off fixes a size.\nExample: the OS is already enlarged but still small → turn off Follow system and fix 18px; more lines on a small screen → fix 14px.\nBoundary: large sizes wrap long setting labels; bubble padding and message spacing stay unchanged.'
              )}
            </p>
            <div
              className={styles.preview}
              style={{
                fontSize: `${16 * (fontSize === null ? (android?.systemFontScale() ?? 1) : 1 + (fontSize - 2) * 0.1)}px`,
              }}
            >
              <span>{tr('预览文字大小', 'Preview text size')}</span>
              <p>
                {tr(
                  '拖动下方滑块调整字号，预览区即时更新。',
                  'Drag the slider below; the preview updates immediately.'
                )}
              </p>
              <p>
                {tr(
                  '示例文本用于观察字号与行距变化，不参与请求。',
                  'You can share questions or suggestions with DeepSeek.'
                )}
              </p>
            </div>
          </>
        ) : null}
        {screen === 'personalization' ? (
          <>
            <p className={styles.pageIntro}>
              {tr(
                '主题色、气泡圆角、聊天布局与消息间距仅改变本地外观，不进入请求。主题色应用于按钮、开关、链接与进度条；布局决定气泡结构。\n示例：深色主题搭配墨绿主题色，气泡使用大圆角，消息间距设为宽松。\n边界：切换布局不修改历史内容；个性化设置不随设定存档导出。',
                'Accent color, bubble corners, chat layout and message spacing are local appearance only. The accent applies to buttons, switches, links and progress bars; layout changes the bubble structure.\nExample: dark mode with green accent, round corners and loose spacing.\nBoundary: switching layout never rewrites history; personalisation is not part of the settings archive.'
              )}
            </p>
            <Group label={tr('主题与气泡', 'Theme & bubbles')}>
              <Row
                label={tr('主题色', 'Accent color')}
                value={
                  accentColor === 'teal'
                    ? tr('青', 'Teal')
                    : accentColor === 'violet'
                      ? tr('藤紫', 'Violet')
                      : accentColor === 'amber'
                        ? tr('琥珀', 'Amber')
                        : accentColor === 'rose'
                          ? tr('玫红', 'Rose')
                          : accentColor === 'green'
                            ? tr('墨绿', 'Green')
                            : tr('经典蓝', 'Blue')
                }
                onClick={() => setPopup('accent')}
              />
              <Row
                label={tr('气泡圆角', 'Bubble corners')}
                value={
                  bubbleRadius === 'compact'
                    ? tr('紧凑', 'Compact')
                    : bubbleRadius === 'round'
                      ? tr('大圆角', 'Round')
                      : tr('标准', 'Standard')
                }
                onClick={() => setPopup('bubbleRadius')}
              />
              <Row
                label={tr('聊天布局', 'Chat layout')}
                value={layoutLabel}
                onClick={() => setPopup('layout')}
              />
              <Row
                label={tr('消息间距', 'Message spacing')}
                value={
                  messageSpacing === 'compact'
                    ? tr('紧凑', 'Compact')
                    : messageSpacing === 'loose'
                      ? tr('宽松', 'Loose')
                      : tr('标准', 'Standard')
                }
                onClick={() => setPopup('messageSpacing')}
              />
            </Group>
            <Group>
              <Row
                label={autoFold}
                control={
                  <Switch
                    label={autoFold}
                    checked={foldThinking}
                    toggle={() => setFoldThinking(!foldThinking)}
                  />
                }
              />
            </Group>
            <p className={styles.caption}>
              {tr(
                '开启后，推理结束会自动收起思考区；流式输出期间仍展开，方便看进度。关闭后保持展开，长回答会占用更多屏幕高度。',
                'When on, the thinking block collapses once reasoning ends; it stays open during streaming so progress remains visible. When off it stays expanded and long answers take more screen height.'
              )}
            </p>
          </>
        ) : null}
        {screen === 'agreements' ? (
          <>
            <p className={styles.pageIntro}>
              {tr(
                '本页列出应用使用的协议与权限说明。点击任一项目将在系统浏览器打开对应页面；清单随版本更新，权限项对应安装时系统展示的权限。\n示例：核对隐私政策中的数据用途，或查看第三方 SDK 共享清单。\n边界：页面内容由对应服务方维护，应用内不保存副本。',
                'This page lists the agreements and permission notes used by the app. Tapping an item opens the corresponding page in the system browser; the list follows app versions, and permission items match what the installer requested.\nExample: verify data use in the privacy policy, or review the third-party SDK list.\nBoundary: the pages are maintained by their providers; the app keeps no local copy.'
              )}
            </p>
            <Group>
              <Row
                label={tr('用户协议', 'Terms of Use')}
                onClick={() =>
                  openAndroidPage(`${localizedPoliciesUrl}/deepseek-terms-of-use.html`)
                }
              />
              <Row
                label={tr('隐私政策', 'Privacy Policy')}
                onClick={() =>
                  openAndroidPage(`${localizedPoliciesUrl}/deepseek-privacy-policy.html`)
                }
              />
              <Row
                label={tr('第三方信息共享清单', 'SDK Sharing List')}
                onClick={() =>
                  openAndroidPage(`${chinesePoliciesUrl}/third-party-info-sharing-list.html`)
                }
              />
              <Row
                label={tr('个人信息收集清单', 'Collected Personal Information')}
                onClick={() =>
                  openAndroidPage(`${chinesePoliciesUrl}/collected-personal-information.html`)
                }
              />
              <Row
                label={tr('应用权限', 'App Permissions')}
                onClick={() => android?.openAppPermissions()}
              />
            </Group>
          </>
        ) : null}
      </div>
      {screen === 'font' ? (
        <div className={styles.fontPanel}>
          <Row
            label={follow}
            control={
              <Switch
                label={follow}
                checked={fontSize === null}
                toggle={() => setFontSize(fontSize === null ? systemFontStep : null)}
              />
            }
          />
          <div className={styles.fontLabels}>
            <small>A</small>
            <span>{tr('标准', 'Standard')}</span>
            <strong>A</strong>
          </div>
          <div className={styles.rangeWrap}>
            <div className={styles.rangeTicks} aria-hidden="true">
              {Array.from({ length: 7 }, (_, step) => (
                <span key={step} />
              ))}
            </div>
            <input
              type="range"
              aria-label={labels.font}
              min="0"
              max="6"
              step="1"
              value={fontSize ?? systemFontStep}
              onChange={(event) => setFontSize(event.target.valueAsNumber)}
            />
          </div>
        </div>
      ) : null}
    </>
  )

  /* -------------------- 功能区：各设置页渲染与页面分发 结束 -------------------- */

  /* -------------------- 功能区：弹层、导入与危险操作确认 开始 -------------------- */
  const popups = (
    <>
      {popup === 'locale' ? (
        <Choice
          title={language}
          icon={<IconGlobeLanguageOutline14 />}
          value={localePreference}
          fields={languages}
          confirmLabel={tr('确认', 'Confirm')}
          confirm={(value) => {
            setLocale(value)
            setPopup(null)
          }}
          dismiss={back}
        />
      ) : null}
      {popup === 'theme' ? (
        <Choice
          title={appearance}
          value={themePreference}
          fields={themes}
          confirmLabel={tr('确认', 'Confirm')}
          onSelect={setThemePreference}
          confirm={(value) => {
            setThemePreference(value)
            setPopup(null)
          }}
          dismiss={back}
        />
      ) : null}
      {popup === 'tokenLimit' ? (
        <div
          className={styles.overlay}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              back()
            }
          }}
        >
          <section
            className={styles.choice}
            role="dialog"
            aria-modal="true"
            aria-label={tr('Token 限额', 'Token limit')}
          >
            <header>{tr('Token 限额', 'Token limit')}</header>
            <p className={styles.choiceHint}>
              {tr(
                '这是本地提醒阈值，不改变服务端计费。达到后按接口实际累计用量提示一次，并显示顶栏胶囊；没有 usage 的请求不计入。',
                'A local alert threshold, not a billing cap. Once API cumulative usage reaches it, one notice appears and the top-bar chip is shown; requests without usage are excluded.'
              )}
            </p>
            <div
              className={styles.options}
              role="radiogroup"
              aria-label={tr('Token 限额预设', 'Token limit presets')}
            >
              {[50000, 256000, 512000, 1000000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  role="radio"
                  aria-checked={tokenLimit === preset}
                  onClick={() => {
                    setTokenLimit(preset)
                    setPopup(null)
                  }}
                >
                  {formatTokenCount(preset)}
                </button>
              ))}
            </div>
            <div className={styles.tokenRow}>
              <input
                className={styles.tokenInput}
                type="number"
                min={1}
                inputMode="numeric"
                value={tokenDraft}
                placeholder={tr('自定义，如 128000', 'Custom, e.g. 128000')}
                aria-label={tr('自定义 Token 限额', 'Custom token limit')}
                onChange={(event) => setTokenDraft(event.target.value)}
              />
              <button
                className={styles.tokenApply}
                type="button"
                onClick={() => {
                  const value = Number(tokenDraft)
                  if (!Number.isFinite(value) || value <= 0) {
                    return
                  }
                  setTokenLimit(value)
                  setPopup(null)
                }}
              >
                {tr('使用', 'Use')}
              </button>
            </div>
            <button
              className={styles.confirm}
              type="button"
              onClick={() => {
                setTokenLimit(0)
                setPopup(null)
              }}
            >
              {tr('关闭提醒', 'Turn off')}
            </button>
          </section>
        </div>
      ) : null}
      {popup === 'memoryExport' ? (
        <div
          className={styles.overlay}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              back()
            }
          }}
        >
          <section
            className={styles.choice}
            role="dialog"
            aria-modal="true"
            aria-label={tr('导出记忆', 'Export memories')}
          >
            <header>{tr('导出记忆', 'Export memories')}</header>
            <p className={styles.choiceHint}>
              {tr(
                '先选顶层分类。导出普通记忆时还能勾选对话、代码、用户原话、AI 原话；导入时按分类合并，原分类保持不变。',
                'Choose the top-level pool first. For normal memory you can also pick dialogue, code, user or AI; imports keep the category.'
              )}
            </p>
            <div
              className={styles.options}
              role="radiogroup"
              aria-label={tr('导出分类', 'Export pool')}
            >
              {(
                [
                  ['all', tr('全部记忆', 'All memories')],
                  ['normal', tr('仅普通记忆', 'Normal only')],
                  ['character', tr('仅角色记忆', 'Character only')],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={memoryExportPool === key}
                  onClick={() => setMemoryExportPool(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {memoryExportPool === 'normal' ? (
              <div
                className={styles.memoryLimitPresets}
                role="group"
                aria-label={tr('普通记忆子分类', 'Normal categories')}
              >
                {NORMAL_MEMORY_KINDS.map((kind) => {
                  const active = memoryExportKinds.includes(kind)
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setMemoryExportKinds((current) =>
                          active
                            ? current.length > 1
                              ? current.filter((item) => item !== kind)
                              : current
                            : [...current, kind]
                        )
                      }
                      style={active ? { borderColor: 'var(--dsw-alias-brand-primary)' } : undefined}
                    >
                      {active ? '✓ ' : ''}
                      {normalMemoryLabel(kind)}
                    </button>
                  )
                })}
              </div>
            ) : null}
            <div className={styles.tokenRow}>
              <button className={styles.confirm} type="button" onClick={() => back()}>
                {tr('取消', 'Cancel')}
              </button>
              <button
                className={styles.tokenApply}
                type="button"
                disabled={busy || memoryBusy}
                onClick={() => {
                  const options: MemoryExportOptions =
                    memoryExportPool === 'normal'
                      ? { pool: 'normal', categories: memoryExportKinds }
                      : { pool: memoryExportPool }
                  setPopup(null)
                  void performMemoryExport(options)
                }}
              >
                {tr('开始导出', 'Export')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {popup === 'backupInterval' ? (
        <div
          className={styles.overlay}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              back()
            }
          }}
        >
          <section
            className={styles.choice}
            role="dialog"
            aria-modal="true"
            aria-label={tr('自动备份间隔', 'Auto backup interval')}
          >
            <header>{tr('自动备份间隔', 'Auto backup interval')}</header>
            <div
              className={styles.options}
              role="radiogroup"
              aria-label={tr('备份间隔预设', 'Backup interval presets')}
            >
              {BACKUP_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  role="radio"
                  aria-checked={autoBackupMinutes === preset}
                  onClick={() => {
                    setAutoBackupMinutes(preset)
                    setPopup(null)
                  }}
                >
                  {formatBackupInterval(preset, tr)}
                </button>
              ))}
            </div>
            <div className={styles.tokenRow}>
              <input
                className={styles.tokenInput}
                type="number"
                min={backupUnit === 'hour' ? 1 : AUTO_BACKUP_MINUTES_MIN}
                max={backupUnit === 'hour' ? AUTO_BACKUP_MINUTES_MAX / 60 : AUTO_BACKUP_MINUTES_MAX}
                inputMode="numeric"
                value={backupDraft}
                placeholder={tr('自定义间隔', 'Custom interval')}
                aria-label={tr('自定义备份间隔', 'Custom backup interval')}
                onChange={(event) => setBackupDraft(event.target.value)}
              />
              <div
                className={styles.backupUnit}
                role="radiogroup"
                aria-label={tr('间隔单位', 'Interval unit')}
              >
                {(['minute', 'hour'] as const).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    role="radio"
                    aria-checked={backupUnit === unit}
                    onClick={() => {
                      if (unit === backupUnit) {
                        return
                      }
                      // 切换单位时把已填数值换算过去，避免 2 小时变成 2 分钟
                      const current = Number(backupDraft)
                      if (Number.isFinite(current) && current > 0) {
                        const minutes = backupUnit === 'hour' ? current * 60 : current
                        setBackupDraft(
                          formatIntervalNumber(unit === 'hour' ? minutes / 60 : minutes)
                        )
                      }
                      setBackupUnit(unit)
                    }}
                  >
                    {unit === 'minute' ? tr('分钟', 'min') : tr('小时', 'h')}
                  </button>
                ))}
              </div>
              <button
                className={styles.tokenApply}
                type="button"
                onClick={() => {
                  const value = Number(backupDraft)
                  const minutes = backupUnit === 'hour' ? value * 60 : value
                  if (!Number.isFinite(minutes) || minutes <= 0) {
                    return
                  }
                  setAutoBackupMinutes(minutes)
                  setPopup(null)
                }}
              >
                {tr('使用', 'Use')}
              </button>
            </div>
            <p className={styles.choiceHint}>
              {tr(
                `${AUTO_BACKUP_MINUTES_MIN} 分钟–${AUTO_BACKUP_MINUTES_MAX / 60} 小时；只有距上次备份超过设定时间才会写盘，保留最近 5 份。`,
                `${AUTO_BACKUP_MINUTES_MIN} min–${AUTO_BACKUP_MINUTES_MAX / 60} h. Writes only after the interval since the last backup, keeping the latest 5 files.`
              )}
            </p>
          </section>
        </div>
      ) : null}
      {popup === 'accent' ? (
        <Choice
          title={tr('主题色', 'Accent color')}
          value={accentColor}
          hint={tr(
            '主题色应用于按钮、选中态、链接与进度条；选择后可在面板中即时预览。',
            'Buttons, selected states and links use this color; tap an option to preview it.'
          )}
          fields={[
            {
              id: 'blue',
              label: tr('经典蓝', 'Blue'),
              description: tr(
                '默认强调色，对比稳定，适合长时间阅读。',
                'Default accent with stable contrast.'
              ),
            },
            {
              id: 'teal',
              label: tr('青', 'Teal'),
              description: tr('偏冷的青绿色，适合深色主题。', 'Cool teal, suited to dark themes.'),
            },
            {
              id: 'violet',
              label: tr('藤紫', 'Violet'),
              description: tr('低饱和藤紫，强调层次更明显。', 'Muted violet with clear emphasis.'),
            },
            {
              id: 'amber',
              label: tr('琥珀', 'Amber'),
              description: tr('暖色强调，适合浅色主题。', 'Warm accent for light themes.'),
            },
            {
              id: 'rose',
              label: tr('玫红', 'Rose'),
              description: tr(
                '偏红的柔和强调色，辨识度较高。',
                'Soft red accent with strong visibility.'
              ),
            },
            {
              id: 'green',
              label: tr('墨绿', 'Green'),
              description: tr(
                '低饱和墨绿，与深色主题对比柔和。',
                'Muted green with soft contrast.'
              ),
            },
          ]}
          confirmLabel={tr('确认', 'Confirm')}
          onSelect={(value) =>
            setAccentColor(
              value === 'teal' ||
                value === 'violet' ||
                value === 'amber' ||
                value === 'rose' ||
                value === 'green'
                ? value
                : 'blue'
            )
          }
          confirm={(value) => {
            setAccentColor(
              value === 'teal' ||
                value === 'violet' ||
                value === 'amber' ||
                value === 'rose' ||
                value === 'green'
                ? value
                : 'blue'
            )
            setPopup(null)
          }}
          dismiss={back}
        />
      ) : null}
      {popup === 'bubbleRadius' ? (
        <Choice
          title={tr('气泡圆角', 'Bubble corners')}
          value={bubbleRadius}
          hint={tr(
            '调整聊天气泡四角弧度；选择后立即应用到对话区。',
            'Changes the corner radius of chat bubbles; applied immediately.'
          )}
          fields={[
            {
              id: 'compact',
              label: tr('紧凑', 'Compact'),
              description: tr('圆角最小，界面更紧凑。', 'Smallest radius for a tighter layout.'),
            },
            {
              id: 'standard',
              label: tr('标准', 'Standard'),
              description: tr(
                '默认圆角，兼顾辨识与空间。',
                'Default radius balancing shape and space.'
              ),
            },
            {
              id: 'round',
              label: tr('大圆角', 'Round'),
              description: tr('圆角最大，气泡轮廓更柔和。', 'Largest radius for softer bubbles.'),
            },
          ]}
          confirmLabel={tr('确认', 'Confirm')}
          onSelect={(value) =>
            setBubbleRadius(value === 'compact' || value === 'round' ? value : 'standard')
          }
          confirm={(value) => {
            setBubbleRadius(value === 'compact' || value === 'round' ? value : 'standard')
            setPopup(null)
          }}
          dismiss={back}
        />
      ) : null}
      {popup === 'messageSpacing' ? (
        <Choice
          title={tr('消息间距', 'Message spacing')}
          value={messageSpacing}
          hint={tr(
            '紧凑模式同时收紧单条消息下方留白；宽松模式增大相邻消息间距。',
            'Compact also tightens the gap under each message; loose spreads neighbouring messages apart.'
          )}
          fields={[
            {
              id: 'compact',
              label: tr('紧凑', 'Compact'),
              description: tr(
                '消息间距最小，单屏可显示更多内容。',
                'Tightest spacing for more content per screen.'
              ),
            },
            {
              id: 'normal',
              label: tr('标准', 'Standard'),
              description: tr('默认间距，兼顾阅读与信息密度。', 'Default spacing.'),
            },
            {
              id: 'loose',
              label: tr('宽松', 'Loose'),
              description: tr(
                '消息间距更大，分段更清晰。',
                'Wider spacing for clearer separation.'
              ),
            },
          ]}
          confirmLabel={tr('确认', 'Confirm')}
          onSelect={(value) =>
            setMessageSpacing(value === 'compact' || value === 'loose' ? value : 'normal')
          }
          confirm={(value) => {
            setMessageSpacing(value === 'compact' || value === 'loose' ? value : 'normal')
            setPopup(null)
          }}
          dismiss={back}
        />
      ) : null}
      {popup === 'avatarShape' ? (
        <Choice
          title={tr('头像形状', 'Avatar shape')}
          value={avatarShape}
          fields={[
            {
              id: 'circle',
              label: tr('圆形', 'Circle'),
              description: tr('正圆裁切，适合人物头像。', 'Circular crop for portraits.'),
            },
            {
              id: 'rounded',
              label: tr('圆角方形', 'Rounded'),
              description: tr(
                '圆角方形，保留更多画面边缘。',
                'Rounded square preserving more of the frame.'
              ),
            },
          ]}
          confirmLabel={tr('确认', 'Confirm')}
          confirm={(value) => {
            setAvatarShape(value === 'rounded' ? 'rounded' : 'circle')
            setPopup(null)
          }}
          dismiss={back}
        />
      ) : null}
      {popup === 'avatarCharacter' ? (
        <Choice
          title={tr('角色头像大小', 'Character avatar size')}
          value={String(characterAvatarSize)}
          fields={[
            {
              id: '20',
              label: tr('小 20', 'Small 20'),
              description: tr('占用 20px，适合信息密集的列表。', '20px, suited to dense lists.'),
            },
            {
              id: '24',
              label: tr('标准 24', 'Default 24'),
              description: tr('占用 24px，默认尺寸。', '24px, the default size.'),
            },
            {
              id: '30',
              label: tr('大 30', 'Large 30'),
              description: tr('占用 30px，头像更突出。', '30px for stronger emphasis.'),
            },
            {
              id: '36',
              label: tr('特大 36', 'Extra 36'),
              description: tr(
                '占用 36px，适合单人或短对话。',
                '36px for short or single-character chats.'
              ),
            },
          ]}
          confirmLabel={tr('确认', 'Confirm')}
          confirm={(value) => {
            setCharacterAvatarSize(Number(value))
            setPopup(null)
          }}
          dismiss={back}
        />
      ) : null}
      {popup === 'avatarUser' ? (
        <Choice
          title={tr('我的头像大小', 'My avatar size')}
          value={String(userAvatarSize)}
          fields={[
            {
              id: '20',
              label: tr('小 20', 'Small 20'),
              description: tr('占用 20px，适合信息密集的列表。', '20px, suited to dense lists.'),
            },
            {
              id: '24',
              label: tr('标准 24', 'Default 24'),
              description: tr('占用 24px，默认尺寸。', '24px, the default size.'),
            },
            {
              id: '30',
              label: tr('大 30', 'Large 30'),
              description: tr('占用 30px，头像更突出。', '30px for stronger emphasis.'),
            },
            {
              id: '36',
              label: tr('特大 36', 'Extra 36'),
              description: tr(
                '占用 36px，适合单人或短对话。',
                '36px for short or single-character chats.'
              ),
            },
          ]}
          confirmLabel={tr('确认', 'Confirm')}
          confirm={(value) => {
            setUserAvatarSize(Number(value))
            setPopup(null)
          }}
          dismiss={back}
        />
      ) : null}
      {popup === 'layout' ? (
        <Choice
          title={tr('聊天布局', 'Chat layout')}
          value={chatLayout}
          hint={tr(
            '气泡配色仅作用于对话区，不改变侧栏与设置页面。',
            'Bubble colors only affect the chat area, not the sidebar or settings.'
          )}
          fields={layouts}
          confirmLabel={tr('确认', 'Confirm')}
          onSelect={setChatLayout}
          confirm={(value) => {
            setChatLayout(value)
            setPopup(null)
          }}
          dismiss={back}
        />
      ) : null}
      {popup === 'voice' ? (
        <div
          className={styles.overlay}
          data-sheet=""
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              back()
            }
          }}
        >
          <section className={styles.voiceSheet} role="dialog" aria-modal="true" aria-label={voice}>
            <header>
              {voice}
              <button type="button" aria-label={t('close')} onClick={back}>
                <IconCloseOutline16 />
              </button>
            </header>
            <div
              className={styles.voiceBody}
              onTouchStart={(event) => {
                event.currentTarget.dataset.swipeX = String(event.touches[0].clientX)
              }}
              onTouchEnd={(event) => {
                const dx =
                  event.changedTouches[0].clientX - Number(event.currentTarget.dataset.swipeX)
                if (Math.abs(dx) > 32) {
                  setTone(dx > 0 ? 'stella' : 'tide')
                }
              }}
            >
              <div className={styles.voiceArt} data-tone={tone} aria-hidden="true" />
              <div>{currentTone.label}</div>
              <small>{currentTone.description}</small>
              <div className={styles.dots} role="radiogroup" aria-label={voice}>
                {tones.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-label={item.label}
                    aria-checked={tone === item.id}
                    onClick={() => setTone(item.id)}
                  />
                ))}
              </div>
            </div>
            <button
              className={styles.primary}
              type="button"
              onClick={() => {
                setTtsVoice(tone)
                setPopup(null)
              }}
            >
              {tr('确认', 'Confirm')}
            </button>
          </section>
        </div>
      ) : null}
      {popup === 'import' ? (
        <div
          className={styles.overlay}
          data-sheet=""
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              back()
            }
          }}
        >
          <section
            className={styles.importSheet}
            role="dialog"
            aria-modal="true"
            aria-label={t('historyImportConfirmTitle')}
          >
            <header className={styles.importHeader}>{t('historyImportConfirmTitle')}</header>
            <div
              className={styles.importModes}
              role="radiogroup"
              aria-label={t('historyImportConfirmTitle')}
            >
              {[
                {
                  id: 'merge' as const,
                  title: t('historyImportModeMerge'),
                  description: t('historyImportModeMergeDescription'),
                },
                {
                  id: 'replace' as const,
                  title: t('historyImportModeReplace'),
                  description: t('historyImportModeReplaceDescription'),
                },
              ].map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  role="radio"
                  aria-checked={importMode === mode.id}
                  data-selected={importMode === mode.id}
                  data-danger={mode.id === 'replace'}
                  className={styles.importMode}
                  disabled={busy}
                  onClick={() => setImportMode(mode.id)}
                >
                  <span className={styles.importModeText}>
                    <span className={styles.importModeTitle}>{mode.title}</span>
                    <span className={styles.importModeDescription}>{mode.description}</span>
                  </span>
                  <span className={styles.importCheck} aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className={styles.importFooter}>
              <button type="button" className={styles.importCancel} disabled={busy} onClick={back}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className={styles.importConfirm}
                disabled={busy}
                data-danger={importMode === 'replace'}
                onClick={() => void confirmAction()}
              >
                {t(
                  importMode === 'merge'
                    ? 'historyImportMergeConfirm'
                    : 'historyImportReplaceConfirm'
                )}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {popup === 'logout' || popup === 'delete' ? (
        <div className={styles.overlay}>
          <section className={styles.choice} role="dialog" aria-modal="true">
            <header>{popup === 'logout' ? logout : clear}</header>
            <p className={styles.message}>
              {popup === 'logout'
                ? tr('确认退出当前 API Key？', 'Sign out of this API Key?')
                : t('deleteAllSessionsModalDescription')}
            </p>
            <div className={styles.confirmActions}>
              <button className={styles.confirm} disabled={busy} onClick={back}>
                {t('cancel')}
              </button>
              <button
                className={styles.confirm}
                disabled={busy}
                data-danger
                onClick={() => void confirmAction()}
              >
                {t('confirm')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )

  /* -------------------- 功能区：弹层、导入与危险操作确认 结束 -------------------- */

  /* -------------------- 功能区：页面栈渲染收尾 开始 -------------------- */
  const pages = [page]
  for (let parent = parentPage[page]; parent; parent = parentPage[parent]) {
    pages.unshift(parent)
  }

  return (
    <div ref={pagesRef}>
      {pages.map((screen) => {
        const active = screen === page
        return (
          <section
            key={screen}
            className={styles.page}
            data-settings-page={screen}
            data-settings-desktop={android ? undefined : ''}
            role="region"
            aria-label={labels[screen]}
            aria-hidden={active ? undefined : true}
          >
            <div className={styles.desktopFrame}>
              {screen === page ? (
                <aside className={styles.desktopRail}>
                  <div className={styles.desktopRailHeader}>
                    <span className={styles.desktopRailBrand}>DeepSeek Replica</span>
                    <button
                      type="button"
                      className={styles.desktopRailClose}
                      aria-label={tr('关闭设置', 'Close settings')}
                      onClick={closeSettings}
                    >
                      <IconCloseOutline16 />
                    </button>
                  </div>
                  <nav className={styles.desktopRailNav} aria-label={tr('设置导航', 'Settings navigation')}>
                    {desktopNavigation.map((group) => (
                      <div key={group.label} className={styles.desktopRailGroup}>
                        <div className={styles.desktopRailGroupLabel}>{group.label}</div>
                        {group.items.map((item) => (
                          <button
                            key={item.page}
                            type="button"
                            className={styles.desktopRailItem}
                            data-active={activeNavigationPage === item.page ? '' : undefined}
                            aria-current={activeNavigationPage === item.page ? 'page' : undefined}
                            onClick={() => openPage(item.page)}
                          >
                            <span className={styles.desktopRailIcon}>
                              <FeatureIcon label={item.icon} />
                            </span>
                            <span className={styles.desktopRailLabel}>{item.label}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </nav>
                  {appVersion ? (
                    <div className={styles.desktopRailFoot}>v{appVersion}</div>
                  ) : null}
                </aside>
              ) : null}
              <div className={styles.desktopContent}>
                <div className={styles.pageContent}>{renderPage(screen)}</div>
              </div>
            </div>
            {active ? popups : null}
            {active ? (
              <TokenUsagePanel open={usageOpen} onClose={() => setUsageOpen(false)} />
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
/* -------------------- 功能区：页面栈渲染收尾 结束 -------------------- */

/* ============================================================================
 * 功能区：设置页 / AndroidSettings 结束
 * ========================================================================== */
