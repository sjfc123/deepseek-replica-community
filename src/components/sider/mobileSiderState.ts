import { create } from 'zustand'
import { isAndroidWide } from '../../app/viewport.js'

/** 移动端侧边栏：窄屏为浮层抽屉（默认收起），Android 宽屏（>= 840px）为左侧分栏（默认展开） */
export const useMobileSider = create(() => ({
  open: isAndroidWide(),
  /** 侧边栏内容搜索页是否处于打开状态；从搜索结果跳转会话后保留，再开抽屉直接回到搜索结果 */
  searchOpen: false,
}))

export const openMobileSider = () => useMobileSider.setState({ open: true })

export const closeMobileSider = () => useMobileSider.setState({ open: false })

export const toggleMobileSider = () => useMobileSider.setState((state) => ({ open: !state.open }))

export const openDrawerSearch = () => useMobileSider.setState({ open: true, searchOpen: true })

export const closeDrawerSearch = () => useMobileSider.setState({ searchOpen: false })

/** 仅在浮层抽屉模式下收起侧边栏，保留 Android 宽屏常驻分栏的当前开合状态 */
export const closeOverlaySider = () => {
  if (!isAndroidWide()) {
    closeMobileSider()
  }
}
