/* ============================================================================
 * 功能区：视图与交互 / Button
 * 职责：Button 的 CSS Modules 类名类型声明，供 TypeScript 校验 styles.*；不产生运行时代码。
 * 分区：01 类名声明；02 模块导出
 * 关联：对应样式 components/base/Button.module.css；只做类型声明。
 * 导出：样式模块的类名类型声明
 * 边界：只声明 styles.* 的类名类型；不产生运行时代码，也不参与样式生成。
 * ========================================================================== */

/* ---- 01 类名声明 ---- */
declare const styles: {
  readonly "button": string;
  readonly "l": string;
  readonly "m": string;
  readonly "s": string;
  readonly "block": string;
  readonly "primary": string;
  readonly "outlined": string;
  readonly "danger": string;
  readonly "dangerOutlined": string;
};
/* ---- 02 模块导出 ---- */
export = styles;
