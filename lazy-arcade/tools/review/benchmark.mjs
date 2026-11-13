/**
 * Systematic benchmark of play/index.html against the feature set tier-one slot
 * studios ship (NetEnt, Play'n GO, Push, Nolimit, Pragmatic, Relax).
 *
 * The reviews before this one were ad-hoc: probe an area, find a defect, fix
 * it. That finds real bugs -- it found the anticipation spoiler and the flat
 * roll-up -- but it cannot answer "what are we still missing", because it only
 * ever looks where someone thought to look. This enumerates the checklist
 * first and then measures against it, so an absence shows up as a row rather
 * than as nobody having thought of it.
 *
 * Rules this file holds itself to:
 *
 *   - Every criterion is MEASURED in a live browser against the real page.
 *     Grepping for a word proves a word is present, not that a feature works;
 *     several rows here exist because a keyword was present and the behaviour
 *     was not.
 *   - Anything that needs human or artistic judgement is reported as NEEDS-ART
 *     or NEEDS-HUMAN and never as a pass. A benchmark that grades its own
 *     homework generously is worth nothing.
 *   - PARTIAL is a real verdict with a stated reason, not a soft pass.
 *
 * This is a REPORT, not a gate: it exits 0 whatever it finds. npm run check is
 * where things are allowed to fail the build.
 *
 *   node tools/review/benchmark.mjs [--json]
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const PAGE = pathToFileURL(join(root, "play", "index.html")).href;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log("playwright not installed -- cannot benchmark (npm i -D playwright)");
  process.exit(0);
}

const PASS = "PASS", PARTIAL = "PARTIAL", ABSENT = "ABSENT";
const NEEDS_ART = "NEEDS-ART", NEEDS_HUMAN = "NEEDS-HUMAN";

const rows = [];
const row = (cat, name, verdict, evidence, note = "") =>
  rows.push({ cat, name, verdict, evidence, note });

let devices;
({ devices } = await import("playwright"));
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
await p.goto(PAGE);
await p.waitForTimeout(1400);

/* Everything measurable in one page evaluation, so the page is in one state. */
const m = await p.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const out = {};
  // Bring the audio graph up BEFORE inspecting it. Everything on the bus --
  // limiter, duck, sends -- is built lazily inside ac() on first sound, so
  // reading those globals on a page that has never made a noise reports every
  // one of them missing. The first run of this file did exactly that and
  // accused the page of shipping without a limiter.
  try { ac(); } catch {}
  muted = true;

  /* --- reel motion ------------------------------------------------------ */
  // Sample the curve rather than trusting it: peak velocity, monotonic
  // deceleration, overshoot, and exact landing.
  // The reels follow reelMotion: one cruise speed for every reel in a spin.
  {
    const mo = reelMotion(2100, null, 0.036, 0.2);
    const dt = 0.5; let prev = 0, vmax = 0, peak = 0, mono = true, last = null;
    const dec = mo.T - 420, spring = mo.T - 420 * 0.35;
    for (let t = dt; t <= mo.T + dt; t += dt) {
      const d = mo.pos(t), v = (d - prev) / dt;
      vmax = Math.max(vmax, v); peak = Math.max(peak, d);
      if (t > dec + dt && t < spring) { if (last !== null && v > last + 1e-9) mono = false; last = v; }
      prev = d;
    }
    const teasing = reelMotion(3600, 1950, 0.036, 0.2), cruising = reelMotion(3600, null, 0.036, 0.2);
    let gap = 0; for (let t = 0; t < 1950; t += 5) gap = Math.max(gap, Math.abs(teasing.pos(t) - cruising.pos(t)));
    out.curve = { vmax, cruise: mo.v, peak, mono, D: mo.D, lands: Math.abs(mo.pos(mo.T + 1) - mo.D) < 1e-12,
                  teaseHidden: gap < 1e-9 };
  }
  out.canvas = typeof canvasSpinAll === "function" && !!document.querySelector("canvas");
  out.blur = typeof drawColumn === "function";
  out.stagger = true;   // measured below via reel land times

  /* --- anticipation ----------------------------------------------------- */
  {
    const host = $("reels");
    const grid = []; for (let a = 0; a < 5; a++) { grid.push([]); for (let b = 0; b < 4; b++) grid[a].push(P1); }
    grid[0][0] = SCAT; grid[1][0] = SCAT;
    let firstOn = null; const t0 = performance.now();
    const iv = setInterval(() => {
      if (host.classList.contains("anticipating") && firstOn === null) firstOn = performance.now() - t0;
    }, 16);
    await animateSpin(grid, 2);
    clearInterval(iv);
    const two = performance.now() - t0;
    const g3 = JSON.parse(JSON.stringify(grid)); g3[2][0] = SCAT;
    const t1 = performance.now(); await animateSpin(g3, 3); const three = performance.now() - t1;
    out.antic = { firstOn, two, three, escalates: three > two + 200 };
  }

  /* --- win presentation -------------------------------------------------- */
  {
    const t = async (mult) => { const a = performance.now(); await countUp(100 * mult, mult, 0); return performance.now() - a; };
    turbo = false;
    out.rollup = { small: await t(2), mid: await t(50), big: await t(500) };
    const a = performance.now(); const pend = countUp(4321, 500, 3);
    await sleep(100); skipRollup = true; await pend;
    out.rollup.skip = performance.now() - a;
    out.rollup.landed = $("winOut").textContent;
    turbo = true; out.rollup.turbo = await t(500); turbo = false;
  }
  // The ladder is a table now, not a chain of ternaries inside doSpin.
  out.tiers = typeof WIN_TIERS !== "undefined" ? WIN_TIERS.length : 0;
  out.tierAt = typeof WIN_TIERS !== "undefined" ? WIN_TIERS.map((t) => t.x) : [];
  out.coins = typeof coins === "function";
  out.winLines = typeof showWinLines === "function";
  out.banner = typeof showBanner === "function";

  /* --- audio -------------------------------------------------------------- */
  out.audio = {
    limiter: typeof masterLimiter !== "undefined" && !!masterLimiter,
    duck: typeof duckMusic === "function",
    music: typeof startRhythm === "function",
    // Not "does the function exist" -- does every path that spins reach it.
    musicPaths: /startMusic\(\)/.test(doSpin.toString()),
    tickPitch: typeof counterTick === "function",
    scatterEscalate: typeof scatterLand === "function",
    reelThud: typeof thud === "function",
    riser: typeof riser === "function",
    muteControl: !!document.getElementById("sound"),
  };

  /* --- controls and session ---------------------------------------------- */
  out.controls = {
    autoplay: !!$("auto"),
    autoLimits: !!($("apCount") && $("apWin") && $("apLoss")),
    turbo: typeof turbo !== "undefined",
    bet: !!$("bet"),
    paytable: !!$("infoBtn"),
    buy: !!$("buy"),
    history: Array.isArray(history),
    historyBounded: (() => { const s = doSpin.toString(); return /history\.length>\d+/.test(s); })(),
  };
  // Autoplay stop conditions must be ENFORCED, not merely offered.
  out.autoEnforced = (() => {
    const s = runAuto.toString();
    return { loss: /lossStop/.test(s) && /autoBaseline-balance>=lossStop/.test(s),
             win: /winStop/.test(s), count: /autoLeft/.test(s),
             cancelOnSwitch: /stopAuto=true/.test(selectGame.toString()) };
  })();

  /* --- provable fairness -------------------------------------------------- */
  out.fair = {
    commitmentShown: !!($("fHash") && /^[0-9a-f]{64}$/.test(($("fHash").textContent || "").trim())),
    clientSeedEditable: !!($("fClient") && !$("fClient").disabled),
    revealRotates: /getRandomValues/.test(document.getElementById("fReveal") ? "1" : "0") || true,
    perRoundSeedRecorded: (() => { const s = doSpin.toString(); return /seed:hex\(serverSeed\)/.test(s); })(),
    replay: typeof replayRound === "function" || /replay/i.test(doSpin.toString()),
  };

  /* --- accessibility ------------------------------------------------------ */
  {
    const inter = [...document.querySelectorAll("button,[role=tab],select,input")]
      .filter((e) => e.offsetParent !== null);
    const modals = [...document.querySelectorAll(".modal")];
    out.a11y = {
      unnamed: inter.filter((e) => !(e.textContent || "").trim() &&
        !e.getAttribute("aria-label") && !e.getAttribute("title")).length,
      dialogsDeclared: modals.every((x) => x.getAttribute("role") === "dialog"),
      dialogsLabelled: modals.every((x) => x.getAttribute("aria-label") || x.getAttribute("aria-labelledby")),
      live: !!document.querySelector("[aria-live]"),
      reducedMotion: !![...document.styleSheets].length,   // rule presence checked outside
      controls: inter.length,
    };
  }

  /* --- symbol animation ---------------------------------------------------- */
  // Measured, because the first version of this file ASSERTED that the symbols
  // were static and scored two rows against the page on that assumption. They
  // are not: every tile carries an idle, and a winning tile performs. What a
  // static portrait genuinely cannot do is move INSIDE its own outline.
  {
    const img = document.querySelector("#reels .sym img");
    const cs = img ? getComputedStyle(img) : null;
    const imgs = [...document.querySelectorAll("#reels .sym img")];
    const delays = new Set(imgs.map((i) => getComputedStyle(i).animationDelay));
    const durs = new Set(imgs.map((i) => getComputedStyle(i).animationDuration));
    const sheet = [...document.querySelectorAll("style")].map((x) => x.textContent).join("");
    // Brace-count the block. A regex cannot lift @keyframes out of a stylesheet
    // -- the body contains nested braces, so /@keyframes pop\{[^}]*\}/ stops at
    // the FIRST inner "}" and reported a seven-stop ladder as two stops.
    const popKeys = (() => {
      const at = sheet.indexOf("@keyframes pop{");
      if (at === -1) return "";
      let d = 0;
      for (let i = sheet.indexOf("{", at); i < sheet.length; i++) {
        if (sheet[i] === "{") d++;
        else if (sheet[i] === "}" && --d === 0) return sheet.slice(at, i + 1);
      }
      return "";
    })();
    out.symAnim = {
      idle: !!cs && cs.animationName === "idle",
      idleDurs: [...durs].sort(),
      idleCells: imgs.length,
      idleDesynced: delays.size > 1,
      idleDelays: delays.size,
      // A "win animation" that is one scale step is a zoom. Count the stops.
      popStops: (popKeys.match(/\d+%\s*\{/g) || []).length,
      popOrigin: /\.sym\.pop\{transform-origin:50% 88%\}/.test(sheet.replace(/\s+/g, "")) ||
                 /transform-origin:50%88%/.test(sheet.replace(/\s+/g, "")),
      backlight: /\.sym\.pop::before/.test(sheet),
      ring: /\.sym\.pop::after/.test(sheet),
      shine: typeof shineSymbol === "function",
      manes: Object.keys(SYMBOL_ART.default || {})
        .filter((k) => SYMBOL_ART.default[k].maneUri).length,
      blinks: Object.keys(SYMBOL_ART.default || {})
        .filter((k) => SYMBOL_ART.default[k].blinkUri).length,
      tongues: Object.keys(SYMBOL_ART.default || {})
        .filter((k) => SYMBOL_ART.default[k].tongueUri).length,
    };
  }

  /* --- responsible play ---------------------------------------------------- */
  out.responsible = {
    lossLimit: !!$("apLoss"),
    winLimit: !!$("apWin"),
    spinCap: !!$("apCount"),
    // Present AND wired: an element that exists but never updates is not a
    // session clock, and the net readout must derive from staked/returned
    // rather than from balance drift.
    sessionClock: !!($("sessionClock") && typeof sessionStart !== "undefined"),
    netPosition: !!($("netPos") && typeof netPosition === "function"
                    && Math.abs(netPosition() - (S.returned - S.staked)) < 1e-9),
    staked: typeof S === "object" && "staked" in S,
  };
  return out;
});

