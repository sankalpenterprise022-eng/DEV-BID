"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FiBarChart2, FiDownload } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import type { MonthlyReportDTO, ReportRowDTO } from "@/lib/tasks/types";
import { ApiError, api, fmtDuration } from "../tasks/components/taskUi";

// Monthly report (admin): per user and per department, with CSV export.

type SortKey = keyof Pick<ReportRowDTO, "name" | "assigned" | "dueInMonth" | "completed" | "onTimePct" | "pendingOverdue" | "rejected" | "workSeconds" | "avgCompletionHours" | "fixedDue">;

const COLS: { key: SortKey; label: string; title: string }[] = [
  { key: "assigned", label: "Assigned", title: "Is mahine bane (assign hue) tasks" },
  { key: "dueInMonth", label: "Due", title: "Is mahine due tasks (cancelled chhod ke)" },
  { key: "completed", label: "Done", title: "Is mahine complete kiye" },
  { key: "onTimePct", label: "On time", title: "Done mein se due date se pehle kitne (%)" },
  { key: "pendingOverdue", label: "Pending overdue", title: "Is mahine due the, abhi tak pending" },
  { key: "rejected", label: "Rejected", title: "Kitni baar kaam reject hua (rework)" },
  { key: "fixedDue", label: "Fixed tasks", title: "Fixed (recurring) tasks: done / due" },
  { key: "workSeconds", label: "Work time", title: "Is mahine log hua kaam ka time (Start→Pause/Done)" },
  { key: "avgCompletionHours", label: "Avg time", title: "Task banne se Done tak average (ghante)" },
];

