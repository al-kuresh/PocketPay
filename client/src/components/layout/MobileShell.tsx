import type { ReactNode } from 'react'

/** Phone-width frame that every customer, agent and merchant page sits in. */
export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-phone flex-col bg-surface sm:border-x sm:border-border">
      {children}
    </div>
  )
}