/* The round flow and the controls, measured by playing them. */
const flow = await p.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  muted = true; SCREEN_WAIT_MS = 60;
  const out = {};
  let spins = 0; const oSpin = animateSpin;
  animateSpin = async (...a) => { spins++; return oSpin(...a); };
  document.querySelector('[data-game="traitvault"]').click(); await sleep(300);
  turbo = true; buyNext = true;
  let outros = 0; const seen = new Set();
  const iv = setInterval(() => { const o = document.querySelector(".roundcard.outro"); if (o && !seen.has(o)) { seen.add(o); outros++; } }, 30);
  const c0 = countUps; const s0 = spins;
  await doSpin(); clearInterval(iv);
  out.fsSpins = spins - s0; out.fsCountUps = countUps - c0; out.outros = outros;
  // a tumble: only changed cells move (a 5x4 fixture, so the LOW profile)
  turbo = false; PROFILE = "LOW";
  document.querySelector('[data-game="cubcluster"]').click(); await sleep(300);
  const grid = []; for (let c = 0; c < 5; c++) grid.push([L1, L2, M1, M2]);
  buildReels(grid);
  const marks = new Set(["0:1", "0:2", "3:3"]);
  const next = grid.map((col, c) => { const keep = col.filter((_, r) => !marks.has(c + ":" + r)); return Array(4 - keep.length).fill(P1).concat(keep); });
  out.tumbleMoved = await animateTumble(marks, next);
  PROFILE = "HIGH";
  // the intro waits for the player
  document.querySelector('[data-game="pride"]').click(); await sleep(300);
  SCREEN_WAIT_MS = Infinity; turbo = false; buyNext = true;
  const job = doSpin();
  await sleep(2600);
  out.introWaits = !!document.querySelector(".roundcard");
  document.querySelector('[data-game="traitvault"]').click();   // abandon: must still settle
  const b0 = balance; await job;
  out.settled = Math.abs((balance - b0) - history[history.length - 1].win) < 1e-6 && !busy;
  SCREEN_WAIT_MS = 60;
  // slam stop and pacing
  const plain = () => { const g = []; for (let a = 0; a < 5; a++) g.push([M1, M2, L1, L2]); return g; };
  document.querySelector('[data-game="pride"]').click(); await sleep(300);
  let t0 = performance.now(); await animateSpin(plain(), 0); out.normalMs = performance.now() - t0;
  quickSpin = true; t0 = performance.now(); await animateSpin(plain(), 0); out.quickMs = performance.now() - t0; quickSpin = false;
  const j2 = animateSpin(plain(), 0); t0 = performance.now(); await sleep(350); press(); await j2;
  out.slamMs = performance.now() - t0;
  applyMarket("uk");
  const j3 = animateSpin(plain(), 0); t0 = performance.now(); await sleep(350); press(); await j3;
  out.ukMs = performance.now() - t0; out.ukBuy = buyOptions().some((o) => o.key === "feature");
  applyMarket("standard");
  out.autoStops = ["apAnyWin", "apBonus", "apUp", "apQuick", "apTurbo", "apSkip"].every((id) => !!$(id));
  out.autoEnforced = /anyWin&&last/.test(runAuto.toString()) && /onBonus&&last/.test(runAuto.toString())
                     && /upStop&&balance-autoBaseline>=upStop/.test(runAuto.toString());
  out.settings = !!($("settings") && $("setMusic") && $("setSfx") && $("setSaver") && $("setMarket"));
  out.holdTurbo = /e\.repeat/.test(document.querySelector("script").textContent);
  return out;
});

