/** Date formatting with Intl, in the user's locale. */

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600 * 1000],
  ["month", 30 * 24 * 3600 * 1000],
  ["week", 7 * 24 * 3600 * 1000],
  ["day", 24 * 3600 * 1000],
  ["hour", 3600 * 1000],
  ["minute", 60 * 1000],
];

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const full = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });
const medium = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function fromNow(ts: number, now = Date.now()): string {
  const diff = ts - now;
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return relative.format(Math.round(diff / size), unit);
  }
  return relative.format(0, "minute");
}

export function formatFull(ts: number): string {
  return full.format(ts);
}

export function formatMedium(ts: number): string {
  return medium.format(ts);
}

/** Parses the value of an <input type="date"> ("YYYY-MM-DD") as local time. */
export function parseDateInput(value: string, endOfDay: boolean): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = endOfDay
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999)
    : new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getTime();
}
