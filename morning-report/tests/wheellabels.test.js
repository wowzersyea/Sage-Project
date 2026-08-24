const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

/* Invented names, chosen for length: a wheel label runs along a radius
   and has about 140px to work with, so what matters is how wide a name
   renders, not who it belongs to. */
const NAMES = [
  'Marisol Aguirre Castellanos',      // long, wraps
  'Tobias Lennart Havard Brandt',     // longest, wraps
  'Nils Hovland',                     // short, one line at full size
  'Anouk Petronella Van Der Waal',    // very long
  'Priyanka Devi Ganeshan',
  'Kwabena Yeboah Asante',
];

function rosterOf(n) {
  return {
    academic_year: '2026-2027',
    residents: NAMES.slice(0, n).map((name, i) => ({
      id: 'r-' + (i + 1), name, level: 'PGY-1', active: true, unavailable: [],
    })),
    log: [], cycle: {}, settings: { overdue_weeks: 8 },
  };
}

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

  async function labelsFor(n) {
    await page.goto(BASE + '/morning-report/roster/', { waitUntil: 'networkidle' });
    await page.evaluate(async (r) => { await MRStore.whenReady; await MRStore.connect(); await MRStore.write('roster.json', r); }, rosterOf(n));
    await page.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });
    await page.waitForFunction((k) => window.wheels && wheels.pgy1 && wheels.pgy1.people.length === k, n, { timeout: 20000 });
    return page.evaluate(() => {
      const svg = document.querySelector('#col-pgy1 svg.wheel');
      return [...svg.querySelectorAll('text.seg-label')].map(el => {
        const spans = el.querySelectorAll('tspan');
        const lines = spans.length ? [...spans].map(s => s.textContent) : [el.textContent];
        const widths = spans.length
          ? [...spans].map(s => s.getComputedTextLength())
          : [el.getComputedTextLength()];
        return { lines, size: +el.getAttribute('font-size'), widest: Math.max(...widths) };
      });
    });
  }

  // the realistic case: only whoever is on service is on the wheel
  for (const n of [2, 3, 5]) {
    const rows = await labelsFor(n);
    t(`${n} on the wheel: nothing is truncated`,
       rows.every(r => !r.lines.some(l => l.includes('…'))),
       rows.filter(r => r.lines.some(l => l.includes('…'))).map(r => r.lines));
    t(`${n} on the wheel: every line fits the radius`,
       rows.every(r => r.widest <= 140), rows.map(r => Math.round(r.widest)));
    t(`${n} on the wheel: the full name is shown`,
       rows.every((r, i) => r.lines.join(' ') === NAMES[i]), rows.map(r => r.lines.join(' ')));
    t(`${n} on the wheel: a short name needs no wrapping`,
       rows.some(r => r.lines.length === 1) || n < 3, rows.map(r => r.lines.length));
  }

  // a crowded wheel still degrades gracefully rather than overflowing
  const many = await labelsFor(6);
  t('a fuller wheel never overflows the radius',
     many.every(r => r.widest <= 140), many.map(r => Math.round(r.widest)));
  t('and never draws a label over the hub',
     many.every(r => r.widest <= 140 && r.size >= 11), many.map(r => r.size));

  // an explicit short name still wins over the measurement
  await page.goto(BASE + '/morning-report/roster/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await MRStore.connect();
    const r = await MRStore.read('roster.json');
    r.residents[0].short = 'Marisol A.';
    await MRStore.write('roster.json', r);
  });
  await page.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.wheels && wheels.pgy1 && wheels.pgy1.people.length === 6);
  const withShort = await page.evaluate(() => {
    const el = document.querySelector('#col-pgy1 svg.wheel text.seg-label');
    const spans = el.querySelectorAll('tspan');
    return spans.length ? [...spans].map(s => s.textContent) : [el.textContent];
  });
  t('an explicit short name overrides the fitting', withShort.join(' ') === 'Marisol A.', withShort);

  let f = 0;
  for (const r of out) { if (!r.p) f++; console.log((r.p?'PASS  ':'FAIL  ') + r.n + (r.x?'   '+r.x:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - f) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await b.close();
  process.exit(f || errs.length ? 1 : 0);
})();
