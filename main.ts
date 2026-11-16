// BREACH — a program-drawn image for make.fun's ai-excited-01
// ("Make the AI judge excited").
//
// The program draws the whole image from code, pixel by pixel, with
// Node's standard library only: no image file is copied in, nothing is
// downloaded, no randomness outside a fixed seed. Every run writes the
// same bytes to /output/entry.png (or $MAKEFUN_OUTPUT_DIR/entry.png).
//
// The scene: a colossal luminous whale breaching out of a dark neon sea
// and arcing across a giant low moon, water exploding around it, a tiny
// lit city on the horizon for scale. One look, one jolt: a huge animal
// where it should not be, mid-leap, glowing, about to burst through the
// moon. Flat poster style, bold gradients, clean shapes — it reads at
// 300 px across as well as at full size.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Deterministic randomness: one fixed seed, so both grader runs agree.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

// ---------------------------------------------------------------------------
// Pixel buffer: RGB, 8 bit. All drawing blends source-over onto it.
// ---------------------------------------------------------------------------
const px = new Uint8Array(W * H * 3);

type RGB = [number, number, number];

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function blend(x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || x >= W || y < 0 || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  if (a >= 1) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    return;
  }
  px[i] = clamp255(px[i] + (r - px[i]) * a);
  px[i + 1] = clamp255(px[i + 1] + (g - px[i + 1]) * a);
  px[i + 2] = clamp255(px[i + 2] + (b - px[i + 2]) * a);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Fill a horizontal run on one row (clipped). Used by the shape fillers.
function hline(x0: number, x1: number, y: number, c: RGB, a: number): void {
  if (y < 0 || y >= H || a <= 0) return;
  const xa = Math.max(0, Math.ceil(x0));
  const xb = Math.min(W - 1, Math.floor(x1));
  for (let x = xa; x <= xb; x++) blend(x, y, c[0], c[1], c[2], a);
}

// Vertical gradient over the whole canvas through colour stops.
function vGradient(stops: Array<[number, RGB]>): void {
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    const c = lerpColor(c0, c1, f);
    for (let x = 0; x < W; x++) blend(x, y, c[0], c[1], c[2], 1);
  }
}

// ---------------------------------------------------------------------------
// PNG writer: raw RGB scanlines (filter 0), zlib, IHDR/IDAT/IEND.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Shape primitives, all built on hline/blend.
// ---------------------------------------------------------------------------

// Filled disc, optionally squashed vertically (ry = r * squash).
function disc(cx: number, cy: number, r: number, c: RGB, a: number, squash = 1): void {
  const ry = r * squash;
  const y0 = Math.max(0, Math.ceil(cy - ry));
  const y1 = Math.min(H - 1, Math.floor(cy + ry));
  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) / ry;
    const dx = r * Math.sqrt(Math.max(0, 1 - dy * dy));
    hline(cx - dx, cx + dx, y, c, a);
  }
}

// Filled ellipse.
function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a: number): void {
  disc(cx, cy, rx, c, a, ry / rx);
}

// Soft glow: concentric discs fading out. radius = outer reach.
// Many fine steps so no banding rings show.
function glow(cx: number, cy: number, radius: number, c: RGB, peak: number, steps = 90): void {
  for (let s = steps; s >= 1; s--) {
    const f = s / steps;
    const a = peak * (1 - f) * (1 - f);
    disc(cx, cy, radius * f, c, a);
  }
}

// Even-odd scanline fill of a polygon given as [x, y] points.
function polygon(points: Array<[number, number]>, c: RGB, a: number): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const y0 = Math.max(0, Math.ceil(minY));
  const y1 = Math.min(H - 1, Math.floor(maxY));
  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1p] = points[i];
      const [x2, y2p] = points[(i + 1) % points.length];
      if ((y1p <= y && y < y2p) || (y2p <= y && y < y1p)) {
        xs.push(x1 + ((y - y1p) / (y2p - y1p)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) hline(xs[k], xs[k + 1], y, c, a);
  }
}

// Thick segment: a chain of discs along the line.
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(len / Math.max(1, w * 0.4)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    disc(lerp(x0, x1, t), lerp(y0, y1, t), w / 2, c, a);
  }
}

// Quadratic bezier point.
function qbez(p0: [number, number], p1: [number, number], p2: [number, number], t: number): [number, number] {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
}

// A tapered tube along a quadratic bezier: overlapping discs whose radius
// follows radiusAt(t). Returns the sampled spine points for later use.
function tube(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  radiusAt: (t: number) => number,
  c: RGB,
  a: number,
  steps = 160,
): Array<[number, number]> {
  const spine: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = qbez(p0, p1, p2, t);
    spine.push([x, y]);
    disc(x, y, radiusAt(t), c, a);
  }
  return spine;
}

