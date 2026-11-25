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
