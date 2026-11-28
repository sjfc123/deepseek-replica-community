/* ============================================================================
 * 功能区：视图与交互 / useReplyView · 回复视图 Hook
 * 职责：回复视图 Hook：管理折叠、展开与可见内容。
 * 分区：01 类型、契约与依赖
 * 关联：依赖 services/chat/types、services/chat/view；
 *    被 components/messages/AssistantMessage 引用。
 * 导出：useReplyView
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useMemo, useState } from 'react'
import type { AssistantMessage } from '../../services/chat/types.js'
import { resolveUserName } from '../../services/settings.js'
import { buildReplyView, type Source } from '../../services/chat/view.js'

/* ---- 01 类型、契约与依赖 ---- */
const sameSource = (a: Source, b: Source) =>
  a.url === b.url &&
  a.title === b.title &&
  a.siteName === b.siteName &&
  a.publishedAt === b.publishedAt &&
  a.snippet === b.snippet &&
  a.siteIcon === b.siteIcon &&
  a.index === b.index

/**
 * 将助手消息转换为界面渲染所需的回复视图数据：步骤时间线、正文、引用来源和搜索结果。
 * 来源内容未变时复用 sources 数组，避免流式文本更新绕过 Markdown 的解析节流。
 */
export const useReplyView = (message: AssistantMessage, streaming: boolean) => {
  const view = useMemo(
    () => buildReplyView(message, streaming, resolveUserName()),
    [message, streaming]
  )
  const [sources, setSources] = useState(view.sources)

  // 仅来源编号、顺序或元数据变化时更新状态，普通文本增量沿用已有数组。
  if (
    sources !== view.sources &&
    (sources.length !== view.sources.length ||
      !sources.every((source, index) => sameSource(source, view.sources[index])))
  ) {
    setSources(view.sources)
  }

  return useMemo(() => ({ ...view, sources }), [view, sources])
}

/* ============================================================================
 * 功能区：消息渲染 / useReplyView 结束
 * ========================================================================== */
