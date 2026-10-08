import { create } from 'zustand'

export type ToastKind = 'error' | 'success' | 'info'
export type ToastItem = { id: number; kind: ToastKind; message: string }

type ToastState = {
  toasts: ToastItem[]
  push: (kind: ToastKind, message: string) => void
  dismiss: (id: number) => void
}

const MAX_VISIBLE = 3
const LIFETIME_MS = 5000
let nextId = 1

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    // The same message twice in a row (a retry loop, a double tap) shows once.
    if (get().toasts.some((t) => t.kind === kind && t.message === message)) return
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }].slice(-MAX_VISIBLE) }))
    setTimeout(() => get().dismiss(id), LIFETIME_MS)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  error: (message: string) => useToastStore.getState().push('error', message),
  success: (message: string) => useToastStore.getState().push('success', message),
  info: (message: string) => useToastStore.getState().push('info', message),
}
