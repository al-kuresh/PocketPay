/** "Karim H***" → "KH": the first letter of the first two words, in a round chip. Decorative: the name is always written next to it. */
export function Initials({ name, incoming = false }: { name: string; incoming?: boolean }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0])
    .join('')
    .toUpperCase()
  return (
    <span
      aria-hidden
      className={`flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${incoming ? 'bg-success-50 text-success-dark' : 'bg-primary-50 text-primary-darker'}`}
    >
      {letters}
    </span>
  )
}
