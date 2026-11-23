import styles from './AccountProfile.module.css'

export const ProfileIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    aria-hidden="true"
  >
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 21a7.5 6 0 0 1 15 0" />
  </svg>
)

export const ProfileAvatar = ({ src }: { src: string | null }) => (
  <span className={styles.avatar} aria-hidden="true">
    {src ? (
      <img src={src} alt="" />
    ) : (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="8" r="4.15" />
        <path d="M3 23a9 7 0 0 1 18 0z" />
      </svg>
    )}
  </span>
)
