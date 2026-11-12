/**
 * Browser gate for play/index.html.
 *
 * verify-play-math.mjs extracts the math half of the page and checks the odds.
 * Nothing checked the other half. PHASE-0-1 recorded that as a gap -- a
 * 2,000-line page with no browser test -- and every defect this file now guards
 * was found by hand during the Lion's Share rework, which is the argument for
 * writing it down rather than re-finding them.
 *
 * What it asserts, and why each one exists:
 *
 *   rendering   the DOM grid equals the grid the engine produced. A renderer
 *               that draws the wrong symbols is the worst bug this page can
 *               have, and it is invisible without comparing the two.
 *   structure   no horizontal overflow, no undecodable art, every cell carries
 *               its tier class. Cells are built at four sites; one forgetting
 *               the class is a silent regression.
 *   money       a spin cannot overdraw, and a double-click cannot double-charge.
 *   state       switching game mid-spin must not leave the machine stuck busy.
 *   dialogs     Escape closes and returns focus; SPACE MUST NOT SPIN while a
 *               dialog is open -- it did, placing a real bet under the paytable.
 *   a11y        dialogs declared, wins in a live region, controls named, and
 *               touch targets >= 40px where the pointer is coarse.
 *   reel curve  velocity never exceeds cruise, deceleration is monotonic, and
 *               travel lands on exactly 1. The curve it replaced lurched
 *               backwards in the last 14% of every spin.
 *
 * Every check here was proven to fail before it was trusted, by breaking the
 * page one defect at a time and confirming the right block went red: removing
 * the busy guard, letting SPACE through an open dialog, shifting the renderer
 * by one symbol, pointing the art at a missing file, stripping a dialog's role
 * and a button's label, squatting the touch targets, and swapping the reel
 * curve back to the back-ease it replaced (which failed on velocity, on
 * monotonicity, and on landing). That exercise is also what caught two checks
 * of my own that could not fail: both compared balance before and after, which
 * a WINNING spin satisfies no matter what the guard does. They now count
 * nonce, which advances once per accepted spin and does not move when a spin
 * pays.
 *
 * Needs a browser:  npm i -D playwright
 *   node tests/browser.mjs
 *   CHROMIUM_PATH=... node tests/browser.mjs    # browser kept outside the package
 *
 * Skips with exit 0 if playwright is absent, so it never blocks a checkout that
 * only wants the math gates.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { inflateSync } from "node:zlib";

/* Read the pixels a screenshot actually contains.
 *
 * Every visual check in this file until now asked the DOM what it intended to
 * draw -- a class name, a computed style. That is one step short of the thing
 * it is guarding: a rule can resolve to a perfectly good colour and still be
 * painted under something else, or clipped, or overridden by a later rule. For
 * the row-multiplier heat the whole claim is "the grid is visibly hotter", so
 * the check has to look at the picture.
 *
 * Chromium's screenshots are 8-bit, non-interlaced, colour type 2 or 6, which
 * is the entire surface this needs to handle. */
function pngPixels(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8, w = 0, h = 0, channels = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      const depth = data[8], colour = data[9], interlace = data[12];
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6))
        throw new Error(`unsupported PNG: depth ${depth} colour ${colour} interlace ${interlace}`);
      channels = colour === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels, out = Buffer.alloc(h * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[dst + x - channels] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? out[dst - stride + x - channels] : 0;
      const v = raw[src + x];
      out[dst + x] = (v + (f === 1 ? a : f === 2 ? b : f === 3 ? ((a + b) >> 1)
                            : f === 4 ? paeth(a, b, c) : 0)) & 0xff;
    }
  }
  return { w, h, channels, data: out };
}

/* How red-hot a picture reads, averaged over every pixel: red minus the other
 * two channels. Neutral art scores near zero however bright it is, so this
 * measures the plate's colour rather than its exposure. */
function warmth(png) {
  const { w, h, channels, data } = png;
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const p = i * channels;
    sum += data[p] - (data[p + 1] + data[p + 2]) / 2;
  }
  return sum / (w * h);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PAGE = pathToFileURL(join(root, "play", "index.html")).href;

let chromium, devices;
try {
  ({ chromium, devices } = await import("playwright"));
} catch {
  console.log("playwright not installed -- skipping browser gate (npm i -D playwright)");
  process.exit(0);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? " -- " + detail : ""}`);
  if (!ok) failures++;
};

// Chromium ships with Playwright, but this repo's container keeps it elsewhere.
const LAUNCH = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch(LAUNCH);

async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  await p.goto(PAGE);
  await p.waitForTimeout(1400);
  // Bonus screens wait for a press in manual play. A check that happens to
  // trigger a bonus must not hang on one, so they close themselves here; the
  // bookend checks set this back to Infinity to test the real behaviour.
  await p.evaluate(() => { SCREEN_WAIT_MS = 60; });
  return { p, ctx, errs };
}

/* ---------------------------------------------------- rendering + structure */
console.log("\nRendering and structure");
{
  const { p, ctx, errs } = await page();
  for (const g of ["pride", "cubcluster", "traitvault"]) {
    const r = await p.evaluate(async (g) => {
      document.querySelector(`[data-game="${g}"]`).click();
      await new Promise((r) => setTimeout(r, 450));
      const strips = CONF[g].strips;
      const rng = makeRng(new Uint8Array(32).map((_, i) => (i * 17 + 3) & 0xff), "c", 7, g);
      const grid = drawGrid(strips, rng);
      await animateSpin(grid, 0);
      const reels = [...document.getElementById("reels").children];
      let wrong = 0;
      for (let reel = 0; reel < 5; reel++) {
        const cells = reels[reel].querySelectorAll(".sym");
        for (let row = 0; row < 4; row++) {
          const want = symName(grid[reel][row], g);
          const img = cells[row] && cells[row].querySelector("img");
          const got = img ? img.alt : want;   // SVG-drawn symbols carry no alt
          if (got !== want) wrong++;
        }
      }
      const untiered = [...document.querySelectorAll("#reels .sym")]
        .filter((c) => !/t-(prem|mid|low|wild|scat)/.test(c.className)).length;
      const broken = [...document.querySelectorAll("img")]
        .filter((i) => i.complete && i.naturalWidth === 0).length;
      return { wrong, untiered, broken, overflow: document.body.scrollWidth > window.innerWidth + 1 };
    }, g);
    check(`${g}: rendered grid equals the engine's grid`, r.wrong === 0, `${r.wrong} cells differ`);
    check(`${g}: every cell carries a tier class`, r.untiered === 0, `${r.untiered} missing`);
    check(`${g}: no undecodable art`, r.broken === 0, `${r.broken} broken`);
    check(`${g}: no horizontal overflow`, !r.overflow);
  }
  check("no runtime errors while rendering", errs.length === 0, errs.slice(0, 3).join(" | "));
  await ctx.close();
}

/* ------------------------------------------------------------------- money */
console.log("\nMoney and state");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('[data-game="traitvault"]').click();
    await sleep(450);

    const saved = balance;
    balance = 10;                       // below one bet
    const before = balance;
    await doSpin();
    const overdrew = balance < 0;
    const refused = balance === before;
    balance = saved;

    // Comparing balance before and after a double-click proves nothing: any
    // winning spin leaves more money than it started with, so `charged <= bet`
    // passes whatever happens. doSpin debits the stake synchronously, before
    // its first await, and bumps the nonce once per accepted spin -- both are
    // exact and neither moves when a spin pays. Measure those instead.
    const bet = +document.getElementById("bet").value;
    const b0 = balance, n0 = nonce;
    const a = doSpin();                 // debits, then awaits the animation
    const afterFirst = balance;
    const b = doSpin();                 // fires before the first resolves
    const afterSecond = balance;
    await Promise.all([a, b]);
    return { overdrew, refused, bet, debited: +(b0 - afterFirst).toFixed(6),
             second: +(afterFirst - afterSecond).toFixed(6), spins: nonce - n0 };
  });
  check("a spin cannot overdraw the balance", !r.overdrew);
  check("a spin below the bet is refused", r.refused);
  check("one spin debits exactly one stake", Math.abs(r.debited - r.bet) < 1e-6,
        `debited ${r.debited} against a ${r.bet} bet`);
  check("a second click during a spin debits nothing", r.second === 0,
        `debited a further ${r.second}`);
  check("a double-click runs one spin, not two", r.spins === 1, `${r.spins} spins`);

  await p.evaluate(() => document.querySelector('[data-game="traitvault"]').click());
  await p.waitForTimeout(400);
  await p.click("#spin");
  await p.waitForTimeout(200);
  await p.click('[data-game="pride"]');
  await p.waitForTimeout(3200);
  const st = await p.evaluate(() => ({
    busy, disabled: document.getElementById("spin").disabled,
    cells: document.querySelectorAll("#reels .sym").length,
  }));
  check("switching game mid-spin does not leave it stuck", !st.busy && !st.disabled,
        `busy=${st.busy} disabled=${st.disabled}`);
  check("the grid survives a mid-spin game switch", st.cells === 20, `${st.cells} cells`);
  check("no runtime errors under money and state", errs.length === 0, errs.slice(0, 3).join(" | "));
  await ctx.close();
}

/* ----------------------------------------------------------------- dialogs */
console.log("\nDialogs and keyboard");
{
  const { p, ctx, errs } = await page();
  await p.click("#infoBtn");
  await p.waitForTimeout(350);
  // nonce, not balance: a spin that wins leaves MORE money than it started
  // with, so any balance comparison here passes or fails on the paytable
  // rather than on the guard being tested. nonce advances once per spin and
  // never moves for a refused one.
  const n0 = await p.evaluate(() => nonce);
  await p.keyboard.press("Space");
  await p.waitForTimeout(900);
  const during = await p.evaluate(() => ({ n: nonce, open: !!document.querySelector(".modal.on") }));
  check("SPACE does not spin while a dialog is open", during.n === n0,
        `nonce ${n0} -> ${during.n}`);
  check("the dialog stays open when space is pressed", during.open);

  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({
    open: !!document.querySelector(".modal.on"), focus: document.activeElement.id }));
  check("Escape closes the dialog", !after.open);
  check("focus returns to the control that opened it", after.focus === "infoBtn", after.focus);

  await p.keyboard.press("Space");
  await p.waitForTimeout(1400);
  const spun = await p.evaluate(() => nonce);
  check("SPACE spins again once the dialog is closed", spun === n0 + 1, `nonce ${n0} -> ${spun}`);
  check("no runtime errors around dialogs", errs.length === 0, errs.slice(0, 3).join(" | "));
  await ctx.close();
}

/* -------------------------------------------------------------------- a11y */
console.log("\nAccessibility");
{
  const { p, ctx } = await page();
  const r = await p.evaluate(() => {
    const inter = [...document.querySelectorAll("button,[role=tab],select,input")]
      .filter((e) => e.offsetParent !== null);
    const modals = [...document.querySelectorAll(".modal")];
    return {
      unnamed: inter.filter((e) => !(e.textContent || "").trim() &&
        !e.getAttribute("aria-label") && !e.getAttribute("title")).length,
      undeclared: modals.filter((m) => m.getAttribute("role") !== "dialog").length,
      unlabelled: modals.filter((m) => !m.getAttribute("aria-label") &&
        !m.getAttribute("aria-labelledby")).length,
      live: !!document.querySelector("[aria-live]"),
    };
  });
  check("every visible control has an accessible name", r.unnamed === 0, `${r.unnamed} unnamed`);
  check("dialogs are declared as dialogs", r.undeclared === 0, `${r.undeclared} undeclared`);
  check("dialogs are labelled", r.unlabelled === 0, `${r.unlabelled} unlabelled`);
  check("wins reach a screen reader through a live region", r.live);
  await ctx.close();
}
{
  // Touch targets are raised only where the pointer is coarse, so this has to
  // run on a device profile -- checking it on desktop would assert the wrong
  // thing and pass for the wrong reason.
  const { p, ctx } = await page({ ...devices["Pixel 5"] });
  const r = await p.evaluate(() => {
    const inter = [...document.querySelectorAll("button,[role=tab],select,input")]
      .filter((e) => e.offsetParent !== null);
    return { coarse: matchMedia("(pointer: coarse)").matches,
             small: inter.filter((e) => e.getBoundingClientRect().height < 40).length,
             total: inter.length };
  });
  check("the device profile really reports a coarse pointer", r.coarse);
  check("touch targets are at least 40px tall on a coarse pointer",
        r.small === 0, `${r.small} of ${r.total} under 40px`);
  await ctx.close();
}

