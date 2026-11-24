/* ============================================================================
 * 功能区：通用工具 / blob 开始
 * 职责：Blob 工具：读取、转码、下载与释放对象 URL。
 * 导出：readBlobBuffer。
 * ========================================================================== */

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