// Rim light along one edge of a tube: a continuous bright line through
// points offset perpendicular to the spine, plus a soft halo.
// upper=true follows the top edge, false the underside.
function rimLight(
  spine: Array<[number, number]>,
  radiusAt: (t: number) => number,
  lift: number,
  w: number,
  c: RGB,
  a: number,
  upper = true,
): void {
  const off = (i: number): [number, number] => {
    const t = i / (spine.length - 1);
    const [x, y] = spine[i];
    const [nx, ny] = spine[Math.min(spine.length - 1, i + 1)];
    const [px2, py2] = spine[Math.max(0, i - 1)];
    let dx = nx - px2;
    let dy = ny - py2;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const ox = -dy;
    const oy = dx;
    let sign = oy < 0 ? 1 : -1; // keep the offset on the upper side
    if (!upper) sign = -sign;
    return [x + ox * radiusAt(t) * lift * sign, y + oy * radiusAt(t) * lift * sign];
  };
  for (let i = 1; i < spine.length; i++) {
    const [ax, ay] = off(i - 1);
    const [bx, by] = off(i);
    thickLine(ax, ay, bx, by, w, c, a);
  }
}

// ---------------------------------------------------------------------------
// The scene.
// ---------------------------------------------------------------------------

const HORIZON = 742; // sea line
const MOON: [number, number, number] = [712, 288, 182]; // cx, cy, r

function drawSky(): void {
  vGradient([
    [0.0, [5, 7, 24]],
    [0.3, [20, 16, 54]],
    [0.52, [58, 26, 90]],
    [0.64, [124, 42, 92]],
    [0.72, [255, 122, 61]],
  ]);
}

function drawStars(): void {
  for (let i = 0; i < 230; i++) {
    const x = rand() * W;
    const y = rand() * 600;
    const r = 0.7 + rand() * 1.1;
    const a = 0.35 + rand() * 0.6;
    const c: RGB = pick([
      [255, 255, 255],
      [207, 228, 255],
      [255, 230, 180],
    ] as const);
    disc(x, y, r, c, a);
  }
  // A few four-point sparkles.
  for (let i = 0; i < 12; i++) {
    const x = rand() * W;
    const y = rand() * 420;
    const s = 3 + rand() * 5;
    const c: RGB = [255, 255, 255];
    thickLine(x - s, y, x + s, y, 1.2, c, 0.85);
    thickLine(x, y - s, x, y + s, 1.2, c, 0.85);
  }
}

function drawMoon(): void {
  const [mx, my, mr] = MOON;
  glow(mx, my, 430, [255, 190, 110], 0.5);
  glow(mx, my, 260, [255, 214, 130], 0.55);
  disc(mx, my, mr, [242, 169, 59], 1);
  disc(mx, my, mr - 14, [255, 233, 173], 1);
  // Soft craters.
  for (let i = 0; i < 5; i++) {
    const ang = rand() * Math.PI * 2;
    const d = rand() * (mr - 70);
    disc(mx + Math.cos(ang) * d, my + Math.sin(ang) * d, 8 + rand() * 14, [232, 185, 106], 0.12);
  }
  // Bright upper-left face of the moon.
  disc(mx - 30, my - 34, mr - 70, [255, 246, 216], 0.35);
}

function drawSea(): void {
  for (let y = HORIZON; y < H; y++) {
    const t = (y - HORIZON) / (H - HORIZON);
    const c = lerpColor([10, 36, 71], [4, 16, 31], t);
    for (let x = 0; x < W; x++) blend(x, y, c[0], c[1], c[2], 1);
  }
  // Moonlight column: shimmering horizontal dashes under the moon.
  for (let y = HORIZON + 8; y < H - 10; y += 5 + Math.floor(rand() * 9)) {
    const spread = 26 + ((y - HORIZON) / (H - HORIZON)) * 130;
    const cx = MOON[0] + (rand() - 0.5) * spread * 0.5;
    const w = 18 + rand() * (70 + (y - HORIZON) * 0.25);
    const a = 0.1 + rand() * 0.25;
    const warm: RGB = rand() < 0.7 ? [255, 180, 92] : [127, 212, 255];
    hline(cx - w / 2, cx + w / 2, y, warm, a);
    hline(cx - w / 2, cx + w / 2, y + 1, warm, a * 0.6);
  }
  // Long low swells.
  for (const [wy, alpha] of [
    [800, 0.16],
    [880, 0.12],
    [960, 0.1],
  ] as const) {
    for (let x = 0; x < W; x += 2) {
      const yy = wy + Math.sin(x * 0.012 + wy) * 4;
      blend(x, Math.round(yy), 90, 160, 210, alpha);
    }
  }
}