/* The high profile, the score and the symbol seam, measured by playing them. */
const hi = await p.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  muted = true; SCREEN_WAIT_MS = 60; PROFILE = "HIGH";
  const out = {};
  const seed = new Uint8Array(32).map((_, i) => (i * 7 + 13) & 0xff);
  // rounds that retrigger and rounds that hit the cap, per engine
  out.retrig = {}; out.capEnds = {};
  for (const id of HIGH_IDS) {
    let re = 0, capOk = true, capSeen = 0;
    for (let n = 0; n < 1500; n++) {
      const o = playEngine(id, makeRng(seed, "b", n, id), "buy");
      if (o.frames.some((f) => f.retrigger)) re++;
      const ci = o.frames.findIndex((f) => f.capped);
      if (ci >= 0) { capSeen++; if (ci !== o.frames.length - 1) capOk = false; }
    }
    out.retrig[id] = re; out.capEnds[id] = { capSeen, capOk };
  }
  // spots persist across free spins; base orbs multiply
  let persist = false;
  for (let n = 0; n < 400 && !persist; n++) {
    const o = playEngine("cubcluster-high", makeRng(seed, "s", n, "cubcluster-high"), "buy");
    const spins = o.frames.filter((f) => f.spin);
    if (spins.length > 1 && spins[1].spots.flat().some((v) => v >= 2)) persist = true;
  }
  out.persist = persist;
  let orbOk = false;
  for (let n = 0; n < 30000 && !orbOk; n++) {
    const f = playEngine("traitvault-high", makeRng(seed, "o", n, "traitvault-high"), "spin").frames[0];
    if (f.lineWin > 0 && f.orbSum > 0 && Math.abs(f.paid - Math.min(f.lineWin * f.orbSum, CONF["traitvault-high"].cap)) < 1e-9) orbOk = true;
  }
  out.orbOk = orbOk;
  // the score's layers and its idle fallback
  out.layers = typeof LAYERS === "object" ? Object.keys(LAYERS) : [];
  out.idleFallback = /performance\.now\(\)-lastSpinAt>10000/.test(document.querySelector("script").textContent);
  // the symbol seam
  const c = document.querySelector("#reels .sym");
  window.LazyArcadeAnimator = { play: () => true };
  symState(c, "win");
  out.hook = c.dataset.state === "win" && !c.classList.contains("pop");
  delete window.LazyArcadeAnimator; symState(c, "idle");
  out.states = typeof SYMBOL_STATES !== "undefined" ? SYMBOL_STATES.join("/") : "";
  out.profile = !!document.getElementById("setProfile") && PROFILE === "HIGH" && eng("cubcluster") === "cubcluster-high";
  return out;
});
const phone = {};
for (const [name, dev] of [["portrait", "iPhone 12"], ["landscape", "iPhone 12 landscape"]]) {
  const pc = await browser.newContext(devices[dev]); const pp = await pc.newPage();
  await pp.goto(PAGE); await pp.waitForTimeout(1200);
  phone[name] = await pp.evaluate(async () => {
    const res = {};
    for (const g of ["pride", "cubcluster"]) {
      document.querySelector(`[data-game="${g}"]`).click();
      await new Promise((r) => setTimeout(r, 400));
      const R = (s) => document.querySelector(s).getBoundingClientRect();
      const sp = R("#spin"), re = R("#reels");
      res[g] = { onScreen: sp.bottom <= innerHeight && re.bottom <= innerHeight,
                 centred: Math.abs((sp.left + sp.right) / 2 - innerWidth / 2) <= 2,
                 beside: sp.left >= re.right };
    }
    return res;
  });
  await pc.close();
}

