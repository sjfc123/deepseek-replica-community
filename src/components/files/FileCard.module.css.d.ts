/* ============================================================================
 * 功能区：视图与交互 / FileCard
 * 职责：FileCard 的 CSS Modules 类名类型声明，供 TypeScript 校验 styles.*；不产生运行时代码。
 * 分区：01 类名声明；02 模块导出
 * 关联：对应样式 components/files/FileCard.module.css；只做类型声明。
 * 导出：样式模块的类名类型声明
 * 边界：只声明 styles.* 的类名类型；不产生运行时代码，也不参与样式生成。
 * ========================================================================== */

/* ---- 01 类名声明 ---- */
declare const styles: {
  readonly "card": string;
  readonly "remove": string;
  readonly "clickable": string;
  readonly "editable": string;
  readonly "failed": string;
  readonly "icon": string;
  readonly "retry": string;
  readonly "spinner": string;
  readonly "spin": string;
  readonly "content": string;
  readonly "caption": string;
  readonly "subCaption": string;
  readonly "invalidRemove": string;
};
/* ---- 02 模块导出 ---- */
export = styles;
