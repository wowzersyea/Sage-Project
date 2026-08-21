const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');
const TODAY = '2026-12-01';

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

  await page.goto(BASE + '/morning-report/roster/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });

  // --- flag arithmetic, computed against a fixed "today" ------------------
  const eq = await page.evaluate((TODAY) => {
    const R = MRRoster;
    const r = R.blank();
    r.academic_year = '2026-2027';
    r.settings = { overdue_weeks: 8 };
    r.residents = [
      // served last week -> nothing
      { id:'r-001', name:'Recent Rita',  level:'PGY-1', active:true, unavailable:[] },
      // last discussant role 14 weeks ago -> overdue
      { id:'r-002', name:'Stale Sam',    level:'PGY-1', active:true, unavailable:[] },
      // last role 14 weeks ago but away for 10 of them -> NOT overdue
      { id:'r-003', name:'Away Ada',     level:'PGY-1', active:true,
        unavailable:[{from:'2026-09-15', to:'2026-11-24', why:'away rotation'}] },
      // on the roster since July, never anything -> never
      { id:'r-004', name:'Missing Mo',   level:'PGY-1', active:true, unavailable:[] },
      // joined three weeks ago, nothing yet -> NOT never
      { id:'r-005', name:'New Nia',      level:'PGY-1', active:true, unavailable:[], started:'2026-11-10' },
      // carrying the year -> over-drawn
      { id:'r-006', name:'Busy Bea',     level:'PGY-1', active:true, unavailable:[] },
      // inactive -> not in the table at all
      { id:'r-007', name:'Gone Gil',     level:'PGY-1', active:false, unavailable:[] },
      { id:'r-008', name:'Senior Sid',   level:'PGY-2', active:true, unavailable:[] }
    ];
    const L = (date, id, role, sent) => ({ date, site:'Galveston', resident_id:id, role, feedback_sent:!!sent });
    r.log = [
      L('2026-11-24','r-001','pgy1_discussant', true),
      L('2026-08-25','r-002','pgy1_discussant', true),
      L('2026-08-25','r-003','pgy1_discussant', true),
      // Bea: many turns, several with no feedback
      L('2026-09-01','r-006','pgy1_discussant', true),
      L('2026-09-08','r-006','presenter', false),
      L('2026-09-15','r-006','scribe', false),
      L('2026-09-22','r-006','pgy1_discussant', true),
      L('2026-09-29','r-006','presenter', false),
      L('2026-10-06','r-006','pgy1_discussant', true),
      L('2026-11-17','r-006','pgy1_discussant', true),
      L('2026-10-13','r-008','senior_discussant', true)
    ];
    const e = R.equity(r, TODAY);
    return {
      order: e.rows.map(x => x.name),
      byName: e.rows.reduce((m, x) => { m[x.name] = {
        flags: x.flags.map(f => f.id), total: x.total, counts: x.counts,
        weeks: +x.weeks_since ? +x.weeks_since.toFixed(1) : x.weeks_since,
        active: +x.active_weeks_since.toFixed(1),
        fb: x.feedback_sent, gap: x.feedback_gap, last: x.last_discussant }; return m; }, {}),
      medians: e.medians,
      csv: R.equityCsv(r, TODAY)
    };
  }, TODAY);

  t('inactive residents are not in the table', !eq.order.includes('Gone Gil'), eq.order);
  t('never-served sort to the top', eq.order[0] === 'Missing Mo' || eq.order[0] === 'New Nia', eq.order);
  t('default sort is weeks-since-discussant, descending',
     eq.byName[eq.order[1]].active >= eq.byName[eq.order[2]].active, eq.order.slice(0,4));
  t('the most recently served is last', eq.order[eq.order.length - 1] === 'Recent Rita', eq.order);

  t('overdue fires past the threshold',
     eq.byName['Stale Sam'].flags.includes('overdue') && eq.byName['Stale Sam'].active > 8, eq.byName['Stale Sam']);
  t('time away is taken out, so an away rotation is not neglect',
     !eq.byName['Away Ada'].flags.includes('overdue'), eq.byName['Away Ada']);
  t('and the calendar figure is still bigger than the adjusted one',
     eq.byName['Away Ada'].weeks > eq.byName['Away Ada'].active, eq.byName['Away Ada']);
  t('never fires for someone on the roster all year with nothing',
     eq.byName['Missing Mo'].flags.includes('never'), eq.byName['Missing Mo']);
  t('never does NOT fire for a recent joiner',
     !eq.byName['New Nia'].flags.includes('never'), eq.byName['New Nia']);
  t('over-drawn fires above twice the median for the level',
     eq.byName['Busy Bea'].flags.includes('over'), eq.byName['Busy Bea']);
  t('over-drawn is measured within the level, not across the roster',
     !eq.byName['Senior Sid'].flags.includes('over'), [eq.byName['Senior Sid'], eq.medians]);
  t('feedback gap counts turns with nothing sent',
     eq.byName['Busy Bea'].gap === 3 && eq.byName['Busy Bea'].fb === 4, eq.byName['Busy Bea']);
  t('someone fully followed up has no gap flag',
     !eq.byName['Recent Rita'].flags.includes('gap'), eq.byName['Recent Rita']);
  t('per-role counts are broken out',
     eq.byName['Busy Bea'].counts.pgy1_discussant === 4 && eq.byName['Busy Bea'].counts.presenter === 2,
     eq.byName['Busy Bea'].counts);

  // --- CSV ------------------------------------------------------------------
  const lines = eq.csv.trim().split('\n');
  t('CSV has a header and one row per active resident', lines.length === 8, lines.length);
  t('CSV header names every role column',
     /Presenter,Scribe,PGY-1 discussant,Senior discussant,Facilitator/.test(lines[0]), lines[0]);
  t('CSV carries the flags', /Never|Overdue/.test(eq.csv), lines[1]);
  t('CSV quotes fields containing commas',
     lines.every(l => (l.match(/"/g) || []).length % 2 === 0), lines.filter(l => l.includes('"')));
  t('CSV contains no score of any kind',
     !/struck|verdict|score|rubric/i.test(eq.csv));

  // --- the rendered table ----------------------------------------------------
  await page.evaluate(async (TODAY) => {
    await MRStore.connect();
    const R = MRRoster;
    const r = R.blank();
    r.academic_year = '2026-2027';
    r.residents = [
      { id:'r-001', name:'Recent Rita', level:'PGY-1', active:true, unavailable:[] },
      { id:'r-002', name:'Stale Sam',   level:'PGY-1', active:true, unavailable:[] },
      { id:'r-004', name:'Missing Mo',  level:'PGY-1', active:true, unavailable:[] }
    ];
    r.log = [
      { date:'2026-11-24', site:'Galveston', resident_id:'r-001', role:'pgy1_discussant', feedback_sent:true },
      { date:'2026-08-25', site:'Galveston', resident_id:'r-002', role:'pgy1_discussant', feedback_sent:false }
    ];
    await R.save(r);
  }, TODAY);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#eqtable tbody tr').length === 3, null, { timeout: 8000 });

  const tbl = await page.evaluate(() => ({
    head: [...document.querySelectorAll('#eqhead th')].map(th => th.textContent),
    rows: [...document.querySelectorAll('#eqtable tbody tr')].map(tr => ({
      name: tr.children[0].textContent,
      top: tr.classList.contains('top'),
      flags: [...tr.querySelectorAll('.flags .pill')].map(p => p.textContent)
    })),
    nextUp: (document.querySelector('.nextup .nm') || {}).textContent,
    nextWhy: (document.querySelector('.nextup .su') || {}).textContent
  }));
  t('the table has a column per role plus the summary columns', tbl.head.length === 10, tbl.head);
  t('the top row is highlighted', tbl.rows[0].top === true, tbl.rows[0]);
  t('the never-served resident is the top row', /Missing Mo/.test(tbl.rows[0].name), tbl.rows[0].name);
  t('"who to draw next" names them', /Missing Mo/.test(tbl.nextUp), tbl.nextUp);
  t('and says why in plain words', /never taken a discussant role/.test(tbl.nextWhy), tbl.nextWhy);

  // threshold is configurable and persists
  await page.selectOption('#overdue', '12');
  await page.waitForTimeout(300);
  const persisted = await page.evaluate(async () => (await MRStore.read('roster.json')).settings.overdue_weeks);
  t('the overdue threshold is configurable and saved', persisted === 12, persisted);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('overdue').value === '12', null, { timeout: 6000 });
  t('and comes back after a reload', true);

  // --- the wall between participation and performance ------------------------
  const pageText = await page.evaluate(() => document.body.innerText);
  t('the roster page says the wall exists, on the page',
     /scheduling table, not a performance table/i.test(pageText));
  t('and is honest about the limit',
     /anyone holding both files could join them/i.test(pageText));
  const readsSessions = await page.evaluate(() => {
    const src = [...document.querySelectorAll('script')].map(s => s.textContent).join('\n');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return /(read|readAll|list|write)\s*\(\s*["'`]sessions/.test(code);
  });
  t('the roster page never reads sessions/', readsSessions === false);
  const rosterJsReadsSessions = await page.evaluate(async () => {
    const r = await fetch('../assets/roster.js'); const src = await r.text();
    // strip comments first: the file *mentions* sessions/ to say it never reads it
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return /(read|readAll|list|write)\s*\(\s*["'`]sessions/.test(code);
  });
  t('roster.js never reads sessions/ either', rosterJsReadsSessions === false);

  let failed = 0;
  for (const r of out) { if (!r.pass) failed++; console.log((r.pass?'PASS  ':'FAIL  ') + r.name + (r.extra?'   '+r.extra:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - failed) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
