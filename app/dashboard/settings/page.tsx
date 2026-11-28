"use client";
import { useCallback, useEffect, useState } from "react";
import { FiEdit2, FiTrash2, FiUsers } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

// Minimal user-access page: create / edit / delete users, and set the two
// fields the task module needs - permissions.taskManager and managerUsername.

type Perms = { boss: boolean; taskManager: boolean; users: boolean };
interface UserRow {
  _id: string;
  username: string;
  password?: string;
  permissions?: Partial<Perms>;
  managerUsername?: string | null;
  department?: string | null;
}

const initialState = {
  username: "",
  password: "",
  managerUsername: "",
  department: "",
  permissions: { boss: false, taskManager: false, users: false } as Perms,
};

const PERMISSION_FIELDS: { key: keyof Perms; label: string }[] = [
  { key: "boss", label: "Super Admin Bypass (Full Access)" },
  { key: "taskManager", label: "Task Manager (assign, verify, team tasks)" },
  { key: "users", label: "Settings / User Access Page" },
];

const inputCls = "p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm";

export default function SettingsPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [formData, setFormData] = useState(initialState);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; err?: boolean } | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setUsers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setMessage({ text: err?.message || "Users load nahi hue", err: true });
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const [departments, setDepartments] = useState<{ _id: string; name: string; active: boolean }[]>([]);
  useEffect(() => {
    fetch("/api/departments", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setDepartments(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);
  const deptName = (id?: string | null) => (id ? departments.find((d) => d._id === id)?.name ?? "?" : "-");

  const reset = () => { setFormData(initialState); setEditingId(null); };

  const startEdit = (u: UserRow) => {
    setEditingId(u._id);
    setFormData({
      username: u.username,
      password: "", // never sent by the API; blank = keep current password
      managerUsername: u.managerUsername || "",
      department: u.department || "",
      permissions: {
        boss: u.permissions?.boss || false,
        taskManager: u.permissions?.taskManager || false,
        users: u.permissions?.users || false,
      },
    });
    setMessage(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.username.trim() || (!editingId && !formData.password)) {
      setMessage({ text: "Username aur password zaroori hain", err: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const existing = editingId ? users.find((u) => u._id === editingId) : null;
      const body = {
        ...formData,
        username: formData.username.trim(),
        managerUsername: formData.managerUsername.trim() || null,
        department: formData.department || null,
        // keep any permission keys this page doesn't show
        permissions: { ...(existing?.permissions || {}), ...formData.permissions },
      };
      const res = await fetch(editingId ? `/api/users/${editingId}` : "/api/users", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save fail ho gaya");
      setMessage({ text: editingId ? "User update ho gaya" : "User ban gaya" });
      reset();
      fetchUsers();
    } catch (err: any) {
      setMessage({ text: err.message || "Save fail ho gaya", err: true });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (u: UserRow) => {
    if (!confirm(`User "${u.username}" delete karna hai?`)) return;
    const res = await fetch(`/api/users/${u._id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setMessage({ text: data.error || "Delete fail ho gaya", err: true });
    else { if (editingId === u._id) reset(); fetchUsers(); }
  };

  return (
    <BlockGuard
      permission="users"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50">
          <p className="text-red-500 font-bold uppercase">You have no access for this page.</p>
        </div>
      }
    >
      <div className="p-4 md:p-8 bg-[#f3f6f9] min-h-screen">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <div className="bg-[#0a2540] text-white p-4 rounded-2xl"><FiUsers size={22} /></div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-[#0a2540]">Users</h1>
              <p className="text-[#ff9933] text-[10px] font-black tracking-widest uppercase">Access · Task roles · Teams</p>
            </div>
          </div>

          <form onSubmit={save} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-xs font-black uppercase tracking-wider text-[#0a2540]">
              {editingId ? `Edit user: ${formData.username}` : "New user"}
            </h2>
            {message && (
              <p className={`text-xs font-bold rounded-xl p-3 border ${message.err ? "text-red-600 bg-red-50 border-red-200" : "text-emerald-700 bg-emerald-50 border-emerald-200"}`}>
                {message.text}
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Username"
                value={formData.username}
                disabled={!!editingId}
                className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-500`}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              />
              <input
                type="password"
                autoComplete="new-password"
                placeholder={editingId ? "New password (khaali = same rahega)" : "Password"}
                value={formData.password}
                className={inputCls}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
              <input
                type="text"
                placeholder="Task manager username (optional - who manages this user's tasks)"
                value={formData.managerUsername || ""}
                className={inputCls}
                onChange={(e) => setFormData({ ...formData, managerUsername: e.target.value.trim() })}
              />
              <select
                value={formData.department}
                className={`${inputCls} bg-white`}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                title="Department ke fixed (recurring) tasks is user ko bhi milenge"
              >
                <option value="">No department</option>
                {departments.map((d) => (
                  <option key={d._id} value={d._id}>{d.name}{d.active ? "" : " (band)"}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {PERMISSION_FIELDS.map((p) => (
                <label key={p.key} className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.permissions[p.key]}
                    onChange={(e) => setFormData({ ...formData, permissions: { ...formData.permissions, [p.key]: e.target.checked } })}
                  />
                  {p.label}
                </label>
              ))}
            </div>

            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-6 py-2.5 rounded-xl bg-[#0a2540] text-white text-xs font-black uppercase tracking-wider disabled:opacity-50 cursor-pointer">
                {saving ? "Saving..." : editingId ? "Update user" : "Create user"}
              </button>
              {editingId && (
                <button type="button" onClick={reset} className="px-5 py-2.5 rounded-xl bg-slate-100 text-xs font-black uppercase cursor-pointer">Cancel</button>
              )}
            </div>
          </form>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#0a2540] text-white">
                <tr className="text-[10px] font-black uppercase tracking-widest text-left">
                  <th className="px-3 py-3">Username</th>
                  <th className="px-3 py-3">Task role</th>
                  <th className="px-3 py-3">Manager</th>
                  <th className="px-3 py-3">Department</th>
                  <th className="px-3 py-3">Users page</th>
                  <th className="px-3 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u._id} className="border-t border-slate-100">
                    <td className="px-3 py-2.5 font-bold text-[#0a2540]">{u.username}</td>
                    <td className="px-3 py-2.5 text-xs font-bold">
                      {u.permissions?.boss ? "Admin" : u.permissions?.taskManager ? "Manager" : "Staff"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{u.managerUsername || "-"}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{deptName(u.department)}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{u.permissions?.users ? "Yes" : "-"}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button type="button" onClick={() => startEdit(u)} title="Edit" className="p-2 rounded-lg hover:bg-slate-100 cursor-pointer"><FiEdit2 size={14} /></button>
                      <button type="button" onClick={() => remove(u)} title="Delete" className="p-2 rounded-lg hover:bg-red-50 text-red-600 cursor-pointer"><FiTrash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
                {!users.length && (
                  <tr><td colSpan={6} className="p-8 text-center text-xs font-black uppercase tracking-widest text-slate-400">Koi user nahi</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">
            Hardcoded super-admins (admin / chintan / hitesh) are not stored here; they log in with <code>ADMIN_FALLBACK_PASSWORD</code>.
          </p>
        </div>
      </div>
    </BlockGuard>
  );
}
