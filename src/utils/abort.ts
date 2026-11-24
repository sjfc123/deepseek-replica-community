/* ============================================================================
 * 功能区：通用工具 / abort 开始
 * 职责：取消工具：兼容 AbortController 的创建、触发与清理。
 * 导出：无对外导出，仅供同目录模块使用。
 * ========================================================================== */

const createAbortError = () => new DOMException('The operation was aborted.', 'AbortError')

const installAbortSignalPolyfill = () => {
  if (typeof AbortSignal === 'undefined') {
    return
  }
  const signalProto = AbortSignal.prototype
  if (!('reason' in signalProto)) {
    const reasons = new WeakMap<AbortSignal, unknown>()
    if (typeof AbortController !== 'undefined') {
      const originalAbort = AbortController.prototype.abort
      AbortController.prototype.abort = function abort(...args: [reason?: unknown]) {
        if (!this.signal.aborted) {
          reasons.set(
            this.signal,
            args.length > 0 && args[0] !== undefined ? args[0] : createAbortError()
          )
        }
        return originalAbort.call(this)
      }
    }
    Object.defineProperty(signalProto, 'reason', {
      configurable: true,
      enumerable: true,
      get(this: AbortSignal) {
        if (!this.aborted) {
          return undefined
        }
        if (!reasons.has(this)) {
          reasons.set(this, createAbortError())
        }
        return reasons.get(this)
      },
    })
  }
  if (typeof signalProto.throwIfAborted !== 'function') {
    Object.defineProperty(signalProto, 'throwIfAborted', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function throwIfAborted(this: AbortSignal) {
        if (this.aborted) {
          throw this.reason !== undefined ? this.reason : createAbortError()
        }
      },
    })
  }
}

installAbortSignalPolyfill()

/* ============================================================================
 * 功能区：通用工具 / abort 结束
 * ========================================================================== */
