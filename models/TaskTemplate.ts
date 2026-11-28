// @/models/TaskTemplate.ts
// Fixed (recurring) work. generateRecurringTasks (lib/tasks/templateService.ts)
// turns each occurrence into a normal Task per assignee. Rules: lib/tasks/recurrence.ts.
import { Schema, model, models } from "mongoose";

const RecurrenceSchema = new Schema(
  {
    type: { type: String, enum: ["daily", "weekly", "monthly", "yearly"], required: true },
    daysOfWeek: { type: [Number], default: [] },
    datesOfMonth: { type: [Schema.Types.Mixed], default: [] }, // numbers 1-31 and/or "last"
    monthDay: { month: Number, day: Number },
    leadDays: { type: Number, default: 0 },
    holidayShift: { type: String, enum: ["previous", "next"], default: "previous" },
  },
  { _id: false }
);

const TaskTemplateSchema = new Schema(
  {
    title: { type: String, required: true, maxlength: 200, trim: true },
    description: { type: String, maxlength: 5000, default: "" },
    category: {
      type: String,
      enum: ["ORDER", "DELIVERY", "BILLING", "PAYMENT_FOLLOWUP", "BID", "GEM_CATALOGUE", "DOCUMENT", "PURCHASE", "ACCOUNTS", "GENERAL"],
      default: "GENERAL",
    },
    priority: { type: String, enum: ["LOW", "NORMAL", "HIGH", "URGENT"], default: "NORMAL" },
    checklist: { type: [String], default: [] },
    assignees: { type: [String], default: [] }, // usernames
    departments: { type: [String], default: [] }, // department _ids
    dueTime: { type: String, default: "18:00", match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    requiresVerification: { type: Boolean, default: true },
    recurrence: { type: RecurrenceSchema, required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: String, required: true },
  },
  { timestamps: true, collection: "task_templates" }
);

TaskTemplateSchema.index({ active: 1 });

export default models.TaskTemplate || model("TaskTemplate", TaskTemplateSchema);
