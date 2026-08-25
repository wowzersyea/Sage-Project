/* ==================================================================
   Morning Report — shared roster endpoint (Google Apps Script)

   This file is the whole server. It holds no data: the data is in the
   spreadsheet this script is bound to, which is why this file can live
   in a public repository and the roster cannot.

   It answers two things:

     GET  ?key=...    the roster and the rota, as the browser wants them
     POST {key,...}   seed the sheets from an existing data folder

   and it holds a third, which is a post box rather than a store:

     POST {key, action:"feedback"}   take one feedback submission
     POST {key, action:"collect"}    list what has not been collected
     POST {key, action:"recording"}  hand over one recording
     POST {key, action:"collected"}  forget what was just collected

   The post box exists because a phone cannot write to a laptop's disk.
   A submission waits here until the facilitator's browser drains it
   into the data folder and tells this script to drop it. Nothing is
   meant to live here: the folder is the permanent home, and a drained
   endpoint is an empty one.

   All of it is gated on a key held in Script Properties, never in here.

   ---- Two keys, and why ---------------------------------------------

   MR_KEY is the facilitator's key. It reads the roster, seeds the
   sheets, and drains the post box.

   MR_FEEDBACK_KEY, if set, submits feedback and does nothing else. It
   is the one that goes in a link handed round a room, because the
   roster is the file with the names in it and a resident filling in a
   form has no business reading it. Set both; hand out only the second.

   ---- Setting it up -------------------------------------------------

   1. Create a Google Sheet. Extensions -> Apps Script. Paste this file
      over Code.gs and save.
   2. Run setUpSheets() once from the editor. It creates the three tabs
      with their headers. Grant the permissions it asks for.
   3. Project Settings -> Script Properties -> add:
         MR_KEY            a long random string, for the facilitator
         MR_FEEDBACK_KEY   a second one, for the feedback link
   4. Deploy -> New deployment -> Web app
         Execute as:      Me
         Who has access:  Anyone
      "Anyone" is what lets a browser fetch it at all; MR_KEY is the
      actual gate. Copy the /exec URL.
   5. Paste the URL and the key into /morning-report/settings/.

   ---- The sheets ----------------------------------------------------

   Roster   id | name | sort_name | level | active | short
            One row per resident. id is what the log refers to, so it
            must not change once a resident has been drawn.

   Rota     date | <task> | <task> | ...
            One row per day. The header row names the tasks. A cell
            holds the people on that task that day, written as they
            appear in Roster.name. Blank means nobody.

            Separate two people with a semicolon. A comma works too,
            and so does surname-first ("Kestrel, Bronwen"), because a
            pasted QGenda cell looks like that — see splitPeople for
            the order those are tried in. Anything this script writes
            uses semicolons, which are never ambiguous.

   Sites    site | label | ward_tasks | other_tasks
            ward_tasks are the ones that make up the presenting team:
            on that site's presenting day those people come off the
            wheels. other_tasks stay eligible as discussants.

   Names, not ids, in Rota and Sites on purpose — a chief editing this
   on their phone between patients should not have to know that Dr X is
   r-017.
   ================================================================== */

var SHEETS = {
  roster: 'Roster',
  rota: 'Rota',
  sites: 'Sites',
  feedback: 'Feedback'
};

var ROSTER_HEADERS = ['id', 'name', 'sort_name', 'level', 'active', 'short'];
var SITES_HEADERS = ['site', 'label', 'ward_tasks', 'other_tasks'];
var FEEDBACK_HEADERS = ['received', 'session', 'submission', 'recordings', 'payload'];

/* A recording is capped in the browser long before it gets here. This
   is the backstop, in base64 characters, so a runaway upload is
   refused with a sentence rather than a platform error. */
var MAX_CLIP = 8 * 1024 * 1024;

/* ---------- entry points -------------------------------------------- */

