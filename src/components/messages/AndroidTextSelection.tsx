/* ============================================================================
 * 功能区：视图与交互 / AndroidTextSelection
 * 职责：AndroidTextSelection 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、常量与模块依赖；
 *    02 读取与解析（getAllSelectedClientRects、findBlockScope、getSegmentElement…）；
 *    03 读取与解析（resolveOffsetGeometric、resolveOffsetAtPoint、countTrailingNewlines…）；
 *    04 功能实现（AndroidTextSelection）
 * 关联：依赖 app/android、app/useAndroidBackInterception、components/base/icons、components/base/toastState 等 7 个模块；
 *    被 components/messages/AssistantMessage、components/messages/UserMessage 引用。
 * 导出：AndroidTextSelection
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { android } from '../../app/android.js'
import { useAndroidBackInterception } from '../../app/useAndroidBackInterception.js'
import { useTranslate } from '../../i18n/index.js'
import { showToast } from '../base/toastState.js'
import { copyText } from '../../utils/clipboard.js'
import { IconCopyOutline16, IconSelectAllOutline16 } from '../base/icons.js'
import styles from './AndroidTextSelection.module.css'

/* ---- 01 类型、常量与模块依赖 ---- */
type TextSegment = {
  kind: 'text'
  node: Text
  start: number
  end: number
}

type AtomicSegment = {
  kind: 'atomic'
  element: HTMLElement
  text: string
  display: boolean
  start: number
  end: number
}

type SelectionSegment = TextSegment | AtomicSegment

type OffsetRange = {
  start: number
  end: number
}

type RectBox = {
  left: number
  top: number
  width: number
  height: number
}

type AnchorPoint = {
  x: number
  y: number
  height: number
}

type VisualLayout = {
  highlights: RectBox[]
  startAnchor: AnchorPoint
  endAnchor: AnchorPoint
  toolbarTop: number
  toolbarLeft: number
}

const BLOCK_SELECTOR =
  'p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, th, [data-latex-display="true"]'
const INLINE_SELECTOR =
  'p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, th, span, a, code, em, strong, del'
const IGNORED_SELECTOR =
  '[aria-hidden="true"], button, [role="toolbar"], .katex-mathml, .ds-markdown-cite'
const HANDLE_SIZE = 22
const TOOLBAR_MARGIN = 12
const TOOLBAR_SAFE_BOTTOM = 84

const collectSegments = (
  root: HTMLElement
): { segments: SelectionSegment[]; totalLength: number } => {
  const segments: SelectionSegment[] = []
  let totalLength = 0

  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.hasAttribute('data-latex')) {
        const latex = (el.getAttribute('data-latex') ?? '').trim()
        if (latex.length > 0) {
          segments.push({
            kind: 'atomic',
            element: el,
            text: latex,
            display: el.getAttribute('data-latex-display') === 'true',
            start: totalLength,
            end: totalLength + 1,
          })
          totalLength += 1
        }
        return
      }
      if (el !== root && el.matches(IGNORED_SELECTOR)) {
        return
      }
      for (let child = el.firstChild; child; child = child.nextSibling) {
        walk(child)
      }
      return
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text
      const parent = textNode.parentElement
      const value = textNode.nodeValue ?? ''
      if (
        parent &&
        value.length > 0 &&
        !parent.closest(IGNORED_SELECTOR) &&
        (/\S/.test(value) || parent.closest(INLINE_SELECTOR))
      ) {
        const start = totalLength
        const end = start + value.length
        segments.push({ kind: 'text', node: textNode, start, end })
        totalLength = end
      }
    }
  }

  walk(root)
  return { segments, totalLength }
}

const getDisplayMathRect = (el: HTMLElement): DOMRect | null => {
  const clipRect = el.getBoundingClientRect()
  const katexHtml = el.querySelector('.katex-html')
  let minLeft = Number.POSITIVE_INFINITY
  let minTop = Number.POSITIVE_INFINITY
  let maxRight = Number.NEGATIVE_INFINITY
  let maxBottom = Number.NEGATIVE_INFINITY

  if (katexHtml) {
    for (const child of Array.from(katexHtml.children)) {
      const rect = child.getBoundingClientRect()
      if (rect.width > 0.5 && rect.height > 0.5) {
        minLeft = Math.min(minLeft, rect.left)
        minTop = Math.min(minTop, rect.top)
        maxRight = Math.max(maxRight, rect.right)
        maxBottom = Math.max(maxBottom, rect.bottom)
      }
    }
  }

  if (!Number.isFinite(minLeft)) {
    const fallback = (el.querySelector('.katex') ?? el).getBoundingClientRect()
    minLeft = fallback.left
    minTop = fallback.top
    maxRight = fallback.right
    maxBottom = fallback.bottom
  }

  const left = Math.max(minLeft, clipRect.left)
  const right = Math.min(maxRight, clipRect.right)
  const top = Math.max(minTop, clipRect.top)
  const bottom = Math.min(maxBottom, clipRect.bottom)
  const width = right - left
  const height = bottom - top
  return width > 0.5 && height > 0.5 ? new DOMRect(left, top, width, height) : null
}

