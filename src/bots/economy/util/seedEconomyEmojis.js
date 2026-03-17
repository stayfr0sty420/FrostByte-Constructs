'use strict';

const path = require('path');
const fs = require('fs/promises');
const zlib = require('node:zlib');
const { env } = require('../../../config/env');
const { logger } = require('../../../config/logger');

const DEFAULT_ASSETS_DIR = 'images/emojis';
const DEFAULT_MAX_BYTES = 256 * 1024;
const SOURCE_ROOT = path.resolve(__dirname, '../../../../');
const SOURCE_ROOT_PARENT = path.resolve(SOURCE_ROOT, '..');

const DICE_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
const RB_DICE_NAMES = ['RBDice1', 'RBDice2', 'RBDice3', 'RBDice4', 'RBDice5', 'RBDice6'];
const RB_DICE_BET_TYPE_NAMES = ['RBDiceBDTS', 'RBDiceTB59', 'RBDiceSE', 'RBDiceU7', 'RBDiceO7', 'RBDiceE7'];

const EMOJI_SPECS = [
  {
    name: 'RBCredit',
    required: true,
    existsAliases: ['RodstarkianCredit', 'RodstarkianCredit~1'],
    assetAliases: [
      'RBCredit',
      'RBCredit_Opti',
      'RBCreditOpti',
      'RodstarkianCredit',
      'Rodstarkian_Credit',
      'Rodstarkian_Credit_Opti',
      'RodstarkianCreditOpti',
      'RodCredit',
      'Credit'
    ]
  },
  // Optional brand icon used in footers across games.
  {
    name: 'RodstarkG',
    required: false,
    assetAliases: ['RodstarkG', 'Rodstark', 'RodstarkianG', 'RodLogo', 'Logo', 'Brand']
  },
  {
    name: 'RBHeads',
    required: true,
    existsAliases: ['Heads', 'Heads~1'],
    assetAliases: ['RBHeads', 'RBHeads_Opti', 'RBHeadsOpti', 'Heads', 'Heads_Opti', 'HeadsOpti']
  },
  {
    name: 'RBTails',
    required: true,
    existsAliases: ['Tails', 'Tails~1'],
    assetAliases: ['RBTails', 'RBTails_Opti', 'RBTailsOpti', 'Tails', 'Tails_Opti', 'TailsOpti']
  },
  // Optional animated (GIF) or static asset.
  {
    name: 'RBCoinflip',
    required: false,
    existsAliases: ['RBCoinflip~1', 'CoinSpin', 'CoinSpin~1'],
    assetAliases: ['RBCoinflip', 'CoinSpin', 'CoinSpinGif', 'CoinFlip', 'Spin', 'Heads', 'Tails']
  },
  {
    name: 'RBSlotSpin',
    required: false,
    existsAliases: ['RBSlotSpin~1', 'SlotSpin'],
    assetAliases: ['RBSlotSpin', 'SlotSpin', 'RBSlotsBar', 'SlotBar', 'Bar', 'BAR']
  },
  {
    name: 'RBSlotSpin2',
    required: false,
    existsAliases: ['RBSlotSpin2~1', 'SlotSpin2'],
    assetAliases: ['RBSlotSpin2', 'SlotSpin2', 'RBSlots777', 'Slot777', '777', 'Seven', 'Sevens']
  },
  {
    name: 'RBSlotSpin3',
    required: false,
    existsAliases: ['RBSlotSpin3~1', 'SlotSpin3'],
    assetAliases: ['RBSlotSpin3', 'SlotSpin3', 'RBSlotsBell', 'SlotBell', 'Bell']
  },
  // Optional dice faces (for /dice UI). Preferred names are One..Six (as in your server), but we also support RodDice/Dice1..6.
  {
    name: RB_DICE_NAMES[0],
    required: false,
    existsAliases: ['RodDice1', 'Dice1', DICE_WORDS[0]],
    assetAliases: [RB_DICE_NAMES[0], 'RodDice1', 'Dice1', DICE_WORDS[0]]
  },
  {
    name: RB_DICE_NAMES[1],
    required: false,
    existsAliases: ['RodDice2', 'Dice2', DICE_WORDS[1]],
    assetAliases: [RB_DICE_NAMES[1], 'RodDice2', 'Dice2', DICE_WORDS[1]]
  },
  {
    name: RB_DICE_NAMES[2],
    required: false,
    existsAliases: ['RodDice3', 'Dice3', DICE_WORDS[2]],
    assetAliases: [RB_DICE_NAMES[2], 'RodDice3', 'Dice3', DICE_WORDS[2]]
  },
  {
    name: RB_DICE_NAMES[3],
    required: false,
    existsAliases: ['RodDice4', 'Dice4', DICE_WORDS[3]],
    assetAliases: [RB_DICE_NAMES[3], 'RodDice4', 'Dice4', DICE_WORDS[3]]
  },
  {
    name: RB_DICE_NAMES[4],
    required: false,
    existsAliases: ['RodDice5', 'Dice5', DICE_WORDS[4]],
    assetAliases: [RB_DICE_NAMES[4], 'RodDice5', 'Dice5', DICE_WORDS[4]]
  },
  {
    name: RB_DICE_NAMES[5],
    required: false,
    existsAliases: ['RodDice6', 'Dice6', DICE_WORDS[5]],
    assetAliases: [RB_DICE_NAMES[5], 'RodDice6', 'Dice6', DICE_WORDS[5]]
  },
  // Optional dice bet type icons (for /dice bet selector).
  {
    name: RB_DICE_BET_TYPE_NAMES[0],
    required: false,
    existsAliases: ['DiceBDTS', 'BothDiceTheSame'],
    assetAliases: [RB_DICE_BET_TYPE_NAMES[0], 'DiceBDTS', 'BothDiceTheSame', 'BothSame']
  },
  {
    name: RB_DICE_BET_TYPE_NAMES[1],
    required: false,
    existsAliases: ['DiceTB59', 'TotalBetween5And9'],
    assetAliases: [RB_DICE_BET_TYPE_NAMES[1], 'DiceTB59', 'TotalBetween5And9', 'TB59']
  },
  {
    name: RB_DICE_BET_TYPE_NAMES[2],
    required: false,
    existsAliases: ['DiceSE', 'SnakeEyes'],
    assetAliases: [RB_DICE_BET_TYPE_NAMES[2], 'DiceSE', 'SnakeEyes']
  },
  {
    name: RB_DICE_BET_TYPE_NAMES[3],
    required: false,
    existsAliases: ['DiceU7', 'TotalUnder7', 'Under7'],
    assetAliases: [RB_DICE_BET_TYPE_NAMES[3], 'DiceU7', 'TotalUnder7', 'Under7']
  },
  {
    name: RB_DICE_BET_TYPE_NAMES[4],
    required: false,
    existsAliases: ['DiceO7', 'TotalOver7', 'Over7'],
    assetAliases: [RB_DICE_BET_TYPE_NAMES[4], 'DiceO7', 'TotalOver7', 'Over7']
  },
  {
    name: RB_DICE_BET_TYPE_NAMES[5],
    required: false,
    existsAliases: ['DiceE7', 'TotalExact7', 'Exact7'],
    assetAliases: [RB_DICE_BET_TYPE_NAMES[5], 'DiceE7', 'TotalExact7', 'Exact7']
  },
  // Optional slot symbols (for /slots UI).
  {
    name: 'RBSlotsGold',
    required: false,
    existsAliases: ['SlotCoin', 'SlotGold', 'Gold', 'Coin', 'Coins', 'CoinStack', 'GoldCoin'],
    assetAliases: ['RBSlotsGold', 'SlotCoin', 'Gold', 'Coin', 'Coins', 'CoinStack']
  },
  {
    name: 'RBSlotsCherry',
    required: false,
    existsAliases: ['SlotCherry', 'Cherry', 'Cherries'],
    assetAliases: ['RBSlotsCherry', 'SlotCherry', 'Cherry']
  },
  {
    name: 'RBSlotsBell',
    required: false,
    existsAliases: ['SlotBell', 'Bell'],
    assetAliases: ['RBSlotsBell', 'SlotBell', 'Bell']
  },
  {
    name: 'RBSlotsBar',
    required: false,
    existsAliases: ['SlotBar', 'Bar', 'BAR'],
    assetAliases: ['RBSlotsBar', 'SlotBar', 'Bar', 'BAR']
  },
  {
    name: 'RBSlots777',
    required: false,
    existsAliases: ['Slot777', '777', 'Seven', 'Sevens'],
    assetAliases: ['RBSlots777', 'Slot777', '777', 'Seven']
  },
  {
    name: 'RBSlotsDiamond',
    required: false,
    existsAliases: ['SlotDiamond', 'Diamond'],
    assetAliases: ['RBSlotsDiamond', 'SlotDiamond', 'Diamond']
  },
  // Optional blackjack button icons (for /blackjack UI).
  {
    name: 'RBHit',
    required: false,
    existsAliases: ['Hit', 'BjHit'],
    assetAliases: ['RBHit', 'Hit', 'HIT', 'BjHit', 'hit']
  },
  {
    name: 'RBStand',
    required: false,
    existsAliases: ['Stand', 'BjStand'],
    assetAliases: ['RBStand', 'Stand', 'STAND', 'BjStand', 'stand']
  },
  {
    name: 'RBDouble',
    required: false,
    existsAliases: ['Double', 'BjDouble'],
    assetAliases: ['RBDouble', 'Double', 'DOUBLE', 'BjDouble', 'double']
  }
];

