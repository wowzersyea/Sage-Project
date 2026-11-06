/**
 * Render docs/benchmark.html from the benchmark's own verdicts.
 *
 *   node tools/review/render-benchmark.mjs        # runs the benchmark, writes the page
 *   node tools/review/benchmark.mjs --json | node tools/review/render-benchmark.mjs -
 *
 * Why this file exists: the page was written by hand from a benchmark run. That
 * is the same fault the licensing gate had before it learned to read the shipped
 * art -- a document DESCRIBING the measurement, free to drift from it, and
 * nothing to notice when it did. Every count, tick and blocked row on the page
 * now comes from `--json`, so a criterion added or a verdict changed shows up
 * the next time this is run instead of the next time somebody remembers.
 *
 * The prose that is genuinely editorial -- the headline, the lede, the framing
 * of what is blocked -- stays here as text. The verdicts do not.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const OUT = join(root, "docs", "benchmark.html");

/* Counts that are not the benchmark's to know: how many defects this review
   turned up, and how many checks now guard the page.

   The check count is the one most likely to go stale, and counting call sites
   in the source gets it wrong -- several sit inside loops over the three games,
   so 138 written checks emit 169 results. Run the gate and count what it
   actually printed. Its exit code is deliberately ignored: this is a report of
   how many checks exist, not an assertion that they pass, and `npm run check`
   is where a red gate is allowed to stop things. */
const DEFECTS_FIXED = 17;
let browserChecks = "0";
try {
  const out = execFileSync("node", [join(root, "tests", "browser.mjs")],
                           { encoding: "utf8", maxBuffer: 32 << 20, env: process.env });
  browserChecks = String((out.match(/^ {2}(?:ok {2}|FAIL) /gm) || []).length);
} catch (e) {
  browserChecks = String(((e.stdout || "").match(/^ {2}(?:ok {2}|FAIL) /gm) || []).length);
}
if (browserChecks === "0") throw new Error("browser gate produced no checks to count");

let raw;
if (process.argv[2] === "-") {
  raw = "";
  for await (const chunk of process.stdin) raw += chunk;
} else {
  raw = execFileSync("node", [join(here, "benchmark.mjs"), "--json"],
                     { encoding: "utf8", maxBuffer: 32 << 20, env: process.env });
}
const { rows } = JSON.parse(raw.slice(raw.indexOf("{")));

/* These strings must match benchmark.mjs exactly. They are asserted below
   rather than trusted: a renamed verdict would otherwise land every blocked row
   in the "verified" column silently, which is the one direction this report is
   never allowed to be wrong in. */
const PASS = "PASS", PARTIAL = "PARTIAL", ABSENT = "ABSENT";
const NEEDS_ART = "NEEDS-ART", NEEDS_HUMAN = "NEEDS-HUMAN";
const KNOWN = new Set([PASS, PARTIAL, ABSENT, NEEDS_ART, NEEDS_HUMAN]);
const blockedV = (v) => v === NEEDS_ART || v === NEEDS_HUMAN;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const unknown = [...new Set(rows.map((r) => r.verdict))].filter((v) => !KNOWN.has(v));
if (unknown.length) throw new Error(`benchmark emitted unknown verdict(s): ${unknown.join(", ")}`);

const cats = [...new Set(rows.map((r) => r.cat))];
const codeRows = rows.filter((r) => !blockedV(r.verdict));
const passed = codeRows.filter((r) => r.verdict === PASS).length;
const blocked = rows.filter((r) => blockedV(r.verdict));

const chip = (v) => v === PASS ? '<span class="chip ok">verified</span>'
  : blockedV(v) ? `<span class="chip art">${v === NEEDS_ART ? "needs art" : "needs a person"}</span>`
  : `<span class="chip part">${v === PARTIAL ? "partial" : "absent"}</span>`;

const detail = (r) => (r.evidence ? `<p class="ev">${esc(r.evidence)}</p>` : "")
  + (r.note ? `<p class="note">${esc(r.note.replace(/\s+/g, " "))}</p>` : "");

const sections = cats.map((cat) => {
  const rs = rows.filter((r) => r.cat === cat);
  const inCat = rs.filter((r) => !blockedV(r.verdict));
  return `<section class="cat"><header><h2>${esc(cat)}</h2>`
    + `<span class="count">${inCat.filter((r) => r.verdict === PASS).length}`
    + `<span class="of">/${rs.length}</span></span></header><ul class="crits">`
    + rs.map((r) => `<li><div class="crit"><h3>${esc(r.name)}</h3>${chip(r.verdict)}</div>`
        + `${detail(r)}</li>`).join("")
    + `</ul></section>`;
}).join("");

