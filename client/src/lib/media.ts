import { useSyncExternalStore } from 'react'

// Tailwind's `lg` (64rem = 1024px): the admin panel's sidebar and tables from here up.
const LG = '(min-width: 64rem)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia?.(LG)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

/** True from `lg` up. No matchMedia (jsdom, very old browsers) counts as a phone. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(LG).matches ?? false)
}
