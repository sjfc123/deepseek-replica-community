/* ============================================================================
 * 功能区：应用外壳 / android · Android 桥接
 * 职责：Android 桥接：封装原生 JavaScript 接口并为网页环境提供空实现。
 * 分区：01 类型、契约与依赖；
 *    02 核心实现：writeAndroidBlob、saveAndroidHistory、saveAndroidImage；
 *    03 对外入口与收尾
 * 关联：依赖 utils/blob；
 *    被 app/App、app/diagnostics、app/openAndroidPage、app/theme 等 35 个模块 引用。
 * 导出：android、openExternalUrl、writeAndroidBlob、saveAndroidHistory、saveAndroidImage
 * 边界：只封装 Android 桥接能力与 WebView 参数；不实现业务规则。
 * ========================================================================== */

import { readBlobChunks } from '../utils/blob.js'

/* ---- 01 类型、契约与依赖 ---- */
type AndroidBridge = {
  statusInset: () => number
  buttonNavigationInset: () => number
  systemFontScale: () => number
  openAppPermissions: () => void
  getMusicVolume?: () => number
  openSourcePage: (
    url: string,
    dark: boolean,
    closeLabel: string,
    browserLabel: string,
    loadingLabel: string,
    errorLabel: string,
    retryLabel: string
  ) => void
  /** 交给系统浏览器打开 http/https 链接；旧包没有此方法 */
  openExternalUrl?: (url: string) => boolean
  readApiKey: () => string | null
  writeApiKey: (value: string | null) => boolean
  readChatConfig: () => string | null
  writeChatConfig: (value: string | null) => boolean
  beginChatRequest: (
    endpoint: string,
    format: string,
    body: string,
    headers: string
  ) => string | null
  cancelChatRequest: (id: string) => void
  readAccountProfile: () => string | null
  writeAccountProfile: (value: string | null) => boolean
  setDarkBars: (dark: boolean) => void
  setHandlesBack: (handlesBack: boolean) => void
  setBackPreviewEnabled: (enabled: boolean) => void
  setImageViewerFullscreen: (fullscreen: boolean) => void
  requestRecentPhotos: () => void
  prefetchRecentPhotos: () => void
  requestHistoryExport: (name: string) => void
  writeHistoryExport: (bytes: string) => boolean
  finishHistoryExport: () => boolean
  beginAutoBackup?: (name: string, size: number) => string | null
  writeAutoBackup?: (bytes: string) => boolean
  finishAutoBackup?: () => boolean
  autoBackupStatus?: () => string
  /** 上一次备份失败的原生原因；旧包没有此方法 */
  autoBackupError?: () => string
  pruneAutoBackups?: (keep: number) => void
  beginImageSave: (name: string, mime: string) => boolean
  writeImageSave: (bytes: string) => boolean
  finishImageSave: (keep: boolean) => boolean
  requestMicrophone?: () => void
  /** 通话前先放掉原生录音持有的 AudioRecord，否则 WebView 采集会拿到「通道被占用」 */
  releaseNativeRecorder?: () => boolean
  /** 麦克风自检：真开一次 AudioRecord，返回 JSON 诊断串 */
  probeMicrophone?: () => string
  requestCallAudioFocus?: () => boolean
  abandonCallAudioFocus?: () => void
  requestRecording: () => void
  finishRecording: (keep: boolean) => boolean
  recordingLevel: () => number
  setSelectionExclusion?: (
    startLeft: number,
    startTop: number,
    startRight: number,
    startBottom: number,
    endLeft: number,
    endTop: number,
    endRight: number,
    endBottom: number,
    active: boolean
  ) => void
}

/* ---- 02 核心实现：writeAndroidBlob、saveAndroidHistory、saveAndroidImage ---- */
export const android = (window as Window & { DeepSeekAndroid?: AndroidBridge }).DeepSeekAndroid

/**
 * 角色卡来源链接统一出口：Android 交给系统浏览器，网页端新开标签页。
 * 原生桥接只接受 http/https；调用方仍应先经过 normalizeSourceUrl。
 */
export const openExternalUrl = (url: string) => {
  const device = android
  if (device?.openExternalUrl) {
    try {
      if (device.openExternalUrl(url)) {
        return
      }
    } catch {
      // 旧包或浏览器没有可用 Activity 时走网页端路径。
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export const writeAndroidBlob = async (blob: Blob, append: (base64: string) => boolean) => {
  const chunkSize = 32768
  for await (const chunk of readBlobChunks(blob)) {
    for (let offset = 0; offset < chunk.length; offset += chunkSize) {
      const base64 = btoa(String.fromCharCode(...chunk.subarray(offset, offset + chunkSize)))
      if (!append(base64)) {
        throw new Error('Unable to write the file')
      }
    }
  }
}

export const saveAndroidHistory = async (name: string, blob: Blob): Promise<boolean> => {
  const device = android
  if (!device) {
    return false
  }
  const EXPORT_ANSWER_TIMEOUT = 30_000
  const status = await new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('android-export', answer)
      reject(new Error('Export document was not opened'))
    }, EXPORT_ANSWER_TIMEOUT)
    function answer(event: Event) {
      window.clearTimeout(timer)
      resolve((event as CustomEvent<string>).detail)
    }
    window.addEventListener('android-export', answer, { once: true })
    try {
      device.requestHistoryExport(name)
    } catch (error) {
      window.clearTimeout(timer)
      window.removeEventListener('android-export', answer)
      reject(error instanceof Error ? error : new Error('Unable to open the export document'))
    }
  })
  if (status === 'cancelled') {
    return false
  }
  if (status !== 'ready') {
    throw new Error('Unable to open the export document')
  }
  let closed = false
  try {
    await writeAndroidBlob(blob, (base64) => device.writeHistoryExport(base64))
    closed = device.finishHistoryExport()
    if (!closed) {
      throw new Error('Unable to close the export document')
    }
    return true
  } finally {
    if (!closed) {
      device.finishHistoryExport()
    }
  }
}

/* ---- 03 对外入口与收尾 ---- */
export const saveAndroidImage = async (name: string, blob: Blob) => {
  const device = android
  if (!device?.beginImageSave(name, blob.type)) {
    throw new Error('Unable to create the image')
  }
  try {
    await writeAndroidBlob(blob, (base64) => device.writeImageSave(base64))
  } catch (error) {
    device.finishImageSave(false)
    throw error
  }
  if (!device.finishImageSave(true)) {
    throw new Error('Unable to save the image')
  }
}

/* ============================================================================
 * 功能区：应用外壳 / android 结束
 * ========================================================================== */
