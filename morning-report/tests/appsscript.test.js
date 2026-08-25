/* The endpoint half, exercised in node with the Google globals stubbed.

   Everything else in this folder drives a browser. This one cannot:
   Code.gs runs on Google's servers, and the only way to find out that
   a chief's typo silently drops a whole day of rota is to run the
   thing. So the four globals it touches are faked, a spreadsheet is
   handed to it as plain arrays, and the payload it builds is checked.

   Invented people throughout, as everywhere in these tests. */

const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync(__dirname + '/../server/Code.gs', 'utf8');

const out = [];
const t = (n, c, x) => out.push({ n, p: !!c, x: x === undefined ? '' : JSON.stringify(x) });

/* ---------- the fake spreadsheet ------------------------------------- */

function makeSheet(name, rows) {
  let data = rows.map(r => r.slice());
  return {
    name,
    getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
    getLastRow: () => data.length,
    getRange: (r, c, nr, nc) => ({
      setValues: (v) => {
        while (data.length < r - 1 + nr) data.push([]);
        for (let i = 0; i < nr; i++) {
          const row = data[r - 1 + i] || (data[r - 1 + i] = []);
          for (let j = 0; j < nc; j++) row[c - 1 + j] = v[i][j];
        }
        return { setFontWeight: () => {} };
      },
      setFontWeight: () => ({}),
    }),
    clear: () => { data = []; },
    setFrozenRows: () => {},
    appendRow: (row) => { data.push(row.slice()); },
    deleteRow: (n) => { data.splice(n - 1, 1); },
    __rows: () => data,
  };
}

/* Minutes each zone is offset from UTC, for the formatDate stub. */
const ZONES = { 'America/Chicago': -5 * 60, 'Asia/Tokyo': 9 * 60 };

function makeContext(sheets, key, tz, feedbackKey) {
  tz = tz || 'America/Chicago';
  const byName = {};
  const seen = { zones: [] };
  /* A fake Drive: files by id, and a note of what got binned. */
  const drive = { files: {}, folders: {}, next: 1, trashed: [] };
  sheets.forEach(s => { byName[s.name] = s; });
  const ss = {
    getSheetByName: (n) => byName[n] || null,
    insertSheet: (n) => { const s = makeSheet(n, []); byName[n] = s; return s; },
    getSpreadsheetTimeZone: () => tz,
  };
  const props = { MR_KEY: key, MR_FEEDBACK_KEY: feedbackKey === undefined ? null : feedbackKey };
  const makeFile = (name, mime, bytes) => {
    const id = 'file-' + (drive.next++);
    drive.files[id] = { id, name, mime, bytes, trashed: false };
    return fileHandle(id);
  };
  const fileHandle = (id) => ({
    getId: () => id,
    getName: () => drive.files[id].name,
    getBlob: () => ({
      getContentType: () => drive.files[id].mime,
      getBytes: () => drive.files[id].bytes,
    }),
    setTrashed: (v) => { drive.files[id].trashed = !!v; if (v) drive.trashed.push(id); },
  });
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({ alert: () => {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
      }),
    },
    DriveApp: {
      createFolder: (name) => {
        const id = 'folder-' + (drive.next++);
        drive.folders[id] = { id, name };
        return { getId: () => id, createFile: (blob) => makeFile(blob.__name, blob.__mime, blob.__bytes) };
      },
      getFolderById: (id) => {
        if (!drive.folders[id]) throw new Error('no such folder');
        return { getId: () => id, createFile: (blob) => makeFile(blob.__name, blob.__mime, blob.__bytes) };
      },
      getFileById: (id) => {
        if (!drive.files[id] || drive.files[id].trashed) throw new Error('no such file');
        return fileHandle(id);
      },
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ setMimeType: () => ({ __text: s }) }),
    },
    Utilities: {
      newBlob: (bytes, mime, name) => ({ __bytes: bytes, __mime: mime, __name: name }),
      base64Decode: (data) => 'bytes:' + data,
      base64Encode: (bytes) => String(bytes).replace(/^bytes:/, ''),
      formatDate: (d, zone, fmt) => {
        seen.zones.push(zone);
        const off = ZONES[zone];
        if (off === undefined) throw new Error('unknown zone in stub: ' + zone);
        return new Date(d.getTime() + off * 60 * 1000).toISOString().slice(0, 10);
      },
    },
    Date, JSON, String, Object, Array, isNaN, console, Error,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, ss, byName, seen, drive };
}

