// Local / self-hosted cron: calls POST /api/cron/tick every 5 minutes.
//   npm run cron:local                      (app on http://localhost:3000)
//   CRON_URL=http://192.168.1.5:3000 npm run cron:local
// Needs CRON_SECRET in .env.local (same value the server uses).
// Keep this window open (or run it with pm2 / Task Scheduler) while the app runs.

const BASE = (process.env.CRON_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const SECRET = process.env.CRON_SECRET;
const EVERY_MS = 5 * 60 * 1000;

if (!SECRET) {
  console.error("CRON_SECRET .env.local mein set nahi hai. Pehle: npm run gen:secret  -> CRON_SECRET=<value>");
  process.exit(1);
}

const stamp = () => new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });

async function tick() {
  try {
    const res = await fetch(`${BASE}/api/cron/tick`, {
      method: "POST",
      headers: { "x-cron-secret": SECRET },
      signal: AbortSignal.timeout(120_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[${stamp()}] tick ${res.status}: ${data.error || "fail"}`);
      return;
    }
    const sent = ["newTask", "notSeen", "dueSoon", "overdue", "escalated", "followUp"]
      .filter((k) => data[k]).map((k) => `${k}=${data[k]}`).join(" ");
    const extra = [data.recurring ? `recurring created=${data.recurring.created}` : "", data.summary !== null && data.summary !== undefined ? `summary->${data.summary} admins` : ""]
      .filter(Boolean).join(" ");
    console.log(`[${stamp()}] ok ${data.workTime ? "(work hours)" : "(after hours)"} ${sent || "nothing due"} ${extra}${data.errors?.length ? ` ERRORS: ${data.errors.join("; ")}` : ""}`);
  } catch (e) {
    console.error(`[${stamp()}] ${BASE} tak nahi pahunche: ${e?.message || e}`);
  }
}

console.log(`Cron chalu: ${BASE}/api/cron/tick har 5 min (Ctrl+C se band)`);
await tick();
setInterval(tick, EVERY_MS);