let crcTable = null;
function getCrcTable() {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return crcTable;
}

function crc32(buf) {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(String(type || ''), 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePngRgba(width, height, rgba) {
  const w = Math.max(1, Math.floor(Number(width) || 0));
  const h = Math.max(1, Math.floor(Number(height) || 0));
  const stride = w * 4;
  const expected = stride * h;
  const pixels = Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba || []);
  if (pixels.length !== expected) throw new Error(`Invalid RGBA buffer length (expected ${expected}, got ${pixels.length}).`);

  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = 0; // filter 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
}

function dicePipKeys(face) {
  const map = {
    1: ['c'],
    2: ['tl', 'br'],
    3: ['tl', 'c', 'br'],
    4: ['tl', 'tr', 'bl', 'br'],
    5: ['tl', 'tr', 'c', 'bl', 'br'],
    6: ['tl', 'ml', 'bl', 'tr', 'mr', 'br']
  };
  return map[face] || ['c'];
}

function generateDiceFacePng(face, size = 128) {
  const s = Math.max(64, Math.min(160, Math.floor(Number(size) || 128)));
  const rgba = Buffer.alloc(s * s * 4);

  const clamp01 = (t) => Math.max(0, Math.min(1, Number(t) || 0));
  const lerp = (a, b, t) => a + (b - a) * clamp01(t);
  const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t), 255];

  // Deterministic "noise" for texture (no Math.random so it's stable across runs).
  const noise = (x, y) => {
    const n = (x * 374761393 + y * 668265263 + face * 1013904223) | 0;
    // xorshift
    let v = n ^ (n << 13);
    v ^= v >> 17;
    v ^= v << 5;
    return ((v >>> 0) % 1000) / 1000;
  };

  const goldA = [215, 171, 80];
  const goldB = [120, 74, 22];
  const redGlow = [255, 60, 40];
  const darkCenterA = [40, 22, 18];
  const darkCenterB = [25, 14, 12];

  const borderThickness = Math.max(14, Math.round(s * 0.16));
  const innerPad = borderThickness + Math.max(2, Math.round(s * 0.02));
  const cx = (s - 1) / 2;
  const cy = (s - 1) / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      const idx = (y * s + x) * 4;
      const dEdge = Math.min(x, y, s - 1 - x, s - 1 - y);
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy) / maxR;

      let col = null;

      if (dEdge < borderThickness) {
        // Gold frame with bevel
        const t = 1 - dEdge / Math.max(1, borderThickness);
        const base = mix(goldA, goldB, t);

        // Red accent near the inner edge of the frame
        const innerGlow = clamp01((dEdge - (borderThickness * 0.72)) / (borderThickness * 0.18));
        const withGlow = mix(base, redGlow, 1 - innerGlow);

        // Slight vignette so corners look heavier
        const vignette = clamp01(r * 1.2);
        col = mix(withGlow, [60, 20, 18], vignette * 0.35);
      } else {
        // Dark "metal" center with texture + subtle radial lighting
        const base = mix(darkCenterA, darkCenterB, clamp01(r));
        const n = noise(x, y);
        const tex = lerp(-14, 14, n);
        const lit = 1 - clamp01((r - 0.2) / 0.9);
        col = [0, 0, 0, 255];
        col[0] = Math.max(0, Math.min(255, Math.round(base[0] + tex + lit * 18)));
        col[1] = Math.max(0, Math.min(255, Math.round(base[1] + tex * 0.8 + lit * 14)));
        col[2] = Math.max(0, Math.min(255, Math.round(base[2] + tex * 0.6 + lit * 10)));
        col[3] = 255;

        // A soft inner border ring
        const ringDist = Math.min(Math.abs(x - innerPad), Math.abs(y - innerPad), Math.abs((s - 1 - innerPad) - x), Math.abs((s - 1 - innerPad) - y));
        if (ringDist < 2) {
          col = mix(col, [210, 140, 55], 0.5);
        }
      }

      rgba[idx + 0] = col[0];
      rgba[idx + 1] = col[1];
      rgba[idx + 2] = col[2];
      rgba[idx + 3] = col[3];
    }
  }

  const margin = Math.round(s * 0.28);
  const left = margin;
  const right = s - margin - 1;
  const top = margin;
  const bottom = s - margin - 1;
  const mid = Math.floor(s / 2);
  const centers = {
    tl: [left, top],
    tr: [right, top],
    ml: [left, mid],
    mr: [right, mid],
    bl: [left, bottom],
    br: [right, bottom],
    c: [mid, mid]
  };

  const r = Math.max(6, Math.round(s * 0.10));
  const keys = dicePipKeys(Math.max(1, Math.min(6, Math.floor(Number(face) || 1))));
  for (const k of keys) {
    const center = centers[k];
    if (!center) continue;
    const [cx, cy] = center;

    const glowR = r * 1.45;
    for (let dy = -Math.ceil(glowR); dy <= Math.ceil(glowR); dy += 1) {
      for (let dx = -Math.ceil(glowR); dx <= Math.ceil(glowR); dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= s || y < 0 || y >= s) continue;

        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (y * s + x) * 4;

        // Outer glow
        if (dist <= glowR && dist > r) {
          const t = 1 - (dist - r) / Math.max(0.0001, glowR - r);
          const add = Math.round(lerp(0, 60, t * t));
          rgba[idx + 0] = Math.max(0, Math.min(255, rgba[idx + 0] + add));
          rgba[idx + 1] = Math.max(0, Math.min(255, rgba[idx + 1] + Math.round(add * 0.2)));
          rgba[idx + 2] = Math.max(0, Math.min(255, rgba[idx + 2] + Math.round(add * 0.15)));
          continue;
        }

        // Ring + core
        if (dist <= r) {
          const t = dist / Math.max(1, r);
          const core = [255, 140, 40];
          const midC = [255, 40, 20];
          const edge = [160, 0, 0];
          const pipCol = t < 0.5 ? mix(core, midC, t * 2) : mix(midC, edge, (t - 0.5) * 2);

          // Thin gold ring
          if (dist >= r * 0.82) {
            const ring = [240, 180, 90];
            const ringMix = 1 - clamp01((r - dist) / (r * 0.18));
            rgba[idx + 0] = Math.round(lerp(pipCol[0], ring[0], ringMix));
            rgba[idx + 1] = Math.round(lerp(pipCol[1], ring[1], ringMix));
            rgba[idx + 2] = Math.round(lerp(pipCol[2], ring[2], ringMix));
            rgba[idx + 3] = 255;
            continue;
          }

          rgba[idx + 0] = Math.round(pipCol[0]);
          rgba[idx + 1] = Math.round(pipCol[1]);
          rgba[idx + 2] = Math.round(pipCol[2]);
          rgba[idx + 3] = 255;
        }
      }
    }
  }

  return encodePngRgba(s, s, rgba);
}

