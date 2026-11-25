import { createContext, useContext } from 'react'

export type ToastTone = 'success' | 'error'

export interface ToastApi {
  /** Show an already-translated message for a few seconds. */
  show(message: string, tone?: ToastTone): void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const toast = useContext(ToastContext)
  if (!toast) throw new Error('useToast() needs a <ToastProvider> above it')
  return toast
}