/* What Sheets actually hands back for a date cell: midnight in the
   SPREADSHEET's timezone, expressed as an absolute instant. Not
   midnight UTC — building the fixture that way is what made the first
   version of this test accuse working code. */
function sheetsDate(ymd, tz) {
  const off = ZONES[tz || 'America/Chicago'];
  return new Date(Date.parse(ymd + 'T00:00:00Z') - off * 60 * 1000);
}

const parse = (res) => JSON.parse(res.__text);

/* ---------- fixtures --------------------------------------------------- */

const ROSTER_ROWS = [
  ['id', 'name', 'sort_name', 'level', 'active', 'short'],
  ['r-1', 'Marisol Aguirre', 'Aguirre, Marisol', 'PGY-1', 'yes', ''],
  ['r-2', 'Teodoro Nunez', 'Nunez, Teodoro', 'PGY-3', 'yes', 'T. Nunez'],
  ['r-3', 'Bronwen Kestrel', 'Kestrel, Bronwen', 'PGY-2', 'no', ''],
];
const ROTA_ROWS = [
  ['date', 'GAL Ward Int', 'GAL Ward Sr', 'CLC Ward Sr'],
  ['2026-09-03', 'Marisol Aguirre', 'T. Nunez', 'Kestrel, Bronwen'],
  ['2026-09-04', 'Marisol Aguirre', '', 'Nobody Here'],
];
const SITES_ROWS = [
  ['site', 'label', 'ward_tasks', 'other_tasks'],
  ['GAL', 'Galveston', 'GAL Ward Int, GAL Ward Sr', ''],
  ['CLC', 'Clear Lake', 'CLC Ward Sr', 'Ghost Task'],
];

function fresh(key = 'k') {
  return makeContext([
    makeSheet('Roster', ROSTER_ROWS),
    makeSheet('Rota', ROTA_ROWS),
    makeSheet('Sites', SITES_ROWS),
  ], key);
}

/* ---------- the gate ---------------------------------------------------- */

{
  const { sandbox } = fresh('secret');
  t('a wrong key is denied', parse(sandbox.doGet({ parameter: { key: 'wrong' } })).status === 'denied');
  t('no key at all is denied', parse(sandbox.doGet({ parameter: {} })).status === 'denied');
  t('the right key is let through', parse(sandbox.doGet({ parameter: { key: 'secret' } })).status === 'ok');
}
{
  /* An endpoint deployed before MR_KEY is set must be shut, not open. */
  const { sandbox } = makeContext([makeSheet('Roster', ROSTER_ROWS)], null);
  t('an unset MR_KEY closes the endpoint, it does not open it',
    parse(sandbox.doGet({ parameter: { key: '' } })).status === 'denied');
}

/* ---------- the payload -------------------------------------------------- */

{
  const { sandbox } = fresh();
  const p = parse(sandbox.doGet({ parameter: { key: 'k' } }));

  t('the roster comes back', p.roster.residents.length === 3, p.roster.residents.length);
  t('active is a boolean, not the word yes',
    p.roster.residents[0].active === true && p.roster.residents[2].active === false);
  t('the roster is marked as coming from the sheet', p.roster.source === 'sheet');

  const day = p.rotations.days['2026-09-03'];
  t('a full name resolves to an id', (day['GAL Ward Int'] || []).join() === 'r-1', day['GAL Ward Int']);
  t('a short name resolves to an id', (day['GAL Ward Sr'] || []).join() === 'r-2', day['GAL Ward Sr']);
  t('a surname-first name resolves to an id', (day['CLC Ward Sr'] || []).join() === 'r-3', day['CLC Ward Sr']);

  const day2 = p.rotations.days['2026-09-04'];
  t('an empty cell means nobody, not a blank id', day2['GAL Ward Sr'] === undefined, day2);
  t('an unmatched name is dropped, not passed through', day2['CLC Ward Sr'] === undefined, day2);
  t('and an unmatched name is reported',
    p.warnings.some(w => /Nobody Here/.test(w)), p.warnings);

  t('the tasks are the header row', p.rotations.tasks.join('|') === 'GAL Ward Int|GAL Ward Sr|CLC Ward Sr');
  t('from and to span the dates', p.rotations.from === '2026-09-03' && p.rotations.to === '2026-09-04');
  t('the sites come back', p.rotations.sites.GAL.ward.length === 2 && p.rotations.sites.CLC.label === 'Clear Lake');
  t('a site naming a task that is not a rota column is reported',
    p.warnings.some(w => /Ghost Task/.test(w)), p.warnings);
}

