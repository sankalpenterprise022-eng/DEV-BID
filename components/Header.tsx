"use client";
import { FiLogOut, FiCheckSquare, FiAlertTriangle, FiSettings } from "react-icons/fi";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePendingTaskCount } from "@/lib/tasks/usePendingTaskCount";

type SessionUser = { username: string; permissions?: Record<string, boolean> };

const HARDCODED_ADMINS = ["admin", "chintan", "hitesh"];

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const { count: pendingTasks, pulse: pendingPulse } = usePendingTaskCount(user?.username ?? null);

  const handleLogout = () => {
    localStorage.removeItem("oms_user");
    setUser(null);
    router.push("/login");
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const session = localStorage.getItem("oms_user");
    if (!session) {
      router.push("/login");
      return;
    }

    try {
      setUser(JSON.parse(session));
    } catch (e) {
      // Handles rare cases of corrupted local storage on mobile
      router.push("/login");
      return;
    }

    let logoutTimer: ReturnType<typeof setTimeout> | undefined;

    const resetTimer = () => {
      if (logoutTimer) clearTimeout(logoutTimer);
      // 120 minutes of inactivity -> logout
      logoutTimer = setTimeout(() => {
        handleLogout();
        alert("Session expired due to inactivity.");
      }, 2 * 60 * 60 * 1000);
    };

    const activityEvents = ["touchstart", "mousedown", "click", "keydown", "scroll"];
    activityEvents.forEach((event) => {
      window.addEventListener(event, resetTimer, { passive: true });
    });

    resetTimer();

    return () => {
      if (logoutTimer) clearTimeout(logoutTimer);
      activityEvents.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const isAdmin = !!user && (HARDCODED_ADMINS.includes(user.username.toLowerCase()) || user.permissions?.boss === true);
  const canManageUsers = isAdmin || user?.permissions?.users === true;
  const pill = (active: boolean) =>
    `text-[10px] md:text-xs font-black uppercase tracking-wider px-2 sm:px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 border ${
      active ? "bg-white/15 text-white border-white/30" : "bg-white/5 hover:bg-white/10 text-slate-300 border-white/10"
    }`;

  return (
    <header className="bg-[#0a2540] text-white px-3 md:px-6 py-2.5 flex items-center justify-between gap-3 shrink-0">
      <Link href="/dashboard/tasks" className="font-black uppercase tracking-tight text-sm md:text-base">
        Dev <span className="text-[#ff9933]">Task OMS</span>
      </Link>

      <nav className="flex items-center gap-2">
        {/* Tasks - assign / track / follow-up module */}
        <Link
          href="/dashboard/tasks"
          className="relative text-[10px] md:text-xs font-black uppercase tracking-wider bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/35 px-2 sm:px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 cursor-pointer focus:outline-none"
          title={pendingTasks > 0 ? `Tasks (${pendingTasks} pending)` : "Tasks"}
        >
          <FiCheckSquare size={13} /> <span className="hidden sm:inline">Tasks</span>
          {pendingTasks > 0 && (
            <span
              className={`absolute -top-2 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black leading-[18px] text-center border border-[#0a2540] ${pendingPulse ? "animate-pulse" : ""}`}
            >
              {pendingTasks > 99 ? "99+" : pendingTasks}
            </span>
          )}
        </Link>

        {isAdmin && (
          <Link href="/dashboard/urgent-tasks" className={pill(pathname === "/dashboard/urgent-tasks")} title="Urgent Tasks">
            <FiAlertTriangle size={13} /> <span className="hidden sm:inline">Urgent</span>
          </Link>
        )}
        {canManageUsers && (
          <Link href="/dashboard/settings" className={pill(pathname === "/dashboard/settings")} title="Users / Settings">
            <FiSettings size={13} /> <span className="hidden sm:inline">Users</span>
          </Link>
        )}

        {user && <span className="hidden md:inline text-xs font-bold text-slate-300 ml-2">{user.username}</span>}
        <button
          type="button"
          onClick={handleLogout}
          title="Logout"
          className="p-2 rounded-full bg-white/5 hover:bg-red-500/30 border border-white/10 cursor-pointer"
        >
          <FiLogOut size={14} />
        </button>
      </nav>
    </header>
  );
}
