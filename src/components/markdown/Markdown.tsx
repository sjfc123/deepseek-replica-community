/* ============================================================================
 * 功能区：视图与交互 / Markdown
 * 职责：Markdown 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、契约与依赖；02 对外入口与收尾
 * 关联：依赖 app/android、components/markdown/MarkdownAstRenderer、components/markdown/highlight、components/markdown/markdown 等 8 个模块；
 *    被 components/messages/AssistantMessage、components/messages/ReplyArea 引用。
 * 导出：Markdown
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { memo, startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { android } from '../../app/android.js'
import type { Source } from '../../services/chat/view.js'
import { toMdAst } from '../../services/markdown/parse.js'
import {
  parseOffMainThread,
  type ParsedMarkdown,
} from '../../services/markdown/parseOffMainThread.js'
import { MarkdownAstRenderer } from './MarkdownAstRenderer.js'
import { useThrottleMarkdownRender } from './useThrottleMarkdownRender.js'
import './markdown.css'
import './highlight.css'

/* ---- 01 类型、契约与依赖 ---- */
const ANDROID_STREAM_INTERVAL = 50

/* ---- 02 对外入口与收尾 ---- */
/**
 * 渲染链路：节流 → 解析 AST → 渲染。
 * 传入 sources 时把正文里的 [citation:N] 渲染为角标。
 */
export const Markdown = memo(function Markdown({
  content,
  loading,
  cacheKey,
  className,
  disableLink,
  sources,
}: {
  content: string
  loading: boolean
  cacheKey: string
  className?: string
  disableLink: boolean
  sources?: Source[]
}) {
  const throttledMarkdown = useThrottleMarkdownRender(
    content,
    loading,
    android ? ANDROID_STREAM_INTERVAL : 0
  )
  const options = useMemo(() => ({ sources, disableLink }), [sources, disableLink])
  const request = useMemo(
    () => ({ content: throttledMarkdown, options, key: cacheKey }),
    [throttledMarkdown, options, cacheKey]
  )
  const [workerFailed, setWorkerFailed] = useState(false)
  const [parsed, setParsed] = useState<{ request: typeof request; result: ParsedMarkdown }>()
  const busy = useRef(false)
  // Android WebView 上历史消息同样走 Worker：首次打开长会话时不再由主线程同步解析整屏 Markdown。
  const useWorker = Boolean(android && !workerFailed && request.content)
  const syncAst = useMemo(
    () => (!useWorker && request.content ? toMdAst(request.content, request.options) : null),
    [request, useWorker]
  )
  const lastSync = useRef<{ request: typeof request; ast: NonNullable<typeof syncAst> }>()

  useEffect(() => {
    if (!useWorker) {
      lastSync.current = syncAst ? { request, ast: syncAst } : undefined
      return
    }
    // 同一视图只保留一个解析任务。任务完成后再处理当前最新文本。
    if (busy.current || parsed?.request === request) {
      return
    }
    busy.current = true
    const previous = parsed?.request.key === request.key ? parsed.result : undefined
    void parseOffMainThread(request.content, request.options, previous).then((result) => {
      busy.current = false
      if (result) {
        startTransition(() => setParsed({ request, result }))
      } else {
        setWorkerFailed(true)
      }
    })
  }, [cacheKey, parsed, request, syncAst, useWorker])

  const matches = (candidate: typeof request | undefined) =>
    candidate?.key === cacheKey && candidate.options === options
  const previousAst = matches(parsed?.request) ? parsed?.result.ast : undefined
  const ast = useWorker
    ? (previousAst ?? (matches(lastSync.current?.request) ? lastSync.current?.ast : undefined))
    : syncAst
  if (!ast) {
    // 解析在 Worker 里进行时先按纯文本占位，保证打开长会话能立刻看到内容且主线程不被同步解析占住。
    return request.content ? (
      <div className={className ? `ds-markdown ds-markdown-waiting ${className}` : 'ds-markdown ds-markdown-waiting'}>
        {request.content}
      </div>
    ) : null
  }
  return (
    <MarkdownAstRenderer
      key={cacheKey}
      className={className}
      ast={ast}
      loading={loading || (useWorker && parsed?.request !== request)}
    />
  )
})

/* ============================================================================
 * 功能区：Markdown 视图 / Markdown 结束
 * ========================================================================== */
