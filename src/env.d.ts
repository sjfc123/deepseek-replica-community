/* ============================================================================
 * 功能区：应用入口与共享契约 / env · 全局类型声明
 * 职责：全局类型声明：为资源导入与宿主环境补充 TypeScript 契约；不产生运行时代码。
 * 分区：01 资源模块声明；02 构建注入与宿主声明
 * 关联：独立模块，无内部依赖与内联引用。
 * 导出：全局模块与构建常量声明（无运行时导出）
 * 边界：只处理入口、全局类型与跨模块契约；不承载具体页面或业务实现。
 * ========================================================================== */

/* ---- 01 资源模块声明 ---- */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {}
declare module '*.svg' {
  const url: string
  export default url
}

declare module '*.png' {
  const url: string
  export default url
}

declare module '*.webp' {
  const url: string
  export default url
}

declare module '*.jpg' {
  const url: string
  export default url
}

/* ---- 02 构建注入与宿主声明 ---- */
/** 公开 API 的地址，见 rspack.config.ts 的 createConfig */
declare const __API_ORIGIN__: string

/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}