const getSubRangeRects = (
  seg: SelectionSegment,
  rangeStart: number,
  rangeEnd: number
): DOMRect[] => {
  if (rangeEnd <= seg.start || rangeStart >= seg.end) {
    return []
  }
  if (seg.kind === 'atomic') {
    if (seg.display) {
      const rect = getDisplayMathRect(seg.element)
      return rect ? [rect] : []
    }
    const rect = seg.element.getBoundingClientRect()
    return rect.width > 0.5 && rect.height > 0.5 ? [rect] : []
  }
  const localStart = Math.max(0, rangeStart - seg.start)
  const localEnd = Math.min(seg.end - seg.start, rangeEnd - seg.start)
  if (localEnd <= localStart) {
    return []
  }
  const range = document.createRange()
  range.setStart(seg.node, localStart)
  range.setEnd(seg.node, localEnd)
  return [...range.getClientRects()].filter((rect) => rect.width > 0.5 && rect.height > 0.5)
}

/* ---- 02 读取与解析（getAllSelectedClientRects、findBlockScope、getSegmentElement…） ---- */
const getAllSelectedClientRects = (
  segments: SelectionSegment[],
  start: number,
  end: number
): DOMRect[] => {
  const rects: DOMRect[] = []
  for (const seg of segments) {
    if (seg.end <= start) {
      continue
    }
    if (seg.start >= end) {
      break
    }
    rects.push(...getSubRangeRects(seg, start, end))
  }
  return rects
}

const findBlockScope = (element: Element | null, root: HTMLElement): Element | null => {
  let cursor: Element | null = element
  while (cursor && cursor !== root && root.contains(cursor)) {
    if (cursor.matches(BLOCK_SELECTOR)) {
      return cursor
    }
    cursor = cursor.parentElement
  }
  return null
}

const getSegmentElement = (seg: SelectionSegment): Element | null =>
  seg.kind === 'text' ? seg.node.parentElement : seg.element

const segmentBelongsToBlock = (
  seg: SelectionSegment,
  block: Element,
  isListItem: boolean
): boolean => {
  if (isListItem) {
    return getSegmentElement(seg)?.closest('li') === block
  }
  return seg.kind === 'text'
    ? block.contains(seg.node)
    : block === seg.element || block.contains(seg.element)
}

const findInitialBlockOffsets = (
  segments: SelectionSegment[],
  totalLength: number,
  contentEl: HTMLElement,
  point?: { x: number; y: number }
): OffsetRange => {
  if (totalLength === 0) {
    return { start: 0, end: 0 }
  }
  if (!point) {
    return { start: 0, end: totalLength }
  }
  const hitEl = document.elementFromPoint(point.x, point.y)
  let block = hitEl && contentEl.contains(hitEl) ? findBlockScope(hitEl, contentEl) : null

  if (!block) {
    let bestDistance = Number.POSITIVE_INFINITY
    let bestSegment: SelectionSegment | null = null
    for (const seg of segments) {
      for (const rect of getSubRangeRects(seg, seg.start, seg.end)) {
        const dx =
          point.x < rect.left
            ? rect.left - point.x
            : point.x > rect.right
              ? point.x - rect.right
              : 0
        const dy =
          point.y < rect.top
            ? rect.top - point.y
            : point.y > rect.bottom
              ? point.y - rect.bottom
              : 0
        const dist = dx * dx + dy * dy
        if (dist < bestDistance) {
          bestDistance = dist
          bestSegment = seg
        }
      }
    }
    if (bestSegment) {
      block = findBlockScope(getSegmentElement(bestSegment), contentEl)
    }
  }

  if (!block) {
    return { start: 0, end: totalLength }
  }

  const isListItem = block.tagName === 'LI'
  let start = -1
  let end = -1
  for (const seg of segments) {
    if (segmentBelongsToBlock(seg, block, isListItem)) {
      if (start === -1) {
        start = seg.start
      }
      end = seg.end
    }
  }
  return start >= 0 && end > start ? { start, end } : { start: 0, end: totalLength }
}

