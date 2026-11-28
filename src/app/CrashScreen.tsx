/* ============================================================================
 * 功能区：应用外壳 / CrashScreen · 崩溃隔离页
 * 职责：崩溃隔离页：捕获渲染异常、展示诊断摘要并提供重新加载入口，避免整页白屏。
 * 分区：01 类型、契约与依赖；02 对外入口与收尾
 * 关联：依赖 app/CrashScreen.module；被 main 引用。
 * 导出：CrashScreen
 * 边界：只处理应用装配、生命周期、导航与全局视图；不实现聊天协议、持久化与业务算法。
 * ========================================================================== */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import styles from './CrashScreen.module.css'

/* ---- 01 类型、契约与依赖 ---- */
type Props = { children: ReactNode }
type State = { error: Error | null; info: string }

const ERROR_KEY = 'replica:last-render-error'

/* ---- 02 对外入口与收尾 ---- */
/**
 * 渲染异常接管组件。
 *
 * React 渲染阶段抛出未捕获异常时会卸载整棵树，界面停留在空白。
 * 本组件捕获该异常，展示可读的故障说明与「重新打开」操作，
 * 并将错误信息写入本机，供诊断信息复制使用。
 */
export class CrashScreen extends Component<Props, State> {
  override state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    const component = (info.componentStack ?? '').split('\n').slice(0, 4).join('\n').trim()
    this.setState({ info: component })
    try {
      localStorage.setItem(
        ERROR_KEY,
        JSON.stringify({
          at: Date.now(),
          message: error.message,
          stack: (error.stack ?? '').split('\n').slice(0, 6).join('\n'),
          component,
        })
      )
    } catch {
      /* 存不下也不影响这一页显示 */
    }
  }

  private reload = () => {
    window.location.reload()
  }

  private copy = async () => {
    const { error, info } = this.state
    const text = [
      `时间：${new Date().toLocaleString('zh-CN')}`,
      `错误：${error?.message ?? '未知'}`,
      info ? `组件：\n${info}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      this.setState({ info: `${info}\n（已复制，可粘贴到反馈中）` })
    } catch {
      this.setState({ info: `${info}\n（复制失败，可长按选中上方文字）` })
    }
  }

  override render() {
    const { error, info } = this.state
    if (!error) {
      return this.props.children
    }
    return (
      <div className={styles.screen}>
        <div className={styles.card}>
          <span className={styles.mark}>!</span>
          <h1>界面渲染失败</h1>
          <p>
            对话与设置仍保存在本机，不会因本页错误丢失。请先点击「重新打开」；若持续停在本页，
            请复制原因并反馈，避免直接清除应用数据。
          </p>
          <pre className={styles.detail}>{error.message || '未获取到具体错误信息'}</pre>
          {info ? <pre className={styles.stack}>{info}</pre> : null}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={this.reload}>
              重新打开
            </button>
            <button type="button" className={styles.ghost} onClick={() => void this.copy()}>
              复制原因
            </button>
          </div>
          <p className={styles.note}>
            清除应用数据可解决多数异常，但会删除本机全部对话，操作前请确认已有备份。
          </p>
        </div>
      </div>
    )
  }
}

/* ============================================================================
 * 功能区：应用外壳 / CrashScreen 结束
 * ========================================================================== */
