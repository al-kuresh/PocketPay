import type { ReactNode } from 'react'

/** Cards get a border, not a shadow (TASTE.md). */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-border bg-surface p-6 ${className}`}>{children}</div>
}
