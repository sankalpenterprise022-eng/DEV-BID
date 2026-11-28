// Runs after `next build` (see package.json "build").
// Fails the build if the generated CSS is missing Tailwind utility classes the app uses,
// so a broken (unstyled) build can never be deployed: Vercel keeps the previous good deploy live.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), ".next", "static");
const files = [];
(function walk(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".css")) files.push(p);
  }
})(dir);

const css = files.map((f) => readFileSync(f, "utf8")).join("\n");
// Classes used on the login page, tasks page and header.
const required = ["rounded-2xl", "bg-white", "font-black", "uppercase", "min-h-screen", "px-3"];
const missing = required.filter((c) => !css.includes(`.${c}`));

if (!files.length || missing.length) {
  console.error(`\n[check-css] FAILED: built CSS is missing Tailwind classes: ${missing.join(", ") || "(no CSS files)"}`);
  console.error("[check-css] The site would load unstyled, so this build is stopped.\n");
  process.exit(1);
}
console.log(`[check-css] OK - ${files.length} CSS file(s), ${Math.round(css.length / 1024)} KB, all key classes present`);
