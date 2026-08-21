const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

const mkArchive = (derived) => ({
  id: '2026-09-03-galveston', date: '2026-09-03', site: 'Galveston',
  problem_representation: 'x', framework: 'Anatomic — by layer',
  differential: { intern: [], senior: [] },
  discriminators: {}, key_data: {}, derived
});

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

  await page.goto(BASE + '/morning-report/scorecard/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });

  // a board where six things went right and nothing was struck
  await page.evaluate(async (a) => {
    await MRStore.write('board-archive/' + a.id + '.json', a);
  }, mkArchive({
    pr_present: true, intern_count: 3, intern_reasoned: true,
    framework_present: true, framework_before_list: true,
    any_struck: false, struck_with_reason: false,
    test_named: true, elapsed_seconds: 1620, clock_ran: true, ran_over: true,
    board_archived: true
  }));

  await page.goto(BASE + '/morning-report/scorecard/?session=2026-09-03-galveston', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.item').length >= 20, null, { timeout: 8000 });

  const shape = await page.evaluate(() => ({
    items: document.querySelectorAll('.cardgrid .item').length,
    cols: [...document.querySelectorAll('.colhead')].map(h => h.textContent),
    fails: document.querySelectorAll('.fails .item').length
  }));
  t('sixteen items in two columns', shape.items === 16, shape.items);
  t('columns are the printed ones', shape.cols[0] === 'The presentation' && shape.cols[1] === 'The reasoning', shape.cols);
  t('four automatic fails', shape.fails === 4, shape.fails);

  const pre = await page.evaluate(() => {
    const on = [...document.querySelectorAll('.cardgrid .item.on .txt')].map(x => x.childNodes[0].textContent);
    const failsOn = [...document.querySelectorAll('.fails .item.on .txt')].map(x => x.childNodes[0].textContent);
    return { on, failsOn, struck: document.getElementById('struck').textContent,
             boardPills: document.querySelectorAll('.pill.board').length,
             flag: !document.getElementById('failflag').hidden };
  });
  t('the board pre-ticks the five it can settle', pre.on.length === 5, pre.on);
  t('problem representation pre-ticked', pre.on.indexOf('Problem representation in one sentence') !== -1, pre.on);
  t('framework-before-list pre-ticked', pre.on.indexOf('A framework named before the list') !== -1, pre.on);
  t('discriminating test pre-ticked', pre.on.indexOf('The discriminating test named') !== -1, pre.on);
  t('board exported pre-ticked', pre.on.indexOf('Board exported and posted') !== -1, pre.on);
  t('struck-with-reason NOT ticked when nothing was struck',
     pre.on.indexOf('Something struck off, with the reason beside it') === -1, pre.on);
  t('running over is pre-ticked as an automatic fail', pre.failsOn.indexOf('We ran past 25 minutes') !== -1, pre.failsOn);
  t('nothing-crossed-off pre-ticked as an automatic fail',
     pre.failsOn.indexOf('Nothing on the board ever got crossed off') !== -1, pre.failsOn);
  t('the tally counts the pre-ticks', pre.struck === '5', pre.struck);
  t('the fail banner shows', pre.flag === true);
  t('every board-settled row is marked (6 items + 2 fails)', pre.boardPills === 8, pre.boardPills);

  // each item points at the standard on the right card
  const links = await page.evaluate(() => [...document.querySelectorAll('.item .std')].map(a => a.getAttribute('href')));
  t('every item links to a role card', links.length === 20, links.length);
  t('reasoning items point at the discussant cards',
     links.some(h => /roles\/pgy1\/#deliverables/.test(h)) && links.some(h => /roles\/senior\/#moves-0/.test(h)), links.slice(7,13));
  t('board-posted points at the scribe card', links.some(h => /roles\/scribe\/#after/.test(h)), links);

  // override a board tick
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.cardgrid .item')];
    const row = rows.find(r => r.querySelector('.txt').childNodes[0].textContent === 'A framework named before the list');
    row.click();
  });
  const ov = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.cardgrid .item')];
    const row = rows.find(r => r.querySelector('.txt').childNodes[0].textContent === 'A framework named before the list');
    return { on: row.classList.contains('on'), pill: row.querySelector('.pill.board').textContent, struck: document.getElementById('struck').textContent };
  });
  t('a board tick can be overridden', ov.on === false, ov);
  t('an override is labelled as one', ov.pill === 'overridden', ov.pill);
  t('the tally follows the override', ov.struck === '4', ov.struck);

  // tick some human items and save
  await page.evaluate(() => {
    ['De-identified — no MRN, no dates, no burned-in IDs','Eight slides or fewer',"The can't-miss, named as such"]
      .forEach(txt => {
        const row = [...document.querySelectorAll('.cardgrid .item')]
          .find(r => r.querySelector('.txt').childNodes[0].textContent === txt);
        if (row) row.click();
      });
  });
  await page.click('#save');
  await page.waitForTimeout(400);

  const saved = await page.evaluate(async () => ({
    files: await MRStore.list('sessions'),
    rec: await MRStore.read('sessions/2026-09-03-galveston.json')
  }));
  t('scorecard written to sessions/', saved.files.join(',') === '2026-09-03-galveston.json', saved.files);
  t('all sixteen items recorded', Object.keys(saved.rec.items).length === 16, Object.keys(saved.rec.items).length);
  t('all four fails recorded', Object.keys(saved.rec.automatic_fails).length === 4);
  t('each item carries verdict, source and confidence',
     Object.values(saved.rec.items).every(i => 'final_verdict' in i && 'source' in i && 'confidence' in i && 'model_verdict' in i));
  t('board-derived items are sourced to the board',
     saved.rec.items.problem_rep.source === 'board' && saved.rec.items.problem_rep.confidence === 1, saved.rec.items.problem_rep);
  t('an overridden item is sourced to the human',
     saved.rec.items.framework_first.source === 'human' && saved.rec.items.framework_first.final_verdict === false &&
     saved.rec.items.framework_first.board_verdict === true, saved.rec.items.framework_first);
  t('the automatic fail is recorded', saved.rec.automatic_fails.ran_over.final_verdict === true && saved.rec.failed === true);
  t('the count is stored', saved.rec.struck === 7 && saved.rec.of === 16, [saved.rec.struck, saved.rec.of]);

  const blob = JSON.stringify(saved.rec);
  t('no names and no evidence quotes in the session record',
     !/quote|evidence|resident_id|Aisha|Marcus/i.test(blob), blob.slice(0, 0));

  // with no archive at all, nothing is pre-ticked
  await page.goto(BASE + '/morning-report/scorecard/?session=nope', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.item').length >= 20);
  const bare = await page.evaluate(() => ({
    on: document.querySelectorAll('.item.on').length,
    note: document.getElementById('boardnote').textContent,
    src: document.getElementById('src').textContent
  }));
  t('no archive means nothing pre-ticked', bare.on === 0, bare);
  t('and it says so plainly', /No board archive/.test(bare.note) && /Nothing pre-ticked/.test(bare.src), bare);

  let failed = 0;
  for (const r of out) { if (!r.pass) failed++; console.log((r.pass?'PASS  ':'FAIL  ') + r.name + (r.extra?'   '+r.extra:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - failed) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