/* ------------------------------------------------------------ anticipation */
// A slot must never tell the player the outcome before it shows it. The
// anticipation used to dim the cabinet and sound its riser at t=0, from a loop
// that read the finished grid -- so two scatters were announced before reel 1
// had stopped. These sample the cabinet over a whole spin and check WHEN it
// lights up, not merely whether it does.
console.log("\nAnticipation");
{
  const { p, ctx } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('[data-game="pride"]').click();
    await sleep(400);
    muted = true;                     // audio is not what is under test here
    const host = document.getElementById("reels");

    // Watch the cabinet for the whole spin, recording the first frame at which
    // anticipation appears and which reel landed by then.
    const run = async (grid) => {
      const seen = [];
      const t0 = performance.now();
      let firstOn = null;
      const obs = setInterval(() => {
        const on = host.classList.contains("anticipating");
        if (on && firstOn === null) firstOn = performance.now() - t0;
        seen.push(on);
      }, 16);
      let scat = 0;
      for (let a = 0; a < 5; a++) for (let b = 0; b < 4; b++) if (grid[a][b] === SCAT) scat++;
      await animateSpin(grid, scat);
      clearInterval(obs);
      return { firstOn, ever: seen.some(Boolean), total: performance.now() - t0 };
    };

    // Filler is M1, NOT P1. It was P1, chosen back when the Crown was an
    // ordinary symbol -- and when the Crown became a stack, a board of P1
    // filler silently became FIVE CROWNED REELS, the strongest anticipation
    // trigger in the game. The "never anticipates" fixture was anticipating
    // for a correct reason the fixture did not mean to assert. These grids
    // exist to test the SCATTER drag in isolation.
    //
    // Two scatters on reels 1-2 -- reel 3 must drag, but only after reel 1 has
    // stopped. Reel 1 lands at 520ms (base), so anything earlier is a spoiler.
    const g = [];
    for (let a = 0; a < 5; a++) { g.push([]); for (let b = 0; b < 4; b++) g[a].push(M1); }
    g[0][0] = SCAT; g[1][0] = SCAT;
    const two = await run(g);

    // No scatters at all: the cabinet must never light up.
    const clean = [];
    for (let a = 0; a < 5; a++) { clean.push([]); for (let b = 0; b < 4; b++) clean[a].push(M1); }
    const none = await run(clean);

    // Three scatters must buy MORE rope than two, or the biggest moment in the
    // game is paced like a smaller one.
    const g3 = JSON.parse(JSON.stringify(g)); g3[2][0] = SCAT;
    const three = await run(g3);
    return { two, none, three };
  });
  check("two scatters do light the cabinet", r.two.ever);
  check("anticipation does not start before the first reel lands",
        r.two.firstOn === null || r.two.firstOn >= 500, `first seen at ${Math.round(r.two.firstOn)}ms`);
  check("a board with no scatters never anticipates", !r.none.ever);
  check("a third scatter drags longer than a second",
        r.three.total > r.two.total + 200,
        `three ${Math.round(r.three.total)}ms vs two ${Math.round(r.two.total)}ms`);
  await ctx.close();
}

/* ---------------------------------------------------------- win roll-up */
// The roll-up ran for a flat 520ms whatever it was counting, so a 2x win and a
// 500x win were celebrated for exactly the same length of time. Its DURATION is
// how a slot tells you how much you won before you have read a digit.
console.log("\nWin roll-up");
{
  const { p, ctx } = await page();
  const r = await p.evaluate(async () => {
    const el = document.getElementById("winOut");
    const time = async (mult) => {
      const t0 = performance.now();
      await countUp(100 * mult, mult, 0);
      return performance.now() - t0;
    };
    muted = true;
    turbo = false;
    const small = await time(2), mid = await time(50), big = await time(500);

    // Skipping must land on the exact total, not wherever the ease had got to.
    const t0 = performance.now();
    const pending = countUp(4321, 500, 3);
    await new Promise((r) => setTimeout(r, 120));
    skipRollup = true;
    await pending;
    const skipped = performance.now() - t0;
    const landed = el.textContent;

    // Turbo has to stay short, or autoplay inherits a three-second roll-up.
    turbo = true;
    const turboBig = await time(500);
    turbo = false;
    return { small, mid, big, skipped, landed, turboBig, want: fmt(4321) };
  });
  check("a bigger win rolls up for longer", r.small < r.mid && r.mid < r.big,
        `2x ${Math.round(r.small)}ms < 50x ${Math.round(r.mid)}ms < 500x ${Math.round(r.big)}ms`);
  check("a big win gets a celebration, not a blink", r.big > 900, `${Math.round(r.big)}ms`);
  // The curve must not saturate early. A small win is the one the player sees
  // hundreds of times a session, and it has to get out of the way.
  check("a small win gets out of the way", r.small < 800, `2x took ${Math.round(r.small)}ms`);
  check("a big win is clearly longer than a mid one", r.big > r.mid * 1.25,
        `500x ${Math.round(r.big)}ms vs 50x ${Math.round(r.mid)}ms`);
  check("the roll-up is capped so a max win cannot stall the game", r.big <= 3400,
        `${Math.round(r.big)}ms`);
  check("a roll-up can be skipped", r.skipped < 400, `took ${Math.round(r.skipped)}ms`);
  check("skipping lands on the exact total", r.landed === r.want,
        `showed ${r.landed}, owed ${r.want}`);
  check("turbo keeps the roll-up short", r.turboBig < 500, `${Math.round(r.turboBig)}ms`);
  await ctx.close();
}

/* ------------------------------------------------ session clock and net */
// Elapsed time and net position have to be visible without the player asking
// for them. Both were tracked in the maths bench and shown nowhere on the
// cabinet, which is the same as not having them.
console.log("\nSession clock and net position");
{
  const { p, ctx } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    muted = true; turbo = true;
    const idle = document.getElementById("sessionClock").textContent;
    // A tab left open is not a session: the clock must not run before a spin.
    await sleep(2200);
    const stillIdle = document.getElementById("sessionClock").textContent;

    document.querySelector('[data-game="traitvault"]').click();
    await sleep(300);
    await doSpin();
    const started = sessionStart;
    await sleep(2200);
    const running = document.getElementById("sessionClock").textContent;

    // Net must come from staked/returned, not from balance drift. Move the
    // balance behind its back and the reported net must not follow.
    const netBefore = document.getElementById("netPos").textContent;
    balance += 50000;
    updateHud();
    const netAfter = document.getElementById("netPos").textContent;
    return { idle, stillIdle, running, started: started !== null,
             netBefore, netAfter,
             agrees: Math.abs((S.returned - S.staked) - netPosition()) < 1e-9,
             signed: /^[+-]|^0$/.test(document.getElementById("netPos").textContent) };
  });
  check("the clock does not run before the first spin", r.stillIdle === r.idle,
        `${r.idle} -> ${r.stillIdle} with no spin`);
  check("the clock starts on the first spin", r.started);
  check("the clock advances while playing", r.running !== r.idle, `now ${r.running}`);
  check("net position is staked vs returned, not balance drift",
        r.netBefore === r.netAfter, `${r.netBefore} -> ${r.netAfter} after a balance top-up`);
  check("net position agrees with the session totals", r.agrees);
  check("net position carries its sign, not just a colour", r.signed, r.netAfter);
  await ctx.close();
}

/* ----------------------------------------------------------------- music */
// The bed was wired to the spin BUTTON only, so pressing SPACE span the reels in
// silence and so did every spin of an autoplay run -- which is how most of a
// session is played. Three entry points, one of them remembering. A benchmark
// that only asked whether startMusic() existed reported this as working.
console.log("\nMusic on every entry point");
{
  const entries = [
    ["the spin button", async (p) => p.click("#spin")],
    ["the space bar", async (p) => p.keyboard.press("Space")],
    ["autoplay", async (p) => p.click("#auto")],
  ];
  for (const [name, act] of entries) {
    const { p, ctx } = await page();
    await act(p);
    await p.waitForTimeout(1300);
    const r = await p.evaluate(() => ({ music: !!music, rhythm: !!rhythm, spins: nonce }));
    check(`${name} starts the music`, r.music && r.rhythm,
          `music=${r.music} rhythm=${r.rhythm} after ${r.spins} spin(s)`);
    check(`${name} actually spins`, r.spins > 0, `${r.spins} spins`);
    await ctx.close();
  }
}

