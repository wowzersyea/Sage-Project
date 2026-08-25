/* The shared document store, from the browser's side.

   The case this exists for: a device that has no data folder and cannot
   get one. It must be able to open a board archive somebody else wrote,
   save a scorecard, and have the review game and the group report see
   what is there — without anybody picking a folder.

   And the case that must never happen: identified work reaching it.
   working/ and manifests/ are swept at seven days on the machine that
   holds them, and a copy in Drive would outlive that quietly.

   Invented people and cases throughout. */

const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

const ENDPOINT = 'https://endpoint.test/exec';
const KEY = 'test-key-123';

/* An in-memory stand-in for the endpoint's document store: it answers
   the four doc actions against a plain object, so the browser side is
   exercised end to end without a network. */
const stub = `
(function(){
  var SK = '__docstub__';
  function load(){ try { return JSON.parse(sessionStorage.getItem(SK)) || {}; } catch(e){ return {}; } }
  function save(d){ sessionStorage.setItem(SK, JSON.stringify(d)); }
  window.__doc = {
    calls: [],
    fail: false,
    all: function(){ return load(); },
    seed: function(path, data){ var d = load(); d[path] = data; save(d); }
  };
  var real = window.fetch.bind(window);
  window.fetch = function(url, opts){
    var u = String(url && url.url ? url.url : url);
    if (u.indexOf(${JSON.stringify(ENDPOINT)}) !== 0) return real(url, opts);

    var body = {};
    try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) {}
    window.__doc.calls.push(body.action || 'GET');

    if (window.__doc.fail) {
      return Promise.resolve(new Response(JSON.stringify({ status: 'error', message: 'nope' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }

    var docs = load();
    var out;
    if (body.action === 'docput') { docs[body.path] = body.data; save(docs); out = { status: 'ok' }; }
    else if (body.action === 'docget') { out = { status: 'ok', data: docs[body.path] === undefined ? null : docs[body.path] }; }
    else if (body.action === 'doclist') {
      var pre = body.dir.replace(/\\/*$/, '') + '/';
      out = { status: 'ok', names: Object.keys(docs)
        .filter(function(k){ return k.indexOf(pre) === 0; })
        .map(function(k){ return k.slice(pre.length); }).sort() };
    }
    else if (body.action === 'docdel') { delete docs[body.path]; save(docs); out = { status: 'ok' }; }
    else if (body.action === 'pdf') {
      window.__doc.pdfs = (window.__doc.pdfs || []);
      var n = body.name.slice(-4) === '.pdf' ? body.name : body.name + '.pdf';
      docs['__pdf__/' + n] = body.html; save(docs);
      out = { status: 'ok', name: n, url: 'https://drive.test/' + n, bytes: body.html.length };
    }
    else { out = { status: 'ok', roster: null, rotations: null, warnings: [] }; }

    return Promise.resolve(new Response(JSON.stringify(out),
      { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
})();
`;

