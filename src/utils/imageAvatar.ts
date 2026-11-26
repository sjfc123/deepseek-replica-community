/* ============================================================================
 * 功能区：公共工具 / imageAvatar · 头像处理
 * 职责：头像处理：图片读取、居中裁切、缩放与压缩。
 * 分区：01 类型、契约与依赖
 * 关联：无内部依赖；
 *    被 components/settings/AndroidSettings、components/settings/ProfileEditor 引用。
 * 导出：prepareAvatar
 * 边界：只提供纯函数与浏览器能力封装；不读取应用状态，不产生网络请求。
 * ========================================================================== */

/* ---- 01 类型、契约与依赖 ---- */
/** 将用户选中的图片裁为正方形并存储为 data URL，控制体积以避免超出 localStorage 配额 */
const MAX_AVATAR_EDGE = 256

export const prepareAvatar = async (file: File) => {
  const url = URL.createObjectURL(file)
  const image = new Image()
  try {
    image.src = url
    await image.decode()
    const { naturalWidth: width, naturalHeight: height } = image
    const crop = Math.min(width, height)
    const edge = Math.min(crop, MAX_AVATAR_EDGE)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = edge
    const context = canvas.getContext('2d')
    if (!context || edge === 0) {
      throw new Error('Unable to resize avatar')
    }
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, (width - crop) / 2, (height - crop) / 2, crop, crop, 0, 0, edge, edge)
    const avatar = canvas.toDataURL('image/webp', 0.85)
    if (avatar === 'data:,') {
      throw new Error('Unable to encode avatar')
    }
    return avatar
  } finally {
    URL.revokeObjectURL(url)
  }
}

/* ============================================================================
 * 功能区：通用工具 / imageAvatar 结束
 * ========================================================================== */
