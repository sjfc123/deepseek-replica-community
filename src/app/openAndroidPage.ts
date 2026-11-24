/* ============================================================================
 * 功能区：应用外壳 / openAndroidPage 开始
 * 职责：Android 页面跳转：调用原生源码浏览或外部页面入口。
 * 导出：openAndroidPage。
 * ========================================================================== */

import { translate } from '../i18n/index.js'
import { android } from './android.js'

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
