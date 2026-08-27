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

/* A microphone that records silence. MediaRecorder and getUserMedia
   both stubbed, so the recorder half runs with no device and no
   permission prompt. */
const FAKE_RECORDER = `
(function(){
  window.__recorders = [];
  function Fake(stream, opts){
    this.state = 'inactive';
    this.mimeType = (opts && opts.mimeType) || 'audio/webm';
    this.stream = stream;
    this.ondataavailable = null;
    this.onstop = null;
    window.__recorders.push(this);
  }
  Fake.isTypeSupported = function(){ return true; };
  Fake.prototype.start = function(){ this.state = 'recording'; };
  Fake.prototype.stop = function(){
    this.state = 'inactive';
    if (this.ondataavailable) this.ondataavailable({ data: new Blob(['fake-audio-bytes'], { type: this.mimeType }) });
    if (this.onstop) this.onstop();
  };
  window.MediaRecorder = Fake;
  var tracks = [{ stop: function(){ window.__micReleased = (window.__micReleased||0)+1; } }];
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: function(){ return Promise.resolve({ getTracks: function(){ return tracks; } }); } }
  });
})();
`;

/* The post box, in memory. Mirrors what Code.gs does with a row and a
   Drive file, so the browser half can be driven end to end without a
   Google account. */
const FAKE_BOX = `
(function(){
  window.__box = { rows: [], files: {}, next: 1, calls: [] };
  var real = window.fetch;
  window.fetch = function(url, opts){
    var u = String(url);
    if (u.indexOf('endpoint.test') === -1) return real.apply(this, arguments);
    var box = window.__box;

    if (!opts || opts.method !== 'POST'){
      return Promise.resolve({ ok: true, status: 200,
        json: function(){ return Promise.resolve({ status: 'ok', data: {} }); } });
    }
    var body = JSON.parse(opts.body);
    box.calls.push(body.action || 'seed');
    var reply;
    if (body.action === 'feedback'){
      if (body.key !== 'submit-key' && body.key !== 'roster-key') reply = { status: 'denied' };
      else {
        var ids = (body.audio || []).map(function(clip){
          var id = 'file-' + (box.next++);
          box.files[id] = { id: id, mime: clip.mime, data: clip.data,
            name: body.record.session + '--' + body.record.id + '--' + clip.unit + '.webm' };
          return id;
        });
        box.rows.push({ session: body.record.session, submission: body.record.id,
          recordings: ids, record: body.record });
        reply = { status: 'ok', id: body.record.id, recordings: ids.length };
      }
    } else if (body.key !== 'roster-key'){
      reply = { status: 'denied' };
    } else if (body.action === 'collect'){
      reply = { status: 'ok', pending: box.rows.slice(), unreadable: [] };
    } else if (body.action === 'recording'){
      var f = box.files[body.id];
      reply = f ? { status: 'ok', id: f.id, name: f.name, mime: f.mime, data: f.data }
                : { status: 'error', message: 'gone' };
    } else if (body.action === 'collected'){
      var want = body.submissions || [];
      var kept = box.rows.filter(function(r){ return want.indexOf(r.submission) === -1; });
      box.rows.filter(function(r){ return want.indexOf(r.submission) !== -1; })
        .forEach(function(r){ r.recordings.forEach(function(id){ delete box.files[id]; }); });
      var dropped = box.rows.length - kept.length;
      box.rows = kept;
      reply = { status: 'ok', dropped: dropped };
    } else {
      reply = { status: 'ok', wrote: {} };
    }
    return Promise.resolve({ ok: true, status: 200, json: function(){ return Promise.resolve(reply); } });
  };
})();
`;

/* Stubbed model replies: the first confident, the rest under the
   confidence floor, so both sides of the flag are exercised. */