const BOARD = { objective: 'Fever and a limp in a toddler', struck: ['transient synovitis'] };
const CARD = { session: '2026-09-03', items: [{ code: 'A1', met: true }] };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const out = [];
  const t = (n, c, x) => out.push({ n, p: !!c, x: x === undefined ? '' : JSON.stringify(x) });
  const errs = [];

  const fresh = async () => {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    p.on('console', m => {
      const u = (m.location() && m.location().url) || '';
      /* The refusal cases below break a save on purpose, and a save
         that fails is supposed to reach the console — that is the
         behaviour being tested, not a symptom. */
      const expected = /to the shared store Error: nope/;
      if (m.type() === 'error' && !/googletagmanager|favicon|ERR_/.test(m.text() + ' ' + u) &&
          !expected.test(m.text())) errs.push('console: ' + m.text());
    });
    await p.addInitScript(fake);
    await p.addInitScript(stub);
    await p.goto(BASE + '/morning-report/board/', { waitUntil: 'networkidle' });
    await p.evaluate(d => MRRemote.setSettings({ endpoint: d.e, key: d.k, remember: true }),
      { e: ENDPOINT, k: KEY });
    return { ctx, p };
  };

  /* ---- a device with no folder ------------------------------------ */

  {
    const { ctx, p } = await fresh();

    t('it starts with no folder', await p.evaluate(() => MRStore.status().ready === false));

    const wrote = await p.evaluate(async (d) => {
      const ok = await MRStore.write('board-archive/2026-09-03.json', d);
      return { ok: ok, stored: window.__doc.all()['board-archive/2026-09-03.json'] };
    }, BOARD);
    t('a board archive saves with no folder at all', wrote.ok === true, wrote.ok);
    t('and lands in the shared store', JSON.stringify(wrote.stored) === JSON.stringify(BOARD), wrote.stored);

    /* the thing another device then does */
    const read = await p.evaluate(() => MRStore.read('board-archive/2026-09-03.json'));
    t('and reads back', read && read.objective === BOARD.objective, read);

    const missing = await p.evaluate(() => MRStore.read('board-archive/never.json'));
    t('an absent document is still null', missing === null, missing);

    await p.evaluate(async (d) => { await MRStore.write('sessions/2026-09-03.json', d); }, CARD);
    const names = await p.evaluate(() => MRStore.list('sessions'));
    t('a directory lists what the store holds', names.join() === '2026-09-03.json', names);

    const all = await p.evaluate(() => MRStore.readAll('sessions'));
    t('readAll reaches it, so the group report works with no folder',
      all.length === 1 && all[0].data.items.length === 1, all);

    await p.evaluate(() => MRStore.remove('sessions/2026-09-03.json'));
    t('and a document can be removed',
      (await p.evaluate(() => MRStore.list('sessions'))).length === 0);

    await ctx.close();
  }

  /* ---- identified work must never go there ------------------------ */

  {
    const { ctx, p } = await fresh();
    const tried = await p.evaluate(async () => {
      window.__doc.calls.length = 0;
      await MRStore.write('working/2026-09-03.json', { note: 'identified' });
      await MRStore.write('manifests/2026-09-03.json', { roles: {} });
      await MRStore.write('working-board.json', { live: true });
      await MRStore.read('working/2026-09-03.json');
      await MRStore.list('working');
      return window.__doc.calls;
    });
    t('nothing identified is sent to the shared store',
      tried.filter(c => c.indexOf('doc') === 0).length === 0, tried);

    t('and the module agrees about which paths it keeps',
      await p.evaluate(() => MRRemote.docBacked('sessions/x.json') === true &&
        MRRemote.docBacked('working/x.json') === false &&
        MRRemote.docBacked('working-board.json') === false &&
        MRRemote.docBacked('sessions/deeper/x.json') === false));
    await ctx.close();
  }

  /* ---- with a folder, both copies are kept ------------------------ */

  {
    const { ctx, p } = await fresh();
    await p.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });

    const both = await p.evaluate(async (d) => {
      await MRStore.write('board-archive/2026-09-04.json', d);
      return {
        folder: await (async () => {
          /* read it back with the endpoint switched off, so this is the
             folder's copy and not the store's */
          const saved = MRRemote.settings();
          MRRemote.forget();
          const v = await MRStore.read('board-archive/2026-09-04.json');
          MRRemote.setSettings({ endpoint: saved.endpoint, key: saved.key, remember: true });
          return v;
        })(),
        shared: window.__doc.all()['board-archive/2026-09-04.json'],
      };
    }, BOARD);
    t('with a folder, the folder still gets it', both.folder && both.folder.objective === BOARD.objective, both.folder);
    t('and the shared store gets it too', both.shared && both.shared.objective === BOARD.objective, both.shared);

    /* the folder wins on read, so a machine mid-session trusts what it
       can see rather than what somebody else last pushed */
    const wins = await p.evaluate(async () => {
      await MRStore.write('board-archive/2026-09-05.json', { objective: 'folder copy' });
      window.__doc.seed('board-archive/2026-09-05.json', { objective: 'store copy' });
      const v = await MRStore.read('board-archive/2026-09-05.json');
      return v.objective;
    });
    t('and the folder still wins on read', wins === 'folder copy', wins);

    /* a listing is the union, not one or the other */
    const merged = await p.evaluate(async () => {
      window.__doc.seed('casebank/from-another-device.json', { tags: [] });
      await MRStore.write('casebank/from-this-one.json', { tags: [] });
      return await MRStore.list('casebank');
    });
    t('a listing is the union of both',
      merged.join() === 'from-another-device.json,from-this-one.json', merged);

    await ctx.close();
  }

  /* ---- a store that refuses is said out loud ---------------------- */

  {
    const { ctx, p } = await fresh();
    await p.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
    const noisy = await p.evaluate(async (d) => {
      window.__doc.fail = true;
      const ok = await MRStore.write('board-archive/2026-09-06.json', d);
      const alerts = [].slice.call(document.querySelectorAll('.mr-alert')).map(a => a.textContent);
      window.__doc.fail = false;
      return { ok: ok, alerts: alerts };
    }, BOARD);
    t('a folder save still succeeds when the store refuses', noisy.ok === true, noisy.ok);
    t('but it says the shared copy did not go through',
      noisy.alerts.some(a => /shared copy/.test(a)), noisy.alerts);

    /* and with no folder, a refusal is a failure rather than a shrug */
    const { ctx: c2, p: p2 } = await fresh();
    const hard = await p2.evaluate(async (d) => {
      window.__doc.fail = true;
      const ok = await MRStore.write('sessions/2026-09-06.json', d);
      const alerts = [].slice.call(document.querySelectorAll('.mr-alert')).map(a => a.textContent);
      return { ok: ok, alerts: alerts };
    }, CARD);
    t('with no folder, a refused save reports failure', hard.ok === false, hard.ok);
    t('and says so loudly', hard.alerts.length > 0, hard.alerts);

    await ctx.close();
    await c2.close();
  }

  /* ---- no endpoint: nothing changes ------------------------------- */

  {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    await p.addInitScript(fake);
    await p.addInitScript(stub);
    await p.goto(BASE + '/morning-report/board/', { waitUntil: 'networkidle' });
    await p.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });

    const plain = await p.evaluate(async (d) => {
      window.__doc.calls.length = 0;
      await MRStore.write('board-archive/2026-09-07.json', d);
      const back = await MRStore.read('board-archive/2026-09-07.json');
      return { calls: window.__doc.calls, back: back };
    }, BOARD);
    t('with no endpoint, nothing is sent anywhere', plain.calls.length === 0, plain.calls);
    t('and the folder works exactly as before',
      plain.back && plain.back.objective === BOARD.objective, plain.back);
    await ctx.close();
  }


  /* ---- Save board files a PDF instead of opening a dialog --------- */

  {
    const { ctx, p } = await fresh();
    await p.evaluate(() => {
      document.getElementById('date').value = '2026-09-03';
      document.getElementById('site').value = 'Galveston';
      document.getElementById('objective').value = 'Fever and a limp in a toddler';
    });

    /* window.print would block the run, and its absence is the point */
    const printed = await p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; return true; });
    t('the page is ready to notice a print', printed === true);

    await p.click('#printBtn');
    await p.waitForFunction(() => (window.__doc.calls || []).indexOf('pdf') !== -1, null, { timeout: 10000 });

    const sent = await p.evaluate(() => {
      const docs = window.__doc.all();
      const key = Object.keys(docs).filter(k => k.indexOf('__pdf__/') === 0)[0];
      return { key: key, html: docs[key], printed: window.__printed };
    });
    t('Save board files a PDF', !!sent.key, sent.key);
    t('named for the date and site', sent.key === '__pdf__/board-2026-09-03-galveston.pdf', sent.key);
    t('and does not open a print dialog', sent.printed === 0, sent.printed);
    t('the markup carries the board, not the page chrome',
      /Morning Report board/.test(sent.html) && /Fever and a limp/.test(sent.html) &&
      !/<script/i.test(sent.html), (sent.html || '').slice(0, 120));
    t('and says it has no names in it', /No participant names/.test(sent.html));

    await p.waitForFunction(() => /Filed as/.test(document.body.textContent), null, { timeout: 5000 });
    t('and tells you where it went', /Filed as/.test(await p.textContent('body')));

    /* Print is still available, on its own control */
    await p.click('#printLink');
    t('Print still prints', await p.evaluate(() => window.__printed === 1));
    await ctx.close();
  }

  /* ---- with no endpoint it says so rather than doing nothing ------ */

  {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    await p.addInitScript(fake);
    await p.addInitScript(stub);
    await p.goto(BASE + '/morning-report/board/', { waitUntil: 'networkidle' });
    await p.evaluate(() => { window.print = () => {}; });
    await p.click('#printBtn');
    await p.waitForFunction(() => !document.getElementById('err').hidden, null, { timeout: 5000 });
    t('with no shared store, Save board explains itself',
      /nowhere to file/.test(await p.textContent('#errmsg')), await p.textContent('#errmsg'));
    t('and points at Print as the way to get a copy',
      /Print/.test(await p.textContent('#errmsg')));
    await ctx.close();
  }

  /* ---- a refusal does not look like success ----------------------- */

  {
    const { ctx, p } = await fresh();
    await p.evaluate(() => { window.print = () => {}; window.__doc.fail = true; });
    await p.click('#printBtn');
    await p.waitForFunction(() => !document.getElementById('err').hidden, null, { timeout: 10000 });
    t('a refused render is reported', /was not filed/.test(await p.textContent('#errmsg')),
      await p.textContent('#errmsg'));
    t('and the button comes back so it can be retried',
      await p.evaluate(() => document.getElementById('printBtn').disabled === false));
    await ctx.close();
  }


  /* ---- a device with nothing set up says what to do --------------

     Reported twice from a phone: an empty wheel, a bar mentioning only
     the data folder, and no way to tell whether it was broken or just
     not configured. Silence was the bug.
     ------------------------------------------------------------------ */

  {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    await p.addInitScript(fake);
    await p.addInitScript(stub);
    /* no folder, no endpoint — exactly what a phone opens with */
    await p.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });

    t('a device with no source is not configured',
      await p.evaluate(() => MRRemote.configured() === false && MRStore.status().ready === false));

    const bar = await p.textContent('#mr-bar');
    t('the bar offers the setup rather than only naming the folder',
      /Set up shared roster/.test(bar), bar.trim().slice(0, 120));
    t('and it links to the settings page',
      await p.evaluate(() => {
        const a = [].slice.call(document.querySelectorAll('#mr-bar a'))
          .filter(x => /Set up shared roster/.test(x.textContent))[0];
        return !!a && /settings\/$/.test(a.getAttribute('href') || '');
      }));

    await p.waitForFunction(() => {
      const n = document.querySelector('#col-pgy1 .ledger .note');
      return n && n.textContent.length > 0;
    }, null, { timeout: 5000 });
    const note = await p.textContent('#col-pgy1 .ledger .note');
    t('the empty wheel says why it is empty', /no shared roster is set up/i.test(note), note);
    t('and does not tell a phone to add residents', !/Add residents/.test(note), note);

    /* The presenting toggle is rota-driven and this device has no rota.
       hidden must actually hide — display:flex was beating the
       attribute, leaving an empty "Presenting today" label that reads
       as a broken control. */
    t('no rota means no presenting label, not an empty one',
      !(await p.isVisible('#presenting-wrap')));

    await ctx.close();
  }

  {
    /* Configured but unreachable is a different sentence again. */
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    await p.addInitScript(fake);
    await p.addInitScript(stub);
    await p.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });
    await p.evaluate(d => MRRemote.setSettings({ endpoint: d.e, key: d.k, remember: true }),
      { e: ENDPOINT, k: KEY });
    await p.reload({ waitUntil: 'networkidle' });
    /* __doc.fail is a plain property and does not survive a reload, so
       the endpoint answers — with an empty roster, which is its own
       state and the one setup actually passes through. */
    await p.waitForFunction(() => {
      const n = document.querySelector('#col-pgy1 .ledger .note');
      return n && n.textContent.length > 0;
    }, null, { timeout: 8000 });

    const note = await p.textContent('#col-pgy1 .ledger .note');
    t('a connected but empty sheet says so, rather than blaming the roster',
      /connected but empty/i.test(note), note);
    t('and points at Publish rather than at adding residents by hand',
      /Publish from a data folder/.test(note) && !/Add residents/.test(note), note);
    await ctx.close();
  }

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
