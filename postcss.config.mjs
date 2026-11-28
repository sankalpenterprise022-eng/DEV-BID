import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Tailwind's base dir (where `@import "tailwindcss"` is resolved from).
// - Windows dev: Turbopack's PostCSS worker can run with cwd "C:\", so cwd alone is wrong there.
// - Vercel/Linux build: this config can be evaluated from a copied location, so
//   import.meta.url alone can be wrong there (that produced a CSS file with no utility classes).
// Use whichever candidate really contains the installed tailwindcss package.
function projectRoot() {
  const candidates = [];
  try {
    candidates.push(dirname(fileURLToPath(import.meta.url)));
  } catch {}
  candidates.push(process.cwd());
  return candidates.find((d) => existsSync(join(d, "node_modules", "tailwindcss", "package.json"))) ?? process.cwd();
}

const config = {
  plugins: {
    "@tailwindcss/postcss": { base: projectRoot() },
  },
};

export default config;
