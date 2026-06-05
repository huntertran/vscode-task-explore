// Generates media/icon.png (128x128) for the Marketplace listing.
// Pure Node: rasterizes the activity-bar glyph (3 list bars + play triangle)
// on a blue rounded tile at 4x supersampling, then box-downsamples for AA.
// Run: node scripts/gen-icon.cjs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const SS = 4;
const N = SIZE * SS; // supersampled resolution

const BG = [44, 123, 229]; // #2C7BE5
const FG = [255, 255, 255];

const k = N / 24; // map 24-grid SVG coords -> supersampled pixels

function insideRoundRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const ix = Math.min(Math.max(px, x + r), x + w - r);
  const iy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - ix;
  const dy = py - iy;
  return dx * dx + dy * dy <= r * r;
}

function sign(ax, ay, bx, by, cx, cy) {
  return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
}

function insideTriangle(px, py, a, b, c) {
  const d1 = sign(px, py, a[0], a[1], b[0], b[1]);
  const d2 = sign(px, py, b[0], b[1], c[0], c[1]);
  const d3 = sign(px, py, c[0], c[1], a[0], a[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// Glyph geometry in supersampled space.
const bars = [3.5, 10.6, 17.7].map((y) => ({
  x: 2 * k,
  y: y * k,
  w: 11 * k,
  h: 2.8 * k,
  r: 1.4 * k,
}));
const tri = [
  [16 * k, 4.5 * k],
  [23 * k, 12 * k],
  [16 * k, 19.5 * k],
];
const tileR = 20 * SS; // rounded tile corner radius

// Render supersampled RGBA.
const big = Buffer.alloc(N * N * 4, 0);
for (let py = 0; py < N; py++) {
  for (let px = 0; px < N; px++) {
    let col = null;
    if (insideRoundRect(px + 0.5, py + 0.5, 0, 0, N, N, tileR)) col = BG;
    const fx = px + 0.5;
    const fy = py + 0.5;
    const onGlyph =
      insideTriangle(fx, fy, tri[0], tri[1], tri[2]) ||
      bars.some((b) => insideRoundRect(fx, fy, b.x, b.y, b.w, b.h, b.r));
    if (onGlyph) col = FG;
    const o = (py * N + px) * 4;
    if (col) {
      big[o] = col[0];
      big[o + 1] = col[1];
      big[o + 2] = col[2];
      big[o + 3] = 255;
    }
  }
}

// Box-downsample SSxSS -> 1.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1)); // +1 filter byte per row
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const o = ((y * SS + sy) * N + (x * SS + sx)) * 4;
        r += big[o]; g += big[o + 1]; b += big[o + 2]; a += big[o + 3];
      }
    }
    const n = SS * SS;
    const d = y * (SIZE * 4 + 1) + 1 + x * 4;
    raw[d] = Math.round(r / n);
    raw[d + 1] = Math.round(g / n);
    raw[d + 2] = Math.round(b / n);
    raw[d + 3] = Math.round(a / n);
  }
}

// PNG encode.
const CRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(CRC(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'media', 'icon.png');
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
