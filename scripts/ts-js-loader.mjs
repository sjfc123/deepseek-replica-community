/**
 * 测试专用解析器：让 Node 的 --experimental-strip-types 能读取源码里的 `.js` 相对导入。
 * 只处理 src/ 内部的相对路径，命中同名 .ts 才改指；外部依赖保持原样。
 */
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.startsWith('.') &&
    specifier.endsWith('.js') &&
    context.parentURL?.includes('/src/')
  ) {
    const target = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL)
    try {
      await access(fileURLToPath(target))
      return { url: target.href, shortCircuit: true }
    } catch {
      // 没有同名 .ts 时退回默认解析，保持原有行为
    }
  }
  return nextResolve(specifier, context)
}
