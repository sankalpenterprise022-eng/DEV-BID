// Schema reference only - login and the users API read the `users` collection
// directly via the mongodb driver (lib/mongodb.ts). Import/export added so the
// file is a valid module (the DEV OMS original had neither).
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    permissions: {
        boss: { type: Boolean, default: false },
        users: { type: Boolean, default: false },
        // Task module: manager role (admin is permissions.boss).
        taskManager: { type: Boolean, default: false },
    },
    // Task module: a manager's team = users whose managerUsername is theirs.
    managerUsername: { type: String, default: null },
    // Department _id (string) from the `departments` collection; drives department-wide fixed tasks.
    department: { type: String, default: null },});

export default mongoose.models.User || mongoose.model("User", userSchema);
