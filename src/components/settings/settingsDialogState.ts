/* ============================================================================
 * 功能区：视图与交互 / settingsDialogState · 设置弹窗状态
 * 职责：设置弹窗状态：打开分区、API Key 引导与关闭。
 * 分区：01 类型、契约与依赖
 * 关联：依赖 services/settings；
 *    被 app/App、components/chatInput/ChatInput、components/messages/AssistantMessage、components/messages/MessageFile 等 9 个模块 引用。
 * 导出：SettingsSection、useSettingsDialog、openSettings、closeSettings、ensureApiKey
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'

/* ---- 01 类型、契约与依赖 ---- */
export type SettingsSection =
  | 'general'
  | 'account'
  | 'data'
  | 'advanced'
  | 'roleplay'
  | 'memory'
  | 'sampling'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有 API Key 时打开设置并选中 API Key 所在的「数据管理」，返回是否已有 Key */
export const ensureApiKey = (deepSeekOnly = false) => {
  const { apiKey, chatConfig } = useSettings.getState()
  if (apiKey || (!deepSeekOnly && chatConfig.endpoint)) {
    return true
  }
  openSettings('data')
  return false
}

/* ============================================================================
 * 功能区：设置页 / settingsDialogState 结束
 * ========================================================================== */
