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

    // Two scatters on reels 1-2 -- reel 3 must drag, but only after reel 1 has
    // stopped. Reel 1 lands at 520ms (base), so anything earlier is a spoiler.
    const g = [];
    for (let a = 0; a < 5; a++) { g.push([]); for (let b = 0; b < 4; b++) g[a].push(P1); }
    g[0][0] = SCAT; g[1][0] = SCAT;
    const two = await run(g);

    // No scatters at all: the cabinet must never light up.
    const clean = [];
    for (let a = 0; a < 5; a++) { clean.push([]); for (let b = 0; b < 4; b++) clean[a].push(P1); }
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
// The bed lifts for a feature round -- 82 bpm to 132 -- and has to come back
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
    document.querySelector('[data-game="traitvault"]').click();
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
      firstImgIsBody: cell.querySelector("img").alt === symName(P1, "traitvault"),
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

/* -------------------------------------------------------------- reel curve */
console.log("\nReel curve");
{
  const { p, ctx } = await page();
  const r = await p.evaluate(() => {
    const N = 4000;
    let prev = null, vmax = 0, peak = 0, monotonic = true, lastV = null;
    for (let i = 0; i <= N; i++) {
      const k = i / N, d = reelEase(k);
      peak = Math.max(peak, d);
      if (prev !== null) {
        const v = (d - prev) * N;
        vmax = Math.max(vmax, v);
        if (k > REEL_B && k < REEL_M) {
          if (lastV !== null && v > lastV + 1e-6) monotonic = false;
          lastV = v;
        }
      }
      prev = d;
    }
    return { v: REEL_V, vmax, peak, end: reelEase(1), start: reelEase(0), monotonic };
  });
  check("velocity never exceeds cruise", r.vmax <= r.v + 1e-6,
        `peak ${r.vmax.toFixed(4)} vs cruise ${r.v.toFixed(4)}`);
  check("deceleration is monotonic", r.monotonic);
  check("travel overshoots the stop", r.peak > 1, `peak ${r.peak.toFixed(4)}`);
  check("travel lands on exactly 1", Math.abs(r.end - 1) < 1e-12 && r.start === 0);
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} browser check(s) FAILED` : "\nbrowser gate OK");
process.exit(failures ? 1 : 0);
