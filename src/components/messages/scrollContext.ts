/* ============================================================================
 * 功能区：消息渲染 / scrollContext 开始
 * 职责：滚动上下文：向消息节点共享滚动容器与可见性。
 * 导出：ScrollToBottomContext、useStopFollowing。
 * ========================================================================== */

import { createContext, useContext } from 'react'

/** 用户上滑或展开思考内容时暂停跟随底部。 */
export const ScrollToBottomContext = createContext(() => {})

export const useStopFollowing = () => useContext(ScrollToBottomContext)

/* ============================================================================
 * 功能区：消息渲染 / scrollContext 结束
 * ========================================================================== */
