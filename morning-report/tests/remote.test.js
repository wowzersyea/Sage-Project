const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

const ENDPOINT = 'https://endpoint.test/exec';
const KEY = 'test-key-123';

/* Invented people throughout. The folder and the endpoint deliberately
   disagree about the roster, so the merge rule is observable: the
   endpoint owns the people, the folder owns the log. */
const R = (id, name, level) => ({ id, name, sort_name: name.split(' ').reverse().join(', '),
                                  level, active: true, unavailable: [] });

const FOLDER_ROSTER = {
  academic_year: '2026-2027',
  residents: [
    R('r-1', 'Marisol Aguirre', 'PGY-1'),
    R('r-2', 'Teodoro Nunez', 'PGY-3'),
  ],
  log: [{ date: '2026-09-01', role: 'senior_discussant', resident: 'r-2' }],
  cycle: { senior_discussant: { drawn: ['r-2'] } },
  settings: { overdue_weeks: 8 },
};
/* One extra person, one renamed, and no log at all — an endpoint never
   carries the log. */
const SHARED_ROSTER = {
  source: 'sheet',
  academic_year: '2026-2027',
  residents: [
    R('r-1', 'Marisol Aguirre-Vega', 'PGY-1'),
    R('r-2', 'Teodoro Nunez', 'PGY-3'),
    R('r-3', 'Bronwen Kestrel', 'PGY-2'),
  ],
};

const DATE = '2026-09-03';
const SHARED_ROTATIONS = {
  source: 'sheet',
  academic_year: '2026-2027', from: DATE, to: DATE,
  tasks: ['GAL Ward Int', 'GAL Ward Sr', 'CLC Ward Int', 'CLC Ward Sr'],
  sites: {
    GAL: { label: 'Galveston', ward: ['GAL Ward Int', 'GAL Ward Sr'], other: [] },
    CLC: { label: 'Clear Lake', ward: ['CLC Ward Int', 'CLC Ward Sr'], other: [] },
  },
  days: { [DATE]: { 'GAL Ward Int': ['r-1'], 'GAL Ward Sr': ['r-2'], 'CLC Ward Sr': ['r-3'] } },
};
/* A folder copy that names a different day, so which one won is visible. */
const FOLDER_ROTATIONS = {
  academic_year: '2026-2027', from: DATE, to: DATE,
  tasks: ['GAL Ward Int'],
  sites: { GAL: { label: 'Galveston', ward: ['GAL Ward Int'], other: [] } },
  days: { [DATE]: { 'GAL Ward Int': ['r-2'] } },
};

/* The stubbed endpoint. Installed before any page script runs, passes
   everything that is not the endpoint through to the real fetch.

   What it answers is held in sessionStorage rather than in a variable,
   because addInitScript runs again on every navigation and a plain
   variable would reset the moment a test opened a page — which is
   exactly when the tests that matter most navigate. */
