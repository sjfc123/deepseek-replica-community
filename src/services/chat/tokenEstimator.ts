/* ============================================================================
 * 功能区：会话与角色核心 / tokenEstimator · Token 估算
 * 职责：Token 估算：中英文字符、汉字与表情分桶匹配，输出近似 token 数；不发请求。
 * 分区：01 类型、常量与模块依赖；
 *    02 计算与判定（punctSymUnitLength、isFrequentBindingPunct、isUniformSpan…）；
 *    03 计算与判定（estimateCjkRun、estimateLetterWord、isCommonThreeAsciiPunct）；
 *    04 计算与判定（estimatePunctBlock、estimateWhitespaceBlock、estimateTextTokens）；
 *    05 计算与判定（estimateTextTokens）
 * 关联：依赖 services/chat/tokenTables；被 services/chat/context 引用。
 * 导出：estimateTextTokens
 * 边界：只处理聊天领域的数据、状态转换与提示词装配；不直接渲染视图，不发起职责外的网络请求。
 * ========================================================================== */

import { EN_BIGRAM_B64, HAN1_BITMAP_B64, HAN2_BLOOM_B64, HAN34_BLOOM_B64 } from './tokenTables.js'

/* ---- 01 类型、常量与模块依赖 ---- */
const HAN_START = 0x4e00
const HAN_END = 0x9fa5
const HAN2_HASHES = 5
const HAN34_HASHES = 8

type Tables = {
  han1: Uint8Array
  enBg: Uint8Array
  bf2: Uint8Array
  bf34: Uint8Array
}

let cachedTables: Tables | undefined

