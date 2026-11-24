/* ============================================================================
 * 功能区：附件与文件预览 / imageCrop 开始
 * 职责：图片裁剪：读取图像、计算裁剪区域并导出 Blob。
 * 导出：Size、Point、Rect、Crop、Handle、MAX_CROP_ZOOM 等 16 个导出。
 * ========================================================================== */

import { APP_DOWNSAMPLE_PIXELS, MAX_IMAGE_EDGE } from '../../services/imageUpload.js'
import { readBlobBuffer } from '../../utils/blob.js'

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }
export type Rect = Point & Size
export type Crop = { turns: number; rect: Rect }
export type Handle = { x: number; y: number }

export const MAX_CROP_ZOOM = 9.4

export const fullImage = (size: Size): Crop => ({ turns: 0, rect: { x: 0, y: 0, ...size } })

export const rotatedSize = ({ width, height }: Size, turns: number): Size =>
  turns % 2 ? { width: height, height: width } : { width, height }

export const rotateCrop = ({ turns, rect }: Crop, size: Size): Crop => ({
  turns: (turns + 1) % 4,
  rect: {
    x: rect.y,
    y: rotatedSize(size, turns).width - rect.x - rect.width,
    width: rect.height,
    height: rect.width,
  },
})

export const isFullImage = ({ turns, rect }: Crop, size: Size) =>
  turns === 0 &&
  rect.x === 0 &&
  rect.y === 0 &&
  rect.width === size.width &&
  rect.height === size.height

export const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value))

export const fitCrop = (rect: Rect, stage: Size, maxScale = Infinity) => {
  const scale = Math.min(stage.width / rect.width, stage.height / rect.height, maxScale)
  return {
    scale,
    x: (stage.width - rect.width * scale) / 2 - rect.x * scale,
    y: (stage.height - rect.height * scale) / 2 - rect.y * scale,
  }
}

const moveCrop = (rect: Rect, bounds: Size, x: number, y: number): Rect => ({
  ...rect,
  x: clamp(x, 0, Math.max(0, bounds.width - rect.width)),
  y: clamp(y, 0, Math.max(0, bounds.height - rect.height)),
})

export const resizeCrop = (
  rect: Rect,
  image: Size,
  visible: Rect,
  handle: Handle,
  delta: Point,
  minimum: number
): Rect => {
  if (!handle.x && !handle.y) {
    return moveCrop(rect, image, rect.x - delta.x, rect.y - delta.y)
  }
  const resize = (
    start: number,
    end: number,
    low: number,
    high: number,
    direction: number,
    change: number
  ) => {
    const minLength = Math.min(minimum, end - start)
    if (direction < 0) {
      return [clamp(start + change, low, end - minLength), end] as const
    }
    if (direction > 0) {
      return [start, clamp(end + change, start + minLength, high)] as const
    }
    return [start, end] as const
  }
  const [left, right] = resize(
    rect.x,
    rect.x + rect.width,
    Math.min(rect.x, Math.max(0, visible.x)),
    Math.max(rect.x + rect.width, Math.min(image.width, visible.x + visible.width)),
    handle.x,
    delta.x
  )
  const [top, bottom] = resize(
    rect.y,
    rect.y + rect.height,
    Math.min(rect.y, Math.max(0, visible.y)),
    Math.max(rect.y + rect.height, Math.min(image.height, visible.y + visible.height)),
    handle.y,
    delta.y
  )
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export const zoomCrop = (
  rect: Rect,
  image: Size,
  anchor: Point,
  center: Point,
  ratio: number,
  minimumRatio: number
) => {
  const scale = clamp(
    ratio,
    Math.min(1, minimumRatio),
    Math.min(image.width / rect.width, image.height / rect.height)
  )
  const size = { width: rect.width * scale, height: rect.height * scale }
  return moveCrop(
    { x: 0, y: 0, ...size },
    image,
    anchor.x - center.x * scale,
    anchor.y - center.y * scale
  )
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))

export const freezeAnimatedImage = async (file: Blob) => {
  const header = new Uint8Array(await readBlobBuffer(file.slice(0, 24)))
  const label = (offset: number, length: number) =>
    String.fromCharCode(...header.subarray(offset, offset + length))
  const animated =
    label(0, 3) === 'GIF' ||
    (label(12, 4) === 'VP8X' && label(8, 4) === 'WEBP' && (header[20] & 2) !== 0)
  const png = label(1, 3) === 'PNG' && (await isAnimatedPng(file))
  if (!animated && !png) {
    return null
  }
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  try {
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Image canvas unavailable')
    }
    context.drawImage(bitmap, 0, 0)
    return await toBlob(canvas, 'image/png')
  } finally {
    bitmap.close()
    canvas.width = canvas.height = 0
  }
}

const isAnimatedPng = async (file: Blob) => {
  for (let offset = 8; offset + 8 <= file.size; ) {
    const chunk = new DataView(await readBlobBuffer(file.slice(offset, offset + 8)))
    const kind = chunk.getUint32(4)
    if (kind === 0x6163544c) {
      // acTL
      return true
    }
    if (kind === 0x49444154 || kind === 0x49454e44) {
      // IDAT or IEND
      return false
    }
    offset += chunk.getUint32(0) + 12
  }
  return false
}

export const exportCrop = async (image: HTMLImageElement, name: string, { turns, rect }: Crop) => {
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const canvas = document.createElement('canvas')
  const sample = width * height > APP_DOWNSAMPLE_PIXELS ? 0.5 : 1
  const scale = Math.min(
    sample,
    MAX_IMAGE_EDGE / Math.max(width, height),
    Math.sqrt(16777216 / (width * height))
  )
  canvas.width = Math.max(1, Math.floor(width * scale))
  canvas.height = Math.max(1, Math.floor(height * scale))
  try {
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Image canvas unavailable')
    }
    const natural = { width: image.naturalWidth, height: image.naturalHeight }
    const oriented = rotatedSize(natural, turns)
    context.imageSmoothingQuality = 'high'
    context.scale(canvas.width / rect.width, canvas.height / rect.height)
    context.translate(oriented.width / 2 - rect.x, oriented.height / 2 - rect.y)
    context.rotate((-turns * Math.PI) / 2)
    context.drawImage(image, -natural.width / 2, -natural.height / 2)
    const result = await toBlob(canvas, 'image/webp', 0.8)
    if (!result) {
      throw new Error('Image export failed')
    }
    const extension = result.type === 'image/webp' ? 'webp' : 'png'
    return new File([result], `${name.replace(/\.[^.]+$/, '')}.${extension}`, {
      type: result.type,
    })
  } finally {
    canvas.width = canvas.height = 0
  }
}

/* ============================================================================
 * 功能区：附件与文件预览 / imageCrop 结束
 * ========================================================================== */