/* A date typed into Sheets comes back as a Date, not a string, and it
   has to keep the day the chief typed. */
{
  const rows = [['date', 'GAL Ward Int'], [sheetsDate('2026-09-03'), 'Marisol Aguirre']];
  const { sandbox, seen } = makeContext([makeSheet('Roster', ROSTER_ROWS), makeSheet('Rota', rows),
                                         makeSheet('Sites', SITES_ROWS)], 'k');
  const p = parse(sandbox.doGet({ parameter: { key: 'k' } }));
  t('a real Date cell keeps the day it was typed as',
    Object.keys(p.rotations.days).join() === '2026-09-03', Object.keys(p.rotations.days));
  t('and it is read in the spreadsheet timezone, not the runtime one',
    seen.zones.length > 0 && seen.zones.every(z => z === 'America/Chicago'), seen.zones);
}

/* The same, somewhere ahead of UTC. Chicago is behind it, so reading a
   date cell as UTC happens to give the right day there and would hide
   the bug; Tokyo is where a naive toISOString lands a day early. */
{
  const rows = [['date', 'GAL Ward Int'], [sheetsDate('2026-09-03', 'Asia/Tokyo'), 'Marisol Aguirre']];
  const { sandbox } = makeContext([makeSheet('Roster', ROSTER_ROWS), makeSheet('Rota', rows),
                                   makeSheet('Sites', SITES_ROWS)], 'k', 'Asia/Tokyo');
  const p = parse(sandbox.doGet({ parameter: { key: 'k' } }));
  t('a date cell east of UTC keeps its day too',
    Object.keys(p.rotations.days).join() === '2026-09-03', Object.keys(p.rotations.days));
}

/* ---------- one cell, one or more people ------------------------------- */

{
  const rota = [
    ['date', 'A', 'B', 'C', 'D', 'E'],
    ['2026-09-03',
      'Kestrel, Bronwen',                              // surname-first: one person
      'Marisol Aguirre, Teodoro Nunez',                // comma-separated: two people
      'Kestrel, Bronwen; Aguirre, Marisol',            // semicolons settle it
      'Kestrel, Bronwen, Aguirre, Marisol',            // pasted pairs, no semicolon
      'T. Nunez'],                                     // a short name on its own
  ];
  const { sandbox } = makeContext([makeSheet('Roster', ROSTER_ROWS), makeSheet('Rota', rota),
                                   makeSheet('Sites', [['site', 'label', 'ward_tasks', 'other_tasks']])], 'k');
  const p = parse(sandbox.doGet({ parameter: { key: 'k' } }));
  const d = p.rotations.days['2026-09-03'];

  t('a surname-first name is one person, not two', (d.A || []).join() === 'r-3', d.A);
  t('two full names separated by commas are two people', (d.B || []).join() === 'r-1,r-2', d.B);
  t('semicolons separate surname-first names', (d.C || []).join() === 'r-3,r-1', d.C);
  t('pasted surname-first pairs are paired back up', (d.D || []).join() === 'r-3,r-1', d.D);
  t('a short name still resolves', (d.E || []).join() === 'r-2', d.E);
  t('none of that produced an unmatched-name warning',
    !p.warnings.some(w => /is called/.test(w)), p.warnings);
}

{
  /* A cell that resolves no way at all reports what was in it rather
     than failing silently. */
  const rota = [['date', 'A'], ['2026-09-03', 'Someone Unknown, Another Stranger']];
  const { sandbox } = makeContext([makeSheet('Roster', ROSTER_ROWS), makeSheet('Rota', rota),
                                   makeSheet('Sites', [['site', 'label', 'ward_tasks', 'other_tasks']])], 'k');
  const p = parse(sandbox.doGet({ parameter: { key: 'k' } }));
  t('an unresolvable cell adds nobody', !p.rotations.days['2026-09-03'].A);
  t('and names both pieces in the warnings',
    p.warnings.some(w => /Someone Unknown/.test(w)) && p.warnings.some(w => /Another Stranger/.test(w)),
    p.warnings);
}

