/* ============================================================================
 * 功能区：视图与交互 / ReplyArea
 * 职责：ReplyArea 的 CSS Modules 类名类型声明，供 TypeScript 校验 styles.*；不产生运行时代码。
 * 分区：01 类名声明；02 模块导出
 * 关联：对应样式 components/messages/ReplyArea.module.css；只做类型声明。
 * 导出：样式模块的类名类型声明
 * 边界：只声明 styles.* 的类名类型；不产生运行时代码，也不参与样式生成。
 * ========================================================================== */

/* ---- 01 类名声明 ---- */
declare const styles: {
  readonly "area": string;
  readonly "title": string;
  readonly "titleIcon": string;
  readonly "stoppedIcon": string;
  readonly "titleText": string;
  readonly "shimmer": string;
  readonly "withLine": string;
  readonly "content": string;
  readonly "lastItem": string;
  readonly "dot": string;
  readonly "dotInner": string;
  readonly "pulse": string;
  readonly "inactive": string;
  readonly "rowIcon": string;
  readonly "row": string;
  readonly "clickable": string;
  readonly "active": string;
  readonly "prefix": string;
  readonly "summary": string;
  readonly "query": string;
  readonly "fadeIn": string;
  readonly "tool": string;
  readonly "toolIcon": string;
  readonly "toolBody": string;
  readonly "intro": string;
  readonly "page": string;
  readonly "pageText": string;
  readonly "pageIcon": string;
  readonly "pageDone": string;
  readonly "pageFailed": string;
  readonly "chip": string;
  readonly "chipFailed": string;
  readonly "chipIcon": string;
  readonly "chipText": string;
};
/* ---- 02 模块导出 ---- */
export = styles;