const decodeBase64 = (encoded: string): Uint8Array => {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const getTables = (): Tables => {
  if (!cachedTables) {
    cachedTables = {
      han1: decodeBase64(HAN1_BITMAP_B64),
      enBg: decodeBase64(EN_BIGRAM_B64),
      bf2: decodeBase64(HAN2_BLOOM_B64),
      bf34: decodeBase64(HAN34_BLOOM_B64),
    }
  }
  return cachedTables
}

const isCommonHan = (han1: Uint8Array, code: number): boolean => {
  const idx = code - HAN_START
  return idx >= 0 && code <= HAN_END && (han1[idx >>> 3] & (1 << (idx & 7))) !== 0
}

const hasBloom = (
  bits: Uint8Array,
  hashCount: number,
  text: string,
  start: number,
  length: number
): boolean => {
  const numBits = bits.length * 8
  let h1 = 2166136261 >>> 0
  let h2 = 0x9e3779b1 >>> 0
  for (let offset = 0; offset < length; offset++) {
    const v = text.charCodeAt(start + offset) - HAN_START
    h1 = Math.imul(h1 ^ (v & 0xff), 16777619) >>> 0
    h1 = Math.imul(h1 ^ ((v >>> 8) & 0xff), 16777619) >>> 0
    h2 = ((Math.imul(h2, 0x85ebca6b) >>> 0) ^ ((v + 0x7f4a7c15) >>> 0)) >>> 0
  }
  h2 = (Math.imul(h2 ^ (h2 >>> 15), 0xc2b2ae35) >>> 0) | 1
  for (let step = 0; step < hashCount; step++) {
    const bit = ((h1 + Math.imul(step, h2)) >>> 0) % numBits
    if ((bits[bit >>> 3] & (1 << (bit & 7))) === 0) {
      return false
    }
  }
  return true
}

const hasValidEnBigram = (enBg: Uint8Array, a: number, b: number): boolean => {
  const idx = (a - 97) * 26 + (b - 97)
  return (enBg[idx >>> 3] & (1 << (idx & 7))) !== 0
}

const isDigit = (c: number) => c >= 48 && c <= 57
const isAsciiUpper = (c: number) => c >= 65 && c <= 90
const isAsciiLower = (c: number) => c >= 97 && c <= 122
const isAsciiAlpha = (c: number) => isAsciiUpper(c) || isAsciiLower(c)
const toAsciiLower = (c: number) => (isAsciiUpper(c) ? c + 32 : c)

const isAsciiPunct = (c: number) =>
  (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)

const isHan = (c: number) => c >= HAN_START && c <= HAN_END
const isHira = (c: number) => c >= 0x3040 && c <= 0x309f
const isKata = (c: number) => c >= 0x30a0 && c <= 0x30ff
const isCjkStage2 = (c: number) => isHan(c) || isHira(c) || isKata(c)

const isWhitespace = (c: number) =>
  c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 || c === 0xa0

const isLineBreak = (c: number) => c === 10 || c === 13

const isLatinExt = (c: number) =>
  (c >= 0x00c0 && c <= 0x024f && c !== 0x00d7 && c !== 0x00f7) || (c >= 0x1e00 && c <= 0x1eff)

const isCyrillic = (c: number) => c >= 0x0400 && c <= 0x052f
const isHangul = (c: number) => c >= 0xac00 && c <= 0xd7af

const isStage3Letter = (c: number) =>
  isAsciiAlpha(c) ||
  isLatinExt(c) ||
  (c >= 0x0370 && c <= 0x052f) ||
  (c >= 0x0590 && c <= 0x06ff) ||
  (c >= 0x0900 && c <= 0x0e7f) ||
  isHangul(c)

const isCjkPunct = (c: number) =>
  (c >= 0x3000 && c <= 0x303f) || (c >= 0xff00 && c <= 0xffef) || (c >= 0x2010 && c <= 0x2027)

const isBmpPunctOrSym = (c: number) =>
  isAsciiPunct(c) ||
  (c >= 0x00a1 && c <= 0x00bf) ||
  c === 0x00d7 ||
  c === 0x00f7 ||
  (c >= 0x2000 && c <= 0x2bff) ||
  (c >= 0x3000 && c <= 0x303f) ||
  (c >= 0xfe00 && c <= 0xfe6f) ||
  (c >= 0xff00 && c <= 0xffef)

const isEmojiSurrogateAt = (text: string, index: number, limit: number): boolean => {
  if (index + 1 >= limit) {
    return false
  }
  const hi = text.charCodeAt(index)
  const lo = text.charCodeAt(index + 1)
  if (hi < 0xd800 || hi > 0xdbff || lo < 0xdc00 || lo > 0xdfff) {
    return false
  }
  const cp = ((hi - 0xd800) << 10) + (lo - 0xdc00) + 0x10000
  return cp >= 0x1f000 && cp <= 0x1faff
}

/* ---- 02 计算与判定（punctSymUnitLength、isFrequentBindingPunct、isUniformSpan…） ---- */
const punctSymUnitLength = (text: string, index: number, limit: number): number => {
  const c = text.charCodeAt(index)
  if (isBmpPunctOrSym(c)) {
    return 1
  }
  return isEmojiSurrogateAt(text, index, limit) ? 2 : 0
}

const isFrequentBindingPunct = (c: number) =>
  c === 46 || // .
  c === 95 || // _
  c === 47 || // /
  c === 40 || // (
  c === 58 || // :
  c === 35 || // #
  c === 92 // \

const isUniformSpan = (text: string, start: number, end: number): boolean => {
  const first = text.charCodeAt(start)
  for (let index = start + 1; index < end; index++) {
    if (text.charCodeAt(index) !== first) {
      return false
    }
  }
  return true
}

const badBigramRatio = (enBg: Uint8Array, text: string, start: number, end: number): number => {
  const pairs = end - start - 1
  if (pairs <= 0) {
    return 0
  }
  let bad = 0
  let prev = toAsciiLower(text.charCodeAt(start))
  for (let index = start + 1; index < end; index++) {
    const curr = toAsciiLower(text.charCodeAt(index))
    if (!hasValidEnBigram(enBg, prev, curr)) {
      bad++
    }
    prev = curr
  }
  return bad / pairs
}

const estimateAsciiWord = (enBg: Uint8Array, text: string, start: number, end: number): number => {
  const length = end - start
  if (length <= 0) {
    return 0
  }
  if (length >= 8 && isUniformSpan(text, start, end)) {
    return Math.max(1, length / 8)
  }

  // 按驼峰和全大写缩写边界遍历子段（零数组分配）：
  // 如 prepareHistoryContext → prepare | History | Context；HTTPServer → HTTP | Server
  let partCount = 0
  let subCost = 0
  let pos = start
  while (pos < end) {
    const segStart = pos
    const first = text.charCodeAt(pos)
    let isUpperRun = false
    if (isAsciiUpper(first)) {
      pos++
      if (pos < end && isAsciiUpper(text.charCodeAt(pos))) {
        while (pos < end && isAsciiUpper(text.charCodeAt(pos))) {
          pos++
        }
        // 大写缩写后紧跟小写字母时，把最后一个大写字母留给后续首字母大写词
        if (pos < end && isAsciiLower(text.charCodeAt(pos))) {
          pos--
        }
        isUpperRun = true
      } else {
        while (pos < end && isAsciiLower(text.charCodeAt(pos))) {
          pos++
        }
      }
    } else {
      while (pos < end && isAsciiLower(text.charCodeAt(pos))) {
        pos++
      }
    }
    partCount++
    const segLen = pos - segStart
    if (isUpperRun && segLen >= 2) {
      subCost += segLen <= 3 ? 1.08 : 1 + (segLen - 3) * 0.36
    } else if (segLen >= 4 && badBigramRatio(enBg, text, segStart, pos) >= 0.45) {
      subCost += Math.max(1, segLen / 1.95)
    } else if (segLen <= 7) {
      subCost += 1.02
    } else if (segLen <= 10) {
      subCost += 1.08 + (segLen - 7) * 0.07
    } else {
      subCost += 1.3 + (segLen - 10) * 0.2
    }
  }

  // 高熵随机字母串（Base64 / 哈希 / 随机 ID）：大小写频繁切换或高非法双字母比例
  if (length >= 4) {
    const ratio = badBigramRatio(enBg, text, start, end)
    if (
      (partCount >= 3 && length / partCount <= 3 && ratio >= 0.22) ||
      (partCount >= 3 && ratio >= 0.3) ||
      (ratio >= 0.45 && length >= 5)
    ) {
      return Math.max(partCount * 0.95, length / 1.68)
    }
  }
  return subCost
}

/* ---- 03 计算与判定（estimateCjkRun、estimateLetterWord、isCommonThreeAsciiPunct） ---- */
const estimateCjkRun = (tables: Tables, text: string, start: number, end: number): number => {
  const { han1, bf2, bf34 } = tables
  let total = 0
  let index = start
  while (index < end) {
    const code = text.charCodeAt(index)
    if (isHira(code)) {
      let next = index + 1
      while (next < end && isHira(text.charCodeAt(next))) {
        next++
      }
      const len = next - index
      total += len === 1 ? 1 : len * 0.54 + 0.25
      index = next
    } else if (isKata(code)) {
      let next = index + 1
      while (next < end && isKata(text.charCodeAt(next))) {
        next++
      }
      const len = next - index
      total += len === 1 ? 1 : len * 0.64 + 0.25
      index = next
    } else {
      let hanEnd = index + 1
      while (hanEnd < end && isHan(text.charCodeAt(hanEnd))) {
        hanEnd++
      }
      const runLen = hanEnd - index
      let k = index
      while (k < hanEnd) {
        const ch = text.charCodeAt(k)
        if (!isCommonHan(han1, ch)) {
          // 不在 5,246 常用单字位图中的生僻汉字在 V4 词表下固定拆成 2 个字节 token
          total += 2
          k++
          continue
        }
        // 连续 4+ 相同常用字：区分叠词（如「哈哈哈哈」→ 1 token）与非叠词（如「甲甲甲甲」→ 逐字）
        if (
          k + 3 < hanEnd &&
          text.charCodeAt(k + 1) === ch &&
          text.charCodeAt(k + 2) === ch &&
          text.charCodeAt(k + 3) === ch
        ) {
          if (hasBloom(bf2, HAN2_HASHES, text, k, 2)) {
            total += 1
            k += 4
            continue
          }
          let sameEnd = k + 1
          while (sameEnd < hanEnd && text.charCodeAt(sameEnd) === ch) {
            sameEnd++
          }
          total += sameEnd - k
          k = sameEnd
          continue
        }
        // 从 4 字到 1 字依次尝试最长词匹配，命中后立即消费该片段。
        if (
          k + 4 <= hanEnd &&
          isCommonHan(han1, text.charCodeAt(k + 1)) &&
          isCommonHan(han1, text.charCodeAt(k + 2)) &&
          isCommonHan(han1, text.charCodeAt(k + 3)) &&
          hasBloom(bf34, HAN34_HASHES, text, k, 4)
        ) {
          total += 1
          k += 4
        } else if (
          k + 3 <= hanEnd &&
          isCommonHan(han1, text.charCodeAt(k + 1)) &&
          isCommonHan(han1, text.charCodeAt(k + 2)) &&
          hasBloom(bf34, HAN34_HASHES, text, k, 3)
        ) {
          total += 1
          k += 3
        } else if (
          k + 2 <= hanEnd &&
          isCommonHan(han1, text.charCodeAt(k + 1)) &&
          hasBloom(bf2, HAN2_HASHES, text, k, 2)
        ) {
          total += 0.99
          k += 2
        } else {
          total += runLen === 1 || (k + 1 < hanEnd && text.charCodeAt(k + 1) === ch) ? 1 : 0.94
          k++
        }
      }
      index = hanEnd
    }
  }
  return total
}

const estimateLetterWord = (
  enBg: Uint8Array,
  text: string,
  bodyStart: number,
  bodyEnd: number
): number => {
  const length = bodyEnd - bodyStart
  if (length <= 0) {
    return 0
  }
  let allAscii = true
  let nonAscii = 0
  let utf8Bytes = 0
  for (let index = bodyStart; index < bodyEnd; index++) {
    const c = text.charCodeAt(index)
    if (c > 127) {
      allAscii = false
      nonAscii++
      utf8Bytes += c < 0x800 ? 2 : 3
    } else {
      utf8Bytes += 1
    }
  }
  if (allAscii) {
    return estimateAsciiWord(enBg, text, bodyStart, bodyEnd)
  }
  const first = text.charCodeAt(bodyStart)
  if (isAsciiAlpha(first) || isLatinExt(first)) {
    return Math.max(1, length / 3.4 + nonAscii * 0.72)
  }
  if (isCyrillic(first)) {
    return length <= 2 ? 1 : 1 + (length - 2) * 0.24
  }
  if (isHangul(first)) {
    return length * 0.8 + 0.1
  }
  return Math.max(1, utf8Bytes / 4.5)
}

const isCommonThreeAsciiPunct = (text: string, start: number): boolean => {
  const a = text.charCodeAt(start)
  const b = text.charCodeAt(start + 1)
  const c = text.charCodeAt(start + 2)
  if (a === b && b === c) {
    return true
  }
  return (
    (a === 33 && b === 61 && c === 61) || // !==
    (a === 58 && b === 47 && c === 47) || // ://
    (a === 41 && b === 59 && c === 34) || // );"
    (a === 47 && b === 42 && c === 42) // /**
  )
}

/* ---- 04 计算与判定（estimatePunctBlock、estimateWhitespaceBlock、estimateTextTokens） ---- */
const estimatePunctBlock = (
  text: string,
  coreStart: number,
  coreEnd: number,
  nlStart: number,
  nlEnd: number
): number => {
  let nlExtra = 0
  if (nlEnd > nlStart) {
    let crlf = 0
    let lf = 0
    for (let index = nlStart; index < nlEnd; index++) {
      const c = text.charCodeAt(index)
      if (c === 13 && index + 1 < nlEnd && text.charCodeAt(index + 1) === 10) {
        crlf++
        index++
      } else if (c === 10) {
        lf++
      }
    }
    if (crlf > 0) {
      nlExtra = crlf * 1.5
    } else if (lf > 2) {
      nlExtra = Math.ceil((lf - 2) / 3)
    }
  }
  const coreLen = coreEnd - coreStart
  if (coreLen <= 0) {
    return Math.max(1, nlExtra)
  }
  let allAscii = true
  for (let index = coreStart; index < coreEnd; index++) {
    if (text.charCodeAt(index) > 127) {
      allAscii = false
      break
    }
  }
  if (allAscii) {
    if (coreLen <= 2) {
      return 1 + nlExtra
    }
    if (coreLen === 3) {
      return (isCommonThreeAsciiPunct(text, coreStart) ? 1 : 1.15) + nlExtra
    }
    if (isUniformSpan(text, coreStart, coreEnd)) {
      return Math.ceil(coreLen / 14) + nlExtra
    }
    return Math.ceil(coreLen / 2) + nlExtra
  }
  let cost = 0
  let index = coreStart
  while (index < coreEnd) {
    if (isEmojiSurrogateAt(text, index, coreEnd)) {
      cost += 1.9
      index += 2
      continue
    }
    const c = text.charCodeAt(index)
    if (c === 0x200d || c === 0xfe0f) {
      cost += 0.95
      index++
    } else if (isCjkPunct(c)) {
      let next = index + 1
      while (next < coreEnd && isCjkPunct(text.charCodeAt(next))) {
        next++
      }
      const len = next - index
      cost += len <= 2 ? 1 : Math.ceil(len / 1.5)
      index = next
    } else {
      cost += 1.15
      index++
    }
  }
  return cost + nlExtra
}

const estimateWhitespaceBlock = (text: string, start: number, end: number): number => {
  const len = end - start
  let crlf = 0
  let lf = 0
  let cr = 0
  let tabs = 0
  for (let index = start; index < end; index++) {
    const c = text.charCodeAt(index)
    if (c === 13) {
      if (index + 1 < end && text.charCodeAt(index + 1) === 10) {
        crlf++
        index++
      } else {
        cr++
      }
    } else if (c === 10) {
      lf++
    } else if (c === 9) {
      tabs++
    }
  }
  if (crlf > 0 || lf > 0 || cr > 0) {
    const sp = len - crlf * 2 - lf - cr
    let cost = crlf * 2 + cr + (lf > 0 ? Math.ceil(lf / 3) : 0)
    if (sp > 16) {
      cost += Math.ceil((sp - 16) / 32)
    }
    return Math.max(1, cost)
  }
  if (tabs > 0) {
    return Math.ceil(len / 4)
  }
  return Math.ceil(len / 48)
}

/* ---- 05 计算与判定（estimateTextTokens） ---- */
/**
 * 拟合 DeepSeek V4 三阶段 Pre-Tokenizer 与 BPE 合并规律的轻量级单趟估算器。
 * 支持指定前缀截断位置 end，全程零子串切片分配，O(n) 扫描。
 */
export const estimateTextTokens = (text: string, end = text.length): number => {
  const limit = Math.min(text.length, Math.max(0, end))
  if (limit === 0) {
    return 0
  }
  const tables = getTables()
  const { enBg } = tables
  let total = 0
  let index = 0

  while (index < limit) {
    const c = text.charCodeAt(index)

    // Stage 1: 连续 ASCII 数字（词表完整覆盖 0..999，每 1–3 位精确 1 token）
    if (isDigit(c)) {
      let next = index + 1
      while (next < limit && isDigit(text.charCodeAt(next))) {
        next++
      }
      total += Math.ceil((next - index) / 3)
      index = next
      continue
    }

    // 第二阶段按连续汉字与日文假名分段，逐段估算后再与英文结果合并。
    if (isCjkStage2(c)) {
      let next = index + 1
      while (next < limit && isCjkStage2(text.charCodeAt(next))) {
        next++
      }
      total += estimateCjkRun(tables, text, index, next)
      index = next
      continue
    }

    // Stage 3 分支 1: [ASCII 标点][A-Za-z]+（代码成员访问、参数括号、引号起始词等）
    if (isAsciiPunct(c) && index + 1 < limit && isAsciiAlpha(text.charCodeAt(index + 1))) {
      let next = index + 2
      while (next < limit && isAsciiAlpha(text.charCodeAt(next))) {
        next++
      }
      total +=
        (isFrequentBindingPunct(c) ? 0.44 : 0.8) + estimateAsciiWord(enBg, text, index + 1, next)
      index = next
      continue
    }

    // Stage 3 分支 2: 可选单个前导字符 + 字母词
    if (isStage3Letter(c)) {
      let next = index + 1
      while (next < limit && isStage3Letter(text.charCodeAt(next))) {
        next++
      }
      total += estimateLetterWord(enBg, text, index, next)
      index = next
      continue
    }
    if (
      !isLineBreak(c) &&
      punctSymUnitLength(text, index, limit) === 0 &&
      index + 1 < limit &&
      isStage3Letter(text.charCodeAt(index + 1))
    ) {
      let next = index + 2
      while (next < limit && isStage3Letter(text.charCodeAt(next))) {
        next++
      }
      total += estimateLetterWord(enBg, text, index + 1, next)
      index = next
      continue
    }

    // Stage 3 分支 3: 可选前导空格 + 连续标点/符号 + 尾随换行
    const directPunctLen = punctSymUnitLength(text, index, limit)
    const spacePunctLen =
      directPunctLen === 0 && c === 32 && index + 1 < limit
        ? punctSymUnitLength(text, index + 1, limit)
        : 0
    if (directPunctLen > 0 || spacePunctLen > 0) {
      const coreStart = directPunctLen > 0 ? index : index + 1
      let coreEnd = coreStart + (directPunctLen > 0 ? directPunctLen : spacePunctLen)
      while (coreEnd < limit) {
        const step = punctSymUnitLength(text, coreEnd, limit)
        if (step === 0) {
          break
        }
        coreEnd += step
      }
      let nlEnd = coreEnd
      while (nlEnd < limit && isLineBreak(text.charCodeAt(nlEnd))) {
        nlEnd++
      }
      total += estimatePunctBlock(text, coreStart, coreEnd, coreEnd, nlEnd)
      index = nlEnd
      continue
    }

    // Stage 3 分支 4–6: 空白与换行块（\s*[\r\n]+ | \s+(?!\S) | \s+）
    if (isWhitespace(c)) {
      let wsEnd = index + 1
      let lastNl = isLineBreak(c) ? index : -1
      while (wsEnd < limit && isWhitespace(text.charCodeAt(wsEnd))) {
        if (isLineBreak(text.charCodeAt(wsEnd))) {
          lastNl = wsEnd
        }
        wsEnd++
      }
      if (lastNl >= index) {
        total += estimateWhitespaceBlock(text, index, lastNl + 1)
        index = lastNl + 1
      } else {
        // \s+(?!\S)：若空白后紧跟同 Stage 3 段的非空白字符，则保留最后一个空白给后续词/标点块
        const hasStage3Follower =
          wsEnd < limit && !isDigit(text.charCodeAt(wsEnd)) && !isCjkStage2(text.charCodeAt(wsEnd))
        const endPos = hasStage3Follower && wsEnd - index > 1 ? wsEnd - 1 : wsEnd
        total += estimateWhitespaceBlock(text, index, endPos)
        index = endPos
      }
      continue
    }

    // 默认分支：罕见 Unicode 字符、扩展区汉字与代理对
    if (c >= 0xd800 && c <= 0xdbff && index + 1 < limit) {
      const lo = text.charCodeAt(index + 1)
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        total += 2.5
        index += 2
        continue
      }
    }
    total += c > 127 ? 2 : 1
    index++
  }

  return Math.ceil(total)
}

/* ============================================================================
 * 功能区：会话与角色核心 / tokenEstimator 结束
 * ========================================================================== */
