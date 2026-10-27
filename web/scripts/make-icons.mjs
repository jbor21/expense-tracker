// Generates the PWA icons (192/512 + apple-touch 180) without any image
// tooling: draws a blue tile with white tally marks (four bars + a diagonal
// strike — it's called Tally) straight into RGBA and writes a PNG via zlib.
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [29, 78, 216];   // #1d4ed8
const FG = [255, 255, 255];

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixels(x, y);
      raw.set([r, g, b], row + 1 + x * 3);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIcon(size) {
  const u = size / 100; // unit grid
  // Four vertical bars + one diagonal strike, centered.
  const barW = 8 * u, top = 28 * u, bottom = 72 * u;
  const xs = [26, 40, 54, 68].map((c) => c * u);
  const inBar = (x, y) =>
    y >= top && y <= bottom && xs.some((bx) => x >= bx - barW / 2 && x <= bx + barW / 2);
  // Diagonal from lower-left to upper-right across the bars.
  const inDiag = (x, y) => {
    const t = (x - 18 * u) / (64 * u); // 0..1 across x range 18→82
    if (t < 0 || t > 1) return false;
    const cy = (66 - 32 * t) * u;      // y 66→34
    return Math.abs(y - cy) <= 4.5 * u;
  };
  return png(size, (x, y) => (inBar(x, y) || inDiag(x, y) ? FG : BG));
}

for (const [file, size] of [
  ['public/icon-192.png', 192],
  ['public/icon-512.png', 512],
  ['public/apple-touch-icon.png', 180],
]) {
  writeFileSync(new URL(`../${file}`, import.meta.url), makeIcon(size));
  console.log('wrote', file);
}
