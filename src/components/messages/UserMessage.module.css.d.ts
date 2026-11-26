/* ============================================================================
 * 功能区：视图与交互 / UserMessage
 * 职责：UserMessage 的 CSS Modules 类名类型声明，供 TypeScript 校验 styles.*；不产生运行时代码。
 * 分区：01 类名声明；02 模块导出
 * 关联：对应样式 components/messages/UserMessage.module.css；只做类型声明。
 * 导出：样式模块的类名类型声明
 * 边界：只声明 styles.* 的类名类型；不产生运行时代码，也不参与样式生成。
 * ========================================================================== */

/* ---- 01 类名声明 ---- */
declare const styles: {
  readonly "container": string;
  readonly "isFirst": string;
  readonly "actions": string;
  readonly "files": string;
  readonly "filesWithDocuments": string;
  readonly "bubble": string;
  readonly "bubbleText": string;
  readonly "bubbleAside": string;
  readonly "menuAnchor": string;
  readonly "menuCopyIcon": string;
  readonly "menuTrigger": string;
  readonly "bottom": string;
  readonly "alwaysShow": string;
  readonly "editor": string;
  readonly "textarea": string;
  readonly "editorActions": string;
};
/* ---- 02 模块导出 ---- */
export = styles;
