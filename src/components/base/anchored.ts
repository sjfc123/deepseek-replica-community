/* ============================================================================
 * 功能区：视图与交互 / anchored · 锚点定位 Hook
 * 职责：锚点定位 Hook：测量触发元素并计算弹层方向与偏移。
 * 分区：01 类型、常量与模块依赖；02 状态与视图（useAnchoredPosition）；
 *    03 状态与视图（useDismiss、useDelayedOpen）；04 状态与视图（useDelayedOpen）
 * 关联：无内部依赖；
 *    被 components/base/Menu、components/base/Select、components/base/Tooltip、components/search/HoverCard 引用。
 * 导出：VIEWPORT_PADDING、Side、Align、AnchoredPosition、AnchoredOptions、useAnchoredPosition、useDismiss、useDelayedOpen
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react'

/* ---- 01 类型、常量与模块依赖 ---- */
/** 浮层与视口边缘的最小间距 */
export const VIEWPORT_PADDING = 8

export type Side = 'top' | 'bottom'
export type Align = 'start' | 'center' | 'end'

export type AnchoredPosition = {
  top: number
  left?: number
  right?: number
  maxHeight?: number
}

export type AnchoredOptions = {
  /** 长按触点；给出时以该点为锚点，忽略触发元素自身盒 */
  point?: { x: number; y: number } | null
  /** 优先出现的一侧，放不下时翻到另一侧 */
  side?: Side
  /** 相对触发元素的水平对齐方式 */
  align?: Align
  /** 水平方向的额外偏移，在按视口边缘收口之前叠加 */
  alignOffset?: number
  /** 与触发元素之间的间距 */
  offset?: number
  /**
   * 浮层纵向可用高度的上限。给出时按视口剩余空间收缩并允许滚动，
   * 未给出时按浮层自身高度整体摆放。
   */
  maxHeight?: number
  /** 判定「空间不足、需要翻面」的最小纵向空间 */
  minSpace?: number
  /**
   * 用触发元素的第一个子元素作为测量与对齐基准。触发元素自身不产生盒子时
   * （如 display: contents），它的 getBoundingClientRect 是空矩形。
   */
  measureFirstChild?: boolean
  /**
   * 浮层内容标识，变化时在绘制前同步重新测量。若交由 ResizeObserver 处理，
   * 会先按旧位置绘制一帧再回弹，因此需要该同步入口。
   */
  measureKey?: unknown
}

const clampLeft = (left: number, width: number) =>
  Math.max(VIEWPORT_PADDING, Math.min(left, window.innerWidth - width - VIEWPORT_PADDING))

const alignLeft = (anchor: DOMRect, width: number, align: Align, alignOffset: number) => {
  if (align === 'center') {
    return clampLeft(anchor.left + anchor.width / 2 - width / 2 + alignOffset, width)
  }
  if (align === 'end') {
    return clampLeft(anchor.right - width + alignOffset, width)
  }
  return clampLeft(anchor.left + alignOffset, width)
}

/** 只有一侧放得下时用那一侧；两侧都放得下用优先侧；都放不下时退到空间更大的一侧 */
const resolveSide = (spaceAbove: number, spaceBelow: number, preferred: Side, needed: number) => {
  const fitsAbove = spaceAbove >= needed
  const fitsBelow = spaceBelow >= needed
  if (fitsAbove && !fitsBelow) {
    return 'top'
  }
  if (fitsBelow && !fitsAbove) {
    return 'bottom'
  }
  if (fitsAbove) {
    return preferred
  }
  return spaceAbove > spaceBelow ? 'top' : 'bottom'
}

/* ---- 02 状态与视图（useAnchoredPosition） ---- */
/**
 * 相对触发元素给浮层定位。浮层挂在 body 上并用 position: fixed 按视口坐标摆放，
 * 因此需要在挂载后测量自身尺寸：未测量到之前位置为 null。
 */
