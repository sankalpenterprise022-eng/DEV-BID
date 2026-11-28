import TaskSettings from "@/models/TaskSettings";
import Holiday from "@/models/Holiday";
import { istDateKey, weekdayOfKey } from "@/lib/tasks/ist";

// Work hours from the single TaskSettings doc (_id "default"). Non-urgent
// reminders only go out inside them; urgent ones always go.

export interface WorkSettings {
  workStartHour: number;
  workEndHour: number;
  workingDays: number[];
}

const DEFAULTS: WorkSettings = { workStartHour: 10, workEndHour: 19, workingDays: [1, 2, 3, 4, 5, 6] };

export async function getTaskSettings(): Promise<WorkSettings> {
  const s: any = await TaskSettings.findById("default").lean();
  return {
    workStartHour: typeof s?.workStartHour === "number" ? s.workStartHour : DEFAULTS.workStartHour,
    workEndHour: typeof s?.workEndHour === "number" ? s.workEndHour : DEFAULTS.workEndHour,
    workingDays: Array.isArray(s?.workingDays) && s.workingDays.length ? s.workingDays : DEFAULTS.workingDays,
  };
}

/** Minutes since IST midnight. */
export function istMinutes(now: Date = new Date()): number {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** Working day (TaskSettings.workingDays, not a holiday) for IST date of `now`. */
export async function isWorkingDayNow(s: WorkSettings, now: Date = new Date()): Promise<boolean> {
  const key = istDateKey(now);
  if (!s.workingDays.includes(weekdayOfKey(key))) return false;
  return !(await Holiday.exists({ date: key }));
}

/** Inside work hours right now (IST): working day and workStartHour <= time < workEndHour. */
export async function isWorkTime(s: WorkSettings, now: Date = new Date()): Promise<boolean> {
  const m = istMinutes(now);
  if (m < s.workStartHour * 60 || m >= s.workEndHour * 60) return false;
  return isWorkingDayNow(s, now);
}
