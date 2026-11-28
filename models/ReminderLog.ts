// @/models/ReminderLog.ts
// One row per reminder that was sent. `key` is unique (e.g. "due30:<taskId>:<dueMs>"),
// so inserting it first "claims" the reminder: a second cron tick (or a parallel
// one) gets a duplicate-key error and sends nothing. Rows expire after 90 days.
import { Schema, model, models } from "mongoose";

const ReminderLogSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    kind: { type: String, required: true }, // NEW | URGENT | NOT_SEEN | DUE_SOON | OVERDUE | ESCALATE | FOLLOWUP | SUMMARY | RECURRING
    taskId: { type: String, default: null },
    to: { type: [String], default: [] },
    sentAt: { type: Date, default: Date.now },
  },
  { collection: "reminder_log" }
);

ReminderLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default models.ReminderLog || model("ReminderLog", ReminderLogSchema);
