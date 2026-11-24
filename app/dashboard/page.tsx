import { redirect } from "next/navigation";

// Login sends users to /dashboard; this app's only dashboard is Tasks.
export default function DashboardHome() {
  redirect("/dashboard/tasks");
}
