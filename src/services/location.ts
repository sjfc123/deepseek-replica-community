/* ============================================================================
 * 功能区：本地服务 / location · 定位服务
 * 职责：定位服务：权限处理、坐标归一化与本地缓存。
 * 分区：01 类型、契约与依赖；02 核心实现：regionNames、getRegionName、normalizeLocation
 * 关联：依赖 services/locationData；
 *    被 services/chat/latestReminder、services/settings 引用。
 * 导出：provinces、UserLocation、getRegionName、normalizeLocation、regionCodes
 * 边界：只处理本机存储、设置、迁移与数据版本；不实现界面控件，不直接请求模型。
 * ========================================================================== */

import '@formatjs/intl-displaynames/polyfill.js'
import '@formatjs/intl-displaynames/locale-data/en.js'
import '@formatjs/intl-displaynames/locale-data/zh.js'
import { cityNames, regionCodes, regionNameOverrides, provinceNames } from './locationData.js'

export { regionCodes } from './locationData.js'

/* ---- 01 类型、契约与依赖 ---- */
export const provinces = Object.entries(provinceNames).map(([code, name]) => ({
  code,
  name,
  cities: Object.entries(cityNames)
    .filter(([city]) => city.startsWith(code.slice(0, 2)))
    .map(([code, name]) => ({ code, name })),
}))

export type UserLocation = {
  region: string
  province?: string
  city?: string
}

const regions = new Set(regionCodes)
const regionNames = {
  'zh-CN': new Intl.DisplayNames(['zh-CN'], { type: 'region' }),
  'en-US': new Intl.DisplayNames(['en-US'], { type: 'region' }),
}

/* ---- 02 核心实现：regionNames、getRegionName、normalizeLocation ---- */
export const getRegionName = (code: string, locale: 'zh-CN' | 'en-US'): string =>
  regions.has(code)
    ? (regionNameOverrides[locale][code] ?? regionNames[locale].of(code) ?? code)
    : ''

export const normalizeLocation = (value: unknown): UserLocation | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const location = value as Record<string, unknown>
  const { region, province, city } = location
  if (typeof region !== 'string' || !regions.has(region)) {
    return null
  }
  if (region !== 'CN') {
    return { region }
  }
  if (province === undefined) {
    return city === undefined ? { region } : null
  }
  const selectedProvince = provinces.find((item) => item.code === province)
  if (!selectedProvince) {
    return null
  }
  if (city === undefined) {
    return { region, province: selectedProvince.code }
  }
  const selectedCity = selectedProvince.cities.find((item) => item.code === city)
  return selectedCity ? { region, province: selectedProvince.code, city: selectedCity.code } : null
}

/* ============================================================================
 * 功能区：本地服务 / location 结束
 * ========================================================================== */
