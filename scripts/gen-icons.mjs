// Generates the PWA icons in public/icons (no image libraries needed):
//   node scripts/gen-icons.mjs
// Navy square + orange check mark (app colours). Full-bleed, so the same art
// works as a normal and a "maskable" icon. badge-96 is a white check on
// transparent (Android status-bar badge uses only the alpha channel).
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(OUT, { recursive: true });

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// Check mark = two thick segments, in 0..1 coordinates (inside the maskable safe zone).
const SEG = [[0.29, 0.52, 0.44, 0.67], [0.44, 0.67, 0.72, 0.36]];
const HALF = 0.07;
function distSeg(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
/** 0..1 coverage of the check at pixel (x, y), 4x4 supersampled. */
function cover(size, x, y) {
  let hit = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const px = (x + (i + 0.5) / 4) / size, py = (y + (j + 0.5) / 4) / size;
    if (Math.min(...SEG.map((s) => distSeg(px, py, s))) <= HALF) hit++;
  }
  return hit / 16;
}
const NAVY = [10, 37, 64], ORANGE = [255, 153, 51];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

const appIcon = (size) => png(size, (x, y) => [...mix(NAVY, ORANGE, cover(size, x, y)), 255]);
const badge = (size) => png(size, (x, y) => [255, 255, 255, Math.round(cover(size, x, y) * 255)]);

const files = {
  "icon-192.png": appIcon(192),
  "icon-512.png": appIcon(512),
  "maskable-512.png": appIcon(512),
  "apple-touch-icon.png": appIcon(180),
  "badge-96.png": badge(96),
};
for (const [name, buf] of Object.entries(files)) {
  writeFileSync(join(OUT, name), buf);
  console.log(`public/icons/${name} (${buf.length} bytes)`);
}
