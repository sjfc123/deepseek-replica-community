/** 在不支持原生 inert（Chrome < 102）的 WebView 上同步属性与焦点移除。 */
export const setInert = (element: HTMLElement | null, inert: boolean) => {
  if (!element) {
    return
  }
  // 主内容区和根节点不允许整体 inert：抽屉/弹窗已有各自的遮罩与焦点处理，
  // 一旦状态错位，整页会变成「能滑动但点什么都点不动」。
  if (element.tagName === 'MAIN' || element.tagName === 'BODY') {
    return
  }
  element.inert = inert
  element.toggleAttribute('inert', inert)
  if (
    inert &&
    element.contains(document.activeElement) &&
    document.activeElement instanceof HTMLElement
  ) {
    document.activeElement.blur()
  }
}
