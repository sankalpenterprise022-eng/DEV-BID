"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiRefreshCw, FiUsers } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import type { BoardMemberDTO, BoardTaskDTO, TeamBoardDTO } from "@/lib/tasks/types";
import { ApiError, api, fmtDuration, relativeDue } from "../tasks/components/taskUi";

// Live team view (manager: own team, admin: everybody). Refreshes every 30 s
// (paused while the tab is hidden); running timers tick locally every second.

const REFRESH_MS = 30_000;

const STATE_META = {
  working: { label: "Working", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  paused: { label: "Paused", cls: "bg-orange-50 text-orange-700 border-orange-200", dot: "bg-orange-500" },
  idle: { label: "Idle", cls: "bg-slate-100 text-slate-500 border-slate-200", dot: "bg-slate-400" },
} as const;

const sinceSec = (iso: string | undefined, now: number) => (iso ? Math.max(0, (now - new Date(iso).getTime()) / 1000) : 0);

function TaskLine({ t, now, kind }: { t: BoardTaskDTO; now: number; kind: "working" | "paused" | "next" }) {
  const due = relativeDue(t);
  const session = sinceSec(t.sessionStart, now);
  return (
    <Link href={`/dashboard/tasks?task=${t._id}`} className={`block rounded-xl border px-3 py-2 hover:shadow-sm transition ${t.priority === "URGENT" ? "border-red-300 bg-red-50" : "border-slate-200 bg-slate-50/60"}`}>
      <p className={`text-xs font-bold truncate ${t.priority === "URGENT" ? "text-red-700" : "text-[#0a2540]"}`}>
        {t.priority === "URGENT" && "🚨 "}{t.title}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10px] font-bold text-slate-500">
        <span className="font-mono">{t.taskNo}</span>
        {kind === "working" && <span className="text-emerald-700">⏱ {fmtDuration(session)} abhi · total {fmtDuration(t.totalWorkSeconds + session)}</span>}
        {kind === "paused" && <span className="text-orange-700">⏸ {t.pauseReason || "Paused"}</span>}
        {kind === "next" && <span>Next: {t.status === "PAUSED" ? "paused" : "shuru nahi kiya"}</span>}
        <span className={due.overdue ? "text-red-600" : ""}>{due.text}</span>
      </div>
    </Link>
  );
}

