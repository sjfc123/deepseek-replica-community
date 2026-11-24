/* ============================================================================
 * 功能区：输入与语音控件 / voiceMaskShader 开始
 * 职责：语音遮罩着色器：WebGL 波纹与音量驱动的片元计算。
 * 导出：VoiceTouchPoint、VoiceMaskFrame、VoiceMaskRenderer、createVoiceMaskRenderer。
 * ========================================================================== */

import { stepCriticallyDampedSpring, type SpringState } from '../messages/spring.js'

/**
 * 复刻官方 com.deepseek.chat v2.8.0 的 res/raw/voice_mask.agsl 着色器（兼容 WebGL 1.0 / GLSL ES 1.00）。
 * 绘制底部弧形波纹光幕、随手指移动的高斯光晕与圆柱绕流焦散，并在上滑取消时平滑过渡为警示红。
 */
const VERTEX_SHADER = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
precision highp float;

uniform vec4 focusColor;
uniform vec4 cancelColor;
uniform vec2 resolution;
uniform vec2 touch;
uniform float time;
uniform float glow;
uniform float cancelMix;
uniform float intensity;
uniform float spacingPx;
uniform float pixelScale;
uniform float audioLevel;
uniform float breathLevel;
uniform float cancelAlphaScale;
uniform float baselineOffset;
uniform float entranceScale;
uniform float arcRadius;
uniform float flowOffsetPx;
uniform float darkAppearance;
uniform float vmAudioLift;
uniform vec2 vmBufferSize;
uniform float vmOffsetY;

float vmArcHeight(vec2 px) {
  float halfWidth = resolution.x * 0.5;
  float x = clamp(px.x - halfWidth, -halfWidth, halfWidth);
  float root = sqrt(max(arcRadius * arcRadius - x * x, 0.0));
  float arcDrop = x * x / (arcRadius + root);
  float audioLift = vmAudioLift * breathLevel * mix(1.0, 0.25, cancelMix);
  float height = (px.y - arcDrop - 4.0 * pixelScale + baselineOffset) / max(resolution.y, 1.0);
  return mix(1.0, height + audioLift, entranceScale);
}

vec2 vmFlowCoords(vec2 px, vec2 touchPos, vec2 flowDir, float R, float strength) {
  vec2 nrm = vec2(-flowDir.y, flowDir.x);
  vec2 base = vec2(dot(px, flowDir), dot(px, nrm));
  vec2 rel = px - touchPos;
  float zr = dot(rel, flowDir);
  float zi = dot(rel, nrm);
  float r2 = max(zr * zr + zi * zi, max(R * R, 1.0));
  float k = R * R / r2 * strength;
  return base + vec2(zr * k, -zi * k);
}

float vmCaustic(vec2 fp, float cellPx, float t) {
  vec2 p = fp / cellPx;
  vec2 ip = p;
  float c = 1.0;
  for (int n = 0; n < 3; n++) {
    float tt = t * 0.55 * (1.0 - 3.5 / float(n + 1));
    ip = p + vec2(
      cos(tt - ip.x) + sin(tt + ip.y),
      sin(tt - ip.y) + cos(tt + ip.x)
    );
    c += 1.0 / max(length(vec2(
      p.x / max(abs(sin(ip.x + tt)), 1e-4),
      p.y / max(abs(cos(ip.y + tt)), 1e-4)
    )), 1e-4);
  }
  c /= 3.0;
  c = 1.17 - pow(max(c, 1e-4), 1.4);
  return min(pow(max(abs(c), 1e-4), 8.0) * 1.5, 1.2);
}

