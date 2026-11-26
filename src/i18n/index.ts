/* ============================================================================
 * 功能区：国际化文案 / index · 国际化运行时
 * 职责：国际化运行时：语言检测、偏好持久化、翻译函数与订阅。
 * 分区：01 类型、契约与依赖
 * 关联：依赖 i18n/en、i18n/zh、services/settings；
 *    被 app/App、app/openAndroidPage、components/base/Modal、components/base/Toast 等 55 个模块 引用。
 * 导出：TranslationKey、TranslationParams、TranslationMessage、LinkedMessage、isTranslationKey、useAndroidWelcomeMessages、useTranslate、translate
 * 边界：只维护文案表、语言选择与插值函数；不包含业务分支与网络副作用。
 * ========================================================================== */

import { useSettings } from '../services/settings.js'
import {
  androidWelcomeMessages as enAndroidWelcomeMessages,
  en,
} from './en.js'
import {
  androidWelcomeMessages as zhAndroidWelcomeMessages,
  zh,
} from './zh.js'

/* ---- 01 类型、契约与依赖 ---- */
export type TranslationKey = keyof typeof zh
export type TranslationParams = Record<string, string | number>
export type TranslationMessage = { key: TranslationKey; params?: TranslationParams }
/** 带文字链接的提示：link 跟在正文后，在新窗口打开；type 为 error 时前面带错误图标 */
export type LinkedMessage = TranslationMessage & {
  type?: 'error'
  link?: { key: TranslationKey; href: string }
}

export const isTranslationKey = (key: unknown): key is TranslationKey =>
  typeof key === 'string' && Object.hasOwn(zh, key)

const createTranslate =
  (messages: Record<TranslationKey, string>) =>
  (key: TranslationKey, params?: TranslationParams): string =>
    messages[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params?.[name]
      return typeof value === 'string' || typeof value === 'number' ? String(value) : placeholder
    })

const translators = {
  'zh-CN': createTranslate(zh),
  'en-US': createTranslate(en),
}

const androidWelcomeMessages = {
  'zh-CN': zhAndroidWelcomeMessages,
  'en-US': enAndroidWelcomeMessages,
}

export const useAndroidWelcomeMessages = () =>
  useSettings((state) => androidWelcomeMessages[state.locale])

/** 组件订阅语言变化；普通函数在调用时读取当前语言。 */
export const useTranslate = () => useSettings((state) => translators[state.locale])

export const translate = (key: TranslationKey, params?: TranslationParams): string =>
  translators[useSettings.getState().locale](key, params)

/* ============================================================================
 * 功能区：国际化 / index 结束
 * ========================================================================== */
