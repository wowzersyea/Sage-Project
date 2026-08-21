const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');
const rubric = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'content', 'rubric.json'),'utf8'));
const ITEM_IDS = rubric.columns.flatMap(c => c.items.map(i => i.id));
const FAIL_IDS = rubric.automatic_fails.map(f => f.id);

// build a session where `struckIds` are struck, everything else not.
// `omit` leaves an item out entirely, to exercise the small-denominator rule.
function mkSession(date, site, struckIds, failIds, omit) {
  const items = {};
  ITEM_IDS.forEach(id => {
    if ((omit || []).includes(id)) return;
    items[id] = { final_verdict: struckIds.includes(id), source: 'human', confidence: null, model_verdict: null };
  });
  const automatic_fails = {};
  FAIL_IDS.forEach(id => {
    automatic_fails[id] = { final_verdict: (failIds || []).includes(id), source: 'human', confidence: null, model_verdict: null };
  });
  return { id: date + '-' + site.toLowerCase(), date, site, items, automatic_fails,
           struck: struckIds.length, of: 16, failed: (failIds || []).length > 0, scored: date + 'T08:00:00Z' };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { const u=(m.location()&&m.location().url)||''; if (m.type()==='error' && !/googletagmanager|favicon|ERR_CONNECTION_RESET/.test(m.text()+' '+u)) errs.push('console: ' + m.text()); });
  await page.addInitScript(fake);
  await page.goto(BASE + '/morning-report/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

  const out = [];
  const t = (name, cond, extra) => out.push({ name, pass: !!cond, extra: extra === undefined ? '' : JSON.stringify(extra) });

  const write = async (list) => page.evaluate(async (rows) => {
    await MRStore.connect();
    for (const s of rows) await MRStore.write('sessions/' + s.id + '.json', s);
  }, list);

  const load = async () => {
    await page.goto(BASE + '/morning-report/report/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof rubric !== 'undefined' && rubric !== null, null, { timeout: 8000 });
    await page.waitForTimeout(200);
  };

  // ---- 1, 2, 3 sessions: it must refuse ---------------------------------
  await page.goto(BASE + '/morning-report/report/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });

  const most = ITEM_IDS.filter(id => id !== 'cant_miss' && id !== 'let_silence');
  for (let n = 0; n <= 3; n++) {
    const list = [];
    for (let i = 0; i < n; i++) list.push(mkSession('2026-09-0' + (i+1), 'Galveston', most, []));
    await page.evaluate(async () => { await MRStore.connect(); for (const f of await MRStore.list('sessions')) await MRStore.remove('sessions/' + f); });
    if (list.length) await write(list);
    await load();
    const st = await page.evaluate(() => ({
      refused: !!document.querySelector('.refuse'),
      table: document.querySelectorAll('table.rep').length,
      text: (document.querySelector('.refuse p') || {}).textContent || '',
      why: [...document.querySelectorAll('.refuse p')].map(p => p.textContent).join(' ')
    }));
    t(`${n} session${n===1?'':'s'}: refuses to render`, st.refused === true && st.table === 0, st.table);
    if (n === 3) {
      t('the refusal says how many it has and needs', /3 of the 4 sessions/.test(st.text), st.text);
      t('the refusal explains why, not just that', /cannot be de-identified/.test(st.why) && /exactly one PGY-1/.test(st.why));
    }
  }

  // ---- 4 sessions: renders --------------------------------------------------
  // framework_first struck 1/4 (weakest), struck_reason 2/4, most struck 4/4.
  // cant_miss appears in only 3 -> must be suppressed.
  const base = ITEM_IDS.filter(id => !['framework_first','struck_reason','cant_miss'].includes(id));
  const four = [
    mkSession('2026-09-03','Galveston', base.concat(['framework_first','struck_reason','cant_miss']), []),
    mkSession('2026-09-10','Galveston', base.concat(['struck_reason','cant_miss']), ['ran_over']),
    mkSession('2026-09-17','Galveston', base.concat(['cant_miss']), []),
    mkSession('2026-09-24','Galveston', base, ['ran_over'], ['cant_miss'])
  ];
  await page.evaluate(async () => { await MRStore.connect(); for (const f of await MRStore.list('sessions')) await MRStore.remove('sessions/' + f); });
  await write(four);
  await load();

  const rep = await page.evaluate(() => {
    const itemTbl = document.querySelector('table.rep:not(.fails-tbl)');
    const rows = [...itemTbl.querySelectorAll('tbody tr')].map(tr => ({
      text: tr.children[0].textContent,
      n: tr.children[3] ? tr.children[3].textContent : '',
      pct: tr.children[4] ? tr.children[4].textContent : '',
      teach: tr.classList.contains('teach'),
      suppressed: tr.classList.contains('suppressed')
    }));
    return {
      rendered: !document.querySelector('.refuse'),
      window: document.querySelector('.windowline').textContent,
      teachTop: document.querySelector('.teachbox .it').textContent,
      teachSub: document.querySelector('.teachbox .su').textContent,
      rows,
      foot: document.querySelector('.repfoot').textContent
    };
  });

  t('four sessions renders', rep.rendered === true);
  t('the window is reported as a count, not as dates', /last 4 sessions/i.test(rep.window), rep.window.slice(0,60));
  t('the window line names no session', !/2026-09-03|2026-09-10|2026-09-17|2026-09-24/.test(rep.window), rep.window);

  const shown = rep.rows.filter(r => !r.suppressed);
  t('the weakest item is first', shown[0].text === 'A framework named before the list', shown[0]);
  t('sorted ascending by share',
     shown.map(r => parseInt(r.pct)).every((v, i, a) => i === 0 || a[i-1] <= v), shown.map(r => r.pct));
  t('the top row is flagged as the one to teach', shown[0].teach === true);
  t('the teach box names the same item',
     rep.teachTop === 'A framework named before the list', rep.teachTop);
  t('the proportions are right',
     shown[0].n === '1 / 4' && shown[0].pct === '25%' &&
     shown[1].text === 'Something struck off, with the reason beside it' && shown[1].n === '2 / 4',
     shown.slice(0,2));

  const supp = rep.rows.filter(r => r.suppressed);
  t('an item with only three observations is suppressed',
     supp.length === 1 && supp[0].text === "The can't-miss, named as such", supp);
  t('the suppressed row shows no figure', supp[0].pct === 'suppressed' && supp[0].n === '—', supp[0]);
  t('the window line says how many were suppressed', /1 item is suppressed/.test(rep.window), rep.window);

  // automatic fails
  const fails = await page.evaluate(() => [...document.querySelectorAll('.fails-tbl tbody tr')].map(tr => ({
    text: tr.children[0].textContent, n: tr.children[1].textContent, pct: tr.children[2].textContent,
    hit: tr.classList.contains('hit') })));
  t('automatic fails are counted across the window',
     fails.find(f => /past 25 minutes/.test(f.text)).n === '2 / 4', fails.find(f => /past 25/.test(f.text)));
  t('a fail that never happened reads zero',
     fails.find(f => /Faculty entered/.test(f.text)).pct === '0%', fails.find(f => /Faculty/.test(f.text)));

  // ---- nothing identifying anywhere on the page ---------------------------
  const body = await page.evaluate(() => document.body.innerText);
  t('no session date appears in the report body', !/2026-09-03|2026-09-10|2026-09-17|2026-09-24/.test(body));
  t('no role is attributed a result',
     !/the PGY-1 (did|failed|missed)/i.test(body) && !/presenter (did|failed|missed)/i.test(body));
  t('the footnote states the limits plainly',
     /no individual attribution/.test(rep.foot) && /not a milestone/.test(rep.foot), rep.foot.slice(0, 60));

  // ---- the four-session floor holds per site ------------------------------
  await write([mkSession('2026-09-05','Austin', base, [])]);
  await load();
  await page.selectOption('#site', 'Austin');
  await page.waitForTimeout(150);
  const perSite = await page.evaluate(() => ({
    refused: !!document.querySelector('.refuse'),
    text: (document.querySelector('.refuse p') || {}).textContent || ''
  }));
  t('filtering to a site with one session refuses too', perSite.refused === true, perSite);
  t('and says it is about that site', /at Austin/.test(perSite.text), perSite.text);

  await page.selectOption('#site', '');
  await page.waitForTimeout(150);
  const bothSites = await page.evaluate(() => ({
    rendered: !document.querySelector('.refuse'),
    window: document.querySelector('.windowline').textContent
  }));
  t('both sites together renders again', bothSites.rendered === true);
  t('and names the sites, not the sessions',
     /Austin and Galveston/.test(bothSites.window), bothSites.window.slice(0, 80));

  // ---- print view -----------------------------------------------------------
  await page.emulateMedia({ media: 'print' });
  const pr = await page.evaluate(() => ({
    bar: getComputedStyle(document.querySelector('.mr-bar')).display,
    controls: getComputedStyle(document.querySelector('.controls')).display,
    body: getComputedStyle(document.body).backgroundColor,
    tableVisible: getComputedStyle(document.querySelector('table.rep')).display !== 'none'
  }));
  await page.emulateMedia({ media: 'screen' });
  t('print drops the chrome and keeps the table',
     pr.bar === 'none' && pr.controls === 'none' && pr.tableVisible === true, pr);
  t('print is on white', pr.body === 'rgb(255, 255, 255)', pr.body);

  let failed = 0;
  for (const r of out) { if (!r.pass) failed++; console.log((r.pass?'PASS  ':'FAIL  ') + r.name + (r.extra?'   '+r.extra:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - failed) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
