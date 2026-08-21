const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { var u = (m.location()&&m.location().url)||'';  if (m.type() === 'error') { var tx=m.text(); if(!/googletagmanager|favicon|ERR_CONNECTION_RESET/.test(tx+' '+u)) errs.push('console: '+tx); }; });

  await page.addInitScript(fake);
  await page.goto(BASE + '/morning-report/', { waitUntil: 'networkidle' });

  const results = await page.evaluate(async () => {
    const out = [];
    const t = (name, cond, extra) => out.push({ name, pass: !!cond, extra: extra === undefined ? '' : JSON.stringify(extra) });

    await MRStore.whenReady;
    t('supported detected', MRStore.status().supported === true);

    const ok = await MRStore.connect();
    t('connect() resolves true', ok === true);
    t('status ready after connect', MRStore.status().ready === true);
    t('folder name surfaced', MRStore.status().name === 'MorningReport', MRStore.status().name);

    // round trip at the root
    await MRStore.write('roster.json', { academic_year: '2026-2027', residents: [{ id: 'r-1' }] });
    const r = await MRStore.read('roster.json');
    t('root write/read round trip', r && r.academic_year === '2026-2027', r);

    // nested directory is created on demand
    await MRStore.write('casebank/2026-09-03-galveston.json', { id: '2026-09-03-galveston', tags: ['ID'] });
    await MRStore.write('casebank/2026-09-10-galveston.json', { id: '2026-09-10-galveston', tags: ['GI'] });
    const c = await MRStore.read('casebank/2026-09-03-galveston.json');
    t('nested write/read round trip', c && c.id === '2026-09-03-galveston', c);

    const names = await MRStore.list('casebank');
    t('list() returns both files sorted', names.length === 2 && names[0] < names[1], names);

    const all = await MRStore.readAll('casebank');
    t('readAll() returns parsed objects', all.length === 2 && all[0].data.id, all.map(x => x.file));

    // absent file is null, not an error
    const missing = await MRStore.read('casebank/nope.json');
    t('missing file reads as null', missing === null, missing);

    // listing a directory that does not exist yet is empty, not an error
    const emptyDir = await MRStore.list('sessions');
    t('missing directory lists as empty', Array.isArray(emptyDir) && emptyDir.length === 0, emptyDir);

    // delete
    await MRStore.remove('casebank/2026-09-10-galveston.json');
    const after = await MRStore.list('casebank');
    t('remove() drops the file', after.length === 1, after);
    const delMissing = await MRStore.remove('casebank/never-existed.json');
    t('removing a missing file is not an error', delMissing === true);

    // overwrite must replace, not append
    await MRStore.write('roster.json', { academic_year: '2027-2028' });
    const r2 = await MRStore.read('roster.json');
    t('overwrite replaces content', r2 && r2.academic_year === '2027-2028' && !r2.residents, r2);

    // helpers
    t('slug()', MRStore.slug('Galveston') === 'galveston', MRStore.slug('Galveston'));
    t('sessionId()', MRStore.sessionId('2026-09-03', 'Galveston') === '2026-09-03-galveston');
    t('today() shape', /^\d{4}-\d{2}-\d{2}$/.test(MRStore.today()), MRStore.today());
    t('esc() escapes', MRStore.esc('<b>&"') === '&lt;b&gt;&amp;&quot;', MRStore.esc('<b>&"'));

    return out;
  });

  // the bar rendered and shows the connected folder
  const barText = await page.textContent('#mr-bar');
  results.push({ name: 'bar shows connected folder', pass: /MorningReport/.test(barText), extra: barText.trim().slice(0, 80) });

  // reload: the handle must come back out of IndexedDB without re-picking
  await page.reload({ waitUntil: 'networkidle' });
  const afterReload = await page.evaluate(async () => {
    await MRStore.whenReady;
    const s = MRStore.status();
    const r = await MRStore.read('roster.json');
    return { ready: s.ready, name: s.name, year: r && r.academic_year };
  });
  results.push({ name: 'handle restored after reload', pass: afterReload.ready === true, extra: JSON.stringify(afterReload) });
  results.push({ name: 'data readable after reload', pass: afterReload.year === '2027-2028', extra: JSON.stringify(afterReload) });

  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.extra ? '   ' + r.extra : ''));
  }
  if (errs.length) { console.log('\nCONSOLE/PAGE ERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (results.length - failed) + '/' + results.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
