"use client";
import { useCallback, useEffect, useState } from "react";
import { FiRepeat, FiPlus, FiEdit2, FiTrash2 } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import type { DepartmentDTO, TaskTemplateDTO, TaskUserDTO } from "@/lib/tasks/types";
import { describeRecurrence } from "@/lib/tasks/recurrence";
import { notifyTasksChanged } from "@/lib/tasks/usePendingTaskCount";
import { ApiError, PRIORITY_META, api } from "../tasks/components/taskUi";
import TemplateModal from "./TemplateModal";

// Fixed (recurring) work: admin + manager. Each occurrence becomes a normal task
// per assignee (badge 🔁/📅/🗓️ in the task list).

export default function TemplatesPage() {
  const [rows, setRows] = useState<TaskTemplateDTO[]>([]);
  const [canUseDepartments, setCanUseDepartments] = useState(false);
  const [users, setUsers] = useState<TaskUserDTO[]>([]);
  const [departments, setDepartments] = useState<DepartmentDTO[]>([]);
  const [editing, setEditing] = useState<TaskTemplateDTO | "new" | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, u, d] = await Promise.all([
        api<{ templates: TaskTemplateDTO[]; canUseDepartments: boolean }>("/api/templates", ""),
        api<TaskUserDTO[]>("/api/tasks/users", ""),
        api<DepartmentDTO[]>("/api/departments", ""),
      ]);
      setRows(t.templates);
      setCanUseDepartments(t.canUseDepartments);
      setUsers(u);
      setDepartments(d);
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? e.message : "Templates load nahi hue", err: true });
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const deptName = (id: string) => departments.find((d) => d._id === id)?.name ?? "?";

  async function toggleActive(t: TaskTemplateDTO) {
    try {
      const r = await api<{ created: number }>(`/api/templates/${t._id}`, "", { method: "PATCH", body: { active: !t.active, expectedUpdatedAt: t.updatedAt } });
      setMsg({ text: `${t.active ? "Band kiya" : "Chalu kiya"}${r.created ? ` · ${r.created} task abhi bane` : ""}` });
      if (r.created) notifyTasksChanged();
      load();
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? e.message : "Update fail ho gaya", err: true });
    }
  }

  async function remove(t: TaskTemplateDTO) {
    if (!confirm(`"${t.title}" template delete karna hai?\nJo tasks ban chuke hain wo rahenge, aage naye nahi banenge.`)) return;
    try {
      await api(`/api/templates/${t._id}`, "", { method: "DELETE" });
      setMsg({ text: "Template delete ho gaya" });
      load();
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? e.message : "Delete fail ho gaya", err: true });
    }
  }

  return (
    <BlockGuard permission="taskManager" fallback={<NoAccess />}>
      <div className="p-4 md:p-8 bg-[#f3f6f9] min-h-screen">
        <div className="max-w-6xl mx-auto flex flex-col gap-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <div className="bg-[#0a2540] text-white p-4 rounded-2xl"><FiRepeat size={22} /></div>
              <div>
                <h1 className="text-2xl font-black uppercase tracking-tight text-[#0a2540]">Fixed Tasks</h1>
                <p className="text-[#ff9933] text-[10px] font-black tracking-widest uppercase">Daily · Weekly · Monthly · Yearly templates</p>
              </div>
            </div>
            <button type="button" onClick={() => setEditing("new")} className="flex items-center gap-2 bg-[#ff9933] hover:bg-[#f08a24] text-white text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl cursor-pointer">
              <FiPlus /> New
            </button>
          </div>

          {msg && (
            <p className={`text-xs font-bold rounded-xl p-3 border ${msg.err ? "text-red-600 bg-red-50 border-red-200" : "text-emerald-700 bg-emerald-50 border-emerald-200"}`}>{msg.text}</p>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#0a2540] text-white">
                <tr className="text-[10px] font-black uppercase tracking-widest text-left">
                  <th className="px-3 py-3">Title</th>
                  <th className="px-3 py-3">Schedule</th>
                  <th className="px-3 py-3">Kisko</th>
                  <th className="px-3 py-3">By</th>
                  <th className="px-3 py-3">Active</th>
                  <th className="px-3 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t._id} className={`border-t border-slate-100 ${t.active ? "" : "opacity-50"}`}>
                    <td className="px-3 py-2.5">
                      <p className="font-bold text-[#0a2540]">{t.title}</p>
                      <div className="flex gap-1 mt-1">
                        <span className={`text-[9px] font-black uppercase border rounded-full px-1.5 py-0.5 ${PRIORITY_META[t.priority].cls}`}>{PRIORITY_META[t.priority].label}</span>
                        {t.checklist.length > 0 && <span className="text-[9px] font-bold text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">{t.checklist.length} steps</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs font-bold text-indigo-700">
                      {describeRecurrence(t.recurrence)}
                      <span className="block text-[10px] text-slate-500 font-bold">Due {t.dueTime}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600 max-w-[260px]">
                      {t.departments.map((d) => (
                        <span key={d} className="inline-block mr-1 mb-1 text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">{deptName(d)}</span>
                      ))}
                      {t.assignees.join(", ")}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{t.createdBy}</td>
                    <td className="px-3 py-2.5">
                      <button type="button" disabled={!t.editable} onClick={() => toggleActive(t)} title={t.editable ? "On/Off" : "Sirf banane wala ya admin badal sakta hai"}
                        className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed ${t.active ? "bg-emerald-500" : "bg-slate-300"}`}>
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${t.active ? "left-5" : "left-0.5"}`} />
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {t.editable && (
                        <>
                          <button type="button" onClick={() => setEditing(t)} title="Edit" className="p-2 rounded-lg hover:bg-slate-100 cursor-pointer"><FiEdit2 size={14} /></button>
                          <button type="button" onClick={() => remove(t)} title="Delete" className="p-2 rounded-lg hover:bg-red-50 text-red-600 cursor-pointer"><FiTrash2 size={14} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={6} className="p-8 text-center text-xs font-black uppercase tracking-widest text-slate-400">{loaded ? "Abhi koi fixed task nahi - New dabao" : "Loading..."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">
            Tasks roz raat cron se (Phase 4) aur Tasks page khulne par apne aap bante hain. Ek din ka task dobara nahi banta.
            Purane adhoore fixed tasks open rehte hain aur overdue dikhte hain.
          </p>
        </div>
      </div>

      {editing && (
        <TemplateModal
          template={editing === "new" ? null : editing}
          users={users}
          departments={departments}
          canUseDepartments={canUseDepartments}
          onClose={() => setEditing(null)}
          onSaved={(text) => { setEditing(null); setMsg({ text }); notifyTasksChanged(); load(); }}
        />
      )}
    </BlockGuard>
  );
}

function NoAccess() {
  return (
    <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50">
      <p className="text-red-500 font-bold uppercase">You have no access for this page.</p>
    </div>
  );
}
