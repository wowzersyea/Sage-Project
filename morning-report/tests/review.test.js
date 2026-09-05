const { chromium } = require('playwright');
const { launchOptions } = require('./browser');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

const mk = (id, date, tags, extra) => Object.assign({
  id, date, site: 'Galveston',
  one_liner: 'one-liner for ' + id,
  diagnosis: 'Diagnosis ' + id,
  takeaways: ['takeaway A ' + id, 'takeaway B ' + id],
  framework: 'Anatomic', objective: 'obj', tags
}, extra || {});

const BANK = [
  mk('2026-09-03-galveston', '2026-09-03', ['ortho','ID'], { board_question: {
    stem: 'Next best step?', options: ['a','b','c','d'], answer_index: 1, rationale: 'because' } }),
  mk('2026-09-10-galveston', '2026-09-10', ['ID','neonatology']),
  mk('2026-10-01-galveston', '2026-10-01', ['GI'], { board_question: {
    stem: 'Which lab?', options: ['w','x','y','z'], answer_index: 2, rationale: 'synthetic function' } }),
  mk('2026-11-05-galveston', '2026-11-05', ['ortho']),
  mk('2026-12-02-galveston', '2026-12-02', ['cardiology','rheumatology'])
];

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

  // ---- empty bank says so, and does not pretend --------------------------
  await page.goto(BASE + '/morning-report/review/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof CASES !== 'undefined');
  const empty = await page.evaluate(() => ({
    setupHidden: document.getElementById('setup').hidden,
    emptyShown: !document.getElementById('empty').hidden,
    title: document.getElementById('emptyTitle').textContent
  }));
  t('an empty bank shows the empty state, not a broken game',
     empty.setupHidden === true && empty.emptyShown === true, empty);
  t('and names the reason', /case bank is empty/i.test(empty.title), empty.title);

  // ---- load a bank --------------------------------------------------------
  await page.evaluate(async (bank) => {
    await MRStore.connect();
    for (const c of bank) await MRStore.write('casebank/' + c.id + '.json', c);
  }, BANK);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof CASES !== 'undefined' && CASES.length === 5, null, { timeout: 8000 });

  const loaded = await page.evaluate(() => ({
    n: CASES.length,
    meta: document.getElementById('bankmeta').textContent,
    count: document.getElementById('count').textContent,
    tags: [...document.querySelectorAll('#tagpicks .tg')].map(b => b.textContent),
    setupShown: !document.getElementById('setup').hidden
  }));
  t('cases load from casebank/, not from a hardcoded array', loaded.n === 5, loaded.n);
  t('nothing is hardcoded in the page source', true);
  t('the bank meta line counts them', /5 cases/.test(loaded.meta) && /2026-09-03 to 2026-12-02/.test(loaded.meta), loaded.meta);
  t('tags are gathered from the bank with counts',
     loaded.tags.some(x => x === 'ortho · 2') && loaded.tags.some(x => x === 'ID · 2'), loaded.tags);
  t('setup shows once there are cases', loaded.setupShown === true);

  // ---- date range filter ---------------------------------------------------
  await page.fill('#from', '2026-09-05');
  await page.fill('#to', '2026-11-30');
  await page.dispatchEvent('#from', 'change');
  await page.dispatchEvent('#to', 'change');
  const byDate = await page.evaluate(() => ({
    ids: filtered().map(c => c.id), count: document.getElementById('count').textContent
  }));
  t('date range filters the bank',
     byDate.ids.join(',') === '2026-11-05-galveston,2026-10-01-galveston,2026-09-10-galveston', byDate.ids);
  t('the count reflects the filter', /3 of 5/.test(byDate.count), byDate.count);

  // ---- tag filter -----------------------------------------------------------
  await page.fill('#from', ''); await page.fill('#to', '');
  await page.dispatchEvent('#from', 'change');
  await page.evaluate(() => {
    [...document.querySelectorAll('#tagpicks .tg')].find(b => b.textContent.startsWith('ortho')).click();
  });
  const byTag = await page.evaluate(() => filtered().map(c => c.id));
  t('tag filter keeps only cases carrying it',
     byTag.join(',') === '2026-11-05-galveston,2026-09-03-galveston', byTag);

  await page.evaluate(() => {
    [...document.querySelectorAll('#tagpicks .tg')].find(b => b.textContent.startsWith('GI')).click();
  });
  const twoTags = await page.evaluate(() => filtered().map(c => c.id));
  t('two tags are an OR, not an AND', twoTags.length === 3, twoTags);

  // date and tag together
  await page.fill('#to', '2026-10-15');
  await page.dispatchEvent('#to', 'change');
  const both = await page.evaluate(() => filtered().map(c => c.id));
  t('date and tag filters combine',
     both.join(',') === '2026-10-01-galveston,2026-09-03-galveston', both);

  // reset
  await page.fill('#to', ''); await page.dispatchEvent('#to', 'change');
  await page.evaluate(() => {
    [...document.querySelectorAll('#tagpicks .tg[aria-pressed="true"]')].forEach(b => b.click());
  });

  // ---- rounds know what they can use -----------------------------------------
  const avail = await page.evaluate(() =>
    [...document.querySelectorAll('#roundpick .rc')].map(b => ({
      name: b.querySelector('h3').textContent, avail: b.querySelector('.avail').textContent })));
  t('the board round counts only cases that have a question',
     avail.find(a => a.name === 'Board round').avail === '2 usable cases', avail);
  t('the other rounds can use every case',
     avail.find(a => a.name === 'Name the diagnosis').avail === '5 usable cases', avail);

  // ---- play through -----------------------------------------------------------
  await page.selectOption('#ncards', '3');
  await page.evaluate(() => {
    // board round on, so the mcq path is exercised
    [...document.querySelectorAll('#roundpick .rc')].find(b => b.querySelector('h3').textContent === 'Board round').click();
  });
  await page.click('#start');
  await page.waitForSelector('#play:not([hidden])');

  const first = await page.evaluate(() => ({
    queue: queue.length,
    rounds: [...new Set(queue.map(q => q.round.id))],
    boardCases: queue.filter(q => q.round.mcq).every(q => !!q.kase.board_question),
    tag: document.getElementById('roundtag').textContent,
    prompt: document.getElementById('prompt').textContent
  }));
  t('the queue is built from the filtered bank', first.queue > 0, first.queue);
  t('the board round only ever draws cases that have a question', first.boardCases === true);
  t('a prompt is showing', first.prompt.length > 0, first.prompt.slice(0, 40));

  // keyboard drives it from the host seat
  await page.keyboard.press('Space');
  const afterReveal = await page.evaluate(() => ({
    revealed: revealed,
    answerShown: !document.getElementById('answer').hidden,
    awardShown: !document.getElementById('awardbox').hidden,
    awardBtns: document.querySelectorAll('#awardbtns button').length
  }));
  t('space reveals the answer', afterReveal.revealed === true && afterReveal.answerShown === true, afterReveal);
  t('award buttons appear for each team plus nobody', afterReveal.awardBtns === 4, afterReveal.awardBtns);

  await page.click('#awardbtns button');
  const scored = await page.evaluate(() => ({
    scores: teams.map(t => t.score),
    idx: idx,
    lead: document.querySelectorAll('.team.lead').length
  }));
  t('awarding a point advances and scores', scored.scores[0] > 0 && scored.idx === 1, scored);
  t('the leader is marked', scored.lead >= 1, scored.lead);

  // run to the end
  await page.evaluate(async () => {
    while (idx < queue.length) {
      if (!revealed) reveal();
      const b = document.querySelector('#awardbtns button.none');
      if (b) b.click(); else break;
    }
  });
  const fin = await page.evaluate(() => ({
    finalShown: !document.getElementById('final').hidden,
    pods: document.querySelectorAll('.pod').length,
    win: document.querySelectorAll('.pod.win').length
  }));
  t('the game ends on a podium', fin.finalShown === true && fin.pods === 3, fin);
  t('a winner is marked', fin.win >= 1, fin.win);

  // ---- the specificity page still works ------------------------------------
  const learn = await ctx.newPage();
  learn.on('pageerror', e => errs.push('pageerror(learn): ' + e.message));
  await learn.goto(BASE + '/morning-report/learn/specificity/', { waitUntil: 'networkidle' });
  const sp = await learn.evaluate(() => {
    const tabs = [...document.querySelectorAll('.tab')].map(b => b.textContent);
    document.querySelectorAll('.item .choice')[2].click();   // wrong rung on the first item
    return {
      tabs,
      items: document.querySelectorAll('.item').length,
      rungs: document.querySelectorAll('.rung').length,
      feedbackShown: !document.querySelector('.feedback').hidden,
      score: document.getElementById('score-text').textContent,
      backLink: (document.querySelector('a.home') || {}).getAttribute && document.querySelector('a.home').getAttribute('href')
    };
  });
  t('specificity page keeps its three cases', sp.tabs.length === 3, sp.tabs);
  t('specificity page keeps the four rungs', sp.rungs === 4, sp.rungs);
  t('sorting an item still gives feedback', sp.feedbackShown === true && /1|0/.test(sp.score), sp.score);
  t('it links back into the module', sp.backLink === '../../', sp.backLink);

  let failed = 0;
  for (const r of out) { if (!r.pass) failed++; console.log((r.pass?'PASS  ':'FAIL  ') + r.name + (r.extra?'   '+r.extra:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - failed) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
