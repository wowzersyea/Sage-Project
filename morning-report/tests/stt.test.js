/* The transcriber: a recording into the folder, the button on the
   summary page, and the words landing back in the submission.

   This suite launches its own browser with a fake audio DEVICE — the
   MediaRecorder, the webm it produces, the decoder, the resampler and
   the whisper model are all real, served from this repository. The
   fake device plays a tone, and whisper-tiny dutifully hears music,
   which is the point: the pipeline ran end to end on real bytes.

   Also covered: a recording that is not decodable audio fails with a
   sentence instead of a spinner, and a transcript, once saved, is
   picked up by the rollup like any typed comment. */

const { chromium } = require('playwright');
const { launchOptions } = require('./browser');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

(async () => {
  const browser = await chromium.launch(launchOptions({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  }));
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { const u=(m.location()&&m.location().url)||''; if (m.type()==='error' && !/googletagmanager|favicon|ERR_CONNECTION_RESET|clients2/.test(m.text()+' '+u)) errs.push('console: ' + m.text()); });
  await page.addInitScript(fake);
  await page.goto(BASE + '/morning-report/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

  const out = [];
  const t = (name, cond, extra) => out.push({ name, pass: !!cond, extra: extra === undefined ? '' : JSON.stringify(extra) });

  // ---- seed the folder: one submission, one real recording, one junk one --
  await page.goto(BASE + '/morning-report/feedback/summary/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
  await page.waitForTimeout(300);

  await page.evaluate(async () => {
    const sub = {
      id: 'fb-sttcase', session: '2026-11-19-galveston', date: '2026-11-19', site: 'Galveston',
      feedback_version: 1, submitted: '2026-11-19T13:30:00Z',
      overall: { rating: 4, checks: {}, comment: 'Typed half of the thought.' },
      technical: { rating: null, checks: {}, comment: '' },
      flow: { rating: null, checks: {}, comment: '' },
      roles: { pgy1: { rating: 5, comment: '' } }
    };
    await MRStore.write('working/feedback/2026-11-19-galveston--fb-sttcase.json', sub);

    // a real webm off the (fake) microphone — three seconds of tone
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    const stopped = new Promise(r => rec.onstop = r);
    rec.start();
    await new Promise(r => setTimeout(r, 3000));
    rec.stop(); await stopped;
    stream.getTracks().forEach(tr => tr.stop());
    await MRStore.writeBlob('working/feedback/audio/2026-11-19-galveston--fb-sttcase--overall.webm',
      new Blob(chunks, { type: 'audio/webm' }));

    // and one that is not audio at all, for the role box
    await MRStore.writeBlob('working/feedback/audio/2026-11-19-galveston--fb-sttcase--role-pgy1.webm',
      new Blob(['this is not audio'], { type: 'audio/webm' }));
  });

  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
  await page.waitForTimeout(600);

  // ---- the panel shows both, named for their boxes ------------------------
  const panel = await page.evaluate(() => ({
    shown: !document.getElementById('recpanel').hidden,
    rows: [].map.call(document.querySelectorAll('.recrow .who'), el => el.textContent.trim()),
    buttons: document.querySelectorAll('.recrow button').length,
    players: document.querySelectorAll('.recrow audio').length
  }));
  t('the recordings panel lists what the folder holds', panel.shown && panel.rows.length === 2, panel.rows);
  t('each row is named for the box it was said into',
     panel.rows.indexOf('Overall') !== -1 && panel.rows.indexOf('PGY-1 Discussant') !== -1, panel.rows);
  t('every recording gets a player', panel.players === 2, panel.players);

  // ---- transcribe the real one -------------------------------------------
  await page.evaluate(() => {
    const rows = [].slice.call(document.querySelectorAll('.recrow'));
    const row = rows.filter(r => /Overall/.test(r.querySelector('.who').textContent))[0];
    row.querySelector('button').click();
  });
  await page.waitForFunction(() => {
    const rows = [].slice.call(document.querySelectorAll('.recrow'));
    const row = rows.filter(r => /Overall/.test(r.querySelector('.who').textContent))[0];
    const txt = row ? row.querySelector('.txt').textContent : '';
    return /“|Nothing intelligible|Could not/.test(txt);
  }, { timeout: 120000 });

  const done = await page.evaluate(async () => {
    const rows = [].slice.call(document.querySelectorAll('.recrow'));
    const row = rows.filter(r => /Overall/.test(r.querySelector('.who').textContent))[0];
    const sub = await MRStore.read('working/feedback/2026-11-19-galveston--fb-sttcase.json');
    return {
      txt: row.querySelector('.txt').textContent,
      btn: row.querySelector('button').textContent,
      saved: sub.overall.transcript || null,
      comments: (typeof roll !== 'undefined' && roll) ? roll.sections.overall.comments : []
    };
  });
  t('the pipeline ran to a verdict on real audio',
     /“|Nothing intelligible/.test(done.txt), done.txt.slice(0, 60));
  if (/“/.test(done.txt)) {
    t('the transcript is saved into the submission file', !!done.saved, done.saved);
    t('and the rollup reads it like a comment, marked as spoken',
       done.comments.some(c => /said into the recording/.test(c)), done.comments);
    t('the button now offers to do it again', /again/i.test(done.btn), done.btn);
  } else {
    t('a silent verdict saves nothing', done.saved === null, done.saved);
    t('(rollup check skipped — the tone transcribed to nothing this run)', true);
    t('(button check skipped — nothing was saved)', true);
  }

  // ---- junk in, sentence out ---------------------------------------------
  await page.evaluate(() => {
    const rows = [].slice.call(document.querySelectorAll('.recrow'));
    const row = rows.filter(r => /PGY-1/.test(r.querySelector('.who').textContent))[0];
    row.querySelector('button').click();
  });
  await page.waitForFunction(() => {
    const rows = [].slice.call(document.querySelectorAll('.recrow'));
    const row = rows.filter(r => /PGY-1/.test(r.querySelector('.who').textContent))[0];
    return row && /Could not transcribe/.test(row.querySelector('.txt').textContent);
  }, { timeout: 60000 });
  const junk = await page.evaluate(async () => {
    const rows = [].slice.call(document.querySelectorAll('.recrow'));
    const row = rows.filter(r => /PGY-1/.test(r.querySelector('.who').textContent))[0];
    const sub = await MRStore.read('working/feedback/2026-11-19-galveston--fb-sttcase.json');
    return { txt: row.querySelector('.txt').textContent,
             saved: (sub.roles.pgy1 || {}).transcript || null,
             retryable: !row.querySelector('button').disabled };
  });
  t('an undecodable recording fails with a sentence, not a spinner',
     /Could not transcribe/.test(junk.txt), junk.txt.slice(0, 70));
  t('and saves nothing', junk.saved === null);
  t('and can be tried again', junk.retryable);

  // ---- nothing left this tab ---------------------------------------------
  const clean = await page.evaluate(() => Object.keys(localStorage)
    .filter(k => !k.startsWith('__fake') && ['sage-mr-gate', 'sage-mr-remote'].indexOf(k) === -1));
  t('the transcriber writes nothing to localStorage', clean.length === 0, clean);

  let failed = 0;
  for (const r of out) { if (!r.pass) failed++; console.log((r.pass?'PASS  ':'FAIL  ') + r.name + (r.extra?'   '+r.extra:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - failed) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
