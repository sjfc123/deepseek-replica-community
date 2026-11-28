/* ============================================================================
 * 功能区：模型接口 / balanceFormat · 余额展示纯函数
 * 职责：余额货币符号与金额格式化；不发请求、不依赖 HTTP 客户端，便于回归测试直接引入。
 * 分区：01 常量与纯函数；02 对外入口与收尾
 * 关联：被 services/api/balance、components/balance 引用。
 * 导出：currencySymbol、formatBalanceAmount、parseBalanceAmount
 * 边界：只做字符串归一化；非数字原样保留，不伪造数值。
 * ========================================================================== */

/* ---- 01 常量与纯函数 ---- */
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/

/** 把上游余额文本归一为可展示字符串；非法或空值返回空串。 */
export const parseBalanceAmount = (value: unknown): string =>
  typeof value === 'string' && NUMBER_RE.test(value.trim()) ? value.trim() : ''

/* ---- 02 对外入口与收尾 ---- */
export const currencySymbol = (currency: string): string => {
  if (currency === 'CNY') {
    return '¥'
  }
  if (currency === 'USD') {
    return '$'
  }
  return currency ? `${currency} ` : ''
}

/** 余额保留两位小数；非数字原样返回，避免把上游文案改成假数值。 */
export const formatBalanceAmount = (amount: string): string => {
  if (!NUMBER_RE.test(amount)) {
    return amount
  }
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) {
    return amount
  }
  return numeric.toFixed(2)
}