function drawCity(): void {
  let x = -10;
  while (x < W + 10) {
    const bw = 26 + rand() * 40;
    const bh = 18 + rand() * 62 + (rand() < 0.12 ? 55 : 0);
    const top = HORIZON - bh;
    // Building slab.
    for (let y = Math.floor(top); y < HORIZON; y++) {
      hline(x, x + bw, y, [10, 14, 38], 1);
    }
    // Roof antenna on the tallest ones.
    if (bh > 95) {
      thickLine(x + bw / 2, top, x + bw / 2, top - 16, 2, [10, 14, 38], 1);
      disc(x + bw / 2, top - 18, 2.5, [255, 80, 80], 0.95);
      glow(x + bw / 2, top - 18, 10, [255, 80, 80], 0.5);
    }
    // Lit windows.
    const cols = Math.max(1, Math.floor(bw / 10));
    const rows = Math.max(1, Math.floor(bh / 12));
    for (let cx = 0; cx < cols; cx++) {
      for (let ry = 0; ry < rows; ry++) {
        if (rand() < 0.45) {
          const wx = x + 4 + cx * 10;
          const wy = top + 6 + ry * 12;
          const wc: RGB = pick([
            [255, 210, 122],
            [255, 157, 92],
            [159, 216, 255],
          ] as const);
          hline(wx, wx + 3, wy, wc, 0.95);
          hline(wx, wx + 3, wy + 1, wc, 0.95);
          hline(wx, wx + 3, wy + 2, wc, 0.95);
        }
      }
    }
    x += bw + 2 + rand() * 14;
  }
}

// Whale body radius along the spine, from tail (t=0) to head (t=1).
// Slim tail stalk, thickest just past the middle, broad blunt rostrum.
const RADIUS_PROFILE: Array<[number, number]> = [
  [0.0, 12],
  [0.15, 30],
  [0.35, 78],
  [0.55, 100],
  [0.75, 86],
  [0.9, 68],
  [0.97, 60],
  [1.0, 52],
];

function radiusAt(t: number): number {
  for (let i = 0; i < RADIUS_PROFILE.length - 1; i++) {
    const [t0, r0] = RADIUS_PROFILE[i];
    const [t1, r1] = RADIUS_PROFILE[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      const s = f * f * (3 - 2 * f); // smoothstep
      return r0 + (r1 - r0) * s;
    }
  }
  return RADIUS_PROFILE[RADIUS_PROFILE.length - 1][1];
}

function drawWhale(): void {
  const p0: [number, number] = [150, 772]; // tail, just leaving the sea
  const p1: [number, number] = [330, 300]; // control: the arc's rise
  const p2: [number, number] = [795, 335]; // head, inside the moon
  const BODY: RGB = [43, 77, 143];
  const DARK: RGB = [29, 58, 110];
  const BELLY: RGB = [127, 184, 232];

  // Tail flukes: a broad horizontal fan, half out of the water, seen
  // from the side — wide lobes with a notch between them.
  polygon(
    [
      [150, 766],
      [96, 742],
      [52, 756],
      [70, 782],
      [108, 796],
      [146, 792],
    ],
    BODY,
    1,
  );
  polygon(
    [
      [150, 766],
      [206, 740],
      [252, 752],
      [236, 780],
      [196, 796],
      [156, 792],
    ],
    BODY,
    1,
  );
  thickLine(150, 766, 96, 742, 4, [165, 243, 255], 0.6);
  thickLine(150, 766, 206, 740, 4, [165, 243, 255], 0.6);

  // Body: one main tube, then a soft pale belly low on the underside,
  // with ventral pleats (the long grooves of a humpback's throat).
  const spine = tube(p0, p1, p2, radiusAt, BODY, 1);
  for (let i = 0; i < spine.length; i++) {
    const t = i / (spine.length - 1);
    const [x, y] = spine[i];
    disc(x, y + radiusAt(t) * 0.45, radiusAt(t) * 0.62, BELLY, 0.18);
  }
  // Glowing rim light along the top edge.
  rimLight(spine, radiusAt, 0.62, 5, [165, 243, 255], 0.95);
  rimLight(spine, radiusAt, 0.62, 14, [120, 220, 255], 0.28);

  // Pectoral fin: a humpback's long blade, tapering to a point and
  // sweeping back and down from the lower edge of the mid-body.
  const mid = spine[Math.floor(spine.length * 0.45)];
  const mr = radiusAt(0.45);
  polygon(
    [
      [mid[0] - 26, mid[1] + mr * 0.5],
      [mid[0] + 20, mid[1] + mr * 0.55],
      [mid[0] - 52, mid[1] + mr * 1.95],
    ],
    [36, 66, 128],
    1,
  );
  thickLine(mid[0] - 26, mid[1] + mr * 0.5, mid[0] - 52, mid[1] + mr * 1.95, 3, [165, 243, 255], 0.45);

  // Head details: eye, one long clean mouth line, throat grooves
  // tucked under the jaw only.
  const head = spine[spine.length - 1];
  disc(head[0] - 26, head[1] - 20, 7, [10, 18, 48], 1);
  disc(head[0] - 28, head[1] - 23, 2.5, [255, 255, 255], 1);
  tube(
    [head[0] + 20, head[1] + 16],
    [head[0] - 26, head[1] + 30],
    [head[0] - 72, head[1] + 24],
    () => 1.4,
    [22, 41, 79],
    0.85,
    60,
  );
  for (let g = 0; g < 3; g++) {
    const gy = head[1] + 34 + g * 8;
    thickLine(head[0] - 62, gy, head[0] - 14, gy + 4, 2, [22, 41, 79], 0.3);
  }

  // Spout: a puff of mist above the blowhole, drifting up and back.
  const blowX = head[0] - 12;
  const blowY = head[1] - radiusAt(1) * 0.92;
  for (let i = 0; i < 12; i++) {
    const t = i / 12;
    const x = blowX - t * 46 + (rand() - 0.5) * 14;
    const y = blowY - 8 - t * 52 + (rand() - 0.5) * 10;
    disc(x, y, 4 + rand() * 8, [220, 240, 255], 0.28 * (1 - t * 0.6));
  }
}