function doGet(e) {
  try {
    if (!authorised(e && e.parameter && e.parameter.key)) return json({ status: 'denied' });
    return json(buildPayload());
  } catch (err) {
    return json({ status: 'error', message: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    var body = {};
    try { body = JSON.parse(e.postData.contents); } catch (parseErr) { body = {}; }

    /* Submitting feedback is the one thing the weaker key may do, and
       it may do it whether or not the stronger key was configured. */
    if (body.action === 'feedback') {
      if (!maySubmit(body.key)) return json({ status: 'denied' });
      return json(takeFeedback(body));
    }

    if (!authorised(body.key)) return json({ status: 'denied' });

    if (body.action === 'collect') return json(pendingFeedback());
    if (body.action === 'recording') return json(oneRecording(body.id));
    if (body.action === 'collected') return json(dropCollected(body.submissions));

    return json(seedFrom(body));                 // no action: the original seed
  } catch (err) {
    return json({ status: 'error', message: String(err && err.message || err) });
  }
}

function authorised(key) {
  var want = PropertiesService.getScriptProperties().getProperty('MR_KEY');
  if (!want) return false;                       // unconfigured is closed, not open
  return String(key || '') === String(want);
}

/* The feedback key submits and nothing else. The facilitator's key
   also submits, so a machine that only has the one still works. */
function maySubmit(key) {
  if (authorised(key)) return true;
  var want = PropertiesService.getScriptProperties().getProperty('MR_FEEDBACK_KEY');
  if (!want) return false;
  return String(key || '') === String(want);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- the post box ---------------------------------------------

   Feedback arrives here from whatever device it was filled in on, and
   waits. It is not a record: the facilitator's browser collects it
   into the data folder and calls "collected", which drops the row and
   bins the recordings. A drained post box holds nothing.

   Recordings go to a Drive folder rather than into a cell, because a
   cell holds 50,000 characters and a minute of speech is more than
   that in base64.
   ------------------------------------------------------------------ */

function audioFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('MR_AUDIO_FOLDER');
  if (id) {
    try { return DriveApp.getFolderById(id); }
    catch (e) { /* someone deleted it; fall through and make another */ }
  }
  var made = DriveApp.createFolder('MorningReport feedback audio');
  props.setProperty('MR_AUDIO_FOLDER', made.getId());
  return made;
}

function clipName(rec, clip) {
  var mime = String(clip.mime || 'audio/webm');
  var ext = mime.indexOf('mp4') !== -1 ? 'mp4' : mime.indexOf('ogg') !== -1 ? 'ogg' : 'webm';
  return rec.session + '--' + rec.id + '--' + (clip.unit || 'note') + '.' + ext;
}

function takeFeedback(body) {
  var rec = body.record;
  if (!rec || !rec.id || !rec.session) {
    return { status: 'error', message: 'A submission needs an id and a session.' };
  }

  var clips = Array.isArray(body.audio) ? body.audio : [];
  for (var i = 0; i < clips.length; i++) {
    if (clips[i] && typeof clips[i].data === 'string' && clips[i].data.length > MAX_CLIP) {
      return { status: 'error', message: 'A recording was too large to accept. Send the feedback without it.' };
    }
  }

  /* The row goes in before the recordings, so a Drive failure loses
     the audio and never the words. */
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = sheetFor(ss, SHEETS.feedback, FEEDBACK_HEADERS);
  var ids = [];
  var warning = '';
  try {
    clips.forEach(function (clip) {
      if (!clip || !clip.data) return;
      var blob = Utilities.newBlob(Utilities.base64Decode(clip.data), clip.mime || 'audio/webm', clipName(rec, clip));
      ids.push(audioFolder().createFile(blob).getId());
    });
  } catch (err) {
    warning = 'The words were taken; a recording was not: ' + String(err && err.message || err);
  }

  sh.appendRow([new Date().toISOString(), rec.session, rec.id, ids.join(','), JSON.stringify(rec)]);
  return { status: 'ok', id: rec.id, recordings: ids.length, warning: warning };
}

/* Everything waiting, oldest first. The payload is parsed here so a
   row somebody hand-edited into nonsense is reported rather than
   quietly dropped on the floor. */
function pendingFeedback() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEETS.feedback);
  if (!sh) return { status: 'ok', pending: [], unreadable: [] };

  var rows = sh.getDataRange().getValues();
  var pending = [];
  var unreadable = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r || !String(r[2] || '').trim()) continue;
    var record = null;
    try { record = JSON.parse(r[4]); } catch (e) { record = null; }
    if (!record) { unreadable.push(String(r[2])); continue; }
    pending.push({
      received: String(r[0] || ''),
      session: String(r[1] || ''),
      submission: String(r[2] || ''),
      recordings: splitList(r[3]),
      record: record
    });
  }
  return { status: 'ok', pending: pending, unreadable: unreadable };
}

