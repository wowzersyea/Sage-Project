const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

/* A SpeechRecognition that never touches a microphone. Installed
   before any page script runs, so voice.js picks it up as the real
   thing and the dictation path can be driven from the test. */
const FAKE_SPEECH = `
(function(){
  function Fake(){
    this.continuous = false; this.interimResults = false; this.lang = '';
    this.onresult = null; this.onerror = null; this.onend = null;
  }
  /* Nine boxes mean nine recognitions; the one that matters is the
     one that was started. */
  Fake.prototype.start = function(){ window.__speech = this; this.running = true; };
  Fake.prototype.stop  = function(){ this.running = false; if (this.onend) this.onend(); };
  Fake.prototype.abort = function(){ this.running = false; if (this.onend) this.onend(); };
  Fake.prototype.say = function(text, isFinal){
    if (!this.onresult) return;
    var results = [ { 0: { transcript: text }, isFinal: !!isFinal, length: 1 } ];
    this.onresult({ resultIndex: 0, results: results });
  };
  window.SpeechRecognition = Fake;
  window.webkitSpeechRecognition = Fake;
})();
`;

/* Stubbed model replies: the first confident, the rest under the
   confidence floor, so both sides of the flag are exercised. */
const FAKE_API = `
(function(){
  window.__calls = [];
  var real = window.fetch;
  window.fetch = function(url, opts){
    if (String(url).indexOf('api.anthropic.com') === -1) return real.apply(this, arguments);
    window.__calls.push({ url: String(url), headers: opts.headers, body: JSON.parse(opts.body) });
    var n = window.__calls.length;
    var draft = {
      summary: 'Reply ' + n + ', in the coaching voice.',
      one_thing: 'Change one thing, number ' + n + '.',
      agreement: n === 1 ? 'agreed' : 'thin',
      confidence: n === 1 ? 0.86 : 0.41
    };
    return Promise.resolve({
      ok: true, status: 200,
      json: function(){ return Promise.resolve({ content: [{ type:'text', text: JSON.stringify(draft) }] }); }
    });
  };
})();
`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { const u=(m.location()&&m.location().url)||''; if (m.type()==='error' && !/googletagmanager|favicon|ERR_CONNECTION_RESET/.test(m.text()+' '+u)) errs.push('console: ' + m.text()); });
  await page.addInitScript(fake);
  await page.addInitScript(FAKE_SPEECH);
  await page.addInitScript(FAKE_API);
  await page.goto(BASE + '/morning-report/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

  const out = [];
  const t = (name, cond, extra) => out.push({ name, pass: !!cond, extra: extra === undefined ? '' : JSON.stringify(extra) });

  const fill = async (date, site) => {
    await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
    await page.fill('#date', date);
    await page.fill('#site', site);
  };

  // ---- the form renders itself out of content -------------------------
  await page.goto(BASE + '/morning-report/feedback/', { waitUntil: 'networkidle' });
  await fill('2026-09-03', 'Galveston');

  const shape = await page.evaluate(() => ({
    sections: [].map.call(document.querySelectorAll('#sections .panel h2'), h => h.textContent),
    roles: [].map.call(document.querySelectorAll('#roles .row h3'), h => h.textContent),
    mics: document.querySelectorAll('button.mic').length,
    scaleOptions: document.querySelectorAll('#sections .panel .scale')[0].querySelectorAll('.opt').length,
    asksWho: /your name|who are you|filled in by/i.test(document.body.innerText)
  }));
  t('the three sections come from content, in its order',
     shape.sections.join('|') === 'Overall|Technical|Flow', shape.sections);
  t('six roles, named from roles.json', shape.roles.length === 6 && shape.roles[0] === 'Case Presenter', shape.roles);
  t('every comment box gets a microphone', shape.mics === 9, shape.mics);
  t('five points on the scale, plus a way out', shape.scaleOptions === 6, shape.scaleOptions);
  t('nothing on the form asks who is filling it in', !shape.asksWho);

  // ---- dictation lands in the box -------------------------------------
  const dictated = await page.evaluate(() => {
    const box = document.getElementById('c-overall');
    box.value = 'Typed first.';
    const mic = box.parentNode.querySelector('button.mic');
    mic.click();
    window.__speech.say('and then dictated', true);
    const interim = box.parentNode.querySelector('p.mic-interim');
    window.__speech.say('half a thought', false);
    return {
      value: box.value,
      state: mic.getAttribute('data-state'),
      interim: interim ? interim.textContent.trim() : null,
      interimShown: interim ? !interim.hidden : false
    };
  });
  t('a final result is appended to what was typed',
     dictated.value === 'Typed first. and then dictated', dictated.value);
  t('the button reads as recording while it runs', dictated.state === 'on');
  t('an interim result is shown but not committed',
     dictated.interim === 'half a thought' && dictated.interimShown, dictated);

  const stopped = await page.evaluate(() => {
    const box = document.getElementById('c-overall');
    const mic = box.parentNode.querySelector('button.mic');
    mic.click();
    return { state: mic.getAttribute('data-state'), value: box.value };
  });
  t('pressing it again stops, and keeps the text', stopped.state === 'off' && /dictated/.test(stopped.value), stopped);

  // ---- the identifier check gates the send ----------------------------
  await page.fill('#c-overall', 'Good session. The slide still had MRN 4417723 on it.');
  await page.evaluate(() => revalidate());
  const blocked = await page.evaluate(() => ({
    disabled: document.getElementById('send').disabled,
    note: document.getElementById('sendnote').textContent,
    findings: document.querySelectorAll('#findings .finding').length
  }));
  t('an identifier in a comment blocks the send', blocked.disabled && blocked.findings >= 1, blocked);

  await page.fill('#c-overall', 'Good session — the intern committed early and said why.');
  await page.evaluate(() => revalidate());
  t('taking it out releases the send',
     !(await page.evaluate(() => document.getElementById('send').disabled)));

  // ---- a filled form is written where the summary will look ------------
  await page.evaluate(() => {
    document.querySelector('input[name="r-overall"][value="4"]').click();
    document.querySelector('input[name="r-technical"][value="2"]').click();
    document.getElementById('t-technical-audio').click();
    document.getElementById('c-technical').value = 'The far end could not hear the first pass.';
    document.querySelector('input[name="r-role-pgy1"][value="5"]').click();
    document.getElementById('c-role-pgy1').value = 'Committed to one diagnosis and said why.';
    revalidate();
  });
  await page.click('#send');
  await page.waitForTimeout(300);

  const written = await page.evaluate(async () => {
    const names = await MRStore.list('working/feedback');
    const one = names.length ? await MRStore.read('working/feedback/' + names[0]) : null;
    return { names, one, done: !document.getElementById('done').hidden };
  });
  t('the submission is named for its session, flat, so the summary can list it',
     written.names.length === 1 && /^2026-09-03-galveston--fb-/.test(written.names[0]), written.names);
  t('the form thanks you and stops asking', written.done);
  t('the session half and the role half are both in the file',
     written.one && written.one.overall.rating === 4 && written.one.technical.rating === 2 &&
     written.one.technical.checks.audio === true && written.one.roles.pgy1.rating === 5,
     written.one && Object.keys(written.one));
  t('nothing in the submission says who wrote it',
     written.one && !/resident|name|author/.test(Object.keys(written.one).join(',')),
     written.one && Object.keys(written.one));

  // ---- the draft survives a reload -------------------------------------
  await page.goto(BASE + '/morning-report/feedback/', { waitUntil: 'networkidle' });
  await fill('2026-09-03', 'Galveston');
  await page.evaluate(() => {
    document.querySelector('input[name="r-overall"][value="3"]').click();
    const box = document.getElementById('c-overall');
    box.value = 'Half a thought, interrupted by a page.';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const restored = await page.evaluate(() => ({
    comment: document.getElementById('c-overall').value,
    rating: (document.querySelector('input[name="r-overall"]:checked') || {}).value
  }));
  t('a half-finished form comes back after a reload',
     restored.comment === 'Half a thought, interrupted by a page.' && restored.rating === '3', restored);

  // ---- three more submissions, so the rollup has something to say ------
  const others = [
    { overall: 5, technical: 4, audio: true, flow: 4, pgy1: 4, comment: 'Tight. The handoffs were called out loud.' },
    { overall: 4, technical: 5, audio: true, flow: 2, pgy1: 0, comment: 'Ran four minutes over.' },
    { overall: 2, technical: 1, audio: false, flow: 3, pgy1: 3, comment: 'The far end gave up on the audio.' }
  ];
  for (const o of others) {
    await page.goto(BASE + '/morning-report/feedback/', { waitUntil: 'networkidle' });
    await page.evaluate(() => { try { sessionStorage.removeItem('mr.feedback.draft'); } catch(e){} });
    await page.reload({ waitUntil: 'networkidle' });
    await fill('2026-09-03', 'Galveston');
    await page.evaluate((o) => {
      document.querySelector('input[name="r-overall"][value="' + o.overall + '"]').click();
      document.querySelector('input[name="r-technical"][value="' + o.technical + '"]').click();
      document.querySelector('input[name="r-flow"][value="' + o.flow + '"]').click();
      if (o.audio) document.getElementById('t-technical-audio').click();
      if (o.pgy1) document.querySelector('input[name="r-role-pgy1"][value="' + o.pgy1 + '"]').click();
      document.getElementById('c-overall').value = o.comment;
      revalidate();
    }, o);
    await page.click('#send');
    await page.waitForTimeout(250);
  }

  // ---- the summary reads them back -------------------------------------
  await page.goto(BASE + '/morning-report/feedback/summary/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
  await page.waitForTimeout(500);

  const rolled = await page.evaluate(() => ({
    n: roll ? roll.n : 0,
    session: current,
    overallMean: roll.sections.overall.mean,
    technicalMean: roll.sections.technical.mean,
    audio: roll.sections.technical.checks.audio,
    flowN: roll.sections.flow.n,
    pgy1: roll.roles.pgy1,
    shown: document.querySelectorAll('.unit .mean').length
  }));
  t('every submission for the session is picked up',
     rolled.n === 4 && rolled.session === '2026-09-03-galveston', rolled);
  t('the mean is the mean', rolled.overallMean === 3.8 && rolled.technicalMean === 3, rolled);
  t('a tick is counted against the people who answered that section, not everybody',
     rolled.audio.ticked === 3 && rolled.audio.of === 4, rolled.audio);
  t('a section nobody rated is not counted as rated', rolled.flowN === 3, rolled.flowN);
  t('a role left blank does not drag its mean', rolled.pgy1.n === 3 && rolled.pgy1.mean === 4, rolled.pgy1);
  t('nine units are rendered, three sections and six roles', rolled.shown === 9, rolled.shown);

  // ---- no key, no call --------------------------------------------------
  const noKey = await page.evaluate(async () => {
    document.querySelectorAll('.unit .bar button.ghost')[0].click();
    await new Promise(r => setTimeout(r, 200));
    return { calls: window.__calls.length, alert: document.body.innerText };
  });
  t('with no key nothing is sent, and it says so',
     noKey.calls === 0 && /No API key/i.test(noKey.alert), noKey.calls);

  // ---- the payload can be read before it is sent ------------------------
  const peek = await page.evaluate(() => {
    document.querySelectorAll('.unit .link-btn')[0].click();
    const pre = document.querySelector('.unit .peek');
    return { hidden: pre.hidden, text: pre.textContent };
  });
  t('the payload is printable, and holds the instructions and the comments',
     !peek.hidden && /api\.anthropic\.com/.test(peek.text) && /coaching voice/i.test(peek.text) &&
     /Ran four minutes over/.test(peek.text), peek.text && peek.text.slice(0, 60));

  // ---- with a key, one call per unit ------------------------------------
  await page.fill('#key', 'sk-ant-test-key');
  await page.evaluate(() => {
    document.getElementById('key').dispatchEvent(new Event('input', { bubbles: true }));
    window.__calls = [];
    document.querySelectorAll('.unit .bar button.ghost')[0].click();
  });
  await page.waitForTimeout(400);

  const first = await page.evaluate(() => ({
    calls: window.__calls.length,
    header: window.__calls.length ? window.__calls[0].headers['anthropic-dangerous-direct-browser-access'] : null,
    key: window.__calls.length ? window.__calls[0].headers['x-api-key'] : null,
    model: window.__calls.length ? window.__calls[0].body.model : null,
    draft: (document.querySelector('.draft p') || {}).textContent || '',
    low: !!document.querySelector('.draft.low')
  }));
  t('one unit is one call', first.calls === 1, first.calls);
  t('the call carries the browser header and the pasted key',
     first.header === 'true' && first.key === 'sk-ant-test-key', first);
  t('the drafted summary is rendered', /coaching voice/.test(first.draft), first.draft);
  t('a confident draft is not flagged', !first.low);

  await page.evaluate(() => { document.getElementById('runall').click(); });
  await page.waitForTimeout(2500);
  const all = await page.evaluate(() => ({
    calls: window.__calls.length,
    drafts: document.querySelectorAll('.draft').length,
    low: document.querySelectorAll('.draft.low').length,
    units: [...new Set(window.__calls.map(c => c.body.messages[0].content.split('\n')[0]))].length
  }));
  t('summarise-all covers the remaining eight, one call each', all.calls === 9 && all.units === 9, all);
  t('all nine are drafted', all.drafts === 9, all.drafts);
  t('a draft under the confidence floor is flagged as low', all.low === 8, all.low);

  const sent = await page.evaluate(() => window.__calls.map(c => c.body.messages[0].content));
  t('each call is scoped to one unit and carries no other unit with it',
     sent.every(c => c.split('\n')[0].indexOf('Unit: ') === 0) &&
     sent.filter(c => /Unit: Case Presenter/.test(c)).length === 1, sent.length);

  // ---- what is kept, and what is not ------------------------------------
  await page.click('#save');
  await page.waitForTimeout(400);
  const kept = await page.evaluate(async () => ({
    record: await MRStore.read('sessions/feedback/2026-09-03-galveston.json'),
    sessionsDir: await MRStore.list('sessions'),
    scorecards: (await MRStore.readAll('sessions')).length
  }));
  t('the session record is kept under sessions/feedback/',
     kept.record && kept.record.id === '2026-09-03-galveston' && kept.record.responses === 4,
     kept.record && Object.keys(kept.record));
  t('it holds the numbers and the drafted summaries',
     kept.record.sections.overall.mean === 3.8 &&
     kept.record.sections.overall.checks.learned.of === 4 &&
     kept.record.sections.overall.summary && kept.record.sections.overall.summary.text.length > 0,
     kept.record.sections.overall);
  t('no comment survives into the permanent record verbatim',
     !/Ran four minutes over|far end/.test(JSON.stringify(kept.record)));
  t('nothing role-level survives into the permanent record',
     !('roles' in kept.record) && !/pgy1|presenter/i.test(JSON.stringify(kept.record)));
  t('the group report still sees only scorecards in sessions/',
     kept.sessionsDir.length === 0 && kept.scorecards === 0, kept.sessionsDir);

  // ---- a second session does not bleed into the first --------------------
  await page.goto(BASE + '/morning-report/feedback/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { sessionStorage.removeItem('mr.feedback.draft'); } catch(e){} });
  await page.reload({ waitUntil: 'networkidle' });
  await fill('2026-09-10', 'Houston');
  await page.evaluate(() => {
    document.querySelector('input[name="r-overall"][value="1"]').click();
    revalidate();
  });
  await page.click('#send');
  await page.waitForTimeout(250);

  await page.goto(BASE + '/morning-report/feedback/summary/?session=2026-09-03-galveston', { waitUntil: 'networkidle' });
  await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
  await page.waitForTimeout(500);
  const picked = await page.evaluate(() => ({
    current: current,
    n: roll.n,
    options: [].map.call(document.querySelectorAll('#session option'), o => o.value)
  }));
  t('the asked-for session is the one shown, and the other is still on the list',
     picked.current === '2026-09-03-galveston' && picked.n === 4 &&
     picked.options.indexOf('2026-09-10-houston') !== -1, picked);

  // ---- the board hands the session over --------------------------------
  await page.evaluate(async () => {
    await MRStore.whenReady;
    await MRStore.connect();
    await MRStore.write('board-archive/2026-09-17-houston.json', {
      id: '2026-09-17-houston', date: '2026-09-17', site: 'Houston',
      derived: { board_archived: true }
    });
  });
  await page.goto(BASE + '/morning-report/feedback/?session=2026-09-17-houston', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const handed = await page.evaluate(() => ({
    date: document.getElementById('date').value,
    site: document.getElementById('site').value,
    note: document.getElementById('sessionnote').textContent,
    summaryHref: document.getElementById('toSummary').getAttribute('href')
  }));
  t('the link the board hands out arrives on the right session',
     handed.date === '2026-09-17' && handed.site === 'Houston' &&
     /2026-09-17-houston/.test(handed.note) &&
     /session=2026-09-17-houston/.test(handed.summaryHref), handed);

  let failed = 0;
  for (const r of out) { if (!r.pass) failed++; console.log((r.pass?'PASS  ':'FAIL  ') + r.name + (r.extra?'   '+r.extra:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - failed) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