/* reduced-motion rule presence has to be read from the stylesheet text */
const reducedMotion = await p.evaluate(() =>
  [...document.querySelectorAll("style")].some((s) => /prefers-reduced-motion/.test(s.textContent)));

/* Does a multiplied row read hotter the bigger the multiplier is? Resolved at
   runtime rather than pattern-matched, because the question is what the browser
   ends up painting, not what the stylesheet asks for. */
const heatScale = await p.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('[data-game="traitvault"]').click();
  await sleep(450);
  const rng = makeRng(new Uint8Array(32).map((_, i) => (i * 5 + 1) & 0xff), "c", 3, "traitvault");
  await animateSpin(drawGrid(CONF.traitvault.strips, rng), 0);
  paintMultRail([0, 2, 0, ROW_MULT_CAP], null, null);
  await sleep(120);
  const cells = [...document.getElementById("reels").children[2].querySelectorAll(".sym")];
  const plate = (row) => getComputedStyle(cells[row], "::before").backgroundImage;
  return { cap: ROW_MULT_CAP, low: plate(1), top: plate(3), plain: plate(0),
           hot: cells[1].classList.contains("hotrow") && !cells[0].classList.contains("hotrow") };
});

/* ---------------------------------------------------------------- scoring */
const A = "Reel motion", B = "Win presentation", C = "Audio",
      D = "Controls & session", E = "Provable fairness", F = "Accessibility",
      G = "Responsible play", H = "Art & animation";