function oneRecording(id) {
  if (!id) return { status: 'error', message: 'No recording was named.' };
  try {
    var file = DriveApp.getFileById(String(id));
    var blob = file.getBlob();
    return {
      status: 'ok',
      id: String(id),
      name: file.getName(),
      mime: blob.getContentType(),
      data: Utilities.base64Encode(blob.getBytes())
    };
  } catch (err) {
    return { status: 'error', message: 'That recording is not there any more.' };
  }
}

/* Called once the folder has the lot. Rows go from the bottom up so
   the indexes underneath do not shift as they are removed.

   Recordings are binned rather than shredded — Apps Script can only
   trash a file. Empty the Drive bin if you want them gone today. */
function dropCollected(submissions) {
  var want = {};
  (Array.isArray(submissions) ? submissions : []).forEach(function (id) { want[String(id)] = true; });
  if (!Object.keys(want).length) return { status: 'ok', dropped: 0, binned: 0 };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEETS.feedback);
  if (!sh) return { status: 'ok', dropped: 0, binned: 0 };

  var rows = sh.getDataRange().getValues();
  var dropped = 0;
  var binned = 0;
  for (var i = rows.length - 1; i >= 1; i--) {
    if (!want[String(rows[i][2] || '')]) continue;
    splitList(rows[i][3]).forEach(function (id) {
      try { DriveApp.getFileById(id).setTrashed(true); binned++; }
      catch (e) { /* already gone, which is the state we wanted */ }
    });
    sh.deleteRow(i + 1);
    dropped++;
  }
  return { status: 'ok', dropped: dropped, binned: binned };
}

/* ---------- reading the sheets --------------------------------------- */

function buildPayload() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var warnings = [];

  var residents = readRoster(ss, warnings);
  var byName = indexNames(residents);
  var rota = readRota(ss, byName, warnings);
  var sites = readSites(ss, rota.tasks, warnings);

  return {
    status: 'ok',
    generated: new Date().toISOString(),
    warnings: warnings,
    roster: {
      source: 'sheet',
      academic_year: academicYear(),
      residents: residents
    },
    rotations: rota.days === null ? null : {
      source: 'sheet',
      academic_year: academicYear(),
      from: rota.from,
      to: rota.to,
      tasks: rota.tasks,
      sites: sites,
      days: rota.days
    }
  };
}

function readRoster(ss, warnings) {
  var rows = tableOf(ss, SHEETS.roster);
  if (!rows.length) { warnings.push('The Roster tab is empty.'); return []; }
  var out = [];
  var seen = {};
  rows.forEach(function (row, i) {
    var name = String(row.name || '').trim();
    if (!name) return;
    var id = String(row.id || '').trim();
    if (!id) { warnings.push('Roster row ' + (i + 2) + ' (' + name + ') has no id and was skipped.'); return; }
    if (seen[id]) { warnings.push('Roster id ' + id + ' appears more than once; the later row was skipped.'); return; }
    seen[id] = true;
    out.push({
      id: id,
      name: name,
      sort_name: String(row.sort_name || '').trim(),
      level: String(row.level || '').trim(),
      short: String(row.short || '').trim(),
      active: !isFalsey(row.active),
      unavailable: []
    });
  });
  return out;
}

/* Names as a chief would type them: the full name, the short name, and
   the surname-first form all resolve to the same person. */