function seededNoise(seed, x, y) {
  const s = Number(seed) || 0;
  const n = (x * 374761393 + y * 668265263 + s * 1013904223) | 0;
  let v = n ^ (n << 13);
  v ^= v >> 17;
  v ^= v << 5;
  return ((v >>> 0) % 1000) / 1000;
}

function clamp01(t) {
  return Math.max(0, Math.min(1, Number(t) || 0));
}

function lerp(a, b, t) {
  return a + (b - a) * clamp01(t);
}

function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t), 255];
}

function setPx(rgba, s, x, y, col) {
  if (x < 0 || y < 0 || x >= s || y >= s) return;
  const idx = (y * s + x) * 4;
  rgba[idx + 0] = col[0];
  rgba[idx + 1] = col[1];
  rgba[idx + 2] = col[2];
  rgba[idx + 3] = col[3] ?? 255;
}

function blendPx(rgba, s, x, y, col, alpha) {
  if (x < 0 || y < 0 || x >= s || y >= s) return;
  const a = clamp01(alpha);
  if (a <= 0) return;
  const idx = (y * s + x) * 4;
  rgba[idx + 0] = Math.round(lerp(rgba[idx + 0], col[0], a));
  rgba[idx + 1] = Math.round(lerp(rgba[idx + 1], col[1], a));
  rgba[idx + 2] = Math.round(lerp(rgba[idx + 2], col[2], a));
  rgba[idx + 3] = 255;
}

function drawCircle(rgba, s, cx, cy, r, col, { glow = 0, glowCol = null } = {}) {
  const rr = Math.max(1, Number(r) || 1);
  const g = Math.max(0, Number(glow) || 0);
  const minX = Math.floor(cx - rr - g - 1);
  const maxX = Math.ceil(cx + rr + g + 1);
  const minY = Math.floor(cy - rr - g - 1);
  const maxY = Math.ceil(cy + rr + g + 1);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= rr) {
        const t = d / Math.max(1, rr);
        const inner = mix(col, [255, 255, 255], (1 - t) * 0.25);
        setPx(rgba, s, x, y, inner);
      } else if (g > 0 && d <= rr + g && glowCol) {
        const t = 1 - (d - rr) / Math.max(1, g);
        blendPx(rgba, s, x, y, glowCol, t * t * 0.6);
      }
    }
  }
}

function fillPoly(rgba, s, pts, col) {
  const points = (pts || []).map((p) => ({ x: p[0], y: p[1] }));
  if (points.length < 3) return;
  const minY = Math.floor(Math.min(...points.map((p) => p.y)));
  const maxY = Math.ceil(Math.max(...points.map((p) => p.y)));
  for (let y = minY; y <= maxY; y += 1) {
    const xInts = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        const t = (y - a.y) / (b.y - a.y);
        xInts.push(a.x + (b.x - a.x) * t);
      }
    }
    xInts.sort((u, v) => u - v);
    for (let k = 0; k < xInts.length; k += 2) {
      const x0 = Math.floor(xInts[k]);
      const x1 = Math.ceil(xInts[k + 1] ?? xInts[k]);
      for (let x = x0; x <= x1; x += 1) setPx(rgba, s, x, y, col);
    }
  }
}

function drawSeg7(rgba, s, x, y, w, h, col) {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) setPx(rgba, s, xx, yy, col);
  }
}

function drawDigit7(rgba, s, ox, oy, scale, col) {
  const t = Math.max(2, Math.round(scale * 0.18));
  const w = Math.round(scale);
  const h = Math.round(scale * 1.35);
  // top
  drawSeg7(rgba, s, ox, oy, w, t, col);
  // upper right
  drawSeg7(rgba, s, ox + w - t, oy, t, Math.round(h * 0.62), col);
  // lower right
  drawSeg7(rgba, s, ox + w - t, oy + Math.round(h * 0.45), t, Math.round(h * 0.55), col);
}

function drawLetterBar(rgba, s, ox, oy, scale, col) {
  const t = Math.max(2, Math.round(scale * 0.14));
  const w = Math.round(scale);
  const h = Math.round(scale * 1.2);
  // B (left + two bumps)
  drawSeg7(rgba, s, ox, oy, t, h, col);
  drawSeg7(rgba, s, ox, oy, w, t, col);
  drawSeg7(rgba, s, ox, oy + Math.round(h * 0.5) - Math.floor(t / 2), w, t, col);
  drawSeg7(rgba, s, ox, oy + h - t, w, t, col);
  drawSeg7(rgba, s, ox + w - t, oy + t, t, Math.round(h * 0.5) - t, col);
  drawSeg7(rgba, s, ox + w - t, oy + Math.round(h * 0.5), t, Math.round(h * 0.5) - t, col);
}

