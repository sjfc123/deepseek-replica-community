/* ============================================================================
 * 功能区：视图与交互 / ImageWithPlaceholder · 图片加载三态
 * 职责：承载图片的加载中、加载成功与加载失败三种状态；失败时显示调用方给定的占位内容，尺寸、圆角与配色全部由调用方类名决定。
 * 分区：01 类型、契约与加载三态
 * 关联：被 components/search/SiteLogo 引用；不依赖业务服务与全局状态。
 * 导出：ImageWithPlaceholder
 * 边界：只维护 img 的加载状态与占位层切换；不请求图片、不缓存图片、不决定失败后的业务动作。
 * ========================================================================== */

import { CSSProperties, ReactNode, memo, useState } from 'react'

/* ---- 01 类型、契约与加载三态 ---- */
/**
 * 图片加载容器：
 * - 初始为 loading，显示骨架层；
 * - onLoad 后只显示 img；
 * - src 为空或 onError 后隐藏 img，显示 placeholder。
 * 组件不推断失败原因，错误展示与重试入口由调用方决定。
 */
export const ImageWithPlaceholder = memo(function ImageWithPlaceholder({
  src,
  placeholder,
  className,
  imgClassName,
  skeletonClassName,
  placeholderClassName,
  style,
}: {
  src: string
  /** src 为空或图片加载失败时展示的占位内容 */
  placeholder: ReactNode
  /** 容器类名，尺寸、圆角与背景由调用方定义 */
  className: string
  imgClassName: string
  /** loading 骨架占位层类名 */
  skeletonClassName: string
  /** 占位内容包裹层类名 */
  placeholderClassName: string
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
      {loadResult === 'error' ? (
        <span className={placeholderClassName}>{placeholder}</span>
      ) : null}
      {loadResult === 'loading' ? <span className={skeletonClassName} /> : null}
    </span>
  )
})
