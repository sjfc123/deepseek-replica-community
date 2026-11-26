/* ============================================================================
 * 功能区：视图与交互 / androidSettingsMotion · 设置页转场
 * 职责：设置页转场：页面切换动画、兼容路径与超时收尾。
 * 分区：01 类型、契约与依赖；02 对外入口与收尾
 * 关联：无内部依赖；被 components/settings/AndroidSettings 引用。
 * 导出：createSettingsPageMotion
 * 边界：只处理该组件的视图、交互状态与受控副作用；业务规则与持久化由 services 承担。
 * ========================================================================== */

/* ---- 01 类型、契约与依赖 ---- */
const timeline = 1000
const duration = 300
const handoff = 0.35
const distance = 40
const fadeOut = 'cubic-bezier(0.4, 0, 1, 1)'
const fadeIn = 'cubic-bezier(0.022, 0.021, 0.186, 1)'
const slideOut = 'cubic-bezier(0.415, 0, 0.63, 0.225)'
const slideIn = 'cubic-bezier(0.04, 0.085, 0.19, 1)'

type Direction = 'enter' | 'back'
type Property = 'backgroundColor' | 'opacity' | 'transform'
type Value = string | number

const firstPhase = (property: Property, from: Value, to: Value, easing: string): Keyframe[] => [
  { [property]: from, easing },
  { [property]: to, offset: handoff },
  { [property]: to },
]

const secondPhase = (property: Property, from: Value, to: Value, easing: string): Keyframe[] => [
  { [property]: from },
  { [property]: from, offset: handoff, easing },
  { [property]: to },
]

// 旧 WebView 可能没有 Animation.finished，动画也可能被系统挂起而永远不 settle。
// 超时按完成处理，页面的返回/进入不能因为一段装饰动画把交互锁死。
const SETTLE_TIMEOUT = duration * 2 + 150

const waitForAnimation = (animation: Animation): Promise<boolean> => {
  return new Promise<boolean>((resolve) => {
    let settled = false
    let timer = 0
    const cleanup = () => {
      if (timer) {
        window.clearTimeout(timer)
        timer = 0
      }
      animation.removeEventListener('finish', onFinish)
      animation.removeEventListener('cancel', onCancel)
    }
    const settle = (value: boolean) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(value)
    }
    const onFinish = () => settle(true)
    const onCancel = () => settle(false)

    timer = window.setTimeout(() => settle(true), SETTLE_TIMEOUT)

    // Animation.finished 从 Chrome 84 才有；有它时优先用它，避免旧事件漏发。
    if (animation.finished) {
      animation.finished.then(
        () => settle(true),
        () => settle(false)
      )
      return
    }
    if (animation.playState === 'finished') {
      settle(true)
      return
    }
    if (animation.playState === 'idle') {
      settle(false)
      return
    }
    animation.addEventListener('finish', onFinish)
    animation.addEventListener('cancel', onCancel)
  })
}

/* ---- 02 对外入口与收尾 ---- */
// A back gesture seeks through the same keyframes as a press of the back button.
export const createSettingsPageMotion = (
  page: HTMLElement,
  content: HTMLElement,
  previous: HTMLElement | null
) => {
  const timing = { duration: timeline, fill: 'both' } as const
  const right = `translateX(${distance}px)`
  const left = `translateX(${-distance}px)`
  const rest = 'translateX(0)'
  const background = 'var(--settings-bg)'
  // 旧内核或系统 WebView 被裁剪时可能没有 Web Animations；此时直接走无动画路径，
  // 不能让 back() 在 setExiting 之后因 animate 抛错而永久锁住设置页。
  const canAnimate =
    typeof page.animate === 'function' &&
    typeof content.animate === 'function' &&
    (!previous || typeof previous.animate === 'function')
  let animations: Animation[] = []
  let direction: Direction | undefined
  let playing = false

  const cancel = () => {
    for (const animation of animations) {
      animation.cancel()
    }
    animations = []
    direction = undefined
    playing = false
  }

  const prepare = (next: Direction) => {
    if (direction === next) {
      return
    }
    cancel()
    direction = next
    if (!canAnimate) {
      return
    }
    const returning = next === 'back'
    try {
      animations = [
        page.animate(
          returning
            ? secondPhase('backgroundColor', background, 'transparent', fadeIn)
            : firstPhase('backgroundColor', 'transparent', background, fadeOut),
          timing
        ),
        content.animate(
          returning ? firstPhase('opacity', 1, 0, fadeOut) : secondPhase('opacity', 0, 1, fadeIn),
          timing
        ),
        content.animate(
          returning
            ? firstPhase('transform', rest, right, slideOut)
            : secondPhase('transform', right, rest, slideIn),
          timing
        ),
      ]
      if (previous) {
        animations.push(
          previous.animate(
            returning
              ? secondPhase('transform', left, rest, slideIn)
              : firstPhase('transform', rest, left, slideOut),
            timing
          )
        )
      }
      for (const animation of animations) {
        animation.pause()
        animation.currentTime = 0
      }
    } catch {
      // 某些旧 WebView 的 animate 存在但会因属性或时序抛错；改用立即切换。
      for (const animation of animations) {
        animation.cancel()
      }
      animations = []
    }
  }

  return {
    seek(progress: number) {
      // 返回手势预览只负责拖动画面；正在执行的 play 不能被 pause，
      // 否则 Animation.finished 永远不结束，back() 的 exiting 锁不会释放。
      if (playing) {
        return
      }
      prepare('back')
      for (const animation of animations) {
        animation.pause()
        animation.currentTime = progress * timeline
      }
    },
    play(next: Direction) {
      prepare(next)
      if (!animations.length) {
        return Promise.resolve(true)
      }
      if (animations[0].currentTime === timeline) {
        return Promise.resolve(true)
      }
      playing = true
      for (const animation of animations) {
        animation.playbackRate = timeline / duration
        animation.play()
      }
      const done = waitForAnimation(animations[0])
      const release = () => {
        playing = false
      }
      done.then(release, release)
      return done
    },
    cancel,
  }
}

/* ============================================================================
 * 功能区：设置页 / androidSettingsMotion 结束
 * ========================================================================== */