const caretOffsetInSegments = (
  segments: SelectionSegment[],
  node: Node | null,
  offset: number
): number | null => {
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    return null
  }
  for (const seg of segments) {
    if (seg.kind === 'text' && seg.node === node) {
      return seg.start + Math.max(0, Math.min(seg.end - seg.start, offset))
    }
  }
  return null
}

/* ---- 03 读取与解析（resolveOffsetGeometric、resolveOffsetAtPoint、countTrailingNewlines…） ---- */
const resolveOffsetGeometric = (
  segments: SelectionSegment[],
  totalLength: number,
  clientX: number,
  clientY: number
): number => {
  if (segments.length === 0) {
    return 0
  }
  type SegRect = { seg: SelectionSegment; rect: DOMRect; centerY: number }
  const boxes: SegRect[] = []
  for (const seg of segments) {
    for (const rect of getSubRangeRects(seg, seg.start, seg.end)) {
      boxes.push({ seg, rect, centerY: (rect.top + rect.bottom) / 2 })
    }
  }
  if (boxes.length === 0) {
    return 0
  }

  let firstTop = boxes[0].rect.top
  let lastBottom = boxes[0].rect.bottom
  let lineHeight = boxes[0].rect.height
  for (const box of boxes) {
    if (box.rect.top < firstTop) {
      firstTop = box.rect.top
    }
    if (box.rect.bottom > lastBottom) {
      lastBottom = box.rect.bottom
    }
    if (box.rect.height > lineHeight) {
      lineHeight = box.rect.height
    }
  }
  if (clientY < firstTop - lineHeight) {
    return 0
  }
  if (clientY > lastBottom + lineHeight) {
    return totalLength
  }

  // Find vertically closest line band.
  let minDy = Number.POSITIVE_INFINITY
  let bestCenterY = boxes[0].centerY
  for (const box of boxes) {
    const dy =
      clientY < box.rect.top
        ? box.rect.top - clientY
        : clientY > box.rect.bottom
          ? clientY - box.rect.bottom
          : 0
    if (
      dy < minDy ||
      (dy === minDy && Math.abs(clientY - box.centerY) < Math.abs(clientY - bestCenterY))
    ) {
      minDy = dy
      bestCenterY = box.centerY
    }
  }

  const band = boxes.filter(
    (box) => Math.abs(box.centerY - bestCenterY) <= Math.max(10, box.rect.height * 0.65)
  )
  const candidates = band.length > 0 ? band : [boxes[0]]
  candidates.sort((a, b) => a.rect.left - b.rect.left)

  let chosen = candidates[0]
  if (clientX <= candidates[0].rect.left) {
    chosen = candidates[0]
  } else if (clientX >= candidates[candidates.length - 1].rect.right) {
    chosen = candidates[candidates.length - 1]
  } else {
    let bestDx = Number.POSITIVE_INFINITY
    for (const item of candidates) {
      const dx =
        clientX < item.rect.left
          ? item.rect.left - clientX
          : clientX > item.rect.right
            ? clientX - item.rect.right
            : 0
      if (dx < bestDx) {
        bestDx = dx
        chosen = item
      }
    }
  }

  if (chosen.seg.kind === 'atomic') {
    const midX = (chosen.rect.left + chosen.rect.right) / 2
    return clientX >= midX ? chosen.seg.end : chosen.seg.start
  }

  // Pick character offset inside chosen Text node via binary search.
  const len = chosen.seg.end - chosen.seg.start
  const probe = document.createRange()
  let lo = 0
  let hi = len
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    probe.setStart(chosen.seg.node, mid)
    probe.setEnd(chosen.seg.node, Math.min(len, mid + 1))
    const rects = [...probe.getClientRects()].filter((r) => r.height > 0.5)
    if (rects.length === 0) {
      lo = mid + 1
      continue
    }
    const targetRect =
      rects.find((r) => Math.abs((r.top + r.bottom) / 2 - bestCenterY) <= r.height * 0.7) ??
      rects[0]
    const midX = (targetRect.left + targetRect.right) / 2
    if (targetRect.bottom < bestCenterY - targetRect.height * 0.5) {
      lo = mid + 1
    } else if (targetRect.top > bestCenterY + targetRect.height * 0.5) {
      hi = mid
    } else if (clientX >= midX) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return chosen.seg.start + lo
}

