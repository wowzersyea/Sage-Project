const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');
// A fixture with the SHAPE of a real programme roster — multi-word
// surnames, multi-word given names, a hyphenated surname, and two people
// who share a given name so the wheel has to tell them apart. Every name
// here is invented.
const REAL = {
  academic_year: '2026-2027',
  residents: [
    ['Marisol Aguirre Castellanos', 'Aguirre Castellanos, Marisol', 'Marisol A.'],
    ['Tobias Lennart Havard Brandt', 'Brandt, Tobias Lennart Havard', 'Tobias B.'],
    ['Rashid Naveed Kamal Chaudhry', 'Chaudhry, Rashid Naveed Kamal', 'Rashid C.'],
    ['Ingrid Solveig Dahl',           'Dahl, Ingrid Solveig',           'Ingrid D.'],
    ['Rashid Farouk El-Amin',         'El-Amin, Rashid Farouk',         'Rashid E.'],
    ['Priyanka Devi Ganeshan',        'Ganeshan, Priyanka Devi',        'Priyanka G.'],
    ['Nils Hovland',                  'Hovland, Nils',                  'Nils H.'],
    ['Camila Iglesias Bermudez',      'Iglesias Bermudez, Camila',      'Camila I.'],
    ['Yusuf Bilal Karim Jandali',     'Jandali, Yusuf Bilal Karim',     'Yusuf J.'],
    ['Bronwen Kestrel',               'Kestrel, Bronwen',               'Bronwen K.'],
    ['Adaeze Lindiwe Mbeki',          'Mbeki, Adaeze Lindiwe',          'Adaeze M.'],
    ['Teodoro Nunez',                 'Nunez, Teodoro',                 'Teodoro N.'],
    ['Saoirse Ophelia',               'Ophelia, Saoirse',               'Saoirse O.'],
    ['Anouk Petronella Van Der Waal', 'Van Der Waal, Anouk Petronella', 'Anouk V.'],
    ['Zeynep Wren-Halloran',          'Wren-Halloran, Zeynep',          'Zeynep W.'],
    ['Kwabena Yeboah Asante',         'Yeboah Asante, Kwabena',         'Kwabena Y.'],
  ].map(([name, sort_name, short], i) => ({
    id: 'r-' + String(i + 1).padStart(3, '0'),
    name, sort_name, short, level: 'PGY-1', active: true, unavailable: [],
  })),
  log: [], cycle: {}, settings: { overdue_weeks: 8 },
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { const u=(m.location()&&m.location().url)||''; if (m.type()==='error' && !/googletagmanager|favicon|ERR_/.test(m.text()+' '+u)) errs.push('console: ' + m.text()); });
  await page.addInitScript(fake);
  await page.goto(BASE + '/morning-report/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

  const out = [];
  const t = (n, c, x) => out.push({ n, p: !!c, x: x === undefined ? '' : JSON.stringify(x) });

  // ---- unit: displayName falls back ------------------------------------
  await page.goto(BASE + '/morning-report/roster/', { waitUntil: 'networkidle' });
  const unit = await page.evaluate(() => {
    const R = MRRoster;
    return {
      withShort: R.displayName({ name: 'Rashid Naveed Kamal Chaudhry', short: 'Rashid C.' }),
      withoutShort: R.displayName({ name: 'Nils Hovland' }),
      emptyShort: R.displayName({ name: 'Nils Hovland', short: '  ' }),
      none: R.displayName(null),
      suggest: [R.suggestShort('Rashid Naveed Kamal Chaudhry'),
                R.suggestShort('Kwabena Yeboah Asante'),
                R.suggestShort('Zeynep Wren-Halloran'),
                R.suggestShort('Cher')],
    };
  });
  t('short name is used when present', unit.withShort === 'Rashid C.', unit.withShort);
  t('falls back to the full name when absent', unit.withoutShort === 'Nils Hovland', unit.withoutShort);
  t('a blank short name falls back too', unit.emptyShort === 'Nils Hovland', unit.emptyShort);
  t('a missing resident is the empty string', unit.none === '');
  t('suggestion is first name + surname initial',
     JSON.stringify(unit.suggest) === JSON.stringify(['Rashid C.','Kwabena A.','Zeynep W.','Cher']), unit.suggest);

  // ---- an old roster with no short names still works --------------------
  await page.evaluate(async () => {
    await MRStore.whenReady; await MRStore.connect();
    await MRStore.write('roster.json', {
      academic_year: '2026-2027',
      residents: [
        { id:'r-1', name:'Aisha Rahman', level:'PGY-1', active:true, unavailable:[] },
        { id:'r-2', name:'Ben Ortiz',    level:'PGY-1', active:true, unavailable:[] },
        { id:'r-3', name:'Priya Menon',  level:'PGY-2', active:true, unavailable:[] }],
      log: [], cycle: {}, settings: { overdue_weeks: 8 }
    });
  });
  await page.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.wheels && wheels.pgy1 && wheels.pgy1.people.length > 0);
  const legacy = await page.evaluate(() => ({
    wedges: [...document.querySelectorAll('#col-pgy1 .seg-label')].map(x => x.textContent),
    chips: [...document.querySelectorAll('#col-pgy1 .chip')].map(x => x.textContent),
  }));
  t('a roster with no short names shows full names', legacy.wedges.join(',') === 'Aisha Rahman,Ben Ortiz', legacy.wedges);
  t('and its chips do too', legacy.chips.join(',') === 'Aisha Rahman,Ben Ortiz', legacy.chips);

  // ---- the real roster: full name where it counts ------------------------
  await page.evaluate(async (r) => { await MRStore.connect(); await MRStore.write('roster.json', r); }, REAL);
  await page.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.wheels && wheels.pgy1 && wheels.pgy1.people.length === 16);

  const wedges = await page.evaluate(() => [...document.querySelectorAll('#col-pgy1 .seg-label')].map(x => x.textContent));
  t('no wedge is truncated', wedges.every(w => !w.includes('…')), wedges.filter(w => w.includes('…')));
  t('all sixteen wedges are distinct', new Set(wedges).size === 16, wedges.length - new Set(wedges).size);
  t('two residents sharing a given name are told apart',
     wedges.includes('Rashid C.') && wedges.includes('Rashid E.'), wedges.filter(w => w.startsWith('Rashid')));

  const chipTitle = await page.evaluate(() => document.querySelector('#col-pgy1 .chip').title);
  t('the chip tooltip still carries the full name', /Marisol Aguirre Castellanos/.test(chipTitle), chipTitle);

  // draw one and check the readout and the email
  await page.evaluate(() => document.querySelector('#col-pgy1 .btn-spin').click());
  await page.waitForFunction(() => wheels.pgy1.winner !== null, null, { timeout: 20000 });
  const drawn = await page.evaluate(() => ({
    winner: wheels.pgy1.winner.name,
    readout: document.querySelector('#col-pgy1 .readout .name').textContent,
    card: document.querySelector('#cards .cardbox .nm').textContent,
    mailto: decodeURIComponent(mailtoFor('pgy1_discussant', wheels.pgy1.winner)),
  }));
  t('the readout announces the FULL name', drawn.readout === drawn.winner, [drawn.readout, drawn.winner]);
  t('the handoff card shows the full name', drawn.card === drawn.winner, drawn.card);
  t('the email greets by first name', drawn.mailto.includes('Hi ' + drawn.winner.split(' ')[0]), drawn.mailto.slice(0, 0));
  t('the email carries no short-name abbreviation', !/\b[A-Z]\.\s/.test(drawn.mailto.split('\n')[2] || ''));

  // ---- roster page: the short name is editable --------------------------
  await page.goto(BASE + '/morning-report/roster/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#residents .res-row').length === 16, null, { timeout: 15000 });
  const ed = await page.evaluate(() => {
    const row = document.querySelectorAll('#residents .res-row')[0];
    const inputs = row.querySelectorAll('input[type=text]');
    return { headers: [...document.querySelectorAll('.res-head span')].map(s => s.textContent),
             fullName: inputs[0].value, short: inputs[1].value, title: inputs[1].title };
  });
  t('the editor has an "On the wheel" column', ed.headers.includes('On the wheel'), ed.headers);
  t('it shows the short name beside the full one', ed.short.endsWith('.') && ed.fullName.split(' ').length >= 2, [ed.fullName, ed.short]);
  t('and explains what it is for', /wheel/i.test(ed.title));

  // the editor is ordered by surname, so row 0 is Aguirre Castellanos
  const rowOrder = await page.evaluate(() =>
    [...document.querySelectorAll('#residents .res-row')].slice(0, 4)
      .map(r => r.querySelector('input[type=text]').value));
  t('the editor is ordered by surname, not given name',
     rowOrder[0] === 'Marisol Aguirre Castellanos' && rowOrder[1] === 'Tobias Lennart Havard Brandt',
     rowOrder);

  const first = page.locator('#residents .res-row').first().locator('input[type=text]').nth(1);
  await first.fill('Stef A.');
  await first.dispatchEvent('change');
  await page.waitForTimeout(300);
  const saved = await page.evaluate(async () => (await MRStore.read('roster.json')).residents.find(r => r.id === 'r-001').short);
  t('editing the short name persists', saved === 'Stef A.', saved);

  let f = 0;
  for (const r of out) { if (!r.p) f++; console.log((r.p?'PASS  ':'FAIL  ') + r.n + (r.x?'   '+r.x:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - f) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await b.close();
  process.exit(f || errs.length ? 1 : 0);
})();
