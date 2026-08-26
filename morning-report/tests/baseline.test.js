const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8899';
const fake = fs.readFileSync(__dirname + '/fakefs.js', 'utf8');

/* The post box, in memory, and shared by two instruments on purpose:
   the baseline responses this suite sends and a session-feedback
   submission planted alongside them. The interesting assertion in the
   collection half is not that the baseline arrives — it is that the
   feedback row is still sitting there afterwards. */
const FAKE_BOX = `
(function(){
  window.__box = { rows: [], calls: [] };
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
        box.rows.push({ session: body.record.session, submission: body.record.id,
          recordings: [], record: body.record });
        reply = { status: 'ok', id: body.record.id, recordings: 0 };
      }
    } else if (body.key !== 'roster-key'){
      reply = { status: 'denied' };
    } else if (body.action === 'collect'){
      reply = { status: 'ok', pending: box.rows.slice(), unreadable: [] };
    } else if (body.action === 'collected'){
      var want = body.submissions || [];
      var kept = box.rows.filter(function(r){ return want.indexOf(r.submission) === -1; });
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

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { const u=(m.location()&&m.location().url)||''; if (m.type()==='error' && !/googletagmanager|favicon|ERR_CONNECTION_RESET/.test(m.text()+' '+u)) errs.push('console: ' + m.text()); });
  await page.addInitScript(fake);
  await page.addInitScript(FAKE_BOX);
  await page.goto(BASE + '/morning-report/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

  const out = [];
  const t = (name, cond, extra) => out.push({ name, pass: !!cond, extra: extra === undefined ? '' : JSON.stringify(extra) });

  const content = JSON.parse(fs.readFileSync(__dirname + '/../content/baseline.json', 'utf8'));

  const connect = () => page.evaluate(async () => { await MRStore.whenReady; await MRStore.connect(); });

  const openForm = async (query) => {
    await page.goto(BASE + '/morning-report/baseline/' + (query || ''), { waitUntil: 'networkidle' });
    await page.waitForSelector('#cohorts .who');
  };

  // ---- the form is the content file, rendered ---------------------------
  await openForm();
  await connect();

  const shape = await page.evaluate(() => ({
    cohorts: [].map.call(document.querySelectorAll('#cohorts .who .lb'), e => e.textContent),
    domains: [].map.call(document.querySelectorAll('#domains .panel > h2'), e => e.textContent),
    items: document.querySelectorAll('#domains .qrow').length,
    reversed: document.querySelectorAll('#domains .qrow .rev').length,
    firstScale: document.querySelector('#domains .scale').querySelectorAll('.opt').length,
    skipsOffScale: document.querySelectorAll('#domains .qrow .skiprow .opt').length,
    ten: document.querySelectorAll('#ten .opt').length,
    open: document.querySelectorAll('#open textarea').length,
    asksWho: /your name|who are you|e-?mail|employee|badge/i.test(document.body.innerText)
  }));

  t('the four year-group buttons are the ones the content names',
     shape.cohorts.join('|') === 'PGY-1|PGY-2|PGY-3|Faculty', shape.cohorts);
  t('all five domains render, in the content order',
     shape.domains.join('|') === content.domains.map(d => d.title).join('|'), shape.domains);
  t('every item in the file reaches the page',
     shape.items === content.domains.reduce((n, d) => n + d.items.length, 0), shape.items);
  t('and every reversed item is marked as reversed where it is answered',
     shape.reversed === content.domains.reduce((n, d) => n + d.items.filter(i => i.reverse).length, 0),
     shape.reversed);
  t('the scale is five points, symmetric about a named middle',
     shape.firstScale === 5, shape.firstScale);
  t('the way out is not a sixth point on the line',
     shape.skipsOffScale === shape.items, { skips: shape.skipsOffScale, items: shape.items });
  t('the overall runs 0 to 10 inclusive', shape.ten === 11, shape.ten);
  t('both open questions are asked, not just the one about changing things',
     shape.open === 2, shape.open);
  t('nothing on the form asks who is filling it in', !shape.asksWho);

  // ---- the anchors are balanced, and the file is where they live --------
  const anchors = content.scales.agree.points.map(p => p.label);
  t('the anchors are a symmetric pair either side of a stated middle',
     anchors[0] === 'Strongly disagree' && anchors[4] === 'Strongly agree' && anchors[2] === 'Neither',
     anchors);
  t('every domain carries items worded both ways round',
     content.domains.every(d => d.items.some(i => i.reverse) || d.id === 'overall'),
     content.domains.map(d => d.id + ':' + d.items.filter(i => i.reverse).length));

  /* All three kinds of measure, or the instrument is advertising the
     change rather than measuring it. Balancing is the one that goes
     missing first, and the one whose absence nobody notices until the
     write-up: forcing people to speak has a price, and if nothing here
     can fall, nothing here can report that it was paid. */
  const kinds = content.domains.map(d => d.measure_type)
    .concat(content.measures.items.map(m => m.measure_type));
  t('every domain and every counted quantity says what kind of measure it is',
     kinds.every(Boolean), content.domains.map(d => d.id + ':' + d.measure_type));
  t('and all three kinds are represented, balancing included',
     ['outcome', 'process', 'balancing'].every(k => kinds.indexOf(k) !== -1), kinds);
  t('the balancing measures are not all in one domain',
     content.measures.items.filter(m => m.measure_type === 'balancing').length >= 2 &&
     content.domains.some(d => d.measure_type === 'balancing'),
     kinds);

  /* Everybody is virtual across two sites. An item that talks about a
     room, or about the far end being at a disadvantage, describes a
     different morning report than this one — it is the wording most
     likely to drift back in from a generic template. */
  const everyWord = content.domains.flatMap(d => d.items.map(i => i.text))
    .concat(content.measures.items.map(m => m.label))
    .concat(content.context.items.map(c => c.label));
  const roomish = everyWord.filter(x => /\bin the room\b|\bfar end\b|\bthe room\b/i.test(x));
  t('no item assumes anybody is in a room — everybody is on the call',
     roomish.length === 0, roomish);
  t('the burden items are asked against three mornings a week, not in the abstract',
     content.domains.find(d => d.id === 'burden').items.some(i => /three mornings/i.test(i.text)),
     content.domains.find(d => d.id === 'burden').items.map(i => i.text));

  // ---- a group has to be chosen, and nothing else has to be -------------
  await page.click('#send');
  const empty = await page.evaluate(() => document.getElementById('sendnote').textContent);
  t('an untouched form is refused as untouched', /nothing has been filled in/i.test(empty), empty);

  await page.evaluate(() => {
    const el = document.querySelector('input[name="q-technical-audio"][value="4"]');
    el.checked = true; el.dispatchEvent(new Event('change'));
  });
  await page.click('#send');
  const nudged = await page.evaluate(() => document.getElementById('sendnote').textContent);
  t('a filled-in form with no group chosen is refused, and says which box to press',
     /pick one/i.test(nudged), nudged);

  // ---- filling it in ----------------------------------------------------
  const answer = async (cohort, plan) => {
    await page.evaluate(({ cohort, plan }) => {
      const set = (name, value) => {
        const el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
        if (el) { el.checked = true; el.dispatchEvent(new Event('change')); }
      };
      set('cohort', cohort);
      Object.keys(plan.answers || {}).forEach(k => set(k, plan.answers[k]));
      Object.keys(plan.numbers || {}).forEach(k => {
        const el = document.getElementById('m-' + k);
        el.value = plan.numbers[k];
        el.dispatchEvent(new Event('input'));
      });
      Object.keys(plan.open || {}).forEach(k => {
        const el = document.getElementById('o-' + k);
        el.value = plan.open[k];
        el.dispatchEvent(new Event('input'));
      });
    }, { cohort, plan });
  };

  /* Deliberately answered as somebody who is not just nodding: 4 on
     the plainly worded items, 2 on the reversed one, which recodes to
     4 and should leave a domain mean of 4. */
  await answer('pgy1', {
    answers: {
      'q-technical-audio': 4, 'q-technical-legible': 4, 'q-technical-joining': 4,
      'q-technical-interrupt': 2, 'q-technical-bothatonce': 4, 'q-technical-latestart': 2,
      'q-participation-spoke': 3, 'q-participation-safe': '', 'global': 7
    },
    numbers: { prep_off: 15, prep_on: 90 },
    open: { keep: 'The board being up before people walk in.', change: 'Start on time.' }
  });

  const draft = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mr.baseline.draft')));
  t('the reversed item is stored exactly as it was ticked, not pre-turned',
     draft.domains.technical.interrupt === 2, draft.domains.technical);
  t('"no basis to judge" is stored as no answer, never as a middle one',
     draft.domains.participation.safe === null, draft.domains.participation);

  const progress = await page.evaluate(() => document.getElementById('progtext').textContent);
  t('the progress count treats a deliberate skip as answered',
     /^11 of \d+ answered$/.test(progress), progress);

  // ---- the identifier check gates the send ------------------------------
  await page.fill('#o-change', 'The MRN 4417723 was still on the slide.');
  await page.evaluate(() => revalidate());
  const blocked = await page.evaluate(() => ({
    disabled: document.getElementById('send').disabled,
    findings: document.querySelectorAll('#findings .finding').length
  }));
  t('an identifier in a written answer blocks the send',
     blocked.disabled && blocked.findings >= 1, blocked);

  await page.fill('#o-change', 'Start on time.');
  await page.evaluate(() => revalidate());
  t('taking it out releases the send',
     !(await page.evaluate(() => document.getElementById('send').disabled)));

  // ---- it lands in the folder -------------------------------------------
  await page.click('#send');
  await page.waitForSelector('#done:not([hidden])');
  const written = await page.evaluate(async () => {
    const names = await MRStore.list('baseline');
    const one = await MRStore.read('baseline/' + names[0]);
    return { names, one };
  });
  t('one response, filed under the round it belongs to',
     written.names.length === 1 && /^\d{4}-\d{2}--bl-/.test(written.names[0]), written.names);
  t('it carries the group, the round and its own instrument name',
     written.one.cohort === 'pgy1' && written.one.instrument === 'baseline' &&
     /^\d{4}-\d{2}$/.test(written.one.wave), written.one);
  t('and nothing in it says who sent it',
     !('name' in written.one) && !('resident' in written.one) && !('by' in written.one),
     Object.keys(written.one));

  // ---- three more, so the read-out has something to do -------------------
  const send = async (cohort, plan) => {
    await openForm();
    await connect();
    await answer(cohort, plan);
    await page.click('#send');
    await page.waitForSelector('#done:not([hidden])');
  };

  const straight = {};
  content.domains.forEach(d => d.items.forEach(i => { straight['q-' + d.id + '-' + i.id] = 5; }));

  await send('pgy1', {
    answers: {
      'q-technical-audio': 2, 'q-technical-legible': 2, 'q-technical-joining': 2,
      'q-technical-interrupt': 4, 'q-technical-bothatonce': 2, 'q-technical-latestart': 4,
      'global': 3
    },
    numbers: { prep_off: 45 },
    open: { change: 'Two rooms, one microphone.' }
  });
  /* All sixes-and-sevens down the middle: every item at 3, which
     recodes to 3 whichever way it was worded, so this form moves the
     PGY-1 technical mean not at all — and takes the group over the
     suppression threshold so the mean can be seen. */
  await send('pgy1', {
    answers: {
      'q-technical-audio': 3, 'q-technical-legible': 3, 'q-technical-joining': 3,
      'q-technical-interrupt': 3, 'q-technical-bothatonce': 3, 'q-technical-latestart': 3,
      'global': 5
    },
    numbers: {},
    open: {}
  });
  await send('pgy2', {
    answers: { 'q-technical-audio': 5, 'q-technical-interrupt': 1, 'global': 8 },
    numbers: { prep_off: 20 },
    open: { keep: 'The twenty-five minutes.' }
  });
  /* One form ticked straight down the agree column — which, with
     reversed items mixed in, is a form agreeing with itself and
     against itself at once. */
  await send('faculty', { answers: Object.assign({ global: 5 }, straight) });

  // ---- the read-out -----------------------------------------------------
  await page.goto(BASE + '/morning-report/baseline/summary/', { waitUntil: 'networkidle' });
  await connect();
  await page.waitForTimeout(300);
  await page.evaluate(() => load());
  await page.waitForTimeout(200);

  const read = await page.evaluate(() => ({
    counts: [].map.call(document.querySelectorAll('#counts .count'),
      c => c.querySelector('.lb').textContent + '=' + c.querySelector('.n').textContent),
    thin: document.querySelectorAll('#counts .count.thin').length,
    header: [].map.call(document.querySelectorAll('#domaintable thead th'), th => th.textContent),
    technical: [].map.call(document.querySelectorAll('#domaintable tbody tr')[0].querySelectorAll('td'),
      td => td.className + ':' + td.textContent.trim()),
    flags: [].map.call(document.querySelectorAll('#flags .flagbox b'), b => b.textContent),
    openLede: document.getElementById('openlede').textContent,
    quotes: document.querySelectorAll('#open .quote').length
  }));

  t('every group gets a count, and the total counts everybody',
     read.counts[0] === 'responses in all=5', read.counts);
  t('the year groups that answered are broken out by name',
     read.header.slice(2).join('|') === 'PGY-1|PGY-2|PGY-3|Faculty', read.header);
  t('a group of one or two is flagged as too small to break out',
     read.thin === 2, { thin: read.thin, counts: read.counts });

  /* Three PGY-1 forms, recoding to technical means of 4, 2 and 3. Their
     average is 3, and that is what the cell has to say — the reversal
     has to have happened for it to come out there. Ticked raw, without
     the recode, the same three forms average 3.33. */
  const pgy1Cell = read.technical[2];
  t('reversed items are turned round before anything is averaged',
     /^score:3\.00/.test(pgy1Cell), read.technical);
  t('a group under the threshold is suppressed rather than printed',
     read.technical.filter(c => /^sup:/.test(c)).length === 2, read.technical);

  const tags = await page.evaluate(() => ({
    domain: [].map.call(document.querySelectorAll('#domaintable tbody .kind'), e => e.textContent),
    measure: [].map.call(document.querySelectorAll('#measuretable tbody .kind'), e => e.textContent)
  }));
  t('the read-out tags every domain row with its kind of measure',
     tags.domain.length === content.domains.length, tags.domain);
  t('and puts the balancing rows on the same table as the outcome ones',
     tags.domain.indexOf('balancing') !== -1 && tags.measure.indexOf('balancing') !== -1,
     tags);

  t('the straight-lined form is counted and named as one',
     /Straight-lined forms: 1 of 5/.test(read.flags.join(' ')), read.flags);
  t('agreement is reported before recoding, both ways round',
     /Agreement before recoding/.test(read.flags.join(' ')), read.flags);
  t('the read-out says it cannot know the denominator',
     /Who answered: 5 responses/.test(read.flags.join(' ')), read.flags);
  t('written answers are shown once there are enough of them',
     read.quotes >= 3 && !/held back/.test(read.openLede), { quotes: read.quotes, lede: read.openLede });

  /* Nothing on the read-out may pair a written answer with a group:
     with two people in a year, one sentence and one label is a name. */
  const attributed = await page.evaluate(() => {
    const labels = ['PGY-1', 'PGY-2', 'PGY-3', 'Faculty'];
    return [].some.call(document.querySelectorAll('#open .quote'), q => {
      const near = (q.previousElementSibling || {}).textContent || '';
      return labels.some(l => near.indexOf(l) !== -1);
    });
  });
  t('and never with a group label beside them', !attributed);

  const csv = await page.evaluate(() => csvText());
  const head = csv.split('\n')[0].split(',');
  t('the CSV names the reversed items instead of silently recoding them',
     head.filter(h => /_REV$/.test(h)).length ===
       content.domains.reduce((n, d) => n + d.items.filter(i => i.reverse).length, 0),
     head.filter(h => /_REV$/.test(h)));
  t('one row per response, and a header', csv.trim().split('\n').length === 6, csv.trim().split('\n').length);

  // ---- a phone with no folder, and a shared post box --------------------
  const phoneCtx = await browser.newContext();
  const phone = await phoneCtx.newPage();
  phone.on('pageerror', e => errs.push('pageerror(phone): ' + e.message));
  await phone.addInitScript(FAKE_BOX);
  const LINK = '/morning-report/baseline/?relay=' + encodeURIComponent('https://endpoint.test/exec') +
    '&k=submit-key&wave=2026-08&site=Galveston';
  await phone.goto(BASE + LINK, { waitUntil: 'networkidle' });
  await phone.waitForSelector('#cohorts .who');

  const configured = await phone.evaluate(() => ({
    canSubmit: MRRelay.canSubmit(),
    ready: MRStore.status().ready,
    wave: document.getElementById('wave').value,
    site: document.getElementById('site').value,
    cohort: !!document.querySelector('input[name="cohort"]:checked')
  }));
  t('a link carrying the endpoint configures a phone that has no folder',
     configured.canSubmit && !configured.ready, configured);
  t('and names the round and the site for whoever scanned it',
     configured.wave === '2026-08' && configured.site === 'Galveston', configured);
  t('but never says which group they are in — that is theirs to tap',
     configured.cohort === false);

  await phone.evaluate(() => {
    const set = (name, value) => {
      const el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
      if (el) { el.checked = true; el.dispatchEvent(new Event('change')); }
    };
    set('cohort', 'pgy3');
    set('q-technical-audio', 3);
    set('global', 6);
  });
  await phone.click('#send');
  await phone.waitForSelector('#done:not([hidden])');

  const posted = await phone.evaluate(() => ({
    rows: window.__box.rows.length,
    instrument: window.__box.rows[0].record.instrument,
    session: window.__box.rows[0].session,
    note: document.getElementById('donenote').textContent
  }));
  t('a phone with no folder posts to the collection point instead',
     posted.rows === 1 && posted.instrument === 'baseline', posted);
  t('and it is filed under a session id that cannot collide with a morning',
     /^baseline-/.test(posted.session), posted.session);
  t('the phone is told where it went', /collection point/.test(posted.note), posted.note);

  /* Plant a session-feedback submission beside it. Both instruments
     share the post box; neither may take the other's. */
  await phone.evaluate(() => {
    window.__box.rows.push({
      session: '2026-08-14-galveston', submission: 'fb-planted', recordings: [],
      record: { id: 'fb-planted', session: '2026-08-14-galveston', overall: { rating: 4 } }
    });
  });
  const boxNow = await phone.evaluate(() =>
    window.__box.rows.map(r => (r.record.instrument || 'feedback')));
  const carried = await phone.evaluate(() => window.__box.rows);
  await phoneCtx.close();
  t('the phone left both kinds of thing in the one box',
     boxNow.length === 2 && boxNow.indexOf('baseline') !== -1 && boxNow.indexOf('feedback') !== -1,
     boxNow);

  /* The facilitator's machine, which is a different browser context and
     therefore a different in-memory box: what the phone left is carried
     across by hand so the drain has the same two rows to choose between. */
  await page.goto(BASE + '/morning-report/baseline/summary/?wave=2026-08', { waitUntil: 'networkidle' });
  await connect();
  await page.evaluate((rows) => {
    window.__box.rows = rows;
    MRRemote.setSettings({ endpoint: 'https://endpoint.test/exec', key: 'roster-key', remember: false });
  }, carried);
  await page.evaluate(() => collect());
  await page.waitForTimeout(400);

  const drained = await page.evaluate(async () => ({
    left: window.__box.rows.map(r => r.submission),
    note: document.getElementById('collectnote').textContent,
    files: await MRStore.list('baseline')
  }));
  t('the baseline read-out collects only its own',
     drained.left.length === 1 && drained.left[0] === 'fb-planted', drained.left);
  t('and says out loud what it left behind',
     /left for the baseline summary|left where they are/.test(drained.note) || /session-feedback/.test(drained.note),
     drained.note);
  t('the collected response is in the folder under its round',
     drained.files.some(n => /^2026-08--bl-.*\.json$/.test(n)), drained.files);

  // ---- the code that gets handed out ------------------------------------
  await page.goto(BASE + '/morning-report/baseline/share/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  const noKey = await page.evaluate(() => ({
    svg: !!document.querySelector('#qr svg'),
    short: document.getElementById('short').textContent,
    state: document.getElementById('keystate').className,
    link: document.getElementById('linkbox').textContent
  }));
  t('the code is drawn on the page, not fetched from anybody', noKey.svg);
  t('and it points at the short address', /\/baseline\/$/.test(noKey.short), noKey.short);
  t('with no submit key, the page says so rather than letting it be found out later',
     /off/.test(noKey.state) && !/k=/.test(noKey.link), noKey);

  await page.evaluate(() => {
    MRRemote.setSettings({ endpoint: 'https://endpoint.test/exec', key: 'roster-key', remember: false });
    MRRelay.setShareKey('submit-key', false);
    paint();
  });
  const keyed = await page.evaluate(() => ({
    state: document.getElementById('keystate').className,
    shown: document.getElementById('linkbox').textContent,
    encoded: link()
  }));
  t('with one, the code carries it so a phone can actually send',
     /on/.test(keyed.state) && /k=submit-key/.test(keyed.encoded), keyed.state);
  t('and the key is blanked where it is shown on screen',
     /k=…/.test(keyed.shown) && !/submit-key/.test(keyed.shown), keyed.shown);

  const roundTrip = await page.evaluate(() => {
    /* Read it back out of the matrix rather than trusting the string
       that went in — a code that does not decode is a code nobody can
       use, and the encoder has its own suite for the general case. */
    const m = MRQr.matrix(link());
    return { size: m.length, square: m.every(r => r.length === m.length) };
  });
  t('the code encodes at a version that will scan off a slide',
     roundTrip.size >= 21 && roundTrip.square, roundTrip);

  // ---- a device with nowhere to send is told so, before it types --------
  /* The bare address, no folder, no key in the link, and a site config
     that is blank — the exact configuration that scattered a morning's
     responses across the phones that wrote them. The form has to say
     so at the top, before anything is filled in, and the finish screen
     must not say "Sent" over a file that only reached this device. */
  const bareCtx = await browser.newContext();
  const bare = await bareCtx.newPage();
  await bare.goto(BASE + '/morning-report/baseline/', { waitUntil: 'networkidle' });
  await bare.waitForSelector('#cohorts .who');
  await bare.waitForTimeout(200);

  const warned = await bare.evaluate(() => ({
    shown: !document.getElementById('nosave').hidden,
    text: document.getElementById('nosavemsg').textContent
  }));
  t('a device with nowhere to send answers is warned before it types',
     warned.shown && /nowhere to send/i.test(warned.text), warned);

  await bare.evaluate(() => {
    const set = (name, value) => {
      const el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
      if (el) { el.checked = true; el.dispatchEvent(new Event('change')); }
    };
    set('cohort', 'pgy2');
    set('q-technical-audio', 4);
  });
  await bare.click('#send');
  await bare.waitForSelector('#done:not([hidden])');
  const downloadedEnding = await bare.evaluate(() => ({
    headline: document.getElementById('thanks').textContent,
    note: document.getElementById('donenote').textContent
  }));
  t('a download-only send does not claim to have been sent',
     /not sent/i.test(downloadedEnding.headline), downloadedEnding.headline);
  t('and tells the person to hand the file on',
     /downloads|facilitator/i.test(downloadedEnding.note), downloadedEnding.note);
  await bareCtx.close();

  // ---- the site's own collection point ----------------------------------
  /* content/relay.json filled in: the same bare address now submits.
     The config is injected by intercepting the fetch, because the real
     file in the repository ships blank on purpose. */
  const siteCtx = await browser.newContext();
  const sitePage = await siteCtx.newPage();
  sitePage.on('pageerror', e => errs.push('pageerror(site): ' + e.message));
  await sitePage.addInitScript(FAKE_BOX);
  await sitePage.route('**/content/relay.json', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ endpoint: 'https://endpoint.test/exec', submit_key: 'submit-key' })
  }));
  await sitePage.goto(BASE + '/morning-report/baseline/', { waitUntil: 'networkidle' });
  await sitePage.waitForSelector('#cohorts .who');
  await sitePage.waitForTimeout(200);

  const siteState = await sitePage.evaluate(() => ({
    warned: !document.getElementById('nosave').hidden,
    canSubmit: MRRelay.canSubmit(),
    siteConfigured: MRRelay.siteConfigured()
  }));
  t('with the site config filled in, the bare address can submit',
     siteState.canSubmit && siteState.siteConfigured, siteState);
  t('and the cannot-save warning stays down', siteState.warned === false);

  await sitePage.evaluate(() => {
    const set = (name, value) => {
      const el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
      if (el) { el.checked = true; el.dispatchEvent(new Event('change')); }
    };
    set('cohort', 'faculty');
    set('q-technical-audio', 2);
    set('global', 4);
  });
  await sitePage.click('#send');
  await sitePage.waitForSelector('#done:not([hidden])');
  const sitePosted = await sitePage.evaluate(() => ({
    rows: window.__box.rows.length,
    headline: document.getElementById('thanks').textContent,
    note: document.getElementById('donenote').textContent
  }));
  t('a bare-address submission lands in the post box, not in downloads',
     sitePosted.rows === 1 && /collection point/.test(sitePosted.note), sitePosted);
  t('and that ending is the thank-you, because it really was sent',
     !/not sent/i.test(sitePosted.headline), sitePosted.headline);

  /* A link still wins over the site file — handing somebody a link to
     a different endpoint has to keep meaning what it says. */
  const linkWins = await sitePage.evaluate(() => {
    sessionStorage.setItem('mr.relay', JSON.stringify({ endpoint: 'https://other.test/exec', submitKey: 'other-key' }));
    return true;
  });
  await sitePage.goto(BASE + '/morning-report/baseline/', { waitUntil: 'networkidle' });
  await sitePage.waitForTimeout(200);
  const order = await sitePage.evaluate(() => MRRelay.endpoint());
  t('a link or stored setting still beats the site file',
     linkWins && order === 'https://other.test/exec', order);
  await siteCtx.close();

  // ---- the front door, and the one page deliberately outside it ---------
  const strangerCtx = await browser.newContext();     /* no fakefs, so no code */
  const stranger = await strangerCtx.newPage();
  await stranger.goto(BASE + '/morning-report/baseline/summary/', { waitUntil: 'domcontentloaded' });
  const gatedSummary = await stranger.isVisible('.mr-gate');
  await stranger.goto(BASE + '/morning-report/baseline/', { waitUntil: 'domcontentloaded' });
  await stranger.waitForTimeout(250);
  const gatedForm = await stranger.isVisible('.mr-gate');
  const formUsable = await stranger.evaluate(() =>
    !!document.querySelector('input[name="cohort"]'));

  // ---- the short address ------------------------------------------------
  await stranger.goto(BASE + '/baseline/?wave=2026-08', { waitUntil: 'networkidle' });
  await stranger.waitForTimeout(250);
  const short = await stranger.evaluate(() => ({ href: location.pathname + location.search }));
  await strangerCtx.close();

  t('the read-out sits behind the front-door code like every other tool', gatedSummary);
  t('the form does not, because it is scanned off a code by somebody outside the workroom',
     !gatedForm && formUsable, { gatedForm, formUsable });
  t('the short address lands on the form and carries the round with it',
     short.href === '/morning-report/baseline/?wave=2026-08', short.href);

  let failed = 0;
  for (const r of out) { if (!r.pass) failed++; console.log((r.pass?'PASS  ':'FAIL  ') + r.name + (r.extra?'   '+r.extra:'')); }
  if (errs.length) { console.log('\nERRORS:'); errs.forEach(e => console.log('  ' + e)); }
  console.log('\n' + (out.length - failed) + '/' + out.length + ' passed' + (errs.length ? ', ' + errs.length + ' console errors' : ', no console errors'));
  await browser.close();
  process.exit(failed || errs.length ? 1 : 0);
})();