/* ------------------------------------------------------------ rarity swap */
// The swap button tells the player "free -- zero EV". That is a mathematical
// promise on screen, the same class of claim as the house edge, and it is only
// true because payout is 0.97/P(dir) at every position: a redraw cannot move an
// expectation that is 0.97 wherever the card lands. Change the payout rule and
// the button starts lying without anything else looking wrong.
console.log("\nRarity swap");
{
  const { p, ctx } = await page();
  const r = await p.evaluate(async () => {
    const n = RARITY_RANKS;
    // Dead ranks are now DELIBERATE: the sucker-bet refusal (payout <= 1.00x
    // is not offered) leaves ranks 0-3 and 97-100 with no playable direction,
    // and their exit is the free swap. So the invariants shift: every rank
    // that HAS an offer returns the house figure, the dead set is exactly the
    // eight extremes, and the fee stays zero everywhere -- dead ranks
    // included, where a paid swap would be a toll gate on the only door.
    let worstFee = 0, worstEV = 0, deadRanks = [];
    for (let ord = 1; ord <= n; ord++) {
      const f = swapFee(n, ord);
      if (Math.abs(f) > Math.abs(worstFee)) worstFee = f;
      const e = bestAvailableEV(n, ord);
      if (e === 0) deadRanks.push(ord - 1);
      else if (Math.abs(e - HOUSE) > Math.abs(worstEV)) worstEV = e - HOUSE;
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    muted = true;
    document.querySelector('[data-game="hilo"]').click();
    await sleep(450);
    const label = document.getElementById("hlSwapFee").textContent.trim().toLowerCase();
    const card = hl.card, bal = balance;
    document.getElementById("hlSwap").click();
    await sleep(400);
    return { worstFee, worstEV, deadRanks: deadRanks.length, label,
             changed: hl.card !== card, moved: +(balance - bal).toFixed(9), HOUSE };
  });
  check("a swap is free at every rank", Math.abs(r.worstFee) < 1e-12,
        `worst fee ${r.worstFee}`);
  check("every rank with an offer returns the house figure",
        Math.abs(r.worstEV) < 1e-12, `worst deviation ${r.worstEV.toExponential(2)} from ${r.HOUSE}`);
  check("the refused ranks are exactly the eight extremes", r.deadRanks === 8,
        `${r.deadRanks} ranks with no bet on offer`);
  check("the button's promise matches the maths", /zero ev/.test(r.label), r.label);
  check("swapping redraws the card", r.changed);
  check("swapping costs the player nothing", r.moved === 0, `balance moved ${r.moved}`);
  await ctx.close();
}

/* ------------------------------------------------------- commit and reveal */
// The whole "provably fair" claim rests on this loop and nothing exercised it
// end to end -- the pieces had been read, never run. A commitment that does not
// hash the seed actually in play, a seed that does not rotate, or a nonce that
// keeps climbing across seeds would each break the guarantee silently, because
// every individual spin still looks perfectly random.
console.log("\nCommit, reveal, rotate");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    muted = true; turbo = true;
    document.querySelector("details").open = true;
    await sleep(200);

    const committed = document.getElementById("fHash").textContent.trim();
    const seedInPlay = hex(serverSeed);
    const commitIsOfSeedInPlay = committed === hex(sha256(serverSeed));

    for (let i = 0; i < 4; i++) await doSpin();
    const rec = history[history.length - 1];
    const nonceBefore = nonce;

    document.getElementById("fReveal").click();
    await sleep(400);
    const revealed = document.getElementById("fSeed").textContent.trim();
    const bytes = Uint8Array.from(revealed.match(/../g).map((h) => parseInt(h, 16)));
    const out = rederiveRound(rec);

    return {
      commitIsOfSeedInPlay,
      revealedIsTheSeedPlayed: revealed === seedInPlay,
      revealedHashesToCommitment: hex(sha256(bytes)) === committed,
      rotated: hex(serverSeed) !== seedInPlay,
      newCommitMatchesNewSeed:
        document.getElementById("fHash").textContent.trim() === hex(sha256(serverSeed)),
      nonceReset: nonce === 0,
      nonceBefore,
      pastRoundStillVerifies: Math.abs((out.base + out.feature) - rec.mult) < 1e-9,
    };
  });
  check("the published commitment hashes the seed actually in play", r.commitIsOfSeedInPlay);
  check("revealing hands back the seed those spins used", r.revealedIsTheSeedPlayed);
  check("the revealed seed hashes to what was committed", r.revealedHashesToCommitment);
  check("revealing rotates to a fresh seed", r.rotated);
  check("the new commitment matches the new seed", r.newCommitMatchesNewSeed);
  check("the nonce restarts with the new seed", r.nonceReset,
        `was ${r.nonceBefore}, now ${r.nonceReset ? 0 : "not 0"}`);
  check("a round played before the reveal still verifies after it",
        r.pastRoundStillVerifies);
  check("no runtime errors in the fairness flow", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ------------------------------------------- leaving hi/lo mid-round */
// Switching away from Hi/Lo with money on the table stranded it. hl.live stayed
// true, hlRender consulted only hl.live so the cash-out button stayed visible
// on the SLOT deck, and pressing it paid 101.04 out while the player was on
// Pride -- a control from one game, working in another, moving money. A player
// who never went back had a live stake nobody could reach.
console.log("\nLeaving Hi/Lo mid-round");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    muted = true;
    document.querySelector('[data-game="hilo"]').click();
    await sleep(450);
    let t = 0;
    while (!hl.live && t++ < 300) { await hlPick("rarer"); await sleep(8); }
    if (!hl.live) return { err: "no live round" };
    const owed = hl.risk * hl.mult, before = balance;

    document.querySelector('[data-game="pride"]').click();
    await sleep(500);
    const settled = +(balance - before).toFixed(4);
    const visible = getComputedStyle(document.getElementById("cash")).display !== "none";

    // press the stranded control anyway
    const b2 = balance;
    document.getElementById("cash").click();
    await sleep(600);
    return { owed: +owed.toFixed(4), settled, visible, live: hl.live, risk: hl.risk,
             paidOnPride: +(balance - b2).toFixed(4) };
  });
  check("leaving Hi/Lo settles the round", r.live === false && r.risk === 0,
        `live=${r.live} risk=${r.risk}`);
  check("the player is paid what the round was worth",
        Math.abs(r.settled - r.owed) < 1e-6, `settled ${r.settled} against ${r.owed} owed`);
  check("the cash-out control does not follow into a slot game", !r.visible);
  check("pressing it in a slot game pays nothing", r.paidOnPride === 0,
        `paid ${r.paidOnPride}`);
  check("no runtime errors leaving Hi/Lo", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* --------------------------------------------------- hi/lo draw model */
// The cabinet described Hi/Lo as "without replacement", left over from the old
// full-collection card deck. hlDraw excludes only the rank currently showing,
// so every rank already seen stays drawable. The odds on screen are computed
// for that model, so the label was the one part disagreeing with the game --
// and a player reading it would mis-reason about what can come next.
console.log("\nHi/Lo draw model");
{
  const { p, ctx } = await page();
  const r = await p.evaluate(async () => {
    document.querySelector('[data-game="hilo"]').click();
    await new Promise((r) => setTimeout(r, 400));
    const seen = new Map();
    let prev = null, adjacent = 0;
    for (let i = 0; i < 400; i++) {
      const c = hlDraw(prev);
      seen.set(c, (seen.get(c) || 0) + 1);
      if (prev !== null && c === prev) adjacent++;
      prev = c;
    }
    const most = Math.max(...seen.values());
    return { draws: 400, distinct: seen.size, most, adjacent,
             ranks: RARITY_RANKS,
             desc: document.getElementById("gDesc").textContent.toLowerCase() };
  });
  // With replacement, 400 draws over 101 ranks must repeat heavily. Without
  // replacement they could not repeat at all, and the deck would be gone at 101.
  check("ranks recur across draws, so the deck is not exhausted",
        r.most > 1 && r.distinct < r.draws,
        `${r.distinct} distinct in ${r.draws} draws, most-seen ${r.most}x`);
  check("the rank showing is never drawn again immediately", r.adjacent === 0,
        `${r.adjacent} adjacent repeats`);
  check("the cabinet does not claim to draw without replacement",
        !/without replacement/.test(r.desc), r.desc);
  await ctx.close();
}

/* -------------------------------------------------------------- paytable */
// A regression I introduced and would have shipped. Splitting the maned Lions
// into a body plus a mane layer made symbolHTML return TWO elements, and the
// paytable sized ":first-child" -- correct only while a symbol was one element.
// The mane fell through to a width:100% rule and rendered at the width of the
// whole cell: a giant floating mane across the dialog with the symbol names
// driven into the pay columns behind it. Every check I had ran against
// "#reels .sym" and none of them looked at the paytable, so all 107 stayed green.
console.log("\nPaytable");
{
  const { p, ctx, errs } = await page();
  for (const g of ["pride", "cubcluster", "traitvault"]) {
    const r = await p.evaluate(async (g) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      document.querySelector(`[data-game="${g}"]`).click();
      await sleep(400);
      openInfo();
      await sleep(250);
      const modal = document.querySelector(".modal.on").getBoundingClientRect();
      const cells = [...document.querySelectorAll(".ptsym")];
      const imgs = [...document.querySelectorAll(".ptsym img")];
      const boxes = imgs.map((i) => i.getBoundingClientRect());
      const out = {
        rows: cells.length,
        imgs: imgs.length,
        oversized: boxes.filter((b) => b.width > 60 || b.height > 60).length,
        biggest: Math.round(Math.max(0, ...boxes.map((b) => b.width))),
        spilling: cells.filter((c) => c.getBoundingClientRect().right > modal.right + 2).length,
        named: cells.filter((c) => (c.querySelector("span:not(.ptart)") || {}).textContent).length,
      };
      document.querySelector(".modal.on").classList.remove("on");
      return out;
    }, g);
    check(`${g}: the paytable lists its symbols`, r.rows > 0, `${r.rows} rows`);
    check(`${g}: paytable art is thumbnail-sized`, r.oversized === 0 && r.biggest <= 48,
          `${r.imgs} images, biggest ${r.biggest}px`);
    check(`${g}: no paytable row spills out of the dialog`, r.spilling === 0,
          `${r.spilling} spilling`);
    check(`${g}: every paytable row is named`, r.named === r.rows,
          `${r.named}/${r.rows} named`);
  }
  check("no runtime errors in the paytable", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ------------------------------------------------------- playfield centring */
// Trait Vault puts a multiplier rail beside the grid. As a flex item it pushed
// the grid sideways: at 1280 wide Pride sat 183/183 and Trait Vault 221/145, so
// the playfield jumped 38px right when you switched games and stayed lopsided
// for as long as you played that one. A mirrored spacer balances the rail.
console.log("\nPlayfield centring");
{
  for (const w of [1280, 1024, 820]) {
    const { p, ctx } = await page({ viewport: { width: w, height: 920 } });
    const r = await p.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};
      for (const g of ["pride", "traitvault"]) {
        document.querySelector(`[data-game="${g}"]`).click();
        await sleep(400);
        const scr = document.getElementById("screen").getBoundingClientRect();
        const reels = document.getElementById("reels").getBoundingClientRect();
        out[g] = { left: reels.left - scr.left, right: scr.right - reels.right,
                   width: reels.width };
      }
      return out;
    });
    const centred = (v) => Math.abs(v.left - v.right) <= 2;
    check(`${w}px: the grid is centred in the cabinet, rail or no rail`,
          centred(r.pride) && centred(r.traitvault),
          `pride ${Math.round(r.pride.left)}/${Math.round(r.pride.right)}, `
          + `traitvault ${Math.round(r.traitvault.left)}/${Math.round(r.traitvault.right)}`);
    check(`${w}px: the grid does not move when the game changes`,
          Math.abs(r.pride.left - r.traitvault.left) <= 2,
          `moves ${Math.round(Math.abs(r.pride.left - r.traitvault.left))}px`);
    await ctx.close();
  }

  /* The check above measures the GRID, which is exactly why it kept passing
     while the rail hung off the side of the cabinet. cellPx() reserved one rail
     width, but the rail is mirrored by a spacer so the furniture beside the
     reels is TWO -- and on a phone the pair overflowed. At 420px every badge
     started left of the screen and the x25, the widest because it is the
     ceiling, was sliced by a quarter. Found by screenshotting the board rather
     than by any check, which is the third time in this project that has been
     true. */
  for (const [w, h] of [[320, 568], [390, 844], [520, 900]]) {
    const { p, ctx } = await page({ viewport: { width: w, height: h } });
    const r = await p.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      document.querySelector('[data-game="traitvault"]').click();
      await sleep(450);
      const g = []; for (let i = 0; i < 5; i++) g.push([0, 1, 2, 3]);
      await animateSpin(g, 0);
      paintMultRail([0, 3, ROW_MULT_CAP, 0], null, null);   // widest badge on the grid
      await sleep(140);
      const scr = document.getElementById("screen").getBoundingClientRect();
      let worst = 0, which = "";
      for (const bd of document.querySelectorAll("#multRail .mbadge")) {
        const b = bd.getBoundingClientRect();
        if (scr.left - b.left > worst) { worst = scr.left - b.left; which = bd.textContent; }
      }
      const railBox = document.getElementById("multRail").getBoundingClientRect();
      return { worst, which, reserved: railPx(), measured: railBox.width,
               cell: parseFloat(getComputedStyle(document.documentElement)
                                  .getPropertyValue("--cell")) };
    });
    check(`${w}px: no multiplier badge is clipped by the cabinet`, r.worst <= 0.5,
          r.worst > 0.5 ? `${r.which} hangs ${r.worst.toFixed(1)}px past the edge` : "");
    // The reserve lives in JS and the width in CSS. Two copies of one number.
    check(`${w}px: the width cellPx reserves matches the rail actually drawn`,
          Math.abs(r.reserved - r.measured) <= 5,
          `reserves ${r.reserved}px, draws ${r.measured.toFixed(1)}px`);
    check(`${w}px: symbols stay big enough to read`, r.cell >= 30, `${r.cell}px cells`);
    await ctx.close();
  }
}

/* --------------------------------------------------------------- max win */
// The cabinet advertises a maximum win and capWin enforces one, from two
// separate declarations: MAXWIN for the label, CONF[game].cap for the clamp,
// and a bare literal inside hlPick for Hi/Lo. Nothing tied them together. They
// agree today -- this was checked and found correct -- but a promise the game
// will not honour is exactly the fault the fairness verifier had when its copy
// of the strips went stale, and it costs nothing to pin.
console.log("\nMax win");
{
  const { p, ctx } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const rows = [];
    for (const g of ["pride", "cubcluster", "traitvault"]) {
      document.querySelector(`[data-game="${g}"]`).click();
      await sleep(350);
      const shown = +document.getElementById("chipMax").textContent.replace(/[^\d]/g, "");
      // Clamp a deliberately over-cap round and check both the total and that
      // the base/feature split survives -- session RTP is reported off that.
      const cap = CONF[g].cap;
      const o = capWin({ base: cap * 3, feature: cap * 7, fs: true, marks: new Set(), frames: [] }, cap);
      rows.push({ g, shown, MAXWIN: MAXWIN[g], cap,
                  clamped: o.base + o.feature, share: o.base / (o.base + o.feature) });
    }
    document.querySelector('[data-game="hilo"]').click();
    await sleep(350);
    return { rows,
             hiloShown: +document.getElementById("chipMax").textContent.replace(/[^\d]/g, ""),
             hiloLiteral: +((hlPick.toString().match(/>=\s*(\d+)/) || [])[1]) };
  });
  const mismatched = r.rows.filter((x) => !(x.shown === x.cap && x.MAXWIN === x.cap));
  check("the advertised max win is the one the game enforces", mismatched.length === 0,
        mismatched.length ? mismatched.map((x) => `${x.g}: shows ${x.shown}, caps ${x.cap}`).join("; ")
                          : r.rows.map((x) => `${x.g} ${x.cap}`).join(", "));
  check("an over-cap round is clamped to exactly the cap",
        r.rows.every((x) => Math.abs(x.clamped - x.cap) < 1e-6),
        r.rows.map((x) => `${x.g} -> ${x.clamped}`).join(", "));
  check("clamping preserves the base/feature split",
        r.rows.every((x) => Math.abs(x.share - 0.3) < 1e-9), "3:7 stays 3:7");
  check("Hi/Lo's round cap matches the figure on the cabinet",
        r.hiloShown === r.hiloLiteral,
        `cabinet ${r.hiloShown}, code ${r.hiloLiteral}`);
  await ctx.close();
}

