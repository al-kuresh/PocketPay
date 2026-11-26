interface StitchProps {
  /** rect: around a block (its corners match rounded-2xl); line: a tear line; circle: a ring (give it a square size). */
  shape: 'rect' | 'line' | 'circle'
  /** Size and place it (e.g. `absolute inset-3`, `h-1 w-full`) and pick the thread (`stroke-thread`, TASTE.md). */
  className?: string
}

// The Kantha running stitch: round caps and a 7 9 dash, the same everywhere it appears.
const THREAD = { fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeDasharray: '7 9' } as const

/** The one signature detail (TASTE.md): only the Home pocket, hold to send, receipt tear lines and the Sent ring. Decorative. */
export function Stitch({ shape, className = '' }: StitchProps) {
  return (
    // overflow-visible: the stroke is centred on the edge, so half of it falls outside the box.
    <svg aria-hidden className={`pointer-events-none overflow-visible ${className}`}>
      {shape === 'rect' && <rect width="100%" height="100%" rx="16" {...THREAD} />}
      {shape === 'line' && <line x1="0" y1="50%" x2="100%" y2="50%" {...THREAD} />}
      {shape === 'circle' && <circle cx="50%" cy="50%" r="50%" {...THREAD} />}
    </svg>
  )
}
