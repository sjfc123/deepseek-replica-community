/* ============================================================================
 * 功能区：设置页 / AdvancedApiSettings 开始
 * 职责：AdvancedApiSettings 组件，负责该组件的渲染、状态与交互出口。
 * 导出：AdvancedApiDialog、AdvancedApiSettings。
 * ========================================================================== */

import { useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  CHAT_API_FORMATS,
  DEFAULT_CHAT_CONFIG,
  DEFAULT_CHAT_MODEL,
  chatBaseUrl,
  resolveChatEndpoint,
  type ChatApiFormat,
} from '../../services/api/chatConfig.js'
import { setChatConfig, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import styles from './AdvancedApiSettings.module.css'

const formats = (Object.keys(CHAT_API_FORMATS) as ChatApiFormat[]).map((value) => ({
  value,
  label: CHAT_API_FORMATS[value],
}))

const endpointExamples: Record<ChatApiFormat, string> = {
  messages: 'https://api.deepseek.com/anthropic',
  chat: 'https://api.deepseek.com',
  responses: 'https://api.deepseek.com',
}

export const AdvancedApiDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('advancedSettings')}
      closable
      className={styles.dialog}
      mainClassName={styles.dialogMain}
      onClose={onClose}
    >
      <AdvancedApiSettings onSave={onClose} />
    </Modal>
  )
}

export const AdvancedApiSettings = ({ onSave }: { onSave: () => void }) => {
  const t = useTranslate()
  const [saved] = useState(() => useSettings.getState().chatConfig)
  const [draft, setDraft] = useState(() => ({
    ...saved,
    endpoint: chatBaseUrl(saved.endpoint, saved.format) ?? '',
  }))
  const [error, setError] = useState<TranslationKey>()
  const customEndpoint = draft.endpoint.trim()
  const format = draft.format
  const save = () => {
    const model = draft.model.trim()
    const endpoint = resolveChatEndpoint(customEndpoint, format, saved)
    if (endpoint === null) {
      setError('advancedInvalidEndpoint')
      return
    }
    const config = {
      model,
      endpoint,
      format,
      apiKey: endpoint ? draft.apiKey.trim() : '',
    }
    if (setChatConfig(config)) {
      onSave()
    } else {
      setError('advancedSaveFailed')
    }
  }
  const reset = () => {
    if (setChatConfig(DEFAULT_CHAT_CONFIG)) {
      onSave()
    } else {
      setError('advancedSaveFailed')
    }
  }
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <label>
        {t('advancedModel')}
        <input
          value={draft.model}
          placeholder={DEFAULT_CHAT_MODEL}
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => {
            const model = event.target.value
            setDraft((current) => ({ ...current, model }))
            setError(undefined)
          }}
        />
      </label>
      <div className={styles.field}>
        <span>{t('advancedProtocol')}</span>
        <Select
          ariaLabel={t('advancedProtocol')}
          value={format}
          options={formats}
          onChange={(value) => {
            setDraft((current) => ({ ...current, format: value }))
            setError(undefined)
          }}
        />
      </div>
      <label>
        {t('advancedEndpoint')}
        <input
          value={draft.endpoint}
          placeholder={endpointExamples[format]}
          inputMode="url"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => {
            const endpoint = event.target.value
            setDraft((current) => ({
              ...current,
              endpoint,
              apiKey:
                chatBaseUrl(endpoint, current.format) ===
                chatBaseUrl(current.endpoint, current.format)
                  ? current.apiKey
                  : '',
            }))
            setError(undefined)
          }}
        />
      </label>
      <p>{t(customEndpoint ? 'advancedEndpointHint' : 'advancedDefaultHint')}</p>
      {customEndpoint ? (
        <>
          <label>
            {t('advancedEndpointKey')}
            <input
              type="password"
              value={draft.apiKey}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => {
                const apiKey = event.target.value
                setDraft((current) => ({ ...current, apiKey }))
              }}
            />
          </label>
          <p>{t('advancedProviderHint')}</p>
        </>
      ) : null}
      {error ? <p role="alert">{t(error)}</p> : null}
      <div className={styles.actions}>
        <Button variant="outlined" onClick={reset}>
          {t('advancedReset')}
        </Button>
        <Button variant="primary" type="submit">
          {t('advancedSave')}
        </Button>
      </div>
    </form>
  )
}

/* ============================================================================
 * 功能区：设置页 / AdvancedApiSettings 结束
 * ========================================================================== */
