/* ============================================================================
 * 功能区：视图与交互 / memoryPanelState · 记忆面板状态
 * 职责：记忆面板状态：面板开关、分类与筛选的轻量存储。
 * 分区：01 类型、契约与依赖
 * 关联：无内部依赖；
 *    被 components/memory/MemoryAddedToast、components/memory/MemoryPanel、components/messages/AssistantMessage、components/session/SessionView 引用。
 * 导出：useMemoryPanel、openMemoryPanel、closeMemoryPanel
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { create } from 'zustand'

/* ---- 01 类型、契约与依赖 ---- */
/** 记忆面板开关：全局一份，会话页顶栏按钮触发 */
type MemoryPanelState = {
  open: boolean
  setOpen: (open: boolean) => void
}

export const useMemoryPanel = create<MemoryPanelState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

export const openMemoryPanel = () => useMemoryPanel.getState().setOpen(true)
export const closeMemoryPanel = () => useMemoryPanel.getState().setOpen(false)

/* ============================================================================
 * 功能区：长期记忆界面 / memoryPanelState 结束
 * ========================================================================== */