const stub = `
(function(){
  var SK = '__mrstub__';
  function saved(){
    try { return JSON.parse(sessionStorage.getItem(SK)) || {}; } catch (e) { return {}; }
  }
  var s = saved();
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
    if (m === 'http500') return Promise.resolve(new Response('nope', { status: 500 }));
    var body = m === 'denied' ? { status: 'denied' } : window.__mr.body;
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
  };
})();
`;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
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

  const setBody = (body) => page.evaluate(d => { window.__mr.body = d; }, body);
  const setMode = (m) => page.evaluate(x => { window.__mr.mode = x; }, m);
  const okBody = (extra) => Object.assign({
    status: 'ok', generated: '2026-08-24T12:00:00Z', warnings: [],
    roster: SHARED_ROSTER, rotations: SHARED_ROTATIONS
  }, extra || {});

  /* ---- 1. no endpoint configured: nothing changes ------------------ */

  await page.goto(BASE + '/morning-report/roster/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(BASE + '/morning-report/roster/', { waitUntil: 'networkidle' });
  await page.evaluate(async (d) => {
    await MRStore.whenReady; await MRStore.connect();
    await MRStore.write('roster.json', d);
  }, FOLDER_ROSTER);

  let r = await page.evaluate(async () => {
    const roster = await MRRoster.load();
    return {
      configured: MRRemote.configured(),
      calls: window.__mr.calls.length,
      names: roster.residents.map(p => p.name),
      shared: MRRoster.residentsAreShared(roster),
      summary: MRRemote.summary(),
    };
  });
  t('no endpoint: not configured', r.configured === false);
  t('no endpoint: nothing is fetched', r.calls === 0, r.calls);
  t('no endpoint: roster is the folder copy', r.names.join('|') === 'Marisol Aguirre|Teodoro Nunez', r.names);
  t('no endpoint: residents are not marked shared', r.shared === false);
  t('no endpoint: the bar says nothing', r.summary === null, r.summary);

  /* ---- 2. configured: the endpoint fills what the folder lacks ----- */

  await setBody(okBody());
  await page.evaluate(d => MRRemote.setSettings({ endpoint: d.e, key: d.k, remember: false }),
    { e: ENDPOINT, k: KEY });

  r = await page.evaluate(async () => {
    MRRemote.reload();
    const rot = await MRStore.read('rotations.json');
    return { rot: rot, calls: window.__mr.calls.length, url: window.__mr.calls[0].url };
  });
  t('endpoint supplies rotations the folder lacks', !!(r.rot && r.rot.days), r.rot && Object.keys(r.rot.days || {}));
  t('endpoint rotations carry the sites', !!(r.rot && r.rot.sites && r.rot.sites.CLC));
  t('the key is sent on the query string', r.url.indexOf('key=' + KEY) !== -1, r.url);

  /* one request serves every path asked for in a page load */
  r = await page.evaluate(async () => {
    MRRemote.reload();
    window.__mr.calls.length = 0;
    await Promise.all([MRStore.read('rotations.json'), MRStore.read('roster.json'), MRStore.read('rotations.json')]);
    return window.__mr.calls.length;
  });
  t('the fetch is made once per load, not once per read', r === 1, r);

  /* ---- 3. the folder wins ------------------------------------------ */

  await page.evaluate(async (d) => { await MRStore.write('rotations.json', d); }, FOLDER_ROTATIONS);
  r = await page.evaluate(async () => {
    MRRemote.reload();
    const rot = await MRStore.read('rotations.json');
    return rot.days['2026-09-03']['GAL Ward Int'];
  });
  t('folder rotations beat the endpoint', r.join() === 'r-2', r);

  /* ---- 4. the roster merge: endpoint owns people, folder owns log --- */

  await page.evaluate(async () => {
    /* a leave window set on the roster page, which the sheet has no column for */
    const r = await MRStore.read('roster.json');
    r.residents[0].unavailable = [{ from: '2026-10-01', to: '2026-10-14', why: 'leave' }];
    await MRStore.write('roster.json', r);
  });

  r = await page.evaluate(async () => {
    MRRemote.reload();
    const roster = await MRRoster.load();
    return {
      names: roster.residents.map(p => p.name),
      count: roster.residents.length,
      log: roster.log.length,
      cycle: (roster.cycle.senior_discussant || {}).drawn,
      unavail: (roster.residents.find(p => p.id === 'r-1') || {}).unavailable,
      shared: MRRoster.residentsAreShared(roster),
    };
  });
  t('merge: people come from the endpoint', r.count === 3 && r.names.indexOf('Bronwen Kestrel') !== -1, r.names);
  t('merge: a renamed resident takes the endpoint name', r.names.indexOf('Marisol Aguirre-Vega') !== -1, r.names);
  t('merge: the folder log survives', r.log === 1, r.log);
  t('merge: the folder cycle survives', (r.cycle || []).join() === 'r-2', r.cycle);
  t('merge: unavailable windows survive', (r.unavail || []).length === 1, r.unavail);
  t('merge: the roster is marked shared', r.shared === true);

  /* the roster page says so rather than letting someone edit into the void */
  await page.goto(BASE + '/morning-report/roster/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('yearline').textContent.length > 0);
  t('the roster page warns that people are shared',
    await page.isVisible('#sharedwarn'));

  /* ---- 5. a refused key degrades, it does not break ----------------- */

  await setMode('denied');
  r = await page.evaluate(async () => {
    MRRemote.reload();
    const roster = await MRRoster.load();
    const rot = await MRStore.read('rotations.json');
    return {
      names: roster.residents.map(p => p.name),
      shared: MRRoster.residentsAreShared(roster),
      rotFromFolder: rot.days['2026-09-03']['GAL Ward Int'],
      summary: MRRemote.summary(),
      denied: MRRemote.status().denied,
    };
  });
  t('denied: the folder roster is used', r.names.join('|') === 'Marisol Aguirre|Teodoro Nunez', r.names);
  t('denied: nothing is marked shared', r.shared === false);
  t('denied: the folder still answers for rotations', r.rotFromFolder.join() === 'r-2');
  t('denied: the bar says the key was refused', r.summary.kind === 'err' && /refused/.test(r.summary.text), r.summary);
  t('denied: status reports it', r.denied === true);

  /* ---- 6. an unreachable endpoint does the same -------------------- */

  for (const mode of ['network', 'http500']) {
    await setMode(mode);
    r = await page.evaluate(async () => {
      MRRemote.reload();
      const roster = await MRRoster.load();
      return { n: roster.residents.length, kind: MRRemote.summary().kind, err: MRRemote.status().error };
    });
    t(mode + ': the folder roster still loads', r.n === 2, r.n);
    t(mode + ': the bar shows a problem', r.kind === 'err');
    t(mode + ': there is a reason to show', !!r.err, r.err);
  }

  /* ---- 7. only the two name-bearing paths ever go to the endpoint --- */

  await setMode('ok');
  r = await page.evaluate(async () => {
    MRRemote.reload();
    window.__mr.calls.length = 0;
    const a = await MRStore.read('sessions/2026-09-03.json');
    const b = await MRStore.read('casebank/nope.json');
    return { calls: window.__mr.calls.length, a: a, b: b };
  });
  t('session data never reaches the endpoint', r.calls === 0, r.calls);
  t('a missing session file is still null', r.a === null && r.b === null);

  /* ---- 8. the key is not persisted unless asked -------------------- */

  r = await page.evaluate(() => ({
    local: localStorage.getItem('sage-mr-remote'),
    session: sessionStorage.getItem('sage-mr-remote'),
  }));
  t('the key is not in localStorage by default', r.local === null, r.local);
  t('the key is in sessionStorage for this tab', !!r.session && r.session.indexOf(KEY) !== -1);

  r = await page.evaluate((d) => {
    MRRemote.setSettings({ endpoint: d.e, key: d.k, remember: true });
    return { local: localStorage.getItem('sage-mr-remote'), session: sessionStorage.getItem('sage-mr-remote') };
  }, { e: ENDPOINT, k: KEY });
  t('remember moves it to localStorage', !!r.local && r.local.indexOf(KEY) !== -1);
  t('remember leaves nothing behind in sessionStorage', r.session === null, r.session);

  r = await page.evaluate(() => {
    MRRemote.forget();
    return {
      local: localStorage.getItem('sage-mr-remote'),
      session: sessionStorage.getItem('sage-mr-remote'),
      configured: MRRemote.configured(),
    };
  });
  t('forget clears both stores', r.local === null && r.session === null, r);
  t('forget leaves it unconfigured', r.configured === false);

  /* ---- 9. an http endpoint is refused before it is stored ---------- */

  r = await page.evaluate(() => ({
    http: MRRemote.validate('http://example.com/exec'),
    nonsense: MRRemote.validate('not a url'),
    fine: MRRemote.validate('https://example.com/exec'),
  }));
  t('http endpoints are refused', /https/.test(r.http), r.http);
  t('nonsense is refused', !!r.nonsense, r.nonsense);
  t('an https endpoint passes', r.fine === '', r.fine);

  /* ---- 10. publish sends the folder copy, keyed ---------------------- */

  await page.evaluate((d) => MRRemote.setSettings({ endpoint: d.e, key: d.k, remember: false }),
    { e: ENDPOINT, k: KEY });
  await page.evaluate(() => { window.__mr.body = { status: 'ok', wrote: { roster: 2, rota: 1, sites: 1 }, warnings: [] }; });

  r = await page.evaluate(async () => {
    window.__mr.calls.length = 0;
    const roster = await MRStore.read('roster.json');
    const rot = await MRStore.read('rotations.json');
    const res = await MRRemote.publish({ roster: roster, rotations: rot });
    const call = window.__mr.calls[0];
    const sent = JSON.parse(call.body);
    return { ok: res.ok, wrote: res.wrote, method: call.method, key: sent.key,
             people: sent.roster.residents.length, days: Object.keys(sent.rotations.days).length };
  });
  t('publish posts', r.method === 'POST', r.method);
  t('publish carries the key', r.key === KEY);
  t('publish carries the roster', r.people === 2, r.people);
  t('publish carries the rota', r.days === 1, r.days);
  t('publish reports what was written', r.ok === true && r.wrote.rota === 1, r.wrote);

  /* the publish page refuses to send the endpoint's own copy back */
  await page.goto(BASE + '/morning-report/publish/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !/Checking/.test(document.getElementById('c-roster').textContent));
  t('the publish page counts what is in the folder',
    /2 residents/.test(await page.textContent('#c-roster')),
    await page.textContent('#c-roster'));
  t('the publish page offers a paste fallback',
    (await page.inputValue('#tsv-roster')).split('\n').length === 3);

  /* ---- 11. the settings page renders the state --------------------- */

  await page.goto(BASE + '/morning-report/settings/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !/Checking/.test(document.getElementById('state-txt').textContent));
  t('settings shows connected', /Connected/.test(await page.textContent('#state-txt')),
    await page.textContent('#state-txt'));
  t('settings does not print the key in the page',
    !(await page.content()).includes(KEY + '"'));

  await setBody(okBody({ warnings: ['No one in the Roster tab is called "Nobody Here".'] }));
  await page.click('#recheck');
  await page.waitForFunction(() => document.getElementById('state-txt').textContent.indexOf('warning') !== -1);
  t('settings lists the endpoint warnings',
    /Nobody Here/.test(await page.textContent('#warns')));

  /* ---- 12. remote.js itself failing to load ------------------------

     It happened: a 404 was cached at the CDN for the four hours after
     a deploy, and every page fetched it. The tools shrugged, because
     every call site guards — but the two pages built around it threw
     on the first line and left a dead form with no explanation.

     Blocking the request reproduces exactly that.
     ------------------------------------------------------------------- */

  {
    const ctx = await b.newContext();
    const p2 = await ctx.newPage();
    const broke = [];
    p2.on('pageerror', e => broke.push(e.message));
    await p2.route('**/assets/remote.js*', route => route.fulfill({ status: 404, body: 'not found' }));

    for (const path of ['/morning-report/', '/morning-report/draw/', '/morning-report/roster/']) {
      broke.length = 0;
      await p2.goto(BASE + path, { waitUntil: 'networkidle' });
      t('without remote.js, ' + path + ' still works', broke.length === 0, broke);
      t('and its bar still renders',
        (await p2.textContent('#mr-bar')).trim().length > 0);
    }

    broke.length = 0;
    await p2.goto(BASE + '/morning-report/settings/', { waitUntil: 'networkidle' });
    t('without remote.js, settings says so instead of throwing', broke.length === 0, broke);
    t('and names the file that did not load',
      /remote\.js/.test(await p2.textContent('#state-txt')), await p2.textContent('#state-txt'));
    t('and disables the controls rather than leaving them dead',
      await p2.isDisabled('#save'));
    t('and keeps its way back', (await p2.textContent('#mr-bar')).trim().length > 0);

    broke.length = 0;
    await p2.goto(BASE + '/morning-report/publish/', { waitUntil: 'networkidle' });
    t('without remote.js, publish says so instead of throwing', broke.length === 0, broke);
    t('and refuses to publish', await p2.isDisabled('#go'));

    await ctx.close();
  }

  /* ---- report ------------------------------------------------------- */

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
