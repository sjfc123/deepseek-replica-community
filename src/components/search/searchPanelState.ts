/* ============================================================================
 * 功能区：视图与交互 / searchPanelState · 搜索面板状态
 * 职责：搜索面板状态：面板开关、查询与来源筛选。
 * 分区：01 类型、契约与依赖
 * 关联：依赖 services/chat/view；
 *    被 app/App、components/messages/AssistantMessage、components/messages/MessageList、components/messages/ReplyArea 等 7 个模块 引用。
 * 导出：SearchPanelTitle、useSearchPanel、toggleSearchPanel、closeSearchPanel
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { create } from 'zustand'
import type { Source } from '../../services/chat/view.js'

/* ---- 01 类型、契约与依赖 ---- */
export type SearchPanelTitle = 'searchResult' | 'browsedSearchResult'

/** 右侧「搜索结果」面板：同一入口再次点击收起，换入口时替换内容 */
type SearchPanelState = {
  /** 打开面板的入口，用于判断再次点击是否收起 */
  entry: string | null
  sources: Source[]
  title: SearchPanelTitle
}

const closedPanel: SearchPanelState = { entry: null, sources: [], title: 'searchResult' }
export const useSearchPanel = create<SearchPanelState>(() => closedPanel)

export const toggleSearchPanel = (
  entry: string,
  sources: Source[],
  title: SearchPanelTitle = 'searchResult'
) =>
  useSearchPanel.setState((state) =>
    state.entry === entry ? closedPanel : { entry, title, sources }
  )

export const closeSearchPanel = () => useSearchPanel.setState(closedPanel)

/* ============================================================================
 * 功能区：搜索与引用 / searchPanelState 结束
 * ========================================================================== */
