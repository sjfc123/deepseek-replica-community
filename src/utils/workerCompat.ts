/* ============================================================================
 * 功能区：通用工具 / workerCompat 开始
 * 职责：Worker 兼容：检测、创建与降级主线程执行。
 * 导出：无对外导出，仅供同目录模块使用。
 * ========================================================================== */

/**
 * Worker 作用域的语言能力补齐。
 *
 * 启动引导层仅作用于主窗口；Worker 为独立作用域，不共享该补丁。
 * Markdown 解析与历史导入均在 Worker 中执行，缺失任一方法会导致静默失败，
 * 因此两个 Worker 入口在首行导入本模块。
 */

const scope = globalThis as unknown as Record<string, unknown>

const define = (target: object | undefined, key: string, value: unknown) => {
  if (!target || typeof (target as Record<string, unknown>)[key] === 'function') {
    return
  }
  Object.defineProperty(target, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

const relativeIndex = (length: number, index: unknown) => {
  const n = Number.parseInt(String(index), 10)
  const safe = Number.isNaN(n) ? 0 : n
  return safe < 0 ? length + safe : safe
}

define(Object, 'hasOwn', (object: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(Object(object), key)
)

define(Array.prototype, 'at', function (this: unknown[], index: number) {
  const i = relativeIndex(this.length, index)
  return i >= 0 && i < this.length ? this[i] : undefined
})

define(String.prototype, 'at', function (this: string, index: number) {
  const i = relativeIndex(this.length, index)
  return i >= 0 && i < this.length ? this.charAt(i) : undefined
})

define(
  String.prototype,
  'replaceAll',
  function (this: string, search: string, replacement: string) {
    const source = String(this)
    if (search === '') {
      const fill = String(replacement)
      let out = fill
      for (let i = 0; i < source.length; i++) {
        out += source.charAt(i) + fill
      }
      return out
    }
    return source.split(search).join(String(replacement))
  }
)

define(Array.prototype, 'flat', function (this: unknown[], depth?: number) {
  const limit = depth === undefined ? 1 : Number(depth) || 0
  const out: unknown[] = []
  const walk = (list: unknown[], level: number) => {
    for (let i = 0; i < list.length; i++) {
      if (!(i in list)) {
        continue
      }
      const item = list[i]
      if (Array.isArray(item) && level < limit) {
        walk(item, level + 1)
      } else {
        out.push(item)
      }
    }
  }
  walk(this, 0)
  return out
})

define(
  Array.prototype,
  'flatMap',
  function (this: unknown[], mapper: (value: unknown, index: number, list: unknown[]) => unknown) {
    const out: unknown[] = []
    for (let i = 0; i < this.length; i++) {
      if (!(i in this)) {
        continue
      }
      const mapped = mapper(this[i], i, this)
      if (Array.isArray(mapped)) {
        out.push(...mapped)
      } else {
        out.push(mapped)
      }
    }
    return out
  }
)

define(
  Array.prototype,
  'findLastIndex',
  function (
    this: unknown[],
    predicate: (value: unknown, index: number, list: unknown[]) => boolean
  ) {
    for (let i = this.length - 1; i >= 0; i--) {
      if (predicate(this[i], i, this)) {
        return i
      }
    }
    return -1
  }
)

define(Object, 'fromEntries', (entries: Array<[PropertyKey, unknown]>) => {
  const out: Record<PropertyKey, unknown> = {}
  for (const pair of entries ?? []) {
    if (pair) {
      out[pair[0]] = pair[1]
    }
  }
  return out
})

define(Promise, 'allSettled', (list: Iterable<unknown>) =>
  Promise.all(
    Array.from(list ?? []).map((item) =>
      Promise.resolve(item).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason })
      )
    )
  )
)

/* Worker 无 window，structuredClone 挂载在全局作用域 */
define(scope, 'structuredClone', (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return value.slice(0, value.size, value.type)
  }
  if (value instanceof Date) {
    return new Date(value.getTime())
  }
  if (Array.isArray(value)) {
    return value.map((item) => (scope.structuredClone as (v: unknown) => unknown)(item))
  }
  const clone = scope.structuredClone as (v: unknown) => unknown
  if (value instanceof Map) {
    const map = new Map()
    value.forEach((item, key) => map.set(clone(key), clone(item)))
    return map
  }
  if (value instanceof Set) {
    const set = new Set()
    value.forEach((item) => set.add(clone(item)))
    return set
  }
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    out[key] = clone((value as Record<string, unknown>)[key])
  }
  return out
})

/* Blob 读取：Worker 同样可能运行在旧内核上 */
if (typeof Blob !== 'undefined') {
  define(Blob.prototype, 'arrayBuffer', function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new (scope.FileReaderSync as new () => {
        readAsArrayBuffer: (b: Blob) => ArrayBuffer
        readAsText: (b: Blob) => string
      })()
      try {
        resolve(reader.readAsArrayBuffer(this))
      } catch (error) {
        reject(error)
      }
    })
  })
  define(Blob.prototype, 'text', function (this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new (scope.FileReaderSync as new () => {
        readAsArrayBuffer: (b: Blob) => ArrayBuffer
        readAsText: (b: Blob) => string
      })()
      try {
        resolve(reader.readAsText(this))
      } catch (error) {
        reject(error)
      }
    })
  })
}

define(scope, 'queueMicrotask', (task: () => void) => {
  Promise.resolve()
    .then(task)
    .catch((error: unknown) => {
      setTimeout(() => {
        throw error
      }, 0)
    })
})

export {}

/* ============================================================================
 * 功能区：通用工具 / workerCompat 结束
 * ========================================================================== */
