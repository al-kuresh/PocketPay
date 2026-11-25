import type { Lang } from '../stores/language'

// Always Bangladesh time, whatever the phone's timezone: limits and history days are Dhaka days (design §6).
const OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Dhaka',
}
const formatters = { en: new Intl.DateTimeFormat('en-GB', OPTIONS), bn: new Intl.DateTimeFormat('bn-BD', OPTIONS) }

/** "2026-11-24T18:30:00Z" → "25 Nov 2026, 12:30 am" (en) or "২৫ নভে, ২০২৬, ১২:৩০ AM" (bn). */
export function formatDateTime(iso: string, lang: Lang): string {
  return formatters[lang].format(new Date(iso))
}

// en-CA writes dates as YYYY-MM-DD.
const dhakaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Today in Bangladesh as `YYYY-MM-DD` (the server's 18+ rule uses the Dhaka date too). */
export function dhakaToday(): string {
  return dhakaDay.format(new Date())
}

/** `YYYY-MM-DD` minus `years` years, same month and day, as a string: no millisecond maths, so no time-zone shift. */
export function yearsBefore(isoDate: string, years: number): string {
  return `${String(Number(isoDate.slice(0, 4)) - years).padStart(4, '0')}${isoDate.slice(4)}`
}

/** A real `YYYY-MM-DD` date (not 2026-02-30). Parsed as UTC, like the server. */
export function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
