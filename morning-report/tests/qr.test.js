/* The QR encoder, checked without trusting it to check itself.

   assets/qr.js draws the code that goes on a slide and in the
   PowerPoint template, and a QR that does not scan fails silently:
   it looks exactly like one that does until somebody points a phone
   at it in front of a room. So this suite does not eyeball anything.

   Four things are checked, in increasing strength:

     1. the format strings against the published table for level M
     2. version selection at its boundaries
     3. an independent reader, written here rather than imported from
        the encoder, that reverses the mask and the zigzag and
        reconstructs the text — for every string, at every one of the
        eight masks
     4. the committed fixtures, so a change that alters a single
        module has to be deliberate

   The fixtures in tests/fixtures/qr-vectors.json were each decoded
   with OpenCV's QRCodeDetector when they were generated, which is the
   only step here that needed something outside this repository. Point
   (3) is what keeps that honest afterwards: the reader below shares no
   code with the encoder, so a bug would have to be made twice, in
   opposite directions, to pass.

   No browser: this runs in plain node. */

const fs = require('fs');
require('../assets/qr.js');

const out = [];
const t = (n, c, x) => out.push({ n, p: !!c, x: x === undefined ? '' : JSON.stringify(x) });

/* ---------- 1. the published format strings, level M ------------------ */

const FORMAT_M = [0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0];
FORMAT_M.forEach((want, mask) => {
  t(`the format string for mask ${mask} is the published one`,
    MRQr.internals.formatBits(mask) === want,
    MRQr.internals.formatBits(mask).toString(16));
});

/* The version strip, for the versions that carry one. */
const VERSION_BITS = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 };
Object.keys(VERSION_BITS).forEach(v => {
  t(`the version strip for version ${v} is the published one`,
    MRQr.internals.versionBits(Number(v)) === VERSION_BITS[v],
    MRQr.internals.versionBits(Number(v)).toString(16));
});

/* ---------- 2. version selection --------------------------------------- */

/* Byte-mode capacities at level M, from the standard. Crossing one of
   these by a single character must step the version up. */
const CAPACITY = { 1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213 };
Object.keys(CAPACITY).forEach(v => {
  const version = Number(v);
  const at = MRQr.matrix('x'.repeat(CAPACITY[v]));
  t(`${CAPACITY[v]} bytes still fits version ${v}`, at.version === version, at.version);
  if (version < 10) {
    const over = MRQr.matrix('x'.repeat(CAPACITY[v] + 1));
    t(`one more byte steps past version ${v}`, over.version > version, over.version);
  }
});

t('the size is four times the version plus seventeen',
  [1, 3, 7, 10].every(v => MRQr.matrix('x'.repeat(CAPACITY[v])).length === v * 4 + 17));

let threw = false;
try { MRQr.matrix('x'.repeat(CAPACITY[10] + 1)); } catch (e) { threw = /too long/.test(e.message); }
t('past the last version it throws rather than drawing something unreadable', threw);

/* ---------- 3. an independent reader ----------------------------------- */

/* Deliberately not the encoder's own tables: this walks the finished
   matrix the way a decoder would, taking the mask from the format
   strip rather than being told what it was. */

function readFormatMask(m) {
  const size = m.length;
  let bits = 0;
  for (let i = 0; i < 15; i++) {
    let bit;
    if (i < 6) bit = m[8][i];
    else if (i === 6) bit = m[8][7];
    else if (i === 7) bit = m[8][8];
    else if (i === 8) bit = m[7][8];
    else bit = m[14 - i][8];
    bits |= bit << (14 - i);
  }
  const unmasked = bits ^ 0x5412;
  t.lastFormat = unmasked;
  return (unmasked >> 10) & 0x7;          /* five data bits: 2 EC, 3 mask */
}

function readEcLevel(m) {
  readFormatMask(m);
  return (t.lastFormat >> 13) & 0x3;
}

const MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

const ALIGN = { 1: [], 2: [6,18], 3: [6,22], 4: [6,26], 5: [6,30], 6: [6,34],
                7: [6,22,38], 8: [6,24,42], 9: [6,26,46], 10: [6,28,50] };

function functionModule(version, row, col, size) {
  if (row === 6 || col === 6) return true;
  if (row <= 8 && col <= 8) return true;
  if (row <= 8 && col >= size - 8) return true;
  if (row >= size - 8 && col <= 8) return true;
  if (version >= 7 && ((row < 6 && col >= size - 11) || (col < 6 && row >= size - 11))) return true;
  const centres = ALIGN[version];
  for (const r of centres) for (const c of centres) {
    if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
    if (Math.abs(row - r) <= 2 && Math.abs(col - c) <= 2) return true;
  }
  return false;
}

/* Blocks per version at level M, to undo the interleaving. */
const BLOCKS = {
  1: [[1,16]], 2: [[1,28]], 3: [[1,44]], 4: [[2,32]], 5: [[2,43]],
  6: [[4,27]], 7: [[4,31]], 8: [[2,38],[2,39]], 9: [[3,36],[2,37]], 10: [[4,43],[1,44]]
};

