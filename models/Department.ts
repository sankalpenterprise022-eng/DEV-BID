// @/models/Department.ts
// users.department holds a department _id (as string). Seeded on first read
// (see lib/tasks/orgService.ts listDepartments).
import { Schema, model, models } from "mongoose";

const DepartmentSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 60 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "departments" }
);

export default models.Department || model("Department", DepartmentSchema);
