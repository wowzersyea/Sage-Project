const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

/* Invented people, arranged the way a real two-site programme is: each
   site fields a ward team plus people on other services. Picking a site
   means the report is happening there, so the wheels hold that site's
   people and nobody else — the discussant has to be in the room. */
const R = (id, name, level) => ({ id, name, sort_name: name.split(' ').reverse().join(', '),
                                  level, active: true, unavailable: [] });
const ROSTER = {
  academic_year: '2026-2027',
  residents: [
    R('r-1', 'Marisol Aguirre', 'PGY-1'),   // GAL ward intern
    R('r-2', 'Rashid Chaudhry', 'PGY-1'),   // CLC ward intern
    R('r-3', 'Ingrid Dahl',     'PGY-1'),   // AAI  (CLC side, not ward)
    R('r-4', 'Teodoro Nunez',   'PGY-3'),   // GAL ward senior
    R('r-5', 'Bronwen Kestrel', 'PGY-2'),   // CLC ward senior
    R('r-6', 'Anouk Vandal',    'PGY-2'),   // GAL flex (not ward)
    R('r-7', 'Kwabena Asante',  'PGY-3'),   // PICU    (not ward)
    R('r-8', 'Saoirse Ophelia', 'PGY-1'),   // off service entirely
  ],
  log: [], cycle: {}, settings: { overdue_weeks: 8 },
};
const DATE = '2026-09-03';
const ROTATIONS = {
  academic_year: '2026-2027', from: DATE, to: DATE,
  tasks: ['GAL Ward Int','GAL Ward Sr','GAL Flex','PICU','CLC Ward Int','CLC Ward Sr','AAI'],
  sites: {
    GAL: { label: 'Galveston',  ward: ['GAL Ward Int','GAL Ward Sr'], other: ['GAL Flex','PICU'] },
    CLC: { label: 'Clear Lake', ward: ['CLC Ward Int','CLC Ward Sr'], other: ['AAI'] },
  },
  days: { [DATE]: {
    'GAL Ward Int': ['r-1'], 'GAL Ward Sr': ['r-4'], 'GAL Flex': ['r-6'], 'PICU': ['r-7'],
    'CLC Ward Int': ['r-2'], 'CLC Ward Sr': ['r-5'], 'AAI': ['r-3'],
  } },
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await (await b.newContext()).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { const u=(m.location()&&m.location().url)||''; if (m.type()==='error' && !/googletagmanager|favicon|ERR_/.test(m.text()+' '+u)) errs.push('console: ' + m.text()); });
  await page.addInitScript(fake);
  await page.goto(BASE + '/morning-report/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

  const out = [];
  const t = (n, c, x) => out.push({ n, p: !!c, x: x === undefined ? '' : JSON.stringify(x) });

  await page.goto(BASE + '/morning-report/roster/', { waitUntil: 'networkidle' });
  await page.evaluate(async (d) => {
    await MRStore.whenReady; await MRStore.connect();
    await MRStore.write('roster.json', d.r); await MRStore.write('rotations.json', d.rot);
  }, { r: ROSTER, rot: ROTATIONS });

  await page.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.wheels && wheels.pgy1);
  await page.fill('#s-date', DATE);
  await page.dispatchEvent('#s-date', 'change');
  await page.waitForTimeout(250);

  const state = () => page.evaluate(() => ({
    intern: wheels.pgy1.people.map(p => p.name).sort(),
    senior: wheels.senior.people.map(p => p.name).sort(),
    bar: document.getElementById('dutybar').textContent.replace(/\s+/g, ' ').trim(),
  }));

  // ---- the rotation restricts the wheel to who is on service ----------
  let s = await state();
  t('someone off service entirely is not on the wheel', !s.intern.includes('Saoirse Ophelia'), s.intern);
  t('with no site picked, everyone on service is a candidate',
     s.intern.length === 3 && s.senior.length === 4, s);
  t('and the bar asks for a site', /Pick a site/i.test(s.bar), s.bar);

  // ---- report at Galveston ---------------------------------------------
  // Only Galveston's people: its ward team INCLUDED (they are in the
  // room), everyone at Clear Lake off both wheels.
  await page.click('#presenting button:text-is("Galveston")');
  await page.waitForTimeout(250);
  s = await state();
  t('GAL report: the GAL ward intern is ON the wheel', s.intern.includes('Marisol Aguirre'), s.intern);
  t('GAL report: the GAL ward senior is ON the wheel', s.senior.includes('Teodoro Nunez'), s.senior);
  t('GAL report: GAL flex is on the senior wheel', s.senior.includes('Anouk Vandal'), s.senior);
  t('GAL report: PICU is on the senior wheel', s.senior.includes('Kwabena Asante'), s.senior);
  t('GAL report: the CLC ward team is off both wheels',
     !s.intern.includes('Rashid Chaudhry') && !s.senior.includes('Bronwen Kestrel'), s);
  t('GAL report: AAI (a CLC service) is off', !s.intern.includes('Ingrid Dahl'), s.intern);
  t('GAL report: 1 intern and 3 seniors', s.intern.length === 1 && s.senior.length === 3, s);
  t('the bar names who the wheels draw from',
     /Marisol Aguirre/.test(s.bar) && /Kwabena Asante/.test(s.bar), s.bar);
  t('and warns that one intern is nothing to draw', /nothing to draw/i.test(s.bar), s.bar);

  // ---- report at Clear Lake --------------------------------------------
  await page.click('#presenting button:text-is("Clear Lake")');
  await page.waitForTimeout(250);
  s = await state();
  t('CLC report: its ward team is ON the wheels',
     s.intern.includes('Rashid Chaudhry') && s.senior.includes('Bronwen Kestrel'), s);
  t('CLC report: the whole GAL side is off',
     !s.intern.includes('Marisol Aguirre') && !s.senior.includes('Teodoro Nunez') &&
     !s.senior.includes('Anouk Vandal') && !s.senior.includes('Kwabena Asante'), s);
  t('CLC report: AAI is a CLC service, so on', s.intern.includes('Ingrid Dahl'), s.intern);
  t('CLC report: 2 interns and 1 senior', s.intern.length === 2 && s.senior.length === 1, s);

  // ---- the acting intern flex button -----------------------------------
  const before = (await state()).intern.length;
  await page.check('#acting-on');
  await page.fill('#acting-name', 'Wren Halloran (MS4)');
  await page.waitForTimeout(300);
  s = await state();
  t('the acting intern joins the intern wheel',
     s.intern.length === before + 1 && s.intern.includes('Wren Halloran (MS4)'), s.intern);
  t('and never joins the senior wheel', !s.senior.includes('Wren Halloran (MS4)'), s.senior);

  await page.uncheck('#acting-on');
  await page.waitForTimeout(250);
  s = await state();
  t('unticking removes them again', s.intern.length === before, s.intern);

  // an empty name is not a person
  await page.check('#acting-on');
  await page.fill('#acting-name', '   ');
  await page.waitForTimeout(250);
  s = await state();
  t('a blank name adds nobody', s.intern.length === before, s.intern);
  await page.uncheck('#acting-on');

  // ---- a date the rota does not cover ------------------------------------
  await page.fill('#s-date', '2027-12-25');
  await page.dispatchEvent('#s-date', 'change');
  await page.waitForTimeout(300);
  s = await state();
  t('an uncovered date falls back to the whole roster', s.intern.length === 4, s.intern);
  t('and says so rather than silently filtering', /No rotation for/i.test(s.bar), s.bar);

  // ---- no rotation file at all -------------------------------------------
  await page.evaluate(async () => { await MRStore.remove('rotations.json'); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.wheels && wheels.pgy1 && wheels.pgy1.people.length > 0);
  const noRot = await page.evaluate(() => ({
    intern: wheels.pgy1.people.length,
    barHidden: document.getElementById('dutybar').hidden,
    toggleHidden: document.getElementById('presenting-wrap').hidden,
  }));
  t('with no rotation file the whole roster is eligible', noRot.intern === 4, noRot);
  t('and neither the duty bar nor the site toggle appears',
     noRot.barHidden && noRot.toggleHidden, noRot);

  let f = 0;
  for (const r of out) { if (!r.p) f++; console.log((r.p?'PASS  ':'FAIL  ') + r.n + (r.x?'   '+r.x:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - f) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await b.close();
  process.exit(f || errs.length ? 1 : 0);
})();
