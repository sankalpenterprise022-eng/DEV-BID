// Asia/Kolkata helpers. IST is a fixed UTC+5:30 (no DST), so plain offset
// arithmetic on UTC getters is exact and never depends on the server's local
// timezone (Vercel runs UTC, the dev machine runs IST).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** [start, end) of the IST calendar day containing `now`, as UTC instants. */
export function istDayBounds(now: Date = new Date()) {
  const startMs = Math.floor((now.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}

/* ---- IST calendar-date keys "YYYY-MM-DD" (used by recurring tasks + holidays) ---- */

/** IST calendar date of `now` as "YYYY-MM-DD". */
export function istDateKey(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const keyMs = (key: string) => Date.parse(`${key}T00:00:00Z`);

/** Strict "YYYY-MM-DD" check (rejects 2026-02-30). */
export function isDateKey(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const ms = keyMs(v);
  return !isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === v;
}

export function addDaysKey(key: string, n: number): string {
  return new Date(keyMs(key) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOfKey(key: string): number {
  return new Date(keyMs(key)).getUTCDay();
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** The UTC instant of IST wall-clock `hhmm` ("HH:mm") on IST date `key`. */
export function istDateTime(key: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(keyMs(key) + ((h || 0) * 60 + (m || 0)) * 60000 - IST_OFFSET_MS);
}

/** "YYMM" of the IST month containing `now`, e.g. "2610". */
export function istYYMM(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const yy = String(ist.getUTCFullYear()).slice(-2);
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}
