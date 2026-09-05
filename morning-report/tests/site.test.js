const { chromium } = require('playwright');
const { launchOptions } = require('./browser');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

(async () => {
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { const u=(m.location()&&m.location().url)||''; if (m.type()==='error' && !/googletagmanager|favicon|ERR_CONNECTION_RESET|gtag/.test(m.text()+' '+u)) errs.push('console: ' + m.text()); });
  await page.addInitScript(fake);

  const out = [];
  const t = (name, cond, extra) => out.push({ name, pass: !!cond, extra: extra === undefined ? '' : JSON.stringify(extra) });

  // ---- every page in the module loads clean --------------------------------
  const PAGES = [
    '/morning-report/', '/morning-report/draw/', '/morning-report/board/',
    '/morning-report/scorecard/', '/morning-report/capture/', '/morning-report/roster/',
    '/morning-report/review/', '/morning-report/report/', '/morning-report/roles/',
    '/morning-report/roles/run-of-show/', '/morning-report/roles/presenter/',
    '/morning-report/roles/scribe/', '/morning-report/roles/pgy1/',
    '/morning-report/roles/senior/', '/morning-report/roles/faculty/',
    '/morning-report/roles/facilitator/', '/morning-report/roles/framework/',
    '/morning-report/archive/', '/morning-report/admin/',
    '/morning-report/learn/specificity/',
    '/morning-report/settings/', '/morning-report/publish/',
    '/morning-report/feedback/', '/morning-report/feedback/summary/',
    '/morning-report/baseline/', '/morning-report/baseline/summary/',
    '/morning-report/baseline/share/'
  ];
  for (const p of PAGES) {
    const before = errs.length;
    const resp = await page.goto(BASE + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(200);
    t(`${p} loads`, resp.ok(), resp.status());
    t(`${p} is error-free`, errs.length === before, errs.slice(before));
  }

  // ---- every internal link resolves ------------------------------------------
  const seen = new Set();
  const broken = [];
  for (const p of PAGES) {
    await page.goto(BASE + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(150);
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
      .map(a => a.href)
      .filter(h => h.startsWith(location.origin) && !h.includes('#') || (h.startsWith(location.origin) && h.split('#')[0] !== location.href.split('#')[0]))
      .map(h => h.split('#')[0]));
    for (const h of new Set(hrefs)) {
      if (seen.has(h)) continue;
      seen.add(h);
      const r = await page.request.get(h);
      if (!r.ok()) broken.push(h.replace(BASE, '') + ' -> ' + r.status());
    }
  }
  t('every internal link in the module resolves', broken.length === 0, broken);

  // ---- the homepage points at the module ------------------------------------
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const home = await page.evaluate(() => ({
    card: !!document.querySelector('a[href="morning-report/"] h3'),
    cardTitle: (document.querySelector('a[href="morning-report/"] h3') || {}).textContent,
    oldCard: !!document.querySelector('a[href="discussant-draw/"]'),
    navLabels: [...document.querySelectorAll('.capsule-nav a, nav a')].map(a => a.textContent.trim()).filter(Boolean)
  }));
  t('the homepage card points at the module', home.card === true, home.cardTitle);
  t('the card is renamed for what it now is', home.cardTitle === 'Morning Report', home.cardTitle);
  t('no homepage card still points at the old path', home.oldCard === false);
  const navSrc = await page.content();
  t('the capsule nav points at the module',
     /label:'Morning Report', href:'morning-report\/'/.test(navSrc));
  t('nothing in the homepage source still links the old path',
     !/href=['"]discussant-draw\//.test(navSrc) && !/href:'discussant-draw\//.test(navSrc));

  // ---- the old URL still works, and rescues a stranded roster ----------------
  await page.goto(BASE + '/discussant-draw/', { waitUntil: 'domcontentloaded' });
  const noRescue = await page.evaluate(() => ({
    rescueShown: !document.getElementById('rescue').hidden,
    hasRefresh: !!document.querySelector('meta[http-equiv="refresh"]'),
    canonical: (document.querySelector('link[rel=canonical]') || {}).href,
    link: !!document.querySelector('a[href="../morning-report/draw/"]')
  }));
  t('the old URL still serves a page', noRescue.link === true);
  t('with nothing stranded, it redirects on its own', noRescue.hasRefresh === true);
  t('and declares the new URL canonical', /morning-report\/draw\//.test(noRescue.canonical), noRescue.canonical);
  t('no rescue box when there is nothing to rescue', noRescue.rescueShown === false);

  // now strand a roster in that browser and reload
  await page.evaluate(() => {
    localStorage.setItem('sage.discussant-draw.pgy1', JSON.stringify({ names: ['Aisha Rahman','Ben Ortiz'], drawn: ['Ben Ortiz'] }));
    localStorage.setItem('sage.discussant-draw.senior', JSON.stringify({ names: ['Priya Menon'], drawn: [] }));
  });
  await page.goto(BASE + '/discussant-draw/', { waitUntil: 'domcontentloaded' });
  const rescue = await page.evaluate(() => ({
    shown: !document.getElementById('rescue').hidden,
    names: document.getElementById('names').textContent,
    refreshRemoved: !document.querySelector('meta[http-equiv="refresh"]')
  }));
  t('a stranded roster is surfaced rather than lost', rescue.shown === true);
  t('and lists both wheels', /Aisha Rahman/.test(rescue.names) && /Priya Menon/.test(rescue.names), rescue.names);
  t('and stops the auto-redirect so it can be copied', rescue.refreshRemoved === true);

  // ---- the module never writes localStorage ----------------------------------
  // Two keys are allowed there on purpose and neither is data: the
  // front-door code, and the shared-roster endpoint settings when
  // someone ticks "remember on this device". Everything else would be
  // state that the other site and the folder cannot see, which is the
  // thing this assertion exists to prevent.
  // Neither is data, and both are allowed everywhere this file counts
  // keys: the front-door code, and the shared-roster endpoint settings
  // when someone ticks "remember on this device". Anything else in
  // localStorage is state the other site and the folder cannot see,
  // which is what these assertions exist to prevent.
  const ALLOWED = ['sage-mr-gate', 'sage-mr-remote'];
  await page.evaluate(() => localStorage.clear());
  for (const p of ['/morning-report/draw/', '/morning-report/board/', '/morning-report/roster/']) {
    await page.goto(BASE + p, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
    await page.waitForTimeout(300);
  }
  const ls = await page.evaluate((allowed) => Object.keys(localStorage)
    .filter(k => !k.startsWith('__fakefs') && allowed.indexOf(k) === -1), ALLOWED);
  t('nothing in the module writes localStorage', ls.length === 0, ls);

  /* The feedback half keeps to the same rule, the way remote.js does:
     the tab holds an unsent draft, localStorage holds nothing at all
     unless a key was explicitly asked to be remembered. */
  await page.evaluate(() => localStorage.clear());
  for (const p of ['/morning-report/feedback/', '/morning-report/feedback/summary/']) {
    await page.goto(BASE + p, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
    await page.waitForTimeout(300);
  }
  await page.goto(BASE + '/morning-report/feedback/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    document.querySelector('input[name="r-overall"][value="4"]').click();
    const box = document.getElementById('c-overall');
    box.value = 'Ran long, but the intern committed.';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  const fb = await page.evaluate((allowed) => {
    const local = Object.keys(localStorage)
      .filter(k => !k.startsWith('__fakefs') && allowed.indexOf(k) === -1);
    // capsule-intro is the landing page's once-per-session flag (same origin,
    // visited earlier in this run); it is not the module's and not a draft.
    const session = Object.keys(sessionStorage).filter(k => !k.startsWith('__fake') && k !== 'capsule-intro');
    let draft = null;
    try { draft = JSON.parse(sessionStorage.getItem('mr.feedback.draft')); } catch (e) { /* none */ }
    return { local, session, draft };
  }, ALLOWED);
  t('the feedback half writes nothing to localStorage of its own', fb.local.length === 0, fb.local);
  t('the unsent draft is the tab\'s, and goes when the tab does',
     fb.session.every(k => /^mr\.(feedback|model)\./.test(k)) &&
     fb.session.indexOf('mr.feedback.draft') !== -1, fb.session);
  t('the draft it keeps is the form, and says nothing about who filled it in',
     fb.draft && fb.draft.overall.rating === 4 &&
     !Object.keys(fb.draft).some(k => /name|resident|author|user/i.test(k)),
     fb.draft && Object.keys(fb.draft));

  /* And the key only when asked. */
  await page.goto(BASE + '/morning-report/feedback/summary/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  const keyed = await page.evaluate((allowed) => {
    const mine = (store) => Object.keys(store)
      .filter(k => !k.startsWith('__fake') && allowed.indexOf(k) === -1);
    const set = (remember) => {
      document.getElementById('remember').checked = remember;
      document.getElementById('key').value = 'sk-ant-not-a-real-key';
      document.getElementById('key').dispatchEvent(new Event('input', { bubbles: true }));
      return { local: mine(localStorage), session: mine(sessionStorage) };
    };
    const tabOnly = set(false);
    const kept = set(true);
    document.getElementById('forget').click();
    return { tabOnly, kept, after: mine(localStorage) };
  }, ALLOWED);
  t('an unticked key lives in the tab and nowhere else',
     keyed.tabOnly.local.length === 0 && keyed.tabOnly.session.indexOf('mr.model.key') !== -1, keyed.tabOnly);
  t('a ticked key is the one thing written to the machine',
     keyed.kept.local.join(',') === 'mr.model.key', keyed.kept.local);
  t('and forgetting it takes it off the machine', keyed.after.length === 0, keyed.after);

  let failed = 0;
  for (const r of out) { if (!r.pass) failed++; console.log((r.pass?'PASS  ':'FAIL  ') + r.name + (r.extra?'   '+r.extra:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - failed) + '/' + out.length + ' passed');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
