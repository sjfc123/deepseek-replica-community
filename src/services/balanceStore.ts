/* ============================================================================
 * 功能区：本地服务 / balanceStore · 账号余额状态
 * 职责：缓存账号余额查询结果，控制刷新节奏与失败降级；不渲染视图。
 * 分区：01 类型、契约与依赖；02 状态与刷新；03 对外入口与收尾
 * 关联：依赖 services/api/balance、services/settings；
 *    被 components 余额/用量胶囊与明细面板引用。
 * 导出：useBalanceStore
 * 边界：TTL 内复用结果，强制刷新绕过缓存；网关不支持或断网时进入降级态，不反复轰炸接口。
 * ========================================================================== */

import { create } from 'zustand'
import { fetchAccountBalance, isBalanceUnsupported, type AccountBalance } from './api/balance.js'
import { useSettings } from './settings.js'

/* ---- 01 类型、契约与依赖 ---- */
const TTL_MS = 60_000
const STALE_MS = 10 * 1000

export type BalanceStatus = 'idle' | 'loading' | 'ok' | 'error' | 'unsupported'

type BalanceState = {
  data: AccountBalance | null
  status: BalanceStatus
  /** 可读的失败原因；unsupported 时为网关不支持口径 */
  message: string
  refresh: (force?: boolean) => void
}

let inFlight: Promise<AccountBalance> | null = null

/* ---- 02 状态与刷新 ---- */
const runFetch = async (): Promise<AccountBalance> => {
  if (inFlight) {
    return inFlight
  }
  const { apiKey, chatConfig } = useSettings.getState()
  const controller = new AbortController()
  inFlight = fetchAccountBalance(chatConfig, apiKey, controller.signal).finally(() => {
    inFlight = null
  })
  return inFlight
}

/* ---- 03 对外入口与收尾 ---- */
export const useBalanceStore = create<BalanceState>((set, get) => ({
  data: null,
  status: 'idle',
  message: '',
  refresh: (force = false) => {
    const { data, status } = get()
    const { apiKey, chatConfig } = useSettings.getState()
    if (!(chatConfig.apiKey || apiKey)) {
      set({ data: null, status: 'idle', message: '' })
      return
    }
    const fresh = data && Date.now() - data.updatedAt < TTL_MS
    if (status === 'loading') {
      return
    }
    // 非强制且未过期：保留现有结果；仅有陈旧结果时后台静默补一次。
    if (!force && fresh) {
      return
    }
    if (!force && data && Date.now() - data.updatedAt < STALE_MS && status === 'ok') {
      return
    }
    set({ status: 'loading', message: '' })
    void runFetch()
      .then((next) => {
        set({ data: next, status: 'ok', message: '' })
      })
      .catch((error: unknown) => {
        const unsupported = isBalanceUnsupported(error)
        set({
          status: unsupported ? 'unsupported' : 'error',
          message: unsupported
            ? ''
            : error instanceof Error
              ? error.message
              : String(error),
        })
      })
  },
}))
