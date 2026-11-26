/* ============================================================================
 * 功能区：视图与交互 / AndroidIcons
 * 职责：AndroidIcons 组件，负责该组件的渲染、状态与交互出口。
 * 分区：01 类型、契约与依赖；02 核心实现：AndroidSound、AndroidCircle、AndroidAttachment
 * 关联：无内部依赖；
 *    被 components/chatInput/AndroidAttachments、components/chatInput/ChatInput、components/session/MobileHeader 引用。
 * 导出：AndroidSound、AndroidCircle、AndroidAttachment
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

/* ---- 01 类型、契约与依赖 ---- */
export const AndroidSound = ({ muted }: { muted: boolean }) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    data-sound-state={muted ? 'muted' : 'active'}
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinejoin="round"
  >
    <path
      d={muted ? 'M5 7H2.2v10H6l6.8 4.5v-7M8.4 5.6l4.4-3v7.6' : 'M2.2 7v10H6l6.8 4.5v-19L6 7z'}
      fill={muted ? 'none' : 'currentColor'}
      stroke={muted ? 'currentColor' : 'none'}
    />
    <path d="M16 7.7a6.1 6.1 0 0 1 .7 7.9" />
    <path d="M18.4 4.7a10.3 10.3 0 0 1 1.3 12.6" opacity={muted ? 1 : 0.25} />
    {muted ? <path d="m1.5 3.2 18.6 18.6" /> : null}
  </svg>
)

export const AndroidCircle = ({ icon }: { icon: 'add' | 'close' | 'voice' | 'keys' }) => (
  <svg
    width="25"
    height="25"
    viewBox="0 0 28 28"
    fill="none"
    aria-hidden="true"
    stroke="currentColor"
    strokeWidth="1.9"
  >
    <circle cx="14" cy="14" r="12.9" />
    {icon === 'add' ? <path d="M14 8v12M8 14h12" /> : null}
    {icon === 'close' ? <path d="m10 10 8 8m0-8-8 8" /> : null}
    {icon === 'voice' ? (
      <>
        <circle cx="8.7" cy="14" r="1.5" fill="currentColor" stroke="none" />
        <path d="M12.1 9.6a6.7 6.7 0 0 1 0 8.8m3.8-12a11.6 11.6 0 0 1 0 15.2" />
      </>
    ) : null}
    {icon === 'keys' ? <path d="M8 9h2m3 0h2m3 0h2M8 14h2m3 0h2m3 0h2m-10 5h8" /> : null}
  </svg>
)

/* ---- 02 核心实现：AndroidSound、AndroidCircle、AndroidAttachment ---- */
export const AndroidAttachment = ({ kind }: { kind: 'camera' | 'gallery' | 'files' }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinejoin="round"
    strokeLinecap="round"
  >
    {kind === 'camera' ? (
      <>
        <path d="M7.5 4.6 8.3 3A2.3 2.3 0 0 1 10.4 2h3.2a2.3 2.3 0 0 1 2.1 1l.8 1.6h2.2A3.3 3.3 0 0 1 22 7.9v10.5a3.3 3.3 0 0 1-3.3 3.3H5.3A3.3 3.3 0 0 1 2 18.4V7.9a3.3 3.3 0 0 1 3.3-3.3z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ) : null}
    {kind === 'gallery' ? (
      <>
        <rect x="2" y="3" width="20" height="18" rx="3.4" />
        <circle cx="16.1" cy="8.4" r="1.6" />
        <path d="m2.7 16 2.8-2.8a3 3 0 0 1 4.2 0l7.6 7.6" />
      </>
    ) : null}
    {kind === 'files' ? (
      <path d="m21 11.1-9 9a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 1 1-2.8-2.8l8.3-8.3" />
    ) : null}
  </svg>
)

/* ============================================================================
 * 功能区：基础 UI / AndroidIcons 结束
 * ========================================================================== */
