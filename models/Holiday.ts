// @/models/Holiday.ts
// `date` is the IST calendar date "YYYY-MM-DD" (not a Date) so there is no
// timezone ambiguity. Used by recurring-task generation (lib/tasks/recurrence.ts).
// Note: TaskSettings.holidays (schema-only, never used) is superseded by this collection.
import { Schema, model, models } from "mongoose";

const HolidaySchema = new Schema(
  {
    date: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    createdBy: String,
  },
  { timestamps: true, collection: "holidays" }
);

export default models.Holiday || model("Holiday", HolidaySchema);