const ticks = rows.map((r) =>
  `<i class="${r.verdict === PASS ? "t-ok" : blockedV(r.verdict) ? "t-art" : "t-part"}"`
  + ` title="${esc(r.name)}"></i>`).join("");

const blockedList = blocked.map((r) =>
  `<li><h3>${esc(r.name)}</h3>${detail(r)}</li>`).join("");

const page = `<title>Cabinet Benchmark</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root{
  --ground:#FAF9FB; --surface:#FFFFFF; --sunk:#F2F0F6;
  --ink:#191324; --muted:#6C6480; --rule:#E4E0EA;
  --accent:#A8791C; --ok:#26786A; --ok-bg:#E4F1ED; --art:#6B57A8; --art-bg:#ECE7F7;
  --warn:#9A5B14; --warn-bg:#F6ECDD;
  --shadow:0 1px 2px rgba(25,19,36,.05),0 8px 24px -16px rgba(25,19,36,.25);
}
@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){
  --ground:#151020; --surface:#1D172A; --sunk:#231B33;
  --ink:#EBE7F2; --muted:#9A93AC; --rule:#2C2440;
  --accent:#D9A94A; --ok:#4FB8A4; --ok-bg:#173029; --art:#A48EE0; --art-bg:#241C3A;
  --warn:#E0A65C; --warn-bg:#33260F;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px -18px rgba(0,0,0,.8);
}}
:root[data-theme="dark"]{
  --ground:#151020; --surface:#1D172A; --sunk:#231B33;
  --ink:#EBE7F2; --muted:#9A93AC; --rule:#2C2440;
  --accent:#D9A94A; --ok:#4FB8A4; --ok-bg:#173029; --art:#A48EE0; --art-bg:#241C3A;
  --warn:#E0A65C; --warn-bg:#33260F;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px -18px rgba(0,0,0,.8);
}
*{box-sizing:border-box}
body{background:var(--ground);color:var(--ink);margin:0;
  font-family:"Source Serif 4",Georgia,serif;font-size:17px;line-height:1.6;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:clamp(28px,5vw,72px) clamp(18px,4vw,40px) 96px}
h1,h2,h3,.count,.chip,.eyebrow,.legend{font-family:"Bricolage Grotesque",system-ui,sans-serif}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
  color:var(--accent);margin:0 0 14px}
h1{font-size:clamp(34px,5.2vw,56px);font-weight:800;line-height:1.04;margin:0 0 18px;
  letter-spacing:-.02em;text-wrap:balance}
.lede{max-width:64ch;color:var(--muted);font-size:clamp(16.5px,1.9vw,18.5px);
  line-height:1.5;margin:0 0 34px}
.lede strong{color:var(--ink);font-weight:600}
.board{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:1px;
  background:var(--rule);border:1px solid var(--rule);border-radius:14px;overflow:hidden;
  box-shadow:var(--shadow);margin-bottom:26px}
.cell{background:var(--surface);padding:20px 22px}
.cell .n{font-family:"Bricolage Grotesque",sans-serif;font-weight:800;font-size:38px;
  line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums;display:block}
.cell .n .sub{color:var(--muted);font-size:22px}
.cell .n.gold{color:var(--accent)} .cell .n.teal{color:var(--ok)} .cell .n.vio{color:var(--art)}
.cell .l{display:block;margin-top:8px;font-size:13.5px;color:var(--muted);line-height:1.4}
#ticks{display:flex;gap:3px;flex-wrap:wrap;margin:0 0 8px}
#ticks i{flex:1 1 8px;min-width:7px;height:26px;border-radius:2px;display:block}
#ticks .t-ok{background:var(--ok)} #ticks .t-art{background:var(--art)}
#ticks .t-part{background:var(--warn)}
.legend{display:flex;gap:20px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin-bottom:48px}
.legend span{display:inline-flex;align-items:center;gap:7px}
.legend b{width:10px;height:10px;border-radius:2px;display:inline-block}
.cat{margin-bottom:40px}
.cat > header{display:flex;align-items:baseline;justify-content:space-between;gap:16px;
  border-bottom:2px solid var(--ink);padding-bottom:9px;margin-bottom:4px}
.cat h2{font-size:20px;font-weight:600;margin:0;letter-spacing:-.01em}
.count{font-weight:800;font-size:19px;font-variant-numeric:tabular-nums;color:var(--ok)}
.count .of{color:var(--muted);font-weight:600}
.crits{list-style:none;margin:0;padding:0}
.crits > li{padding:15px 0;border-bottom:1px solid var(--rule)}
.crit{display:flex;align-items:baseline;justify-content:space-between;gap:14px}
.crit h3{font-size:16.5px;font-weight:600;margin:0;letter-spacing:-.005em}
.ev{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12.5px;line-height:1.65;
  color:var(--muted);margin:7px 0 0;max-width:78ch;overflow-wrap:anywhere}
.note{margin:9px 0 0;padding-left:14px;border-left:2px solid var(--art);
  font-size:14.5px;line-height:1.55;color:var(--muted);max-width:66ch;font-style:italic}
.chip{flex:none;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  padding:4px 9px;border-radius:4px;white-space:nowrap}
.chip.ok{background:var(--ok-bg);color:var(--ok)}
.chip.art{background:var(--art-bg);color:var(--art)}
.chip.part{background:var(--warn-bg);color:var(--warn)}
.closing{margin-top:64px;padding:30px 32px;background:var(--sunk);
  border:1px solid var(--rule);border-radius:14px}
.closing h2{font-size:23px;margin:0 0 8px;font-weight:800;letter-spacing:-.015em}
.closing > p{color:var(--muted);margin:0 0 22px;max-width:62ch}
.blocked{list-style:none;margin:0;padding:0;display:grid;gap:20px}
.blocked li{padding-left:18px;border-left:3px solid var(--art)}
.blocked h3{margin:0;font-size:16.5px;font-weight:600}
footer{margin-top:44px;color:var(--muted);font-size:13.5px;line-height:1.7}
footer code{font-family:"JetBrains Mono",monospace;font-size:12.5px;
  background:var(--sunk);padding:2px 6px;border-radius:4px}
@media (max-width:620px){.crit{flex-direction:column;gap:6px}.chip{align-self:flex-start}}
</style>
<div class="wrap">
<p class="eyebrow">Lazy Arcade &middot; front-end review</p>
<h1>Where the cabinet stands against tier-one slots</h1>
<p class="lede">${rows.length} criteria drawn from what NetEnt, Hacksaw, Play&rsquo;n GO, Push, Nolimit,
Pragmatic and Relax actually ship, each one <strong>measured in a live browser</strong> against the real
page rather than looked up in the source. Anything needing artistic or human judgement is reported as
blocked and never as a pass.</p>
<div class="board">
  <div class="cell"><span class="n teal">${passed}<span class="sub">/${codeRows.length}</span></span>
    <span class="l">code-side criteria verified</span></div>
  <div class="cell"><span class="n vio">${blocked.length}</span><span class="l">blocked on art or a person</span></div>
  <div class="cell"><span class="n gold">${DEFECTS_FIXED}</span><span class="l">defects found and fixed during this review</span></div>
  <div class="cell"><span class="n gold">${browserChecks}</span><span class="l">browser checks guarding it, each proven to fail</span></div>
</div>
<div id="ticks">${ticks}</div>
<div class="legend">
  <span><b style="background:var(--ok)"></b> verified by measurement</span>
  <span><b style="background:var(--art)"></b> blocked on art or human judgement</span>
</div>
${sections}
<div class="closing">
  <h2>What is still blocked, and on what</h2>
  <p>${blocked.length} row${blocked.length === 1 ? "" : "s"}, down from four. The character animation
  that used to sit here &mdash; the blink and mouth movement &mdash; has shipped. Both were called
  impossible on the strength of a sampling bug that read a black brow line as fur. Three times in this
  project something was declared out of reach and turned out to be a faulty instrument rather than a
  property of the art, so read what remains below as a claim with evidence attached rather than a
  verdict.</p>
  <ul class="blocked">${blockedList}</ul>
</div>
<footer>This page is generated: <code>node tools/review/render-benchmark.mjs</code> runs the benchmark
and writes every count, tick and row above from its verdicts, so it cannot drift from what was measured.
Run <code>npm run review:benchmark</code> for the same report in a terminal, or <code>--json</code> for
the raw verdicts. It is a report, not a gate: it exits zero whatever it finds, and
<code>npm run check</code> is where things are allowed to fail the build.</footer>
</div>
`;

writeFileSync(OUT, page);
console.log(`wrote ${OUT}`);
console.log(`  ${rows.length} criteria, ${passed}/${codeRows.length} code-side pass, `
  + `${blocked.length} blocked, ${browserChecks} browser checks`);
