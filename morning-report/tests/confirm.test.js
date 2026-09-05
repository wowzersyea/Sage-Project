/* The chicken dinner button.

   Both wheels land, one press writes the pair to the shared sheet, and
   a chief who never connected a data folder still leaves a record. What
   this holds down is mostly the timing: it must not offer itself after
   one wheel, it must re-arm when a re-spin changes the answer, and it
   must say why rather than sit there dead when there is nowhere to
   write to.

   Invented people throughout. */

const { chromium } = require('playwright');
const { launchOptions } = require('./browser');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

const ENDPOINT = 'https://endpoint.test/exec';
const KEY = 'test-key-123';
const DATE = '2026-09-03';

const R = (id, name, level) => ({ id, name, sort_name: name.split(' ').reverse().join(', '),
                                  level, active: true, unavailable: [] });
const ROSTER = {
  academic_year: '2026-2027',
  residents: [
    R('r-1', 'Marisol Aguirre', 'PGY-1'),
    R('r-2', 'Rashid Chaudhry', 'PGY-1'),
    R('r-3', 'Teodoro Nunez', 'PGY-3'),
    R('r-4', 'Bronwen Kestrel', 'PGY-2'),
    R('r-5', 'Anouk Vandal', 'PGY-2'),
    R('r-6', 'Kwabena Asante', 'PGY-3'),
  ],
  log: [], cycle: {}, settings: { overdue_weeks: 8 },
};

const stub = `
(function(){
  var SK = '__mrstub__';
  function saved(){ try { return JSON.parse(sessionStorage.getItem(SK)) || {}; } catch(e){ return {}; } }
  window.__mr = {
    calls: [],
    get mode(){ return saved().mode || 'ok'; },
    set mode(v){ var o = saved(); o.mode = v; sessionStorage.setItem(SK, JSON.stringify(o)); },
    get body(){ var b = saved().body; return b === undefined ? null : b; },
    set body(v){ var o = saved(); o.body = v; sessionStorage.setItem(SK, JSON.stringify(o)); },
  };
  var real = window.fetch.bind(window);
  window.fetch = function(url, opts){
    var u = String(url && url.url ? url.url : url);
    if (u.indexOf(${JSON.stringify(ENDPOINT)}) !== 0) return real(url, opts);
    window.__mr.calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body });
    var m = window.__mr.mode;
    if (m === 'network') return Promise.reject(new Error('network down'));
    var body = m === 'denied' ? { status: 'denied' } : window.__mr.body;
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
  };
})();
`;