function generateSlotSymbolPng(name, size = 128) {
  const n = String(name || '').trim();
  const s = Math.max(64, Math.min(160, Math.floor(Number(size) || 128)));
  const rgba = Buffer.alloc(s * s * 4);

  // Frame (same vibe as dice)
  const seed = Array.from(n).reduce((acc, ch) => (acc + ch.charCodeAt(0) * 17) | 0, 0) >>> 0;
  const goldA = [215, 171, 80];
  const goldB = [120, 74, 22];
  const redGlow = [255, 60, 40];
  const darkCenterA = [40, 22, 18];
  const darkCenterB = [25, 14, 12];
  const borderThickness = Math.max(14, Math.round(s * 0.16));
  const innerPad = borderThickness + Math.max(2, Math.round(s * 0.02));
  const cx = (s - 1) / 2;
  const cy = (s - 1) / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      const idx = (y * s + x) * 4;
      const dEdge = Math.min(x, y, s - 1 - x, s - 1 - y);
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy) / maxR;

      let col = null;
      if (dEdge < borderThickness) {
        const t = 1 - dEdge / Math.max(1, borderThickness);
        const base = mix(goldA, goldB, t);
        const innerGlow = clamp01((dEdge - borderThickness * 0.72) / (borderThickness * 0.18));
        const withGlow = mix(base, redGlow, 1 - innerGlow);
        const vignette = clamp01(r * 1.2);
        col = mix(withGlow, [60, 20, 18], vignette * 0.35);
      } else {
        const base = mix(darkCenterA, darkCenterB, clamp01(r));
        const tex = lerp(-14, 14, seededNoise(seed, x, y));
        const lit = 1 - clamp01((r - 0.2) / 0.9);
        col = [0, 0, 0, 255];
        col[0] = Math.max(0, Math.min(255, Math.round(base[0] + tex + lit * 18)));
        col[1] = Math.max(0, Math.min(255, Math.round(base[1] + tex * 0.8 + lit * 14)));
        col[2] = Math.max(0, Math.min(255, Math.round(base[2] + tex * 0.6 + lit * 10)));
        col[3] = 255;

        const ringDist = Math.min(
          Math.abs(x - innerPad),
          Math.abs(y - innerPad),
          Math.abs(s - 1 - innerPad - x),
          Math.abs(s - 1 - innerPad - y)
        );
        if (ringDist < 2) col = mix(col, [210, 140, 55], 0.5);
      }

      rgba[idx + 0] = col[0];
      rgba[idx + 1] = col[1];
      rgba[idx + 2] = col[2];
      rgba[idx + 3] = col[3];
    }
  }

  const center = s / 2;
  const iconR = Math.round(s * 0.22);

  if (n.toLowerCase() === 'slotcoin') {
    const gold = [235, 190, 90];
    const glow = [255, 200, 80];
    drawCircle(rgba, s, center - iconR * 0.45, center + iconR * 0.35, iconR * 0.75, gold, { glow: iconR * 0.35, glowCol: glow });
    drawCircle(rgba, s, center + iconR * 0.1, center + iconR * 0.1, iconR * 0.85, gold, { glow: iconR * 0.35, glowCol: glow });
    drawCircle(rgba, s, center + iconR * 0.55, center - iconR * 0.25, iconR * 0.7, gold, { glow: iconR * 0.35, glowCol: glow });
  } else if (n.toLowerCase() === 'slotdiamond') {
    const pts = [
      [center, center - iconR * 1.15],
      [center + iconR * 1.1, center],
      [center, center + iconR * 1.15],
      [center - iconR * 1.1, center]
    ];
    fillPoly(rgba, s, pts, [70, 200, 255, 255]);
    fillPoly(rgba, s, [[center, center - iconR * 1.15], [center + iconR * 0.35, center], [center, center + iconR * 0.15], [center - iconR * 0.15, center]], [210, 245, 255, 255]);
    drawCircle(rgba, s, center - iconR * 0.2, center - iconR * 0.45, iconR * 0.22, [255, 255, 255, 255], { glow: iconR * 0.18, glowCol: [255, 255, 255] });
  } else if (n.toLowerCase() === 'slotcherry') {
    drawCircle(rgba, s, center - iconR * 0.35, center + iconR * 0.25, iconR * 0.7, [220, 20, 20, 255], {
      glow: iconR * 0.25,
      glowCol: [255, 60, 40]
    });
    drawCircle(rgba, s, center + iconR * 0.35, center + iconR * 0.1, iconR * 0.7, [220, 20, 20, 255], {
      glow: iconR * 0.25,
      glowCol: [255, 60, 40]
    });
    // stems
    for (let i = 0; i < iconR * 1.2; i += 1) {
      blendPx(rgba, s, Math.round(center - iconR * 0.2 + i * 0.35), Math.round(center - iconR * 0.55 - i * 0.35), [120, 255, 120], 0.9);
      blendPx(rgba, s, Math.round(center + iconR * 0.1 + i * 0.32), Math.round(center - iconR * 0.45 - i * 0.38), [120, 255, 120], 0.9);
    }
    // leaf
    fillPoly(
      rgba,
      s,
      [
        [center + iconR * 0.55, center - iconR * 0.95],
        [center + iconR * 1.05, center - iconR * 0.7],
        [center + iconR * 0.55, center - iconR * 0.55],
        [center + iconR * 0.2, center - iconR * 0.75]
      ],
      [60, 220, 120, 255]
    );
  } else if (n.toLowerCase() === 'slotbell') {
    // bell body
    fillPoly(
      rgba,
      s,
      [
        [center - iconR * 0.95, center - iconR * 0.4],
        [center + iconR * 0.95, center - iconR * 0.4],
        [center + iconR * 0.7, center + iconR * 1.05],
        [center - iconR * 0.7, center + iconR * 1.05]
      ],
      [245, 190, 90, 255]
    );
    // top cap
    drawCircle(rgba, s, center, center - iconR * 0.65, iconR * 0.35, [245, 190, 90, 255], { glow: iconR * 0.15, glowCol: [255, 200, 100] });
    // clapper
    drawCircle(rgba, s, center, center + iconR * 0.95, iconR * 0.22, [255, 60, 40, 255], { glow: iconR * 0.2, glowCol: [255, 60, 40] });
  } else if (n.toLowerCase() === 'slotbar') {
    // plate
    fillPoly(
      rgba,
      s,
      [
        [center - iconR * 1.4, center - iconR * 0.6],
        [center + iconR * 1.4, center - iconR * 0.6],
        [center + iconR * 1.4, center + iconR * 0.6],
        [center - iconR * 1.4, center + iconR * 0.6]
      ],
      [210, 40, 30, 255]
    );
    // letters "BAR" simplified as blocks
    const letterCol = [255, 220, 140, 255];
    const startX = center - iconR * 1.15;
    const baseY = center - iconR * 0.45;
    const scale = iconR * 0.7;
    // B
    drawLetterBar(rgba, s, Math.round(startX), Math.round(baseY), Math.round(scale), letterCol);
    // A (triangle)
    fillPoly(
      rgba,
      s,
      [
        [startX + scale * 1.35, baseY + scale * 1.2],
        [startX + scale * 1.85, baseY],
        [startX + scale * 2.35, baseY + scale * 1.2]
      ],
      letterCol
    );
    // R (stem + bump)
    drawSeg7(rgba, s, Math.round(startX + scale * 2.6), Math.round(baseY), Math.max(2, Math.round(scale * 0.14)), Math.round(scale * 1.2), letterCol);
    drawSeg7(rgba, s, Math.round(startX + scale * 2.6), Math.round(baseY), Math.round(scale * 0.7), Math.max(2, Math.round(scale * 0.14)), letterCol);
    drawSeg7(
      rgba,
      s,
      Math.round(startX + scale * 3.15),
      Math.round(baseY + scale * 0.05),
      Math.max(2, Math.round(scale * 0.14)),
      Math.round(scale * 0.55),
      letterCol
    );
    for (let i = 0; i < scale * 0.7; i += 1) {
      blendPx(rgba, s, Math.round(startX + scale * 2.85 + i), Math.round(baseY + scale * 0.65 + i), letterCol, 0.9);
    }
  } else if (n.toLowerCase() === 'slot777') {
    const col = [255, 190, 40, 255];
    const scale = iconR * 0.85;
    const y = center - scale * 0.6;
    const x0 = center - scale * 1.55;
    drawDigit7(rgba, s, Math.round(x0), Math.round(y), scale, col);
    drawDigit7(rgba, s, Math.round(x0 + scale * 1.1), Math.round(y), scale, col);
    drawDigit7(rgba, s, Math.round(x0 + scale * 2.2), Math.round(y), scale, col);
    drawCircle(rgba, s, center, center + iconR * 0.95, iconR * 0.22, [255, 60, 40, 255], { glow: iconR * 0.18, glowCol: [255, 60, 40] });
  }

  // Subtle vignette to pop icon
  for (let y = innerPad; y < s - innerPad; y += 1) {
    for (let x = innerPad; x < s - innerPad; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy) / maxR;
      const v = clamp01((r - 0.35) / 0.7);
      if (v <= 0) continue;
      const idx = (y * s + x) * 4;
      rgba[idx + 0] = Math.round(lerp(rgba[idx + 0], 0, v * 0.18));
      rgba[idx + 1] = Math.round(lerp(rgba[idx + 1], 0, v * 0.18));
      rgba[idx + 2] = Math.round(lerp(rgba[idx + 2], 0, v * 0.18));
    }
  }

  return encodePngRgba(s, s, rgba);
}