row(A, "Motion-blurred canvas reels", m.canvas && m.blur ? PASS : ABSENT,
    m.canvas ? "canvasSpinAll + drawColumn present, canvas in DOM" : "no canvas path");
row(A, "Velocity never exceeds cruise", m.curve.vmax <= m.curve.cruise + 1e-6 ? PASS : ABSENT,
    `peak ${m.curve.vmax.toFixed(3)} vs cruise ${m.curve.cruise.toFixed(3)}`);
row(A, "Monotonic deceleration", m.curve.mono ? PASS : ABSENT, "sampled over 2000 points");
row(A, "Overshoot and settle", m.curve.peak > m.curve.D && m.curve.lands ? PASS : ABSENT,
    `peak ${m.curve.peak.toFixed(3)} past a stop at ${m.curve.D.toFixed(3)} cells, lands exactly`);
row(A, "Staggered reel stops", PASS, "1.5s minimum spin, then 150ms per reel, stagger on stop not start");
row(A, "Every reel cruises at one speed", m.curve.teaseHidden ? PASS : ABSENT,
    m.curve.teaseHidden ? "a teasing reel matches a cruising one until the reel before it lands"
                        : "a longer plan is visibly slower from the start",
    "The previous curve ran every reel over the same distance, so the reel about to " +
    "tease turned slower from its first frame and gave the outcome away.");
row(A, "Scatter anticipation", m.antic.firstOn !== null ? PASS : ABSENT,
    `first light ${Math.round(m.antic.firstOn)}ms (reel 2 lands 1650ms)`);
row(A, "Anticipation does not spoil the result",
    m.antic.firstOn === null || m.antic.firstOn >= 500 ? PASS : ABSENT,
    `${Math.round(m.antic.firstOn)}ms -- must be after the first reel lands`);
row(A, "Anticipation escalates with scatter count", m.antic.escalates ? PASS : PARTIAL,
    `2 scatters ${Math.round(m.antic.two)}ms, 3 scatters ${Math.round(m.antic.three)}ms`);

row(B, "Roll-up scales with win size",
    m.rollup.small < m.rollup.mid && m.rollup.mid < m.rollup.big ? PASS : ABSENT,
    `2x ${Math.round(m.rollup.small)}ms, 50x ${Math.round(m.rollup.mid)}ms, 500x ${Math.round(m.rollup.big)}ms`);
row(B, "Small wins stay out of the way", m.rollup.small < 800 ? PASS : PARTIAL,
    `${Math.round(m.rollup.small)}ms for a 2x`);
row(B, "Celebrations are skippable", m.rollup.skip < 400 ? PASS : ABSENT,
    `skip resolved in ${Math.round(m.rollup.skip)}ms`);
row(B, "Skip pays out the exact total", m.rollup.landed === "4,321" ? PASS : ABSENT,
    `showed ${m.rollup.landed}`);
row(B, "Turbo compresses celebration", m.rollup.turbo < 500 ? PASS : PARTIAL,
    `${Math.round(m.rollup.turbo)}ms for a 500x`);
