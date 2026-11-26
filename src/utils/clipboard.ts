/* ============================================================================
 * 功能区：公共工具 / clipboard · 剪贴板工具
 * 职责：剪贴板工具：优先异步 API，失败时退回兼容实现。
 * 分区：01 实现：copyText
 * 关联：无内部依赖；
 *    被 components/markdown/CodeBlock、components/messages/AndroidTextSelection、components/messages/AssistantMessage、components/messages/CopyButton 等 5 个模块 引用。
 * 导出：copyText
 * 边界：只提供纯函数与浏览器能力封装；不读取应用状态，不产生网络请求。
 * ========================================================================== */

/* ---- 01 实现：copyText ---- */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Clipboard API 被权限策略拒绝时改用隐藏文本域选中复制。
  }

  // 局域网 HTTP 不属于安全上下文，navigator.clipboard 不可用，需要走 execCommand 路径。
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px'

  try {
    document.body.appendChild(textarea)
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

/* ============================================================================
 * 功能区：通用工具 / clipboard 结束
 * ========================================================================== */