vec4 vmMain(vec2 px) {
  if (intensity <= 0.0) return vec4(0.0);
  vec2 res = max(resolution, vec2(1.0));
  float minDim = min(res.x, res.y);
  float t = time;

  vec3 focusRGB = mix(focusColor.rgb, cancelColor.rgb, cancelMix);

  float arcY = vmArcHeight(px);
  if (arcY <= 0.605) return vec4(0.0);

  float wash = smoothstep(0.605, 0.97, arcY);
  float envelope = smoothstep(0.64, 0.85, arcY);

  vec2 rel = px - touch;
  float dist = length(rel);
  float sigma = minDim * 0.32;
  float halo = exp(-dist * dist / max(2.0 * sigma * sigma, 1.0)) * glow;
  halo *= 1.0 + 0.05 * sin(t * 2.1);
  float touchArcY = vmArcHeight(touch);
  float touchIn = smoothstep(0.59, 0.80, touchArcY);
  float touchDepth = smoothstep(0.75, 1.0, touchArcY);
  halo *= envelope * touchIn * mix(0.80, 1.0, touchDepth);
  halo *= mix(1.0, 0.2, cancelMix);

  float presence = clamp(wash * 0.85 + halo * 1.15, 0.0, 1.0) * envelope;

  float cellSpacing = max(spacingPx, 6.0);
  vec2 flowDir = normalize(vec2(0.72, -0.70));
  float maxRockR = minDim * 0.22;
  float rockR = maxRockR * glow;
  float warpStrength = glow * glow * glow;
  vec2 fp = vmFlowCoords(px, touch, flowDir, maxRockR, warpStrength);
  fp += vec2(flowDir.y, flowDir.x) * flowOffsetPx;
  float rockFeather = maxRockR * mix(0.95, 0.55, glow);
  float rockMask = mix(
    1.0,
    smoothstep(rockR * 0.5, rockR * 0.5 + rockFeather, dist),
    glow
  );

  vec2 flowNormal = vec2(-flowDir.y, flowDir.x);
  vec2 texturePx = flowDir * fp.x + flowNormal * fp.y;
  texturePx.x = mix(res.x * 0.5, texturePx.x, 0.45);
  vec2 rippleCoords = vec2(dot(texturePx, flowDir), dot(texturePx, flowNormal));

  float detail = vmCaustic(rippleCoords, cellSpacing * 8.0, t);
  if (audioLevel > 0.001) {
    vec2 speechPx = texturePx;
    speechPx.y = mix(res.y, speechPx.y, 1.6);
    vec2 speechCoords = vec2(dot(speechPx, flowDir), dot(speechPx, flowNormal));
    float speechDetail = vmCaustic(speechCoords, cellSpacing * 8.0, t);
    detail = max(detail, speechDetail * (0.65 * audioLevel));
  }
  detail *= mix(1.0, 0.8, cancelMix);
  detail *= presence * rockMask;
  float strongVoice = smoothstep(0.40, 1.0, audioLevel);
  detail *= 1.0 + 0.40 * audioLevel + 0.25 * strongVoice;

  float detailAlpha = mix(0.50, 0.34 + 0.04 * audioLevel * (1.0 - cancelMix), darkAppearance);
  float maxBaseAlpha = mix(0.88, 0.76, darkAppearance);
  float baseAlpha = min(wash * 0.42 + detail * detailAlpha, maxBaseAlpha);
  float alpha = mix(baseAlpha, mix(0.82, 1.0, darkAppearance), clamp(halo, 0.0, 1.0)) * intensity;
  alpha *= mix(0.78, 1.0, darkAppearance);
  alpha *= mix(1.0, cancelAlphaScale, cancelMix);

  vec3 detailRGB = mix(
    vec3(0.188, 0.439, 0.820),
    vec3(0.792, 0.306, 0.306),
    cancelMix
  );
  detailRGB = mix(detailRGB, vec3(1.0), 0.08);
  vec3 color = mix(
    focusRGB,
    detailRGB,
    clamp(detail * 0.65, 0.0, 0.70) * darkAppearance
  );

  return vec4(color * alpha, alpha);
}

