// Pure recurrence rules for task templates (no DB, safe to import in the UI).
// All dates are IST calendar-date keys "YYYY-MM-DD" (see ./ist).
import { addDaysKey, daysInMonth, weekdayOfKey } from "./ist";

export const RECURRENCE_TYPES = ["daily", "weekly", "monthly", "yearly"] as const;
export type RecurrenceType = (typeof RECURRENCE_TYPES)[number];
export type MonthDate = number | "last";

export interface TemplateRecurrence {
  type: RecurrenceType;
  /** daily: which weekdays (default Mon-Sat); weekly: e.g. [1] = every Monday. 0 = Sunday. */
  daysOfWeek: number[];
  /** monthly: e.g. [3, 4, "last"]. A date the month doesn't have (31 in Feb) falls on its last day. */
  datesOfMonth: MonthDate[];
  /** yearly: month 1-12 + day (29 Feb -> 28 Feb in non-leap years). */
  monthDay: { month: number; day: number } | null;
  /** Create the task N days before its due date. */
  leadDays: number;
  /** Weekly/monthly/yearly date on a Sunday/holiday moves to the previous or next working day.
   *  Daily templates simply skip holidays (shifting would double up with the next day's task). */
  holidayShift: "previous" | "next";
}

/** Holidays + working weekdays (TaskSettings.workingDays, default Mon-Sat). */
export interface WorkCalendar {
  holidays: Set<string>;
  workingDays: number[];
}

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DEFAULT_DAILY_DAYS = [1, 2, 3, 4, 5, 6];

export interface Occurrence {
  /** The rule's own date - the stable id of this occurrence (part of the unique index). */
  occurrenceDate: string;
  /** After the Sunday/holiday shift. */
  dueDate: string;
  /** dueDate - leadDays: the day the task gets created. */
  createDate: string;
}

const MAX_SHIFT_DAYS = 31;

export function isWorkingDay(cal: WorkCalendar, key: string): boolean {
  return cal.workingDays.includes(weekdayOfKey(key)) && !cal.holidays.has(key);
}

/** Does the rule fire on `key` (before any holiday shift)? */
export function matchesRule(r: TemplateRecurrence, key: string): boolean {
  const [y, m, d] = key.split("-").map(Number);
  switch (r.type) {
    case "daily":
    case "weekly":
      return r.daysOfWeek.includes(weekdayOfKey(key));
    case "monthly": {
      const dim = daysInMonth(y, m);
      return r.datesOfMonth.some((x) => (x === "last" ? d === dim : x === d || (x > dim && d === dim)));
    }
    case "yearly": {
      if (!r.monthDay || r.monthDay.month !== m) return false;
      const dim = daysInMonth(y, m);
      return r.monthDay.day === d || (r.monthDay.day > dim && d === dim);
    }
  }
}

/** Occurrence for a date the rule fires on, or null if it is skipped. */
export function occurrenceFor(r: TemplateRecurrence, cal: WorkCalendar, nominal: string): Occurrence | null {
  let due = nominal;
  if (r.type === "daily") {
    // Daily picks its own weekdays; only holidays skip it.
    if (cal.holidays.has(nominal)) return null;
  } else {
    const step = r.holidayShift === "next" ? 1 : -1;
    let i = 0;
    while (!isWorkingDay(cal, due)) {
      if (++i > MAX_SHIFT_DAYS) return null; // no working day nearby (misconfigured calendar)
      due = addDaysKey(due, step);
    }
  }
  return { occurrenceDate: nominal, dueDate: due, createDate: addDaysKey(due, -r.leadDays) };
}

/**
 * Occurrences that should exist on `today`: creation day reached, due day not
 * yet passed. A day the cron/lazy run missed entirely is not back-filled once
 * its due day is over (old unfinished ones already show as overdue).
 */
export function occurrencesDueForCreation(r: TemplateRecurrence, cal: WorkCalendar, today: string): Occurrence[] {
  const out: Occurrence[] = [];
  const from = addDaysKey(today, -MAX_SHIFT_DAYS);
  const to = addDaysKey(today, r.leadDays + MAX_SHIFT_DAYS);
  for (let k = from; k <= to; k = addDaysKey(k, 1)) {
    if (!matchesRule(r, k)) continue;
    const occ = occurrenceFor(r, cal, k);
    if (occ && occ.createDate <= today && occ.dueDate >= today) out.push(occ);
  }
  return out;
}

/** Next `n` occurrences with dueDate >= `from` (for "Preview next 5 dates"). */
export function previewOccurrences(r: TemplateRecurrence, cal: WorkCalendar, from: string, n = 5): Occurrence[] {
  const out: Occurrence[] = [];
  const seen = new Set<string>();
  let k = addDaysKey(from, -MAX_SHIFT_DAYS);
  for (let i = 0; i < 800 + MAX_SHIFT_DAYS && out.length < n * 3; i++, k = addDaysKey(k, 1)) {
    if (!matchesRule(r, k)) continue;
    const occ = occurrenceFor(r, cal, k);
    if (occ && occ.dueDate >= from && !seen.has(occ.occurrenceDate)) { seen.add(occ.occurrenceDate); out.push(occ); }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, n);
}

/** "Daily (Mon-Sat)", "Weekly: Mon, Thu", "Monthly: 3, 4, Last day", "Yearly: 31 Mar". */
export function describeRecurrence(r: Pick<TemplateRecurrence, "type" | "daysOfWeek" | "datesOfMonth" | "monthDay" | "leadDays">): string {
  const days = [...(r.daysOfWeek || [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAY_SHORT[d]);
  let s: string;
  switch (r.type) {
    case "daily":
      s = days.join(",") === "Mon,Tue,Wed,Thu,Fri,Sat" ? "Daily (Mon-Sat)" : days.length === 7 ? "Daily (all days)" : `Daily (${days.join(", ")})`;
      break;
    case "weekly":
      s = `Weekly: ${days.join(", ")}`;
      break;
    case "monthly": {
      const nums = (r.datesOfMonth || []).filter((x): x is number => x !== "last").sort((a, b) => a - b).map(String);
      if ((r.datesOfMonth || []).includes("last")) nums.push("Last day");
      s = `Monthly: ${nums.join(", ")}`;
      break;
    }
    case "yearly":
      s = r.monthDay ? `Yearly: ${r.monthDay.day} ${MONTH_SHORT[r.monthDay.month - 1]}` : "Yearly";
      break;
  }
  return r.leadDays > 0 ? `${s} · ${r.leadDays} din pehle` : s;
}
