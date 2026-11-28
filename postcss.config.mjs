import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const config = {
  plugins: {
    // Pin the base dir: Turbopack's PostCSS worker can run with cwd "C:\" on
    // Windows, making `@import "tailwindcss"` fail to resolve.
    "@tailwindcss/postcss": { base: dirname(fileURLToPath(import.meta.url)) },
  },
};

export default config;