/* Two people a chief could plausibly type the same way must not
   silently resolve to whichever was listed first. */
{
  const dupes = [
    ['id', 'name', 'sort_name', 'level', 'active', 'short'],
    ['r-1', 'Alex Rivera', 'Rivera, Alex', 'PGY-1', 'yes', 'A. Rivera'],
    ['r-2', 'Alexis Rivera', 'Rivera, Alexis', 'PGY-2', 'yes', 'A. Rivera'],
  ];
  const rota = [['date', 'Task'], ['2026-09-03', 'A. Rivera']];
  const { sandbox } = makeContext([makeSheet('Roster', dupes), makeSheet('Rota', rota),
                                   makeSheet('Sites', [['site', 'label', 'ward_tasks', 'other_tasks']])], 'k');
  const p = parse(sandbox.doGet({ parameter: { key: 'k' } }));
  t('an ambiguous name resolves to nobody', !p.rotations.days['2026-09-03'].Task,
    p.rotations.days['2026-09-03']);
  t('and says which name was ambiguous',
    p.warnings.some(w => /A\. Rivera/.test(w) && /more than one/.test(w)), p.warnings);
  t('the unambiguous full names still work',
    p.roster.residents.length === 2);
}

/* A roster row with no id cannot be logged against, so it is refused
   rather than given a made-up one. */
{
  const bad = [
    ['id', 'name', 'sort_name', 'level', 'active', 'short'],
    ['', 'Nameless Person', '', 'PGY-1', 'yes', ''],
    ['r-9', 'Fine Person', '', 'PGY-2', 'yes', ''],
    ['r-9', 'Duplicate Id', '', 'PGY-3', 'yes', ''],
  ];
  const { sandbox } = makeContext([makeSheet('Roster', bad),
                                   makeSheet('Rota', [['date']]),
                                   makeSheet('Sites', [['site', 'label', 'ward_tasks', 'other_tasks']])], 'k');
  const p = parse(sandbox.doGet({ parameter: { key: 'k' } }));
  t('a row with no id is skipped', p.roster.residents.length === 1, p.roster.residents.map(r => r.name));
  t('and reported', p.warnings.some(w => /Nameless Person/.test(w)));
  t('a duplicate id is skipped and reported', p.warnings.some(w => /r-9/.test(w)), p.warnings);
}

/* ---------- seeding ------------------------------------------------------ */

{
  const { sandbox, byName } = makeContext([], 'k');
  const body = {
    key: 'k',
    roster: { residents: [
      { id: 'r-1', name: 'Marisol Aguirre', sort_name: 'Aguirre, Marisol', level: 'PGY-1', active: true, short: '' },
      { id: 'r-2', name: 'Teodoro Nunez', sort_name: 'Nunez, Teodoro', level: 'PGY-3', active: false, short: 'T. Nunez' },
    ] },
    rotations: {
      tasks: ['GAL Ward Int', 'GAL Ward Sr'],
      sites: { GAL: { label: 'Galveston', ward: ['GAL Ward Int'], other: ['GAL Ward Sr'] } },
      days: { '2026-09-04': { 'GAL Ward Sr': ['r-2'] }, '2026-09-03': { 'GAL Ward Int': ['r-1'] } },
    },
  };
  const res = parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }));
  t('seeding reports what it wrote', res.status === 'ok' && res.wrote.roster === 2 && res.wrote.rota === 2, res.wrote);

  const roster = byName.Roster.__rows();
  t('the roster tab gets a header row', roster[0].join('|') === 'id|name|sort_name|level|active|short');
  t('an inactive resident is written as no', roster[2][4] === 'no', roster[2]);

  const rota = byName.Rota.__rows();
  t('the rota header is date plus the tasks', rota[0].join('|') === 'date|GAL Ward Int|GAL Ward Sr');
  t('days are written in date order', rota[1][0] === '2026-09-03' && rota[2][0] === '2026-09-04',
    [rota[1][0], rota[2][0]]);
  t('ids are written back out as names', rota[1][1] === 'Marisol Aguirre', rota[1]);
  t('a task nobody is on is left blank', rota[1][2] === '', rota[1]);
  t('the sites tab is written', byName.Sites.__rows()[1].join('|') === 'GAL|Galveston|GAL Ward Int|GAL Ward Sr');

  /* the round trip: what was seeded reads back as what went in */
  const back = parse(sandbox.doGet({ parameter: { key: 'k' } }));
  t('a seeded sheet reads back with no warnings', back.warnings.length === 0, back.warnings);
  t('and the same people are on the same days',
    back.rotations.days['2026-09-03']['GAL Ward Int'].join() === 'r-1' &&
    back.rotations.days['2026-09-04']['GAL Ward Sr'].join() === 'r-2',
    back.rotations.days);
}