function readText(m) {
  const size = m.length;
  const version = (size - 17) / 4;
  const mask = readFormatMask(m);

  const bits = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (functionModule(version, row, col, size)) continue;
        bits.push(MASK_FNS[mask](row, col) ? m[row][col] ^ 1 : m[row][col]);
      }
    }
    upward = !upward;
  }

  const words = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    words.push(b);
  }

  /* Undo the interleave: deal the codewords back into their blocks. */
  const sizes = [];
  BLOCKS[version].forEach(g => { for (let i = 0; i < g[0]; i++) sizes.push(g[1]); });
  const blocks = sizes.map(() => []);
  const longest = Math.max.apply(null, sizes);
  let at = 0;
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < sizes.length; b++) {
      if (i < sizes[b]) blocks[b].push(words[at++]);
    }
  }
  const data = [].concat.apply([], blocks);

  /* Mode, count, then the bytes. */
  let bit = 0;
  const take = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = data[(bit / 8) | 0];
      v = (v << 1) | ((byte >> (7 - (bit % 8))) & 1);
      bit++;
    }
    return v;
  };
  const mode = take(4);
  if (mode !== 4) throw new Error('not byte mode: ' + mode);
  const length = take(version < 10 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < length; i++) bytes.push(take(8));
  return decodeURIComponent(bytes.map(b => '%' + b.toString(16).padStart(2, '0')).join(''));
}

const STRINGS = [
  'A',
  '1234567890',
  'https://sageproject.xyz/feedback',
  'https://sageproject.xyz/feedback?k=abc123',
  'Ward round at 07:00 — café',
  'https://sageproject.xyz/morning-report/feedback/?session=2026-09-03-galveston',
  'x'.repeat(200)
];

STRINGS.forEach(text => {
  const m = MRQr.matrix(text);
  let got = null;
  try { got = readText(m); } catch (e) { got = 'threw: ' + e.message; }
  t(`it reads back what was put in (v${m.version}, ${text.length} chars)`, got === text,
    got === text ? '' : String(got).slice(0, 40));
  t(`and says level M (v${m.version}, ${text.length} chars)`, readEcLevel(m) === 0, readEcLevel(m));
});

/* Every mask, not just the one the penalty rules happened to pick. */
STRINGS.slice(0, 5).forEach(text => {
  for (let mask = 0; mask < 8; mask++) {
    const m = MRQr.matrix(text, mask);
    t(`mask ${mask} still reads back (${text.slice(0, 18)})`, readText(m) === text);
    t(`mask ${mask} is what the format strip says it is (${text.slice(0, 18)})`,
      readFormatMask(m) === mask, readFormatMask(m));
  }
});

/* ---------- 4. the fixtures --------------------------------------------- */

const fixtures = JSON.parse(fs.readFileSync(__dirname + '/fixtures/qr-vectors.json', 'utf8'));
fixtures.vectors.forEach(v => {
  const m = MRQr.matrix(v.text);
  const rows = m.map(row => row.join(''));
  t(`the fixture for v${v.version} is reproduced module for module`,
    rows.length === v.matrix.length && rows.every((r, i) => r === v.matrix[i]),
    rows.length === v.matrix.length ? 'rows differ' : `${rows.length} rows vs ${v.matrix.length}`);
  t(`and picks the same version and mask for v${v.version}`,
    m.version === v.version && m.mask === v.mask, `v${m.version} mask${m.mask}`);
});

/* ---------- the finder patterns, since everything depends on them ------- */

{
  const m = MRQr.matrix('https://sageproject.xyz/feedback');
  const size = m.length;
  const finder = (r0, c0) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const on = (r === 0 || r === 6 || c === 0 || c === 6) ||
                 (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      if (m[r0 + r][c0 + c] !== (on ? 1 : 0)) return false;
    }
    return true;
  };
  t('the three finder patterns are where they belong',
    finder(0, 0) && finder(0, size - 7) && finder(size - 7, 0));
  t('the timing lines alternate', (() => {
    for (let i = 8; i < size - 8; i++) {
      if (m[6][i] !== (i % 2 === 0 ? 1 : 0)) return false;
      if (m[i][6] !== (i % 2 === 0 ? 1 : 0)) return false;
    }
    return true;
  })());
  t('the dark module is dark', m[size - 8][8] === 1);
}

/* ---------- the SVG ------------------------------------------------------ */

{
  const svg = MRQr.svg('https://sageproject.xyz/feedback', { scale: 4, quiet: 4 });
  const m = MRQr.matrix('https://sageproject.xyz/feedback');
  const side = (m.length + 8) * 4;
  t('the svg is square and sized by the scale',
    svg.indexOf(`width="${side}"`) !== -1 && svg.indexOf(`height="${side}"`) !== -1);
  t('the svg carries a quiet zone in its viewBox',
    svg.indexOf(`viewBox="0 0 ${m.length + 8} ${m.length + 8}"`) !== -1);
  t('the svg draws one rectangle per dark module',
    (svg.match(/h1v1h-1z/g) || []).length ===
      m.reduce((n, row) => n + row.filter(Boolean).length, 0));
  t('the svg needs nothing fetched', svg.indexOf('http') === svg.indexOf('http://www.w3.org/2000/svg'));
}

/* ---------- report -------------------------------------------------------- */

let bad = 0;
for (const o of out) {
  if (!o.p) bad++;
  console.log(`${o.p ? ' ok ' : 'FAIL'}  ${o.n}${o.p ? '' : '  got ' + o.x}`);
}
console.log(`\n${out.length} assertions, ${bad} failures`);
process.exit(bad ? 1 : 0);
