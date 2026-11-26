import { vi } from 'vitest'

/**
 * Fake the screen width for the admin panel's `lg` switch (lib/media.ts). jsdom has no matchMedia.
 * 'desktop' matches every min-width query, 'phone' none. Undo with vi.unstubAllGlobals().
 */
export function setScreen(size: 'desktop' | 'phone') {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: size === 'desktop' && media.includes('min-width'),
    media,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}