const resolveOffsetAtPoint = (
  segments: SelectionSegment[],
  totalLength: number,
  clientX: number,
  clientY: number
): number => {
  const docWithCaret = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (typeof docWithCaret.caretPositionFromPoint === 'function') {
    const pos = docWithCaret.caretPositionFromPoint(clientX, clientY)
    const resolved = caretOffsetInSegments(segments, pos?.offsetNode ?? null, pos?.offset ?? 0)
    if (resolved !== null) {
      return resolved
    }
  } else if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(clientX, clientY)
    const resolved = caretOffsetInSegments(
      segments,
      range?.startContainer ?? null,
      range?.startOffset ?? 0
    )
    if (resolved !== null) {
      return resolved
    }
  }
  return resolveOffsetGeometric(segments, totalLength, clientX, clientY)
}

const countTrailingNewlines = (text: string, current: number): number => {
  let count = 0
  for (let i = text.length - 1; i >= 0 && text[i] === '\n'; i--) {
    count += 1
  }
  return count === text.length ? current + count : count
}

const extractTextForRange = (segments: SelectionSegment[], start: number, end: number): string => {
  const parts: string[] = []
  let prevBlock: Element | null = null
  let trailingNewlines = 0
  for (const seg of segments) {
    if (seg.end <= start) {
      continue
    }
    if (seg.start >= end) {
      break
    }
    let slice = ''
    let block: Element | null = null
    if (seg.kind === 'atomic') {
      slice = seg.text
      block = seg.display ? seg.element : (seg.element.closest(BLOCK_SELECTOR) ?? null)
    } else {
      const localStart = Math.max(0, start - seg.start)
      const localEnd = Math.min(seg.end - seg.start, end - seg.start)
      if (localEnd <= localStart) {
        continue
      }
      slice = (seg.node.nodeValue ?? '').slice(localStart, localEnd)
      block = seg.node.parentElement?.closest(BLOCK_SELECTOR) ?? null
    }
    if (prevBlock && block !== prevBlock && parts.length > 0) {
      const needed = prevBlock.tagName === 'LI' && block?.tagName === 'LI' ? 1 : 2
      if (trailingNewlines < needed) {
        const sep = '\n'.repeat(needed - trailingNewlines)
        parts.push(sep)
        trailingNewlines = needed
      }
    }
    parts.push(slice)
    trailingNewlines = countTrailingNewlines(slice, trailingNewlines)
    prevBlock = block
  }
  return parts.join('')
}

/* ---- 04 功能实现（AndroidTextSelection） ---- */
/**
 * 自由选词/字符级选择浮层：
 * 以真实文本节点 Range 几何为基准，提供可拖拽水滴手柄与浮动操作栏（复制 / 全选）。
 */
