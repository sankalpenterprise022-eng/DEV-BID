"use client";
import { useEffect, useRef, useState } from "react";
import { FiX, FiEye } from "react-icons/fi";
import { DepartmentDTO, TASK_CATEGORIES, TASK_PRIORITIES, TaskTemplateDTO, TaskUserDTO } from "@/lib/tasks/types";
import {
  DEFAULT_DAILY_DAYS, MONTH_SHORT, MonthDate, RecurrenceType, TemplateRecurrence, WEEKDAY_SHORT,
} from "@/lib/tasks/recurrence";
import { ApiError, CATEGORY_LABEL, api, fmtDateKey, fmtDateTime } from "../tasks/components/taskUi";
import SearchableSelect from "../tasks/components/SearchableSelect";

interface Props {
  template: TaskTemplateDTO | null; // null = new
  users: TaskUserDTO[];
  departments: DepartmentDTO[];
  canUseDepartments: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}

type PreviewRow = { occurrenceDate: string; dueDate: string; createDate: string; dueAt: string };

const inputCls = "w-full p-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#ff9933]";
const labelCls = "block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1";
const chip = (on: boolean) =>
  `text-[11px] font-black rounded-lg px-2.5 py-1.5 border cursor-pointer select-none ${on ? "bg-[#0a2540] text-white border-[#0a2540]" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`;
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun
const TYPE_LABEL: Record<RecurrenceType, string> = { daily: "🔁 Daily", weekly: "📅 Weekly", monthly: "🗓️ Monthly", yearly: "📆 Yearly" };

