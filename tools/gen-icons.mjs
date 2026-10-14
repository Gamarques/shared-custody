// Generates solid-color PNG icons with a white ring glyph. No dependencies.
// Usage: node tools/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const BG = [0x1d, 0x4e, 0x89];
const FG = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, glyphScale) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const c = size / 2;
  const outer = (size / 2) * glyphScale;
  const inner = outer * 0.62;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const col = d <= outer && d >= inner ? FG : BG;
      raw.set(col, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
// "any" icons: glyph fills most of the canvas. Maskable: glyph inside the 80% safe zone.
writeFileSync("public/icons/icon-192.png", png(192, 0.8));
writeFileSync("public/icons/icon-512.png", png(512, 0.8));
writeFileSync("public/icons/icon-maskable-512.png", png(512, 0.6));
writeFileSync("public/icons/apple-touch-icon.png", png(180, 0.7));