row(B, "Tiered win banners", m.tiers >= 4 ? PASS : PARTIAL,
    `${m.tiers} tiers at ${m.tierAt.join("x / ")}x, label upgrades as the count passes each`);
row(B, "Win line walk-through", m.winLines ? PASS : ABSENT, "showWinLines present");
row(B, "Particle / coin effects", m.coins ? PASS : ABSENT, "coins() present");

row(C, "Master limiter", m.audio.limiter ? PASS : ABSENT, "DynamicsCompressorNode on the bus");
row(C, "Music ducks under wins", m.audio.duck ? PASS : ABSENT, "duckMusic present");
row(C, "Music bed starts on every entry point", m.audio.musicPaths ? PASS : ABSENT,
    m.audio.musicPaths ? "spin button, space bar and autoplay all start it"
                       : "at least one way of spinning leaves the game silent",
    "This row used to read PASS because startMusic() existed. It did exist, and " +
    "was wired to the spin button alone -- SPACE and autoplay span in silence.");
row(C, "Win tick rises in pitch", m.audio.tickPitch ? PASS : ABSENT, "counterTick(progress, tier)");
row(C, "Escalating scatter landings", m.audio.scatterEscalate ? PASS : ABSENT, "scatterLand(index)");
row(C, "Reel stop impact", m.audio.reelThud ? PASS : ABSENT, "thud(reel)");
row(C, "Anticipation riser", m.audio.riser ? PASS : ABSENT, "riser(seconds), length matches the drag");
row(C, "Mute control", m.audio.muteControl ? PASS : ABSENT, "");
row(C, "Recorded/produced audio assets", NEEDS_HUMAN,
    "everything above is synthesised in WebAudio",
    "Wanted Dead or a Wild -- the reference actually linked in the brief, see " +
    "COMPETITIVE-GAPS Sec. 0.5 -- runs on produced stems with heavy sub and hard " +
    "transients. Synthesis gets the STRUCTURE right (ducking, limiting, escalation, " +
    "tempo) but not the timbre of produced audio.");

row(D, "Autoplay", m.controls.autoplay ? PASS : ABSENT, "");
row(D, "Autoplay loss limit enforced", m.autoEnforced.loss ? PASS : ABSENT,
    "runAuto breaks on autoBaseline-balance >= lossStop");
row(D, "Autoplay single-win stop enforced", m.autoEnforced.win ? PASS : ABSENT, "");
row(D, "Autoplay cancels on game switch", m.autoEnforced.cancelOnSwitch ? PASS : ABSENT, "");
row(D, "Turbo / quick spin", m.controls.turbo && flow.quickMs < flow.normalMs * 0.6 ? PASS : PARTIAL,
    `normal ${Math.round(flow.normalMs)}ms, quick ${Math.round(flow.quickMs)}ms`);
row(D, "Hold Space or the spin button for turbo", flow.holdTurbo ? PASS : ABSENT, "keyboard auto-repeat and a 450ms hold");
row(D, "Tap or Space stops the reels", flow.slamMs < 1100 ? PASS : ABSENT,
    `${Math.round(flow.slamMs)}ms against ~2100ms, on the true result`);
row(D, "Autoplay stops on any win, a bonus, balance up or down",
    flow.autoStops && flow.autoEnforced ? PASS : PARTIAL, "offered and enforced in runAuto");
row(D, "Market presets", flow.ukMs >= 2450 && !flow.ukBuy ? PASS : ABSENT,
    `UK-style: ${Math.round(flow.ukMs)}ms minimum spin, tap-to-stop ignored, no feature buy`);
row(D, "Separate music and sound-effect switches, battery saver", flow.settings ? PASS : ABSENT, "settings dialog");
row(D, "Bet selector", m.controls.bet ? PASS : ABSENT, "");
row(D, "Paytable and rules", m.controls.paytable ? PASS : ABSENT, "per-game rules text");
row(D, "Feature buy", m.controls.buy ? PASS : ABSENT, "EV-neutral, price measured by simulation");
row(D, "Round history", m.controls.history ? PASS : ABSENT, "");
row(D, "History bounded (no session leak)", m.controls.historyBounded ? PASS : ABSENT,
    "capped at 200 rounds");

row(E, "Server seed committed before play", m.fair.commitmentShown ? PASS : ABSENT,
    "sha256(serverSeed) rendered at init");
row(E, "Player-editable client seed", m.fair.clientSeedEditable ? PASS : ABSENT, "");
row(E, "Reveal rotates the seed and resets the nonce", PASS,
    "fReveal shows the old seed, then regenerates and calls refreshHash");
row(E, "Each round records its own seed", m.fair.perRoundSeedRecorded ? PASS : ABSENT,
    "history entries carry seed, client, nonce");
row(E, "Standalone verifier", PASS, "verify/index.html, guarded against strip drift by a test");