function generateBrandIconPng(size = 128) {
  const s = Math.max(64, Math.min(160, Math.floor(Number(size) || 128)));
  const rgba = Buffer.alloc(s * s * 4);

  const goldA = [215, 171, 80];
  const goldB = [120, 74, 22];
  const redGlow = [255, 60, 40];
  const darkCenterA = [30, 14, 18];
  const darkCenterB = [15, 8, 10];

  const borderThickness = Math.max(10, Math.round(s * 0.14));
  const innerPad = borderThickness + Math.max(2, Math.round(s * 0.02));
  const cx = (s - 1) / 2;
  const cy = (s - 1) / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);

  // Frame + background (same family as dice/slots).
  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      const idx = (y * s + x) * 4;
      const dEdge = Math.min(x, y, s - 1 - x, s - 1 - y);
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy) / maxR;

      let col = null;
      if (dEdge < borderThickness) {
        const t = 1 - dEdge / Math.max(1, borderThickness);
        const base = mix(goldA, goldB, t);
        const innerGlow = clamp01((dEdge - borderThickness * 0.7) / (borderThickness * 0.22));
        const withGlow = mix(base, redGlow, 1 - innerGlow);
        const vignette = clamp01(r * 1.25);
        col = mix(withGlow, [55, 16, 18], vignette * 0.35);
      } else {
        // Dark, slightly red vignette center.
        const base = mix(darkCenterA, darkCenterB, clamp01(r));
        const tex = lerp(-10, 10, seededNoise(777, x, y));
        const lit = 1 - clamp01((r - 0.15) / 0.9);
        col = [0, 0, 0, 255];
        col[0] = Math.max(0, Math.min(255, Math.round(base[0] + tex + lit * 14)));
        col[1] = Math.max(0, Math.min(255, Math.round(base[1] + tex * 0.8 + lit * 10)));
        col[2] = Math.max(0, Math.min(255, Math.round(base[2] + tex * 0.6 + lit * 12)));
        col[3] = 255;
      }

      rgba[idx + 0] = col[0];
      rgba[idx + 1] = col[1];
      rgba[idx + 2] = col[2];
      rgba[idx + 3] = col[3];
    }
  }

  const iconR = (s - innerPad * 2) * 0.42;
  const center = Math.floor(s / 2);

  // Helper: solid disc (no highlight).
  const drawDisc = (x0, y0, r0, col) => {
    const rr = Math.max(1, Number(r0) || 1);
    const minX = Math.floor(x0 - rr);
    const maxX = Math.ceil(x0 + rr);
    const minY = Math.floor(y0 - rr);
    const maxY = Math.ceil(y0 + rr);
    const rr2 = rr * rr;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - x0;
        const dy = y - y0;
        if (dx * dx + dy * dy <= rr2) setPx(rgba, s, x, y, col);
      }
    }
  };

  const drawLineDisc = (x0, y0, x1, y1, r0, col) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      drawDisc(Math.round(x0 + dx * t), Math.round(y0 + dy * t), r0, col);
    }
  };

  // Flame backdrop (two layers).
  const flameOuter = [220, 40, 30, 255];
  const flameInner = [255, 120, 40, 255];
  fillPoly(
    rgba,
    s,
    [
      [center, center - iconR * 1.25],
      [center - iconR * 0.95, center - iconR * 0.2],
      [center - iconR * 0.55, center + iconR * 1.25],
      [center, center + iconR * 0.75],
      [center + iconR * 0.55, center + iconR * 1.25],
      [center + iconR * 0.95, center - iconR * 0.2]
    ],
    flameOuter
  );
  fillPoly(
    rgba,
    s,
    [
      [center, center - iconR * 0.95],
      [center - iconR * 0.7, center - iconR * 0.15],
      [center - iconR * 0.35, center + iconR * 0.95],
      [center, center + iconR * 0.55],
      [center + iconR * 0.35, center + iconR * 0.95],
      [center + iconR * 0.7, center - iconR * 0.15]
    ],
    flameInner
  );

  // Monogram "R" (shadow + main).
  const stroke = Math.max(6, Math.round(s * 0.085));
  const top = Math.round(center - iconR * 0.95);
  const bottom = Math.round(center + iconR * 1.05);
  const stemX = Math.round(center - iconR * 0.55);
  const bowlW = Math.round(iconR * 0.95);
  const bowlH = Math.round(iconR * 0.6);
  const midY = Math.round(top + bowlH);

  const shadow = [35, 10, 12, 255];
  const main = [245, 245, 245, 255];

  const drawR = (offX, offY, col) => {
    // stem
    drawSeg7(rgba, s, stemX + offX, top + offY, stroke, bottom - top, col);
    // top bar
    drawSeg7(rgba, s, stemX + offX, top + offY, bowlW, stroke, col);
    // right upper
    drawSeg7(rgba, s, stemX + offX + bowlW - stroke, top + offY, stroke, bowlH, col);
    // mid bar
    drawSeg7(rgba, s, stemX + offX, midY + offY, bowlW, stroke, col);
    // diagonal leg
    drawLineDisc(stemX + offX + stroke, midY + offY + stroke, stemX + offX + bowlW, bottom + offY, Math.round(stroke * 0.45), col);
  };

  drawR(2, 2, shadow);
  drawR(0, 0, main);

  // Subtle inner glow around the emblem.
  drawCircle(rgba, s, center, center + iconR * 0.15, iconR * 1.05, [255, 60, 40, 255], { glow: iconR * 0.28, glowCol: [255, 60, 40] });

  // Darken edges a bit (vignette).
  for (let y = innerPad; y < s - innerPad; y += 1) {
    for (let x = innerPad; x < s - innerPad; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy) / maxR;
      const v = clamp01((r - 0.28) / 0.75);
      if (v <= 0) continue;
      const idx = (y * s + x) * 4;
      rgba[idx + 0] = Math.round(lerp(rgba[idx + 0], 0, v * 0.22));
      rgba[idx + 1] = Math.round(lerp(rgba[idx + 1], 0, v * 0.22));
      rgba[idx + 2] = Math.round(lerp(rgba[idx + 2], 0, v * 0.22));
    }
  }

  return encodePngRgba(s, s, rgba);
}