export default function TemplateModal({ template, users, departments, canUseDepartments, onClose, onSaved }: Props) {
  const r0 = template?.recurrence;
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [category, setCategory] = useState<string>(template?.category ?? "GENERAL");
  const [priority, setPriority] = useState<string>(template?.priority ?? "NORMAL");
  const [checklist, setChecklist] = useState((template?.checklist ?? []).join("\n"));
  const [assignees, setAssignees] = useState<string[]>(template?.assignees ?? []);
  const [deptIds, setDeptIds] = useState<string[]>(template?.departments ?? []);
  const [dueTime, setDueTime] = useState(template?.dueTime ?? "18:00");
  const [requiresVerification, setRequiresVerification] = useState(template?.requiresVerification ?? true);
  const [active, setActive] = useState(template?.active ?? true);

  const [type, setType] = useState<RecurrenceType>(r0?.type ?? "daily");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(r0?.daysOfWeek?.length ? r0.daysOfWeek : [...DEFAULT_DAILY_DAYS]);
  const [datesOfMonth, setDatesOfMonth] = useState<MonthDate[]>(r0?.datesOfMonth ?? []);
  const [month, setMonth] = useState(r0?.monthDay?.month ?? 4);
  const [day, setDay] = useState(r0?.monthDay?.day ?? 1);
  const [leadDays, setLeadDays] = useState(r0?.leadDays ?? 0);
  const [holidayShift, setHolidayShift] = useState<"previous" | "next">(r0?.holidayShift ?? "previous");

  const [preview, setPreview] = useState<{ summary: string; dates: PreviewRow[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  // Switching type gives sensible day defaults: daily Mon-Sat, weekly Monday.
  function changeType(t: RecurrenceType) {
    setType(t);
    if (t === "daily" && !daysOfWeek.length) setDaysOfWeek([...DEFAULT_DAILY_DAYS]);
    if (t === "weekly") setDaysOfWeek((d) => (d.length && d.length < 6 ? d : [1]));
    setPreview(null);
  }
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const recurrence = (): TemplateRecurrence => ({
    type,
    daysOfWeek: type === "daily" || type === "weekly" ? daysOfWeek : [],
    datesOfMonth: type === "monthly" ? datesOfMonth : [],
    monthDay: type === "yearly" ? { month, day } : null,
    leadDays,
    holidayShift,
  });

  async function runPreview() {
    setPreviewing(true);
    setError("");
    try {
      setPreview(await api("/api/templates/preview", "", { method: "POST", body: { recurrence: recurrence(), dueTime } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Preview nahi bana");
    } finally {
      setPreviewing(false);
    }
  }

  async function save() {
    if (saving) return;
    setError("");
    if (!title.trim()) return setError("Title zaroori hai");
    if (!assignees.length && !deptIds.length) return setError("Kam se kam ek user ya department chuno");
    setSaving(true);
    try {
      const body = {
        title, description, category, priority, checklist, assignees, departments: deptIds, dueTime,
        requiresVerification, active, recurrence: recurrence(),
        ...(template ? { expectedUpdatedAt: template.updatedAt } : {}),
      };
      const res = await api<{ created: number }>(template ? `/api/templates/${template._id}` : "/api/templates", "", {
        method: template ? "PATCH" : "POST",
        body,
      });
      onSaved(`${template ? "Template update hua" : "Template ban gaya"}${res.created ? ` · ${res.created} task abhi bane` : ""}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save nahi hua");
    } finally {
      setSaving(false);
    }
  }

  const userOptions = users.filter((u) => u.assignable).map((u) => ({ value: u.username, label: u.username }));
  const deptOptions = departments.filter((d) => d.active || deptIds.includes(d._id)).map((d) => ({ value: d._id, label: `${d.name} (${d.members.length})` }));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl my-4"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-black uppercase tracking-wider text-[#0a2540]">{template ? "Edit fixed task" : "New fixed task"}</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 cursor-pointer"><FiX /></button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>}

          <div>
            <label className={labelCls}>Title *</label>
            <input ref={titleRef} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Jaise: Daily bank entry" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            {/* Left: what */}
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Description</label>
                <textarea value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Default checklist steps (ek line = ek step)</label>
                <textarea value={checklist} onChange={(e) => setChecklist(e.target.value)} rows={4} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Category</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                    {TASK_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL(c)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Priority</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
                    {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>Users</label>
                <SearchableSelect multiple value={assignees} onChange={setAssignees} options={userOptions} placeholder="+ Add user" />
              </div>
              <div>
                <label className={labelCls}>Departments (sabhi members ko milega)</label>
                {canUseDepartments ? (
                  <SearchableSelect multiple value={deptIds} onChange={setDeptIds} options={deptOptions} placeholder="+ Add department" />
                ) : (
                  <p className="text-[11px] text-slate-400 font-bold">Poore department ko sirf admin assign kar sakta hai.</p>
                )}
                <p className="text-[10px] text-slate-400 mt-1">Department mein naya user aaye to use agle run se apne aap ye task milega.</p>
              </div>
            </div>

            {/* Right: when */}
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Repeat</label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(TYPE_LABEL) as RecurrenceType[]).map((t) => (
                    <button key={t} type="button" onClick={() => changeType(t)} className={chip(type === t)}>{TYPE_LABEL[t]}</button>
                  ))}
                </div>
              </div>

              {(type === "daily" || type === "weekly") && (
                <div>
                  <label className={labelCls}>{type === "daily" ? "Kin dino par (default Mon-Sat)" : "Har hafte kis din"}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEK_ORDER.map((d) => (
                      <button key={d} type="button" onClick={() => { setDaysOfWeek(toggle(daysOfWeek, d)); setPreview(null); }} className={chip(daysOfWeek.includes(d))}>
                        {WEEKDAY_SHORT[d]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {type === "monthly" && (
                <div>
                  <label className={labelCls}>Mahine ki kaunsi date(s)</label>
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <button key={d} type="button" onClick={() => { setDatesOfMonth(toggle(datesOfMonth, d)); setPreview(null); }} className={`${chip(datesOfMonth.includes(d))} px-0`}>
                        {d}
                      </button>
                    ))}
                    <button type="button" onClick={() => { setDatesOfMonth(toggle<MonthDate>(datesOfMonth, "last")); setPreview(null); }} className={`${chip(datesOfMonth.includes("last"))} col-span-3`}>
                      Last day
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">29/30/31 jo mahine mein nahi hai, wo us mahine ke last day par aayega.</p>
                </div>
              )}

              {type === "yearly" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Month</label>
                    <select value={month} onChange={(e) => { setMonth(Number(e.target.value)); setPreview(null); }} className={inputCls}>
                      {MONTH_SHORT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Date</label>
                    <input type="number" min={1} max={31} value={day} onChange={(e) => { setDay(Number(e.target.value)); setPreview(null); }} className={inputCls} />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Due time</label>
                  <input type="time" value={dueTime} onChange={(e) => { setDueTime(e.target.value); setPreview(null); }} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Kitne din pehle banaye</label>
                  <input type="number" min={0} max={60} value={leadDays} onChange={(e) => { setLeadDays(Math.max(0, Math.min(60, Number(e.target.value) || 0))); setPreview(null); }} className={inputCls} />
                </div>
              </div>

              <div>
                <label className={labelCls}>Sunday / holiday aaye to</label>
                {type === "daily" ? (
                  <p className="text-[11px] text-slate-500 font-bold">Daily task holiday par nahi banta (skip). Sunday sirf tab jab upar chuna ho.</p>
                ) : (
                  <select value={holidayShift} onChange={(e) => { setHolidayShift(e.target.value as "previous" | "next"); setPreview(null); }} className={inputCls}>
                    <option value="previous">Pichhle working day par (jaise Saturday)</option>
                    <option value="next">Agle working day par (jaise Monday)</option>
                  </select>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 p-3 space-y-2">
                <button type="button" onClick={runPreview} disabled={previewing} className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-[#0a2540] cursor-pointer disabled:opacity-50">
                  <FiEye /> {previewing ? "Checking..." : "Preview next 5 dates"}
                </button>
                {preview && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-bold text-indigo-700">{preview.summary}</p>
                    {preview.dates.map((d) => (
                      <div key={d.occurrenceDate} className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700">Due: {fmtDateTime(d.dueAt)}</span>
                        <span className="text-[10px] text-slate-400">
                          {d.dueDate !== d.occurrenceDate ? `shift (${fmtDateKey(d.occurrenceDate)}) · ` : ""}
                          banega {fmtDateKey(d.createDate)}
                        </span>
                      </div>
                    ))}
                    {!preview.dates.length && <p className="text-xs text-red-600 font-bold">Koi date nahi mili - settings check karo</p>}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
              <input type="checkbox" checked={requiresVerification} onChange={(e) => setRequiresVerification(e.target.checked)} />
              Done ke baad verify zaroori
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Active (band karne par naye tasks nahi banenge)
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-100">
          <p className="text-[10px] text-slate-400 font-bold">Ctrl+Enter save · Esc close · Edit sirf aage ke tasks par lagega</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl bg-slate-100 text-xs font-black uppercase cursor-pointer">Cancel</button>
            <button type="button" onClick={save} disabled={saving} className="px-6 py-2.5 rounded-xl bg-[#0a2540] text-white text-xs font-black uppercase tracking-wider disabled:opacity-50 cursor-pointer">
              {saving ? "Saving..." : template ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
