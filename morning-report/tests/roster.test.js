const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

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

  // ---- pure roster logic, on the roster page -------------------------
  await page.goto(BASE + '/morning-report/roster/', { waitUntil: 'networkidle' });
  const logic = await page.evaluate(async () => {
    await MRStore.whenReady;
    await MRStore.connect();
    const R = MRRoster;
    const r = R.blank();
    r.residents = [
      { id:'r-001', name:'Aisha Rahman',  level:'PGY-1', active:true, unavailable:[] },
      { id:'r-002', name:'Ben Ortiz',     level:'PGY-1', active:true, unavailable:[{from:'2026-11-02',to:'2026-11-29',why:'away rotation'}] },
      { id:'r-003', name:'Chloe Nguyen',  level:'PGY-1', active:true, unavailable:[] },
      { id:'r-004', name:'Devon Carter',  level:'PGY-1', active:false, unavailable:[] },
      { id:'r-005', name:'Priya Menon',   level:'PGY-2', active:true, unavailable:[] },
      { id:'r-006', name:'Marcus Webb',   level:'PGY-3', active:true, unavailable:[] }
    ];
    // Aisha served recently, Chloe long ago, nobody else ever
    r.log = [
      { date:'2026-11-10', site:'Galveston', resident_id:'r-001', role:'pgy1_discussant', feedback_sent:true },
      { date:'2026-09-01', site:'Galveston', resident_id:'r-003', role:'pgy1_discussant', feedback_sent:false }
    ];
    const D = '2026-11-15';
    const res = {};

    const elig = R.eligible(r, 'pgy1_discussant', D).map(p => p.name);
    res.eligible = elig;

    const seniorElig = R.eligible(r, 'senior_discussant', D).map(p => p.name);
    res.seniorEligible = seniorElig;

    // neglect weighting: nobody-ever beats long-ago beats recent
    res.candidates = R.pool(r, 'pgy1_discussant', D).candidates.map(p => p.name);

    // with only the two who have served, the older one wins
    const r2 = JSON.parse(JSON.stringify(r));
    r2.residents = r2.residents.filter(p => p.id === 'r-001' || p.id === 'r-003');
    res.candidates2 = R.pool(r2, 'pgy1_discussant', D).candidates.map(p => p.name);

    // a resident who has never held the role outranks everyone who has
    const rN = JSON.parse(JSON.stringify(r));
    rN.residents.push({ id:'r-009', name:'Zoe New', level:'PGY-1', active:true, unavailable:[] });
    res.neverBeatsServed = R.pool(rN, 'pgy1_discussant', D).candidates.map(p => p.name);

    // benching removes from the pool; the drawn cycle refills when empty
    const r3 = JSON.parse(JSON.stringify(r));
    r3.residents.push({ id:'r-009', name:'Zoe New', level:'PGY-1', active:true, unavailable:[] });
    R.toggleBench(r3, 'pgy1_discussant', 'r-001');
    res.afterBench = R.pool(r3, 'pgy1_discussant', D).open.map(p => p.name);
    R.recordDraw(r3, 'pgy1_discussant', 'r-003', D, 'Galveston');
    const p3 = R.pool(r3, 'pgy1_discussant', D);
    res.remainingAfterDraw = p3.remaining.map(p => p.name);
    res.logLen = r3.log.length;
    res.cycleDrawn = r3.cycle.pgy1_discussant.drawn;

    // exhausting the cycle refills it
    const r4 = JSON.parse(JSON.stringify(r));
    R.recordDraw(r4, 'pgy1_discussant', 'r-001', D, 'G');
    R.recordDraw(r4, 'pgy1_discussant', 'r-003', D, 'G');
    const p4 = R.pool(r4, 'pgy1_discussant', D);
    res.refilled = p4.refilled;
    res.refillPool = p4.remaining.map(p => p.name);
    // the next draw is the refilling one: the cycle must reset, not grow
    R.recordDraw(r4, 'pgy1_discussant', 'r-001', D, 'G');
    res.afterRefillDraw = r4.cycle.pgy1_discussant.drawn;
    res.afterRefillRemaining = R.pool(r4, 'pgy1_discussant', D).remaining.map(p => p.name);

    // unavailability windows
    res.awayDuring   = R.isUnavailable(r.residents[1], '2026-11-15');
    res.awayBefore   = R.isUnavailable(r.residents[1], '2026-11-01');
    res.awayEdgeFrom = R.isUnavailable(r.residents[1], '2026-11-02');
    res.awayEdgeTo   = R.isUnavailable(r.residents[1], '2026-11-29');
    res.awayAfter    = R.isUnavailable(r.residents[1], '2026-11-30');
    res.awayDays     = R.unavailableDaysBetween(r.residents[1], '2026-11-01', '2026-11-30');

    // blocks
    res.blocks = ['2026-07-15','2026-11-15','2027-02-15','2027-05-15'].map(d => R.blockFor(d).id);
    res.academicYear = [R.academicYearOf('2026-06-30'), R.academicYearOf('2026-07-01')];

    // year roll
    const r5 = JSON.parse(JSON.stringify(r));
    r5.academic_year = '2026-2027';
    const rolled = R.rollYear(r5);
    res.rolled = {
      year: rolled.roster.academic_year,
      path: rolled.archivePath,
      levels: rolled.roster.residents.map(p => p.level + (p.active ? '' : '*')),
      logCleared: rolled.roster.log.length === 0,
      archiveKept: rolled.archive.log.length === 2,
      awayCleared: rolled.roster.residents.every(p => p.unavailable.length === 0)
    };
    return res;
  });

  t('eligible excludes inactive and away', JSON.stringify(logic.eligible) === JSON.stringify(['Aisha Rahman','Chloe Nguyen']), logic.eligible);
  t('senior wheel takes PGY-2 and PGY-3 only', JSON.stringify(logic.seniorEligible) === JSON.stringify(['Priya Menon','Marcus Webb']), logic.seniorEligible);
  t('longest gap is the only candidate', JSON.stringify(logic.candidates) === JSON.stringify(['Chloe Nguyen']), logic.candidates);
  t('never-served outranks anyone who has served', JSON.stringify(logic.neverBeatsServed) === JSON.stringify(['Zoe New']), logic.neverBeatsServed);
  t('longest gap wins when all have served', JSON.stringify(logic.candidates2) === JSON.stringify(['Chloe Nguyen']), logic.candidates2);
  t('benching removes from the open pool', logic.afterBench.indexOf('Aisha Rahman') === -1, logic.afterBench);
  t('a draw writes a log entry', logic.logLen === 3, logic.logLen);
  t('a draw marks the cycle', JSON.stringify(logic.cycleDrawn) === JSON.stringify(['r-003']), logic.cycleDrawn);
  t('drawn name leaves the cycle', logic.remainingAfterDraw.indexOf('Chloe Nguyen') === -1, logic.remainingAfterDraw);
  t('exhausted cycle refills', logic.refilled === true && logic.refillPool.length === 2, logic);
  t('the refilling draw resets the cycle', JSON.stringify(logic.afterRefillDraw) === JSON.stringify(['r-001']), logic.afterRefillDraw);
  t('after the refill the others are back in', JSON.stringify(logic.afterRefillRemaining) === JSON.stringify(['Chloe Nguyen']), logic.afterRefillRemaining);
  t('away window covers its middle', logic.awayDuring === true);
  t('away window is inclusive of both ends', logic.awayEdgeFrom === true && logic.awayEdgeTo === true, [logic.awayEdgeFrom, logic.awayEdgeTo]);
  t('away window excludes outside', logic.awayBefore === false && logic.awayAfter === false, [logic.awayBefore, logic.awayAfter]);
  t('unavailable days counted and clipped', logic.awayDays === 28, logic.awayDays);
  t('blocks map to quarters', JSON.stringify(logic.blocks) === JSON.stringify(['jul-sep','oct-dec','jan-mar','apr-jun']), logic.blocks);
  t('academic year rolls on 1 July', JSON.stringify(logic.academicYear) === JSON.stringify(['2025-2026','2026-2027']), logic.academicYear);
  // Devon was already inactive, so he promotes to an inactive PGY-2 (marked *)
  t('roll promotes levels, retires PGY-3, leaves inactive inactive',
     JSON.stringify(logic.rolled.levels) === JSON.stringify(['PGY-2','PGY-2','PGY-2','PGY-2*','PGY-3','PGY-3*']), logic.rolled.levels);
  t('roll advances the year', logic.rolled.year === '2027-2028', logic.rolled.year);
  t('roll archives to a named file', logic.rolled.path === 'roster-2026-2027.json', logic.rolled.path);
  t('roll clears the log but keeps the archive', logic.rolled.logCleared && logic.rolled.archiveKept, logic.rolled);
  t('roll clears last year away rotations', logic.rolled.awayCleared);

  // ---- the draw page, end to end -------------------------------------
  await page.evaluate(async () => {
    await MRStore.connect();
    const r = MRRoster.blank();
    r.residents = [
      { id:'r-001', name:'Aisha Rahman', level:'PGY-1', active:true, unavailable:[] },
      { id:'r-002', name:'Ben Ortiz',    level:'PGY-1', active:true, unavailable:[] },
      { id:'r-005', name:'Priya Menon',  level:'PGY-2', active:true, unavailable:[] },
      { id:'r-006', name:'Marcus Webb',  level:'PGY-3', active:true, unavailable:[] }
    ];
    r.log = [{ date:'2026-08-01', site:'Galveston', resident_id:'r-001', role:'pgy1_discussant', feedback_sent:false }];
    await MRRoster.save(r);
  });

  await page.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.wheels && wheels.pgy1 && wheels.pgy1.people.length > 0);

  // Aisha has served, Ben has not — Ben must be the only candidate
  const cand = await page.evaluate(() => wheels.pgy1.candidates.map(p => p.name));
  t('draw page weights to the never-served', JSON.stringify(cand) === JSON.stringify(['Ben Ortiz']), cand);

  await page.evaluate(() => { document.querySelector('#col-pgy1 .btn-spin').click(); });
  await page.waitForFunction(() => wheels.pgy1.winner !== null, null, { timeout: 15000 });
  await page.evaluate(() => { document.querySelector('#col-senior .btn-spin').click(); });
  await page.waitForFunction(() => wheels.senior.winner !== null, null, { timeout: 15000 });

  const drew = await page.evaluate(() => ({
    pgy1: wheels.pgy1.winner.name,
    senior: wheels.senior.winner.name,
    handoffShown: !document.getElementById('handoff').hidden
  }));
  t('PGY-1 wheel drew the neglected resident', drew.pgy1 === 'Ben Ortiz', drew);
  t('senior wheel drew a senior', ['Priya Menon','Marcus Webb'].indexOf(drew.senior) !== -1, drew);
  t('handoff appears after the draws', drew.handoffShown === true);

  const written = await page.evaluate(async () => await MRStore.read('roster.json'));
  t('both draws hit roster.json', written.log.length === 3, written.log.map(e => e.role));
  t('cycle recorded for both roles',
     written.cycle.pgy1_discussant.drawn.length === 1 && written.cycle.senior_discussant.drawn.length === 1,
     written.cycle);

  const mailto = await page.evaluate(() => mailtoFor('pgy1_discussant', { name: 'Ben Ortiz' }));
  t('email carries the deep link to that one card', /roles%2Fpgy1%2F/.test(mailto) || /roles\/pgy1\//.test(decodeURIComponent(mailto)), decodeURIComponent(mailto).slice(0,0));
  t('email names no other role card', !/roles\/senior/.test(decodeURIComponent(mailto)));

  // ---- "the other machine": same folder, fresh page load ---------------
  const page2 = await ctx.newPage();
  page2.on('pageerror', e => errs.push('pageerror(2): ' + e.message));
  await page2.addInitScript(fake);
  await page2.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });
  // this "machine" connects the same synced folder for itself
  await page2.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
  await page2.reload({ waitUntil: 'networkidle' });
  await page2.waitForFunction(() => window.wheels && wheels.pgy1 && wheels.pgy1.people.length > 0);
  const second = await page2.evaluate(() => {
    const cycle = MRRoster.cycleFor(roster, 'pgy1_discussant');
    const chips = [...document.querySelectorAll('#col-pgy1 .chip')].map(c => ({ n: c.textContent, done: c.classList.contains('done') }));
    return { drawn: cycle.drawn, chips, remaining: wheels.pgy1.poolState.remaining.map(p => p.name) };
  });
  t('second machine sees the drawn name struck off',
     second.chips.filter(c => c.done).map(c => c.n).join(',') === 'Ben Ortiz', second.chips);
  t('second machine excludes them from the cycle', second.remaining.join(',') === 'Aisha Rahman', second.remaining);

  let failed = 0;
  for (const r of out) { if (!r.pass) failed++; console.log((r.pass?'PASS  ':'FAIL  ') + r.name + (r.extra?'   '+r.extra:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - failed) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
