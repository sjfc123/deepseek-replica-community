/* ============================================================================
 * 功能区：视图与交互 / useThrottleMarkdownRender
 * 职责：Markdown 节流渲染 Hook：控制流式内容的渲染频率与取消。
 * 分区：01 类型、契约与依赖
 * 关联：无内部依赖；被 components/markdown/Markdown 引用。
 * 导出：useThrottleMarkdownRender
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useEffect, useRef, useState } from 'react'

/* ---- 01 类型、契约与依赖 ---- */
/** 两次更新的最长间隔 */
const MAX_WAIT = 2000
/** 上次渲染耗时的倍数，过了这段时间才允许下次更新 */
const TIME_CONSUMING_RATE = 2

/**
 * 流式过程中按渲染耗时节流 Markdown 内容的更新：
 * 更新输出时记录开始时间，提交后按耗时 × TIME_CONSUMING_RATE（不超过 MAX_WAIT）
 * 算出下次允许更新的时间点，并遵守最短更新间隔；连续输入合并为最新内容。
 * 关闭节流时直接返回最新内容。
 */
export const useThrottleMarkdownRender = (content: string, enable: boolean, minInterval = 0) => {
  // 首次渲染从挂载时开始计时
  const startRef = useRef(performance.now())
  const updatableAtRef = useRef(0)
  const [output, setOutput] = useState(content)

  useEffect(() => {
    const now = performance.now()
    const renderCost = (now - startRef.current) * TIME_CONSUMING_RATE
    updatableAtRef.current = now + Math.min(MAX_WAIT, Math.max(minInterval, renderCost))
  }, [minInterval, output])

  useEffect(() => {
    if (!enable || content === output) {
      return
    }
    const update = () => {
      startRef.current = performance.now()
      setOutput(content)
    }
    const delay = updatableAtRef.current - performance.now()
    if (delay <= 0) {
      update()
      return
    }
    const timer = setTimeout(update, delay)
    return () => clearTimeout(timer)
  }, [content, enable, output])

  return enable ? output : content
}

/* ============================================================================
 * 功能区：Markdown 视图 / useThrottleMarkdownRender 结束
 * ========================================================================== */
