/* ============================================================================
 * 功能区：视图与交互 / AssistantMessage
 * 职责：AssistantMessage 的 CSS Modules 类名类型声明，供 TypeScript 校验 styles.*；
 *    不产生运行时代码。
 * 分区：01 类名声明；02 模块导出
 * 关联：对应样式 components/messages/AssistantMessage.module.css；只做类型声明。
 * 导出：样式模块的类名类型声明
 * 边界：只声明 styles.* 的类名类型；不产生运行时代码，也不参与样式生成。
 * ========================================================================== */

/* ---- 01 类名声明 ---- */
declare const styles: {
  readonly "message": string;
  readonly "selectable": string;
  readonly "selectableContent": string;
  readonly "menuAnchor": string;
  readonly "menuTrigger": string;
  readonly "actions": string;
  readonly "waiting": string;
  readonly "waitingDot": string;
  readonly "fading": string;
  readonly "notice": string;
  readonly "noticeAction": string;
  readonly "bottom": string;
  readonly "alwaysShow": string;
  readonly "regenerate": string;
  readonly "continueButton": string;
  readonly "summary": string;
  readonly "summaryActive": string;
};
/* ---- 02 模块导出 ---- */
export = styles;
