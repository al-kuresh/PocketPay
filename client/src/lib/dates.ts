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

/** The same Dhaka-time format in each language. */
const inDhaka = (options: Intl.DateTimeFormatOptions) => ({
  en: new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'Asia/Dhaka' }),
  bn: new Intl.DateTimeFormat('bn-BD', { ...options, timeZone: 'Asia/Dhaka' }),
})
const rowFormats = {
  time: inDhaka({ hour: 'numeric', minute: '2-digit', hour12: true }),
  date: inDhaka({ day: 'numeric', month: 'short' }),
  full: inDhaka({ day: 'numeric', month: 'short', year: 'numeric' }),
  // "yesterday" / "গতকাল" from the platform, in each language.
  yesterday: { en: new Intl.RelativeTimeFormat('en', { numeric: 'auto' }), bn: new Intl.RelativeTimeFormat('bn', { numeric: 'auto' }) },
}
const DAY_MS = 24 * 60 * 60 * 1000 // Dhaka has no daylight saving: a Dhaka day is always 24 h

/** A list row's time: "7:42 pm" today, "Yesterday", "23 Nov" this year, else "31 Dec 2025". Days are Dhaka days. */
export function formatWhen(iso: string, lang: Lang, now = new Date()): string {
  const when = new Date(iso)
  const day = dhakaDay.format(when)
  if (day === dhakaDay.format(now)) return rowFormats.time[lang].format(when)
  if (day === dhakaDay.format(new Date(now.getTime() - DAY_MS))) {
    const word = rowFormats.yesterday[lang].format(-1, 'day')
    return word.charAt(0).toUpperCase() + word.slice(1)
  }
  return (day.slice(0, 4) === dhakaDay.format(now).slice(0, 4) ? rowFormats.date : rowFormats.full)[lang].format(when)
}

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

const dhakaHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: 'numeric', hourCycle: 'h23' })

/** The Home greeting for `now`, by the Dhaka clock: 05–11 morning, 12–16 afternoon, else evening. An i18n key under `home.greeting`. */
export function greetingKey(now: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(dhakaHour.format(now))
  return hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : 'evening'
}

// A date of birth is a calendar date stored as UTC midnight (server and memory: never local time).
const calendarDate = {
  en: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
  bn: new Intl.DateTimeFormat('bn-BD', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
}

/** "1990-01-15" → "15 Jan 1990" (en) or "১৫ জানু, ১৯৯০" (bn). */
export function formatDate(isoDate: string, lang: Lang): string {
  return calendarDate[lang].format(new Date(isoDate))
}

/** Whole years from `dob` to `today` (both YYYY-MM-DD; pass dhakaToday()). String compare of MM-DD: no time zones. */
export function yearsOld(dob: string, today: string): number {
  const years = Number(today.slice(0, 4)) - Number(dob.slice(0, 4))
  return today.slice(5) < dob.slice(5) ? years - 1 : years
}