{
  const { sandbox } = fresh('k');
  t('seeding with a wrong key is denied',
    parse(sandbox.doPost({ postData: { contents: JSON.stringify({ key: 'no' }) } })).status === 'denied');
  t('unparseable post data is denied rather than crashing',
    parse(sandbox.doPost({ postData: { contents: 'not json' } })).status === 'denied');
}

/* ---------- the post box -------------------------------------------------

   The half that takes feedback from a phone and hands it to the
   facilitator's browser. Two keys, and the weaker one must not be
   able to read the roster or drain anything.
   ------------------------------------------------------------------ */

const SUBMISSION = {
  id: 'fb-abc123',
  session: '2026-09-03-galveston',
  date: '2026-09-03',
  site: 'Galveston',
  overall: { rating: 4, checks: { learned: true }, comment: 'The take-homes landed.' },
  roles: { pgy1: { rating: 5, comment: 'Committed early and said why.' } }
};

const post = (sandbox, body) => parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }));

function withPostBox(key = 'k', feedbackKey = 'fk') {
  return makeContext([
    makeSheet('Roster', ROSTER_ROWS),
    makeSheet('Rota', ROTA_ROWS),
    makeSheet('Sites', SITES_ROWS),
  ], key, 'America/Chicago', feedbackKey);
}

{
  const { sandbox } = withPostBox();

  t('the feedback key may submit',
    post(sandbox, { key: 'fk', action: 'feedback', record: SUBMISSION }).status === 'ok');
  t('the feedback key may not collect',
    post(sandbox, { key: 'fk', action: 'collect' }).status === 'denied');
  t('the feedback key may not drop anything',
    post(sandbox, { key: 'fk', action: 'collected', submissions: ['fb-abc123'] }).status === 'denied');
  t('the feedback key may not seed the sheets',
    post(sandbox, { key: 'fk', roster: { residents: [] } }).status === 'denied');
  t('the feedback key cannot read the roster',
    parse(sandbox.doGet({ parameter: { key: 'fk' } })).status === 'denied');
  t('a wrong key submits nothing',
    post(sandbox, { key: 'nope', action: 'feedback', record: SUBMISSION }).status === 'denied');
}

{
  /* No MR_FEEDBACK_KEY set: the facilitator's key still submits, so a
     single-key deployment is not broken by this feature existing. */
  const { sandbox } = withPostBox('k', null);
  t('with no feedback key set, the roster key still submits',
    post(sandbox, { key: 'k', action: 'feedback', record: SUBMISSION }).status === 'ok');
  t('and an unset feedback key does not become a skeleton key',
    post(sandbox, { key: '', action: 'feedback', record: SUBMISSION }).status === 'denied');
}

{
  const { sandbox, byName } = withPostBox();
  const res = post(sandbox, { key: 'fk', action: 'feedback', record: SUBMISSION });
  t('a submission becomes one row', byName.Feedback.__rows().length === 2, byName.Feedback.__rows().length);
  t('the row carries the session and the id',
    byName.Feedback.__rows()[1][1] === '2026-09-03-galveston' &&
    byName.Feedback.__rows()[1][2] === 'fb-abc123', byName.Feedback.__rows()[1].slice(0, 3));
  t('with no recordings, nothing went to Drive', res.recordings === 0, res);

  const junk = post(sandbox, { key: 'fk', action: 'feedback', record: { comment: 'no id' } });
  t('a submission with no id is refused, not stored',
    junk.status === 'error' && byName.Feedback.__rows().length === 2, junk);
}

