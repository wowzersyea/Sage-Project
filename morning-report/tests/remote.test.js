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

  /* This used to assert that sessions/ and casebank/ never reached the
     endpoint, which was true until the shared document store existed.
     They deliberately do now — that is what lets a device with no
     folder open a board archive somebody else wrote.

     The guarantee that did NOT change is the one worth keeping here:
     the identified lanes stay on the machine that made them. They are
     swept at seven days, and a copy at the endpoint would outlive the
     sweep. */
  r = await page.evaluate(async () => {
    MRRemote.reload();
    window.__mr.calls.length = 0;
    const a = await MRStore.read('working/2026-09-03.json');
    const b = await MRStore.read('manifests/2026-09-03.json');
    const c = await MRStore.read('working-board.json');
    return { calls: window.__mr.calls.length, a: a, b: b, c: c };
  });
  t('identified work never reaches the endpoint', r.calls === 0, r.calls);
  t('and an absent one is null rather than undefined',
    r.a === null && r.b === null && r.c === null, [r.a, r.b, r.c]);

  /* A permanent artifact does go, and an absent one is still null —
     which is the case the null coercion in docGet exists for. */
  r = await page.evaluate(async () => {
    MRRemote.reload();
    window.__mr.calls.length = 0;
    const a = await MRStore.read('sessions/2026-09-03.json');
    return { calls: window.__mr.calls.length, a: a };
  });
  t('a permanent artifact is looked for at the endpoint', r.calls > 0, r.calls);
  t('and an endpoint with nothing to say still reads as null', r.a === null, r.a);

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

  /* ---- 11b. the two states setup actually passes through -----------

     Both were reported from a real setup. Neither was wrong about the
     facts; both described the situation in a way that sent someone
     looking for a problem that was not there.
     ------------------------------------------------------------------- */

  {
    /* A deployed script over a sheet nobody has published to yet. The
       endpoint answers, correctly, that all three tabs are empty. */
    await setBody({
      status: 'ok', generated: '2026-08-24T12:00:00Z',
      warnings: ['The Roster tab is empty.', 'The Rota tab has no rows.',
                 'The Sites tab is empty, so no presenting-site filter will apply.'],
      roster: { source: 'sheet', residents: [] }, rotations: null,
    });
    await page.goto(BASE + '/morning-report/settings/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !/Checking/.test(document.getElementById('state-txt').textContent));

    const txt = await page.textContent('#state-txt');
    t('an empty sheet is not reported as N warnings', !/\d warnings/.test(txt), txt);
    t('it says the sheet is empty', /empty/i.test(txt), txt);
    t('and points at the fix', await page.isVisible("#state-txt a[href='../publish/']"));
    t('isEmpty agrees', await page.evaluate(() => MRRemote.isEmpty()) === true);
    t('the bar says so too',
      (await page.evaluate(() => MRRemote.summary())).text === 'Shared roster: sheet is empty');

    /* and once it has content, the count is the headline, not a warning count */
    await setBody(okBody());
    await page.click('#recheck');
    await page.waitForFunction(() => /resident/.test(document.getElementById('state-txt').textContent));
    const txt2 = await page.textContent('#state-txt');
    t('a filled sheet reports what it holds', /3 residents/.test(txt2), txt2);
    t('and how many days', /1 days/.test(txt2), txt2);
    t('isEmpty disagrees now', await page.evaluate(() => MRRemote.isEmpty()) === false);
  }

  {
    /* The publish page with no folder connected. It used to say the
       files were "not in this folder", which is true of a folder that
       does not exist and is not what anyone needs to hear. */
    const ctx = await b.newContext();
    const p3 = await ctx.newPage();
    await p3.addInitScript(fake);
    await p3.addInitScript(stub);
    await p3.goto(BASE + '/morning-report/publish/', { waitUntil: 'networkidle' });
    await p3.waitForFunction(() => !/Checking/.test(document.getElementById('c-roster').textContent));

    t('with no folder, publish does not claim the file is missing',
      !/Not in/.test(await p3.textContent('#c-roster')), await p3.textContent('#c-roster'));
    t('it says it is waiting on the folder',
      /Waiting for the data folder/.test(await p3.textContent('#c-roster')));
    t('it explains that none is connected',
      /No data folder is connected/.test(await p3.textContent('#out')), await p3.textContent('#out'));
    t('and offers the button that fixes it',
      /Connect data folder/.test(await p3.textContent('#out button')));
    t('publishing is refused meanwhile', await p3.isDisabled('#go'));

    /* connected, but genuinely without the files: a different sentence */
    await p3.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
    await p3.evaluate(() => window.dispatchEvent(new Event('resize')));
    await p3.reload({ waitUntil: 'networkidle' });
    await p3.waitForFunction(() => !/Checking|Waiting/.test(document.getElementById('c-roster').textContent));
    t('with a folder but no roster.json, it says which folder it looked in',
      /Not in/.test(await p3.textContent('#c-roster')), await p3.textContent('#c-roster'));

    await ctx.close();
  }

  /* ---- 11c. confirming the morning --------------------------------

     The half that lets a chief with no data folder leave a record: both
     wheels land, one press writes the pair to the sheet.
     ------------------------------------------------------------------- */

  {
    await page.evaluate(d => MRRemote.setSettings({ endpoint: d.e, key: d.k, remember: false }),
      { e: ENDPOINT, k: KEY });
    await setMode('ok');
    await setBody({ status: 'ok', date: DATE, wrote: 2, replaced: 0 });

    const r2 = await page.evaluate(async (date) => {
      window.__mr.calls.length = 0;
      const res = await MRRemote.confirmDraw({
        date: date, site: 'Galveston', presenting: 'GAL',
        entries: [
          { role: 'pgy1_discussant', resident_id: 'r-1', name: 'Marisol Aguirre' },
          { role: 'senior_discussant', resident_id: 'r-2', name: 'Teodoro Nunez' },
        ],
      });
      const sent = JSON.parse(window.__mr.calls[0].body);
      return { res: res, method: window.__mr.calls[0].method, sent: sent };
    }, DATE);

    t('confirming posts', r2.method === 'POST');
    t('it is marked as a draw, not a seed', r2.sent.action === 'draw', r2.sent.action);
    t('it carries the key', r2.sent.key === KEY);
    t('it carries both people', r2.sent.entries.length === 2, r2.sent.entries);
    t('it carries the date and the presenting site',
      r2.sent.date === DATE && r2.sent.presenting === 'GAL', [r2.sent.date, r2.sent.presenting]);
    t('and reports what was written', r2.res.ok === true && r2.res.wrote === 2, r2.res);

    /* Nothing to record is refused here rather than at the far end. */
    const empty = await page.evaluate((date) => MRRemote.confirmDraw({ date: date, entries: [] }), DATE);
    t('an empty draw is refused before it is sent', empty.ok === false, empty);
    const blank = await page.evaluate((date) =>
      MRRemote.confirmDraw({ date: date, entries: [{ role: 'r', resident_id: '', name: '' }] }), DATE);
    t('a draw of blank entries is refused too', blank.ok === false, blank);

    await setMode('denied');
    const denied = await page.evaluate((date) => MRRemote.confirmDraw({
      date: date, entries: [{ role: 'r', resident_id: 'r-1', name: 'n' }] }), DATE);
    t('a refused key surfaces as an error, not a crash',
      denied.ok === false && /key/i.test(denied.error), denied);

    await setMode('network');
    const down = await page.evaluate((date) => MRRemote.confirmDraw({
      date: date, entries: [{ role: 'r', resident_id: 'r-1', name: 'n' }] }), DATE);
    t('an unreachable endpoint does the same', down.ok === false && !!down.error, down);
    await setMode('ok');
  }

  /* ---- 11d. confirmed draws feed the equity table ------------------

     The point of folding them into the log: a draw confirmed on a
     borrowed laptop has to show up in everyone's equity view, or the
     shared record and the local one disagree about who is overdue.
     ------------------------------------------------------------------- */

  {
    /* the settings page has no roster.js; the merge lives there */
    await page.goto(BASE + '/morning-report/roster/', { waitUntil: 'networkidle' });

    const merged = await page.evaluate(() => {
      const local = [{ date: '2026-09-01', site: '', resident_id: 'r-2',
                       role: 'senior_discussant', feedback_sent: true }];
      const draws = [
        /* the same entry the folder already has, with no feedback flag */
        { date: '2026-09-01', site: '', role: 'senior_discussant', resident: 'r-2', name: 'T' },
        /* one only the sheet knows about */
        { date: '2026-09-03', site: 'Galveston', role: 'pgy1_discussant', resident: 'r-1', name: 'M' },
        /* an acting intern: named in the sheet, no id, never a resident's turn */
        { date: '2026-09-03', site: 'Galveston', role: 'pgy1_discussant', resident: '', name: 'Student' },
      ];
      const out = MRRoster.mergeLog(local, draws);
      return {
        n: out.length,
        keptFeedback: out.filter(e => e.date === '2026-09-01')[0].feedback_sent,
        dupes: out.filter(e => e.date === '2026-09-01').length,
        added: out.filter(e => e.date === '2026-09-03').map(e => e.resident_id),
      };
    });
    t('a draw only the sheet knows about is added', merged.added.join() === 'r-1', merged.added);
    t('one the folder already has is not duplicated', merged.dupes === 1, merged.dupes);
    t('and the folder copy wins, keeping feedback_sent', merged.keptFeedback === true);
    t('an acting intern is never folded into a resident log', merged.n === 2, merged.n);

    /* end to end: the endpoint carries draws, and the roster load folds
       them in without a folder entry for them */
    await setBody(okBody({ roster: Object.assign({}, SHARED_ROSTER, { draws: [
      { date: '2026-09-10', site: 'Clear Lake', role: 'senior_discussant', resident: 'r-3', name: 'B' },
    ] }) }));
    const loaded = await page.evaluate(async () => {
      MRRemote.reload();
      const r = await MRRoster.load();
      const e = r.log.filter(x => x.date === '2026-09-10')[0];
      return { has: !!e, from: e && e.source, id: e && e.resident_id };
    });
    t('a confirmed draw reaches the roster log on load', loaded.has === true, loaded);
    t('marked as coming from the sheet', loaded.from === 'shared');
    t('with the right resident', loaded.id === 'r-3');

    await setBody(okBody());
  }

  /* ---- 11e. the one-tap link --------------------------------------

     The setup step was the whole complaint: every browser had to be
     told the endpoint by hand, so a phone showed no roster. A link that
     carries both means a device is connected by opening it.

     Driven in its own context, because "a device that has never been
     told anything" is the case that matters.
     ------------------------------------------------------------------- */

  {
    const ctx = await b.newContext();
    const p5 = await ctx.newPage();
    await p5.addInitScript(fake);
    await p5.addInitScript(stub);
    await setBody(okBody());

    /* nothing configured: no chip at all, which is what the phone showed */
    await p5.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });
    t('a fresh device starts with no shared roster',
      await p5.evaluate(() => MRRemote.configured() === false && MRRemote.summary() === null));

    /* build the link on a configured machine */
    await page.evaluate(d => MRRemote.setSettings({ endpoint: d.e, key: d.k, remember: false }),
      { e: ENDPOINT, k: KEY });
    await page.goto(BASE + '/morning-report/settings/', { waitUntil: 'networkidle' });
    const link = await page.evaluate(() => {
      document.getElementById('copyfull').click();
      return document.getElementById('rosterqr').querySelector('svg') ? 'has-qr' : 'no-qr';
    });
    t('the one-tap link gets a scannable code beside it', link === 'has-qr', link);

    /* open it on the fresh device: nothing typed */
    const oneTap = BASE + '/morning-report/settings/#e=' + encodeURIComponent(ENDPOINT) +
      '&k=' + encodeURIComponent(KEY);
    await p5.goto(oneTap, { waitUntil: 'networkidle' });
    await p5.waitForFunction(() => window.MRRemote && MRRemote.configured(), null, { timeout: 5000 });

    t('opening it connects the device', await p5.evaluate(() => MRRemote.configured()));
    t('and it carries the right endpoint and key',
      await p5.evaluate((d) => MRRemote.settings().endpoint === d.e && MRRemote.settings().key === d.k,
        { e: ENDPOINT, k: KEY }));
    t('and remembers, so it is genuinely once per device',
      await p5.evaluate(() => MRRemote.settings().remember === true));
    t('the key is taken out of the address bar afterwards',
      await p5.evaluate(() => location.hash === ''), await p5.evaluate(() => location.hash));

    /* and the roster is actually there on the next page it opens.
       The stubbed endpoint keeps its canned answer in sessionStorage,
       which is per-context, so this context needs its own copy — the
       page under test is unaffected either way. */
    await p5.evaluate(d => { window.__mr.body = d; }, okBody());
    await p5.goto(BASE + '/morning-report/roster/', { waitUntil: 'networkidle' });
    const seen = await p5.evaluate(async () => {
      const r = await MRRoster.load();
      return { n: r.residents.length, shared: MRRoster.residentsAreShared(r) };
    });
    t('a device set up by link sees the shared roster', seen.n === 3 && seen.shared === true, seen);

    /* a link with only the endpoint still asks for the key */
    const ctx6 = await b.newContext();
    const p6 = await ctx6.newPage();
    await p6.addInitScript(fake);
    await p6.addInitScript(stub);
    await p6.goto(BASE + '/morning-report/settings/#e=' + encodeURIComponent(ENDPOINT),
      { waitUntil: 'networkidle' });
    t('a link without a key fills the address and stops there',
      await p6.evaluate(() => MRRemote.configured() === false &&
        document.getElementById('endpoint').value.length > 0));

    /* a malformed one changes nothing rather than half-connecting */
    await p6.goto(BASE + '/morning-report/settings/#e=' + encodeURIComponent('http://insecure.test/exec') +
      '&k=' + encodeURIComponent(KEY), { waitUntil: 'networkidle' });
    t('an http endpoint in a link is refused', await p6.evaluate(() => MRRemote.configured() === false));

    await ctx.close();
    await ctx6.close();
  }

  /* ---- 11f. the site's built-in roster (option A) ------------------

     A device with nothing set up at all opens the wheel and sees the
     names, because the site carries the public endpoint and the
     endpoint owner switched the public subset on. What matters here:
     it reads and never writes, a configured device is untouched, and
     switching it off at the endpoint degrades with a sentence.
     ------------------------------------------------------------------- */

  {
    const PUB_BODY = {
      status: 'ok', public: true, generated: '2026-08-25T12:00:00Z', warnings: [],
      roster: { source: 'sheet', academic_year: '2026-2027',
        residents: SHARED_ROSTER.residents.map(r => Object.assign({}, r, { unavailable: [] })) },
      rotations: null,
    };

    const ctx = await b.newContext();
    const p7 = await ctx.newPage();
    p7.on('pageerror', e => errs.push('pageerror: ' + e.message));
    await p7.addInitScript(fake);
    await p7.addInitScript('window.MR_PUBLIC_ENDPOINT = ' + JSON.stringify(ENDPOINT) + ';');
    await p7.addInitScript(stub);
    await p7.goto(BASE + '/morning-report/roster/', { waitUntil: 'networkidle' });
    await p7.evaluate(d => { window.__mr.body = d; }, PUB_BODY);

    const r7 = await p7.evaluate(async () => {
      MRRemote.reload();
      const roster = await MRRoster.load();
      return {
        configured: MRRemote.configured(),
        names: roster.residents.length,
        pub: MRRemote.status().public,
        chip: MRRemote.summary(),
      };
    });
    t('a bare device gets the roster from the site itself', r7.names === 3, r7.names);
    t('without being configured', r7.configured === false);
    t('and knows it is the public subset', r7.pub === true);
    t('the bar says view only', /view only/.test((r7.chip || {}).text || ''), r7.chip);

    /* the wheel itself */
    await p7.evaluate(d => { window.__mr.body = d; }, PUB_BODY);
    await p7.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });
    await p7.waitForFunction(() => window.wheels && wheels.pgy1 && wheels.pgy1.people.length > 0,
      null, { timeout: 8000 });
    t('the wheel has people on a device with nothing set up',
      await p7.evaluate(() => wheels.pgy1.people.length > 0 && wheels.senior.people.length > 0));

    /* it must never write: no doc actions, no draw confirmations */
    const wrote = await p7.evaluate(async () => {
      window.__mr.calls.length = 0;
      await MRStore.write('sessions/x.json', { a: 1 });
      const res = await MRRemote.confirmDraw({ date: '2026-09-03',
        entries: [{ role: 'r', resident_id: 'r-1', name: 'n' }] });
      return { calls: window.__mr.calls.map(c => c.method), confirm: res.ok };
    });
    t('a public device never writes to the endpoint', wrote.calls.length === 0, wrote.calls);
    t('confirming a draw is refused with a sentence', wrote.confirm === false);

    /* the endpoint owner switches it off: a sentence, not a blank */
    const off = await p7.evaluate(async () => {
      window.__mr.mode = 'denied';
      MRRemote.reload();
      await MRRemote.fetchAll();
      return MRRemote.status().error;
    });
    t('switched off at the endpoint reads as switched off, not as a bad key',
      /switched off/.test(off), off);
    await p7.evaluate(() => { window.__mr.mode = 'ok'; });

    /* a configured device on the same build is untouched */
    await p7.evaluate(d => {
      MRRemote.setSettings({ endpoint: d.e, key: d.k, remember: false });
      window.__mr.body = d.body;
    }, { e: ENDPOINT, k: KEY, body: okBody() });
    const keyed = await p7.evaluate(async () => {
      MRRemote.reload();
      window.__mr.calls.length = 0;
      const rot = await MRStore.read('rotations.json');
      return { hasRota: !!(rot && rot.days), url: window.__mr.calls[0].url,
               pub: MRRemote.status().public };
    });
    t('a configured device still sends its key', /key=/.test(keyed.url), keyed.url);
    t('and still gets the rota', keyed.hasRota === true);
    t('and is not marked public', keyed.pub === false);

    await ctx.close();
  }

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