/* ------------------------------------------------------------ round replay */
// Clicking a spin in the log re-derives it from (seed, client, nonce). That is
// a fairness feature, so a replay that disagrees with what was paid is worse
// than no replay at all. It reached for the plain spin function regardless of
// how the round had actually been played, and the history record stored no mode
// -- so anything bought or ante-loaded replayed as a different round. Measured
// before the fix: a bought Pride round that paid 5.0971x replayed as 0.1811x,
// and an ante round that paid nothing replayed as 1.4231x.
console.log("\nRound replay");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    muted = true; turbo = true;
    const runs = [];
    const play = async (g, opts) => {
      document.querySelector(`[data-game="${g}"]`).click();
      await sleep(350);
      anteOn = !!opts.ante; buyNext = !!opts.buy;
      await doSpin();
      const rec = history[history.length - 1];
      // The page's OWN derivation, not a copy of it kept here.
      const out = rederiveRound(rec);
      runs.push({ kind: opts.label, real: rec.mult, again: out.base + out.feature,
                  buy: !!rec.buy, ante: !!rec.ante });
      anteOn = false; buyNext = false;
    };
    for (let i = 0; i < 6; i++) {
      await play("pride", { label: "pride" });
      await play("pride", { label: "pride+ante", ante: true });
      await play("pride", { label: "pride buy", buy: true });
      await play("traitvault", { label: "traitvault" });
      await play("traitvault", { label: "traitvault buy", buy: true });
      await play("cubcluster", { label: "cubcluster" });
    }
    const bad = runs.filter((x) => Math.abs(x.real - x.again) > 1e-9);
    const modes = new Set(runs.map((x) => x.kind));
    return { total: runs.length, bad: bad.length, modes: modes.size,
             sample: bad[0] || null,
             recordsMode: runs.some((x) => x.buy) && runs.some((x) => x.ante) };
  });
  check("every recorded round replays to what it paid", r.bad === 0,
        r.sample ? `${r.sample.kind}: paid ${r.sample.real}, replayed ${r.sample.again}`
                 : `${r.total} rounds across ${r.modes} modes`);
  check("the history records how a round was played", r.recordsMode,
        "buy and ante flags present");
  check("enough modes were exercised to mean anything", r.modes >= 5, `${r.modes} modes`);
  check("no runtime errors while replaying", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* --------------------------------------------------------------- hi/lo money */
// hlCash credited the balance, awaited the count-up, and only closed the round
// AFTER the animation finished -- so for the whole length of it the round still
// read as live and every further call paid out again on the same stake. Two
// clicks paid 245.57 against 122.78 owed; ten paid 970 against 97. It scales
// with however many clicks fit in the window.
console.log("\nHi/Lo money");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('[data-game="hilo"]').click();
    await sleep(500);
    muted = true;

    const cashOut = async (clicks) => {
      let tries = 0;
      while (!hl.live && tries++ < 300) { await hlPick("rarer"); await sleep(10); }
      if (!hl.live) return null;
      const owed = hl.risk * hl.mult, before = balance;
      await Promise.all(Array.from({ length: clicks }, () => hlCash()));
      await sleep(400);
      return { owed: +owed.toFixed(4), paid: +(balance - before).toFixed(4) };
    };
    const two = await cashOut(2);
    const ten = await cashOut(10);

    // Every offered bet must return exactly the house figure -- that is the
    // claim the rules text makes, and it is checkable rather than a promise.
    const n = RARITY_RANKS;
    let evWorst = 0, offered = 0;
    for (let card = 1; card <= n; card++) for (const d of ["rarer", "commoner"]) {
      const m = payout(n, card, d);
      if (m == null) continue;
      offered++;
      const q = d === "rarer" ? pRarer(n, card) : pCommoner(n, card);
      evWorst = Math.max(evWorst, Math.abs(q * m - HOUSE));
    }
    // Pinned against what the PLAYER is told, not against itself. Comparing
    // q*payout with HOUSE only proves the formula is consistent with its own
    // constant: changing HOUSE to 0.94 moves both sides and the check stays
    // green while the rules text goes on promising 97%. So read the number out
    // of the rules the player actually sees and require the two to agree.
    openInfo();                       // render the rules the player is shown
    const rules = document.getElementById("infoRules").textContent || "";
    document.getElementById("info").classList.remove("on");
    const quoted = rules.match(/returns exactly\s*(\d+(?:\.\d+)?)\s*%/);
    const stated = quoted ? +quoted[1] / 100 : null;
    return { two, ten, evWorst, offered, HOUSE, live: hl.live, stated,
             rulesSnippet: rules.slice(0, 90) };
  });
  check("a double cash-out pays once", r.two && r.two.paid <= r.two.owed + 0.001,
        r.two ? `paid ${r.two.paid} against ${r.two.owed} owed` : "no live round");
  check("ten cash-outs pay once", r.ten && r.ten.paid <= r.ten.owed + 0.001,
        r.ten ? `paid ${r.ten.paid} against ${r.ten.owed} owed` : "no live round");
  check("the round is closed after cashing out", !r.live);
  check("every offered bet returns exactly the house figure", r.evWorst < 1e-12,
        `${r.offered} offered bets, worst deviation ${r.evWorst.toExponential(2)} from ${r.HOUSE}`);
  check("the house figure is the one the rules promise the player",
        r.stated !== null && Math.abs(r.stated - r.HOUSE) < 1e-9,
        `rules say ${r.stated === null ? "nothing" : (r.stated * 100).toFixed(0) + "%"}, `
        + `code pays ${(r.HOUSE * 100).toFixed(0)}%`);
  check("no runtime errors in the hi/lo money path", errs.length === 0,
        errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* --------------------------------------------------- running feature total */
// The total shown during a tumble chain or a free-spin round was interpolated
// from the frame index: out.feature * (i / (frames.length - 1)). That is a
// fabricated number. With the Cub Cluster ladder paying 1, 2, 3, 5, 8 the real
// accumulation is nothing like a straight line, and a sweep of 4,000 rounds put
// the worst error at 172% -- 44.4 on screen against 16.3 actually won.
console.log("\nRunning feature total");
{
  const { p, ctx } = await page();
  const r = await p.evaluate(() => {
    const pays = PAYS.cubcluster, strips = CONF.cubcluster.strips;
    let worst = 0, detail = null, chains = 0, frames = 0, missing = 0;
    for (let n = 1; n < 2500; n++) {
      const rng = makeRng(new Uint8Array(32).map((_, i) => (i * 31 + n) & 0xff),
                          "c", n, "cubcluster");
      const out = spinCluster(rng);
      if (!out.frames || out.frames.length < 3) continue;
      chains++;
      // Re-derive the truth from the ladder, independently of what was stored.
      const LADDER = [1, 2, 3, 5, 8];
      const rng2 = makeRng(new Uint8Array(32).map((_, i) => (i * 31 + n) & 0xff),
                           "c", n, "cubcluster");
      let grid = drawGrid(strips, rng2), acc = 0, chain = 0, truth = [];
      for (;;) {
        const { total, remove } = clusterFind(grid, pays);
        if (total === 0) { truth.push(acc); break; }
        acc += total * LADDER[Math.min(chain, LADDER.length - 1)];
        truth.push(acc);
        const ng = [];
        for (let r2 = 0; r2 < REELS; r2++) {
          const keep = [];
          for (let row = 0; row < ROWS; row++) if (!remove.has(r2 + ":" + row)) keep.push(grid[r2][row]);
          const need = ROWS - keep.length, fresh = [];
          for (let i = 0; i < need; i++) { const st = strips[r2]; fresh.push(st[rng2.below(st.length)]); }
          ng.push(fresh.concat(keep));
        }
        grid = ng; chain++;
        if (chain > 60) break;
      }
      for (let i = 0; i < out.frames.length && i < truth.length; i++) {
        const w = out.frames[i].won;
        if (w == null) { missing++; continue; }
        frames++;
        const err = Math.abs(w - truth[i]);
        const rel = truth[i] > 0 ? err / truth[i] : (w > 0 ? 1 : 0);
        if (rel > worst) { worst = rel; detail = { n, i, shown: +w.toFixed(3), truth: +truth[i].toFixed(3) }; }
      }
    }
    return { chains, frames, missing, worst: +(worst * 100).toFixed(2), detail };
  });
  check("tumble frames carry what has actually been won", r.missing === 0,
        `${r.missing} frame(s) with no running total`);
  check("the running total matches the real accumulation, not a ramp",
        r.worst < 0.01, `worst error ${r.worst}% over ${r.frames} frames in ${r.chains} chains`
        + (r.detail && r.worst >= 0.01 ? ` (showed ${r.detail.shown}, owed ${r.detail.truth})` : ""));
  check("enough chains were sampled to mean anything", r.chains >= 20, `${r.chains} chains`);
  await ctx.close();
}

/* ------------------------------------------------------------ phone layout */
// play/index.html shipped with NO meta tags at all -- no charset, no viewport --
// while the verifier page next to it has always had them. A phone therefore laid
// the cabinet out in a 980px virtual viewport and scaled the result down, so
// everything was about a third of its designed size and the readouts needed
// pinch-zoom. It also made the touch-target check pass for the wrong reason: 44
// CSS px inside a 980px viewport is roughly 17 physical px on a 393px phone.
//
// With the viewport corrected the real layout problem appeared: 800px of cabinet
// in a 568px screen, with the spin button 155px below the fold. A slot you have
// to scroll to play is not a slot.
console.log("\nPhone layout");
{
  const PHONES = [
    ["Pixel 5", devices["Pixel 5"]],
    ["iPhone 12", devices["iPhone 12"]],
    ["320x568", { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true,
                  deviceScaleFactor: 2, userAgent: devices["iPhone 12"].userAgent }],
  ];
  for (const [name, prof] of PHONES) {
    const { p, ctx } = await page(prof);
    const r = await p.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      const R = (s) => document.querySelector(s).getBoundingClientRect();
      const spin = R("#spin"), reels = R("#reels");
      const games = document.querySelector(".games");
      return {
        vw, vh,
        scaled: vw > 900,                       // the 980px fallback viewport
        reelsFully: reels.top >= 0 && reels.bottom <= vh,
        spinFully: spin.top >= 0 && spin.bottom <= vh,
        hOverflow: document.body.scrollWidth > vw + 1,
        tabsReachable: games.scrollWidth <= games.clientWidth + 1 || games.scrollWidth > 0,
        smallTabs: [...document.querySelectorAll(".tab")]
          .filter((t) => t.getBoundingClientRect().height < 40).length,
      };
    });
    check(`${name}: renders at device width, not a scaled-down 980px page`,
          !r.scaled, `viewport reported as ${r.vw}px wide`);
    check(`${name}: the reels and the spin button are on screen together`,
          r.reelsFully && r.spinFully,
          `reels=${r.reelsFully} spin=${r.spinFully} in ${r.vw}x${r.vh}`);
    check(`${name}: the page does not scroll sideways`, !r.hOverflow);
    check(`${name}: game tabs stay thumb-sized`, r.smallTabs === 0, `${r.smallTabs} under 40px`);
    await ctx.close();
  }
}

/* --------------------------------------------------------- feature music */
// The bed lifts for a feature round -- RHYTHM_BASE_BPM to RHYTHM_FEATURE_BPM,
// compared against the page's own constants -- and has to come back
// down. The interesting case is the abnormal exit: switching game mid-feature
// skips the end of the round, and a tempo left stuck at the feature value would
// play a base game at feature intensity for the rest of the session. This was
// checked and found correct; the test is here so it stays that way.
console.log("\nFeature music");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('[data-game="traitvault"]').click();
    await sleep(400);
    turbo = true;                     // muted:false -- startMusic bails when muted
    buyNext = true;
    const s1 = doSpin();
    await sleep(900);
    const during = { intense: musicIntense, bpm: rhythm ? rhythm.target : null };
    await s1; await sleep(300);
    const after = { intense: musicIntense, bpm: rhythm ? rhythm.target : null };

    buyNext = true;
    const s2 = doSpin();
    await sleep(700);
    const midway = musicIntense;
    document.querySelector('[data-game="pride"]').click();
    await sleep(2500);
    try { await s2; } catch {}
    await sleep(600);
    return { during, after, midway,
             switched: { intense: musicIntense, bpm: rhythm ? rhythm.target : null, busy },
             BASE: RHYTHM_BASE_BPM, FEAT: RHYTHM_FEATURE_BPM };
  });
  check("a feature round lifts the music", r.during.intense && r.during.bpm === r.FEAT,
        `intense=${r.during.intense}, ${r.during.bpm} bpm`);
  check("the music comes back down after the round",
        !r.after.intense && r.after.bpm === r.BASE, `${r.after.bpm} bpm`);
  check("a mid-feature game switch does not strand the tempo",
        r.midway && !r.switched.intense && r.switched.bpm === r.BASE && !r.switched.busy,
        `was intense=${r.midway}, ended at ${r.switched.bpm} bpm, busy=${r.switched.busy}`);
  check("no runtime errors around feature music", errs.length === 0, errs.slice(0, 2).join(" | "));

  // The ARRANGEMENT, not just the tempo. Good-on-repeat is a structure claim:
  // over one 16-bar lap the crowd chants LA-ZY-LI-ONS exactly twice and the
  // roar seals the loop exactly once. Counted by scheduling a full lap through
  // the same scheduler the player hears -- delete the chant from the rotation
  // and this reads 0, make it constant and it reads 4+.
  const lap = await p.evaluate(() => {
    stopRhythm(); stopMusic();
    muted = false; musicIntense = false;
    startRhythm();
    const secsPerLap = (60 / RHYTHM_BASE_BPM / 2) * 8 * 16;
    rhythmScheduleAhead(secsPerLap + 0.2);
    const out = { steps: rhythm.step, ...rhythm.stats };
    stopRhythm();
    return { ...out, expectSteps: 128 };
  });
  check("one lap of the track chants the name exactly twice",
        lap.chants === 2, `${lap.chants} chant(s) in ${lap.steps} steps`);
  check("one lap of the track roars exactly once",
        lap.roars === 1, `${lap.roars} roar(s)`);
  await ctx.close();
}

