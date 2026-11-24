/* ============================================================================
 * 功能区：搜索与引用 / FallbackImage 开始
 * 职责：FallbackImage 组件，负责该组件的渲染、状态与交互出口。
 * 导出：FallbackImage。
 * ========================================================================== */

import { CSSProperties, ReactNode, memo, useState } from 'react'

/**
 * 带加载兜底的图片：loading 骨架占位 → 成功显示 → 失败展示 fallback 内容。
 * 只提供三态行为，视觉全部由调用方类名决定。
 */
export const FallbackImage = memo(function FallbackImage({
  src,
  fallback,
  className,
  imgClassName,
  skeletonClassName,
  fallbackClassName,
  style,
}: {
  src: string
  /** 加载失败或 src 为空时展示的替代内容 */
  fallback: ReactNode
  /** 容器类名，尺寸 / 圆角 / 背景由调用方定义 */
  className: string
  imgClassName: string
  /** loading 骨架占位层类名 */
  skeletonClassName: string
  /** 替代内容包裹层类名 */
  fallbackClassName: string
  style: CSSProperties | undefined
}) {
  const [loadResult, setLoadResult] = useState<'loading' | 'error' | 'loaded'>(
    src ? 'loading' : 'error'
  )

  return (
    <span className={className} style={style}>
      {loadResult !== 'error' ? (
        <img
          src={src}
          alt=""
          onLoad={() => setLoadResult('loaded')}
          onError={() => setLoadResult('error')}
          style={{ display: loadResult === 'loaded' ? 'block' : 'none' }}
          className={imgClassName}
        />
      ) : null}
      {loadResult === 'error' ? <span className={fallbackClassName}>{fallback}</span> : null}
      {loadResult === 'loading' ? <span className={skeletonClassName} /> : null}
    </span>
  )
})

/* ============================================================================
 * 功能区：搜索与引用 / FallbackImage 结束
 * ========================================================================== */
