const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

const ARCHIVE = {
  id: '2026-09-03-galveston', date: '2026-09-03', site: 'Galveston',
  case_id: 'PEDS-MR-04',
  objective: 'Distinguish septic arthritis from transient synovitis in a febrile toddler',
  problem_representation: '3-year-old, two days of fever, refusing to bear weight, hip flexed and externally rotated',
  key_data: { vitals:{t:'38.6'}, history:[], pertinent_positives:[], pertinent_negatives:[], labs_block_1:[], labs_block_2:[] },
  framework: 'Anatomic — by layer',
  differential: {
    intern: [
      { name:'Septic arthritis of the hip', why:'positioning plus the CRP', struck:false, kill:'' },
      { name:'Transient synovitis', why:'main competitor', struck:false, kill:'' },
      { name:'Osteomyelitis of the proximal femur', why:'possible', struck:false, kill:'' }
    ],
    senior: [ { name:'Cellulitis', why:'skin layer', struck:true, kill:'no erythema' } ]
  },
  discriminators: { next_test:'Hip ultrasound', if_positive:'', if_negative:'', pending:[], bias_watch:[] },
  plan: 'Septic arthritis ~70%',
  take_homes: 'Three of four Kocher criteria is past talking yourself out of it\nA dry tap moves you from joint to bone\nTransient synovitis usually still weight-bears',
  derived: { board_archived: true }
};

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

  // ---- PHI rules, unit level ------------------------------------------
  await page.goto(BASE + '/morning-report/capture/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });

  const phi = await page.evaluate(() => {
    const s = (txt) => MRPhi.scan(txt, 'f').map(f => f.severity + ':' + f.kind);
    return {
      mrn:       s('Admitted under MRN 4417723 with fever'),
      mrn2:      s('medical record number: A992381'),
      longnum:   s('Account 8837462 was opened'),
      dateSlash: s('Presented on 09/03/2026 with fever'),
      dateISO:   s('Seen 2026-09-03 in clinic'),
      dateWord:  s('Admitted September 3, 2026 overnight'),
      phone:     s('Call the family at 409-555-0147'),
      ssn:       s('SSN 123-45-6789'),
      age:       s('A 93-year-old grandmother also unwell'),
      honorific: s('Discussed with Dr. Fitzgerald at length'),
      relative:  s('His mother Marguerite reported the fever'),
      address:   s('Lives at 214 Seawall Boulevard'),
      // these must NOT fire
      kawasaki:  s('Incomplete Kawasaki disease in an infant'),
      kocher:    s('Three of four Kocher criteria were met'),
      epstein:   s('Epstein Barr virus hepatitis'),
      henoch:    s('Henoch Schonlein purpura with nephritis'),
      eponymDr:  s('Described by Dr. Kawasaki in 1967'),
      plainDx:   s('Septic arthritis of the hip, treated with cefazolin'),
      lab:       s('CRP 8.4, ESR 62, WBC 17.3'),
      illday:    s('Day 3 of illness, two weeks of malaise'),
      // a real-looking name must fire as a check
      name:      s('Reviewed with Marcus Webb before rounds')
    };
  });

  t('MRN blocked', phi.mrn.some(x => x === 'block:MRN'), phi.mrn);
  t('labelled record number blocked', phi.mrn2.some(x => x === 'block:MRN'), phi.mrn2);
  t('long digit run blocked', phi.longnum.some(x => x.startsWith('block:')), phi.longnum);
  t('slashed date of service blocked', phi.dateSlash.indexOf('block:date of service') !== -1, phi.dateSlash);
  t('ISO date of service blocked', phi.dateISO.indexOf('block:date of service') !== -1, phi.dateISO);
  t('written date of service blocked', phi.dateWord.indexOf('block:date of service') !== -1, phi.dateWord);
  t('phone number blocked', phi.phone.some(x => x.startsWith('block:')), phi.phone);
  t('SSN blocked', phi.ssn.some(x => x.startsWith('block:')), phi.ssn);
  t('age over 89 blocked', phi.age.indexOf('block:age over 89') !== -1, phi.age);
  t('honorific name blocked', phi.honorific.indexOf('block:named person') !== -1, phi.honorific);
  t('named relative blocked', phi.relative.indexOf('block:named relative') !== -1, phi.relative);
  t('street address blocked', phi.address.some(x => x.startsWith('block:')), phi.address);

  t('Kawasaki disease not flagged', phi.kawasaki.length === 0, phi.kawasaki);
  t('Kocher criteria not flagged', phi.kocher.length === 0, phi.kocher);
  t('Epstein Barr not flagged', phi.epstein.length === 0, phi.epstein);
  t('Henoch Schonlein not flagged', phi.henoch.length === 0, phi.henoch);
  t('eponym behind an honorific not flagged', phi.eponymDr.length === 0, phi.eponymDr);
  t('a plain diagnosis is clean', phi.plainDx.length === 0, phi.plainDx);
  t('lab values are clean', phi.lab.length === 0, phi.lab);
  t('illness day and relative time are clean', phi.illday.length === 0, phi.illday);
  t('a real name is raised for checking', phi.name.indexOf('check:possible name') !== -1, phi.name);

  // ---- prefill from the board ------------------------------------------
  await page.evaluate(async (a) => {
    await MRStore.connect();
    await MRStore.write('board-archive/' + a.id + '.json', a);
  }, ARCHIVE);

  await page.goto(BASE + '/morning-report/capture/?session=2026-09-03-galveston', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('one_liner').value.length > 0, null, { timeout: 8000 });

  const pre = await page.evaluate(() => ({
    date: document.getElementById('date').value,
    site: document.getElementById('site').value,
    objective: document.getElementById('objective').value,
    one_liner: document.getElementById('one_liner').value,
    framework: document.getElementById('framework').value,
    takeaways: [0,1,2].map(i => document.getElementById('take' + i).value),
    dxOffered: [...document.querySelectorAll('#dxpick button')].map(b => b.textContent),
    markers: [...document.querySelectorAll('.from-board')].filter(e => !e.hidden).length
  }));
  t('date and site prefilled', pre.date === '2026-09-03' && pre.site === 'Galveston', pre);
  t('one-liner from the problem representation', /refusing to bear weight/.test(pre.one_liner));
  t('framework prefilled', pre.framework === 'Anatomic — by layer', pre.framework);
  t('objective prefilled', /septic arthritis/i.test(pre.objective));
  t('three takeaways split from the take-homes', pre.takeaways.filter(Boolean).length === 3, pre.takeaways);
  t('surviving diagnoses offered, struck ones not',
     pre.dxOffered.length === 3 && pre.dxOffered.indexOf('Cellulitis') === -1, pre.dxOffered);
  t('prefilled fields are marked as from the board', pre.markers >= 4, pre.markers);

  // ---- a blocking identifier stops the save -----------------------------
  await page.click('#dxpick button');
  await page.fill('#tagin', 'ortho'); await page.press('#tagin', 'Enter');
  await page.evaluate(() => { revalidate(); });
  const cleanState = await page.evaluate(() => ({ disabled: document.getElementById('save').disabled, note: document.getElementById('savenote').textContent }));
  t('a clean, complete entry can be saved', cleanState.disabled === false, cleanState);

  await page.fill('#one_liner', '3-year-old seen on 09/03/2026, MRN 4417723, refusing to bear weight');
  await page.evaluate(() => revalidate());
  const blocked = await page.evaluate(() => ({
    disabled: document.getElementById('save').disabled,
    note: document.getElementById('savenote').textContent,
    shown: !document.getElementById('phi').hidden,
    kinds: [...document.querySelectorAll('.finding .kind')].map(k => k.textContent)
  }));
  t('identifiers block the save', blocked.disabled === true && blocked.shown === true, blocked);
  t('both the date and the MRN are named', blocked.kinds.indexOf('MRN') !== -1 && blocked.kinds.indexOf('date of service') !== -1, blocked.kinds);

  const stillNotWritten = await page.evaluate(async () => {
    document.getElementById('save').click();
    await new Promise(r => setTimeout(r, 200));
    return await MRStore.list('casebank');
  });
  t('a blocked entry is never written', stillNotWritten.length === 0, stillNotWritten);

  // ---- fix it and save ---------------------------------------------------
  await page.fill('#one_liner', '3-year-old, two days of fever, refusing to bear weight, hip flexed and externally rotated');
  await page.evaluate(() => revalidate());

  // a name-shaped phrase must be acknowledged, not silently allowed
  await page.fill('#rationale', 'As Marcus Webb pointed out on the call');
  await page.evaluate(() => revalidate());
  const needsAck = await page.evaluate(() => ({
    disabled: document.getElementById('save').disabled,
    note: document.getElementById('savenote').textContent,
    hasCheckbox: !!document.querySelector('.finding.check input[type=checkbox]')
  }));
  t('a name-shaped phrase blocks until it is dealt with', needsAck.disabled === true && needsAck.hasCheckbox, needsAck);

  await page.check('.finding.check input[type=checkbox]');
  const afterAck = await page.evaluate(() => document.getElementById('save').disabled);
  t('acknowledging it unblocks the save', afterAck === false);

  await page.fill('#rationale', 'A negative effusion pushes toward bone rather than back to synovitis.');
  await page.fill('#stem', 'A 4-year-old with fever and hip pain has a normal hip ultrasound. Next best step?');
  for (const [i, v] of [['0','Discharge with NSAIDs'],['1','MRI of the pelvis and femur'],['2','Repeat CRP in 48 hours'],['3','Empiric oral cephalexin']]) {
    await page.fill('#opt' + i, v);
  }
  await page.check('input[name=answer][value="1"]');
  await page.evaluate(() => revalidate());
  await page.click('#save');
  await page.waitForTimeout(400);

  const saved = await page.evaluate(async () => ({
    files: await MRStore.list('casebank'),
    entry: await MRStore.read('casebank/2026-09-03-galveston.json')
  }));
  t('the entry is written under its session id', saved.files.join(',') === '2026-09-03-galveston.json', saved.files);
  t('entry matches the shape the review game expects',
     saved.entry && saved.entry.id && saved.entry.one_liner && saved.entry.diagnosis &&
     Array.isArray(saved.entry.takeaways) && Array.isArray(saved.entry.tags) &&
     saved.entry.board_question && saved.entry.board_question.answer_index === 1 &&
     saved.entry.board_question.options.length === 4,
     saved.entry && Object.keys(saved.entry));
  t('no identifiers survived into the entry',
     !/09\/03\/2026|4417723|Marcus Webb/.test(JSON.stringify(saved.entry)));

  let failed = 0;
  for (const r of out) { if (!r.pass) failed++; console.log((r.pass?'PASS  ':'FAIL  ') + r.name + (r.extra?'   '+r.extra:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - failed) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
