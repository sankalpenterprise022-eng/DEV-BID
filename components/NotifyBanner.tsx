"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FiBell, FiDownload, FiX } from "react-icons/fi";
import { PushState, enablePush, getPushState, isIOS, registerSW, syncPush } from "@/lib/notify/client";

// Thin strip under the header: "Notifications ON karo" / install hints.
// Hidden once push is on, or for 3 days after "Baad mein".

const SNOOZE_KEY = "oms_notify_snooze";
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

export default function NotifyBanner() {
  const [state, setState] = useState<PushState | null>(null);
  const [vapid, setVapid] = useState("");
  const [installEvt, setInstallEvt] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [snoozed, setSnoozed] = useState(true);

  useEffect(() => {
    registerSW();
    setSnoozed(Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0));
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/notifications/settings", { cache: "no-store" }).catch(() => null);
      const data = res?.ok ? await res.json() : null;
      if (cancelled || !data?.pushConfigured) return; // server push not set up -> no banner
      setVapid(data.vapidPublicKey);
      await syncPush(data.vapidPublicKey); // permission already given: keep this device registered for this user
      if (!cancelled) setState(await getPushState());
    })();
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => { cancelled = true; window.removeEventListener("beforeinstallprompt", onPrompt); };
  }, []);

  if (!state || state === "on" || state === "unsupported" || snoozed) return null;

  const snooze = () => { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); setSnoozed(true); };
  const enable = async () => {
    setBusy(true); setError("");
    try { await enablePush(vapid); setState(await getPushState()); }
    catch (e: any) { setError(e?.message || "Notifications ON nahi hue"); setState(await getPushState()); }
    finally { setBusy(false); }
  };
  const install = async () => { installEvt?.prompt(); await installEvt?.userChoice.catch(() => {}); setInstallEvt(null); };

  return (
    <div className="bg-[#ff9933]/15 border-b border-[#ff9933]/40 px-3 md:px-6 py-2 flex flex-wrap items-center gap-2 text-xs font-bold text-[#7c2d12]">
      <FiBell className="shrink-0" />
      {state === "needs-install" ? (
        <span className="flex-1 min-w-[12rem]">
          {isIOS() ? "iPhone par alerts ke liye: Safari mein Share ⬆️ → 'Add to Home Screen' → Home Screen wale app se login karke notifications ON karo." : "Alerts ke liye app install karo."}
        </span>
      ) : state === "denied" ? (
        <span className="flex-1 min-w-[12rem]">
          Notifications block hain. Browser address bar mein 🔒 → Notifications → <b>Allow</b> karo, phir page refresh karo.
        </span>
      ) : (
        <span className="flex-1 min-w-[12rem]">
          Naye task, urgent aur overdue alerts phone/computer par paane ke liye notifications ON karo.
          {error && <span className="block text-red-700">{error}</span>}
        </span>
      )}
      {state === "off" && (
        <button type="button" onClick={enable} disabled={busy} className="bg-[#0a2540] text-white rounded-full px-3 py-1 uppercase tracking-wider text-[10px] font-black cursor-pointer disabled:opacity-50">
          {busy ? "..." : "Notifications ON karo"}
        </button>
      )}
      {installEvt && (
        <button type="button" onClick={install} className="flex items-center gap-1 bg-white border border-[#ff9933]/50 rounded-full px-3 py-1 uppercase tracking-wider text-[10px] font-black cursor-pointer">
          <FiDownload /> App install
        </button>
      )}
      <Link href="/dashboard/notifications" className="underline text-[10px] uppercase tracking-wider">Settings</Link>
      <button type="button" onClick={snooze} title="Baad mein (3 din)" className="p-1 rounded-full hover:bg-black/5 cursor-pointer"><FiX /></button>
    </div>
  );
}
