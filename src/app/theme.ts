import { useSyncExternalStore } from 'react'
import {
  useSettings,
  type AccentColor,
  type BubbleRadius,
  type MessageSpacing,
  type ThemePreference,
} from '../services/settings.js'
import { android } from './android.js'

export type Theme = 'light' | 'dark'

const query = window.matchMedia('(prefers-color-scheme: dark)')

const subscribeOsTheme = (listener: () => void) => {
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

const getOsTheme = (): Theme => (query.matches ? 'dark' : 'light')

const resolveTheme = (preference: ThemePreference, osTheme: Theme): Theme =>
  preference === 'system' ? osTheme : preference

/** 当前实际生效的深浅色：手动选择优先，「跟随系统」时取系统设置 */
export const useTheme = (): Theme => {
  const preference = useSettings((state) => state.themePreference)
  const osTheme = useSyncExternalStore(subscribeOsTheme, getOsTheme)
  return resolveTheme(preference, osTheme)
}

const syncPageBackground = () => {
  const backgroundColor = getComputedStyle(document.body).backgroundColor
  document.documentElement.style.backgroundColor = backgroundColor
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgroundColor)
}

/** 同步页面主题、根画布背景和支持 theme-color 的浏览器栏。 */
const applyTheme = (theme: Theme) => {
  const body = document.body
  // 主题切换帧禁用过渡，使页面颜色同步更新
  body.classList.add('change-theme')
  body.classList.toggle('dark', theme === 'dark')
  body.classList.toggle('light', theme === 'light')
  if (theme === 'dark') {
    body.setAttribute('data-ds-dark-theme', 'dark')
  } else {
    body.removeAttribute('data-ds-dark-theme')
  }
  document.documentElement.style.colorScheme = theme
  android?.setDarkBars(theme === 'dark')
  // 首次背景色同步在样式表加载完成后执行，适配 WebKit 的 defer 脚本执行顺序。
  if (document.readyState === 'complete') {
    syncPageBackground()
  }
  setTimeout(() => {
    body.classList.remove('change-theme')
  }, 0)
}

/**
 * 主题色只覆盖强调色变量；深浅底色仍由 light / dark 两套样式控制，
 * 因此这里的色值要在白底与深底上都能读，不再按模式分两套。
 */
const ACCENTS: Record<AccentColor, { primary: string; text: string }> = {
  blue: { primary: '#4d6bfe', text: '#4256d6' },
  teal: { primary: '#0ea5a5', text: '#0b7f7f' },
  violet: { primary: '#8a5cf6', text: '#6f44d6' },
  amber: { primary: '#e8892b', text: '#c06c18' },
  rose: { primary: '#e05587', text: '#bf3d6c' },
  green: { primary: '#2f9e6b', text: '#257d54' },
}

const BUBBLE_RADII: Record<BubbleRadius, string> = {
  compact: '12px',
  standard: '22px',
  round: '28px',
}

/* 消息列本身没有 gap，这里只补相邻消息的额外留白；标准档为 0，保持默认观感不变 */
const MESSAGE_GAPS: Record<MessageSpacing, string> = {
  compact: '0px',
  normal: '10px',
  loose: '20px',
}

/** 把主题色与气泡参数写成根变量，组件里用 var() 取值，切换即时生效 */
const applyAppearance = () => {
  const { accentColor, bubbleRadius, messageSpacing } = useSettings.getState()
  const accent = ACCENTS[accentColor] ?? ACCENTS.blue
  // 深色底上用主色本身，浅色底才用压暗的文字色；同一套变量在两种外观下都要能读
  const accentText = appliedTheme === 'dark' ? accent.primary : accent.text
  // body 上有一套主题变量（深浅色各一份），只在 html 上写会被继承覆盖，
  // 所以在 html 与 body 同时写入，深色模式切换后也仍然优先。
  for (const target of [document.documentElement.style, document.body.style]) {
    // 实心按钮与局部样式里有不带变量的写死蓝色，这里用 important 把品牌色压在最上层，
    // 避免子选择器或组件内规则把主题色重新拉回默认蓝。
    target.setProperty('--dsw-alias-brand-primary', accent.primary, 'important')
    target.setProperty('--dsw-alias-brand-text', accentText, 'important')
    target.setProperty('--dsw-alias-button-primary-fill', accent.primary, 'important')
    target.setProperty('--dsw-alias-button-primary-hover', accent.primary, 'important')
    target.setProperty('--replica-accent', accent.primary, 'important')
    target.setProperty('--replica-accent-text', accentText, 'important')
    target.setProperty('--replica-bubble-radius', BUBBLE_RADII[bubbleRadius] ?? BUBBLE_RADII.standard)
    target.setProperty('--replica-message-gap', MESSAGE_GAPS[messageSpacing] ?? MESSAGE_GAPS.normal)
  }
  document.documentElement.dataset.messageSpacing = messageSpacing
}

let appliedTheme: Theme | null = null

const syncTheme = () => {
  const theme = resolveTheme(useSettings.getState().themePreference, getOsTheme())
  if (theme !== appliedTheme) {
    appliedTheme = theme
    applyTheme(theme)
    // 深色与浅色使用不同的品牌文字色，切外观时同步重写
    applyAppearance()
  }
}

/** 首屏渲染前同步应用一次，之后随主题设置与系统深浅色变化更新 */
export const setupTheme = () => {
  syncTheme()
  applyAppearance()
  if (document.readyState !== 'complete') {
    window.addEventListener('load', syncPageBackground, { once: true })
  }
  query.addEventListener('change', syncTheme)
  useSettings.subscribe(syncTheme)
  let lastAccent = useSettings.getState().accentColor
  let lastRadius = useSettings.getState().bubbleRadius
  let lastGap = useSettings.getState().messageSpacing
  useSettings.subscribe((state) => {
    if (
      state.accentColor !== lastAccent ||
      state.bubbleRadius !== lastRadius ||
      state.messageSpacing !== lastGap
    ) {
      lastAccent = state.accentColor
      lastRadius = state.bubbleRadius
      lastGap = state.messageSpacing
      applyAppearance()
    }
  })
}
