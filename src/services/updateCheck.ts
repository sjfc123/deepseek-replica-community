/* ============================================================================
 * 功能区：本地服务 / updateCheck
 * 职责：读取仓库 package.json 的版本号，与应用内版本比较；只负责查询，不自动下载或覆盖安装。
 * 分区：01 类型、契约与依赖；02 核心实现：compareVersions、fetchJson、checkForUpdates
 * 关联：无内部依赖；
 *    被 scripts/test-cache-diagnostics、components/settings/AndroidSettings 引用。
 * 导出：UpdateCheckResult、compareVersions、checkForUpdates
 * 边界：只处理本机存储、设置、迁移与数据版本；不实现界面控件，不直接请求模型。
 * ========================================================================== */

/* ---- 01 类型、契约与依赖 ---- */
export type UpdateCheckResult = {
  current: string
  latest: string
  hasUpdate: boolean
  releaseUrl: string
  source: string
  checkedAt: string
}

const RELEASE_URL = 'https://github.com/cold-report/deepsaga/releases'
const MANIFESTS = [
  'https://raw.githubusercontent.com/cold-report/deepsaga/main/package.json',
  'https://cdn.jsdelivr.net/gh/cold-report/deepsaga@main/package.json',
]

/** 版本号只比较数字段；预发布后缀不参与，避免 0.9.1-beta 被误判成更高 */
const versionParts = (value: string): number[] =>
  value
    .trim()
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0))

export const compareVersions = (left: string, right: string): number => {
  const a = versionParts(left)
  const b = versionParts(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) {
      return delta > 0 ? 1 : -1
    }
  }
  return 0
}

/* ---- 02 核心实现：compareVersions、fetchJson、checkForUpdates ---- */
const fetchJson = async (url: string): Promise<{ version: string }> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const data = (await response.json()) as { version?: unknown }
    if (typeof data.version !== 'string' || !data.version.trim()) {
      throw new Error('清单缺少 version')
    }
    return { version: data.version.trim() }
  } finally {
    clearTimeout(timer)
  }
}

/** 依次尝试 GitHub raw 与 jsDelivr；两个都失败时把最后一次错误交给界面 */
export const checkForUpdates = async (current: string): Promise<UpdateCheckResult> => {
  let lastError: unknown = null
  for (const url of MANIFESTS) {
    try {
      const manifest = await fetchJson(url)
      return {
        current,
        latest: manifest.version,
        hasUpdate: compareVersions(manifest.version, current) > 0,
        releaseUrl: RELEASE_URL,
        source: url.includes('jsdelivr') ? 'jsDelivr' : 'GitHub raw',
        checkedAt: new Date().toISOString(),
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('更新清单读取失败')
}

/* ============================================================================
 * 功能区：应用外壳 / updateCheck 结束
 * ========================================================================== */
