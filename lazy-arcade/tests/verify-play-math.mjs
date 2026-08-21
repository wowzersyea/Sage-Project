/**
 * Gate for the playable bench (play/index.html).
 *
 * The bench claims to play "the verified odds". That claim is only worth
 * anything if the in-page port actually matches the Rust the RTP was measured
 * on, so this extracts the math half of the page (everything above the DOM
 * boundary marker) and checks it three ways:
 *
 *   1. the in-page HMAC/SHA-256 reproduces tests/golden/rng.json exactly
 *   2. structural pay assertions (max ways, wild rules, cluster minimum)
 *   3. RTP over a few hundred thousand spins lands near 0.97
 *
 * The RTP check is deliberately loose -- at 400k spins the 95% CI is around
 * +/-0.011, so this catches porting errors (a factor of 2, a dropped feature),
 * not fine calibration. Fine calibration is what crates/mathsim is for.
 *
 *   node tests/verify-play-math.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const html = readFileSync(join(root, "play", "index.html"), "utf8");
const scriptBody = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
const mathOnly = scriptBody.slice(0, scriptBody.indexOf("/* @@@DOM_BOUNDARY@@@"));
if (!mathOnly || mathOnly.length < 2000) {
  console.error("could not extract the math section -- is the DOM boundary marker still there?");
  process.exit(2);
}

const exported = [
  "sha256", "hmacSha256", "utf8", "hex", "Rng", "makeRng",
  "spinPride", "spinCluster", "spinVault", "buildStrip",
  "CONF", "PAYS", "LINES", "SYM", "prideEval", "clusterFind",
  "payout", "pRarer", "pCommoner", "MIN_P", "HOUSE",
  "swapFee", "buyFeature", "BUY_PRICE", "ANTE", "anteStrips",
];
const M = new Function(`${mathOnly}\nreturn {${exported.join(",")}};`)();

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    console.log(`  ok   ${name}${detail ? " -- " + detail : ""}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? " -- " + detail : ""}`);
  }
};

/* ---------------------------------------------------------------- 1. RNG */
console.log("\nRNG vs Rust golden vectors");
{
  const golden = JSON.parse(readFileSync(join(root, "tests", "golden", "rng.json"), "utf8"));
  let draws = 0, bad = 0, hashBad = 0;
  for (const c of golden.cases) {
    const seed = Uint8Array.from(Buffer.from(c.serverSeedHex, "hex"));
    if (M.hex(M.sha256(seed)) !== c.serverSeedHash) hashBad++;
    const rng = M.makeRng(seed, c.clientSeed, c.nonce, c.gameId);
    for (let i = 0; i < c.bounds.length; i++) {
      if (rng.below(c.bounds[i]) !== c.values[i]) bad++;
      draws++;
    }
  }
  check("SHA-256 commitments", hashBad === 0, `${golden.cases.length} cases`);
  check("HMAC stream + rejection sampling", bad === 0, `${draws} draws`);
}

