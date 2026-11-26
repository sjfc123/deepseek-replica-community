/* ============================================================================
 * 功能区：视图与交互 / MessageList
 * 职责：MessageList 的 CSS Modules 类名类型声明，供 TypeScript 校验 styles.*；不产生运行时代码。
 * 分区：01 类名声明；02 模块导出
 * 关联：对应样式 components/messages/MessageList.module.css；只做类型声明。
 * 导出：样式模块的类名类型声明
 * 边界：只声明 styles.* 的类名类型；不产生运行时代码，也不参与样式生成。
 * ========================================================================== */

/* ---- 01 类名声明 ---- */
declare const styles: {
  readonly "container": string;
  readonly "scrollArea": string;
  readonly "scroll": string;
  readonly "mobileJumpSlot": string;
  readonly "desktopFooter": string;
  readonly "desktopJumpSlot": string;
  readonly "column": string;
  readonly "memorySelectRow": string;
  readonly "memorySelectMark": string;
  readonly "memoryBar": string;
  readonly "memoryBarInfo": string;
  readonly "memoryBarButton": string;
  readonly "memoryBarSecondary": string;
  readonly "memoryBarPrimary": string;
  readonly "memoryConfirmBackdrop": string;
  readonly "memoryConfirmCard": string;
  readonly "memoryConfirmTitle": string;
  readonly "memoryConfirmText": string;
  readonly "memoryConfirmActions": string;
  readonly "memoryConfirmCancel": string;
  readonly "memoryConfirmPrimary": string;
};
/* ---- 02 模块导出 ---- */
export = styles;