function MemberCard({ m, now, deptName }: { m: BoardMemberDTO; now: number; deptName: (id: string | null) => string }) {
  const st = STATE_META[m.state];
  const running = m.working.reduce((s, t) => s + sinceSec(t.sessionStart, now), 0);
  const c = m.counts;
  const chip = (n: number, label: string, cls: string) =>
    n > 0 && <span className={`text-[10px] font-black uppercase tracking-wider border rounded-full px-2 py-0.5 ${cls}`}>{n} {label}</span>;
  return (
    <div className={`bg-white rounded-2xl border-2 p-4 flex flex-col gap-3 ${c.urgent ? "border-red-400" : c.overdue ? "border-amber-300" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-black text-[#0a2540] truncate">{m.username}</p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">{deptName(m.department)}</p>
        </div>
        <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider border rounded-full px-2.5 py-1 ${st.cls}`}>
          <span className="relative flex h-2 w-2">
            {m.state === "working" && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${st.dot}`} />
          </span>
          {st.label}
        </span>
      </div>

      <div className="space-y-1.5">
        {m.working.map((t) => <TaskLine key={t._id} t={t} now={now} kind="working" />)}
        {!m.working.length && m.paused.slice(0, 2).map((t) => <TaskLine key={t._id} t={t} now={now} kind="paused" />)}
        {!m.working.length && !m.paused.length && m.next && <TaskLine t={m.next} now={now} kind="next" />}
        {!m.working.length && !m.paused.length && !m.next && <p className="text-xs text-slate-400 italic">Koi pending kaam nahi</p>}
      </div>

      <div className="flex flex-wrap gap-1">
        {chip(c.urgent, "Urgent", "bg-red-600 text-white border-red-600")}
        {chip(c.overdue, "Overdue", "bg-red-50 text-red-700 border-red-200")}
        {chip(c.notSeen, "Not seen", "bg-rose-50 text-rose-600 border-rose-200")}
        {chip(c.open, "Open", "bg-sky-50 text-sky-700 border-sky-200")}
        {chip(c.paused, "Paused", "bg-orange-50 text-orange-700 border-orange-200")}
        {chip(c.waiting, "Waiting", "bg-violet-50 text-violet-700 border-violet-200")}
        {chip(c.doneToday, "Done aaj", "bg-emerald-50 text-emerald-700 border-emerald-200")}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-auto">Aaj ka kaam: <span className="text-[#0a2540]">{fmtDuration(m.workedTodaySeconds + running)}</span></p>
    </div>
  );
}

export default function TeamBoardPage() {
  const [data, setData] = useState<TeamBoardDTO | null>(null);
  const [error, setError] = useState("");
  const [dept, setDept] = useState("");
  const [q, setQ] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  // Server time vs this device's clock, so timers don't drift when the PC clock is off.
  const skew = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<TeamBoardDTO>("/api/team-board", "");
      skew.current = new Date(d.generatedAt).getTime() - Date.now();
      setData(d);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Team board load nahi hua");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now() + skew.current), 1000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(refresh); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  const deptName = useCallback(
    (id: string | null) => (id ? data?.departments.find((d) => d._id === id)?.name || "?" : "No department"),
    [data]
  );

  const members = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.members || []).filter((m) =>
      (!dept || (dept === "-" ? !m.department : m.department === dept)) &&
      (!needle || m.username.toLowerCase().includes(needle) || m.working.some((t) => t.title.toLowerCase().includes(needle))) &&
      (!problemsOnly || m.counts.urgent + m.counts.overdue + m.counts.notSeen > 0)
    );
  }, [data, dept, q, problemsOnly]);

  const sum = useMemo(() => {
    const s = { working: 0, paused: 0, idle: 0, urgent: 0, overdue: 0, notSeen: 0, doneToday: 0 };
    for (const m of members) {
      s[m.state]++;
      s.urgent += m.counts.urgent; s.overdue += m.counts.overdue; s.notSeen += m.counts.notSeen; s.doneToday += m.counts.doneToday;
    }
    return s;
  }, [members]);

  const stat = (n: number, label: string, cls: string) => (
    <div className={`rounded-2xl border px-4 py-3 ${cls}`}>
      <p className="text-2xl font-black leading-none">{n}</p>
      <p className="text-[10px] font-black uppercase tracking-widest mt-1 opacity-80">{label}</p>
    </div>
  );

  return (
    <BlockGuard
      permission="taskManager"
      fallback={<p className="m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-red-500 font-bold uppercase">Team board sirf manager/admin ke liye hai.</p>}
    >
      <div className="p-4 md:p-8 bg-[#f3f6f9] min-h-full">
        <div className="max-w-7xl mx-auto flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="bg-[#0a2540] text-white p-4 rounded-2xl"><FiUsers size={22} /></div>
            <div className="flex-1">
              <h1 className="text-2xl font-black uppercase tracking-tight text-[#0a2540]">Team Board</h1>
              <p className="text-[#ff9933] text-[10px] font-black tracking-widest uppercase">
                Live · har 30 sec refresh{data && ` · updated ${new Date(data.generatedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}`}
              </p>
            </div>
            <button type="button" onClick={load} disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-[11px] font-black uppercase tracking-wider cursor-pointer disabled:opacity-50">
              <FiRefreshCw className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>

          {error && <p className="text-xs font-bold rounded-xl p-3 border text-red-600 bg-red-50 border-red-200">{error}</p>}

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {stat(sum.working, "Working now", "bg-emerald-50 border-emerald-200 text-emerald-800")}
            {stat(sum.paused, "Paused", "bg-orange-50 border-orange-200 text-orange-800")}
            {stat(sum.idle, "Idle", "bg-white border-slate-200 text-slate-600")}
            {stat(sum.urgent, "Urgent pending", "bg-red-600 border-red-600 text-white")}
            {stat(sum.overdue, "Overdue", "bg-red-50 border-red-200 text-red-700")}
            {stat(sum.notSeen, "Not seen", "bg-rose-50 border-rose-200 text-rose-700")}
            {stat(sum.doneToday, "Done aaj", "bg-white border-slate-200 text-[#0a2540]")}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Naam ya task search..." className="p-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white w-56" />
            {!!data?.departments.length && (
              <select value={dept} onChange={(e) => setDept(e.target.value)} className="p-2.5 border border-slate-200 rounded-xl text-sm bg-white">
                <option value="">Sab departments</option>
                {data.departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
                <option value="-">No department</option>
              </select>
            )}
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
              <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} /> Sirf problem wale (urgent / overdue / not seen)
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {members.map((m) => <MemberCard key={m.username} m={m} now={now} deptName={deptName} />)}
          </div>
          {data && !members.length && <p className="p-10 text-center text-xs font-black uppercase tracking-widest text-slate-400">Koi member nahi mila</p>}
          {!data && !error && <p className="p-10 text-center text-xs font-black uppercase tracking-widest text-slate-400">Loading...</p>}
        </div>
      </div>
    </BlockGuard>
  );
}
