/* ============================================================================
 * 功能区：视图与交互 / Sider
 * 职责：Sider 的 CSS Modules 类名类型声明，供 TypeScript 校验 styles.*；不产生运行时代码。
 * 分区：01 类名声明；02 模块导出
 * 关联：对应样式 components/sider/Sider.module.css；只做类型声明。
 * 导出：样式模块的类名类型声明
 * 边界：只声明 styles.* 的类名类型；不产生运行时代码，也不参与样式生成。
 * ========================================================================== */

/* ---- 01 类名声明 ---- */
declare const styles: {
  readonly "sider": string;
  readonly "top": string;
  readonly "appName": string;
  readonly "newChat": string;
  readonly "newChatIcon": string;
  readonly "listWrap": string;
  readonly "list": string;
  readonly "section": string;
  readonly "sectionHeader": string;
  readonly "bottom": string;
  readonly "settings": string;
  readonly "settingsLabel": string;
  readonly "collapsed": string;
  readonly "collapsedGroup": string;
  readonly "drawer": string;
  readonly "drawerMask": string;
  readonly "mobile": string;
};
/* ---- 02 模块导出 ---- */
export = styles;