export const useAnchoredPosition = <T extends HTMLElement, F extends HTMLElement>(
  open: boolean,
  {
    point,
    side = 'bottom',
    align = 'start',
    alignOffset = 0,
    offset = 4,
    maxHeight,
    minSpace = 160,
    measureFirstChild = false,
    measureKey,
  }: AnchoredOptions = {}
) => {
  const anchorRef = useRef<T | null>(null) as MutableRefObject<T | null>
  const floatingRef = useRef<F | null>(null) as MutableRefObject<F | null>
  const [position, setPosition] = useState<AnchoredPosition | null>(null)

  /** 位置没有实际变化时不更新状态，避免重新测量引起多余渲染 */
  const applyPosition = useCallback((next: AnchoredPosition) => {
    setPosition((previous) =>
      previous &&
      previous.top === next.top &&
      previous.left === next.left &&
      previous.right === next.right &&
      previous.maxHeight === next.maxHeight
        ? previous
        : next
    )
  }, [])

  /** 触发元素自身不产生盒子时（如 display: contents），用它第一个子元素测量 */
  const getAnchor = useCallback(
    () =>
      measureFirstChild
        ? (anchorRef.current?.firstElementChild as HTMLElement | null)
        : anchorRef.current,
    [anchorRef, measureFirstChild]
  )

  /** 触点按零尺寸矩形处理，后续的翻面、左右收口与普通触发元素一致 */
  const getAnchorRect = useCallback(() => {
    if (point) {
      return {
        left: point.x,
        right: point.x,
        top: point.y,
        bottom: point.y,
        width: 0,
        height: 0,
      } as DOMRect
    }
    return getAnchor()?.getBoundingClientRect() ?? null
  }, [getAnchor, point])

  // 测量只在浮层打开且已挂载后进行，ref 对象稳定，回调不随渲染重建
  const update = useCallback(() => {
    const floating = floatingRef.current
    const rect = getAnchorRect()
    if (!rect || !floating) {
      return
    }
    const buttonNavigationInset =
      Number.parseFloat(
        document.documentElement.style.getPropertyValue('--android-button-nav-inset')
      ) || 0
    const spaceAbove = rect.top - offset - VIEWPORT_PADDING
    const spaceBelow =
      window.innerHeight - buttonNavigationInset - rect.bottom - offset - VIEWPORT_PADDING

    if (maxHeight === undefined) {
      const { width, height } = floating.getBoundingClientRect()
      const resolved = resolveSide(spaceAbove, spaceBelow, side, height)
      const desiredTop = resolved === 'top' ? rect.top - offset - height : rect.bottom + offset
      const maxTop = window.innerHeight - buttonNavigationInset - VIEWPORT_PADDING - height
      applyPosition({
        top: Math.max(VIEWPORT_PADDING, Math.min(desiredTop, maxTop)),
        left: alignLeft(rect, width, align, alignOffset),
      })
      return
    }

    const resolved = resolveSide(spaceAbove, spaceBelow, side, minSpace)
    const available = Math.max(0, resolved === 'top' ? spaceAbove : spaceBelow)
    // 内容比可用空间小时按内容收口，避免浮层留出多余空白
    const height = Math.max(40, Math.min(maxHeight, available, floating.scrollHeight + 2))
    const desiredTop = resolved === 'top' ? rect.top - offset - height : rect.bottom + offset
    const maxTop = window.innerHeight - buttonNavigationInset - VIEWPORT_PADDING - height
    applyPosition({
      top: Math.max(VIEWPORT_PADDING, Math.min(desiredTop, maxTop)),
      left: alignLeft(rect, floating.getBoundingClientRect().width, align, alignOffset),
      maxHeight: height,
    })
  }, [
    align,
    alignOffset,
    applyPosition,
    floatingRef,
    getAnchorRect,
    maxHeight,
    minSpace,
    offset,
    side,
  ])

  // 打开时与内容变化时同步测量，必须在绘制前完成
  useLayoutEffect(() => {
    if (open) {
      update()
    }
  }, [measureKey, open, update])

  /*
   * 打开期间跟踪渲染时无法预知的位置来源：浮层或触发元素尺寸变化、窗口尺寸变化、
   * 任意滚动容器滚动。对应 @floating-ui 的 autoUpdate，避免浮层停在旧位置。
   */
  useLayoutEffect(() => {
    if (!open) {
      return
    }
    const floating = floatingRef.current
    if (!floating) {
      return
    }
    const anchor = getAnchor()
    const observer = new ResizeObserver(() => update())
    observer.observe(floating)
    if (anchor && !point) {
      observer.observe(anchor)
    }
    window.addEventListener('scroll', update, { capture: true, passive: true })
    window.addEventListener('resize', update, { passive: true })
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', update, { capture: true })
      window.removeEventListener('resize', update)
    }
  }, [floatingRef, getAnchor, open, point, update])

  useEffect(() => {
    if (!open) {
      setPosition(null)
    }
  }, [open])

  return { anchorRef, floatingRef, position }
}

/* ---- 03 状态与视图（useDismiss、useDelayedOpen） ---- */
/** 点击浮层与触发元素之外、或按 Esc 时关闭 */
export const useDismiss = (
  open: boolean,
  refs: RefObject<HTMLElement | null>[],
  onDismiss: () => void,
  { captureEscape = false }: { captureEscape?: boolean } = {}
) => {
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss
  const refsRef = useRef(refs)
  refsRef.current = refs

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      const inside = refsRef.current.some((ref) => ref.current?.contains(target))
      if (!inside) {
        onDismissRef.current()
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      if (captureEscape) {
        event.stopPropagation()
      }
      onDismissRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, captureEscape)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, captureEscape)
    }
  }, [open, captureEscape])
}

/* ---- 04 状态与视图（useDelayedOpen） ---- */
/** 悬停类浮层的进出延迟：同一时间只有一个待执行的切换 */
export const useDelayedOpen = () => {
  const [open, setOpen] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const schedule = useCallback((next: boolean, delay: number) => {
    window.clearTimeout(timer.current)
    if (delay <= 0) {
      setOpen(next)
      return
    }
    timer.current = window.setTimeout(() => setOpen(next), delay)
  }, [])
  const cancel = useCallback(() => window.clearTimeout(timer.current), [])
  return { open, setOpen, schedule, cancel }
}

/* ============================================================================
 * 功能区：基础 UI / anchored 结束
 * ========================================================================== */
