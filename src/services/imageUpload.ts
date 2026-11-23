import { readBlobBuffer } from '../utils/blob.js'

/** 公开 API 的单边上限。对话请求包含至少 15 张图片时使用较小的上限。 */
export const MAX_IMAGE_EDGE = 8192
export const MANY_IMAGES_MAX_EDGE = 4096
export const MANY_IMAGES_COUNT = 15

/** 官方 Android App 在 RGBA 位图超过 30 MiB 时将宽高各减半一次。 */
export const APP_DOWNSAMPLE_PIXELS = (30 * 1024 * 1024) / 4

export type UploadedImage = { maxEdge: number; converted: boolean }

type PreparedImage = { file: File; image?: UploadedImage }

const isJpegOrPng = async (file: File) => {
  const bytes = new Uint8Array(await readBlobBuffer(file.slice(0, 8)))
  return (
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (bytes.length === 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte))
  )
}

export const prepareImageUpload = async (
  file: File,
  signal: AbortSignal,
  maxEdge = MAX_IMAGE_EDGE,
  forceConversion = false
): Promise<PreparedImage> => {
  const url = URL.createObjectURL(file)
  const image = new Image()
  try {
    image.src = url
    // 浏览器与服务端支持的解码格式不同，浏览器无法解码的原件仍可交给服务端处理。
    if (
      !(await image.decode().then(
        () => true,
        () => false
      ))
    ) {
      return { file }
    }
    const { naturalWidth, naturalHeight } = image
    const standardFormat = await isJpegOrPng(file)
    signal.throwIfAborted()
    const original = {
      file,
      image: { maxEdge: Math.max(naturalWidth, naturalHeight), converted: false },
    }
    const sample = standardFormat && naturalWidth * naturalHeight > APP_DOWNSAMPLE_PIXELS ? 2 : 1
    const width = Math.max(1, Math.floor(naturalWidth / sample))
    const height = Math.max(1, Math.floor(naturalHeight / sample))
    const scale = Math.min(1, maxEdge / Math.max(width, height))
    if (!standardFormat && scale === 1 && !forceConversion) {
      return original
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    try {
      const context = canvas.getContext('2d')
      if (!context) {
        return original
      }
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.9)
      )
      signal.throwIfAborted()
      if (!blob) {
        return original
      }
      const extension = blob.type === 'image/webp' ? 'webp' : 'png'
      const name = `${file.name.replace(/\.[^.]+$/, '')}.${extension}`
      return {
        file: new File([blob], name, { type: blob.type }),
        image: { maxEdge: Math.max(canvas.width, canvas.height), converted: true },
      }
    } finally {
      canvas.width = canvas.height = 0
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
