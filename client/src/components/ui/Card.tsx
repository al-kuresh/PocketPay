import type { ReactNode } from 'react'

/** Cards get a border, not a shadow (TASTE.md). */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-surface p-4 ${className}`}>{children}</div>
}