{
  const { sandbox, drive } = withPostBox();
  const res = post(sandbox, {
    key: 'fk', action: 'feedback', record: SUBMISSION,
    audio: [{ unit: 'overall', mime: 'audio/webm', data: 'AAAA' }]
  });
  t('a recording goes to Drive and the row keeps its id', res.recordings === 1, res);

  const ids = Object.keys(drive.files);
  t('the file is named for its session, submission and box',
    drive.files[ids[0]].name === '2026-09-03-galveston--fb-abc123--overall.webm',
    drive.files[ids[0]].name);

  const pending = post(sandbox, { key: 'k', action: 'collect' });
  t('collecting returns it, with the record parsed back into an object',
    pending.pending.length === 1 && pending.pending[0].record.overall.rating === 4,
    pending.pending && pending.pending.length);
  t('and names the recording that goes with it',
    pending.pending[0].recordings.length === 1, pending.pending[0].recordings);

  const clip = post(sandbox, { key: 'k', action: 'recording', id: pending.pending[0].recordings[0] });
  t('the recording comes back as it went in', clip.status === 'ok' && clip.data === 'AAAA', clip);

  const dropped = post(sandbox, { key: 'k', action: 'collected', submissions: ['fb-abc123'] });
  t('dropping it clears the row and bins the file',
    dropped.dropped === 1 && dropped.binned === 1, dropped);
  t('and the post box is then empty',
    post(sandbox, { key: 'k', action: 'collect' }).pending.length === 0);
  t('a binned recording is no longer served',
    post(sandbox, { key: 'k', action: 'recording', id: ids[0] }).status === 'error');
}

{
  const { sandbox, byName } = withPostBox();
  post(sandbox, { key: 'fk', action: 'feedback', record: SUBMISSION });
  post(sandbox, { key: 'fk', action: 'feedback', record: Object.assign({}, SUBMISSION, { id: 'fb-def456' }) });
  post(sandbox, { key: 'fk', action: 'feedback', record: Object.assign({}, SUBMISSION, { id: 'fb-ghi789' }) });

  const dropped = post(sandbox, { key: 'k', action: 'collected', submissions: ['fb-abc123', 'fb-ghi789'] });
  t('dropping two of three takes exactly those two', dropped.dropped === 2, dropped);
  const left = post(sandbox, { key: 'k', action: 'collect' }).pending;
  t('and leaves the third where it was',
    left.length === 1 && left[0].submission === 'fb-def456', left.map(r => r.submission));
}

{
  const { sandbox, byName } = withPostBox();
  byName.Feedback = makeSheet('Feedback', [
    ['received', 'session', 'submission', 'recordings', 'payload'],
    ['2026-09-03T12:00:00Z', '2026-09-03-galveston', 'fb-broken', '', '{not json'],
  ]);
  const pending = post(sandbox, { key: 'k', action: 'collect' });
  t('a row somebody hand-edited into nonsense is reported, not silently dropped',
    pending.pending.length === 0 && pending.unreadable.join(',') === 'fb-broken', pending);
}

{
  const { sandbox } = withPostBox();
  const big = post(sandbox, {
    key: 'fk', action: 'feedback', record: SUBMISSION,
    audio: [{ unit: 'overall', mime: 'audio/webm', data: 'x'.repeat(9 * 1024 * 1024) }]
  });
  t('an oversized recording is refused with a sentence', big.status === 'error' && /too large/.test(big.message), big.message);
}

{
  /* The original seed path must still work exactly as it did. */
  const { sandbox, byName } = withPostBox();
  const seeded = post(sandbox, {
    key: 'k',
    roster: { residents: [{ id: 'r-9', name: 'Wren Halloway', level: 'PGY-2', active: true }] }
  });
  t('a POST with no action still seeds the sheets',
    seeded.status === 'ok' && seeded.wrote.roster === 1, seeded);
  t('and the roster sheet actually changed',
    byName.Roster.__rows()[1][1] === 'Wren Halloway', byName.Roster.__rows()[1]);
}

/* ---------- report -------------------------------------------------------- */

let bad = 0;
for (const o of out) {
  if (!o.p) bad++;
  console.log(`${o.p ? ' ok ' : 'FAIL'}  ${o.n}${o.p ? '' : '  got ' + o.x}`);
}
console.log(`\n${out.length} assertions, ${bad} failures`);
process.exit(bad ? 1 : 0);
