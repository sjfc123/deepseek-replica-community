/* ============================================================================
 * 功能区：配图生成与存储 / generate · 配图生成
 * 职责：配图生成：根据角色与场景构造提示词并调用图像服务，返回结果与来源。
 * 分区：01 类型、契约与依赖；
 *    02 核心实现：toPlainText、buildIllustrationPrompt、generateIllustration；
 *    03 对外入口与收尾
 * 关联：依赖 services/settings；
 *    被 components/chatInput/ChatInput、components/messages/AssistantMessage 引用。
 * 导出：IllustrationResult、IllustrationSource、buildIllustrationPrompt、generateIllustration
 * 边界：只处理配图提示词、生成结果与本地 Blob；不参与消息持久化与视图布局。
 * ========================================================================== */

import { useSettings } from '../settings.js'

/* ---- 01 类型、契约与依赖 ---- */
/** 把聊天接口地址还原成服务根地址，拼上 /images/generations */
const imageBase = (endpoint: string) => {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  return trimmed.replace(/\/chat\/completions$/i, '')
}

const toDataUrl = (value: string) =>
  value.startsWith('data:') ? value : `data:image/png;base64,${value}`

/** 缩到长边 640 再转 JPEG，控制本机存储占用 */
const shrink = (source: string): Promise<string> =>
  new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, 480 / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(image.width * scale)
      canvas.height = Math.round(image.height * scale)
      const context = canvas.getContext('2d')
      if (!context) {
        resolve(source)
        return
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.65))
    }
    image.onerror = () => resolve(source)
    image.src = source
  })

export type IllustrationResult = { ok: true; url: string } | { ok: false; message: string }

/** 配图入口：消息菜单按这段回复的画面信息画，输入框按用户自己写的画面描述画 */
export type IllustrationSource = 'message' | 'prompt'

/** 去掉 Markdown 标记与代码块，只留下能读成画面的文字 */
const toPlainText = (value: string) =>
  value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_>`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/* ---- 02 核心实现：toPlainText、buildIllustrationPrompt、generateIllustration ---- */
/**
 * 两种入口的提示词分开写：
 * - 消息菜单：把回复当作剧情，要求还原文字里描述的人物、动作与环境，台词不画成文字；
 * - 输入框：用户已经写好了画面描述，直接照着画，不再套角色扮演剧情模板。
 */
export const buildIllustrationPrompt = (input: string, source: IllustrationSource) => {
  const plain = toPlainText(input).slice(0, 1200)
  if (source === 'message') {
    return [
      '按下面这段角色扮演文字里正在发生的画面画一张插画。',
      '以文字描述的人物外观、动作、表情、环境和光线为准；括号里的动作也要还原成画面。',
      '画面里不要出现任何文字、台词、字幕或漫画对话框。',
      plain,
    ].join('\n')
  }
  return [
    '严格按下面的画面描述绘制，不要自行添加描述里没有的主要元素。',
    '画面里不要出现多余文字。',
    plain,
  ].join('\n')
}

/* ---- 03 对外入口与收尾 ---- */
/**
 * 用当前配置的接口生成一张插画。
 * 走 OpenAI 兼容的 /images/generations；返回 b64 或 url 都接受，最终统一压成 dataURL。
 */
export const generateIllustration = async (
  input: string,
  source: IllustrationSource = 'prompt'
): Promise<IllustrationResult> => {
  const { apiKey, chatConfig } = useSettings.getState()
  const config = chatConfig
  const endpoint = chatConfig.endpoint?.trim()
  if (!endpoint) {
    return {
      ok: false,
      message: '当前使用内置接口，未配置可用的绘图地址；到「接口与请求」里填写自定义接口后再试',
    }
  }
  if (!apiKey) {
    return { ok: false, message: '缺少 API Key，先在设置里填写密钥' }
  }
  const base = imageBase(endpoint)
  const body = {
    model: config.imageModel || 'gpt-image-1',
    prompt: buildIllustrationPrompt(input, source),
    n: 1,
    size: config.imageSize || '1024x1024',
    response_format: 'b64_json',
  }
  try {
    const response = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      return { ok: false, message: `绘图接口返回 ${response.status}，检查地址、模型名与权限` }
    }
    const payload = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>
    }
    const item = payload.data?.[0]
    if (!item) {
      return { ok: false, message: '绘图接口没有返回图片' }
    }
    const raw = item.b64_json ? toDataUrl(item.b64_json) : item.url
    if (!raw) {
      return { ok: false, message: '绘图接口返回了空图片' }
    }
    return { ok: true, url: await shrink(raw) }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `绘图请求失败：${error.name}` : '绘图请求失败',
    }
  }
}

/* ============================================================================
 * 功能区：配图生成 / generate 结束
 * ========================================================================== */
