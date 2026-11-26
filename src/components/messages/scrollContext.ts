/* ============================================================================
 * 功能区：视图与交互 / scrollContext · 滚动上下文
 * 职责：滚动上下文：向消息节点共享滚动容器与可见性。
 * 分区：01 类型、契约与依赖
 * 关联：无内部依赖；
 *    被 components/messages/MessageList、components/messages/ReplyArea 引用。
 * 导出：ScrollToBottomContext、useStopFollowing
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { createContext, useContext } from 'react'

/* ---- 01 类型、契约与依赖 ---- */
/** 用户上滑或展开思考内容时暂停跟随底部。 */
export const ScrollToBottomContext = createContext(() => {})

export const useStopFollowing = () => useContext(ScrollToBottomContext)

/* ============================================================================
 * 功能区：消息渲染 / scrollContext 结束
 * ========================================================================== */
