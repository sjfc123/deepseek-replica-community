/* ============================================================================
 * 功能区：应用外壳 / CrashScreen 开始
 * 职责：崩溃兜底：捕获渲染异常并展示诊断页，避免白屏。
 * 导出：CrashScreen。
 * ========================================================================== */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import styles from './CrashScreen.module.css'

type Props = { children: ReactNode }
type State = { error: Error | null; info: string }

const ERROR_KEY = 'replica:last-render-error'

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
      this.setState({ info: `${info}\n（已复制，可直接粘贴反馈）` })
    } catch {
      this.setState({ info: `${info}\n（复制失败，可长按选中上面的文字）` })
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
          <h1>界面这次没画出来</h1>
          <p>
            对话和设置都还在本机，没有丢。先点下面的「重新打开」；如果反复停在这一页，
            把原因复制出来反馈，比直接清数据更能保住记录。
          </p>
          <pre className={styles.detail}>{error.message || '没有拿到具体原因'}</pre>
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
            清除应用数据能解决大部分异常，但会删掉本机全部对话，请先确认已有备份。
          </p>
        </div>
      </div>
    )
  }
}

/* ============================================================================
 * 功能区：应用外壳 / CrashScreen 结束
 * ========================================================================== */
