/** A loading placeholder; size it with className (e.g. "h-4 w-32"). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-surface-sunken ${className}`} />
}
