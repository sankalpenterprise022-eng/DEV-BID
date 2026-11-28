"use client";
import type { TaskDTO } from "@/lib/tasks/types";
import {
  CATEGORY_LABEL, PRIORITY_META, STATUS_META, TaskCtx, checklistPct, fmtDateTime, fmtDuration, isNotSeen, isUrgentActive, relativeDue,
  taskKindBadge, workSecondsNow,
} from "./taskUi";

interface Props {
  tasks: TaskDTO[];
  ctx: TaskCtx;
  loading: boolean;
  selectable: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onOpen: (id: string) => void;
  onQuick: (task: TaskDTO, action: QuickAction) => void;
  /** Assignee taps "Dekh liya" on a not-seen row. */
  onSeen: (task: TaskDTO) => void;
}

export type QuickAction = "start" | "resume" | "done" | "verify";

export default function TaskTable({ tasks, ctx, loading, selectable, selected, onToggle, onToggleAll, onOpen, onQuick, onSeen }: Props) {
  const mgr = ctx.role !== "staff";
  const allChecked = tasks.length > 0 && tasks.every((t) => selected.has(t._id));
  // Firm is optional (no longer captured on new tasks) - only show the column when some row has one.
  const showFirm = tasks.some((t) => t.firm);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto xl:overflow-visible">
        <table className="w-full text-sm table-fixed xl:table-auto">
          <thead className="bg-[#0a2540] text-white sticky top-0 z-10">
            <tr className="text-[10px] font-black uppercase tracking-widest text-left">
              {selectable && (
                <th className="w-9 px-3 py-3">
                  <input type="checkbox" checked={allChecked} onChange={(e) => onToggleAll(e.target.checked)} className="cursor-pointer" />
                </th>
              )}
              <th className="px-3 py-3 w-32">Task No</th>
              <th className="px-3 py-3">Title</th>
              {showFirm && <th className="px-3 py-3 hidden xl:table-cell">Firm</th>}
              <th className="px-3 py-3 w-28">Assignee</th>
              <th className="px-3 py-3 w-24">Priority</th>
              <th className="px-3 py-3 w-36">Due</th>
              <th className="px-3 py-3 w-32">Status</th>
              <th className="px-3 py-3 w-24 hidden md:table-cell">Progress</th>
              <th className="px-3 py-3 w-28 hidden lg:table-cell">Next F/U</th>
              <th className="px-3 py-3 w-24 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const due = relativeDue(t);
              const links = [t.links?.gemOrderNo && `Order ${t.links.gemOrderNo}`, t.links?.bidNo && `Bid ${t.links.bidNo}`, t.links?.billNo && `Bill ${t.links.billNo}`, t.links?.buyerName]
                .filter(Boolean) as string[];
              const own = t.assignee === ctx.me;
              const canAct = mgr || own;
              const quick: QuickAction | null =
                t.status === "OPEN" && canAct ? "start"
                : t.status === "PAUSED" && canAct ? "resume"
                : (t.status === "IN_PROGRESS" || t.status === "WAITING") && canAct ? "done"
                : t.status === "DONE" && mgr ? "verify"
                : null;
              const notSeen = isNotSeen(t);
              const pct = checklistPct(t);
              const working = t.status === "IN_PROGRESS";
              const worked = workSecondsNow(t);
              const urgent = isUrgentActive(t);
              return (
                <tr
                  key={t._id}
                  onClick={() => onOpen(t._id)}
                  className={`border-t cursor-pointer border-l-4 ${
                    urgent ? "border-red-200 border-l-red-600 bg-red-100/70 hover:bg-red-100"
                    : due.overdue ? "border-slate-100 border-l-red-500 bg-red-50/30 hover:bg-slate-50"
                    : "border-slate-100 border-l-transparent hover:bg-slate-50"
                  }`}
                >
                  {selectable && (
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(t._id)} onChange={() => onToggle(t._id)} className="cursor-pointer" />
                    </td>
                  )}
                  <td className="px-3 py-3 font-mono text-[11px] font-bold text-slate-500">{t.taskNo}</td>
                  <td className="px-3 py-3 min-w-0">
                    <p className={`font-bold truncate ${urgent ? "text-red-700" : "text-[#0a2540]"}`}>{urgent && "🚨 "}{t.title}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(() => {
                        const k = taskKindBadge(t);
                        return <span title={k.title} className={`text-[9px] font-black uppercase tracking-wider border rounded px-1.5 py-0.5 whitespace-nowrap ${k.cls}`}>{k.label}</span>;
                      })()}
                      {t.category !== "GENERAL" && (
                        <span className="hidden xl:inline text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{CATEGORY_LABEL(t.category)}</span>
                      )}
                      {links.map((l) => (
                        <span key={l} className="text-[9px] font-bold bg-sky-50 text-sky-700 border border-sky-100 rounded px-1.5 py-0.5 truncate max-w-[10rem]">{l}</span>
                      ))}
                    </div>
                  </td>
                  {showFirm && <td className="px-3 py-3 hidden xl:table-cell text-xs text-slate-600 truncate">{t.firm}</td>}
                  <td className="px-3 py-3 text-xs font-bold text-slate-700">
                    <p className="truncate">{t.assignee}</p>
                    {notSeen && (
                      own ? (
                        <button type="button" onClick={(e) => { e.stopPropagation(); onSeen(t); }} title="Tap karo: maine dekh liya"
                          className="mt-1 text-[9px] font-black uppercase tracking-wider bg-rose-600 text-white rounded-full px-2 py-0.5 cursor-pointer hover:bg-rose-700">
                          👁 Dekh liya
                        </button>
                      ) : (
                        <span title="Assignee ne abhi tak task khola nahi" className="mt-1 inline-block text-[9px] font-black uppercase tracking-wider bg-rose-50 text-rose-600 border border-rose-200 rounded-full px-2 py-0.5">
                          Not seen
                        </span>
                      )
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`text-[10px] font-black uppercase border rounded-full px-2 py-0.5 ${urgent ? "bg-red-600 text-white border-red-600 animate-pulse" : PRIORITY_META[t.priority].cls}`}>{PRIORITY_META[t.priority].label}</span>
                  </td>
                  <td className={`px-3 py-3 text-xs font-bold ${due.overdue ? "text-red-600" : "text-slate-600"}`}>{due.text}</td>
                  <td className="px-3 py-3">
                    <span className={`text-[10px] font-black uppercase border rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS_META[t.status].cls}`}>{STATUS_META[t.status].label}</span>
                    {working && (
                      <span className="mt-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-emerald-600" title="Abhi is par kaam chal raha hai">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        Working now
                      </span>
                    )}
                    {!working && worked > 0 && <span className="mt-1 block text-[9px] font-bold text-slate-400">⏱ {fmtDuration(worked)}</span>}
                  </td>
                  <td className="px-3 py-3 hidden md:table-cell">
                    {pct === null ? <span className="text-[10px] text-slate-300">-</span> : (
                      <div title={`Checklist ${pct}%`}>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full ${pct === 100 ? "bg-emerald-500" : "bg-sky-500"}`} style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-[9px] font-bold text-slate-500 mt-0.5">{pct}%</p>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 hidden lg:table-cell text-[11px] text-slate-500">{t.nextFollowUpAt ? fmtDateTime(t.nextFollowUpAt) : "-"}</td>
                  <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {quick && (
                      <button
                        type="button"
                        onClick={() => onQuick(t, quick)}
                        className="text-[10px] font-black uppercase tracking-wider bg-[#ff9933]/15 hover:bg-[#ff9933]/30 text-[#c2410c] border border-[#ff9933]/40 rounded-full px-3 py-1 cursor-pointer"
                      >
                        {quick === "start" ? "Start" : quick === "resume" ? "Resume" : quick === "done" ? "Done" : "Verify"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!tasks.length && (
        <p className="p-10 text-center text-xs font-black uppercase tracking-widest text-slate-400">
          {loading ? "Loading..." : "Koi task nahi mila"}
        </p>
      )}
    </div>
  );
}
