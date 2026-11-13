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
  "vaultFreeSpins", "vaultLines", "MULT_V", "MULT_W", "ROW_MULT_CAP",
  "FREE_SPINS", "SCATTERS_TO_TRIGGER", "RARITY_RANKS",
  "CROWN_NUM", "CROWN_DENOM", "drawGridPride",
  // high profile
  "HIGH_IDS", "HIGH_CONF", "HIGH_BUY", "HIGH_ANTE", "playEngine", "highReels",
  "chEval", "chSpins", "phEval", "phSpins", "vhSpins", "CH_SPOT_CAP", "C7",
  "spinPrideHigh", "spinClusterHigh", "spinVaultHigh", "buyHigh",
];
const M = new Function(`${mathOnly}\nreturn {${exported.join(",")}};`)();

/* Per-game COIN RTP targets. Pride is no longer a 0.97 machine: it funds the
   Lion's Crown NFT by taking its coin return down to 0.87, and the prize sits
   outside the coin economy entirely. A single shared 0.97 would have to widen
   to admit 0.87, which is the same as checking neither. Module scope, because
   the RTP block and the ante/buy block both price against it and a copy in each
   is a copy that drifts. */
const TARGET = { pride: 0.87, traitvault: 0.97, cubcluster: 0.97 };

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
  const WILD = 0, SCAT = 1, P1 = 2, L4 = 13;
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
  {
    // The verifier page duplicates strip lengths deliberately -- it must check a
    // spin without loading the game -- so nothing but a test can stop the two
    // drifting. They HAD drifted: Trait Vault sat at its pre-Lion's-Share
    // lengths, which would have made the fairness page derive stops the game
    // never produced and accuse an honest spin of not reproducing.
    const vhtml = readFileSync(join(root, "verify", "index.html"), "utf8");
    const m = vhtml.match(/const STRIPS = \{([\s\S]*?)\};/);
    const published = {};
    if (m) for (const line of m[1].split("\n")) {
      // keys may be quoted -- the high profile's ids carry a hyphen
      const g = line.match(/"?([\w-]+)"?:\s*\[([\d,\s]+)\]/);
      if (g) published[g[1]] = g[2].split(",").map((n) => +n.trim());
    }
    let mismatch = [];
    for (const g of ["pride", "cubcluster", "traitvault", "pride-high", "cubcluster-high", "traitvault-high"]) {
      const live = M.CONF[g].strips.map((s) => s.length);
      if (JSON.stringify(live) !== JSON.stringify(published[g] || []))
        mismatch.push(`${g}: page ${JSON.stringify(live)} vs verifier ${JSON.stringify(published[g])}`);
    }
    // Hi/Lo was left OUT of this loop, and that is precisely where the next
    // drift happened: the verifier went on publishing 10078 -- the pre-rarity
    // deck size -- for a game that draws a rank out of 101. Its "strip" is the
    // rank space, so it is checked against RARITY_RANKS.
    const liveHilo = [M.RARITY_RANKS];
    if (JSON.stringify(liveHilo) !== JSON.stringify(published.hilo || []))
      mismatch.push(`hilo: page ${JSON.stringify(liveHilo)} vs verifier ${JSON.stringify(published.hilo)}`);
    check("verifier page strip lengths match the live strips, Hi/Lo included",
          mismatch.length === 0,
          mismatch.join(" | ") || "all four games agree");

    // The crown constants live in THREE places -- the page, this verifier, and
    // pride.rs -- because each must work without loading the others. Same
    // standing as the strip lengths, same failure mode: tune the jackpot rate
    // in the page, forget the verifier, and /verify accuses every honest Pride
    // spin of not reproducing. ROW_MULT_CAP already drifted 60-vs-25 once
    // while every other check passed, so this is not hypothetical.
    const vc = vhtml.match(/const CROWN_NUM = (\d+), CROWN_DENOM = (\d+)/);
    check("verifier crown constants match the live game",
          !!vc && +vc[1] === M.CROWN_NUM && +vc[2] === M.CROWN_DENOM,
          vc ? `page ${M.CROWN_NUM}/${M.CROWN_DENOM} vs verifier ${vc[1]}/${vc[2]}`
             : "verifier carries no crown constants");
  }

  check("Trait Vault carries scatters on every reel",
        M.CONF.traitvault.w.every((r) => r[SCAT] > 0),
        M.CONF.traitvault.w.map((r) => r[SCAT]).join("/"));

  /* --- Lion's Share row multipliers ---
     These constants are the ones crates/mathsim was calibrated against. Pinning
     them here is what makes the port checkable: the RTP convergence test below
     is far too loose to notice a changed ceiling, and the JS copy of
     ROW_MULT_CAP did in fact sit at 60 against the Rust's 25 while every other
     check passed. If mathsim changes, change these deliberately. */
  check("row multiplier constants match the calibrated maths",
        M.ROW_MULT_CAP === 25 && M.FREE_SPINS === 10 && M.SCATTERS_TO_TRIGGER === 3 &&
        M.MULT_V.join(",") === "2,3,4,6,10,20" &&
        M.MULT_W.join(",") === "400,290,180,90,32,8",
        `cap ${M.ROW_MULT_CAP}, ${M.FREE_SPINS} spins, orbs ${M.MULT_V.join("/")}`);

  {
    // A uniform board multiplier must scale the board by EXACTLY that much.
    // This is the property that makes the badge beside a row honest, and it is
    // what ruled out summing multipliers across the rows a line touches:
    // summing paid 7.4x on a uniform 3x board because only 4 of 40 lines are flat.
    const full = Array.from({ length: 5 }, () => new Array(4).fill(P1));
    const onlyP1 = M.PAYS.traitvault.map((row, i) =>
      i === P1 ? row : row.map(() => 0));
    const plain = M.vaultLines(full, onlyP1, [0, 0, 0, 0], null);
    const tripled = M.vaultLines(full, onlyP1, [3, 3, 3, 3], null);
    check("a uniform row multiplier scales the board by exactly that much",
          plain > 0 && Math.abs(tripled - plain * 3) < 1e-9,
          `${tripled.toFixed(4)} vs ${(plain * 3).toFixed(4)}`);

    // and a line takes the HIGHEST row it crosses, never the sum
    const two = M.vaultLines(full, onlyP1, [2, 3, 0, 0], null);
    const hi = M.vaultLines(full, onlyP1, [0, 3, 0, 0], null);
    const lo = M.vaultLines(full, onlyP1, [2, 0, 0, 0], null);
    check("row multipliers take the max across a line, not the sum",
          two <= hi + lo - plain + 1e-9 && two > lo,
          `both ${two.toFixed(3)}, hi ${hi.toFixed(3)}, lo ${lo.toFixed(3)}`);
  }

  {
    // No row may ever exceed the ceiling, over enough rounds to see one build.
    const seed = new Uint8Array(32).map((_, i) => (i * 31 + 7) & 0xff);
    let worst = 0, orbs = 0, rounds = 600;
    for (let n = 0; n < rounds; n++) {
      const res = M.vaultFreeSpins(M.makeRng(seed, "c", n, "traitvault"));
      for (const f of res.frames) {
        orbs += f.orbs ? f.orbs.length : 0;
        worst = Math.max(worst, ...f.rowMult);
      }
    }
    check("no row exceeds the multiplier ceiling", worst <= M.ROW_MULT_CAP,
          `worst row ×${worst} vs ceiling ×${M.ROW_MULT_CAP}`);
    check("orbs actually land during the feature", orbs > rounds,
          `${(orbs / rounds).toFixed(2)} orbs per round`);
  }

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
  let rWorst = 0, rOffered = 0;
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
    if (M.payout(R, p, "rarer") === null || M.payout(R, p, "commoner") === null) {
      disabled.push(p - 1);
    }
    if (Math.abs(M.pRarer(R, p) + M.pCommoner(R, p) - 1) > 1e-12) rWorst = Infinity;
  }
  check("rank deck: every offered bet returns exactly 0.97", rWorst < 1e-9,
        `worst ${rWorst.toExponential(2)} over ${rOffered} offers`);

  // "A playable direction exists at every rank" was TRUE only because of the
  // sucker bet: rank 2 offered "rarer" at 0.99x, a wager that loses money when
  // it WINS. Refusing payouts <= 1.00x deliberately kills that property, so
  // its replacement is the pair below: nothing offered can fail to profit, and
  // every rank with no offer has a FREE way out.
  let low = 0, deadFreeless = 0; const dead = [];
  for (let p = 1; p <= R; p++) {
    let any = false;
    for (const dir of ["rarer", "commoner"]) {
      const mult = M.payout(R, p, dir);
      if (mult !== null) { any = true; if (mult <= 1.0) low++; }
    }
    if (!any) {
      dead.push(p - 1);
      if (M.swapFee(R, p) > 1e-9) deadFreeless++;
    }
  }
  check("rank deck: no offered bet pays 1.00x or less", low === 0,
        `${low} sucker bet(s) on the board`);
  // The refusal map, exactly: the 5% floor bites at r<5 and r>95, the
  // no-upside rule at r<=3 and r>=97, so the fully dead ranks are 0-3 and
  // 97-100. If this shifts, one of the two refusal rules has drifted.
  check("rank deck: dead exactly at ranks 0-3 and 97-100",
        dead.length === 8 && dead.every(r => r <= 3 || r >= 97),
        `dead at ranks ${dead.join(",")}`);
  check("rank deck: every dead rank swaps out FREE", deadFreeless === 0,
        `${deadFreeless} dead rank(s) with a paid swap`);
  check("rank deck: swap is free at every rank",
        Array.from({length:R},(_,i)=>M.swapFee(R,i+1)).every(f=>Math.abs(f)<1e-9));
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
    check(`${game} coin RTP`, Math.abs(rtp - TARGET[game]) < 3 * ci + 0.005,
          `${rtp.toFixed(4)} vs target ${TARGET[game]} +/-${ci.toFixed(4)} (vol ${vol.toFixed(2)})`);
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
    check(`${game} buy-feature RTP`, Math.abs(rtp - TARGET[game]) < 3 * ci / M.BUY_PRICE[game] + 0.01,
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
        Math.abs(rtp - TARGET.pride) < 3 * ci + 0.01,
        `${rtp.toFixed(4)} at stake ${M.ANTE.pride.stake}x, feature 1 in ${(spins/Math.max(1,trig)).toFixed(0)}`);
}

