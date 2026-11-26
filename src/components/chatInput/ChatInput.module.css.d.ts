/* ============================================================================
 * 功能区：视图与交互 / ChatInput
 * 职责：ChatInput 的 CSS Modules 类名类型声明，供 TypeScript 校验 styles.*；不产生运行时代码。
 * 分区：01 类名声明；02 模块导出
 * 关联：对应样式 components/chatInput/ChatInput.module.css；只做类型声明。
 * 导出：样式模块的类名类型声明
 * 边界：只声明 styles.* 的类名类型；不产生运行时代码，也不参与样式生成。
 * ========================================================================== */

/* ---- 01 类名声明 ---- */
declare const styles: {
  readonly composer: string
  readonly holdButton: string
  readonly recordingCard: string
  readonly androidPreview: string
  readonly androidPreviewContent: string
  readonly quickSuggestions: string
  readonly quickSuggestionsClip: string
  readonly quickSuggestionsList: string
  readonly quickSuggestionSkeleton: string
  readonly wrapper: string
  readonly session: string
  readonly home: string
  readonly attachments: string
  readonly attachment: string
  readonly previewImage: string
  readonly remove: string
  readonly uploading: string
  readonly spin: string
  readonly failed: string
  readonly textareaWrapper: string
  readonly textarea: string
  readonly mirror: string
  readonly mirrorVisible: string
  readonly inputAside: string
  readonly textareaWithAside: string
  readonly functionRow: string
  readonly toggles: string
  readonly collapsedToggles: string
  readonly toggleLabel: string
  readonly toggle: string
  readonly selected: string
  readonly right: string
  readonly androidToolButton: string
  readonly sendButton: string
  readonly disabled: string
}
/* ---- 02 模块导出 ---- */
export = styles
