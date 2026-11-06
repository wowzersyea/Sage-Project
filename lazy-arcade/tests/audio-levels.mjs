/**
 * Audio levels gate.
 *
 * Nothing measured the sound. The limiter was verified to EXIST and its comment
 * described a fanfare summing "comfortably past 1.0", but no one had rendered
 * the graph to find out what actually reaches the speakers. Rendering it showed
 * the opposite problem: nothing clipped, and nothing came near the ceiling
 * either. The Epic fanfare peaked at -6.7 dBFS and a reel stop at -28.8, a 22 dB
 * spread, so the limiter never engaged once while the routine sounds sat twelve
 * times quieter in amplitude than the big ones -- inaudible on a phone or in a
 * room with any noise in it, while the fanfare came through fine.
 *
 * Each sound is rendered through the page's REAL audio graph on an
 * OfflineAudioContext, so what is measured is what a player hears, limiter and
 * reverb sends included.
 *
 * IN A FRESH PAGE EACH TIME, which is not a detail. Several sounds schedule
 * follow-ups with setTimeout, and those fire during a LATER render and land in
 * the wrong measurement. Sharing one page made winChime -- which contains no
 * randomness whatever -- measure -0.4 dBFS in one run and -18.2 in the next, and
 * invented a tier-3-louder-than-tier-4 inversion that does not exist. Levels
 * were nearly tuned against that noise.
 *
 *   CHROMIUM_PATH=... node tests/audio-levels.mjs
 *
 * Skips with exit 0 if playwright is absent.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(join(here, "..", "play", "index.html")).href;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log("playwright not installed -- skipping audio gate (npm i -D playwright)");
  process.exit(0);
}

// name, code, and the band it must land in (dBFS).
//
// The floor matters as much as the ceiling. A sound quieter than its floor is
// one the player loses the moment there is any noise in the room, and reel
// stops and coin ticks are the sounds a slot makes most often.
const CASES = [
  ["fanfare tier 1", "jackpotFanfare(1)", -10, -3],
  ["fanfare tier 2", "jackpotFanfare(2)", -10, -3],
  ["fanfare tier 3", "jackpotFanfare(3)", -9, -2],
  ["fanfare tier 4", "jackpotFanfare(4)", -8, -1.5],
  ["win chime", "winChime(4)", -19, -10],
  ["gunshot", "gunshot()", -17, -8],
  ["kerching", "kerching()", -17, -8],
  ["reel stop", "thud(0)", -18, -9],
  ["riser", "riser(0.7)", -19, -9],
  ["3 scatters", "scatterLand(0);scatterLand(1);scatterLand(2)", -18, -8],
  ["epic + coins + kerching",
   "jackpotFanfare(4);kerching();for(let i=0;i<8;i++)counterTick(i/8,4)", -6, -1],
  // The Lion's own fanfare. Scheduled entirely on the audio clock, which is
  // what makes it renderable here at all -- setTimeout never fires inside an
  // OfflineAudioContext render, so a wall-clock version would measure only
  // its opening silence and pass any band by accident.
  ["the Lion's Crown", "lionsCrownFanfare()", -8, -1],
  // The hype track. rhythmScheduleAhead exists precisely so this render is
  // possible: an OfflineAudioContext never fires the timer the live path uses,
  // so the harness lays the bars out synchronously through the same scheduler.
  ["the track, four bars", "startMusic();startRhythm();rhythmScheduleAhead(3.9)", -16, -6],
  ["the chant", "chantLazyLions(0.05,0.29,1)", -24, -12],
  ["the roar", "lionRoar(0.12)", -16, -6],
];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? " -- " + detail : ""}`);
  if (!ok) failures++;
};

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function measure(code) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const p = await ctx.newPage();
  await p.goto(PAGE);
  await p.waitForTimeout(1200);
  const v = await p.evaluate(async (src) => {
    const SR = 44100, off = new OfflineAudioContext(1, SR * 4, SR);
    const Real = window.AudioContext;
    window.AudioContext = function () { return off; };
    actx = null; busGain = null; masterLimiter = null; verbSend = null;
    musicDuck = null; muted = false;
    ac();
    try { (0, eval)(src); } catch (e) { window.AudioContext = Real; return { err: String(e) }; }
    const buf = await off.startRendering();
    window.AudioContext = Real;
    const d = buf.getChannelData(0);
    let peak = 0, clip = 0;
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      if (a >= 0.999) clip++;
    }
    return { peak, clip, dbfs: 20 * Math.log10(Math.max(peak, 1e-9)) };
  }, code);
  await ctx.close();
  return v;
}

console.log("\nAudio levels (rendered through the real graph)");
let loudest = -Infinity, quietest = Infinity;
for (const [name, code, floor, ceil] of CASES) {
  const v = await measure(code);
  if (v.err) { check(name, false, v.err.slice(0, 70)); continue; }
  const db = +v.dbfs.toFixed(1);
  loudest = Math.max(loudest, db);
  quietest = Math.min(quietest, db);
  check(`${name} sits in ${floor}..${ceil} dBFS`,
        v.clip === 0 && db >= floor && db <= ceil,
        `${db} dBFS${v.clip ? `, ${v.clip} CLIPPED SAMPLES` : ""}`);
}

// Stereo. The graph was mono -- not one panner in the page -- and width is
// most of what separates a produced stem from an oscillator. Reel thuds now
// pan by reel position, so reel 1 must render left-heavy and reel 5
// right-heavy. Balance is (R-L)/(R+L) on channel energy: 0 is centred, and a
// mono graph scores exactly 0 for both, which is how this check fails if the
// panner is ever lost.
{
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const p = await ctx.newPage();
  await p.goto(PAGE);
  await p.waitForTimeout(1200);
  const bal = await p.evaluate(async () => {
    const render = async (src) => {
      const SR = 44100, off = new OfflineAudioContext(2, SR, SR);
      const Real = window.AudioContext;
      window.AudioContext = function () { return off; };
      actx = null; busGain = null; masterLimiter = null; verbSend = null;
      musicDuck = null; muted = false;
      ac();
      (0, eval)(src);
      window.AudioContext = Real;
      const buf = await off.startRendering();
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      let el = 0, er = 0;
      for (let i = 0; i < L.length; i++) { el += L[i] * L[i]; er += R[i] * R[i]; }
      return (er - el) / (er + el + 1e-12);
    };
    return { left: await render("thud(0)"), right: await render("thud(4)") };
  });
  await ctx.close();
  check("reel 1 lands left of centre", bal.left < -0.08, `balance ${bal.left.toFixed(3)}`);
  check("reel 5 lands right of centre", bal.right > 0.08, `balance ${bal.right.toFixed(3)}`);
}

// The spread is the point. Individually-legal levels can still leave the small
// sounds inaudible next to the big ones; it was 22 dB before any of this.
check("the loudest and quietest sounds are within 16 dB",
      loudest - quietest <= 16,
      `${(loudest - quietest).toFixed(1)} dB spread (${quietest} .. ${loudest})`);

// Loudness is one of the ways a tier says how big it is, so the ladder has to
// keep climbing. Push the master too hard and the limiter flattens it: at 1.8
// tiers 1 and 2 land 0.3 dB apart.
//
// Averaged over three renders per tier. The fanfare contains a noise burst, so a
// single render moves by a few tenths of a dB run to run -- enough that a strict
// step-by-step comparison reports an inversion that is not there. A test that
// fails at random teaches people to ignore it, so this measures the span, which
// is far larger than the noise, and tolerates a step being flat within it.
const mean = async (code, n = 3) => {
  let t = 0;
  for (let i = 0; i < n; i++) t += (await measure(code)).dbfs;
  return t / n;
};
const tiers = [];
for (let t = 1; t <= 4; t++) tiers.push(await mean(`jackpotFanfare(${t})`));
const span = tiers[3] - tiers[0];
let slips = 0;
for (let i = 1; i < tiers.length; i++) if (tiers[i] < tiers[i - 1] - 0.4) slips++;
check("the fanfare ladder climbs from tier 1 to tier 4", span >= 1.5,
      `${tiers.map((d) => d.toFixed(1)).join(" -> ")} (${span.toFixed(1)} dB span)`);
check("no fanfare tier is quieter than the one below it", slips === 0,
      `${slips} tier(s) step backwards`);

await browser.close();
console.log(failures ? `\n${failures} audio check(s) FAILED` : "\naudio levels OK");
process.exit(failures ? 1 : 0);