function indexNames(residents) {
  var ix = {};
  function put(key, id) {
    var k = norm(key);
    if (!k) return;
    if (ix[k] && ix[k] !== id) { ix[k] = '__ambiguous__'; return; }
    ix[k] = id;
  }
  residents.forEach(function (r) {
    put(r.name, r.id);
    put(r.short, r.id);
    put(r.sort_name, r.id);
    if (r.sort_name && r.sort_name.indexOf(',') !== -1) {
      var parts = r.sort_name.split(',');
      put(parts[1] + ' ' + parts[0], r.id);      // "Given Surname" from "Surname, Given"
    }
    put(r.id, r.id);                              // an id typed directly still works
  });
  return ix;
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* One cell, one or more people.

   The comma has to do two jobs: it separates people, and it is the
   middle of "Kestrel, Bronwen" — which is exactly how QGenda writes a
   name, so it is exactly what gets pasted in. Splitting on it blindly
   turns one resident into two strangers, silently.

   So the cell is read in order of confidence, and only the last step
   guesses: a semicolon is unambiguous and wins; failing that a cell
   that resolves whole is one person; failing that comma-separated
   pieces that each resolve are several people; failing that, adjacent
   pieces are paired, which is what a pasted "Surname, Given, Surname,
   Given" needs. If none of it resolves, the pieces are returned so the
   warning can name what was actually in the cell. */
function splitPeople(cell, byName) {
  var raw = String(cell || '').trim();
  if (!raw) return [];

  if (raw.indexOf(';') !== -1) return trimAll(raw.split(';'));
  if (byName[norm(raw)]) return [raw];

  var parts = trimAll(raw.split(','));
  if (parts.length < 2) return parts;
  if (allResolve(parts, byName)) return parts;

  if (parts.length % 2 === 0) {
    var pairs = [];
    for (var i = 0; i < parts.length; i += 2) pairs.push(parts[i] + ', ' + parts[i + 1]);
    if (allResolve(pairs, byName)) return pairs;
  }
  return parts;
}

function trimAll(list) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var s = String(list[i] == null ? '' : list[i]).trim();
    if (s) out.push(s);
  }
  return out;
}

function allResolve(list, byName) {
  if (!list.length) return false;
  for (var i = 0; i < list.length; i++) {
    var id = byName[norm(list[i])];
    if (!id || id === '__ambiguous__') return false;
  }
  return true;
}

function readRota(ss, byName, warnings) {
  var sh = ss.getSheetByName(SHEETS.rota);
  if (!sh) { warnings.push('There is no Rota tab.'); return { days: null, tasks: [], from: '', to: '' }; }
  var values = sh.getDataRange().getValues();
  if (values.length < 2) { warnings.push('The Rota tab has no rows.'); return { days: null, tasks: [], from: '', to: '' }; }

  var header = values[0].map(function (h) { return String(h || '').trim(); });
  var tasks = header.slice(1).filter(function (h) { return h; });
  if (!tasks.length) { warnings.push('The Rota tab has no task columns.'); return { days: null, tasks: [], from: '', to: '' }; }

  var days = {};
  var dates = [];
  var unmatched = {};

  for (var r = 1; r < values.length; r++) {
    var date = asDate(values[r][0]);
    if (!date) continue;
    var day = {};
    for (var c = 1; c < header.length; c++) {
      var task = header[c];
      if (!task) continue;
      var ids = splitPeople(String(values[r][c] || ''), byName)
        .map(function (n) {
          var id = byName[norm(n)];
          if (!id) { unmatched[n] = true; return null; }
          if (id === '__ambiguous__') { unmatched[n + ' (matches more than one resident)'] = true; return null; }
          return id;
        }).filter(Boolean);
      if (ids.length) day[task] = ids;
    }
    days[date] = day;
    dates.push(date);
  }

  Object.keys(unmatched).forEach(function (n) {
    warnings.push('No one in the Roster tab is called "' + n + '" — that cell was ignored.');
  });

  dates.sort();
  return {
    days: days,
    tasks: tasks,
    from: dates.length ? dates[0] : '',
    to: dates.length ? dates[dates.length - 1] : ''
  };
}

function readSites(ss, tasks, warnings) {
  var rows = tableOf(ss, SHEETS.sites);
  var sites = {};
  var known = {};
  tasks.forEach(function (t) { known[t] = true; });

  rows.forEach(function (row) {
    var id = String(row.site || '').trim();
    if (!id) return;
    var ward = splitList(row.ward_tasks);
    var other = splitList(row.other_tasks);
    ward.concat(other).forEach(function (t) {
      if (!known[t]) warnings.push('Site ' + id + ' names a task "' + t + '" that is not a column on the Rota tab.');
    });
    sites[id] = { label: String(row.label || id).trim(), ward: ward, other: other };
  });

  if (!Object.keys(sites).length) warnings.push('The Sites tab is empty, so no presenting-site filter will apply.');
  return sites;
}

