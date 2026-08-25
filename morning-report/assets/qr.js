/* ==================================================================
   MRQr — a QR code, written out rather than fetched.

   Why this exists at all: the module has no build step and no
   dependencies, deliberately, because these files get opened by
   people who are not developers and every dependency is a thing that
   breaks at 07:00. A QR library would be the first exception, and it
   would be a script tag pointing at somebody else's CDN on a page
   that is otherwise entirely self-contained. So the encoder is here,
   in about the space the CDN link would have taken.

   What it does, and only this:

     byte mode, error correction level M, versions 1 to 10.

   That covers a URL of up to 213 characters, which is more than the
   longest link this module produces. Anything longer throws rather
   than silently producing a code that will not scan, because a QR
   that fails on a projector at 07:05 is worse than one that was
   never offered.

   Level M corrects about 15% of the code. That is the level to want
   for something photographed off a slide at the back of a room: L
   scans worse on a projector, and Q and H spend modules on
   redundancy that make the code denser and no easier to read.

   The mask is chosen the way the standard says to choose it — all
   eight are drawn, each is scored on the four penalty rules, and the
   lowest score wins. It matters: an unmasked or badly masked code
   has runs and blocks that confuse a phone's decoder.

   The whole thing is checked against a reference implementation,
   module for module, in tests/qr.test.js. It is not eyeballed.
   ================================================================== */