const FAKE_API = `
(function(){
  window.__calls = [];
  var real = window.fetch;
  window.fetch = function(url, opts){
    var u = String(url);
    var anthropic = u.indexOf('api.anthropic.com') !== -1;
    var xai = u.indexOf('api.x.ai') !== -1;
    if (!anthropic && !xai) return real.apply(this, arguments);
    window.__calls.push({ url: u, headers: opts.headers, body: JSON.parse(opts.body) });
    var n = window.__calls.length;
    var draft = {
      summary: 'Reply ' + n + ', in the coaching voice.',
      one_thing: 'Change one thing, number ' + n + '.',
      agreement: n === 1 ? 'agreed' : 'thin',
      confidence: n === 1 ? 0.86 : 0.41
    };
    var text = JSON.stringify(draft);
    /* A code fence, built without escapes: this whole script lives in
       a template literal, where a backslash-n would become a real
       newline and break the string it was meant to be inside. */
    var fence = function(tag){
      return String.fromCharCode(96, 96, 96) + tag + String.fromCharCode(10);
    };
    /* Each provider is answered in its own shape, so the reader is
       exercised and not just the writer. */
    var payload = anthropic
      ? { content: [{ type: 'text', text: text }] }
      : { choices: [{ message: { role: 'assistant', content: fence('json') + text + fence('') } }] };
    return Promise.resolve({
      ok: true, status: 200,
      json: function(){ return Promise.resolve(payload); }
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
  await page.addInitScript(FAKE_RECORDER);
  await page.addInitScript(FAKE_API);
  await page.addInitScript(FAKE_BOX);
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

  // ---- the other provider, same everything else -------------------------
  const swapped = await page.evaluate(async () => {
    window.__calls = [];
    document.getElementById('key').value = 'xai-test-key';
    document.getElementById('key').dispatchEvent(new Event('input', { bubbles: true }));
    return {
      provider: document.getElementById('provider').value,
      model: document.getElementById('model').value,
      where: document.getElementById('wherenote').textContent
    };
  });
  t('pasting a key switches the provider without anyone finding a menu',
     swapped.provider === 'xai', swapped);
  t('and the model box follows it to that provider\'s default',
     swapped.model === 'grok-4.6', swapped.model);
  t('the page says where summaries are going', /api\.x\.ai/.test(swapped.where), swapped.where);

  /* Every unit is holding a draft from the run above, and the payload
     preview only exists where one is not. Clear the first. */
  await page.evaluate(() => {
    const btns = document.querySelectorAll('.unit .draft .link-btn');
    for (const b of btns) { if (/again/i.test(b.textContent)) { b.click(); return; } }
  });
  await page.waitForTimeout(200);

  const xaiPeek = await page.evaluate(() => {
    const btns = document.querySelectorAll('.unit .link-btn');
    let peekBtn = null;
    btns.forEach(b => { if (!peekBtn && /would be sent/i.test(b.textContent)) peekBtn = b; });
    if (!peekBtn) return '';
    peekBtn.click();
    const pre = document.querySelector('.unit .peek:not([hidden])');
    return pre ? pre.textContent : '';
  });
  t('the printable payload names the endpoint it would actually use',
     /api\.x\.ai/.test(xaiPeek) && !/anthropic/.test(xaiPeek.split('\n')[0]), xaiPeek.slice(0, 60));

  await page.evaluate(() => {
    const btns = document.querySelectorAll('.unit .bar button.ghost');
    btns[0].click();
  });
  await page.waitForTimeout(500);

  const xaiCall = await page.evaluate(() => ({
    calls: window.__calls.length,
    url: window.__calls.length ? window.__calls[0].url : '',
    auth: window.__calls.length ? window.__calls[0].headers['authorization'] : '',
    hasAnthropicHeader: window.__calls.length ? ('x-api-key' in window.__calls[0].headers) : null,
    roles: window.__calls.length ? window.__calls[0].body.messages.map(m => m.role) : [],
    systemInBody: window.__calls.length ? ('system' in window.__calls[0].body) : null,
    draft: (document.querySelector('.draft p') || {}).textContent || '',
    meta: (document.querySelector('.draft .meta') || {}).textContent || ''
  }));
  t('the call goes to xAI, with a bearer token and no Anthropic header',
     xaiCall.calls === 1 && /api\.x\.ai/.test(xaiCall.url) &&
     xaiCall.auth === 'Bearer xai-test-key' && xaiCall.hasAnthropicHeader === false, xaiCall);
  t('the prompt moves into a system message rather than a top-level field',
     xaiCall.roles.join(',') === 'system,user' && xaiCall.systemInBody === false, xaiCall.roles);
  t('a reply wrapped in a code fence is still read',
     /coaching voice/.test(xaiCall.draft), xaiCall.draft);
  t('and the draft says who answered', /xai/.test(xaiCall.meta), xaiCall.meta);

  /* Back to where the rest of the suite expects to be. */
  await page.evaluate(() => {
    document.getElementById('key').value = 'sk-ant-test-key';
    document.getElementById('key').dispatchEvent(new Event('input', { bubbles: true }));
  });
  const backAgain = await page.evaluate(() => ({
    provider: document.getElementById('provider').value,
    model: document.getElementById('model').value
  }));
  t('and swapping back restores that provider\'s own model',
     backAgain.provider === 'anthropic' && backAgain.model === 'claude-sonnet-5', backAgain);

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

  // ---- the recorder, and what happens to a clip -------------------------
  await page.goto(BASE + '/morning-report/feedback/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { sessionStorage.removeItem('mr.feedback.draft'); } catch(e){} });
  await page.reload({ waitUntil: 'networkidle' });
  await fill('2026-10-01', 'Galveston');

  const recorded = await page.evaluate(async () => {
    const box = document.getElementById('c-overall');
    const mic = box.parentNode.querySelector('button.mic');
    mic.click();
    await new Promise(r => setTimeout(r, 60));      // getUserMedia resolves
    const running = window.__recorders.length;
    mic.click();                                     // stop
    await new Promise(r => setTimeout(r, 60));
    const chip = box.parentNode.querySelector('.clip');
    return {
      running,
      chipShown: chip && !chip.hidden,
      chipText: chip ? chip.textContent : '',
      panelShown: !document.getElementById('audiopanel').hidden,
      keepDefault: document.getElementById('keepaudio').checked,
      micReleased: window.__micReleased || 0
    };
  });
  t('pressing the microphone starts a recorder', recorded.running === 1, recorded.running);
  t('stopping it leaves a clip on the box', recorded.chipShown && /held/i.test(recorded.chipText), recorded.chipText);
  t('and the microphone is released again', recorded.micReleased >= 1, recorded.micReleased);
  t('the keep-it question only appears once there is something to keep', recorded.panelShown);
  t('and keeping is off unless asked for', recorded.keepDefault === false);

  const discarded = await page.evaluate(() => {
    document.querySelector('.clip .link-btn').click();
    const chip = document.querySelector('.clip');
    return { hidden: chip.hidden, panel: document.getElementById('audiopanel').hidden };
  });
  t('discarding a clip takes it and the question away', discarded.hidden && discarded.panel, discarded);

  // ---- unticked: the recording does not survive the send ----------------
  const beforeAudio = await page.evaluate(async () => {
    const box = document.getElementById('c-overall');
    box.value = 'Worth keeping the words.';
    const mic = box.parentNode.querySelector('button.mic');
    mic.click();
    await new Promise(r => setTimeout(r, 60));
    mic.click();
    await new Promise(r => setTimeout(r, 60));
    document.querySelector('input[name="r-overall"][value="4"]').click();
    revalidate();
    return !document.getElementById('audiopanel').hidden;
  });
  t('a clip is waiting again before the send', beforeAudio);

  await page.click('#send');
  await page.waitForTimeout(400);
  const noAudio = await page.evaluate(async () => ({
    audio: await MRStore.list('working/feedback/audio'),
    note: document.getElementById('donenote').textContent
  }));
  t('an unticked send keeps the words and no recording',
     noAudio.audio.length === 0 && /discarded/i.test(noAudio.note), noAudio);

  // ---- ticked: the recording lands in the folder beside it --------------
  await page.goto(BASE + '/morning-report/feedback/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { sessionStorage.removeItem('mr.feedback.draft'); } catch(e){} });
  await page.reload({ waitUntil: 'networkidle' });
  await fill('2026-10-08', 'Galveston');
  await page.evaluate(async () => {
    const box = document.getElementById('c-overall');
    box.value = 'Say it out loud.';
    const mic = box.parentNode.querySelector('button.mic');
    mic.click();
    await new Promise(r => setTimeout(r, 60));
    mic.click();
    await new Promise(r => setTimeout(r, 60));
    document.querySelector('input[name="r-overall"][value="5"]').click();
    document.getElementById('keepaudio').checked = true;
    revalidate();
  });
  await page.click('#send');
  await page.waitForTimeout(500);

  const withClip = await page.evaluate(async () => ({
    audio: await MRStore.list('working/feedback/audio'),
    subs: await MRStore.list('working/feedback'),
    note: document.getElementById('donenote').textContent
  }));
  t('a ticked send writes the recording next to the submission',
     withClip.audio.length === 1 && /^2026-10-08-galveston--fb-.*\.webm$/.test(withClip.audio[0]), withClip.audio);
  t('the recording is named for its session, submission and box',
     /--overall\.webm$/.test(withClip.audio[0] || ''), withClip.audio[0]);
  t('and the send says how many went with it', /1 recording/.test(withClip.note), withClip.note);

  // ---- a device with no folder: the post box takes it -------------------
  /* Its own context, so it has no folder, no connected handle and no
     shared storage — which is exactly what a phone is. */
  const phoneCtx = await browser.newContext();
  await phoneCtx.addInitScript(FAKE_SPEECH);
  await phoneCtx.addInitScript(FAKE_RECORDER);
  await phoneCtx.addInitScript(FAKE_BOX);
  const phone = await phoneCtx.newPage();
  phone.on('pageerror', e => errs.push('pageerror(phone): ' + e.message));
  phone.on('console', m => { const u=(m.location()&&m.location().url)||''; if (m.type()==='error' && !/googletagmanager|favicon|ERR_CONNECTION_RESET/.test(m.text()+' '+u)) errs.push('console(phone): ' + m.text()); });
  const LINK = '/morning-report/feedback/?relay=' + encodeURIComponent('https://endpoint.test/exec') + '&k=submit-key';
  await phone.goto(BASE + LINK, { waitUntil: 'networkidle' });
  await phone.waitForTimeout(300);

  const phoneState = await phone.evaluate(() => ({
    ready: MRStore.status().ready,
    canSubmit: MRRelay.canSubmit(),
    canDrain: MRRelay.canDrain(),
    note: document.getElementById('sessionnote').textContent
  }));
  t('a link carrying the endpoint configures a device that has no folder',
     phoneState.canSubmit && !phoneState.ready, phoneState);
  t('and a device holding only the submit key cannot drain the post box', !phoneState.canDrain);
  t('the form says where it is going', /collection point/i.test(phoneState.note), phoneState.note);

  await phone.fill('#date', '2026-10-15');
  await phone.fill('#site', 'Houston');
  await phone.evaluate(async () => {
    document.querySelector('input[name="r-overall"][value="3"]').click();
    document.getElementById('c-overall').value = 'Filled in on the way out of the room.';
    const mic = document.getElementById('c-overall').parentNode.querySelector('button.mic');
    mic.click();
    await new Promise(r => setTimeout(r, 60));
    mic.click();
    await new Promise(r => setTimeout(r, 60));
    document.getElementById('keepaudio').checked = true;
    revalidate();
  });
  await phone.click('#send');
  await phone.waitForTimeout(500);

  const posted = await phone.evaluate(() => ({
    rows: window.__box.rows.length,
    session: window.__box.rows[0] && window.__box.rows[0].session,
    clips: window.__box.rows[0] ? window.__box.rows[0].recordings.length : 0,
    audioHeld: Object.keys(window.__box.files).length,
    done: !document.getElementById('done').hidden,
    note: document.getElementById('donenote').textContent
  }));
  t('the submission reaches the post box rather than a download',
     posted.rows === 1 && posted.session === '2026-10-15-houston', posted);
  t('the recording travels with it', posted.clips === 1 && posted.audioHeld === 1, posted);
  t('and the person is told it is waiting to be collected',
     posted.done && /collect/i.test(posted.note), posted.note);

  /* What the endpoint is now holding, carried over verbatim to the
     facilitator's page — the fake post box cannot span two browser
     contexts, but the rows it hands over are the real shape. */
  const heldAtEndpoint = await phone.evaluate(() => ({
    rows: window.__box.rows, files: window.__box.files, next: window.__box.next
  }));
  await phoneCtx.close();

  // ---- the facilitator drains it into the folder ------------------------
  await page.goto(BASE + '/morning-report/feedback/summary/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await MRStore.whenReady;
    await MRStore.connect();
    MRRemote.setSettings({ endpoint: 'https://endpoint.test/exec', key: 'roster-key', remember: false });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
  await page.waitForTimeout(400);

  await page.evaluate((held) => {
    window.__box.rows = held.rows;
    window.__box.files = held.files;
    window.__box.next = held.next;
    window.__box.calls = [];
  }, heldAtEndpoint);

  const panel = await page.evaluate(() => !document.getElementById('collectpanel').hidden);
  t('the collect panel appears on a machine that has both the folder and the key', panel);

  await page.click('#collect');
  await page.waitForTimeout(900);

  const drained = await page.evaluate(async () => ({
    subs: await MRStore.list('working/feedback'),
    audio: await MRStore.list('working/feedback/audio'),
    left: window.__box.rows.length,
    files: Object.keys(window.__box.files).length,
    note: document.getElementById('collectnote').textContent,
    calls: window.__box.calls.slice()
  }));
  t('collecting writes the submission into the folder',
     drained.subs.some(n => /^2026-10-15-houston--fb-.*\.json$/.test(n)), drained.subs);
  t('and the recording with it',
     drained.audio.some(n => /^2026-10-15-houston--fb-.*--overall\.webm$/.test(n)), drained.audio);
  t('the post box is emptied once the folder has it',
     drained.left === 0 && drained.files === 0, drained);
  t('and it says what happened', /in the folder/.test(drained.note) && /emptied/.test(drained.note), drained.note);
  t('the drain asks in the right order',
     drained.calls.join(',') === 'collect,recording,collected', drained.calls);

  // ---- opening the page IS the click ------------------------------------
  /* A row waiting in the box before the page opens: no button press,
     just arrival, and the folder has it. */
  await page.addInitScript(() => {
    const arm = () => {
      if (!window.__box) { setTimeout(arm, 5); return; }
      window.__box.rows.push({
        session: '2026-10-22-galveston', submission: 'fb-autodrain',
        recordings: [],
        record: { id: 'fb-autodrain', session: '2026-10-22-galveston', date: '2026-10-22', site: 'Galveston',
          overall: { rating: 2, checks: {}, comment: 'Arrived while nobody was looking.' }, roles: {} }
      });
    };
    arm();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });
  await page.waitForTimeout(900);
  const auto = await page.evaluate(async () => ({
    subs: await MRStore.list('working/feedback'),
    left: window.__box.rows.length,
    note: document.getElementById('collectnote').textContent
  }));
  t('opening the summary page collects by itself',
     auto.subs.some(n => /fb-autodrain\.json$/.test(n)) && auto.left === 0, auto);

  // ---- the short link, and that it carries the query across -------------
  const shortCtx = await browser.newContext();
  await shortCtx.addInitScript(FAKE_SPEECH);
  await shortCtx.addInitScript(FAKE_RECORDER);
  await shortCtx.addInitScript(FAKE_BOX);
  const short = await shortCtx.newPage();
  short.on('pageerror', e => errs.push('pageerror(short): ' + e.message));

  await short.goto(BASE + '/feedback/', { waitUntil: 'networkidle' });
  t('the short link lands on the form',
     /\/morning-report\/feedback\/$/.test(short.url()), short.url());

  const CONFIG = '?relay=' + encodeURIComponent('https://endpoint.test/exec') +
    '&k=submit-key&session=2026-11-05-galveston';
  await short.goto(BASE + '/feedback/' + CONFIG, { waitUntil: 'networkidle' });
  await short.waitForTimeout(300);
  const carried = await short.evaluate(() => ({
    url: location.href,
    canSubmit: MRRelay.canSubmit(),
    date: document.getElementById('date').value,
    site: document.getElementById('site').value
  }));
  t('a configured short link still configures the device it lands on',
     carried.canSubmit && /morning-report\/feedback\//.test(carried.url) &&
     /k=submit-key/.test(carried.url), carried);
  await shortCtx.close();

  // ---- the link the facilitator hands out is absolute --------------------
  await page.goto(BASE + '/morning-report/settings/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await MRStore.whenReady;
    MRRemote.setSettings({ endpoint: 'https://endpoint.test/exec', key: 'roster-key', remember: false });
    MRRelay.setShareKey('submit-key', false);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const shareLink = await page.evaluate(() => MRRelay.linkFor(MRStore.siteRoot() + 'feedback/'));
  t('the shared link is an absolute URL, not a relative one glued to an origin',
     /^http:\/\/localhost:8899\/feedback\/\?relay=/.test(shareLink), shareLink);
  t('it carries the submit key and never the roster key',
     /k=submit-key/.test(shareLink) && shareLink.indexOf('roster-key') === -1, shareLink);

  const qrPanel = await page.evaluate(() => {
    const wrap = document.getElementById('qrwrap');
    const svg = document.querySelector('#qr svg');
    return {
      shown: !wrap.hidden,
      hasSvg: !!svg,
      modules: svg ? (svg.innerHTML.match(/h1v1h-1z/g) || []).length : 0,
      note: document.getElementById('qrnote').textContent,
      /* Compare the drawn modules, not the serialised markup: the
         browser rewrites attribute order and namespaces when it
         parses, and none of that is what is being checked. */
      matchesLink: svg
        ? svg.querySelector('path').getAttribute('d') ===
          (MRQr.svg(MRRelay.linkFor(MRStore.siteRoot() + 'feedback/'), { scale: 6, quiet: 4 })
            .match(/ d="([^"]+)"/) || [])[1]
        : false
    };
  });
  t('the settings page draws the code once there is a key for it',
     qrPanel.shown && qrPanel.hasSvg && qrPanel.modules > 100, qrPanel.modules);
  t('and it encodes the link it says it does', qrPanel.matchesLink);
  t('the note masks the key rather than printing it',
     /k=…/.test(qrPanel.note) && qrPanel.note.indexOf('submit-key') === -1, qrPanel.note);

  const gone = await page.evaluate(() => {
    MRRelay.setShareKey('', false);
    document.getElementById('fbkey').value = '';
    document.getElementById('savefb').click();
    return document.getElementById('qrwrap').hidden;
  });
  t('and it goes away again when there is no key', gone);

  // ---- the board puts the session's own code on the screen ---------------
  await page.goto(BASE + '/morning-report/board/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await MRStore.whenReady;
    MRRemote.setSettings({ endpoint: 'https://endpoint.test/exec', key: 'roster-key', remember: false });
    MRRelay.setShareKey('submit-key', false);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const veil = await page.evaluate(() => {
    showFinish({ id: '2026-11-12-houston', date: '2026-11-12', site: 'Houston' },
      'board-archive/2026-11-12-houston.json', {});
    const svg = document.querySelector('#feedbackQrCode svg');
    return {
      qrShown: !document.getElementById('feedbackQr').hidden,
      hasSvg: !!svg,
      href: document.getElementById('toFeedback').getAttribute('href'),
      copyShown: !document.getElementById('copyFeedback').hidden,
      note: document.getElementById('feedbackNote').textContent
    };
  });
  t('finishing the board offers the session code on screen', veil.qrShown && veil.hasSvg, veil);
  t('the in-page link stays relative, as a link on a page should',
     veil.href === '../feedback/?session=2026-11-12-houston', veil.href);
  t('and the copyable one is offered alongside it',
     veil.copyShown && /phone/.test(veil.note), veil.note);

  // ---- the front door, and the one page deliberately outside it ---------
  const strangerCtx = await browser.newContext();     /* no fakefs, so no code */
  const stranger = await strangerCtx.newPage();
  await stranger.goto(BASE + '/morning-report/feedback/summary/', { waitUntil: 'domcontentloaded' });
  const gatedSummary = await stranger.isVisible('.mr-gate');
  await stranger.goto(BASE + '/morning-report/feedback/', { waitUntil: 'domcontentloaded' });
  await stranger.waitForTimeout(200);
  const gatedForm = await stranger.isVisible('.mr-gate');
  const formUsable = await stranger.evaluate(() =>
    !!document.querySelector('input[name="r-overall"]'));
  await strangerCtx.close();

  t('the read-out sits behind the front-door code like every other tool', gatedSummary);
  t('the form does not, because it is scanned off a slide by people leaving the room',
     !gatedForm && formUsable, { gatedForm, formUsable });

  let failed = 0;
  for (const r of out) { if (!r.pass) failed++; console.log((r.pass?'PASS  ':'FAIL  ') + r.name + (r.extra?'   '+r.extra:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - failed) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