export const AndroidTextSelection = ({
  active,
  containerRef,
  contentRef,
  initialMode = 'block',
  initialPoint,
  fullCopyText,
  onExit,
}: {
  active: boolean
  containerRef: RefObject<HTMLElement | null>
  contentRef: RefObject<HTMLElement | null>
  initialMode?: 'block' | 'all'
  initialPoint?: { x: number; y: number }
  fullCopyText?: string
  onExit: () => void
}) => {
  const t = useTranslate()
  const [range, setRange] = useState<OffsetRange | null>(null)
  const [totalLength, setTotalLength] = useState(0)
  const [layout, setLayout] = useState<VisualLayout | null>(null)
  const [dragging, setDragging] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ anchor: number; verticalBias: number } | null>(null)
  const rangeRef = useRef<OffsetRange | null>(null)
  rangeRef.current = range

  useAndroidBackInterception(active)

  // Initialize range when entering selection mode.
  useLayoutEffect(() => {
    if (!active) {
      setRange(null)
      setLayout(null)
      setTotalLength(0)
      setDragging(false)
      dragRef.current = null
      return
    }
    const contentEl = contentRef.current
    if (!contentEl) {
      return
    }
    window.getSelection()?.removeAllRanges()
    const { segments, totalLength: total } = collectSegments(contentEl)
    setTotalLength(total)
    if (total === 0) {
      onExit()
      return
    }
    if (initialMode === 'all') {
      setRange({ start: 0, end: total })
    } else {
      setRange(findInitialBlockOffsets(segments, total, contentEl, initialPoint))
    }
  }, [active, contentRef, initialMode, initialPoint, onExit])

  const recomputeLayout = useCallback(() => {
    const containerEl = containerRef.current
    const contentEl = contentRef.current
    const current = rangeRef.current
    if (!active || !containerEl || !contentEl || !current) {
      setLayout(null)
      return
    }
    const { segments } = collectSegments(contentEl)
    const clientRects = getAllSelectedClientRects(segments, current.start, current.end)
    if (clientRects.length === 0) {
      setLayout(null)
      return
    }
    const rootRect = containerEl.getBoundingClientRect()
    const highlights: RectBox[] = clientRects.map((rect) => ({
      left: rect.left - rootRect.left,
      top: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height,
    }))
    const first = clientRects[0]
    const last = clientRects[clientRects.length - 1]

    const toolbarWidth =
      toolbarRef.current?.offsetWidth ||
      (current.start === 0 && current.end === totalLength ? 68 : 134)
    const toolbarHeight = toolbarRef.current?.offsetHeight || 54
    const safeTop = Math.max(
      TOOLBAR_MARGIN,
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--android-status-inset')
      ) + 58 || 82
    )
    const safeBottom = window.innerHeight - TOOLBAR_SAFE_BOTTOM

    let toolbarTop: number
    if (first.top - toolbarHeight - 10 >= safeTop) {
      toolbarTop = first.top - toolbarHeight - 10
    } else if (last.bottom + HANDLE_SIZE + 14 + toolbarHeight <= safeBottom) {
      toolbarTop = last.bottom + HANDLE_SIZE + 14
    } else {
      toolbarTop = Math.max(
        safeTop,
        Math.min(safeBottom - toolbarHeight, first.top - toolbarHeight - 10)
      )
    }

    const selectionCenterX =
      first.top === last.top ? (first.left + last.right) / 2 : (rootRect.left + rootRect.right) / 2
    const toolbarLeft = Math.max(
      TOOLBAR_MARGIN,
      Math.min(
        window.innerWidth - toolbarWidth - TOOLBAR_MARGIN,
        selectionCenterX - toolbarWidth / 2
      )
    )

    setLayout({
      highlights,
      startAnchor: {
        x: first.left - rootRect.left,
        y: first.bottom - rootRect.top,
        height: first.height,
      },
      endAnchor: {
        x: last.right - rootRect.left,
        y: last.bottom - rootRect.top,
        height: last.height,
      },
      toolbarTop,
      toolbarLeft,
    })
  }, [active, containerRef, contentRef, totalLength])

  useLayoutEffect(() => {
    recomputeLayout()
  }, [range, dragging, recomputeLayout])

  // Prevent Android edge-back gesture from hijacking handle drags near the screen edge.
  useEffect(() => {
    const containerEl = containerRef.current
    if (!active || !layout || !containerEl || !android?.setSelectionExclusion) {
      return
    }
    const rootRect = containerEl.getBoundingClientRect()
    const sx = rootRect.left + layout.startAnchor.x
    const sy = rootRect.top + layout.startAnchor.y
    const ex = rootRect.left + layout.endAnchor.x
    const ey = rootRect.top + layout.endAnchor.y
    android.setSelectionExclusion(
      sx - 44,
      sy - 12,
      sx + 16,
      sy + 52,
      ex - 16,
      ey - 12,
      ex + 44,
      ey + 52,
      true
    )
    return () => {
      android?.setSelectionExclusion?.(0, 0, 0, 0, 0, 0, 0, 0, false)
    }
  }, [active, containerRef, layout])

  // Keep layout synced with scroll / viewport changes, and handle outside tap & back/Escape.
  useEffect(() => {
    if (!active) {
      return
    }
    let raf = 0
    let scheduledAt = 0
    const scheduleUpdate = () => {
      // 滚动事件密集时最多每 120ms 重算一次选中矩形，避免每帧都做区间收集
      const now = performance.now()
      if (raf && now - scheduledAt < 120) {
        return
      }
      scheduledAt = now
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(recomputeLayout)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-selection-interactive="true"]')) {
        return
      }
      onExit()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onExit()
      }
    }
    const onAndroidBack = () => {
      onExit()
    }
    window.addEventListener('scroll', scheduleUpdate, true)
    window.addEventListener('resize', scheduleUpdate)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('android-back', onAndroidBack)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', scheduleUpdate, true)
      window.removeEventListener('resize', scheduleUpdate)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('android-back', onAndroidBack)
    }
  }, [active, onExit, recomputeLayout])

  // Track active handle drag across the whole window.
  useEffect(() => {
    if (!dragging) {
      return
    }
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      const contentEl = contentRef.current
      if (!drag || !contentEl) {
        return
      }
      const { segments, totalLength: total } = collectSegments(contentEl)
      if (total === 0) {
        return
      }
      const targetY = event.clientY - drag.verticalBias
      const next = resolveOffsetAtPoint(segments, total, event.clientX, targetY)
      if (next === drag.anchor) {
        const start = Math.max(0, drag.anchor - 1)
        const end = start === drag.anchor ? Math.min(total, drag.anchor + 1) : drag.anchor
        setRange({ start, end })
      } else {
        setRange({ start: Math.min(drag.anchor, next), end: Math.max(drag.anchor, next) })
      }
    }
    const onUp = () => {
      dragRef.current = null
      setDragging(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [contentRef, dragging])

  if (!active || !layout || !range) {
    return null
  }

  const allSelected = range.start === 0 && range.end === totalLength

  const beginDrag = (kind: 'start' | 'end') => (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic pointer events may not have an active OS pointer id.
    }
    const anchorPoint = kind === 'start' ? layout.startAnchor : layout.endAnchor
    const containerRect = containerRef.current?.getBoundingClientRect()
    const lineCenterY = containerRect
      ? containerRect.top + anchorPoint.y - anchorPoint.height / 2
      : event.clientY
    dragRef.current = {
      anchor: kind === 'start' ? range.end : range.start,
      verticalBias: Math.max(0, Math.min(anchorPoint.height * 0.9, event.clientY - lineCenterY)),
    }
    setDragging(true)
  }

  const handleCopy = () => {
    const contentEl = contentRef.current
    if (!contentEl) {
      onExit()
      return
    }
    const { segments } = collectSegments(contentEl)
    const selected =
      range.start === 0 && range.end === totalLength && fullCopyText
        ? fullCopyText
        : extractTextForRange(segments, range.start, range.end)
    if (selected) {
      void copyText(selected).then((copied) =>
        showToast({ key: copied ? 'copied' : 'copyFailed' }, copied ? 1990 : undefined)
      )
    }
    onExit()
  }

  const handleSelectAll = () => {
    const contentEl = contentRef.current
    if (!contentEl) {
      return
    }
    const { totalLength: total } = collectSegments(contentEl)
    setTotalLength(total)
    setRange({ start: 0, end: total })
  }

  return (
    <>
      <div className={styles.highlightLayer} aria-hidden="true">
        {layout.highlights.map((box, index) => (
          <span
            key={index}
            className={styles.highlight}
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
            }}
          />
        ))}
      </div>
      <button
        type="button"
        className={clsx(styles.handle, styles.handleStart)}
        data-selection-interactive="true"
        data-drawer-gesture-ignore=""
        aria-label={t('androidSelectText')}
        style={{
          left: layout.startAnchor.x,
          top: layout.startAnchor.y,
        }}
        onPointerDown={beginDrag('start')}
        onClick={(event) => event.stopPropagation()}
      >
        <span className={styles.teardrop} />
      </button>
      <button
        type="button"
        className={clsx(styles.handle, styles.handleEnd)}
        data-selection-interactive="true"
        data-drawer-gesture-ignore=""
        aria-label={t('androidSelectText')}
        style={{
          left: layout.endAnchor.x,
          top: layout.endAnchor.y,
        }}
        onPointerDown={beginDrag('end')}
        onClick={(event) => event.stopPropagation()}
      >
        <span className={styles.teardrop} />
      </button>
      {!dragging
        ? createPortal(
            <div
              ref={toolbarRef}
              className={styles.toolbar}
              data-selection-interactive="true"
              data-drawer-gesture-ignore=""
              role="toolbar"
              style={{
                top: layout.toolbarTop,
                left: layout.toolbarLeft,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <button type="button" onClick={handleCopy}>
                <IconCopyOutline16 />
                <span>{t('copy')}</span>
              </button>
              {!allSelected ? (
                <button type="button" onClick={handleSelectAll}>
                  <IconSelectAllOutline16 />
                  <span>{t('selectAll')}</span>
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

/* ============================================================================
 * 功能区：消息渲染 / AndroidTextSelection 结束
 * ========================================================================== */
