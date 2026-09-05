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
  page.on('console', m => { const u=(m.location()&&m.location().url)||''; if (m.type()==='error' && !/googletagmanager|favicon|ERR_CONNECTION_RESET/.test(m.text()+' '+u)) errs.push('console: ' + m.text()); });
  await page.addInitScript(fake);
  await page.goto(BASE + '/morning-report/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

  const out = [];
  const t = (name, cond, extra) => out.push({ name, pass: !!cond, extra: extra === undefined ? '' : JSON.stringify(extra) });

  await page.goto(BASE + '/morning-report/board/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => MRStore.status().ready === true);

  // ---- fill the board the way a session would ------------------------
  await page.evaluate(() => {
    document.getElementById('caseid').value = 'PEDS-MR-04';
    document.getElementById('date').value = '2026-09-03';
    document.getElementById('site').value = 'Galveston';
    document.getElementById('pr').value = '3-year-old, two days of fever, refusing to bear weight, hip flexed and externally rotated';
    document.querySelector('[data-v="t"]').value = '38.6';
    document.querySelector('[data-v="hr"]').value = '148';
  });

  const addList = async (key, vals) => {
    for (const v of vals) {
      await page.fill(`[data-add="${key}"]`, v);
      await page.press(`[data-add="${key}"]`, 'Enter');
    }
  };
  await addList('hx', ['Well until two days ago', 'No trauma']);
  await addList('pos', ['Refuses to bear weight']);
  await addList('neg', ['No rash']);
  await addList('labs1', ['CRP 8.4']);
  await addList('labs2', ['Hip US: effusion']);
  await addList('pend', ['Joint aspirate']);
  await addList('bias', ['premature closure']);

  // start the clock so the ordering marks are real
  await page.click('#startBtn');
  await page.waitForTimeout(1200);

  // intern's four, each with a reason
  const addDx = async (side, name, why) => {
    await page.fill(`[data-adddx="${side}"]`, name);
    await page.press(`[data-adddx="${side}"]`, 'Enter');
    const boxes = page.locator(`[data-dx="${side}"] .dx`);
    const n = await boxes.count();
    await boxes.nth(n - 1).locator('.why').fill(why);
  };
  await addDx('intern', 'Septic arthritis of the hip', 'positioning plus the CRP');
  await addDx('intern', 'Transient synovitis', 'main competitor, cannot separate on exam');
  await addDx('intern', 'Osteomyelitis of the proximal femur', 'possible, MRI would sort it');

  // framework named BEFORE the senior starts listing
  await page.fill('#fwTxt', 'Anatomic — by layer');
  await page.dispatchEvent('#fwTxt', 'input');
  await page.waitForTimeout(300);
  await addDx('senior', 'Cellulitis', 'skin and soft tissue layer');

  // strike it, with the reason
  await page.click('[data-dx="senior"] .dx .name span');
  await page.fill('[data-dx="senior"] .dx .kill', 'no overlying erythema or warmth');

  await page.fill('#testName', 'Hip ultrasound with aspiration');
  await page.fill('#testPos', 'effusion → ortho tonight');
  await page.fill('#testNeg', 'no effusion → MRI, not back to synovitis');
  await page.fill('#plan', 'Septic arthritis ~70%. Dry tap with a normal joint would change my mind.');
  await page.fill('#teach1', 'Three of four Kocher criteria is past talking yourself out of it.');
  await page.fill('#teach2', 'Ultrasound cannot separate sterile from septic — aspiration decides.');

  const derived = await page.evaluate(() => derive());
  t('PR recorded', derived.pr_present === true);
  t('intern list 3–4 all with reasons', derived.intern_reasoned === true, derived.intern_count);
  t('framework present', derived.framework_present === true);
  t('framework named before the senior list', derived.framework_before_list === true, [derived.framework_before_list]);
  t('struck with a reason', derived.struck_with_reason === true);
  t('discriminating test named', derived.test_named === true);
  t('clock ran and stayed inside 25 min', derived.clock_ran === true && derived.ran_over === false, derived.elapsed_seconds);

  // ---- autosave, then a hard kill at 0:18 -----------------------------
  await page.evaluate(async () => { secs = 1080; maxSecs = 1080; paintClock(); touch(); await autosave(true); });
  const working = await page.evaluate(async () => await MRStore.read('working-board.json'));
  t('autosave wrote the working file', !!working && working.clock.secs === 1080, working && working.clock);
  t('working file carries both differential lists',
     working.dx.intern.length === 3 && working.dx.senior.length === 1, working && { i: working.dx.intern.length, s: working.dx.senior.length });
  t('working file carries the lists', (working.lists.hx || []).length === 2, working && working.lists.hx);

  // kill the tab and open a fresh one on the same folder
  await page.close();
  const page2 = await ctx.newPage();
  page2.on('pageerror', e => errs.push('pageerror(2): ' + e.message));
  page2.on('console', m => { const u=(m.location()&&m.location().url)||''; if (m.type()==='error' && !/googletagmanager|favicon|ERR_CONNECTION_RESET/.test(m.text()+' '+u)) errs.push('console(2): ' + m.text()); });
  await page2.addInitScript(fake);
  await page2.goto(BASE + '/morning-report/board/', { waitUntil: 'networkidle' });
  await page2.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
  await page2.reload({ waitUntil: 'networkidle' });
  await page2.waitForSelector('#recoverVeil:not([hidden])', { timeout: 8000 });
  t('an unfinished board offers recovery', true);

  await page2.click('#doRecover');
  const restored = await page2.evaluate(() => ({
    pr: document.getElementById('pr').value,
    fw: document.getElementById('fwTxt').value,
    intern: [...document.querySelectorAll('[data-dx="intern"] .dx')].map(b => ({
      n: b.querySelector('.name span').textContent, why: b.querySelector('.why').value })),
    senior: [...document.querySelectorAll('[data-dx="senior"] .dx')].map(b => ({
      n: b.querySelector('.name span').textContent,
      struck: b.classList.contains('struck'),
      kill: b.querySelector('.kill') ? b.querySelector('.kill').value : null })),
    hx: [...document.querySelectorAll('[data-list="hx"] .line .t')].map(x => x.textContent),
    clock: document.getElementById('time').textContent,
    test: document.getElementById('testName').value,
    teach: teachGet(),
    teachCount: document.getElementById('teachCnt').textContent
  }));
  t('board restored intact at 0:18', restored.clock === '18:00', restored.clock);
  t('restored the problem representation', /refusing to bear weight/.test(restored.pr));
  t('restored the framework', restored.fw === 'Anatomic — by layer', restored.fw);
  t('restored the intern list with reasons',
     restored.intern.length === 3 && restored.intern.every(d => d.why.length > 0), restored.intern);
  t('restored the strike and its refutation',
     restored.senior[0].struck === true && /erythema/.test(restored.senior[0].kill), restored.senior);
  t('restored the key data lists', restored.hx.length === 2, restored.hx);
  t('restored the discriminator and take-homes', /ultrasound/.test(restored.test) && /Kocher/.test(restored.teach));
  t('the take-homes come back as separate numbered lines',
     restored.teach.split('\n').length === 2 && /2 of 2/.test(restored.teachCount),
     restored.teachCount);

  const rederived = await page2.evaluate(() => derive());
  t('derived facts survive the restore',
     rederived.framework_before_list === true && rederived.struck_with_reason === true && rederived.intern_reasoned === true,
     rederived);

  // ---- finish session ---------------------------------------------------
  await page2.click('#finishBtn');
  await page2.waitForSelector('#finishVeil:not([hidden])', { timeout: 8000 });

  const after = await page2.evaluate(async () => ({
    archive: await MRStore.read('board-archive/2026-09-03-galveston.json'),
    working: await MRStore.read('working-board.json'),
    listed: await MRStore.list('board-archive'),
    capture: document.getElementById('toCapture').getAttribute('href'),
    score: document.getElementById('toScore').getAttribute('href')
  }));
  t('archive written under the session id', after.listed.join(',') === '2026-09-03-galveston.json', after.listed);
  t('working file deleted after finish', after.working === null, after.working);
  t('archive carries the board contents',
     after.archive.problem_representation.length > 0 &&
     after.archive.differential.intern.length === 3 &&
     after.archive.key_data.labs_block_2.length === 1 &&
     after.archive.take_homes.length > 0, Object.keys(after.archive));
  t('archive carries the derived facts for the scorecard',
     after.archive.derived.framework_before_list === true && after.archive.derived.board_archived === true, after.archive.derived);
  t('handoff links carry the session id',
     /session=2026-09-03-galveston/.test(after.capture) && /session=2026-09-03-galveston/.test(after.score),
     [after.capture, after.score]);

  // no participant names anywhere in the archive
  const blob = JSON.stringify(after.archive);
  t('archive contains no participant names', !/Aisha|Ben Ortiz|Priya|Marcus|resident_id/.test(blob));

  let failed = 0;
  for (const r of out) { if (!r.pass) failed++; console.log((r.pass?'PASS  ':'FAIL  ') + r.name + (r.extra?'   '+r.extra:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - failed) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
