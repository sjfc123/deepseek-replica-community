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
