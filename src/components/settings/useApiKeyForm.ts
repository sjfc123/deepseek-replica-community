/* ============================================================================
 * 功能区：视图与交互 / useApiKeyForm · API Key 表单 Hook
 * 职责：API Key 表单 Hook：读取、校验、保存与清除。
 * 分区：01 实现：useApiKeyForm
 * 关联：依赖 i18n/index、services/api/client、services/api/errors、services/settings；
 *    被 components/settings/ApiKeyField、components/settings/ApiKeyScreen 引用。
 * 导出：useApiKeyForm
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

import { useState } from 'react'
import { ApiError, verifyApiKey } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import { setApiKey } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'

/* ---- 01 实现：useApiKeyForm ---- */
/** 输入 API Key 后先用 GET /models 校验，通过才保存 */
export const useApiKeyForm = (onSaved?: () => void) => {
  const t = useTranslate()
  const [value, setValue] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null)
  const cause = failure?.cause
  const error =
    failure === null
      ? null
      : classifyApiError(cause) === 'unauthorized'
        ? t('apiKeyInvalid')
        : classifyApiError(cause) === 'network'
          ? t('commonNetworkErrorToast')
          : t('apiKeyVerificationFailed', {
              message:
                cause instanceof ApiError && cause.localMessage
                  ? t(cause.localMessage.key, cause.localMessage.params)
                  : cause instanceof Error
                    ? cause.message
                    : String(cause),
            })

  const submit = async () => {
    const apiKey = value.trim()
    if (!apiKey || verifying) {
      return
    }
    setVerifying(true)
    setFailure(null)
    try {
      await verifyApiKey(apiKey)
      if (!setApiKey(apiKey)) {
        throw new Error(t('apiKeyStorageFailed'))
      }
      setValue('')
      onSaved?.()
    } catch (e) {
      setFailure({ cause: e })
    } finally {
      setVerifying(false)
    }
  }

  return { value, setValue, verifying, error, submit }
}

/* ============================================================================
 * 功能区：设置页 / useApiKeyForm 结束
 * ========================================================================== */