function splitList(v) {
  return String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

/* ---------- seeding from the data folder ------------------------------ */

function seedFrom(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wrote = {};
  var warnings = [];

  if (body.roster && Array.isArray(body.roster.residents)) {
    var sh = sheetFor(ss, SHEETS.roster, ROSTER_HEADERS);
    var rows = body.roster.residents.map(function (p) {
      return [p.id || '', p.name || '', p.sort_name || '', p.level || '',
        p.active === false ? 'no' : 'yes', p.short || ''];
    });
    writeTable(sh, ROSTER_HEADERS, rows);
    wrote.roster = rows.length;
  }

  if (body.rotations && body.rotations.days) {
    var byId = {};
    ((body.roster && body.roster.residents) || []).forEach(function (p) { byId[p.id] = p.name || p.id; });

    var tasks = Array.isArray(body.rotations.tasks) && body.rotations.tasks.length
      ? body.rotations.tasks.slice()
      : taskNamesIn(body.rotations.days);

    var header = ['date'].concat(tasks);
    var dates = Object.keys(body.rotations.days).sort();
    var rotaRows = dates.map(function (d) {
      var day = body.rotations.days[d] || {};
      return [d].concat(tasks.map(function (t) {
        /* Semicolons, not commas: a name written "Kestrel, Bronwen"
           already contains a comma, and anything this writes will be
           read back by splitPeople. Generate the unambiguous form. */
        return (day[t] || []).map(function (id) {
          if (!byId[id]) warnings.push('Rota for ' + d + ' names ' + id + ', who is not in the roster that was sent.');
          return byId[id] || id;
        }).join('; ');
      }));
    });
    writeTable(sheetFor(ss, SHEETS.rota, header), header, rotaRows);
    wrote.rota = rotaRows.length;

    var siteRows = [];
    var sites = body.rotations.sites || {};
    Object.keys(sites).forEach(function (id) {
      siteRows.push([id, sites[id].label || id,
        (sites[id].ward || []).join(', '), (sites[id].other || []).join(', ')]);
    });
    writeTable(sheetFor(ss, SHEETS.sites, SITES_HEADERS), SITES_HEADERS, siteRows);
    wrote.sites = siteRows.length;
  }

  return { status: 'ok', wrote: wrote, warnings: warnings };
}

function taskNamesIn(days) {
  var seen = {};
  Object.keys(days).forEach(function (d) {
    Object.keys(days[d] || {}).forEach(function (t) { seen[t] = true; });
  });
  return Object.keys(seen);
}

/* ---------- sheet helpers --------------------------------------------- */

function setUpSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  sheetFor(ss, SHEETS.roster, ROSTER_HEADERS);
  sheetFor(ss, SHEETS.rota, ['date']);
  sheetFor(ss, SHEETS.sites, SITES_HEADERS);
  sheetFor(ss, SHEETS.feedback, FEEDBACK_HEADERS);
  SpreadsheetApp.getUi().alert(
    'Four tabs are ready.\n\n' +
    'Set MR_KEY in Project Settings -> Script Properties, deploy as a web app, ' +
    'then use the Publish page in Morning Report to fill these in from your data folder.\n\n' +
    'Feedback is a post box, not a record: it fills up as people submit and empties ' +
    'when the facilitator collects it into the data folder. Add MR_FEEDBACK_KEY as well ' +
    'and hand that one out, so a feedback link cannot read the roster.');
}

function sheetFor(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0 && headers && headers.length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function writeTable(sh, headers, rows) {
  sh.clear();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

/* Rows as objects keyed by the header row, lower-cased. */
function tableOf(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = {};
    var any = false;
    for (var c = 0; c < header.length; c++) {
      if (!header[c]) continue;
      row[header[c]] = values[r][c];
      if (String(values[r][c] || '').trim()) any = true;
    }
    if (any) out.push(row);
  }
  return out;
}

/* Sheets hands back a Date for anything it recognised as one, and a
   string for anything it did not. Both have to end up as YYYY-MM-DD in
   the spreadsheet's own timezone — reading a Date as UTC lands on the
   previous day for anywhere west of Greenwich, which is the whole US. */
function asDate(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function isFalsey(v) {
  if (v === false) return true;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'no' || s === 'false' || s === '0' || s === 'inactive';
}

function academicYear() {
  var d = new Date();
  var y = d.getFullYear();
  var start = d.getMonth() >= 6 ? y : y - 1;     // July starts the year
  return start + '-' + (start + 1);
}