function generateActionButtonPng(name, size = 128) {
  const n = String(name || '').trim();
  const s = Math.max(64, Math.min(160, Math.floor(Number(size) || 128)));
  const rgba = Buffer.alloc(s * s * 4);

  // Frame (same vibe as dice/slots/brand).
  const seed = Array.from(n).reduce((acc, ch) => (acc + ch.charCodeAt(0) * 29) | 0, 0) >>> 0;
  const goldA = [215, 171, 80];
  const goldB = [120, 74, 22];
  const redGlow = [255, 60, 40];
  const darkCenterA = [36, 18, 20];
  const darkCenterB = [18, 10, 12];
  const borderThickness = Math.max(12, Math.round(s * 0.15));
  const innerPad = borderThickness + Math.max(2, Math.round(s * 0.02));
  const cx = (s - 1) / 2;
  const cy = (s - 1) / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      const idx = (y * s + x) * 4;
      const dEdge = Math.min(x, y, s - 1 - x, s - 1 - y);
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy) / maxR;

      let col = null;
      if (dEdge < borderThickness) {
        const t = 1 - dEdge / Math.max(1, borderThickness);
        const base = mix(goldA, goldB, t);
        const innerGlow = clamp01((dEdge - borderThickness * 0.7) / (borderThickness * 0.22));
        const withGlow = mix(base, redGlow, 1 - innerGlow);
        const vignette = clamp01(r * 1.25);
        col = mix(withGlow, [55, 16, 18], vignette * 0.35);
      } else {
        const base = mix(darkCenterA, darkCenterB, clamp01(r));
        const tex = lerp(-12, 12, seededNoise(seed, x, y));
        const lit = 1 - clamp01((r - 0.15) / 0.9);
        col = [0, 0, 0, 255];
        col[0] = Math.max(0, Math.min(255, Math.round(base[0] + tex + lit * 14)));
        col[1] = Math.max(0, Math.min(255, Math.round(base[1] + tex * 0.8 + lit * 10)));
        col[2] = Math.max(0, Math.min(255, Math.round(base[2] + tex * 0.6 + lit * 12)));
        col[3] = 255;

        // A soft inner border ring.
        const ringDist = Math.min(
          Math.abs(x - innerPad),
          Math.abs(y - innerPad),
          Math.abs((s - 1 - innerPad) - x),
          Math.abs((s - 1 - innerPad) - y)
        );
        if (ringDist < 2) col = mix(col, [210, 140, 55], 0.45);
      }

      rgba[idx + 0] = col[0];
      rgba[idx + 1] = col[1];
      rgba[idx + 2] = col[2];
      rgba[idx + 3] = col[3];
    }
  }

  const lower = n.toLowerCase();
  const center = Math.floor(s / 2);
  const iconR = (s - innerPad * 2) * 0.45;

  if (lower === 'hit') {
    const green = [60, 255, 140, 255];
    drawCircle(rgba, s, center, center - iconR * 0.35, iconR * 0.95, green, { glow: iconR * 0.35, glowCol: [60, 255, 140] });

    // Arrow stem
    const stemW = Math.max(6, Math.round(iconR * 0.22));
    const stemH = Math.max(10, Math.round(iconR * 1.05));
    drawSeg7(rgba, s, Math.round(center - stemW / 2), Math.round(center - iconR * 0.15), stemW, stemH, green);

    // Arrow head
    fillPoly(
      rgba,
      s,
      [
        [center, center - iconR * 1.15],
        [center - iconR * 0.75, center - iconR * 0.25],
        [center + iconR * 0.75, center - iconR * 0.25]
      ],
      green
    );

    // Little red core glow (matches your theme)
    drawCircle(rgba, s, center, center + iconR * 0.92, iconR * 0.22, [255, 60, 40, 255], {
      glow: iconR * 0.2,
      glowCol: [255, 60, 40]
    });
  } else if (lower === 'stand') {
    const gold = [255, 210, 120, 255];
    const goldHi = [255, 235, 170, 255];

    // Outer shield
    fillPoly(
      rgba,
      s,
      [
        [center - iconR * 0.85, center - iconR * 0.95],
        [center + iconR * 0.85, center - iconR * 0.95],
        [center + iconR * 0.72, center + iconR * 0.2],
        [center, center + iconR * 1.15],
        [center - iconR * 0.72, center + iconR * 0.2]
      ],
      gold
    );

    // Inner highlight
    fillPoly(
      rgba,
      s,
      [
        [center - iconR * 0.62, center - iconR * 0.78],
        [center + iconR * 0.62, center - iconR * 0.78],
        [center + iconR * 0.52, center + iconR * 0.18],
        [center, center + iconR * 0.9],
        [center - iconR * 0.52, center + iconR * 0.18]
      ],
      goldHi
    );

    // Center gem
    drawCircle(rgba, s, center, center + iconR * 0.12, iconR * 0.22, [255, 60, 40, 255], {
      glow: iconR * 0.24,
      glowCol: [255, 60, 40]
    });
  } else if (lower === 'double') {
    const cardBack = [255, 120, 70, 255];
    const cardFront = [255, 80, 50, 255];
    const outline = [255, 220, 140, 255];
    const w = iconR * 1.25;
    const h = iconR * 1.55;
    const skew = iconR * 0.18;

    const drawCard = (x0, y0, col) => {
      fillPoly(
        rgba,
        s,
        [
          [x0 + skew, y0],
          [x0 + w + skew, y0 + skew * 0.1],
          [x0 + w, y0 + h],
          [x0, y0 + h - skew * 0.1]
        ],
        col
      );
      // Simple outline strips
      drawSeg7(rgba, s, Math.round(x0 + skew * 0.6), Math.round(y0 + skew * 0.08), Math.round(w * 0.9), Math.max(2, Math.round(iconR * 0.08)), outline);
      drawSeg7(rgba, s, Math.round(x0 + skew * 0.4), Math.round(y0 + h - iconR * 0.12), Math.round(w * 0.85), Math.max(2, Math.round(iconR * 0.08)), outline);
    };

    drawCard(center - iconR * 0.95, center - iconR * 0.95, cardBack);
    drawCard(center - iconR * 0.62, center - iconR * 0.72, cardFront);

    // Small "pips"
    drawCircle(rgba, s, center - iconR * 0.2, center - iconR * 0.15, iconR * 0.18, [255, 240, 240, 255], {
      glow: iconR * 0.18,
      glowCol: [255, 200, 180]
    });
    drawCircle(rgba, s, center + iconR * 0.25, center + iconR * 0.28, iconR * 0.16, [255, 240, 240, 255], {
      glow: iconR * 0.18,
      glowCol: [255, 200, 180]
    });

    // Red glow at bottom like your theme
    drawCircle(rgba, s, center, center + iconR * 0.95, iconR * 0.22, [255, 60, 40, 255], {
      glow: iconR * 0.2,
      glowCol: [255, 60, 40]
    });
  }

  return encodePngRgba(s, s, rgba);
}

function maybeGenerateEmojiBuffer(emojiName) {
  const name = String(emojiName || '').trim();
  if (!name) return null;

  if (name === 'RodstarkG') return generateBrandIconPng(128);

  const actionNameMap = {
    Hit: 'Hit',
    Stand: 'Stand',
    Double: 'Double',
    RBHit: 'Hit',
    RBStand: 'Stand',
    RBDouble: 'Double'
  };
  if (actionNameMap[name]) return generateActionButtonPng(actionNameMap[name], 128);

  const wordIdx = DICE_WORDS.findIndex((w) => String(w).toLowerCase() === name.toLowerCase());
  if (wordIdx !== -1) return generateDiceFacePng(wordIdx + 1, 128);

  const m = name.match(/^(?:RBDice|RodDice|Dice)([1-6])$/);
  if (m) return generateDiceFacePng(Number(m[1]), 128);

  const slotNameMap = {
    SlotCoin: 'SlotCoin',
    SlotDiamond: 'SlotDiamond',
    SlotCherry: 'SlotCherry',
    SlotBell: 'SlotBell',
    SlotBar: 'SlotBar',
    Slot777: 'Slot777',
    RBSlotsGold: 'SlotCoin',
    RBSlotsDiamond: 'SlotDiamond',
    RBSlotsCherry: 'SlotCherry',
    RBSlotsBell: 'SlotBell',
    RBSlotsBar: 'SlotBar',
    RBSlots777: 'Slot777',
    RBSlotSpin: 'SlotBar',
    RBSlotSpin2: 'Slot777',
    RBSlotSpin3: 'SlotBell'
  };
  const slotBase = slotNameMap[name];
  if (slotBase) {
    return generateSlotSymbolPng(slotBase, 128);
  }
  return null;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function listAssetFilesRecursive(rootDir, { maxDepth = 6 } = {}) {
  const allowedExt = new Set(['.gif', '.png', '.webp', '.jpg', '.jpeg']);
  const out = [];

  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    // eslint-disable-next-line no-await-in-loop
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (depth < maxDepth) queue.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name || '').toLowerCase();
      if (!allowedExt.has(ext)) continue;
      out.push(full);
    }
  }
  return out;
}