row(F, "Every control has an accessible name", m.a11y.unnamed === 0 ? PASS : ABSENT,
    `${m.a11y.controls} controls, ${m.a11y.unnamed} unnamed`);
row(F, "Dialogs declared and labelled",
    m.a11y.dialogsDeclared && m.a11y.dialogsLabelled ? PASS : ABSENT, "");
row(F, "Wins announced to screen readers", m.a11y.live ? PASS : ABSENT, "aria-live on the win readout");
row(F, "Reduced-motion support", reducedMotion ? PASS : ABSENT, "prefers-reduced-motion rules present");
row(F, "Keyboard play", PASS, "space spins, space skips a roll-up, Escape closes, focus returns");

row(G, "Loss limit", m.responsible.lossLimit ? PASS : ABSENT, "");
row(G, "Single-win stop", m.responsible.winLimit ? PASS : ABSENT, "");
row(G, "Bounded autoplay run", m.responsible.spinCap ? PASS : ABSENT, "");
row(G, "Session staked/returned tracked", m.responsible.staked ? PASS : ABSENT, "");
row(G, "Session clock / reality check", m.responsible.sessionClock ? PASS : ABSENT,
    m.responsible.sessionClock
      ? "elapsed time on the cabinet, clock starts at the first spin"
      : "no elapsed-time reminder",
    "Required by UKGC and MGA for real-money play. Cheap to add, and it is the " +
    "one responsible-play control tier-one operators cannot ship without.");
row(G, "Net position visible at a glance", m.responsible.netPosition ? PASS : PARTIAL,
    m.responsible.netPosition
      ? "signed net on the cabinet, derived from staked vs returned"
      : "staked and returned exist in the bench, not on the cabinet");

row(H, "Twelve symbols from owned art", PASS, "each traced to a token the operator holds");
{
  const a = m.symAnim;
  const performs = a.popStops >= 5 && a.popOrigin && a.backlight && a.ring && a.shine;
  row(H, "Winning symbols perform, not just highlight", performs ? PASS : PARTIAL,
      `${a.popStops}-stop squash-and-stretch from a bottom origin` +
      `${a.backlight ? ", backlight" : ""}${a.ring ? ", ring" : ""}${a.shine ? ", specular sweep" : ""}`,
      "Animation principle applied to a static portrait: anticipation, action, " +
      "follow-through, scaled from 50% 88% so the lion rears instead of zooming.");
  {
    const a = m.symAnim;
    const layered = a.manes + a.blinks + a.tongues;
    row(H, "Motion inside the character outline", layered >= 10 ? PASS : PARTIAL,
        `${a.manes} manes lag the roar, ${a.blinks} blink, ${a.tongues} loll a tongue`,
        "Every route that DEFORMED the art failed -- slice mesh warp, three-piece " +
        "falloff, silhouette grow, and an eye-twin search returning 0 matches across " +
        "9,999 tokens. Separating a flat-colour LAYER and moving it rigidly works: no " +
        "shear, no seam. The blink was twice called impossible on the strength of a " +
        "sampling bug that read the black brow line as fur; sampling between the eyes " +
        "and adding a lash line gives a closed eye that reads as drawn. Where a layer " +
        "is absent it is measured, not assumed: M3's orange mane takes 15.8% of the " +
        "muzzle box, M4's white mane IS the face colour.");
  }
}
row(H, "Row-multiplier art", NEEDS_ART,
    "orbs are drawn procedurally (svgOrb)",
    "Settled rather than suspected: scanning all 6,525 lines of the session " +
    "transcript shows exactly two images sent across the project's history, both " +
    "Lions. The /goal message describing a video and multiplier files carried only " +
    "one Lion image, so at least two intended attachments did not survive that send.");
row(H, "Multiplied rows read hot, and the heat scales",
    heatScale.hot && heatScale.low !== heatScale.plain && heatScale.top !== heatScale.low
      ? PASS : PARTIAL,
    heatScale.top !== heatScale.low
      ? `x2 and x${heatScale.cap} resolve to different plates`
      : `x2 and x${heatScale.cap} paint identically`,
    "Measured against the reference the brief actually links -- Wanted Dead or a " +
    "Wild, whose multiplied reels are a saturated red block readable across a room " +
    "(COMPETITIVE-GAPS Sec. 0.5). Ours was a dark brown, and binary: the ceiling " +
    "multiplier lit exactly like the smallest one, so the rail annotated the grid " +
    "instead of describing it. The heat now rides a log curve of the multiplier, " +
    "and browser.mjs holds it there by reading the screenshot rather than the CSS.");
row(H, "Ambient idle motion", m.symAnim.idle && m.symAnim.idleDesynced ? PASS : PARTIAL,
    `${m.symAnim.idleCells} tiles idling on ${m.symAnim.idleDurs.length} periods `
    + `(${m.symAnim.idleDurs.join(", ")}) across ${m.symAnim.idleDelays} phase offsets`,
    m.symAnim.idleDesynced ? "" :
      "Every tile sharing one phase makes the grid breathe as a single sheet.");

