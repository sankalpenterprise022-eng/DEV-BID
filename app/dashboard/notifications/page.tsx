"use client";
import { useCallback, useEffect, useState } from "react";
import { FiBell, FiClock, FiSmartphone } from "react-icons/fi";
import { PushState, disablePush, enablePush, getPushState, isIOS } from "@/lib/notify/client";

// Every user: alert notifications on this device + test button.
// Admin: work hours (reminders only inside them, except urgent).

interface Settings {
  pushConfigured: boolean;
  vapidPublicKey: string;
  devices: number;
  isAdmin: boolean;
  work: { workStartHour: number; workEndHour: number; workingDays: number[] };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 25 }, (_, h) => h);
const hourLabel = (h: number) => (h === 24 ? "12 AM (raat)" : `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`);
const card = "bg-white rounded-2xl border border-slate-200 p-5 space-y-3";
const btn = "px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider cursor-pointer disabled:opacity-50";
const input = "p-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm";

const PUSH_TEXT: Record<PushState, string> = {
  on: "✅ Is device par alerts ON hain",
  off: "Is device par alerts OFF hain",
  denied: "⛔ Browser ne notifications block kiye hain - address bar 🔒 → Notifications → Allow, phir refresh",
  "needs-install": "📱 iPhone/iPad: Safari mein Share ⬆️ → 'Add to Home Screen', phir Home Screen app se yahan aao",
  unsupported: "Is browser mein alerts support nahi hain (Chrome / Edge / Firefox / Safari app use karo)",
};

const ALERTS = [
  "🆕 Naya task mila",
  "🚨 Urgent task (hamesha, work hours ke bahar bhi)",
  "⏰ Task 30 min mein due",
  "🔴 Task overdue (assign karne wale / manager ko bhi)",
  "👀 Task 30 min tak nahi dekha",
  "📞 Follow-up ka time",
  "📊 Shaam 7 baje ka summary (admin)",
];