/* -------------------------------------------------------- 2. structural */
console.log("\nStructural pay rules");
{
  const WILD = 0, P1 = 2, L4 = 13;
  const full = Array.from({ length: 5 }, () => Array(4).fill(P1));
  const ways = M.prideEval(full, false, M.PAYS.pride, null);
  const expect = 1024 * M.PAYS.pride[P1][5];
  check("Pride full screen pays 1024 ways", Math.abs(ways - expect) < 1e-6,
        `${ways.toFixed(2)} vs ${expect.toFixed(2)}`);

  // Isolate one symbol: the filler (L4) is itself a paying symbol, so a
  // full-table evaluation would score the background rather than the case.
  const onlyP1 = M.PAYS.pride.map((row, i) => (i === P1 ? row.slice() : row.map(() => 0)));
  const two = Array.from({ length: 5 }, () => Array(4).fill(L4));
  two[0][0] = P1; two[1][0] = P1;
  check("Pride two-of-a-kind pays nothing", M.prideEval(two, false, onlyP1, null) === 0);

  const three = Array.from({ length: 5 }, () => Array(4).fill(L4));
  for (let r = 0; r < 3; r++) three[r][0] = P1;
  check("Pride three-of-a-kind pays one way",
        Math.abs(M.prideEval(three, false, onlyP1, null) - M.PAYS.pride[P1][3]) < 1e-9);

  const wildOnOuter = M.CONF.pride.w[0][WILD] === 0 && M.CONF.pride.w[4][WILD] === 0;
  check("Pride wild absent from reels 1 and 5", wildOnOuter);
  check("Trait Vault wild absent from reels 1 and 5",
        M.CONF.traitvault.w[0][WILD] === 0 && M.CONF.traitvault.w[4][WILD] === 0);

  for (const g of ["pride", "cubcluster", "traitvault"]) {
    const lens = M.CONF[g].strips.map((s) => s.length);
    check(`${g} strips >= 120`, lens.every((l) => l >= 120), lens.join("/"));
  }

  const clusterOnlyP1 = M.PAYS.cubcluster.map((row, i) =>
    i === P1 ? row.slice() : row.map(() => 0));
  const grid4 = Array.from({ length: 5 }, () => Array(4).fill(L4));
  for (let r = 0; r < 4; r++) grid4[r][0] = P1;
  check("Cluster of 4 does not pay", M.clusterFind(grid4, clusterOnlyP1).total === 0);

  const grid5 = Array.from({ length: 5 }, () => Array(4).fill(L4));
  for (let r = 0; r < 5; r++) grid5[r][0] = P1;
  check("Cluster of 5 pays", M.clusterFind(grid5, clusterOnlyP1).total > 0);

  const pureWild = Array.from({ length: 5 }, () => Array(4).fill(L4));
  for (let r = 0; r < 5; r++) pureWild[r][0] = WILD;
  check("Pure-wild blob pays nothing", M.clusterFind(pureWild, clusterOnlyP1).total === 0);

  const wildCompletes = Array.from({ length: 5 }, () => Array(4).fill(L4));
  for (let r = 0; r < 4; r++) wildCompletes[r][0] = P1;
  wildCompletes[4][0] = WILD;
  check("Wild completes a 5-cluster", M.clusterFind(wildCompletes, clusterOnlyP1).total > 0);

  check("40 paylines, all distinct",
        M.LINES.length === 40 && new Set(M.LINES.map(String)).size === 40);
}

/* ------------------------------------------------------------- 3. Hi/Lo */
console.log("\nHi/Lo exactness");
{
  const N = 10078;
  let worst = 0, offered = 0, maxMult = 0;
  for (let p = 1; p <= N; p++) {
    for (const dir of ["rarer", "commoner"]) {
      const mult = M.payout(N, p, dir);
      if (mult === null) continue;
      offered++;
      const prob = dir === "rarer" ? M.pRarer(N, p) : M.pCommoner(N, p);
      worst = Math.max(worst, Math.abs(prob * mult - 0.97));
      maxMult = Math.max(maxMult, mult);
    }
    const sum = M.pRarer(N, p) + M.pCommoner(N, p);
    if (Math.abs(sum - 1) > 1e-12) { worst = Infinity; break; }
  }
  check("every offered bet returns exactly 0.97", worst < 1e-9,
        `worst deviation ${worst.toExponential(2)} over ${offered} offers`);
  check("no offered multiplier exceeds 19.4x", maxMult <= 19.4 + 1e-9,
        `max ${maxMult.toFixed(4)}x`);

  // The shipped deck is now 101 rarity ranks (0..100), not 10,078 ordinals.
  // Every property the ordinal design relied on has to survive the change.
  const R = 101;
  let rWorst = 0, rOffered = 0, alwaysOne = true;
  const disabled = [];
  for (let p = 1; p <= R; p++) {
    let any = false;
    for (const dir of ["rarer", "commoner"]) {
      const mult = M.payout(R, p, dir);
      if (mult === null) continue;
      any = true; rOffered++;
      const prob = dir === "rarer" ? M.pRarer(R, p) : M.pCommoner(R, p);
      rWorst = Math.max(rWorst, Math.abs(prob * mult - 0.97));
    }
    if (!any) alwaysOne = false;
    if (M.payout(R, p, "rarer") === null || M.payout(R, p, "commoner") === null) {
      disabled.push(p - 1);
    }
    if (Math.abs(M.pRarer(R, p) + M.pCommoner(R, p) - 1) > 1e-12) rWorst = Infinity;
  }
  check("rank deck: every offered bet returns exactly 0.97", rWorst < 1e-9,
        `worst ${rWorst.toExponential(2)} over ${rOffered} offers`);
  check("rank deck: a playable direction exists at every rank", alwaysOne);
  // Probabilities are r/100 and (100-r)/100, so the 5% floor bites at exactly
  // r < 5 and r > 95. If this ever shifts, the floor logic has drifted.
  check("rank deck: disabled exactly outside ranks 5..95",
        disabled.every(r => r < 5 || r > 95) &&
        disabled.length === 10,
        `disabled at ranks ${disabled.join(",")}`);
}