(function (global) {
  "use strict";

  /* ---------- the tables ---------------------------------------------

     Per version at level M: error-correction codewords per block, and
     the block structure. Two groups because most versions split the
     data into blocks of two different sizes. */

  var VERSIONS = {
    1:  { ec: 10, groups: [[1, 16]] },
    2:  { ec: 16, groups: [[1, 28]] },
    3:  { ec: 26, groups: [[1, 44]] },
    4:  { ec: 18, groups: [[2, 32]] },
    5:  { ec: 24, groups: [[2, 43]] },
    6:  { ec: 16, groups: [[4, 27]] },
    7:  { ec: 18, groups: [[4, 31]] },
    8:  { ec: 22, groups: [[2, 38], [2, 39]] },
    9:  { ec: 22, groups: [[3, 36], [2, 37]] },
    10: { ec: 26, groups: [[4, 43], [1, 44]] }
  };

  /* Row and column centres of the alignment patterns. */
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  var MAX_VERSION = 10;

  function dataCodewords(version) {
    return VERSIONS[version].groups.reduce(function (n, g) { return n + g[0] * g[1]; }, 0);
  }

  function countBits(version) { return version < 10 ? 8 : 16; }

  function fits(version, byteLength) {
    var need = 4 + countBits(version) + 8 * byteLength;
    return need <= dataCodewords(version) * 8;
  }

  function versionFor(byteLength) {
    for (var v = 1; v <= MAX_VERSION; v++) {
      if (fits(v, byteLength)) return v;
    }
    throw new Error("That is too long for a QR code this module will draw (" +
      byteLength + " bytes; the limit is " + capacity(MAX_VERSION) + ").");
  }

  function capacity(version) {
    return Math.floor((dataCodewords(version) * 8 - 4 - countBits(version)) / 8);
  }

  /* ---------- GF(256), for Reed-Solomon ------------------------------ */

  var EXP = new Array(512);
  var LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;          /* the QR primitive polynomial */
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function mul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /* The generator polynomial for n EC codewords: (x - a^0)(x - a^1)... */
  function generator(n) {
    var poly = [1];
    for (var i = 0; i < n; i++) {
      var next = poly.concat([0]);
      for (var j = 0; j < poly.length; j++) {
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function remainder(data, ecLength) {
    var gen = generator(ecLength);
    var buf = data.concat(new Array(ecLength).fill(0));
    for (var i = 0; i < data.length; i++) {
      var factor = buf[i];
      if (factor === 0) continue;
      for (var j = 0; j < gen.length; j++) {
        buf[i + j] ^= mul(gen[j], factor);
      }
    }
    return buf.slice(data.length);
  }

  /* ---------- the bit stream ------------------------------------------ */

  function utf8(text) {
    var out = [];
    var s = unescape(encodeURIComponent(String(text)));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
    return out;
  }

  function codewords(bytes, version) {
    var bits = [];
    function push(value, length) {
      for (var i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
    }

    push(0x4, 4);                                  /* byte mode */
    push(bytes.length, countBits(version));
    bytes.forEach(function (b) { push(b, 8); });

    var total = dataCodewords(version) * 8;
    var terminator = Math.min(4, total - bits.length);
    push(0, terminator);
    while (bits.length % 8) bits.push(0);

    var words = [];
    for (var i = 0; i < bits.length; i += 8) {
      var byte = 0;
      for (var j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      words.push(byte);
    }
    /* The standard's pad bytes, alternating, until the block is full. */
    var pads = [0xEC, 0x11];
    var k = 0;
    while (words.length < dataCodewords(version)) words.push(pads[k++ % 2]);
    return words;
  }

  /* Split into blocks, add EC to each, then interleave — data
     codeword 0 of every block, then codeword 1 of every block, and
     the same again for the EC halves. */
  function interleave(words, version) {
    var spec = VERSIONS[version];
    var blocks = [];
    var at = 0;
    spec.groups.forEach(function (g) {
      for (var b = 0; b < g[0]; b++) {
        var data = words.slice(at, at + g[1]);
        at += g[1];
        blocks.push({ data: data, ec: remainder(data, spec.ec) });
      }
    });

    var out = [];
    var longest = blocks.reduce(function (n, b) { return Math.max(n, b.data.length); }, 0);
    for (var i = 0; i < longest; i++) {
      blocks.forEach(function (b) { if (i < b.data.length) out.push(b.data[i]); });
    }
    for (var j = 0; j < spec.ec; j++) {
      blocks.forEach(function (b) { out.push(b.ec[j]); });
    }
    return out;
  }

  /* ---------- BCH, for the format and version strips ------------------ */

  function bitLength(v) {
    var n = 0;
    while (v) { n++; v >>>= 1; }
    return n;
  }

  /* Polynomial division over GF(2): line the generator's top bit up
     with the value's top bit and XOR, until what is left is shorter
     than the generator. Lining it up one place too far is the classic
     way to get this wrong, and it is nearly invisible: the remainder
     for a zero value is zero either way, so mask 0 comes out correct
     and every other mask comes out unreadable.

     `bits` is the width of the generator: 11 for the format strip's
     0x537, 13 for the version strip's 0x1F25. */
  function bch(value, generatorPoly, bits) {
    var v = value << (bits - 1);
    while (bitLength(v) >= bits) {
      v ^= generatorPoly << (bitLength(v) - bits);
    }
    return v;
  }

  /* Level M is 00. Fifteen bits, then the standard's fixed mask. */
  function formatBits(mask) {
    var value = (0x0 << 3) | mask;
    return ((value << 10) | bch(value, 0x537, 11)) ^ 0x5412;
  }

  function versionBits(version) {
    return (version << 12) | bch(version, 0x1F25, 13);
  }

  /* ---------- laying out the modules ---------------------------------- */

  function blank(size) {
    var m = [];
    for (var r = 0; r < size; r++) {
      m.push(new Array(size).fill(null));    /* null = not yet placed */
    }
    return m;
  }

  function placeFinder(m, row, col) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
        var on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                 (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                 (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        m[rr][cc] = on ? 1 : 0;
      }
    }
  }

  function placeAlignment(m, version) {
    var centres = ALIGN[version];
    var last = m.length - 1;
    centres.forEach(function (r) {
      centres.forEach(function (c) {
        /* Not over the three finders. */
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= last - 8) || (r >= last - 8 && c <= 8)) return;
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var edge = Math.max(Math.abs(dr), Math.abs(dc));
            m[r + dr][c + dc] = (edge === 1) ? 0 : 1;
          }
        }
      });
    });
  }

  function placeTiming(m) {
    for (var i = 8; i < m.length - 8; i++) {
      var on = i % 2 === 0 ? 1 : 0;
      if (m[6][i] === null) m[6][i] = on;
      if (m[i][6] === null) m[i][6] = on;
    }
  }

  /* Where the format strip lives, so data placement can avoid it. */
  function reserveFormat(m) {
    var last = m.length - 1;
    for (var i = 0; i <= 8; i++) {
      if (m[8][i] === null) m[8][i] = 0;
      if (m[i][8] === null) m[i][8] = 0;
    }
    for (var j = 0; j < 8; j++) {
      if (m[8][last - j] === null) m[8][last - j] = 0;
      if (m[last - j][8] === null) m[last - j][8] = 0;
    }
    m[last - 7][8] = 1;                       /* the dark module */
  }

  function reserveVersion(m, version) {
    if (version < 7) return;
    var last = m.length - 1;
    for (var i = 0; i < 18; i++) {
      var r = Math.floor(i / 3);
      var c = i % 3;
      if (m[r][last - 10 + c] === null) m[r][last - 10 + c] = 0;
      if (m[last - 10 + c][r] === null) m[last - 10 + c][r] = 0;
    }
  }

  /* The zigzag: two columns at a time, right to left, alternating
     upward and downward, skipping the vertical timing column. */
  function placeData(m, words) {
    var size = m.length;
    var bits = [];
    words.forEach(function (w) {
      for (var i = 7; i >= 0; i--) bits.push((w >> i) & 1);
    });

    var at = 0;
    var upward = true;
    for (var right = size - 1; right > 0; right -= 2) {
      if (right === 6) right--;                 /* the timing column */
      for (var step = 0; step < size; step++) {
        var row = upward ? size - 1 - step : step;
        for (var c = 0; c < 2; c++) {
          var col = right - c;
          if (m[row][col] !== null) continue;
          m[row][col] = at < bits.length ? bits[at++] : 0;
        }
      }
      upward = !upward;
    }
  }

  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
    function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
    function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
  ];

  /* The four penalty rules, scored on the finished code. */
  function penalty(m) {
    var size = m.length;
    var score = 0;
    var r, c, run, i;

    /* 1: runs of five or more of the same colour, in both directions. */
    function runs(get) {
      var total = 0;
      for (var a = 0; a < size; a++) {
        var last = -1, length = 0;
        for (var b = 0; b < size; b++) {
          var v = get(a, b);
          if (v === last) { length++; }
          else { if (length >= 5) total += length - 2; last = v; length = 1; }
        }
        if (length >= 5) total += length - 2;
      }
      return total;
    }
    score += runs(function (a, b) { return m[a][b]; });
    score += runs(function (a, b) { return m[b][a]; });

    /* 2: every 2x2 block of one colour. */
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }

    /* 3: the finder-like pattern, either way round, in both directions. */
    var A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function looksLikeFinder(line) {
      var hits = 0;
      for (var s = 0; s + 11 <= line.length; s++) {
        var okA = true, okB = true;
        for (var k = 0; k < 11; k++) {
          if (line[s + k] !== A[k]) okA = false;
          if (line[s + k] !== B[k]) okB = false;
        }
        if (okA) hits++;
        if (okB) hits++;
      }
      return hits;
    }
    for (i = 0; i < size; i++) {
      var row = [], col = [];
      for (var k2 = 0; k2 < size; k2++) { row.push(m[i][k2]); col.push(m[k2][i]); }
      score += 40 * looksLikeFinder(row);
      score += 40 * looksLikeFinder(col);
    }

    /* 4: how far the proportion of dark modules is from half. */
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) dark++;
    var percent = (dark * 100) / (size * size);
    score += 10 * Math.floor(Math.abs(percent - 50) / 5);

    return score;
  }

  function isFunction(version, row, col, size) {
    /* Reconstructed the same way the placement did it: anything the
       reserved passes wrote is a function module. */
    if (row === 6 || col === 6) return true;
    if (row <= 8 && col <= 8) return true;
    if (row <= 8 && col >= size - 8) return true;
    if (row >= size - 8 && col <= 8) return true;
    if (version >= 7) {
      if (row < 6 && col >= size - 11) return true;
      if (col < 6 && row >= size - 11) return true;
    }
    var centres = ALIGN[version];
    for (var i = 0; i < centres.length; i++) {
      for (var j = 0; j < centres.length; j++) {
        var r = centres[i], c = centres[j];
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
        if (Math.abs(row - r) <= 2 && Math.abs(col - c) <= 2) return true;
      }
    }
    return false;
  }

  function applyMask(base, mask, version) {
    var size = base.length;
    var m = base.map(function (row) { return row.slice(); });
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (isFunction(version, r, c, size)) continue;
        if (MASKS[mask](r, c)) m[r][c] ^= 1;
      }
    }
    return m;
  }

  function writeFormat(m, mask) {
    var bits = formatBits(mask);
    var size = m.length;
    for (var i = 0; i < 15; i++) {
      /* Most significant bit first. The fifteen positions below are
         in the order the standard lists them, and that order runs
         from bit 14 down — indexing the value from bit 0 instead
         writes the strip backwards, which costs nothing visually and
         makes the code unreadable to every decoder. */
      var bit = (bits >> (14 - i)) & 1;
      /* the copy around the top-left finder */
      if (i < 6) m[8][i] = bit;
      else if (i === 6) m[8][7] = bit;
      else if (i === 7) m[8][8] = bit;
      else if (i === 8) m[7][8] = bit;
      else m[14 - i][8] = bit;
      /* and the split copy, for redundancy: seven modules climbing
         the left edge from the bottom, then eight running right along
         row 8. Seven and eight, not eight and seven — the module just
         above that vertical run is the dark one, and writing a format
         bit into it costs you the bit and the dark module both. */
      if (i < 7) m[size - 1 - i][8] = bit;
      else m[8][size - 15 + i] = bit;
    }
    m[size - 8][8] = 1;                       /* the dark module */
  }

  function writeVersion(m, version) {
    if (version < 7) return;
    var bits = versionBits(version);
    var size = m.length;
    for (var i = 0; i < 18; i++) {
      var bit = (bits >> i) & 1;
      var r = Math.floor(i / 3);
      var c = i % 3;
      m[r][size - 11 + c] = bit;
      m[size - 11 + c][r] = bit;
    }
  }

  /* ---------- the whole thing ----------------------------------------- */

  /* `force` is for the test only: drawing all eight masks and asking a
     decoder which ones it can read is how a masking bug is found. */
  function matrix(text, force) {
    var bytes = utf8(text);
    var version = versionFor(bytes.length);
    var size = version * 4 + 17;

    var m = blank(size);
    placeFinder(m, 0, 0);
    placeFinder(m, 0, size - 7);
    placeFinder(m, size - 7, 0);
    placeAlignment(m, version);
    placeTiming(m);
    reserveVersion(m, version);
    reserveFormat(m);

    /* Everything reserved above is now non-null, so data placement
       walks around it. */
    placeData(m, interleave(codewords(bytes, version), version));

    var best = null;
    for (var mask = (force === undefined ? 0 : force);
         mask < (force === undefined ? 8 : force + 1); mask++) {
      var candidate = applyMask(m, mask, version);
      writeFormat(candidate, mask);
      writeVersion(candidate, version);
      var score = penalty(candidate);
      if (!best || score < best.score) best = { score: score, mask: mask, m: candidate };
    }
    best.m.version = version;
    best.m.mask = best.mask;
    return best.m;
  }

  /* A square SVG, quiet zone included. The standard asks for four
     modules of margin and a projector is not the place to economise. */
  function svg(text, opts) {
    opts = opts || {};
    var m = matrix(text);
    var quiet = opts.quiet === undefined ? 4 : opts.quiet;
    var size = m.length + quiet * 2;
    var scale = opts.scale || 8;
    var dark = opts.dark || "#16283C";
    var light = opts.light || "#FFFFFF";

    var path = [];
    for (var r = 0; r < m.length; r++) {
      for (var c = 0; c < m.length; c++) {
        if (m[r][c]) path.push("M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z");
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size * scale +
      '" height="' + size * scale + '" viewBox="0 0 ' + size + " " + size +
      '" shape-rendering="crispEdges" role="img" aria-label="QR code">' +
      '<rect width="' + size + '" height="' + size + '" fill="' + light + '"/>' +
      '<path fill="' + dark + '" d="' + path.join("") + '"/></svg>';
  }

  /* Exposed for the test, which checks the stages separately when the
     finished code disagrees with the reference — knowing whether the
     codewords or the placement is wrong is the difference between a
     five-minute fix and an afternoon. */
  var internals = {
    versionFor: versionFor,
    codewords: codewords,
    interleave: interleave,
    utf8: utf8,
    formatBits: formatBits,
    versionBits: versionBits,
    isFunction: isFunction,
    MASKS: MASKS
  };

  global.MRQr = {
    internals: internals,
    matrix: matrix,
    svg: svg,
    capacity: function () { return capacity(MAX_VERSION); },
    MAX_VERSION: MAX_VERSION
  };
})(typeof window !== "undefined" ? window : globalThis);
