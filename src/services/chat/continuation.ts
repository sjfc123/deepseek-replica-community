import type { MessageStreamEvent } from '../api/types.js'

/**
 * 续写请求的临时约束：只追加在已有的非空 system 末尾，不改普通轮次。
 * 角色卡开场白固定在 system 后，续写时模型可能重新开口或复述原句；这里明确
 * 从最后一个字之后接写，并禁止重发、改写、总结与替用户发言。
 */
export const CONTINUATION_GUARD =
  '\n\n【续写约束，不要复述本段】\n' +
  '这次不是新的用户提问，而是把上一条 assistant 回复没有写完的部分接上。\n' +
  '从那条回复的最后一个字之后写起，保持同一角色、同一场景、同一说话对象；不要重发、改写或总结已有内容，不要重新开场、问候或复述原句，也不要替用户说话。'

/**
 * 续写回放过滤器。
 * 部分兼容层会把末尾 assistant 前缀整段回放，再接着输出新内容；如果直接追加，
 * 界面就会把已经显示的原文再写一遍。这里在文本增量进入回复块之前做一次行首比对：
 * 仍与原文前缀逐字一致时先扣住，出现分叉或越过完整前缀后只放行真正新增的部分。
 */
export type ContinuationEchoFilter = {
  prefix: string
  buffer: string
  resolved: boolean
}

export const createContinuationEchoFilter = (prefix: string): ContinuationEchoFilter => ({
  prefix,
  buffer: '',
  resolved: prefix.length === 0,
})

/**
 * 返回本次应交给 applyEvent 的事件；event 为 null 表示该增量仍属于回放前缀，暂不显示。
 * 非文本事件原样通过，思考块不参与正文比对。
 */
export const filterContinuationEcho = (
  filter: ContinuationEchoFilter,
  event: MessageStreamEvent
): { filter: ContinuationEchoFilter; event: MessageStreamEvent | null } => {
  if (filter.resolved) {
    return { filter, event }
  }
  // 少数兼容层会把回放正文直接放在 content_block_start 里；同样按行首比对处理。
  if (event.type === 'content_block_start' && event.content_block.type === 'text') {
    const text = event.content_block.text
    if (!text) {
      return { filter, event }
    }
    const buffer = filter.buffer + text
    if (filter.prefix.startsWith(buffer)) {
      return {
        filter: { ...filter, buffer },
        event: { ...event, content_block: { ...event.content_block, text: '' } },
      }
    }
    if (buffer.startsWith(filter.prefix)) {
      return {
        filter: { ...filter, buffer: '', resolved: true },
        event: {
          ...event,
          content_block: { ...event.content_block, text: buffer.slice(filter.prefix.length) },
        },
      }
    }
    return {
      filter: { ...filter, buffer: '', resolved: true },
      event: { ...event, content_block: { ...event.content_block, text: buffer } },
    }
  }
  if (event.type !== 'content_block_delta' || event.delta.type !== 'text_delta') {
    return { filter, event }
  }
  const buffer = filter.buffer + event.delta.text
  // 还在原文内部：先不显示，等后续增量判断是回放还是正常续写。
  if (filter.prefix.startsWith(buffer)) {
    return { filter: { ...filter, buffer }, event: null }
  }
  // 已经完整回放原文：剥掉前缀，只留下后面的新内容。
  if (buffer.startsWith(filter.prefix)) {
    const text = buffer.slice(filter.prefix.length)
    return {
      filter: { ...filter, buffer: '', resolved: true },
      event: text ? { ...event, delta: { ...event.delta, text } } : null,
    }
  }
  // 从一开始就与原文分叉：这是正常续写，不是回放，整段放行。
  return {
    filter: { ...filter, buffer: '', resolved: true },
    event: { ...event, delta: { ...event.delta, text: buffer } },
  }
}
