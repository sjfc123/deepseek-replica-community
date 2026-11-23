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

const waitForAnimation = (animation: Animation): Promise<boolean> => {
  // Animation.finished landed in Chrome 84; fall back to Web Animations events on older WebView.
  if (animation.finished) {
    return animation.finished.then(
      () => true,
      () => false
    )
  }
  if (animation.playState === 'finished') {
    return Promise.resolve(true)
  }
  if (animation.playState === 'idle') {
    return Promise.resolve(false)
  }
  return new Promise<boolean>((resolve) => {
    const cleanup = () => {
      animation.removeEventListener('finish', onFinish)
      animation.removeEventListener('cancel', onCancel)
    }
    const onFinish = () => {
      cleanup()
      resolve(true)
    }
    const onCancel = () => {
      cleanup()
      resolve(false)
    }
    animation.addEventListener('finish', onFinish)
    animation.addEventListener('cancel', onCancel)
  })
}

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
  let animations: Animation[] = []
  let direction: Direction | undefined

  const cancel = () => {
    for (const animation of animations) {
      animation.cancel()
    }
    animations = []
    direction = undefined
  }

  const prepare = (next: Direction) => {
    if (direction === next) {
      return
    }
    cancel()
    direction = next
    const returning = next === 'back'
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
  }

  return {
    seek(progress: number) {
      prepare('back')
      for (const animation of animations) {
        animation.pause()
        animation.currentTime = progress * timeline
      }
    },
    play(next: Direction) {
      prepare(next)
      if (animations[0].currentTime === timeline) {
        return Promise.resolve(true)
      }
      for (const animation of animations) {
        animation.playbackRate = timeline / duration
        animation.play()
      }
      return waitForAnimation(animations[0])
    },
    cancel,
  }
}
