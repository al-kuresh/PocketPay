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
