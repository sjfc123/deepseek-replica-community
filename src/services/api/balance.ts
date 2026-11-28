/* ============================================================================
 * 功能区：模型接口 / balance · 账号余额查询
 * 职责：按当前聊天配置请求端点原生 /user/balance 或同网关兼容余额接口，归一化余额明细。
 * 分区：01 类型、契约与依赖；02 地址推导；03 对外入口与收尾
 * 关联：依赖 services/api/chatConfig、services/api/client、services/api/balanceFormat；
 *    被 services/balanceStore 引用。
 * 导出：BalanceInfo、AccountBalance、fetchAccountBalance、isBalanceUnsupported，
 *    以及 balanceFormat 的 currencySymbol、formatBalanceAmount 便于组件复用。
 * 边界：只做 HTTP 请求与字段归一化；缓存、刷新节奏与视图由上层承担。第三方网关
 *    不提供余额接口时抛错，由调用方降级为「不可用」，不在此吞错。
 * ========================================================================== */

import { API_ORIGIN, request, type ApiError } from './client.js'
import type { ChatConfig } from './chatConfig.js'
import {
  currencySymbol,
  formatBalanceAmount,
  parseBalanceAmount,
} from './balanceFormat.js'

export { currencySymbol, formatBalanceAmount }

/* ---- 01 类型、契约与依赖 ---- */
export type BalanceInfo = {
  /** 货币：CNY / USD，其他值原样保留 */
  currency: string
  /** 总的可用余额（赠金 + 充值） */
  total: string
  /** 未过期赠金余额 */
  granted: string
  /** 充值余额 */
  toppedUp: string
}

export type AccountBalance = {
  /** 上游返回的「是否还有可用余额」；字段缺失按 true 处理 */
  available: boolean
  infos: BalanceInfo[]
  updatedAt: number
}

const CHAT_SUFFIXES = [
  '/anthropic/v1/messages',
  '/v1/chat/completions',
  '/v1/messages',
  '/chat/completions',
  '/v1/responses',
  '/responses',
  '/messages',
]

/* ---- 02 地址推导 ---- */
/** 从聊天端点回推服务端根地址，再拼余额路径；无效地址退回官方域名。 */
const balanceBaseUrl = (endpoint: string): string => {
  const trimmed = endpoint.trim()
  if (!/^https?:\/\//i.test(trimmed)) {
    return API_ORIGIN
  }
  let base = trimmed
  for (const suffix of CHAT_SUFFIXES) {
    if (base.toLowerCase().endsWith(suffix)) {
      base = base.slice(0, base.length - suffix.length)
      break
    }
  }
  return base.replace(/\/+$/, '')
}

/* ---- 03 对外入口与收尾 ---- */
/**
 * GET /user/balance。DeepSeek 端点与兼容网关共用 Bearer 鉴权；
 * 响应字段以 balance_infos 为准，兼容旧名 balance_inf。
 */
export const fetchAccountBalance = async (
  config: ChatConfig,
  apiKey: string | null,
  signal?: AbortSignal
): Promise<AccountBalance> => {
  const base = balanceBaseUrl(config.endpoint || API_ORIGIN)
  const key = config.apiKey || apiKey || ''
  const response = await request(`${base}/user/balance`, {
    method: 'GET',
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    credentials: 'omit',
    redirect: 'error',
    signal,
  })
  const body = (await response.json()) as Record<string, unknown>
  const rawList = Array.isArray(body.balance_infos)
    ? body.balance_infos
    : Array.isArray(body.balance_inf)
      ? body.balance_inf
      : []
  const infos: BalanceInfo[] = rawList
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>
      return {
        currency: typeof record.currency === 'string' ? record.currency : '',
        total: parseBalanceAmount(record.total_balance),
        granted: parseBalanceAmount(record.granted_balance),
        toppedUp: parseBalanceAmount(record.topped_up_balance),
      }
    })
    .filter((info) => info.total !== '' || info.currency !== '')

  return {
    available: typeof body.is_available === 'boolean' ? body.is_available : true,
    infos,
    updatedAt: Date.now(),
  }
}

/** 余额请求失败的归一化标识：网关不支持余额接口时据此显示「不可用」。 */
export const isBalanceUnsupported = (error: unknown): boolean =>
  error instanceof Error && (error as ApiError).status === 404
