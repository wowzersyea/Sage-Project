/* The front door.

   What this holds down is mostly what the gate must NOT do: it must not
   let a page through without the code, it must not stay in the way once
   it has it, and above all it must not become the thing anyone thinks is
   protecting the names. The last one is checked by asserting the gate
   knows nothing about the endpoint key and the roster never reaches a
   locked page. */

const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

const CODE = '2026';
const PAGES = [
  '/morning-report/', '/morning-report/draw/', '/morning-report/roster/',
  '/morning-report/board/', '/morning-report/settings/', '/morning-report/publish/',
  '/morning-report/roles/', '/morning-report/learn/specificity/',
  '/morning-report/feedback/summary/',
];

/* Two pages under the module are deliberately NOT gated, and the reason
   is the same for both: they are the anonymous form a resident opens on
   their phone from a QR code at the end of the session, and the short
   address that redirects to it.

   A code prompt there costs responses at exactly the moment you want
   none — somebody standing up to leave, phone in hand, is not going to
   go and ask what the code is. And there is nothing behind it to guard:
   a blank feedback form gives a stranger nothing. The summary, which
   shows what people actually wrote, is gated. */
const OPEN = [
  '/morning-report/feedback/',
  '/feedback/',
];

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const out = [];
  const t = (n, c, x) => out.push({ n, p: !!c, x: x === undefined ? '' : JSON.stringify(x) });
  const errs = [];

  /* A visitor with no code. Note: no fakefs preamble, because that is
     what seeds the code for every other suite. */
  const cold = await b.newContext();
  const p1 = await cold.newPage();
  p1.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p1.on('console', m => {
    const u = (m.location() && m.location().url) || '';
    if (m.type() === 'error' && !/googletagmanager|favicon|ERR_/.test(m.text() + ' ' + u)) errs.push('console: ' + m.text());
  });

  for (const path of PAGES) {
    await p1.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    t('locked: ' + path, await p1.isVisible('.mr-gate'));
  }

  /* The exceptions, asserted rather than left to drift: somebody adding
     the gate to the feedback form later should have to delete a test
     that says why not. */
  for (const path of OPEN) {
    await p1.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    t('deliberately open: ' + path, !(await p1.isVisible('.mr-gate').catch(() => false)));
  }

  /* Locked means the page underneath is not readable, not merely
     covered by something a scroll would get past. */
  await p1.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });
  t('the page under the gate is hidden',
    await p1.evaluate(() => {
      var bar = document.getElementById('mr-bar');
      return !bar || bar.offsetParent === null;
    }));
  t('the html element is marked locked',
    await p1.evaluate(() => document.documentElement.classList.contains('mr-locked')));

  /* The wrong code does not open it, and says so. */
  await p1.fill('.mr-gate input', '1234');
  await p1.click('.mr-gate button');
  t('a wrong code is refused', await p1.isVisible('.mr-gate'));
  t('and says so', /not the code/i.test(await p1.textContent('.mr-gate-err')));

  /* The right one does. */
  await p1.fill('.mr-gate input', CODE);
  await p1.click('.mr-gate button');
  await p1.waitForSelector('.mr-gate', { state: 'detached' });
  t('the right code opens it', !(await p1.isVisible('.mr-gate').catch(() => false)));
  t('and the page underneath comes back',
    await p1.evaluate(() => {
      var bar = document.getElementById('mr-bar');
      return !!bar && bar.offsetParent !== null;
    }));
  t('and the lock class is gone',
    await p1.evaluate(() => !document.documentElement.classList.contains('mr-locked')));

  /* Enter works, because nobody reaches for the mouse for a four-digit
     code. Checked on a fresh page so the gate is up again. */
  const ctx2 = await b.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/morning-report/', { waitUntil: 'domcontentloaded' });
  await p2.fill('.mr-gate input', CODE);
  await p2.press('.mr-gate input', 'Enter');
  await p2.waitForSelector('.mr-gate', { state: 'detached' });
  t('Enter submits the code', true);

  /* It remembers, across pages and across a reload. */
  await p2.goto(BASE + '/morning-report/roster/', { waitUntil: 'domcontentloaded' });
  t('another page in the section stays open', !(await p2.isVisible('.mr-gate').catch(() => false)));
  await p2.reload({ waitUntil: 'domcontentloaded' });
  t('and it survives a reload', !(await p2.isVisible('.mr-gate').catch(() => false)));

  t('exactly one key is kept for it',
    (await p2.evaluate(() => Object.keys(localStorage))).join() === 'sage-mr-gate');

  /* Forgetting puts it back. */
  await p2.evaluate(() => { localStorage.removeItem('sage-mr-gate'); });
  await p2.goto(BASE + '/morning-report/draw/', { waitUntil: 'domcontentloaded' });
  t('clearing the code locks it again', await p2.isVisible('.mr-gate'));
  await ctx2.close();

  /* ---- the part that matters -------------------------------------

     The gate is a sign. If it ever starts looking like the thing that
     protects the names, that is the bug this section is here to catch. */

  const ctx3 = await b.newContext();
  const p3 = await ctx3.newPage();
  await p3.addInitScript(fake);
  await p3.goto(BASE + '/morning-report/settings/', { waitUntil: 'networkidle' });

  t('the gate does not touch the endpoint settings',
    await p3.evaluate(() => {
      return typeof MRGate !== 'undefined' &&
             JSON.stringify(Object.keys(MRGate).sort()) === JSON.stringify(['code', 'forget', 'passed']);
    }));
  t('the gate code is not the endpoint key',
    await p3.evaluate(() => {
      MRRemote.setSettings({ endpoint: 'https://x.test/exec', key: 'a-long-random-key', remember: false });
      return MRRemote.settings().key !== MRGate.code();
    }));
  t('and the two are stored separately',
    await p3.evaluate(() => localStorage.getItem('sage-mr-gate') !== null &&
                            localStorage.getItem('sage-mr-remote') === null));
  await ctx3.close();

  /* A locked page must not have fetched a roster before the code was
     entered — the gate is cosmetic, so the real guarantee is that the
     page had nothing to show in the first place. */
  const ctx4 = await b.newContext();
  const p4 = await ctx4.newPage();
  const fetched = [];
  await p4.route('**/*', route => {
    const u = route.request().url();
    if (/exec|roster\.json|rotations\.json/.test(u)) fetched.push(u);
    return route.continue();
  });
  await p4.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });
  t('a locked page has fetched no roster of any kind', fetched.length === 0, fetched);
  t('and the wheels are empty behind it',
    await p4.evaluate(() => {
      var svg = document.querySelector('svg');
      return !svg || svg.querySelectorAll('.seg-label').length === 0;
    }));
  await ctx4.close();
  await cold.close();

  await b.close();
  let bad = 0;
  for (const o of out) {
    if (!o.p) bad++;
    console.log(`${o.p ? ' ok ' : 'FAIL'}  ${o.n}${o.p ? '' : '  got ' + o.x}`);
  }
  if (errs.length) { console.log('\nconsole/page errors:'); errs.forEach(e => console.log('  ' + e)); }
  console.log(`\n${out.length} assertions, ${bad} failures, ${errs.length} console errors`);
  process.exit(bad || errs.length ? 1 : 0);
})();
