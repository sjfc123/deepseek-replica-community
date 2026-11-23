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

const ANDROID_STREAM_INTERVAL = 50

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
  const workerKey = useRef<string>()
  const useWorker = Boolean(
    android && !workerFailed && request.content && (loading || workerKey.current === cacheKey)
  )
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
    workerKey.current = cacheKey
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
  return ast ? (
    <MarkdownAstRenderer
      key={cacheKey}
      className={className}
      ast={ast}
      loading={loading || (useWorker && parsed?.request !== request)}
    />
  ) : null
})
