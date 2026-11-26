/* ============================================================================
 * 功能区：视图与交互 / JumpToBottomButton
 * 职责：JumpToBottomButton 的 CSS Modules 类名类型声明，供 TypeScript 校验 styles.*；
 *    不产生运行时代码。
 * 分区：01 类名声明；02 模块导出
 * 关联：对应样式 components/messages/JumpToBottomButton.module.css；只做类型声明。
 * 导出：样式模块的类名类型声明
 * 边界：只声明 styles.* 的类名类型；不产生运行时代码，也不参与样式生成。
 * ========================================================================== */

/* ---- 01 类名声明 ---- */
declare const styles: {
  readonly "button": string;
  readonly "hidden": string;
  readonly "streaming": string;
  readonly "pressOverlay": string;
  readonly "border": string;
  readonly "halo": string;
  readonly "haloVisible": string;
  readonly "haloSvg": string;
  readonly "icon": string;
};
/* ---- 02 模块导出 ---- */
export = styles;
