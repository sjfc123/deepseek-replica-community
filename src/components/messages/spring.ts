/** 临界阻尼弹簧的当前位置与速度状态 */
export type SpringState = {
  value: number
  velocity: number
}

/**
 * 以解析闭式计算临界阻尼弹簧（dampingRatio = 1.0）在时间步长内的下一状态。
 * 无论帧间隔是否波动都保持数值稳定。
 */
export const stepCriticallyDampedSpring = (
  state: SpringState,
  target: number,
  stiffness: number,
  dtSeconds: number
): SpringState => {
  const omega = Math.sqrt(stiffness)
  const displacement = state.value - target
  const decay = Math.exp(-omega * dtSeconds)
  return {
    value: target + (displacement + (state.velocity + omega * displacement) * dtSeconds) * decay,
    velocity:
      (state.velocity - (state.velocity + omega * displacement) * omega * dtSeconds) * decay,
  }
}

/** 检查系统是否开启了减弱动态效果偏好 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
