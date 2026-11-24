/* ============================================================================
 * 功能区：设置页 / ProfileEditor 开始
 * 职责：ProfileEditor 组件，负责该组件的渲染、状态与交互出口。
 * 导出：ProfileEditor。
 * ========================================================================== */

import { useRef, useState, type ChangeEvent } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { setAccountProfile, useSettings } from '../../services/settings.js'
import { prepareAvatar } from '../../utils/imageAvatar.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { ProfileAvatar } from './ProfileAvatar.js'
import styles from './AccountProfile.module.css'

const MAX_USERNAME_LENGTH = 40

export const ProfileEditor = () => {
  const t = useTranslate()
  const saved = useSettings((state) => state.accountProfile)
  const [username, setUsername] = useState(saved.username)
  const [avatar, setAvatar] = useState(saved.avatar)
  const [loadingAvatar, setLoadingAvatar] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const changed = username.trim() !== saved.username || avatar !== saved.avatar

  const chooseAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) {
      return
    }
    setLoadingAvatar(true)
    try {
      setAvatar(await prepareAvatar(file))
    } catch {
      showToast({ key: 'profileAvatarInvalid', type: 'error' })
    } finally {
      setLoadingAvatar(false)
    }
  }

  return (
    <form
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault()
        if (!changed || loadingAvatar) {
          return
        }
        const name = username.trim()
        if (setAccountProfile({ username: name, avatar })) {
          setUsername(name)
          showToast({ key: 'profileSaved' })
        } else {
          showToast({ key: 'profileSaveFailed', type: 'error' })
        }
      }}
    >
      <div className={styles.avatarField} aria-busy={loadingAvatar}>
        <ProfileAvatar src={avatar} />
        <div className={styles.avatarActions}>
          <Button
            size="m"
            variant="outlined"
            disabled={loadingAvatar}
            onClick={() => input.current?.click()}
          >
            {t(avatar ? 'profileChangeAvatar' : 'profileChooseAvatar')}
          </Button>
          {avatar ? (
            <Button
              size="m"
              variant="outlined"
              disabled={loadingAvatar}
              onClick={() => setAvatar(null)}
            >
              {t('profileRemoveAvatar')}
            </Button>
          ) : null}
        </div>
        <input ref={input} type="file" accept="image/*" hidden onChange={chooseAvatar} />
      </div>
      <label className={styles.usernameField}>
        {t('profileUsername')}
        <input
          type="text"
          autoComplete="nickname"
          maxLength={MAX_USERNAME_LENGTH}
          placeholder={t('profileDefaultUsername')}
          value={username}
          onChange={(event) => setUsername(event.currentTarget.value)}
        />
      </label>
      <Button size="m" type="submit" disabled={!changed || loadingAvatar}>
        {t('profileSave')}
      </Button>
    </form>
  )
}

/* ============================================================================
 * 功能区：设置页 / ProfileEditor 结束
 * ========================================================================== */
