"use client";
import { useCallback, useEffect, useState } from "react";
import { FiGrid, FiPlus, FiCheck, FiX, FiEdit2 } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import type { DepartmentDTO } from "@/lib/tasks/types";
import { ApiError, api } from "../tasks/components/taskUi";

// Admin: departments (Accounts, Dispatch, ...). Members are set per user on the
// Users page; a department's fixed (recurring) tasks go to all its members.

const inputCls = "p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#ff9933] text-sm";

export default function DepartmentsPage() {
  const [rows, setRows] = useState<DepartmentDTO[]>([]);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await api<DepartmentDTO[]>("/api/departments", "")); }
    catch (e) { setMsg({ text: e instanceof ApiError ? e.message : "Departments load nahi hue", err: true }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<any>, ok: string) {
    setBusy(true);
    setMsg(null);
    try { await fn(); setMsg({ text: ok }); await load(); return true; }
    catch (e) { setMsg({ text: e instanceof ApiError ? e.message : "Save fail ho gaya", err: true }); return false; }
    finally { setBusy(false); }
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await run(() => api("/api/departments", "", { method: "POST", body: { name } }), "Department ban gaya")) setName("");
  };
  const rename = async (d: DepartmentDTO) => {
    if (!editName.trim() || editName.trim() === d.name) { setEditId(null); return; }
    if (await run(() => api(`/api/departments/${d._id}`, "", { method: "PATCH", body: { name: editName } }), "Naam badal gaya")) setEditId(null);
  };
  const toggle = (d: DepartmentDTO) =>
    run(() => api(`/api/departments/${d._id}`, "", { method: "PATCH", body: { active: !d.active } }), d.active ? "Department band kiya" : "Department chalu kiya");

  return (
    <BlockGuard permission="boss" fallback={<NoAccess />}>
      <div className="p-4 md:p-8 bg-[#f3f6f9] min-h-screen">
        <div className="max-w-4xl mx-auto flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <div className="bg-[#0a2540] text-white p-4 rounded-2xl"><FiGrid size={22} /></div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-[#0a2540]">Departments</h1>
              <p className="text-[#ff9933] text-[10px] font-black tracking-widest uppercase">Team groups · Fixed tasks per department</p>
            </div>
          </div>

          <form onSubmit={add} className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col sm:flex-row gap-3">
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Naya department (jaise Purchase)" className={`${inputCls} flex-1`} />
            <button type="submit" disabled={busy || !name.trim()} className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-[#0a2540] text-white text-xs font-black uppercase tracking-wider disabled:opacity-50 cursor-pointer">
              <FiPlus /> Add
            </button>
          </form>

          {msg && (
            <p className={`text-xs font-bold rounded-xl p-3 border ${msg.err ? "text-red-600 bg-red-50 border-red-200" : "text-emerald-700 bg-emerald-50 border-emerald-200"}`}>{msg.text}</p>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#0a2540] text-white">
                <tr className="text-[10px] font-black uppercase tracking-widest text-left">
                  <th className="px-3 py-3">Department</th>
                  <th className="px-3 py-3">Members</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d._id} className={`border-t border-slate-100 ${d.active ? "" : "opacity-50"}`}>
                    <td className="px-3 py-2.5 font-bold text-[#0a2540]">
                      {editId === d._id ? (
                        <div className="flex items-center gap-1">
                          <input autoFocus value={editName} maxLength={60} onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") rename(d); if (e.key === "Escape") setEditId(null); }}
                            className={`${inputCls} py-1.5`} />
                          <button type="button" onClick={() => rename(d)} className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600 cursor-pointer"><FiCheck /></button>
                          <button type="button" onClick={() => setEditId(null)} className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"><FiX /></button>
                        </div>
                      ) : d.name}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {d.members.length ? d.members.join(", ") : <span className="text-slate-400">Koi nahi (Users page se add karo)</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-black uppercase border rounded-full px-2 py-0.5 ${d.active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                        {d.active ? "Active" : "Band"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button type="button" title="Rename" onClick={() => { setEditId(d._id); setEditName(d.name); }} className="p-2 rounded-lg hover:bg-slate-100 cursor-pointer"><FiEdit2 size={14} /></button>
                      <button type="button" disabled={busy} onClick={() => toggle(d)} className="text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-50 cursor-pointer disabled:opacity-50">
                        {d.active ? "Band karo" : "Chalu karo"}
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={4} className="p-8 text-center text-xs font-black uppercase tracking-widest text-slate-400">Loading...</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">
            User ka department <b>Users</b> page par set hota hai. Band department ke members ko us department ke naye fixed tasks nahi milte.
          </p>
        </div>
      </div>
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