/* --------------------------------------------------------------- 4. RTP */
console.log("\nRTP convergence (loose -- catches porting errors, not calibration)");
{
  const seed = new Uint8Array(32).map((_, i) => (i * 37 + 11) & 0xff);
  // Caps are read from the page's own CONF rather than restated here. They were
  // restated, and when Trait Vault's ceiling moved to 5000x this test kept
  // asserting 1000x -- failing a correct build, which is the same drift in the
  // opposite direction.
  const runs = [
    ["pride", 400000, M.spinPride],
    ["traitvault", 400000, M.spinVault],
    ["cubcluster", 150000, M.spinCluster],
  ];
  for (const [game, spins, fn] of runs) {
    const cap = M.CONF[game].cap;
    const state = { mane: 0 };
    let sum = 0, sumSq = 0, maxWin = 0;
    for (let n = 0; n < spins; n++) {
      const rng = M.makeRng(seed, "verify", n, game);
      const out = game === "traitvault" ? fn(rng, state) : fn(rng);
      const t = out.base + out.feature;
      sum += t; sumSq += t * t;
      if (t > maxWin) maxWin = t;
    }
    const rtp = sum / spins;
    const vol = Math.sqrt(Math.max(0, sumSq / spins - rtp * rtp));
    const ci = 1.96 * vol / Math.sqrt(spins);
    check(`${game} RTP`, Math.abs(rtp - 0.97) < 3 * ci + 0.005,
          `${rtp.toFixed(4)} +/-${ci.toFixed(4)} (vol ${vol.toFixed(2)})`);
    check(`${game} respects max win cap`, maxWin <= cap + 1e-6,
          `max ${maxWin.toFixed(1)}x vs cap ${cap}x`);
  }
}

/* ------------------------------------------- 5. ante + buy are EV-neutral */
console.log("\nAnte and buy-feature pricing");
{
  const seed = new Uint8Array(32).map((_, i) => (i * 53 + 7) & 0xff);

  // A bought round must return exactly what spinning for it returns. Under-price
  // it and the button is an arbitrage on the bankroll.
  for (const [game, spins] of [["pride", 120000], ["traitvault", 200000]]) {
    let sum = 0, sumSq = 0;
    for (let n = 0; n < spins; n++) {
      const out = M.buyFeature(M.makeRng(seed, "buy", n, game), game);
      const t = out.base + out.feature;
      sum += t; sumSq += t * t;
    }
    const ev = sum / spins;
    const vol = Math.sqrt(Math.max(0, sumSq / spins - ev * ev));
    const ci = 1.96 * vol / Math.sqrt(spins);
    const rtp = ev / M.BUY_PRICE[game];
    check(`${game} buy-feature RTP`, Math.abs(rtp - 0.97) < 3 * ci / M.BUY_PRICE[game] + 0.01,
          `${rtp.toFixed(4)} at price ${M.BUY_PRICE[game]}x (EV ${ev.toFixed(3)}x)`);
  }

  // Ante: extra scatter supply paid for with a solved stake.
  const strips = M.anteStrips();
  let sum = 0, sumSq = 0, trig = 0;
  const spins = 300000;
  for (let n = 0; n < spins; n++) {
    const out = M.spinPride(M.makeRng(seed, "ante", n, "pride"), strips);
    const t = out.base + out.feature;
    sum += t; sumSq += t * t;
    if (out.fs) trig++;
  }
  const ret = sum / spins;
  const vol = Math.sqrt(Math.max(0, sumSq / spins - ret * ret));
  const ci = 1.96 * vol / Math.sqrt(spins);
  const rtp = ret / M.ANTE.pride.stake;
  check("pride ante RTP at solved stake",
        Math.abs(rtp - 0.97) < 3 * ci + 0.01,
        `${rtp.toFixed(4)} at stake ${M.ANTE.pride.stake}x, feature 1 in ${(spins/Math.max(1,trig)).toFixed(0)}`);
}

console.log(
  failures === 0
    ? "\nplay bench math OK -- the page plays the odds that were verified\n"
    : `\n${failures} check(s) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
