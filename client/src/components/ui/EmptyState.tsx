import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: LucideIcon
  /** Already translated. */
  title: string
  message?: string
  action?: ReactNode
}

export function EmptyState({ icon: Icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <Icon aria-hidden className="size-8 text-text-muted" />
      <p className="text-lg font-semibold text-text">{title}</p>
      {message && <p className="text-sm text-text-muted">{message}</p>}
      {action}
    </div>
  )
}
