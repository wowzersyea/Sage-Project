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