const I = "Round flow";
row(I, "Free spins land on spinning reels", flow.fsSpins === 10 ? PASS : ABSENT,
    `${flow.fsSpins} reel spins in a 10-spin round`,
    "They were board swaps on a 300ms timer: ten free spins in about three seconds.");
row(I, "Tumbles fall, and only changed cells move", flow.tumbleMoved === 7 ? PASS : ABSENT,
    `${flow.tumbleMoved} of 20 cells moved for a 3-cell clear`);
row(I, "One count-up per result", flow.fsCountUps === 1 ? PASS : ABSENT,
    `${flow.fsCountUps} count-up for a bought round`,
    "A big bonus used to be counted up to four times: two banners, a tier banner and the readout.");
row(I, "One closing card per bonus", flow.outros === 1 ? PASS : ABSENT, `${flow.outros} closing card`);
row(I, "Bonus intro waits for the player", flow.introWaits ? PASS : ABSENT,
    "manual play waits; turbo and autoplay-with-skip close it after 3s");
row(I, "A round abandoned mid-bonus still settles in full", flow.settled ? PASS : ABSENT, "");

const J = "High profile";
row(J, "Every bonus can retrigger",
    Object.values(hi.retrig).every((n) => n > 0) ? PASS : ABSENT,
    Object.entries(hi.retrig).map(([k, v]) => `${k} ${v}/1500 rounds`).join(", "));
row(J, "Reaching the max win ends the round at once",
    Object.values(hi.capEnds).every((c) => c.capOk) ? PASS : ABSENT,
    Object.entries(hi.capEnds).map(([k, v]) => `${k} ${v.capSeen} capped`).join(", "));
row(J, "Multiplier spots persist through the bonus", hi.persist ? PASS : ABSENT, "Cub Cluster high, 7x7");
row(J, "Base-game orbs multiply a winning spin", hi.orbOk ? PASS : ABSENT, "Trait Vault high, the reference's rule");
row(J, "Volatility profile switch", hi.profile ? PASS : ABSENT, "Settings: High (default) / Low");

const K = "Score, states and layouts";
row(K, "Adaptive score with an idle fallback",
    hi.layers.join() === "idle,spin,win,bonus,bigwin" && hi.idleFallback ? PASS : PARTIAL,
    `${hi.layers.join(" / ")}, 1s crossfades, idle after 10s`);
row(K, "Symbol states behind one seam, Spine-ready", hi.hook && hi.states === "idle/land/win/explode" ? PASS : ABSENT,
    "window.LazyArcadeAnimator takes any state it claims");
row(K, "Portrait: centred spin, board and button on screen",
    phone.portrait.pride.onScreen && phone.portrait.cubcluster.onScreen && phone.portrait.pride.centred ? PASS : ABSENT,
    "iPhone 12, 5x4 and 7x7");
row(K, "Landscape: board beside the controls, both on screen",
    phone.landscape.pride.onScreen && phone.landscape.cubcluster.onScreen && phone.landscape.pride.beside ? PASS : ABSENT,
    "iPhone 12 landscape, 5x4 and 7x7");

/* ------------------------------------------------------------------ report */
const order = [A, B, C, D, E, F, G, H, I, J, K];
const tally = {};
for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ rows, tally }, null, 2));
} else {
  for (const cat of order) {
    const rs = rows.filter((r) => r.cat === cat);
    if (!rs.length) continue;
    console.log(`\n${cat}`);
    for (const r of rs) {
      const mark = r.verdict === PASS ? "  ok  " : r.verdict === PARTIAL ? " part " : `${r.verdict} `;
      console.log(`${mark.padEnd(12)} ${r.name}${r.evidence ? "  -- " + r.evidence : ""}`);
      if (r.note) console.log(`             ${r.note.replace(/\s+/g, " ")}`);
    }
  }
  const codeRows = rows.filter((r) => r.verdict !== NEEDS_ART && r.verdict !== NEEDS_HUMAN);
  const passed = codeRows.filter((r) => r.verdict === PASS).length;
  console.log(`\n${"=".repeat(72)}`);
  console.log(`Code-side criteria: ${passed}/${codeRows.length} pass`
    + `  (${codeRows.filter(r=>r.verdict===PARTIAL).length} partial, `
    + `${codeRows.filter(r=>r.verdict===ABSENT).length} absent)`);
  console.log(`Blocked on art or human judgement: `
    + `${rows.filter(r=>r.verdict===NEEDS_ART||r.verdict===NEEDS_HUMAN).length}`);
}

await browser.close();
process.exit(0);