void main() {
  vec2 localPx = vec2(gl_FragCoord.x, vmBufferSize.y - gl_FragCoord.y);
  vec2 px = vec2(
    localPx.x * (resolution.x / max(vmBufferSize.x, 1.0)),
    vmOffsetY + localPx.y * ((resolution.y - vmOffsetY) / max(vmBufferSize.y, 1.0))
  );
  gl_FragColor = vmMain(px);
}
`

export type VoiceTouchPoint = { x: number; y: number }

export type VoiceMaskFrame = {
  dt: number
  audioLevel: number
  canceling: boolean
  touch: VoiceTouchPoint | null
  dark: boolean
  reducedMotion: boolean
  fullWidth: number
  fullHeight: number
  canvasHeight: number
  dpr: number
}

const smoothFactor = (dt: number, rate: number) => 1 - Math.exp(-rate * dt)

/** 与官方 Lgn8.y 一致的底部圆弧半径公式。 */
const computeArcRadius = (width: number, height: number) => {
  const halfW = Math.max(width * 0.5, 1)
  const sag = Math.max(Math.min(height * 0.06, halfW * 0.5), 1)
  return Math.hypot(halfW, (halfW * halfW) / (2 * sag))
}

const targetFlowSpeed = (level: number) => {
  if (level < 0.1) {
    return (level / 0.1) * 120
  }
  if (level < 0.25) {
    return 120 + ((level - 0.1) / 0.15) * 80
  }
  return 200 + ((level - 0.25) / 0.75) * 160
}

type UniformLocations = {
  focusColor: WebGLUniformLocation | null
  cancelColor: WebGLUniformLocation | null
  resolution: WebGLUniformLocation | null
  touch: WebGLUniformLocation | null
  time: WebGLUniformLocation | null
  glow: WebGLUniformLocation | null
  cancelMix: WebGLUniformLocation | null
  intensity: WebGLUniformLocation | null
  spacingPx: WebGLUniformLocation | null
  pixelScale: WebGLUniformLocation | null
  audioLevel: WebGLUniformLocation | null
  breathLevel: WebGLUniformLocation | null
  cancelAlphaScale: WebGLUniformLocation | null
  baselineOffset: WebGLUniformLocation | null
  entranceScale: WebGLUniformLocation | null
  arcRadius: WebGLUniformLocation | null
  flowOffsetPx: WebGLUniformLocation | null
  darkAppearance: WebGLUniformLocation | null
  vmAudioLift: WebGLUniformLocation | null
  vmBufferSize: WebGLUniformLocation | null
  vmOffsetY: WebGLUniformLocation | null
}

const compileShader = (gl: WebGLRenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)
  if (!shader) {
    return null
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

export type VoiceMaskRenderer = {
  reset: (initialTouch?: VoiceTouchPoint | null, dpr?: number) => void
  render: (frame: VoiceMaskFrame) => boolean
  destroy: () => void
}

export const createVoiceMaskRenderer = (canvas: HTMLCanvasElement): VoiceMaskRenderer | null => {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  })
  if (!gl) {
    return null
  }

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (!vs || !fs) {
    if (vs) {
      gl.deleteShader(vs)
    }
    if (fs) {
      gl.deleteShader(fs)
    }
    return null
  }

  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    return null
  }
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }

  const buffer = gl.createBuffer()
  if (!buffer) {
    gl.deleteProgram(program)
    return null
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

  const positionLoc = gl.getAttribLocation(program, 'position')
  if (positionLoc < 0) {
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    return null
  }

  const uniforms: UniformLocations = {
    focusColor: gl.getUniformLocation(program, 'focusColor'),
    cancelColor: gl.getUniformLocation(program, 'cancelColor'),
    resolution: gl.getUniformLocation(program, 'resolution'),
    touch: gl.getUniformLocation(program, 'touch'),
    time: gl.getUniformLocation(program, 'time'),
    glow: gl.getUniformLocation(program, 'glow'),
    cancelMix: gl.getUniformLocation(program, 'cancelMix'),
    intensity: gl.getUniformLocation(program, 'intensity'),
    spacingPx: gl.getUniformLocation(program, 'spacingPx'),
    pixelScale: gl.getUniformLocation(program, 'pixelScale'),
    audioLevel: gl.getUniformLocation(program, 'audioLevel'),
    breathLevel: gl.getUniformLocation(program, 'breathLevel'),
    cancelAlphaScale: gl.getUniformLocation(program, 'cancelAlphaScale'),
    baselineOffset: gl.getUniformLocation(program, 'baselineOffset'),
    entranceScale: gl.getUniformLocation(program, 'entranceScale'),
    arcRadius: gl.getUniformLocation(program, 'arcRadius'),
    flowOffsetPx: gl.getUniformLocation(program, 'flowOffsetPx'),
    darkAppearance: gl.getUniformLocation(program, 'darkAppearance'),
    vmAudioLift: gl.getUniformLocation(program, 'vmAudioLift'),
    vmBufferSize: gl.getUniformLocation(program, 'vmBufferSize'),
    vmOffsetY: gl.getUniformLocation(program, 'vmOffsetY'),
  }

  let lost = false
  const onLost = (event: Event) => {
    event.preventDefault()
    lost = true
  }
  canvas.addEventListener('webglcontextlost', onLost)

  // 状态字段与官方 Ln1c 一一对应
  let entranceSpring: SpringState = { value: 0.8, velocity: 0 }
  let breathSpring: SpringState = { value: 0, velocity: 0 }
  let smoothedAudio = 0
  let shaderTime = 0
  let flowOffset = 0
  let flowSpeed = 0
  let touchX = 0
  let touchY = 0
  let glow = 0
  let cancelMix = 0

  const reset = (initialTouch?: VoiceTouchPoint | null, dpr = 1) => {
    entranceSpring = { value: 0.8, velocity: 0 }
    breathSpring = { value: 0, velocity: 0 }
    smoothedAudio = 0
    flowSpeed = 0
    glow = 0
    cancelMix = 0
    if (initialTouch) {
      touchX = initialTouch.x * dpr
      touchY = initialTouch.y * dpr
    }
  }

  const render = (frame: VoiceMaskFrame) => {
    if (lost || gl.isContextLost()) {
      return false
    }
    const dt = Number.isFinite(frame.dt) ? Math.max(0, Math.min(0.1, frame.dt)) : 0
    const rawLevel = Math.max(
      0,
      Math.min(1, Number.isFinite(frame.audioLevel) ? frame.audioLevel : 0)
    )
    const dpr = Math.max(1, frame.dpr)
    const resW = Math.max(1, frame.fullWidth * dpr)
    const resH = Math.max(1, frame.fullHeight * dpr)
    const canvasH = Math.max(1, Math.min(frame.canvasHeight, frame.fullHeight))
    const offsetY = Math.max(0, (frame.fullHeight - canvasH) * dpr)

    // 半分辨率光栅缓冲（对齐官方 vmBufferSize 机制），平板高分屏下显著降低片元开销
    const bufferScale = Math.min(dpr, 2) * 0.5
    const bufW = Math.max(1, Math.round(frame.fullWidth * bufferScale))
    const bufH = Math.max(1, Math.round(canvasH * bufferScale))
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW
      canvas.height = bufH
    }

    const hasTouch =
      frame.touch !== null && Number.isFinite(frame.touch.x) && Number.isFinite(frame.touch.y)
    if (frame.reducedMotion) {
      entranceSpring = { value: 1, velocity: 0 }
      breathSpring = { value: 0, velocity: 0 }
      smoothedAudio = 0
      cancelMix = frame.canceling ? 1 : 0
      glow = 0
    } else {
      entranceSpring = stepCriticallyDampedSpring(entranceSpring, 1, 140, dt)
      smoothedAudio +=
        (rawLevel - smoothedAudio) * smoothFactor(dt, rawLevel > smoothedAudio ? 24 : 8)
      breathSpring = stepCriticallyDampedSpring(breathSpring, rawLevel, 90, dt)
      if (breathSpring.value < 0) {
        breathSpring = { value: 0, velocity: Math.max(0, breathSpring.velocity) }
      }

      const cancelDamp = 1 - 0.8 * cancelMix
      shaderTime += dt * 1.1 * (1 + 0.5 * Math.pow(smoothedAudio, 1.5)) * cancelDamp

      const targetSpeed = targetFlowSpeed(rawLevel)
      flowSpeed += (targetSpeed - flowSpeed) * smoothFactor(dt, targetSpeed > flowSpeed ? 30 : 3.5)
      flowOffset += dt * flowSpeed * cancelDamp

      if (hasTouch && frame.touch) {
        const tx = frame.touch.x * dpr
        const ty = frame.touch.y * dpr
        const factor = glow < 0.02 ? 1 : smoothFactor(dt, 24)
        touchX += (tx - touchX) * factor
        touchY += (ty - touchY) * factor
      }

      glow += ((hasTouch ? 1 : 0) - glow) * smoothFactor(dt, hasTouch ? 18 : 6)
      cancelMix += ((frame.canceling ? 1 : 0) - cancelMix) * smoothFactor(dt, 10)
    }

    gl.viewport(0, 0, bufW, bufH)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(positionLoc)
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)

    const entranceScale = 1 / Math.max(0.01, entranceSpring.value)
    gl.uniform4f(uniforms.focusColor, 0, 0.4, 1, 1)
    if (frame.dark) {
      gl.uniform4f(uniforms.cancelColor, 1, 101 / 255, 101 / 255, 1)
    } else {
      gl.uniform4f(uniforms.cancelColor, 1, 77 / 255, 77 / 255, 1)
    }
    gl.uniform2f(uniforms.resolution, resW, resH)
    gl.uniform2f(uniforms.touch, touchX, touchY)
    gl.uniform1f(uniforms.time, shaderTime)
    gl.uniform1f(uniforms.glow, glow)
    gl.uniform1f(uniforms.cancelMix, cancelMix)
    gl.uniform1f(uniforms.intensity, 1)
    gl.uniform1f(uniforms.spacingPx, 13 * dpr)
    gl.uniform1f(uniforms.pixelScale, dpr)
    gl.uniform1f(uniforms.audioLevel, smoothedAudio)
    gl.uniform1f(uniforms.breathLevel, breathSpring.value)
    gl.uniform1f(uniforms.cancelAlphaScale, frame.dark ? 0.9 : 0.7)
    gl.uniform1f(uniforms.baselineOffset, 0)
    gl.uniform1f(uniforms.entranceScale, entranceScale)
    gl.uniform1f(uniforms.arcRadius, computeArcRadius(resW, resH))
    gl.uniform1f(uniforms.flowOffsetPx, flowOffset * dpr)
    gl.uniform1f(uniforms.darkAppearance, frame.dark ? 1 : 0)
    gl.uniform1f(uniforms.vmAudioLift, 0.1)
    gl.uniform2f(uniforms.vmBufferSize, bufW, bufH)
    gl.uniform1f(uniforms.vmOffsetY, offsetY)

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return true
  }

  const destroy = () => {
    canvas.removeEventListener('webglcontextlost', onLost)
    if (!gl.isContextLost()) {
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }

  return { reset, render, destroy }
}

/* ============================================================================
 * 功能区：输入与语音控件 / voiceMaskShader 结束
 * ========================================================================== */
