const dhakaDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's calendar date in Bangladesh as `YYYY-MM-DD`, whatever the server's own time zone. */
export function dhakaToday(now: Date = new Date()): string {
  const parts = Object.fromEntries(dhakaDate.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** True when `s` is a real calendar date as `YYYY-MM-DD` (rejects 2026-02-30). Parsed as UTC. */
export const isCalendarDate = (s: string) => {
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// Bangladesh is UTC+06:00 with no daylight saving (none since 2009), so a fixed offset is exact.
const DAY_MS = 86_400_000;

/** 00:00 in Dhaka on `date` (`YYYY-MM-DD`), as a UTC instant. Throws on a date that isn't real. */
function dhakaMidnight(date: string): Date {
  if (!isCalendarDate(date)) throw new Error(`Not a real date (YYYY-MM-DD): ${date}`);
  return new Date(`${date}T00:00:00+06:00`);
}

/** 00:00 Dhaka today, as a UTC instant: the start of the daily limit window. */
export function dhakaDayStart(now: Date = new Date()): Date {
  return dhakaMidnight(dhakaToday(now));
}

/** 00:00 Dhaka on the 1st of this Dhaka month: the start of the monthly limit window. */
export function dhakaMonthStart(now: Date = new Date()): Date {
  return dhakaMidnight(`${dhakaToday(now).slice(0, 7)}-01`);
}

/** Inclusive Dhaka days `from`..`to` as a Prisma date filter. Either side may be absent. */
export function dhakaDateRange(from?: string, to?: string): { gte?: Date; lt?: Date } {
  return {
    ...(from !== undefined && { gte: dhakaMidnight(from) }),
    ...(to !== undefined && { lt: new Date(dhakaMidnight(to).getTime() + DAY_MS) }),
  };
}
