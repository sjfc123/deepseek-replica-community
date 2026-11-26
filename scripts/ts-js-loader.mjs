/* ============================================================================
 * 功能区：回归与构建辅助 / ts-js-loader · TypeScript 源码加载器
 * 职责：TypeScript 源码加载器：为 Node 回归脚本注册 ESM 解析钩子，使 .js 导入映射到 .ts。
 * 分区：01 夹具与固定输入；02 验证场景；03 断言与清理
 * 关联：被测或辅助模块 无；由 pnpm 脚本直接执行。
 * 导出：resolve
 * 边界：只执行回归、构建与像素比对；不写入产品数据，临时目录在结束时清理。
 * ========================================================================== */

/**
 * 测试专用解析器：让 Node 的 --experimental-strip-types 能读取源码里的 `.js` 相对导入。
 * 只处理 src/ 内部的相对路径，命中同名 .ts 才改指；外部依赖保持原样。
 */
/* ---- 01 夹具与固定输入 ---- */
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if (
/* ---- 02 验证场景 ---- */
    specifier.startsWith('.') &&
    specifier.endsWith('.js') &&
    context.parentURL?.includes('/src/')
  ) {
    const target = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL)
    try {
      await access(fileURLToPath(target))
      return { url: target.href, shortCircuit: true }
    } catch {
/* ---- 03 断言与清理 ---- */
      // 没有同名 .ts 时退回默认解析，保持原有行为
    }
  }
  return nextResolve(specifier, context)
}