async function call(path: string, method = "GET", body?: any) {
  const res = await fetch(path, { method, cache: "no-store", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.href = "/login"; throw new Error("Login karo"); }
  if (!res.ok) throw new Error(data.error || "Request fail ho gayi");
  return data;
}

export default function NotificationsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [work, setWork] = useState<Settings["work"] | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  const load = useCallback(async () => {
    const d: Settings = await call("/api/notifications/settings");
    setS(d);
    setWork(d.work);
    setPush(await getPushState());
  }, []);

  useEffect(() => { load().catch((e) => setMsg({ text: e.message, err: true })); }, [load]);

  async function run(key: string, fn: () => Promise<any>, ok?: string) {
    setBusy(key); setMsg(null);
    try {
      const r = await fn();
      setMsg({ text: r?.message || ok || "Ho gaya" });
      await load();
    } catch (e: any) {
      setMsg({ text: e?.message || "Fail ho gaya", err: true });
      setPush(await getPushState());
    } finally {
      setBusy("");
    }
  }

  if (!s || !work) {
    return <p className="p-10 text-center text-xs font-black uppercase tracking-widest text-slate-400">{msg?.text || "Loading..."}</p>;
  }

  return (
    <div className="p-4 md:p-8 bg-[#f3f6f9] min-h-full">
      <div className="max-w-3xl mx-auto flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <div className="bg-[#0a2540] text-white p-4 rounded-2xl"><FiBell size={22} /></div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-[#0a2540]">Alerts</h1>
            <p className="text-[#ff9933] text-[10px] font-black tracking-widest uppercase">Phone / computer notifications · Work hours</p>
          </div>
        </div>

        {msg && (
          <p className={`text-xs font-bold rounded-xl p-3 border ${msg.err ? "text-red-600 bg-red-50 border-red-200" : "text-emerald-700 bg-emerald-50 border-emerald-200"}`}>{msg.text}</p>
        )}

        {/* Alerts on this device */}
        <section className={card}>
          <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[#0a2540]"><FiSmartphone /> Is phone / computer par alerts</h2>
          {!s.pushConfigured ? (
            <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
              Alerts abhi server par set nahi hain. Admin: <code>npm run gen:vapid</code> chala ke VAPID keys .env.local / Vercel mein daalo, phir server restart.
            </p>
          ) : (
            <>
              <p className="text-sm font-bold text-slate-700">{push ? PUSH_TEXT[push] : "..."}</p>
              <p className="text-[11px] text-slate-500">Aapke {s.devices} device(s) par alerts ON hain. Har phone/computer par alag se ON karna hota hai.</p>
              <div className="flex flex-wrap gap-2">
                {push === "off" && (
                  <button type="button" disabled={!!busy} onClick={() => run("push", () => enablePush(s.vapidPublicKey), "Alerts ON ho gaye ✅")} className={`${btn} bg-[#0a2540] text-white`}>
                    {busy === "push" ? "..." : "Notifications ON karo"}
                  </button>
                )}
                {push === "on" && (
                  <button type="button" disabled={!!busy} onClick={() => run("push", disablePush, "Is device par alerts OFF")} className={`${btn} bg-slate-100 text-slate-700`}>
                    OFF karo
                  </button>
                )}
                <button type="button" disabled={!!busy || !s.devices} onClick={() => run("tpush", () => call("/api/notifications/test", "POST", {}))} className={`${btn} bg-[#ff9933]/15 text-[#c2410c] border border-[#ff9933]/40`}>
                  {busy === "tpush" ? "..." : "Test alert bhejo"}
                </button>
              </div>
              {isIOS() && <p className="text-[11px] text-slate-500">iPhone: iOS 16.4+ chahiye, aur app Home Screen se khula hona chahiye.</p>}
            </>
          )}
          <div className="pt-2 border-t border-slate-100">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Kab alert aata hai</p>
            <ul className="text-xs text-slate-600 space-y-0.5">{ALERTS.map((a) => <li key={a}>{a}</li>)}</ul>
          </div>
        </section>

        {/* Work hours */}
        <section className={card}>
          <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[#0a2540]"><FiClock /> Work hours (IST)</h2>
          <p className="text-[11px] text-slate-500">Reminders sirf in ghanton mein jaate hain. 🚨 Urgent task ke alerts hamesha jaate hain.</p>
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-700">
            <select disabled={!s.isAdmin} value={work.workStartHour} onChange={(e) => setWork({ ...work, workStartHour: Number(e.target.value) })} className={`${input} bg-white`}>
              {HOURS.slice(0, 24).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            se
            <select disabled={!s.isAdmin} value={work.workEndHour} onChange={(e) => setWork({ ...work, workEndHour: Number(e.target.value) })} className={`${input} bg-white`}>
              {HOURS.slice(1).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            tak
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = work.workingDays.includes(i);
              return (
                <button key={d} type="button" disabled={!s.isAdmin}
                  onClick={() => setWork({ ...work, workingDays: on ? work.workingDays.filter((x) => x !== i) : [...work.workingDays, i].sort() })}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-black border cursor-pointer disabled:cursor-default ${on ? "bg-[#0a2540] text-white border-[#0a2540]" : "bg-white text-slate-500 border-slate-200"}`}>
                  {d}
                </button>
              );
            })}
          </div>
          {s.isAdmin ? (
            <>
              <button type="button" disabled={!!busy} onClick={() => run("work", () => call("/api/notifications/settings", "PATCH", { work }), "Work hours save ho gaye")} className={`${btn} bg-[#0a2540] text-white`}>
                {busy === "work" ? "..." : "Save work hours"}
              </button>
              <p className="text-[11px] text-slate-500">Working days fixed (recurring) tasks par bhi lagte hain. Chhutti ke din Holidays page se.</p>
            </>
          ) : (
            <p className="text-[11px] text-slate-500">Sirf admin badal sakta hai.</p>
          )}
        </section>
      </div>
    </div>
  );
}
