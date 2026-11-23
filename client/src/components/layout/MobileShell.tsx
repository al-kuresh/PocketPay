import type { ReactNode } from 'react'

/** Phone-width frame that every customer, agent and merchant page sits in. */
export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col bg-surface sm:border-x sm:border-border sm:shadow-sm">
      {children}
    </div>
  )
}
