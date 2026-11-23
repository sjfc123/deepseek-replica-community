import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const run = (program, args, maxBuffer = 1024 * 1024) => {
  const result = spawnSync(program, args, { maxBuffer, windowsHide: true })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.toString().trim() || `${program} exited with ${result.status}`)
  }
  return result.stdout
}

const dimensions = (file) => {
  const output = run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'json',
    file,
  ])
  const [stream] = JSON.parse(output.toString()).streams
  if (!stream?.width || !stream?.height) {
    throw new Error(`No image or video stream in ${file}`)
  }
  return stream
}

const numbers = (value, count) => {
  const parts = value.split(',')
  const integers = parts.map(Number)
  if (
    integers.length !== count ||
    parts.some((part) => !/^\d+$/.test(part)) ||
    !integers.every(Number.isSafeInteger)
  ) {
    throw new Error(`Expected ${count} nonnegative integers and received ${value}`)
  }
  return integers
}

const frame = (file, index, { x, y, width, height }) => {
  const bytes = width * height * 3
  const pixels = run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-noautorotate',
      '-i',
      file,
      '-map',
      '0:v:0',
      '-vf',
      `select=eq(n\\,${index}),format=rgb24,crop=${width}:${height}:${x}:${y}:exact=1`,
      '-frames:v',
      '1',
      '-threads',
      '1',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    bytes + 65536
  )
  if (pixels.length !== bytes) {
    throw new Error(`Frame ${index} could not be decoded from ${file}`)
  }
  return pixels
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { crop: { type: 'string' }, frames: { type: 'string', default: '0,0' } },
  })
  if (positionals.length !== 2) {
    throw new Error(
      'Usage: node scripts/compare-pixels.mjs REF ACTUAL [--crop x,y,w,h] [--frames ref,actual]'
    )
  }
  const [reference, replica] = positionals.map((file) => resolve(file))
  const size = dimensions(reference)
  const actualSize = dimensions(replica)
  if (actualSize.width !== size.width || actualSize.height !== size.height) {
    throw new Error('Capture dimensions must match')
  }
  const [x, y, width, height] = values.crop
    ? numbers(values.crop, 4)
    : [0, 0, size.width, size.height]
  if (!width || !height || x + width > size.width || y + height > size.height) {
    throw new Error('Crop is outside the capture')
  }
  const crop = { x, y, width, height }
  const [first, second] = numbers(values.frames, 2)
  const expected = frame(reference, first, crop)
  const actual = frame(replica, second, crop)
  let changed = 0
  let maxChannelDelta = 0
  let totalChannelDelta = 0
  let left = x + width
  let right = x
  let top = y + height
  let bottom = y
  for (let offset = 0; offset < expected.length; offset += 3) {
    const r = Math.abs(expected[offset] - actual[offset])
    const g = Math.abs(expected[offset + 1] - actual[offset + 1])
    const b = Math.abs(expected[offset + 2] - actual[offset + 2])
    if (r || g || b) {
      changed += 1
      maxChannelDelta = Math.max(maxChannelDelta, r, g, b)
      totalChannelDelta += r + g + b
      const column = x + ((offset / 3) % width)
      const row = y + Math.floor(offset / 3 / width)
      left = Math.min(left, column)
      right = Math.max(right, column)
      top = Math.min(top, row)
      bottom = Math.max(bottom, row)
    }
  }
  console.log(
    JSON.stringify(
      {
        crop,
        frames: [first, second],
        totalPixels: width * height,
        changedPixels: changed,
        maxChannelDelta,
        meanChannelDelta: totalChannelDelta / expected.length,
        changedBounds: changed ? { left, top, right, bottom } : null,
      },
      null,
      2
    )
  )
  process.exitCode = changed ? 1 : 0
} catch (error) {
  console.error(error.message)
  process.exitCode = 2
}