const thisMonth = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
const pctCls = (p: number | null) => (p === null ? "text-slate-300" : p >= 90 ? "text-emerald-600" : p >= 70 ? "text-amber-600" : "text-red-600");
const hours = (h: number | null) => (h === null ? "-" : h < 24 ? `${h}h` : `${Math.round((h / 24) * 10) / 10}d`);

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote when needed; neutralise spreadsheet formulas (=, +, -, @) in names.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function downloadCsv(report: MonthlyReportDTO, tab: "users" | "departments", deptName: (id?: string | null) => string) {
  const head = [tab === "users" ? "User" : "Department", ...(tab === "users" ? ["Department"] : []),
    "Assigned", "Due", "Done", "On time", "Late", "On time %", "Pending overdue", "Rejected", "Urgent done",
    "Fixed due", "Fixed done", "Work hours", "Avg completion hours"];
  const line = (r: ReportRowDTO) => [r.name, ...(tab === "users" ? [deptName(r.department)] : []),
    r.assigned, r.dueInMonth, r.completed, r.onTime, r.late, r.onTimePct ?? "", r.pendingOverdue, r.rejected, r.urgentDone,
    r.fixedDue, r.fixedDone, Math.round((r.workSeconds / 3600) * 100) / 100, r.avgCompletionHours ?? ""];
  const rows = [head, ...report[tab].map(line), line({ ...report.total, department: null })];
  const csv = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"); // BOM: Excel opens UTF-8 correctly
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `task-report-${report.month}-${tab}.csv` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [month, setMonth] = useState(thisMonth);
  const [tab, setTab] = useState<"users" | "departments">("users");
  const [report, setReport] = useState<MonthlyReportDTO | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "completed", dir: -1 });
  const [hideEmpty, setHideEmpty] = useState(true);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      setReport(await api<MonthlyReportDTO>(`/api/reports/monthly?month=${encodeURIComponent(m)}`, ""));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Report load nahi hua");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (/^\d{4}-\d{2}$/.test(month)) load(month); }, [month, load]);
  useEffect(() => {
    api<{ _id: string; name: string }[]>("/api/departments", "").then((d) => setNames(new Map(d.map((x) => [x._id, x.name])))).catch(() => {});
  }, []);
  const deptName = useCallback((id?: string | null) => (id ? names.get(id) || "?" : "-"), [names]);

  const rows = useMemo(() => {
    const list = (report?.[tab] || []).filter((r) => !hideEmpty || r.assigned + r.dueInMonth + r.completed + r.workSeconds + r.pendingOverdue > 0);
    const val = (r: ReportRowDTO) => (sort.key === "name" ? r.name.toLowerCase() : r[sort.key] ?? -1);
    return [...list].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [report, tab, sort, hideEmpty]);

  const th = (key: SortKey, label: string, title = "") => (
    <th key={key} title={title} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === "name" ? 1 : -1 }))}
      className="px-3 py-3 cursor-pointer select-none whitespace-nowrap text-right first:text-left hover:text-[#ff9933]">
      {label}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );

  const cells = (r: ReportRowDTO, bold = false) => (
    <>
      <td className="px-3 py-2.5 text-right">{r.assigned}</td>
      <td className="px-3 py-2.5 text-right">{r.dueInMonth}</td>
      <td className="px-3 py-2.5 text-right font-black text-[#0a2540]">{r.completed}</td>
      <td className={`px-3 py-2.5 text-right font-black ${pctCls(r.onTimePct)}`} title={`${r.onTime} on time, ${r.late} late`}>
        {r.onTimePct === null ? "-" : `${r.onTimePct}%`}
      </td>
      <td className={`px-3 py-2.5 text-right ${r.pendingOverdue ? "text-red-600 font-black" : ""}`}>{r.pendingOverdue}</td>
      <td className={`px-3 py-2.5 text-right ${r.rejected ? "text-orange-600 font-bold" : ""}`}>{r.rejected}</td>
      <td className="px-3 py-2.5 text-right">{r.fixedDue ? `${r.fixedDone}/${r.fixedDue}` : "-"}</td>
      <td className="px-3 py-2.5 text-right">{r.workSeconds ? fmtDuration(r.workSeconds) : "-"}</td>
      <td className={`px-3 py-2.5 text-right ${bold ? "" : "text-slate-500"}`}>{hours(r.avgCompletionHours)}</td>
    </>
  );

  return (
    <BlockGuard
      permission="boss"
      fallback={<p className="m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-red-500 font-bold uppercase">Reports sirf admin ke liye hain.</p>}
    >
      <div className="p-4 md:p-8 bg-[#f3f6f9] min-h-full">
        <div className="max-w-7xl mx-auto flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="bg-[#0a2540] text-white p-4 rounded-2xl"><FiBarChart2 size={22} /></div>
            <div className="flex-1">
              <h1 className="text-2xl font-black uppercase tracking-tight text-[#0a2540]">Monthly Report</h1>
              <p className="text-[#ff9933] text-[10px] font-black tracking-widest uppercase">User · Department · CSV</p>
            </div>
            <input type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} className="p-2.5 border border-slate-200 rounded-xl text-sm bg-white font-bold" />
            <button type="button" disabled={!report} onClick={() => report && downloadCsv(report, tab, deptName)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0a2540] text-white text-[11px] font-black uppercase tracking-wider cursor-pointer disabled:opacity-50">
              <FiDownload /> CSV export
            </button>
          </div>

          {error && <p className="text-xs font-bold rounded-xl p-3 border text-red-600 bg-red-50 border-red-200">{error}</p>}

          {report && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {[
                [report.total.assigned, "Assigned"],
                [report.total.completed, "Done"],
                [report.total.onTimePct === null ? "-" : `${report.total.onTimePct}%`, "On time"],
                [report.total.pendingOverdue, "Pending overdue"],
                [fmtDuration(report.total.workSeconds), "Work time"],
              ].map(([v, l]) => (
                <div key={String(l)} className="bg-white rounded-2xl border border-slate-200 px-4 py-3">
                  <p className="text-2xl font-black text-[#0a2540] leading-none">{v}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mt-1">{l}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {(["users", "departments"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-full text-[11px] font-black uppercase tracking-wider border cursor-pointer ${tab === t ? "bg-[#0a2540] text-white border-[#0a2540]" : "bg-white text-slate-600 border-slate-200"}`}>
                {t === "users" ? "Per user" : "Per department"}
              </button>
            ))}
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none ml-2">
              <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Khaali rows chhupao
            </label>
            {loading && <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loading...</span>}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#0a2540] text-white">
                <tr className="text-[10px] font-black uppercase tracking-widest">
                  {th("name", tab === "users" ? "User" : "Department")}
                  {tab === "users" && <th className="px-3 py-3 text-left">Dept</th>}
                  {COLS.map((c) => th(c.key, c.label, c.title))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key || "-"} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-bold text-[#0a2540]">{r.name}</td>
                    {tab === "users" && <td className="px-3 py-2.5 text-xs text-slate-500">{deptName(r.department)}</td>}
                    {cells(r)}
                  </tr>
                ))}
                {report && (
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-black">
                    <td className="px-3 py-2.5 text-[#0a2540] uppercase text-xs tracking-wider">Total</td>
                    {tab === "users" && <td />}
                    {cells(report.total, true)}
                  </tr>
                )}
              </tbody>
            </table>
            {report && !rows.length && <p className="p-8 text-center text-xs font-black uppercase tracking-widest text-slate-400">Is mahine koi data nahi</p>}
          </div>
          <p className="text-[11px] text-slate-500">
            On time = Done tasks jo due date se pehle complete hue. Work time = Start se Pause/Done tak ka log hua time (Phase 2 ke baad ke tasks).
            Column header par click karke sort karo.
          </p>
        </div>
      </div>
    </BlockGuard>
  );
}