/* -------------------------------------------------- turbo and reduced motion */
// Turbo and reduced-motion must change only what the player SEES. Both skip a
// lot -- win-line walks, orb flights, the row slam, the specular sweep, the
// feature intro -- and any of that quietly touching an outcome would be a
// fairness problem that no individual spin would reveal, because a turbo spin
// looks perfectly ordinary on its own.
console.log("\nTurbo and reduced motion");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    muted = true;
    const seed = new Uint8Array(32).map((_, i) => (i * 29 + 11) & 0xff);
    const drift = [], results = {};
    for (const g of ["pride", "cubcluster", "traitvault"]) {
      document.querySelector(`[data-game="${g}"]`).click();
      await sleep(350);
      const runs = [];
      for (const t of [false, true]) {
        turbo = t;
        const res = [];
        for (let n = 1; n <= 25; n++) {
          const rng = makeRng(seed, "c", n, g);
          const o = g === "pride" ? spinPride(rng)
                  : g === "cubcluster" ? spinCluster(rng) : spinVault(rng, {});
          res.push(+(o.base + o.feature).toFixed(9));
        }
        runs.push(JSON.stringify(res));
      }
      if (runs[0] !== runs[1]) drift.push(g);
      results[g] = runs[0];
    }
    turbo = false;

    // and end to end, through the real play loop
    document.querySelector('[data-game="traitvault"]').click();
    await sleep(350);
    const paid = {};
    for (const t of [false, true]) {
      turbo = t;
      serverSeed = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
      nonce = 0;
      const b0 = balance;
      for (let i = 0; i < 6; i++) await doSpin();
      paid[t ? "turbo" : "normal"] = +(balance - b0).toFixed(6);
    }
    turbo = false;
    return { drift, paid, results };
  });

  // reduceMotion is read from the media query at load and is a const, so the
  // only honest way to exercise it is to load a page that really has it set.
  const rm = await page({ reducedMotion: "reduce" });
  const under = await rm.p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const seed = new Uint8Array(32).map((_, i) => (i * 29 + 11) & 0xff);
    const out = { on: reduceMotion, results: {} };
    for (const g of ["pride", "cubcluster", "traitvault"]) {
      document.querySelector(`[data-game="${g}"]`).click();
      await sleep(350);
      const res = [];
      for (let n = 1; n <= 25; n++) {
        const rng = makeRng(seed, "c", n, g);
        const o = g === "pride" ? spinPride(rng)
                : g === "cubcluster" ? spinCluster(rng) : spinVault(rng, {});
        res.push(+(o.base + o.feature).toFixed(9));
      }
      out.results[g] = JSON.stringify(res);
    }
    return out;
  });
  await rm.ctx.close();
  const rmDrift = Object.keys(r.results).filter((g) => r.results[g] !== under.results[g]);
  check("turbo and reduced motion do not change any outcome", r.drift.length === 0,
        r.drift.length ? `differs in ${r.drift.join(", ")}` : "25 spins x 3 games identical");
  check("a turbo session pays exactly what a normal one pays",
        r.paid.turbo === r.paid.normal,
        `normal ${r.paid.normal}, turbo ${r.paid.turbo}`);
  check("the reduced-motion profile really reports reduced motion", under.on);
  check("reduced motion does not change any outcome either", rmDrift.length === 0,
        rmDrift.length ? `differs in ${rmDrift.join(", ")}` : "identical across all three games");
  check("no runtime errors under turbo", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ----------------------------------------------------------------- tongue */
// Mouth movement was the last animation I was still calling artist-only, and
// after being wrong three times about exactly that I tested it instead. The
// money tongue is a generative LAYER -- P1 and P2 report the same bounding box
// and the same 1,068 pixels because it is literally the same drawn art -- so it
// lifts like the mane. Unlike the mane it hangs in FRONT, so the gap it leaves
// is painted with mouth-cavity colour rather than hidden behind the head.
console.log("\nMoney tongue");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    muted = true;
    const carry = Object.keys(SYMBOL_ART.default).filter((k) => SYMBOL_ART.default[k].tongueUri);
    // force both onto the board so the check does not depend on a lucky draw
    const g = [];
    for (let a = 0; a < 5; a++) { g.push([]); for (let b = 0; b < 4; b++) g[a].push(a % 2 ? P1 : P2); }
    buildReels(g);
    await sleep(200);
    const els = [...document.querySelectorAll("#reels .sym img.tongue")];
    const seen = new Set();
    for (let i = 0; i < 10; i++) {
      els.forEach((e) => seen.add(getComputedStyle(e).transform));
      await sleep(180);
    }
    const phases = new Set(els.map((e) => getComputedStyle(e).animationDelay));
    const one = els[0], cs = one ? getComputedStyle(one) : null;
    const body = document.querySelector("#reels .sym img:not(.tongue):not(.mane):not(.blink)");
    return { carry, onBoard: els.length, moves: seen.size, phases: phases.size,
             z: cs ? +cs.zIndex : null, bodyZ: body ? +getComputedStyle(body).zIndex : null,
             anim: cs ? cs.animationName : null,
             alt: one ? one.alt : null, hidden: one ? one.getAttribute("aria-hidden") : null,
             pivotSet: !!(one && one.style.transformOrigin) };
  });
  check("the top two symbols carry a tongue layer", r.carry.length === 2, r.carry.join(","));
  check("the tongue moves", r.moves > 3 && r.anim === "loll",
        `${r.moves} distinct transforms, animation ${r.anim}`);
  check("the tongue hangs in front of the body", r.z > r.bodyZ,
        `tongue z${r.z}, body z${r.bodyZ}`);
  check("it pivots where it leaves the mouth, not the tile centre", r.pivotSet);
  check("tongues are not all in step", r.phases > 1, `${r.phases} phases across ${r.onBoard} cells`);
  check("the tongue is not announced to screen readers",
        r.alt === "" && r.hidden === "true");
  check("no runtime errors around the tongue", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ------------------------------------------------------------------ blink */
// I called this impossible twice before building it. The first attempt filled
// the lid with "fur" sampled a few pixels above the eye, hit the black brow
// line every time, and rendered redaction bars -- a sampling bug I read as
// proof the idea could not work. Sampling BETWEEN the eyes, where the pixel is
// guaranteed to be face rather than mane or outline, and adding a curved lash
// line, produces a closed eye that reads as drawn.
//
// Four of twelve carry one. The rest wear shades or goggles, have symbol eyes
// that should not blink, sit behind lenses, or -- the white Sheriff -- were
// tried and rejected because a lid on white fur reads as a grey block.
console.log("\nBlink");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    muted = true;
    const carry = Object.keys(SYMBOL_ART.default).filter((k) => SYMBOL_ART.default[k].blinkUri);
    let frames = 0, maxAtOnce = 0;
    const iv = setInterval(() => {
      const on = document.querySelectorAll("#reels .sym img.blink.on").length;
      if (on > 0) frames++;
      maxAtOnce = Math.max(maxAtOnce, on);
    }, 40);
    await sleep(9000);
    clearInterval(iv);

    // Drive the guard directly rather than hoping a random blink lands inside a
    // spin. Waiting for the coincidence made this check pass with the guard
    // REMOVED -- a short turbo spin almost never overlaps a tick, so it proved
    // nothing either way.
    let duringSpin = 0;
    const spin = doSpin();
    for (let i = 0; i < 40 && busy; i++) {
      blinkOnce();
      duringSpin += document.querySelectorAll("#reels .sym img.blink.on").length;
      await sleep(25);
    }
    await spin;

    // Read the layer LAST, from whatever is on the board now. Holding a
    // reference across the wait measured a node the reels had since replaced,
    // and a detached element reports the initial value for everything -- so
    // this check read z-index 0 off an element that was never on screen.
    const layer = document.querySelector("#reels .sym img.blink");
    const cs = layer ? getComputedStyle(layer) : null;
    return { carry, layers: document.querySelectorAll("#reels .sym img.blink").length,
             frames, maxAtOnce, duringSpin,
             z: cs ? +cs.zIndex : null, hidden: layer ? layer.getAttribute("aria-hidden") : null,
             alt: layer ? layer.alt : null,
             firstImgIsBody: (() => {
               const c = document.querySelector("#reels .sym");
               const first = c && c.querySelector("img");
               return !!first && !first.classList.contains("blink")
                      && !first.classList.contains("mane");
             })() };
  });
  check("some symbols carry a closed-eye layer", r.carry.length >= 3, r.carry.join(","));
  check("the blink layer sits above the body", r.z >= 2, `z-index ${r.z}`);
  check("lions do blink", r.frames > 0, `${r.frames} sampled frames with an eye shut`);
  check("they do not blink in unison", r.maxAtOnce <= 1, `${r.maxAtOnce} at once`);
  check("no blinking while the reels are moving", r.duringSpin === 0, `${r.duringSpin} frames`);
  check("the blink layer is not announced to screen readers",
        r.alt === "" && r.hidden === "true");
  check("the body image is still the one carrying the symbol name", r.firstImgIsBody);
  check("no runtime errors around blinking", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ------------------------------------------------------- secondary motion */
// The mane ships as its own layer so it can lag the roar. Four earlier attempts
// at motion inside the outline DEFORMED the art and sheared the muzzle; this one
// separates a layer and moves it rigidly. The things that can go wrong are
// specific: the mane drawn in front of the face, announced twice to a screen
// reader, or missing from the spinning reel because the canvas draws one image
// per cell and the base alone is a lion with its mane cut out.
console.log("\nSecondary motion (mane)");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    muted = true;
    // PRIDE, not Trait Vault: the vault now carries its own twelve without
    // mane layers (measured-not-assumed -- each layer needs per-token declared
    // colours), so the layered set this test exercises only renders in Pride.
    // On the vault board the first cell had no mane at all and the test
    // crashed reading a style off null.
    document.querySelector('[data-game="pride"]').click();
    await sleep(400);

    const withMane = Object.keys(SYMBOL_ART.default)
      .filter((k) => SYMBOL_ART.default[k].maneUri);

    const g = [];
    for (let a = 0; a < 5; a++) { g.push([]); for (let b = 0; b < 4; b++) g[a].push(P1); }
    buildReels(g);
    const cell = document.querySelector("#reels .sym");
    const mane = cell.querySelector("img.mane");
    const body = cell.querySelector("img:not(.mane)");
    cell.classList.add("pop");
    const cs = getComputedStyle(mane);
    const seen = [];
    for (let i = 0; i < 8; i++) { seen.push(getComputedStyle(mane).transform); await sleep(70); }

    // The canvas draws ONE image per cell, so a split symbol must be recomposed
    // or the reel spins mane-less lions.
    warmSymbolImages("traitvault");
    await sleep(900);
    const composed = symbolImage(P1, "traitvault");
    // Counting opaque pixels, not just checking that AN image loaded. The first
    // version of this check asked only whether the returned image had decoded,
    // which the mane-less base satisfies perfectly -- so it passed while the
    // reel spun lions with their manes cut out. Compare the composed image
    // against the base: the mane is roughly a fifth of the tile, so if it is
    // present the opaque area is materially larger.
    const opaqueOf = (src) => new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 120;
        const cx = cv.getContext("2d");
        cx.drawImage(im, 0, 0, 120, 120);
        const d = cx.getImageData(0, 0, 120, 120).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        res(n);
      };
      im.onerror = () => res(-1);
      im.src = src;
    });
    const baseOpaque = await opaqueOf(SYMBOL_ART.default.P1.uri);
    const drawnOpaque = composed ? await opaqueOf(composed.src) : -1;

    return {
      count: withMane.length, syms: withMane.join(","),
      anim: cs.animationName, maneZ: +cs.zIndex, bodyZ: +getComputedStyle(body).zIndex,
      moves: new Set(seen).size,
      alt: mane.alt, hidden: mane.getAttribute("aria-hidden"),
      firstImgIsBody: cell.querySelector("img").alt === symName(P1, "pride"),
      composed: !!(composed && composed.complete && composed.naturalWidth > 0),
      baseOpaque, drawnOpaque,
    };
  });
  check("some symbols ship a separate mane layer", r.count >= 4, `${r.count}: ${r.syms}`);
  check("the mane sits behind the body", r.maneZ < r.bodyZ, `mane z${r.maneZ}, body z${r.bodyZ}`);
  check("the mane swings on a win", r.anim === "maneSwing" && r.moves > 3,
        `${r.anim}, ${r.moves} distinct transforms`);
  check("the mane is not announced to screen readers", r.alt === "" && r.hidden === "true");
  check("the body image still carries the symbol name", r.firstImgIsBody);
  check("the spinning reel draws a whole lion, not a base with its mane cut out",
        r.composed && r.drawnOpaque > r.baseOpaque * 1.1,
        `composed covers ${r.drawnOpaque}px vs a bare base's ${r.baseOpaque}px`);
  check("no runtime errors around the mane layer", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ------------------------------------------------- row multiplier heat */
/* The rail says x25 and the grid has to say it too. This was binary before --
   a x2 row and a x25 row were painted identically -- which made the rail an
   annotation rather than a description of something visible.

   Proven falsifiable by two separate corruptions, and the second is the whole
   reason these checks read a screenshot:

     heat pinned to 1 in paintMultRail   3 red: the scale check, the resolved
                                         style check, and the pixel comparison
                                         (x25 69.7 vs x2 70.1 -- identical)
     CSS reverted to the flat plate      2 red: resolved style and pixels. Every
                                         DOM-side check stayed GREEN, reporting a
                                         perfectly correct --heat of 0.215 -> 1
                                         that nothing was painting with.

   A check that had only asked the DOM what it intended to draw would have passed
   the second one, which is a build where the feature is entirely absent from the
   screen. */
console.log("\nRow multiplier heat");
{
  const { p, ctx, errs } = await page();
  const setup = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('[data-game="traitvault"]').click();
    await sleep(450);
    const rng = makeRng(new Uint8Array(32).map((_, i) => (i * 5 + 1) & 0xff), "c", 3, "traitvault");
    await animateSpin(drawGrid(CONF.traitvault.strips, rng), 0);
    // row 0 plain, row 1 at the smallest multiplier, row 3 at the ceiling
    paintMultRail([0, 2, 0, ROW_MULT_CAP], null, null);
    await sleep(120);
    const cells = [...document.getElementById("reels").children[2].querySelectorAll(".sym")];
    const read = (row) => {
      const cs = getComputedStyle(cells[row], "::before");
      return {
        hot: cells[row].classList.contains("hotrow"),
        heat: +getComputedStyle(cells[row]).getPropertyValue("--heat"),
        border: cs.borderColor,
        // Computed box-shadow puts the colour first and the outer glow last, so
        // rather than pattern-match a shadow list, take the widest length in it:
        // the outer blur is the largest by construction (16..38px vs an 18px inset).
        blur: Math.max(...[...cs.boxShadow.matchAll(/(-?[\d.]+)px/g)].map((m) => +m[1])),
      };
    };
    for (let r = 0; r < 4; r++) cells[r].dataset.heatProbe = r;
    return { cap: ROW_MULT_CAP, plain: read(0), low: read(1), top: read(3) };
  });

  const shot = async (row) =>
    warmth(pngPixels(await p.locator(`[data-heat-probe="${row}"]`).screenshot({ type: "png" })));
  const wPlain = await shot(0), wLow = await shot(1), wTop = await shot(3);

  check("a multiplied row is marked hot and a plain one is not",
        setup.low.hot && setup.top.hot && !setup.plain.hot);
  check("heat rises with the multiplier",
        setup.top.heat > setup.low.heat + 0.2 && setup.low.heat > 0,
        `x2 -> ${setup.low.heat}, x${setup.cap} -> ${setup.top.heat}`);
  check("the ceiling row tops the scale out", Math.abs(setup.top.heat - 1) < 1e-6,
        `${setup.top.heat}`);
  check("the plate and glow resolve differently at the two multipliers",
        setup.low.border !== setup.top.border && setup.top.blur > setup.low.blur,
        `${setup.low.border} @${setup.low.blur}px vs ${setup.top.border} @${setup.top.blur}px`);
  check("a multiplied row is visibly hotter than a plain one",
        wLow > wPlain + 8, `x2 reads ${wLow.toFixed(1)} vs plain ${wPlain.toFixed(1)}`);
  check("the ceiling row is visibly hotter than the smallest multiplier",
        wTop > wLow + 8, `x${setup.cap} reads ${wTop.toFixed(1)} vs x2 ${wLow.toFixed(1)}`);
  check("no runtime errors painting the rail", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ------------------------------------------------------------- symbol art */
/* A symbol has to be an OBJECT on the reel, not a photograph pasted onto it.
   Every Cub Cluster tile shipped as an opaque square: build_tile decided the
   source art was "already cut out" by reading the alpha of a canvas it had
   just padded itself, and the Cub character box is never square, so the padding
   alone tripped it and keying was skipped for all four. Measured here on the
   tiles the page actually carries, decoded in the browser, because that is the
   thing that reaches a player -- symbols.json can say anything. */
console.log("\nSymbol art");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const opacityOf = (uri) => new Promise((done) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let opaque = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 200) opaque++;
        done(opaque / (c.width * c.height));
      };
      img.onerror = () => done(-1);
      img.src = uri;
    });
    const out = { groups: {}, cubPremiums: [], oneofone: 0 };
    for (const group of ["default", "cubcluster"]) {
      out.groups[group] = [];
      for (const [sid, rec] of Object.entries(SYMBOL_ART[group] || {})) {
        if (!rec || !rec.uri) continue;
        out.groups[group].push({ sid, token: rec.tokenId, region: rec.region,
                                 opaque: await opacityOf(rec.uri) });
        if (rec.region === "oneofone") out.oneofone++;
      }
    }
    for (const sid of ["P1", "P2"]) {
      const rec = SYMBOL_ART.cubcluster[sid];
      if (rec) out.cubPremiums.push({ sid, token: rec.tokenId, region: rec.region });
    }
    return out;
  });

  for (const [group, tiles] of Object.entries(r.groups)) {
    const solid = tiles.filter((t) => t.opaque > 0.93);
    const broken = tiles.filter((t) => t.opaque < 0);
    check(`${group}: every tile decodes`, broken.length === 0,
          broken.map((t) => t.sid).join(","));
    check(`${group}: no tile is a solid square with its background baked in`,
          solid.length === 0,
          solid.map((t) => `${t.sid} #${t.token} ${t.opaque.toFixed(3)}`).join(", "));
  }
  // The 1/1s are struck as discs, so they sit near pi/4 of the tile by
  // construction. Well clear of a square, and well clear of a keyed cut-out.
  const coins = r.groups.cubcluster.filter((t) => t.region === "oneofone");
  check("Cub Cluster's premiums are the two 1/1s",
        r.cubPremiums.length === 2
          && r.cubPremiums.every((c) => c.region === "oneofone")
          && new Set(r.cubPremiums.map((c) => c.token)).size === 2
          && r.cubPremiums.every((c) => [32010, 2195].includes(c.token)),
        r.cubPremiums.map((c) => `${c.sid} #${c.token} ${c.region}`).join(", "));
  check("a struck 1/1 covers about a disc's worth of its tile",
        coins.length === 2 && coins.every((c) => c.opaque > 0.66 && c.opaque < 0.80),
        coins.map((c) => c.opaque.toFixed(3)).join(", "));
  check("no runtime errors reading the symbol art", errs.length === 0,
        errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ---------------------------------------------------- production distinctness */
/* Three slots means three GAMES, and until this pass Pride and Trait Vault
   shipped the same twelve Lions -- one game wearing two colour schemes. The
   vault now carries its own set; these checks hold the two apart, verify the
   tumble ladder made it onto the screen, and confirm a feature closes with a
   total card the way every shipped bonus does. */
console.log("\nProduction distinctness");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ids = ["P1","P2","P3","P4","M1","M2","M3","M4","L1","L2","L3","L4"];
    const tv = SYMBOL_ART.traitvault || {};
    const shared = ids.filter(id => !tv[id] || tv[id].uri === SYMBOL_ART.default[id].uri);
    const tvTokens = new Set(ids.map(id => tv[id] && tv[id].tokenId));
    const prideTokens = new Set(ids.map(id => SYMBOL_ART.default[id].tokenId));
    const tokenOverlap = [...tvTokens].filter(t => prideTokens.has(t));

    // the tumble ladder: rungs from the single shared constant, correct
    // lit/done state, and absent outside Cub Cluster
    document.querySelector('[data-game="cubcluster"]').click();
    await sleep(450);
    paintTumbleLadder(2);
    const el = document.getElementById("tumbleLadder");
    const rungs = [...el.children].map(c => c.textContent);
    const lit = [...el.children].map(c => c.classList.contains("live") ? "L"
                 : c.classList.contains("done") ? "d" : ".").join("");
    const shownInCluster = !el.classList.contains("hidden");
    document.querySelector('[data-game="pride"]').click();
    await sleep(450);
    paintTumbleLadder(0);   // must refuse: wrong game
    const hiddenInPride = el.classList.contains("hidden");

    // the feature-end card: buy a Trait Vault round and watch the banner
    document.querySelector('[data-game="traitvault"]').click();
    await sleep(450);
    // The ending is ONE card. It used to be up to three banners -- "Feature
    // total", a tier banner and "Feature complete" -- each counting the same
    // money again.
    turbo = true; muted = true; buyNext = true;
    const seen = [], outros = new Set();
    let outroGone = false, bannerAfterOutro = false;
    const iv = setInterval(() => {
      const on = document.getElementById("banner").classList.contains("on");
      const t = document.getElementById("bannerBig").textContent;
      if (on && t && !seen.includes(t)) seen.push(t);
      const o = document.querySelector(".roundcard.outro");
      if (o) outros.add(o);
      if (outros.size && !o) outroGone = true;
      if (outroGone && on) bannerAfterOutro = true;
    }, 40);
    await doSpin();
    clearInterval(iv);
    const outro = [...outros][0];
    const rec = history[history.length - 1];
    return { shared, tokenOverlap, rungs, lit, shownInCluster, hiddenInPride,
             banners: seen, outros: outros.size, bannerAfterOutro,
             kicker: outro ? outro.querySelector(".rc-kick").textContent : "",
             outroAmount: outro ? +outro.dataset.amount : null, owed: Math.round(rec.win) };
  });
  check("Trait Vault's twelve are all its own art", r.shared.length === 0,
        r.shared.join(",") || "12/12 distinct");
  check("no token appears in both Pride and Trait Vault", r.tokenOverlap.length === 0,
        r.tokenOverlap.join(","));
  check("the tumble ladder shows the real rungs",
        r.shownInCluster && r.rungs.join(",") === "×1,×2,×3,×5,×8",
        r.rungs.join(","));
  check("the ladder lights the live rung and marks the climbed ones",
        r.lit === "ddL..", r.lit);
  check("the ladder does not leak into other games", r.hiddenInPride);
  check("a feature closes with exactly one total card",
        r.outros === 1 && /complete/i.test(r.kicker),
        `${r.outros} closing card(s), "${r.kicker}"`);
  check("the closing card shows what the feature paid", r.outroAmount === r.owed,
        `card ${r.outroAmount} vs paid ${r.owed}`);
  check("no tier banner follows the closing card", !r.bannerAfterOutro,
        `banners: ${r.banners.join(" | ") || "none"}`);
  check("no runtime errors around distinctness", errs.length === 0,
        errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ------------------------------------------------------- round presentation */
/* The round is PLAYED, not replayed. Each check below fails on the play loop it
   replaced: free spins were board swaps on a 300ms timer, tumbles repainted all
   twenty cells, a big win was counted two to four times, the banner fired
   before the board showed what won, a 0.3x return got a chime, and the bonus
   screens dismissed themselves. */
console.log("\nRound presentation");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    muted = true;
    let spins = 0;
    const oSpin = animateSpin;
    animateSpin = async (...a) => { spins++; return oSpin(...a); };
    const out = {};

    // 1. every free spin lands on spinning reels
    for (const g of ["pride", "traitvault"]) {
      document.querySelector(`[data-game="${g}"]`).click(); await sleep(300);
      turbo = true; buyNext = true;
      const s0 = spins; await doSpin();
      out["fs_" + g] = spins - s0;
    }

    // 2. a tumble moves only the cells that change. Column 1 loses rows 1-2
    //    (one survivor falls two rows, one stays put, two refill); column 4
    //    loses its bottom row (three survivors fall one row, one refills).
    //    Columns 2, 3 and 5 must not be touched at all.
    turbo = false;
    document.querySelector('[data-game="cubcluster"]').click(); await sleep(300);
    const grid = [];
    for (let c = 0; c < 5; c++) grid.push([L1, L2, M1, M2].map((s, i) => [L1, L2, M1, M2][(i + c) % 4]));
    buildReels(grid);
    const marks = new Set(["0:1", "0:2", "3:3"]);
    const next = grid.map((col, c) => {
      const keep = col.filter((_, row) => !marks.has(c + ":" + row));
      const fresh = Array(4 - keep.length).fill(P1);
      return fresh.concat(keep);
    });
    const before = [...document.getElementById("reels").children].map(r => [...r.querySelectorAll(".sym")]);
    const moved = await animateTumble(marks, next);
    const after = [...document.getElementById("reels").children].map(r => [...r.querySelectorAll(".sym")]);
    let untouched = 0, wrong = 0;
    for (const c of [1, 2, 4]) for (let row = 0; row < 4; row++) if (before[c][row] === after[c][row]) untouched++;
    for (let c = 0; c < 5; c++) for (let row = 0; row < 4; row++) {
      const img = after[c][row].querySelector("img");
      const want = symName(next[c][row], "cubcluster");
      if (img && img.alt !== want) wrong++;
    }
    const stayed = before[0][3] === after[0][3];
    out.tumble = { moved, untouched, wrong, stayed };

    // 3. one count-up per result, and the board explains a big win first
    serverSeed = new Uint8Array(32).map((_, i) => (i * 13 + 5) & 0xff);
    const client = document.getElementById("fClient").value;
    const find = (pred, g = "cubcluster") => {
      for (let n = 1; n < 6000; n++) {
        const rng = makeRng(serverSeed, client, n, g);
        const o = g === "cubcluster" ? spinCluster(rng) : spinVault(rng, {});
        if (pred(o)) return n;
      }
      return -1;
    };
    const bet = +document.getElementById("bet").value;
    const play = async (n) => {
      nonce = n - 1;
      const c0 = countUps, chimes = { n: 0 };
      const oChime = winChime, oCoins = coins;
      winChime = (...a) => { chimes.n++; return oChime(...a); };
      coins = (...a) => { chimes.n++; return oCoins(...a); };
      let floatAt = null, bannerAt = null; const t0 = performance.now();
      const iv = setInterval(() => {
        if (floatAt === null && document.querySelector("#screen .floatwin")) floatAt = performance.now() - t0;
        if (bannerAt === null && document.getElementById("banner").classList.contains("on")) bannerAt = performance.now() - t0;
      }, 20);
      await doSpin();
      clearInterval(iv);
      winChime = oChime; coins = oCoins;
      const rec = history[history.length - 1];
      return { countUps: countUps - c0, chimes: chimes.n, floatAt, bannerAt,
               mult: rec.mult, readout: document.getElementById("winOut").textContent, owed: fmt(rec.win) };
    };
    turbo = true;
    const nZero = find(o => o.base + o.feature === 0);
    const nSmall = find(o => { const m = o.base + o.feature; return m > 1.2 && m < 10; });
    // Cub Cluster's smallest cluster pays about 2x, so it never returns less
    // than the stake; Trait Vault's two-of-a-kind lines do, all the time.
    const nQuiet = find(o => { const m = o.base + o.feature; return m >= 0.25 && m <= 1 && !o.fs; }, "traitvault");
    const nBig = find(o => o.base + o.feature >= 20 && o.frames.length >= 3);
    out.zero = await play(nZero);
    out.small = await play(nSmall);
    out.big = await play(nBig);
    document.querySelector('[data-game="traitvault"]').click(); await sleep(300);
    out.quiet = await play(nQuiet);
    out.nums = { nZero, nSmall, nQuiet, nBig };
    turbo = false;
    return out;
  });
  check("every Pride free spin lands on spinning reels", r.fs_pride === 10, `${r.fs_pride} reel spins for 10 free spins`);
  check("every Lion's Share free spin lands on spinning reels", r.fs_traitvault === 10,
        `${r.fs_traitvault} reel spins for 10 free spins`);
  check("a tumble moves exactly the cells that change", r.tumble.moved === 7, `${r.tumble.moved} moved, 7 change`);
  check("columns the tumble did not touch keep their cells", r.tumble.untouched === 12,
        `${r.tumble.untouched}/12 cells kept`);
  check("a survivor with nothing cleared beneath it does not move", r.tumble.stayed);
  check("the board after the tumble is the engine's board", r.tumble.wrong === 0, `${r.tumble.wrong} cells differ`);
  check("a losing spin counts nothing", r.zero.countUps === 0 && r.zero.chimes === 0,
        `${r.zero.countUps} count-up(s), ${r.zero.chimes} chime(s)`);
  check("a winning spin counts up exactly once", r.small.countUps === 1,
        `${r.small.countUps} count-ups for a ${r.small.mult.toFixed(2)}x win`);
  check("a tumble chain counts up exactly once", r.big.countUps === 1,
        `${r.big.countUps} count-ups for a ${r.big.mult.toFixed(2)}x chain`);
  check("the board shows the win before the big-win screen",
        r.big.floatAt !== null && (r.big.bannerAt === null || r.big.floatAt < r.big.bannerAt),
        `amount over the winners at ${Math.round(r.big.floatAt)}ms, banner at ${Math.round(r.big.bannerAt)}ms`);
  check("the fixtures were all found", Object.values(r.nums).every(n => n > 0), JSON.stringify(r.nums));
  check("a return at or below the stake is not celebrated",
        r.quiet.mult >= 0.25 && r.quiet.countUps === 0 && r.quiet.chimes === 0 && r.quiet.readout === r.quiet.owed,
        `${r.quiet.mult.toFixed(2)}x: ${r.quiet.countUps} count-up(s), ${r.quiet.chimes} chime(s), readout ${r.quiet.readout}`);
  check("the readout ends on the exact round total", r.small.readout === r.small.owed && r.big.readout === r.big.owed,
        `${r.small.readout}/${r.small.owed}, ${r.big.readout}/${r.big.owed}`);
  check("no runtime errors in the play loop", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* The win ladder and the bonus screens, at real speed. */
console.log("\nWin ladder and bonus screens");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    muted = true; turbo = false;
    const out = {};
    document.querySelector('[data-game="traitvault"]').click(); await sleep(300);
    const bet = 100, amount = 75 * bet;

    // the label upgrades in order while the count climbs; one press lands the
    // exact total, a second press closes the screen
    busy = true;
    const labels = [];
    const iv = setInterval(() => {
      const t = document.getElementById("bannerBig").textContent;
      if (t && labels[labels.length - 1] !== t) labels.push(t);
    }, 30);
    const c0 = countUps;
    const job = bigWin(amount, { bet, stake: bet, shown: 0 });
    await sleep(4300);
    const midLabels = labels.slice();
    press();
    await sleep(150);
    out.skipped = document.getElementById("bannerAmt").textContent;
    out.topLabel = document.getElementById("bannerBig").textContent;
    press();
    const tClose = performance.now();
    await job;
    out.closeMs = performance.now() - tClose;
    clearInterval(iv);
    busy = false;
    out.midLabels = midLabels; out.want = fmt(amount); out.countUps = countUps - c0;

    // the intro waits for the player in manual play...
    SCREEN_WAIT_MS = Infinity;
    buyNext = true;
    const spin = doSpin();
    let cardAt = null; const t0 = performance.now();
    while (performance.now() - t0 < 5000 && !document.querySelector(".roundcard")) await sleep(40);
    cardAt = performance.now() - t0;
    await sleep(3500);
    out.stillWaiting = !!document.querySelector(".roundcard");
    press();
    await sleep(700);
    out.closedOnPress = !document.querySelector(".roundcard:not(.out)");
    // ...and leaving mid-bonus still pays the round in full
    const b0 = balance;
    await sleep(1200);
    document.querySelector('[data-game="pride"]').click();
    await spin;
    const rec = history[history.length - 1];
    out.settled = { paid: +(balance - b0).toFixed(6), owed: +rec.win.toFixed(6), busy };
    out.cardAt = cardAt;

    // in turbo the screens close themselves after about three seconds
    document.querySelector('[data-game="traitvault"]').click(); await sleep(300);
    turbo = true; buyNext = true;
    let seenAt = null, goneAt = null; const t1 = performance.now();
    const iv2 = setInterval(() => {
      const c = document.querySelector(".roundcard:not(.out)");
      if (c && seenAt === null) seenAt = performance.now() - t1;
      if (!c && seenAt !== null && goneAt === null) goneAt = performance.now() - t1;
    }, 25);
    await doSpin();
    clearInterval(iv2);
    turbo = false; SCREEN_WAIT_MS = 60;
    out.turboIntroMs = goneAt - seenAt;
    return out;
  });
  const order = ["Big win", "Mega win", "Superb win", "Epic win"];
  check("the big-win label climbs the tiers in order",
        r.midLabels.length >= 2 && r.midLabels.every((t, i) => t === order[i]),
        r.midLabels.join(" > "));
  check("one press lands the exact total on the top tier", r.skipped === r.want && r.topLabel === "Epic win",
        `${r.skipped} "${r.topLabel}", owed ${r.want}`);
  check("a second press closes the big-win screen", r.closeMs < 400, `${Math.round(r.closeMs)}ms`);
  check("a big win is one count-up", r.countUps === 1, `${r.countUps}`);
  check("the bonus intro waits for the player in manual play", r.stillWaiting,
        `card up at ${Math.round(r.cardAt)}ms, still waiting 3.5s later: ${r.stillWaiting}`);
  check("a press dismisses the bonus intro", r.closedOnPress);
  check("leaving mid-bonus still pays the round in full",
        Math.abs(r.settled.paid - r.settled.owed) < 1e-6 && !r.settled.busy,
        `paid ${r.settled.paid}, owed ${r.settled.owed}, busy=${r.settled.busy}`);
  check("in turbo the bonus intro closes itself after about 3s",
        r.turboIntroMs > 2500 && r.turboIntroMs < 4200, `${Math.round(r.turboIntroMs)}ms`);
  check("no runtime errors at the bonus screens", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* -------------------------------------------------------- Hi/Lo presentation */
/* Two fixes that only a browser can verify: a bust must LOOK like a bust (it
   was a 1.4s chip flash while a 7x pot vanished), and a history tile for a
   rank with no owned Lion must show the card back (it rendered a number
   floating over a hole). The loss is forced by stubbing the draw -- function
   declarations are writable globals in a classic script. */
console.log("\nHi/Lo presentation");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('[data-game="hilo"]').click();
    await sleep(500);
    const realDraw = hlDraw;
    try {
      // A mid-rank card, then a guaranteed-wrong pick: card 50, next card 1.
      hl.card = 50; hl.live = false; hl.mult = 1; hlRender();
      hlDraw = () => 1;
      $("winOut").textContent = "7,777";        // stale WIN from a slot spin
      await hlPick("rarer");                    // next=1 < 50: wrong
      await sleep(150);
      const bustShown = $("hlCard").classList.contains("bust");
      const winReset = $("winOut").textContent;
      const flashText = $("chipMode").textContent;
      // History back-tile: a wrong entry whose rank has no owned art.
      hl.hist.push({ card: 2, dir: "commoner", correct: true, art: null });
      hlRender();
      const tiles = [...document.querySelectorAll("#hlHist .h")];
      const last = tiles[tiles.length - 1];
      return { bustShown, winReset, flashText,
               backTile: !!(last && last.querySelector(".back")),
               tileCount: tiles.length };
    } finally { hlDraw = realDraw; }
  });
  check("a bust marks the card, not just the chip", r.bustShown);
  check("a bust resets the WIN readout", r.winReset === "0", `reads "${r.winReset}"`);
  check("the bust message says what was lost", /Bust/.test(r.flashText), r.flashText);
  check("a history card with no owned art shows the card back",
        r.backTile, `${r.tileCount} tiles, last has back=${r.backTile}`);
  check("no runtime errors in Hi/Lo", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ------------------------------------------------- Pride: the Lion's Crown */
/* Pride funds a Lazy Lion NFT by returning 0.87 in coins instead of 0.97, and
   pays it for a board full of Crowns. Two things have to hold or the whole
   mechanic is a lie: the Crown must never appear as a loose single symbol (it
   carries no strip weight -- it only ever arrives as a full reel), and the draw
   sequence must match the Rust and the standalone verifier EXACTLY, because a
   single extra or missing draw shifts every number after it and /verify would
   tell an honest player their spin did not reproduce. */
console.log("\nPride: the Lion's Crown");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    document.querySelector('[data-game="pride"]').click();
    await new Promise((r) => setTimeout(r, 450));

    // 1. No loose Crowns anywhere on the strips.
    const looseWeight = CONF.pride.w.map((reel) => reel[P1]);
    const onStrip = CONF.pride.strips.reduce(
      (n, st) => n + st.filter((x) => x === P1).length, 0);

    // 2. Over many spins, every Crown seen is part of a full column of four.
    const seed = new Uint8Array(32).map((_, i) => (i * 13 + 5) & 0xff);
    let crownCells = 0, crownReels = 0, partial = 0, nftRounds = 0, totalReels = 0, spins = 6000;
    for (let n = 0; n < spins; n++) {
      const out = spinPride(makeRng(seed, "crown", n, "pride"));
      if (out.nft) nftRounds++;
      for (const f of out.frames) {
        for (let reel = 0; reel < REELS; reel++) {
          let c = 0;
          for (let row = 0; row < ROWS; row++) if (f.grid[reel][row] === P1) c++;
          crownCells += c;
          if (c === ROWS) crownReels++;
          else if (c > 0) partial++;
          totalReels++;
        }
      }
    }

    // 3. Draw-order parity: the number of RNG values a Pride grid consumes must
    //    be fixed at two per reel whether or not any reel crowns.
    const count = (nonce) => {
      const rng = makeRng(seed, "count", nonce, "pride");
      let used = 0;
      const wrapped = { below: (n) => { used++; return rng.below(n); } };
      drawGridPride(CONF.pride.strips, wrapped);
      return used;
    };
    const draws = new Set();
    for (let n = 0; n < 400; n++) draws.add(count(n));

    // 4. A crowned board must survive the max-win cap.
    const capped = capWin({ base: 5000, feature: 0, fs: false, marks: new Set(),
                            frames: [], nft: true }, CONF.pride.cap);

    return { looseWeight, onStrip, crownCells, crownReels, partial, nftRounds, spins, totalReels, rows: ROWS,
             draws: [...draws], cappedKeepsNft: !!capped.nft,
             crownNum: CROWN_NUM, crownDenom: CROWN_DENOM };
  });

  check("the Crown carries no strip weight in Pride",
        r.looseWeight.every((w) => w === 0) && r.onStrip === 0,
        `weights ${r.looseWeight.join(",")}, ${r.onStrip} on the built strips`);
  check("every Crown on screen is part of a full stack of four",
        r.partial === 0 && r.crownReels > 0,
        `${r.partial} partial column(s), ${r.crownReels} full`);
  // Every Crown cell belongs to a full column, so the cell count is exactly
  // four times the column count -- an identity, and worth pinning because it is
  // what "the Crown is a stack" MEANS in the rendered grid.
  check("Crown cells are exactly four per crowned reel",
        r.crownCells === r.crownReels * r.rows,
        `${r.crownCells} cells vs ${r.crownReels} x ${r.rows}`);
  // And the rate itself, against the constant that declares it rather than
  // against a number typed here.
  {
    const want = r.crownNum / r.crownDenom;
    const got = r.crownReels / r.totalReels;
    check("crowned reels land at the declared rate",
          Math.abs(got / want - 1) < 0.15,
          `${(got * 100).toFixed(2)}% observed vs ${(want * 100).toFixed(2)}% declared `
          + `over ${r.totalReels} reels`);
  }
  check("a Pride grid always consumes two draws per reel",
        r.draws.length === 1 && r.draws[0] === 2 * 5,
        `observed draw counts: ${r.draws.join(",")}`);
  check("the max-win cap does not swallow the NFT", r.cappedKeepsNft);
  // A BOUGHT round follows a different code path -- buyFeature builds its own
  // outcome literal -- and that literal is exactly where the flag went missing:
  // prideFreeSpins reported the filled board and buyFeature dropped it, so a
  // bought round paid its coins and kept the Lion while the rules text
  // promised the opposite. Stub the draw to crown everything and walk the real
  // path end to end.
  const bought = await p.evaluate(() => {
    const real = drawGridPride;
    try {
      drawGridPride = () => {
        const g = []; for (let r = 0; r < REELS; r++) {
          const c = []; for (let row = 0; row < ROWS; row++) c.push(P1); g.push(c);
        }
        return { grid: g, crowned: REELS };
      };
      const out = buyFeature(makeRng(new Uint8Array(32).map((_, i) => i), "b", 1, "pride"), "pride");
      return { nft: !!out.nft, fs: out.fs };
    } finally { drawGridPride = real; }
  });
  check("a bought round that fills the board carries the Lion out",
        bought.nft && bought.fs, `nft=${bought.nft}`);

  // The crown DRAG. Scatters had drag, dim and riser while the reels deciding
  // the Lion landed on the ordinary stagger -- the biggest moment in the
  // cabinet paced like the smallest. Measured by racing two spins: a board
  // whose first two reels are crowned must take visibly longer to land than a
  // plain board, and the dragged reels must wear the anticipate class while
  // they run. Timing, not implementation: it fails however the drag is lost.
  const drag = await p.evaluate(async () => {
    const plain = [], crowned = [];
    for (let r = 0; r < REELS; r++) {
      const a = [], b = [];
      for (let row = 0; row < ROWS; row++) { a.push(6 + row); b.push(r < 2 ? P1 : 6 + row); }
      plain.push(a); crowned.push(b);
    }
    const time = async (g) => {
      const t0 = performance.now();
      let seen = false;
      const iv = setInterval(() => {
        if (document.querySelector("#reels .reel.anticipate")) seen = true;
      }, 60);
      await animateSpin(g, 0);
      clearInterval(iv);
      return { ms: performance.now() - t0, seen };
    };
    const a = await time(plain);
    const b = await time(crowned);
    return { plain: Math.round(a.ms), crowned: Math.round(b.ms),
             anticSeen: b.seen, plainAntic: a.seen };
  });
  check("two crowned reels drag the rest of the board",
        drag.crowned - drag.plain > 500 && drag.anticSeen,
        `plain ${drag.plain}ms vs crowned ${drag.crowned}ms, anticipate=${drag.anticSeen}`);
  check("a plain board does not anticipate", !drag.plainAntic);
  check("no runtime errors in Pride", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

/* -------------------------------------------------------------- reel curve */
/* Every reel in a spin cruises at one speed, so a reel planned to stop late --
   the one about to tease -- cannot be told apart until the reel before it
   lands. The curve these replace ran every reel over the same distance, which
   made a longer plan a slower reel from its first frame. */
console.log("\nReel curve");
{
  const { p, ctx } = await page();
  const r = await p.evaluate(() => {
    const sample = (m) => {
      const dt = 0.5; let prev = 0, vmax = 0, peak = 0, monotonic = true, lastV = null;
      const decStart = m.T - Math.min(420, Math.max(90, m.T * 0.34));
      const springStart = m.T - Math.min(420, Math.max(90, m.T * 0.34)) * 0.35;
      for (let t = dt; t <= m.T + dt; t += dt) {
        const d = m.pos(t), v = (d - prev) / dt;
        vmax = Math.max(vmax, v); peak = Math.max(peak, d);
        if (t > decStart + dt && t < springStart) {
          if (lastV !== null && v > lastV + 1e-9) monotonic = false;
          lastV = v;
        }
        prev = d;
      }
      return { vmax, peak, monotonic, end: m.pos(m.T + 5), start: m.pos(0), D: m.D, v: m.v };
    };
    const plain = reelMotion(2100, null, 0.036, 0.2);
    const teasing = reelMotion(3600, 1950, 0.036, 0.2);
    const turboR = reelMotion(390, null, 0.05, 0.08);
    // Before the reel ahead of it lands, a teasing reel is exactly where any
    // reel still cruising would be: same start, same speed, same ribbon.
    const cruising = reelMotion(3600, null, 0.036, 0.2);
    let maxGap = 0;
    for (let t = 0; t < 1950; t += 5) maxGap = Math.max(maxGap, Math.abs(teasing.pos(t) - cruising.pos(t)));
    // and it matches its plain neighbour until that neighbour starts to brake
    for (let t = 0; t < 2100 - 420; t += 5) maxGap = Math.max(maxGap, Math.abs(teasing.pos(t) - plain.pos(t)));
    // ...and afterwards it is genuinely slower.
    const vAfter = (teasing.pos(2500) - teasing.pos(2490)) / 10;
    return { plain: sample(plain), teasing: sample(teasing), turbo: sample(turboR), maxGap, vAfter };
  });
  for (const [name, s] of Object.entries({ plain: r.plain, teasing: r.teasing, turbo: r.turbo })) {
    check(`${name}: velocity never exceeds cruise`, s.vmax <= s.v + 1e-9,
          `peak ${s.vmax.toFixed(5)} vs cruise ${s.v.toFixed(5)} cells/ms`);
    check(`${name}: deceleration is monotonic`, s.monotonic);
    check(`${name}: travel overshoots the stop`, s.peak > s.D, `peak ${s.peak.toFixed(3)} vs stop ${s.D.toFixed(3)}`);
    check(`${name}: travel lands exactly on the stop`, Math.abs(s.end - s.D) < 1e-12 && s.start === 0);
  }
  check("a teasing reel matches a plain one until the reel before it lands", r.maxGap < 1e-9,
        `max gap ${r.maxGap.toExponential(2)} cells`);
  check("then it drops to the slower excited speed", r.vAfter < 0.036 * 0.5,
        `${r.vAfter.toFixed(4)} cells/ms vs 0.0360 cruise`);
  await ctx.close();
}

/* ------------------------------------------------- spin speeds and controls */
console.log("\nSpin speeds, slam stop and market rules");
{
  const { p, ctx, errs } = await page();
  const r = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    muted = true;
    document.querySelector('[data-game="pride"]').click(); await sleep(350);
    const plainGrid = () => { const g = []; for (let a = 0; a < 5; a++) g.push([M1, M2, L1, L2]); return g; };
    const time = async (fn) => { const t0 = performance.now(); await fn(); return performance.now() - t0; };
    const out = {};
    turbo = false; quickSpin = false;
    out.normal = await time(() => animateSpin(plainGrid(), 0));
    quickSpin = true; out.quick = await time(() => animateSpin(plainGrid(), 0)); quickSpin = false;
    turbo = true; out.turbo = await time(() => animateSpin(plainGrid(), 0)); turbo = false;

    // a press mid-spin lands the reels on the true result, early
    const g = plainGrid(); g[2][1] = P2; g[4][3] = P3;
    const job = animateSpin(g, 0);
    const t0 = performance.now();
    await sleep(400); press();
    await job;
    out.slam = performance.now() - t0;
    const reels = [...document.getElementById("reels").children];
    let wrong = 0;
    for (let a = 0; a < 5; a++) for (let b = 0; b < 4; b++) {
      const img = reels[a].querySelectorAll(".sym")[b].querySelector("img");
      if (img && img.alt !== symName(g[a][b], "pride")) wrong++;
    }
    out.slamWrong = wrong;

    // UK-style market: 2.5s minimum, no slam, no buy, no quick spin
    applyMarket("uk");
    out.ukQuickAllowed = !document.getElementById("speed").disabled;
    quickSpin = true;   // even forced on, the market's rules win
    const jobUk = animateSpin(plainGrid(), 0);
    const tUk = performance.now();
    await sleep(300); press();
    await jobUk;
    out.uk = performance.now() - tUk;
    out.ukBuy = buyOptions().some(o => o.key === "feature");
    quickSpin = false;
    applyMarket("standard");
    out.stdBuy = buyOptions().some(o => o.key === "feature");

    // Space held runs turbo; releasing it ends turbo
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", repeat: true, bubbles: true }));
    out.heldTurbo = turbo && turboHeld;
    document.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " ", bubbles: true }));
    out.releasedTurbo = turbo || turboHeld;
    while (busy) await sleep(50);

    // autoplay: stop on any win
    serverSeed = new Uint8Array(32).map((_, i) => (i * 11 + 9) & 0xff); nonce = 0;
    document.getElementById("apAnyWin").checked = true;
    turboAuto = true;
    const h0 = history.length;
    await runAuto();
    const played = history.slice(h0);
    out.anyWin = { spins: played.length, lastWin: played.length ? played[played.length - 1].win : 0,
                   earlierWins: played.slice(0, -1).filter(h => h.win > 0).length, turboAfter: turbo };
    document.getElementById("apAnyWin").checked = false;

    // autoplay: stop if a bonus is won
    document.querySelector('[data-game="traitvault"]').click(); await sleep(300);
    serverSeed = new Uint8Array(32).map((_, i) => (i * 5 + 1) & 0xff);
    const client = document.getElementById("fClient").value;
    let n0 = -1;
    for (let n = 1; n < 3000; n++) if (spinVault(makeRng(serverSeed, client, n, "traitvault"), {}).fs) { n0 = n; break; }
    nonce = Math.max(0, n0 - 6);
    document.getElementById("apBonus").checked = true;
    document.getElementById("apCount").value = "25";
    const h1 = history.length;
    await runAuto();
    const p2 = history.slice(h1);
    out.bonus = { n0, spins: p2.length, lastFs: p2.length ? p2[p2.length - 1].fs : false,
                  lastNonce: p2.length ? p2[p2.length - 1].nonce : -1 };
    document.getElementById("apBonus").checked = false;
    turboAuto = false;

    // settings: effects off means no effect voices; music off stops the bed
    muted = false; ac();
    let oscs = 0; const oc = actx.createOscillator.bind(actx);
    actx.createOscillator = () => { oscs++; return oc(); };
    sfxOff = true; winChime(3); blip(600, .05); const offOscs = oscs;
    sfxOff = false; winChime(3); const onOscs = oscs - offOscs;
    actx.createOscillator = oc;
    startMusic(); startRhythm();
    const musicBefore = !!music;
    const box = document.getElementById("setMusic"); box.checked = false; box.dispatchEvent(new Event("change"));
    out.settings = { offOscs, onOscs, musicBefore, musicAfter: !!music || !!rhythm };
    box.checked = true; box.dispatchEvent(new Event("change"));
    muted = true; stopMusic(); stopRhythm();

    // battery saver thins the coin shower and stops ambient motion
    batterySaver = true; syncSettingsUi();
    parts = []; coins(100, 1);
    out.saver = { parts: parts.length, cls: document.body.classList.contains("saver") };
    batterySaver = false; syncSettingsUi(); parts = [];
    return out;
  });
  check("a normal spin takes about 2.1s to its last stop", r.normal > 1950 && r.normal < 2600, `${Math.round(r.normal)}ms`);
  check("quick spin drops the minimum", r.quick < r.normal * 0.6, `${Math.round(r.quick)}ms vs ${Math.round(r.normal)}ms`);
  check("turbo is quicker still", r.turbo < r.quick && r.turbo < 700, `${Math.round(r.turbo)}ms`);
  check("a press mid-spin stops the reels early", r.slam < 1100, `${Math.round(r.slam)}ms against ~2100`);
  check("a slam stop lands the same grid a full spin would", r.slamWrong === 0, `${r.slamWrong} cells differ`);
  check("the UK-style preset holds every spin to 2.5s and ignores the press", r.uk >= 2450, `${Math.round(r.uk)}ms`);
  check("the UK-style preset removes quick spin and the feature buy", !r.ukQuickAllowed && !r.ukBuy && r.stdBuy);
  check("holding Space runs turbo", r.heldTurbo);
  check("releasing Space ends turbo", !r.releasedTurbo);
  check("autoplay stops on the first win when asked",
        r.anyWin.spins >= 1 && r.anyWin.lastWin > 0 && r.anyWin.earlierWins === 0,
        `${r.anyWin.spins} spins, last paid ${Math.round(r.anyWin.lastWin)}`);
  check("autoplay turbo ends with the run", r.anyWin.turboAfter === false);
  check("autoplay stops when a bonus is won", r.bonus.n0 > 0 && r.bonus.lastFs && r.bonus.lastNonce === r.bonus.n0,
        `bonus at nonce ${r.bonus.n0}, stopped at ${r.bonus.lastNonce} after ${r.bonus.spins} spins`);
  check("sound effects off means no effect voices", r.settings.offOscs === 0 && r.settings.onOscs > 0,
        `${r.settings.offOscs} off vs ${r.settings.onOscs} on`);
  check("music off stops the bed", r.settings.musicBefore && !r.settings.musicAfter);
  check("battery saver thins the coin shower", r.saver.parts <= 20 && r.saver.cls, `${r.saver.parts} coins for 100`);
  check("no runtime errors in the controls", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} browser check(s) FAILED` : "\nbrowser gate OK");
process.exit(failures ? 1 : 0);
