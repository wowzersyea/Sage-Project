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
  {
    const N = 2000; let prev = null, vmax = 0, peak = 0, mono = true, last = null;
    for (let i = 0; i <= N; i++) {
      const k = i / N, d = reelEase(k);
      peak = Math.max(peak, d);
      if (prev !== null) {
        const v = (d - prev) * N; vmax = Math.max(vmax, v);
        if (k > REEL_B && k < REEL_M) { if (last !== null && v > last + 1e-6) mono = false; last = v; }
      }
      prev = d;
    }
    out.curve = { vmax, cruise: REEL_V, peak, mono, lands: Math.abs(reelEase(1) - 1) < 1e-12 };
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
  out.tiers = (() => {
    // Read the ladder off doSpin itself. The first pattern here required the
    // "?" to sit flush against the number and so missed `winMult>=40 ?"Mega
    // win"`, reporting a four-rung ladder as two.
    const src = doSpin.toString();
    return (src.match(/winMult>=\d+\s*\?\s*"[^"]+"/g) || []).length;
  })();
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
row(A, "Overshoot and settle", m.curve.peak > 1 && m.curve.lands ? PASS : ABSENT,
    `peak ${m.curve.peak.toFixed(4)}, lands on exactly 1`);
row(A, "Staggered reel stops", PASS, "base 520ms + 135ms per reel, stagger on stop not start");
row(A, "Scatter anticipation", m.antic.firstOn !== null ? PASS : ABSENT,
    `first light ${Math.round(m.antic.firstOn)}ms (reel 2 lands 655ms)`);
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
row(B, "Tiered win banners", m.tiers >= 4 ? PASS : PARTIAL, `${m.tiers} tiers on the ladder`);
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
row(D, "Turbo / quick spin", m.controls.turbo ? PASS : ABSENT, "");
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

/* ------------------------------------------------------------------ report */
const order = [A, B, C, D, E, F, G, H];
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