/* -------------------------------------------------------- 6. high profile */
/* The high profile is checked EXACTLY, not loosely: tests/golden/high.json
   holds base and feature for 300 rounds per engine per mode, played by
   crates/mathsim on the production HMAC stream, and the page must reproduce
   every one. A reordered draw, a dropped retrigger or a misread spot rule
   changes a round's total; a loose RTP check at a few hundred thousand spins
   cannot see a slip that moves RTP by less than a percent. */
console.log("\nHigh profile");
{
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync(process.execPath, [join(root, "tools", "high-conf.mjs"), "--check"], { stdio: "pipe" });
    check("the page's HIGH_CONF is generated from the calibrated weights", true);
  } catch (e) {
    check("the page's HIGH_CONF is generated from the calibrated weights", false,
          String(e.stderr || e.message).trim());
  }

  const golden = JSON.parse(readFileSync(join(root, "tests", "golden", "high.json"), "utf8"));
  const gseed = Uint8Array.from(Buffer.from(golden.serverSeedHex, "hex"));
  for (const id of M.HIGH_IDS) {
    const rows = golden.engines[id] || [];
    let bad = 0, first = "";
    for (const [mode, nonce, base, feature] of rows) {
      const o = M.playEngine(id, M.makeRng(gseed, golden.client, nonce, id), mode);
      if (Math.abs(o.base - base) > 1e-9 * Math.max(1, base) ||
          Math.abs(o.feature - feature) > 1e-9 * Math.max(1, feature)) {
        bad++;
        if (!first) first = `${mode} #${nonce}: page ${o.base}/${o.feature} vs rust ${base}/${feature}`;
      }
    }
    const modes = new Set(rows.map((r) => r[0]));
    check(`${id} reproduces mathsim exactly, round by round`, rows.length >= 600 && bad === 0 && modes.size === 3,
          bad ? `${bad} of ${rows.length} differ; ${first}` : `${rows.length} rounds across ${[...modes].join("/")}`);
  }

  // structural rules
  const SC = 1, P1 = 2, L1 = 10, L2 = 11, WILD = 0;
  const pays = Array.from({ length: 14 }, () => new Array(16).fill(0));
  for (let n = 5; n <= 15; n++) pays[P1][n] = 1;
  const checker = () => Array.from({ length: 7 }, (_, c) => Array.from({ length: 7 }, (_, r) => (c + r) % 2 ? L2 : L1));
  const zero = () => Array.from({ length: 7 }, () => new Array(7).fill(0));
  {
    const g = checker(); for (let c = 0; c < 4; c++) g[c][0] = P1;
    const four = M.chEval(g, zero(), pays, new Set(), null);
    g[4][0] = P1;
    const five = M.chEval(g, zero(), pays, new Set(), null);
    check("cluster high: four cells do not pay, five do", four === 0 && five === 1, `${four} / ${five}`);
    const sp = zero(); sp[0][0] = 4; sp[3][0] = 8; sp[4][0] = 1;
    check("cluster high: spot multipliers under one cluster ADD (x4 + x8 = x12; a mark is not a multiplier)",
          M.chEval(g, sp, pays, new Set(), null) === 12);
    const s = checker(); for (let c = 0; c < 6; c++) s[c][3] = SC;
    check("cluster high: scatters never cluster", M.chEval(s, zero(), pays, new Set(), null) === 0);
    check("cluster high: 3/4/5/6/7+ scatters award 10/12/15/20/30",
          [2, 3, 4, 5, 6, 7, 9].map(M.chSpins).join(",") === "0,10,12,15,20,30,30");
    check("cluster high: no wild anywhere on its reels",
          M.HIGH_CONF["cubcluster-high"].w.every((r) => r[WILD] === 0) && M.HIGH_CONF["cubcluster-high"].w.length === 7);
  }
  {
    const ppays = Array.from({ length: 14 }, () => [0, 0, 0, 0, 0, 0]);
    ppays[7][3] = 1;                      // M2, 3 of a kind
    const g = Array.from({ length: 5 }, () => new Array(4).fill(13));
    g[0][0] = 7; g[1][0] = WILD; g[2][0] = WILD;
    const m = g.map(() => new Array(4).fill(0)); m[1][0] = 3; m[2][0] = 5;
    check("pride high: wild multipliers on a way add (x3 + x5 = x8)", Math.abs(M.phEval(g, m, ppays, null) - 8) < 1e-12);
    m[1][0] = 25;
    check("pride high: and cap at x25", Math.abs(M.phEval(g, m, ppays, null) - 25) < 1e-12);
    check("pride high and vault high: 3/4/5 scatters award 10/12/15",
          [2, 3, 4, 5, 6].map(M.phSpins).join(",") === "0,10,12,15,15" &&
          [2, 3, 4, 5, 6].map(M.vhSpins).join(",") === "0,10,12,15,15");
  }

  // the cap is enforced inside the round, and every engine's strips are legal
  const seed = new Uint8Array(32).map((_, i) => (i * 41 + 3) & 0xff);
  for (const id of M.HIGH_IDS) {
    const cap = M.HIGH_CONF[id].cap;
    let worst = 0, capped = 0;
    for (let n = 0; n < 4000; n++) {
      const o = M.playEngine(id, M.makeRng(seed, "cap", n, id), "buy");
      const t = o.base + o.feature; worst = Math.max(worst, t);
      if (o.frames.some((f) => f.capped)) capped++;
    }
    check(`${id} never pays past its ${cap}x cap`, worst <= cap + 1e-9, `worst bought round ${worst.toFixed(1)}x`);
    const lens = M.CONF[id].strips.map((s) => s.length).concat(M.CONF[id].fsStrips.map((s) => s.length));
    check(`${id} strips >= 120, base and round reels alike`, lens.every((l) => l >= 120), lens.join("/"));
  }

  // loose convergence: catches a factor-of-two port error, not calibration
  const rseed = new Uint8Array(32).map((_, i) => (i * 37 + 11) & 0xff);
  for (const [id, spins, target] of [["pride-high", 250000, 0.87], ["traitvault-high", 250000, 0.97], ["cubcluster-high", 60000, 0.97]]) {
    let sum = 0, sumSq = 0;
    for (let n = 0; n < spins; n++) {
      const o = M.playEngine(id, M.makeRng(rseed, "verify", n, id), "spin");
      const t = o.base + o.feature; sum += t; sumSq += t * t;
    }
    const rtp = sum / spins, vol = Math.sqrt(Math.max(0, sumSq / spins - rtp * rtp)), ci = 1.96 * vol / Math.sqrt(spins);
    check(`${id} coin RTP converges on its target`, Math.abs(rtp - target) < 3 * ci + 0.01,
          `${rtp.toFixed(4)} vs ${target} +/-${ci.toFixed(4)} (vol ${vol.toFixed(1)})`);
  }
  // buy and ante prices are EV-neutral against the page's own figures
  for (const id of M.HIGH_IDS) {
    const target = id === "pride-high" ? 0.87 : 0.97, n = id === "cubcluster-high" ? 6000 : 20000;
    let sum = 0, sumSq = 0;
    for (let i = 0; i < n; i++) {
      const o = M.playEngine(id, M.makeRng(rseed, "buy", i, id), "buy");
      const t = o.base + o.feature; sum += t; sumSq += t * t;
    }
    const ev = sum / n, vol = Math.sqrt(Math.max(0, sumSq / n - ev * ev)), ci = 1.96 * vol / Math.sqrt(n);
    const rtp = ev / M.HIGH_BUY[id];
    check(`${id} buy price returns its target`, Math.abs(rtp - target) < 3 * ci / M.HIGH_BUY[id] + 0.02,
          `${rtp.toFixed(4)} at ${M.HIGH_BUY[id]}x (EV ${ev.toFixed(2)}x +/- ${ci.toFixed(2)})`);
  }
}

console.log(
  failures === 0
    ? "\nplay bench math OK -- the page plays the odds that were verified\n"
    : `\n${failures} check(s) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
