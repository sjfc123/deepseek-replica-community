/* ============================================================================
 * 功能区：公共工具 / blob · Blob 工具
 * 职责：Blob 工具：读取、转码、下载与释放对象 URL。
 * 分区：01 实现：readBlobBuffer
 * 关联：无内部依赖；
 *    被 app/android、components/files/imageCrop、services/chat/autoBackup、services/chat/contextSummary 等 10 个模块 引用。
 * 导出：readBlobBuffer
 * 边界：只提供纯函数与浏览器能力封装；不读取应用状态，不产生网络请求。
 * ========================================================================== */

/* ---- 01 实现：readBlobBuffer ---- */
export const readBlobBuffer = (blob: Blob): Promise<ArrayBuffer> => {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer()
  }
  // The stock Android 10 WebView only offers FileReader for binary reads.
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

export async function* readBlobChunks(blob: Blob): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  if (typeof blob.stream !== 'function') {
    const chunkSize = 256 * 1024
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      yield new Uint8Array(await readBlobBuffer(blob.slice(offset, offset + chunkSize)))
    }
    return
  }

  const reader = blob.stream().getReader()
  let finished = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        finished = true
        return
      }
      yield value
    }
  } finally {
    if (!finished) {
      await reader.cancel().catch(() => {})
    }
    reader.releaseLock()
  }
}

/* ============================================================================
 * 功能区：通用工具 / blob 结束
 * ========================================================================== */
