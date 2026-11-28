"use client";
import { useCallback, useEffect, useState } from "react";
import { FiCalendar, FiPlus, FiTrash2 } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import type { HolidayDTO } from "@/lib/tasks/types";
import { ApiError, api, fmtDateKey } from "../tasks/components/taskUi";

// Admin: holidays. A weekly/monthly/yearly fixed task falling on a holiday (or
// Sunday) moves to the previous/next working day; a daily one is skipped.

const inputCls = "p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#ff9933] text-sm";
const todayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export default function HolidaysPage() {
  const thisYear = Number(todayKey().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [rows, setRows] = useState<HolidayDTO[]>([]);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await api<HolidayDTO[]>(`/api/holidays?year=${year}`, "")); }
    catch (e) { setMsg({ text: e instanceof ApiError ? e.message : "Holidays load nahi hue", err: true }); }
    finally { setLoaded(true); }
  }, [year]);
  useEffect(() => { load(); }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !name.trim()) return setMsg({ text: "Date aur naam dono chahiye", err: true });
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/holidays", "", { method: "POST", body: { date, name } });
      setMsg({ text: `${fmtDateKey(date)} holiday add ho gaya` });
      setName("");
      if (Number(date.slice(0, 4)) !== year) setYear(Number(date.slice(0, 4)));
      else await load();
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? e.message : "Save fail ho gaya", err: true });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (h: HolidayDTO) => {
    if (!confirm(`${fmtDateKey(h.date)} (${h.name}) holiday hatana hai?`)) return;
    try { await api(`/api/holidays/${h._id}`, "", { method: "DELETE" }); await load(); }
    catch (e) { setMsg({ text: e instanceof ApiError ? e.message : "Delete fail ho gaya", err: true }); }
  };

  const today = todayKey();

  return (
    <BlockGuard permission="boss" fallback={<NoAccess />}>
      <div className="p-4 md:p-8 bg-[#f3f6f9] min-h-screen">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <div className="bg-[#0a2540] text-white p-4 rounded-2xl"><FiCalendar size={22} /></div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-[#0a2540]">Holidays</h1>
              <p className="text-[#ff9933] text-[10px] font-black tracking-widest uppercase">Fixed tasks shift / skip on these days</p>
            </div>
          </div>

          <form onSubmit={add} className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col sm:flex-row gap-3">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Naam (jaise Diwali)" className={`${inputCls} flex-1`} />
            <button type="submit" disabled={busy} className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-[#0a2540] text-white text-xs font-black uppercase tracking-wider disabled:opacity-50 cursor-pointer">
              <FiPlus /> Add
            </button>
          </form>

          {msg && (
            <p className={`text-xs font-bold rounded-xl p-3 border ${msg.err ? "text-red-600 bg-red-50 border-red-200" : "text-emerald-700 bg-emerald-50 border-emerald-200"}`}>{msg.text}</p>
          )}

          <div className="flex items-center gap-2">
            {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
              <button key={y} type="button" onClick={() => setYear(y)}
                className={`text-xs font-black rounded-full px-4 py-2 cursor-pointer ${year === y ? "bg-[#0a2540] text-white" : "bg-white border border-slate-200 text-slate-600"}`}>
                {y}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {rows.map((h) => (
              <div key={h._id} className={`flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 last:border-0 ${h.date < today ? "opacity-50" : ""}`}>
                <div>
                  <p className="font-bold text-[#0a2540] text-sm">{h.name}</p>
                  <p className="text-xs text-slate-500 font-bold">{fmtDateKey(h.date)}</p>
                </div>
                <button type="button" onClick={() => remove(h)} title="Delete" className="p-2 rounded-lg hover:bg-red-50 text-red-600 cursor-pointer"><FiTrash2 size={14} /></button>
              </div>
            ))}
            {!rows.length && (
              <p className="p-8 text-center text-xs font-black uppercase tracking-widest text-slate-400">{loaded ? `${year} mein koi holiday nahi` : "Loading..."}</p>
            )}
          </div>
          <p className="text-[11px] text-slate-500">
            Sunday (aur jo din Mon-Sat working days mein nahi hai) apne aap off maana jata hai - use yahan add karne ki zaroorat nahi.
            Pehle se ban chuke tasks holiday add karne se nahi badalte.
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