(async () => {
  const b = await chromium.launch(launchOptions());
  const page = await (await b.newContext()).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => {
    const u = (m.location() && m.location().url) || '';
    if (m.type() === 'error' && !/googletagmanager|favicon|ERR_/.test(m.text() + ' ' + u)) errs.push('console: ' + m.text());
  });
  await page.addInitScript(fake);
  await page.addInitScript(stub);

  const out = [];
  const t = (n, c, x) => out.push({ n, p: !!c, x: x === undefined ? '' : JSON.stringify(x) });

  /* Waiting on `winner !== null` only works for the first spin — on a
     re-spin it is already set, so the wait returns instantly and the
     test reads the old winner mid-spin. Wait for the spin to start and
     then to finish. */
  const spin = async (which) => {
    await page.evaluate(k => { document.querySelector('#col-' + k + ' .btn-spin').click(); }, which);
    await page.waitForFunction(k => wheels[k].spinning === true, which, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(k => wheels[k].spinning === false && wheels[k].winner !== null,
      which, { timeout: 25000 });
    await page.waitForTimeout(150);          /* the save resolves, then the bar re-renders */
  };

  /* ---- seed a folder so the wheels have people -------------------- */

  await page.goto(BASE + '/morning-report/roster/', { waitUntil: 'networkidle' });
  await page.evaluate(async (d) => {
    await MRStore.whenReady; await MRStore.connect();
    await MRStore.write('roster.json', d);
  }, ROSTER);

  /* ---- with no endpoint: the button explains itself ---------------- */

  await page.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.wheels && wheels.pgy1);
  await page.fill('#s-date', DATE);
  await page.evaluate(() => document.getElementById('s-date').dispatchEvent(new Event('change')));

  t('nothing is offered before any spin', !(await page.isVisible('#confirm')));

  await spin('pgy1');
  t('nothing is offered after one wheel', !(await page.isVisible('#confirm')),
    await page.textContent('#confirm-names').catch(() => ''));

  await spin('senior');
  t('both wheels landed shows the bar', await page.isVisible('#confirm'));
  t('and names both people',
    (await page.textContent('#confirm-names')).split('discussant:').length === 3,
    await page.textContent('#confirm-names'));
  t('with no endpoint it refuses rather than sitting dead', await page.isDisabled('#confirmBtn'));
  t('and says why', /no shared sheet/i.test(await page.textContent('#confirm-note')),
    await page.textContent('#confirm-note'));

  /* ---- with an endpoint ------------------------------------------- */

  await page.evaluate(d => {
    MRRemote.setSettings({ endpoint: d.e, key: d.k, remember: false });
    window.__mr.body = { status: 'ok', date: d.date, wrote: 2, replaced: 0 };
  }, { e: ENDPOINT, k: KEY, date: DATE });
  await page.evaluate(() => renderConfirm());

  t('with an endpoint the button is live', !(await page.isDisabled('#confirmBtn')));

  const before = await page.evaluate(() => ({
    pgy1: wheels.pgy1.winner.id, senior: wheels.senior.winner.id,
  }));

  await page.evaluate(() => { window.__mr.calls.length = 0; });
  await page.click('#confirmBtn');
  await page.waitForFunction(() => document.getElementById('confirmBtn').textContent.indexOf('Recorded') !== -1,
    null, { timeout: 10000 });

  const sent = await page.evaluate(() => JSON.parse(window.__mr.calls[0].body));
  t('it posts a draw', sent.action === 'draw');
  t('for the date on the page', sent.date === DATE, sent.date);
  t('with both wheels', sent.entries.length === 2, sent.entries);
  t('carrying the ids the wheels landed on',
    sent.entries.map(e => e.resident_id).sort().join() === [before.pgy1, before.senior].sort().join(),
    sent.entries.map(e => e.resident_id));
  t('and both roles', sent.entries.map(e => e.role).sort().join() === 'pgy1_discussant,senior_discussant',
    sent.entries.map(e => e.role));

  t('the button reports it is done', await page.isDisabled('#confirmBtn'));
  t('and the bar changes state', /saved/.test(await page.getAttribute('#confirm', 'class')));

  /* ---- a re-spin re-arms it ---------------------------------------

     Only when it lands on somebody else: re-spinning onto the same
     person is the same morning, and the button correctly stays put.
     So spin until the answer actually changes rather than assuming one
     spin will do it. */

  const wasSenior = await page.evaluate(() => wheels.senior.winner.id);
  let changed = false;
  for (let i = 0; i < 8 && !changed; i++) {
    await spin('senior');
    changed = (await page.evaluate(() => wheels.senior.winner.id)) !== wasSenior;
  }
  t('a re-spin eventually lands on somebody else', changed);
  t('re-spinning a wheel re-arms the button', !(await page.isDisabled('#confirmBtn')));
  t('and the bar drops out of its recorded state',
    !/saved/.test(await page.getAttribute('#confirm', 'class')));
  t('and the new name is shown',
    (await page.textContent('#confirm-names')).indexOf(
      await page.evaluate(() => wheels.senior.winner.name)) !== -1);

  /* ---- changing the date is a different morning -------------------- */

  await page.evaluate(() => { window.__mr.calls.length = 0; });
  await page.click('#confirmBtn');
  await page.waitForFunction(() => document.getElementById('confirmBtn').textContent.indexOf('Recorded') !== -1,
    null, { timeout: 10000 });
  t('it can be confirmed again after a re-spin', await page.isDisabled('#confirmBtn'));

  await page.fill('#s-date', '2026-09-04');
  await page.evaluate(() => document.getElementById('s-date').dispatchEvent(new Event('change')));
  t('a new date re-arms it', !(await page.isDisabled('#confirmBtn')));

  /* Back to a date already confirmed with the same two people, and it
     correctly reads as recorded again rather than inviting a rewrite. */
  await page.fill('#s-date', DATE);
  await page.evaluate(() => document.getElementById('s-date').dispatchEvent(new Event('change')));
  t('returning to a confirmed morning shows it as recorded', await page.isDisabled('#confirmBtn'));

  /* ---- failures are reported, not swallowed ------------------------ */

  await spin('pgy1');                       /* re-arm by changing the answer */
  await page.evaluate(() => { window.__mr.mode = 'denied'; });
  await page.click('#confirmBtn');
  await page.waitForFunction(() => /key/i.test(document.getElementById('confirm-note').textContent),
    null, { timeout: 10000 });
  t('a refused key is shown on the bar', /key/i.test(await page.textContent('#confirm-note')));
  t('and the button comes back so it can be retried', !(await page.isDisabled('#confirmBtn')));
  t('and it is not marked recorded', !/saved/.test(await page.getAttribute('#confirm', 'class')));

  await page.evaluate(() => { window.__mr.mode = 'network'; });
  await page.click('#confirmBtn');
  await page.waitForFunction(() => !/Writing/.test(document.getElementById('confirm-note').textContent),
    null, { timeout: 10000 });
  t('an unreachable endpoint is shown too', (await page.textContent('#confirm-note')).length > 0);
  t('and is still retryable', !(await page.isDisabled('#confirmBtn')));

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