function resolveAssetRoots(assetsDir) {
  const raw = String(assetsDir || '').trim();
  if (!raw) return [];
  if (path.isAbsolute(raw)) return [raw];

  const roots = [
    path.resolve(process.cwd(), raw),
    path.resolve(SOURCE_ROOT, raw),
    path.resolve(SOURCE_ROOT_PARENT, raw)
  ];

  return Array.from(new Set(roots.map((v) => path.normalize(v))));
}

async function pickBestAssetMatch(assetsDir, emojiName, aliases = []) {
  const base = String(emojiName || '').trim();
  if (!base) return '';

  const baseAliases = [base, ...(Array.isArray(aliases) ? aliases : [])].filter(Boolean);
  const rodDice = base.match(/^(?:RBDice|RodDice)([1-6])$/);
  if (rodDice) baseAliases.push(`Dice${rodDice[1]}`, DICE_WORDS[Number(rodDice[1]) - 1]);

  const uniqAliases = Array.from(new Set(baseAliases.map((v) => String(v || '').trim()).filter(Boolean)));

  const candidates = [];
  for (const b of uniqAliases) {
    candidates.push(`${b}.gif`, `${b}.png`, `${b}.webp`, `${b}.jpg`, `${b}.jpeg`);
  }

  const roots = resolveAssetRoots(assetsDir);
  for (const root of roots) {
    for (const filename of candidates) {
      const full = path.resolve(root, filename);
      // eslint-disable-next-line no-await-in-loop
      if (await fileExists(full)) return full;
    }
  }

  const targetKeys = uniqAliases.map(normalizeKey).filter(Boolean);
  if (!targetKeys.length) return '';

  let bestWithinLimit = null;
  let bestAny = null;
  for (const root of roots) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await fileExists(root))) continue;
    // eslint-disable-next-line no-await-in-loop
    const files = await listAssetFilesRecursive(root, { maxDepth: 8 });
    for (const full of files) {
      const filename = path.basename(full);
      const nameNoExt = filename.replace(path.extname(filename), '');
      const key = normalizeKey(nameNoExt);
      if (!key) continue;
      if (!targetKeys.some((tk) => key.includes(tk))) continue;

      // eslint-disable-next-line no-await-in-loop
      const st = await fs.stat(full).catch(() => null);
      const size = st?.size || 0;
      const withinLimit = size > 0 && size <= DEFAULT_MAX_BYTES;

      let score = 0;
      for (const tk of targetKeys) {
        if (key === tk) score = Math.max(score, 1000);
        else if (key.startsWith(tk)) score = Math.max(score, 400);
        else if (key.includes(tk)) score = Math.max(score, 200);
      }
      if (key.includes('opti') || key.includes('optimized') || key.includes('small')) score += 80;
      if (withinLimit) score += 120;
      else score -= 400;
      score += Math.max(0, 200 - Math.floor(size / 1024));

      if (!bestAny || score > bestAny.score) bestAny = { full, score, size, withinLimit };
      if (withinLimit) {
        if (!bestWithinLimit || score > bestWithinLimit.score) bestWithinLimit = { full, score, size, withinLimit };
      }
    }
  }

  return bestWithinLimit?.full || bestAny?.full || '';
}

function hasEmoji(guild, name) {
  const normalize = (v) => String(v || '').trim().replace(/^:+|:+$/g, '').toLowerCase();
  const n = normalize(name);
  if (!n) return false;
  return Boolean(guild?.emojis?.cache?.some?.((e) => normalize(e?.name) === n));
}

function findEmoji(guild, name) {
  const normalize = (v) => String(v || '').trim().replace(/^:+|:+$/g, '').toLowerCase();
  const n = normalize(name);
  if (!n) return null;
  return guild?.emojis?.cache?.find?.((e) => normalize(e?.name) === n) || null;
}

function findEmojiAny(guild, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    const hit = findEmoji(guild, name);
    if (hit) return hit;
  }
  return null;
}

function sanitizeEmojiName(name) {
  return String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .slice(0, 32);
}

function buildBackupEmojiName(guild, baseName) {
  const base = sanitizeEmojiName(baseName) || 'emoji';
  for (let i = 0; i < 6; i += 1) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = sanitizeEmojiName(`${base}_old_${suffix}`);
    if (!candidate || candidate.length < 2) continue;
    if (!hasEmoji(guild, candidate)) return candidate;
  }
  return sanitizeEmojiName(`${base}_old_${Date.now().toString(36).slice(-4)}`);
}

function isEmojiLimitError(err) {
  const code = err?.code || err?.rawError?.code;
  if (code === 30008) return true;
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('maximum number of emojis') || msg.includes('30008');
}

function compactDiscordError(err) {
  if (!err) return { message: 'Unknown error' };
  return {
    code: err?.code ?? err?.rawError?.code ?? null,
    status: err?.status ?? null,
    message: String(err?.message || 'Unknown error'),
    method: err?.method || null,
    url: err?.url || null
  };
}

async function createGuildEmoji(guild, name, assetPath) {
  const buf = await fs.readFile(assetPath);
  return await guild.emojis.create({ attachment: buf, name });
}

