/* ============================================================================
 * 功能区：构建与打包 / rspack 配置
 * 职责：生成 Web、Android WebView 与开发服务器共用的 rspack 配置；固定目标浏览器、资源命名、模块转译、分包边界与静态资源复制规则。
 * 分区：01 运行模式、目标与常量；02 配置类型与工厂入口；03 模块解析与转译；04 插件、性能与开发服务器；05 默认导出
 * 关联：读取 package.json 版本、src/index.html、src/boot.js 与 src/assets；被 pnpm build 与 Android Gradle buildWeb 调用。
 * 导出：createConfig、默认配置实例
 * 边界：只定义构建行为与资源复制；不读取应用业务状态，不执行网络请求，不修改源码。
 * ========================================================================== */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rspack/cli'
import { rspack, type Configuration } from '@rspack/core'

/* ---- 01 运行模式、目标与常量 ---- */
const dev = process.env.NODE_ENV === 'development' || process.argv.includes('serve')
// The Android 10 test image ships with WebView 74 before system component updates.
const targets = ['chrome >= 74', 'edge >= 105', 'safari >= 16', 'firefox >= 110']
const root = path.dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string }

const cssLoader = {
  loader: 'builtin:lightningcss-loader',
  options: { targets },
}

/* ---- 02 配置类型与工厂入口 ---- */
type ConfigOptions = {
  /** 公开 API 的地址，注入为 __API_ORIGIN__ */
  apiOrigin?: string
  /** 开发服务器配置，支持本地接口代理 */
  devServer?: Configuration['devServer']
}

/** 创建构建配置，支持自定义 API 地址和开发服务器选项 */
export const createConfig = ({
  apiOrigin = 'https://api.deepseek.com',
  devServer,
}: ConfigOptions = {}): Configuration => ({
  mode: dev ? 'development' : 'production',
  target: `browserslist: ${targets.join(', ')}`,
  entry: './src/main.tsx',
  output: {
    path: path.resolve(root, 'dist'),
    // 运行时按当前脚本地址推导资源路径，file:// 下异步 chunk、字体都按相对位置加载
    publicPath: 'auto',
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/async/[name].[contenthash:8].js',
    cssFilename: 'static/css/[name].[contenthash:8].css',
    cssChunkFilename: 'static/css/async/[name].[contenthash:8].css',
    assetModuleFilename: 'static/media/[name].[contenthash:8][ext]',
    clean: true,
  },
  devtool: dev ? 'cheap-module-source-map' : false,
  // 开发模式预编译异步模块，保持首次加载代码高亮和公式时的页面状态
  lazyCompilation: false,
  optimization: {
    // 排查初始化顺序问题时可用 NO_MIN=1 保留可读变量名，其余优化不变
    minimize: process.env.NO_MIN !== '1',
    // 不把多个模块合并进同一作用域：任一模块初始化失败只影响它自己，
    // 不会让同片作用域里后续声明的变量停在未初始化状态。
    concatenateModules: false,
    splitChunks: {
      // Android 的本地资源拦截不覆盖 worker 内的 importScripts。
      chunks: (chunk) =>
        !chunk.canBeInitial() &&
        chunk.name !== 'markdown-parser' &&
        chunk.name !== 'history-import',
    },
  },
/* ---- 03 模块解析与转译 ---- */
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    // Markdown 的字符实体解码需要同时在页面和无 DOM 的 worker 中运行。
    conditionNames: ['worker', '...'],
    // 将 .js 导入路径解析到同名 .ts、.tsx 或 .js 文件
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    // CSS Modules 使用默认导出：`import styles from './x.module.css'`
    parser: { 'css/module': { namedExports: false } },
    generator: { 'css/module': { localIdentName: '[local]-[hash:6]' } },
    rules: [
      { test: /\.module\.css$/, type: 'css/module', use: [cssLoader] },
      { test: /\.css$/, exclude: /\.module\.css$/, type: 'css', use: [cssLoader] },
      {
        test: /\.(?:[cm]?js|jsx|tsx?)$/,
        exclude: /[\\/]node_modules[\\/]core-js[\\/]/,
        loader: 'builtin:swc-loader',
        options: {
          detectSyntax: 'auto',
          isModule: 'unknown',
          jsc: {
            transform: { react: { runtime: 'automatic', development: dev } },
            externalHelpers: true,
          },
          // 只做语法转译，不让 SWC 往模块初始化路径里插 core-js。
          // 旧内核上第三方 polyfill 自身抛错会打断整片模块初始化，
          // 表现为后续变量「Cannot access 'x' before initialization」。
          // 语言能力统一由 src/boot.js 与 src/utils/workerCompat.ts 用 ES5 补齐。
          env: { targets },
        },
        type: 'javascript/auto',
      },
      { test: /\.(woff2?|ttf)$/, type: 'asset/resource' },
      { test: /\.svg$/, type: 'asset/resource' },
      { test: /\.(png|webp|jpg|jpeg)$/, type: 'asset/resource' },
    ],
  },
/* ---- 04 插件、性能与开发服务器 ---- */
  plugins: [
    // 经典 defer 脚本支持 file:// 页面的资源加载
    new rspack.HtmlRspackPlugin({
      template: './src/index.html',
      scriptLoading: 'defer',
      meta: { 'application-version': version },
    }),
    new rspack.DefinePlugin({ __API_ORIGIN__: JSON.stringify(apiOrigin) }),
    new rspack.CopyRspackPlugin({
      patterns: [
        { from: path.resolve(root, 'LICENSE'), to: 'LICENSE', toType: 'file' },
        // 启动保护脚本放在固定路径，先于主包执行，失败时显示原因而不是白屏
        { from: path.resolve(root, 'src/boot.js'), to: 'static/js/boot.js', toType: 'file' },
        { from: path.resolve(root, 'src/assets/favicon.png'), to: 'favicon.png', toType: 'file' },
        { from: path.resolve(root, 'src/assets/apple-touch-icon.png'), to: 'apple-touch-icon.png', toType: 'file' },
      ],
    }),
  ],
  performance: { hints: false },
  devServer: { port: 8090, ...devServer },
})

/* ---- 05 默认导出 ---- */
// eslint-disable-next-line import/no-default-export
export default defineConfig(createConfig())
