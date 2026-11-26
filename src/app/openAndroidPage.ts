/* ============================================================================
 * 功能区：应用外壳 / openAndroidPage · Android 页面跳转
 * 职责：Android 页面跳转：调用原生源码浏览或外部页面入口。
 * 分区：01 实现：openAndroidPage
 * 关联：依赖 app/android、i18n/index；
 *    被 components/markdown/Link、components/search/AndroidSearchPanel、components/settings/AndroidSettings 引用。
 * 导出：openAndroidPage
 * 边界：只处理应用装配、生命周期、导航与全局视图；不实现聊天协议、持久化与业务算法。
 * ========================================================================== */

import { translate } from '../i18n/index.js'
import { android } from './android.js'

/* ---- 01 实现：openAndroidPage ---- */
export const openAndroidPage = (url: string, { showBrowserAction = true } = {}) => {
  if (!android || !/^https?:\/\//i.test(url)) {
    return false
  }

  android.openSourcePage(
    url,
    document.body.hasAttribute('data-ds-dark-theme'),
    translate('close'),
    showBrowserAction ? translate('openInBrowser') : '',
    translate('pageLoading'),
    translate('pageLoadFailed'),
    translate('retry')
  )
  return true
}

/* ============================================================================
 * 功能区：应用外壳 / openAndroidPage 结束
 * ========================================================================== */