function drawSpray(): void {
  const bx = 150;
  const by = 752;
  // Foam where the tail left the water: a broken ring of small blobs
  // and streaks — white water piling up around the breach.
  for (let i = 0; i < 46; i++) {
    const ang = rand() * Math.PI * 2;
    const rx = 128;
    const ry = 20;
    const x = bx + Math.cos(ang) * rx * (0.7 + rand() * 0.4);
    const y = by + Math.sin(ang) * ry * (0.7 + rand() * 0.4) - 4;
    disc(x, y, 3.5 + rand() * 7.5, [255, 255, 255], 0.45 + rand() * 0.4);
  }
  for (let i = 0; i < 14; i++) {
    const x = bx - 90 + rand() * 180;
    const y = by - 12 + rand() * 18;
    disc(x, y, 5 + rand() * 9, [191, 233, 255], 0.5);
  }
  ellipse(bx, by - 2, 84, 10, [191, 233, 255], 0.4);
  // Arcing droplets, fanning up and out from the breach.
  for (let i = 0; i < 170; i++) {
    const ang = (-165 + rand() * 150) * (Math.PI / 180); // upward fan
    const dist = 30 + Math.pow(rand(), 0.7) * 250;
    const x = bx + Math.cos(ang) * dist;
    const y = by + Math.sin(ang) * dist + dist * dist * 0.0016; // gravity droop
    const r = 1 + rand() * 2.5;
    const a = 0.3 + rand() * 0.4;
    const c: RGB = rand() < 0.6 ? [255, 255, 255] : [159, 232, 255];
    disc(x, y, r, c, a);
  }
  // One faint splash sheet curling off the tail.
  tube(
    [96, 742],
    [150, 690],
    [216, 726],
    () => 4,
    [255, 255, 255],
    0.4,
    24,
  );
}

function drawBirds(): void {
  for (let i = 0; i < 6; i++) {
    const x = 60 + rand() * 420;
    const y = 120 + rand() * 260;
    const s = 7 + rand() * 7;
    const c: RGB = [10, 14, 38];
    thickLine(x - s, y, x, y + s * 0.45, 2, c, 0.85);
    thickLine(x, y + s * 0.45, x + s, y, 2, c, 0.85);
  }
}

function drawVignette(): void {
  const cx = W / 2;
  const cy = H / 2;
  const maxD = Math.hypot(cx, cy);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxD;
      if (d > 0.62) {
        const a = Math.min(0.3, (d - 0.62) * 0.9);
        const i = (y * W + x) * 3;
        px[i] = clamp255(px[i] * (1 - a));
        px[i + 1] = clamp255(px[i + 1] * (1 - a));
        px[i + 2] = clamp255(px[i + 2] * (1 - a));
      }
    }
  }
}

function main(): void {
  drawSky();
  drawStars();
  drawMoon();
  drawSea();
  drawCity();
  drawWhale();
  drawSpray();
  drawBirds();
  drawVignette();

  const png = encodePNG();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'entry.png');
  writeFileSync(outPath, png);
  const sha = createHash('sha256').update(png).digest('hex');
  console.log(`wrote ${outPath} ${png.length} bytes sha256 ${sha}`);
}

main();
