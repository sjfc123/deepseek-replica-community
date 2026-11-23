import { create } from 'zustand'

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