async function seedEconomyEmojisForGuild(guild, options = {}) {
  const force = Boolean(options.force);
  if (!force && !env.ECONOMY_SEED_EMOJIS) return { ok: true, skipped: true };
  if (!guild?.id) return { ok: false, reason: 'Missing guild.' };

  const only =
    Array.isArray(options.only) && options.only.length
      ? new Set(options.only.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean))
      : null;
  const forceRefreshNames =
    Array.isArray(options.forceRefreshNames) && options.forceRefreshNames.length
      ? new Set(options.forceRefreshNames.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean))
      : new Set();
  const refreshFromAssets = Boolean(options.refreshFromAssets);
  const preserveOld = options.preserveOld !== false;

  const assetsDir = String(env.ECONOMY_EMOJI_ASSETS_DIR || DEFAULT_ASSETS_DIR).trim() || DEFAULT_ASSETS_DIR;

  await guild.emojis.fetch().catch(() => null);

  const created = [];
  const refreshed = [];
  const missingAssets = [];
  const failed = [];
  const emojiLimit = Math.max(0, Math.floor(Number(guild?.maximumEmojis) || 50));
  let emojiCount = Math.max(0, Math.floor(Number(guild?.emojis?.cache?.size) || 0));
  let emojiSlotsExhausted = emojiLimit > 0 && emojiCount >= emojiLimit;
  let limitLogged = false;

  const markEmojiLimit = (emojiName, message = 'Emoji limit reached; skipping remaining creations for this sync.') => {
    if (limitLogged) return;
    limitLogged = true;
    logger.info(
      {
        guildId: guild.id,
        emoji: String(emojiName || ''),
        emojiCount,
        emojiLimit
      },
      message
    );
  };

  for (const spec of EMOJI_SPECS) {
    if (only && !only.has(String(spec.name || '').toLowerCase())) continue;

    const existsAliases = Array.isArray(spec.existsAliases) ? spec.existsAliases : Array.isArray(spec.aliases) ? spec.aliases : [];
    const assetAliases = Array.isArray(spec.assetAliases) ? spec.assetAliases : existsAliases;

    const existing = findEmoji(guild, spec.name);
    const specNameLower = String(spec.name || '').toLowerCase();
    const enforceCanonical = specNameLower.startsWith('rb');
    const aliasMatch = findEmojiAny(guild, existsAliases);
    const aliasExists = Boolean(aliasMatch);
    const alreadyExists = Boolean(existing) || (!enforceCanonical && aliasExists);
    const isOptional = !Boolean(spec?.required);

    // If canonical RB emoji is missing but an alias exists (e.g. "Heads", "SlotCoin"),
    // rename alias -> canonical name to keep one consistent emoji per server without using extra slots.
    if (!existing && enforceCanonical && aliasMatch) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await aliasMatch.edit({ name: spec.name });
        refreshed.push(spec.name);
        continue;
      } catch {
        // Fall through to create/refresh path.
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const assetPath = await pickBestAssetMatch(assetsDir, spec.name, assetAliases);

    const refreshManaged =
      specNameLower.startsWith('slot') ||
      specNameLower.startsWith('rbslot') ||
      specNameLower.startsWith('rbdice') ||
      [
        'rbcredit',
        'rbheads',
        'rbtails',
        'rbcoinflip',
        'hit',
        'stand',
        'double',
        'rbhit',
        'rbstand',
        'rbdouble',
        'rodstarkg',
        'rbbrand',
        'rblogo'
      ].includes(specNameLower);
    if (refreshFromAssets && existing && refreshManaged) {
      // Refresh slot emojis when:
      // - you add PNGs later (assets newer than emoji)
      // - the emoji is unavailable (e.g. boost slot disabled)
      // - the emoji is role-restricted (bot might not be able to use it, so we replace with an unrestricted one)
      const createdAt = Number(existing.createdTimestamp) || 0;
      const roleRestricted = Array.isArray(existing?._roles) && existing._roles.length > 0;
      const unavailable = existing?.available === false;

      // eslint-disable-next-line no-await-in-loop
      const st = assetPath ? await fs.stat(assetPath).catch(() => null) : null;
      const mtimeMs = st?.mtimeMs || 0;
      const assetNewer = Boolean(assetPath) && mtimeMs > createdAt + 5_000;

      const generatedForRefresh = assetPath ? null : maybeGenerateEmojiBuffer(spec.name);
      const canRefresh = Boolean(assetPath || generatedForRefresh);
      const wouldNeedExtraSlot = preserveOld;
      const canRefreshAtLimit = !wouldNeedExtraSlot || !emojiSlotsExhausted;
      const forceRefresh = forceRefreshNames.has(specNameLower);
      const shouldRefresh = canRefresh && canRefreshAtLimit && (forceRefresh || assetNewer || roleRestricted || unavailable);

      if (shouldRefresh) {
        try {
          const buf = assetPath ? await fs.readFile(assetPath) : generatedForRefresh;
          if (!buf || !buf.length) throw new Error('Empty emoji buffer');
          if (buf.length > DEFAULT_MAX_BYTES) throw new Error(`Emoji asset too large (${buf.length} bytes)`);

          const backupName = buildBackupEmojiName(guild, spec.name);
          const renamed = await existing.edit({ name: backupName }).catch(() => null);
          const renameOk = Boolean(renamed);
          if (!renameOk) continue;

          try {
            // eslint-disable-next-line no-await-in-loop
            await guild.emojis.create({ attachment: buf, name: spec.name });

            if (!preserveOld) {
              // Keep emoji count stable by removing the backup.
              await existing.delete().catch(() => null);
            }

            refreshed.push(spec.name);
            continue;
          } catch (createErr) {
            if (!preserveOld && isEmojiLimitError(createErr)) {
              // If we're at the emoji limit, delete the backup and retry once.
              await existing.delete().catch(() => null);
              try {
                // eslint-disable-next-line no-await-in-loop
                await guild.emojis.create({ attachment: buf, name: spec.name });
                emojiCount = Math.max(0, emojiCount);
                refreshed.push(spec.name);
                continue;
              } catch (retryErr) {
                if (isEmojiLimitError(retryErr)) {
                  emojiSlotsExhausted = true;
                  markEmojiLimit(spec.name, 'Emoji limit reached while refreshing emoji.');
                  continue;
                }
                failed.push(spec.name);
                logger.warn(
                  { error: compactDiscordError(retryErr), guildId: guild.id, emoji: spec.name },
                  'Failed to refresh slot emoji after freeing emoji slot'
                );
                continue;
              }
            }

            // Roll back rename so the old emoji is still usable.
            await existing.edit({ name: spec.name }).catch(() => null);
            throw createErr;
          }
        } catch (err) {
          if (isEmojiLimitError(err)) {
            emojiSlotsExhausted = true;
            markEmojiLimit(spec.name, 'Emoji limit reached while refreshing emoji.');
            continue;
          }
          failed.push(spec.name);
          logger.warn(
            { error: compactDiscordError(err), guildId: guild.id, emoji: spec.name },
            'Failed to refresh slot emoji from assets (check emoji limits + permissions + size limits)'
          );
          // Fall through (do not attempt create below since name may still exist).
          continue;
        }
      }
    }

    if (alreadyExists) continue;
    if (emojiSlotsExhausted) {
      if (!isOptional) failed.push(spec.name);
      markEmojiLimit(spec.name);
      continue;
    }

    const generated = assetPath ? null : maybeGenerateEmojiBuffer(spec.name);
    if (!assetPath && !generated) {
      if (spec.required) missingAssets.push(spec.name);
      continue;
    }

    try {
      const buf = assetPath ? await fs.readFile(assetPath) : generated;
      if (!buf || !buf.length) throw new Error('Empty emoji buffer');
      if (buf.length > DEFAULT_MAX_BYTES) throw new Error(`Emoji asset too large (${buf.length} bytes)`);

      // eslint-disable-next-line no-await-in-loop
      const emoji = await guild.emojis.create({ attachment: buf, name: spec.name });
      created.push(emoji?.name || spec.name);
      emojiCount += 1;
      emojiSlotsExhausted = emojiLimit > 0 && emojiCount >= emojiLimit;
    } catch (err) {
      if (isEmojiLimitError(err)) {
        emojiSlotsExhausted = true;
        markEmojiLimit(spec.name);
        if (!isOptional) failed.push(spec.name);
        continue;
      }
      failed.push(spec.name);
      logger.warn(
        { error: compactDiscordError(err), guildId: guild.id, emoji: spec.name },
        'Failed to seed economy emoji (check Manage Guild Expressions + emoji size limits)'
      );
    }
  }

  if (missingAssets.length) {
    logger.warn(
      { guildId: guild.id, missingAssets, assetsDir },
      'Emoji seeding enabled but some required emoji assets are missing'
    );
  }

  if (created.length || refreshed.length) {
    logger.info(
      { guildId: guild.id, createdCount: created.length, refreshedCount: refreshed.length },
      'Economy emoji sync applied'
    );
  }

  return { ok: true, created, refreshed, missingAssets, failed };
}

module.exports = { seedEconomyEmojisForGuild };
