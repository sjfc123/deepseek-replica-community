/* ============================================================================
 * 功能区：设置页 / ApiKeyScreen 开始
 * 职责：ApiKeyScreen 组件，负责该组件的渲染、状态与交互出口。
 * 导出：ApiKeyScreen。
 * ========================================================================== */

import { useState } from 'react'
import fatFishIcon from '../../assets/dafeiyu-icon.png'
import { useTranslate } from '../../i18n/index.js'
import { AdvancedApiDialog } from './AdvancedApiSettings.js'
import advancedStyles from './AdvancedApiSettings.module.css'
import { useApiKeyForm } from './useApiKeyForm.js'
import styles from './ApiKeyScreen.module.css'

export const ApiKeyScreen = () => {
  const t = useTranslate()
  const form = useApiKeyForm()
  const [advanced, setAdvanced] = useState(false)

  return (
    <main className={styles.page}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          void form.submit()
        }}
      >
        <img className={styles.fatFish} src={fatFishIcon} alt="" />
        <h1>{t('apiKeyStart')}</h1>
        <input
          aria-label="DeepSeek API Key"
          aria-invalid={Boolean(form.error)}
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={t('apiKeyPlaceholder')}
          value={form.value}
          onChange={(event) => form.setValue(event.target.value)}
        />
        {form.error ? (
          <div role="alert" className={styles.error}>
            {form.error}
          </div>
        ) : null}
        <button type="submit" disabled={form.verifying || !form.value.trim()}>
          {t(form.verifying ? 'apiKeyVerifying' : 'confirm')}
        </button>
        <a href="https://platform.deepseek.com/api_keys">{t('apiKeyGet')}</a>
        <button className={advancedStyles.entry} type="button" onClick={() => setAdvanced(true)}>
          {t('advancedSettings')}
        </button>
      </form>
      {advanced ? <AdvancedApiDialog onClose={() => setAdvanced(false)} /> : null}
    </main>
  )
}

/* ============================================================================
 * 功能区：设置页 / ApiKeyScreen 结束
 * ========================================================================== */
