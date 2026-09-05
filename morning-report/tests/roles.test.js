const { chromium } = require('playwright');
const { launchOptions } = require('./browser');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');
const path = require('path');
const MODULE = path.resolve(__dirname, '..');
const ROLES_JSON = path.join(MODULE, 'content', 'roles.json');

(async () => {
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { const u=(m.location()&&m.location().url)||''; if (m.type()==='error' && !/googletagmanager|favicon|ERR_CONNECTION_RESET/.test(m.text()+' '+u)) errs.push('console: ' + m.text()); });
  await page.addInitScript(fake);

  const out = [];
  const t = (name, cond, extra) => out.push({ name, pass: !!cond, extra: extra === undefined ? '' : JSON.stringify(extra) });

  const SLUGS = ['run-of-show','presenter','scribe','pgy1','senior','faculty','facilitator'];

  // ---- every card renders, at its own URL ------------------------------
  for (const slug of SLUGS) {
    await page.goto(`${BASE}/morning-report/roles/${slug}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('#card .card-head h1').length === 1, null, { timeout: 8000 });
    const info = await page.evaluate(() => ({
      title: document.title,
      h1: document.querySelector('#card h1').textContent,
      slot: (document.querySelector('.card-slot') || {}).textContent || '',
      sections: document.querySelectorAll('#card .card-sec').length,
      navCount: document.querySelectorAll('.card-nav a').length
    }));
    t(`${slug}: card renders with a heading`, info.h1.length > 0, info.h1);
    t(`${slug}: page title names the role`, info.title.includes(info.h1), info.title);
    t(`${slug}: links to the other six cards`, info.navCount === 7, info.navCount);
  }

  // ---- the anchors the scorecard links to must exist --------------------
  const rubric = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'content', 'rubric.json'), 'utf8'));
  const targets = [];
  rubric.columns.forEach(c => c.items.forEach(i => targets.push([i.card, i.anchor, i.text])));
  rubric.automatic_fails.forEach(f => targets.push([f.card, f.anchor, f.text]));

  const byCard = {};
  targets.forEach(([card, anchor]) => { (byCard[card] = byCard[card] || new Set()).add(anchor); });
  let missing = [];
  for (const card of Object.keys(byCard)) {
    await page.goto(`${BASE}/morning-report/roles/${card}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('#card h1').length === 1);
    const present = await page.evaluate((anchors) => anchors.filter(a => !document.getElementById(a)), [...byCard[card]]);
    present.forEach(a => missing.push(card + '#' + a));
  }
  t('every scorecard "the standard" link lands on a real anchor', missing.length === 0, missing);

  // ---- the PGY-1 card is block-aware -------------------------------------
  const blocks = [
    ['2026-08-15', 'jul-sep', 'Jul–Sep', 4, 5],
    ['2026-11-15', 'oct-dec', 'Oct–Dec', 4, 5],
    ['2027-02-15', 'jan-mar', 'Jan–Mar', 5, 4],
    ['2027-05-15', 'apr-jun', 'Apr–Jun', 6, 3]
  ];
  for (const [date, id, label, pgy1Min, seniorMin] of blocks) {
    await page.goto(`${BASE}/morning-report/roles/pgy1/?date=${date}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!document.querySelector('.block-now'));
    const b = await page.evaluate(() => ({
      lb: document.querySelector('.block-now .lb').textContent,
      ask: document.querySelector('.block-now .ask').textContent,
      sub: document.querySelector('.block-now .sub').textContent,
      slot: document.querySelector('.card-slot').textContent,
      ladderCollapsed: !document.querySelector('details.ladder').open,
      nowRow: (document.querySelector('table.ladder tr.now td') || {}).textContent
    }));
    t(`pgy1 ${label}: names the current block`, b.lb.includes(label), b.lb);
    t(`pgy1 ${label}: first pass is ${pgy1Min} min`, b.slot.includes(pgy1Min + ' min'), b.slot);
    t(`pgy1 ${label}: the rest of the ladder is collapsed below`, b.ladderCollapsed === true);
    t(`pgy1 ${label}: the ladder marks this block`, b.nowRow === label, b.nowRow);
    if (id === 'jul-sep') t('pgy1 Jul–Sep: no extra demand yet', /four deliverables only/i.test(b.ask), b.ask);
    else t(`pgy1 ${label}: states the added ask`, /also owe/i.test(b.ask), b.ask);
  }

  // the senior card's chip must move with the block
  for (const [date, id, label, , seniorMin] of blocks) {
    await page.goto(`${BASE}/morning-report/roles/senior/?date=${date}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!document.querySelector('.card-slot'));
    const slot = await page.textContent('.card-slot');
    t(`senior ${label}: block reads ${seniorMin} min`, slot.includes(seniorMin + ' min'), slot);
  }

  // ---- ACCEPTANCE: change the senior's block in ONE file ----------------
  const before = fs.readFileSync(ROLES_JSON, 'utf8');
  const read = async (url, sel) => { await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForFunction(() => document.querySelectorAll('#card h1, #cards a').length > 0); return await page.evaluate(s => {
      const el = document.querySelector(s); return el ? el.textContent : null; }, sel); };

  const seniorBefore = await read(`${BASE}/morning-report/roles/senior/?date=2026-08-15`, '.card-slot');
  const rosBefore = await page.evaluate(async () => {
    const r = await fetch('../../content/roles.json', {cache:'no-cache'});
    return 'x';
  });
  await page.goto(`${BASE}/morning-report/roles/run-of-show/?date=2026-08-15`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('table.ros tbody tr').length > 0);
  const rosRowBefore = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('table.ros tbody tr')].find(r => r.children[2].textContent === 'Second pass');
    return { start: tr.children[0].textContent, min: tr.children[1].textContent };
  });
  const pgy1RowBefore = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('table.ros tbody tr')].find(r => r.children[2].textContent === 'First pass');
    return { start: tr.children[0].textContent, min: tr.children[1].textContent };
  });
  const labsBefore = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('table.ros tbody tr')].find(r => r.children[2].textContent === 'Labs & imaging');
    return tr.children[0].textContent;
  });

  // the one edit: Jul–Sep senior block, five minutes to four
  const edited = JSON.parse(before);
  edited.blocks.find(b => b.id === 'jul-sep').senior_minutes = 4;
  fs.writeFileSync(ROLES_JSON, JSON.stringify(edited, null, 2) + '\n');

  try {
    const seniorAfter = await read(`${BASE}/morning-report/roles/senior/?date=2026-08-15`, '.card-slot');
    t('acceptance: the senior card follows the one-file change',
       /5 min/.test(seniorBefore) && /4 min/.test(seniorAfter), [seniorBefore, seniorAfter]);

    await page.goto(`${BASE}/morning-report/roles/run-of-show/?date=2026-08-15`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('table.ros tbody tr').length > 0);
    const rosAfter = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('table.ros tbody tr')];
      const g = (seg) => { const tr = rows.find(r => r.children[2].textContent === seg);
        return { start: tr.children[0].textContent, min: tr.children[1].textContent }; };
      return { senior: g('Second pass'), pgy1: g('First pass'), labs: g('Labs & imaging') };
    });
    t('acceptance: the run-of-show card follows too',
       rosRowBefore.min === '5' && rosAfter.senior.min === '4', [rosRowBefore, rosAfter.senior]);
    t('acceptance: the minute goes to the intern, not to nowhere',
       pgy1RowBefore.min === '4' && rosAfter.pgy1.min === '5', [pgy1RowBefore, rosAfter.pgy1]);
    t('acceptance: the called handoffs at 0:07 and 0:16 do not move',
       rosAfter.pgy1.start === '0:07' && rosAfter.labs.start === labsBefore && labsBefore === '0:16',
       [rosAfter.pgy1.start, rosAfter.labs.start, labsBefore]);

    // the draw page reads the same file
    await page.goto(`${BASE}/morning-report/draw/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('[data-slot="senior"]').textContent.includes('min'));
    const drawSlot = await page.evaluate(() => {
      document.getElementById('s-date').value = '2026-08-15';
      renderBlockNote();
      return document.querySelector('[data-slot="senior"]').textContent;
    });
    t('acceptance: the draw page follows too', /4 min/.test(drawSlot), drawSlot);

    // the print view is the same DOM, so it cannot drift by construction
    await page.goto(`${BASE}/morning-report/roles/senior/?date=2026-08-15`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!document.querySelector('.card-slot'));
    await page.emulateMedia({ media: 'print' });
    const printSlot = await page.evaluate(() => {
      const el = document.querySelector('.card-slot');
      return { text: el.textContent, visible: getComputedStyle(el).display !== 'none' };
    });
    const printHidden = await page.evaluate(() => ({
      bar: getComputedStyle(document.querySelector('.mr-bar')).display,
      nav: getComputedStyle(document.querySelector('.card-nav')).display,
      body: getComputedStyle(document.body).backgroundColor
    }));
    await page.emulateMedia({ media: 'screen' });
    t('acceptance: the print view shows the same 4 min',
       /4 min/.test(printSlot.text) && printSlot.visible, printSlot);
    t('print view drops the app chrome', printHidden.bar === 'none' && printHidden.nav === 'none', printHidden);
    t('print view is on white', printHidden.body === 'rgb(255, 255, 255)', printHidden.body);
  } finally {
    fs.writeFileSync(ROLES_JSON, before);
  }

  // restored
  const restored = await read(`${BASE}/morning-report/roles/senior/?date=2026-08-15`, '.card-slot');
  t('roles.json restored after the acceptance test', /5 min/.test(restored), restored);

  // ---- the roles index and handouts ---------------------------------------
  await page.goto(`${BASE}/morning-report/roles/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#cards a.rc').length === 7);
  const idx = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('#cards a.rc')].map(a => a.getAttribute('href')),
    files: [...document.querySelectorAll('#downloads a.file')].map(a => a.getAttribute('href')),
    hasAnchor: !!document.getElementById('handouts')
  }));
  t('index lists all seven cards, each at its own URL',
     idx.cards.length === 7 && idx.cards.every(h => /\/$/.test(h)), idx.cards);
  t('handouts anchor exists for the hub link', idx.hasAnchor === true);

  // every hosted file must actually be there
  const missingFiles = [];
  for (const href of idx.files) {
    const r = await page.request.get(new URL(href, `${BASE}/morning-report/roles/`).href);
    if (!r.ok()) missingFiles.push(href + ' -> ' + r.status());
  }
  t('every listed handout resolves', missingFiles.length === 0, missingFiles);

  // ---- mobile readability --------------------------------------------------
  const phone = await ctx.newPage();
  await phone.addInitScript(fake);
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(`${BASE}/morning-report/roles/pgy1/`, { waitUntil: 'networkidle' });
  await phone.waitForFunction(() => !!document.querySelector('.block-now'));
  const mob = await phone.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    scrollW: document.documentElement.scrollWidth, win: window.innerWidth,
    fontOK: parseFloat(getComputedStyle(document.querySelector('.card-sec li') || document.body).fontSize) >= 13
  }));
  t('the PGY-1 card does not scroll sideways on a phone', mob.overflow === false, mob);
  t('body text stays readable on a phone', mob.fontOK === true, mob);

  let failed = 0;
  for (const r of out) { if (!r.pass) failed++; console.log((r.pass?'PASS  ':'FAIL  ') + r.name + (r.extra?'   '+r.extra:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - failed) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
