import { useSyncExternalStore } from 'react'

/** 插图按消息 ID 存本机，只保留最近若干张，避免撑爆 localStorage */
const KEY = 'replica:illustrations'
const LIMIT = 8

type Entry = { url: string; prompt: string; at: number }
type Map = Record<string, Entry>

const listeners = new Set<() => void>()
let cache: Map | null = null

const read = (): Map => {
  if (cache) {
    return cache
  }
  try {
    const raw = localStorage.getItem(KEY)
    cache = raw ? (JSON.parse(raw) as Map) : {}
  } catch {
    cache = {}
  }
  return cache
}

const write = (next: Map) => {
  const entries = Object.entries(next).sort((a, b) => b[1].at - a[1].at)
  const trimmed: Map = {}
  entries.slice(0, LIMIT).forEach(([id, entry]) => {
    trimmed[id] = entry
  })
  cache = trimmed
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed))
  } catch {
    // 配额不足时保留内存态，图片仍可在本次会话里显示
  }
  listeners.forEach((listener) => listener())
}

export const putIllustration = (messageId: string, url: string, prompt: string) => {
  const next = { ...read(), [messageId]: { url, prompt, at: Date.now() } }
  write(next)
}

export const removeIllustration = (messageId: string) => {
  const next = Object.fromEntries(
    Object.entries(read()).filter(([id]) => id !== messageId)
  )
  write(next)
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getEntry = (messageId: string) => read()[messageId]?.url ?? null

export const useIllustration = (messageId: string) =>
  useSyncExternalStore(subscribe, () => getEntry(messageId), () => null)
