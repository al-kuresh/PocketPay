import { useEffect, useRef } from 'react'

const MAX_DEG = 6
const clamp = (deg: number) => Math.max(-MAX_DEG, Math.min(MAX_DEG, deg))

/**
 * Tilts the Home pocket with the phone, at most ±6° (TASTE.md). Only in a secure context (plain-http LAN stays flat)
 * and only with reduced motion off. Never calls DeviceOrientationEvent.requestPermission: iOS needs a tap for that,
 * and without it iOS sends no events, so the pocket just stays flat. Writes the style directly: no re-render per event.
 */
export function usePocketTilt<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    // No matchMedia (old browsers, jsdom) counts as reduced motion: flat is the safe default.
    if (!el || !window.isSecureContext || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== false) return
    let rest: number | null = null // the first front-back reading: how this person holds the phone
    function onTilt(e: DeviceOrientationEvent) {
      if (e.beta === null || e.gamma === null || !el) return
      rest ??= e.beta
      el.style.transform = `perspective(40rem) rotateX(${clamp((rest - e.beta) / 3)}deg) rotateY(${clamp(e.gamma / 3)}deg)`
    }
    window.addEventListener('deviceorientation', onTilt)
    return () => window.removeEventListener('deviceorientation', onTilt)
  }, [])
  return ref
}
