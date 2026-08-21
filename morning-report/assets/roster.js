/* ==================================================================
   MRRoster — roster.json, and the rules that read it.

   roster.json is the one file in the system that contains names. It
   holds the roster the program already publishes plus a participation
   log: that a resident served a role on a date, never how it went.

   Nothing in here joins a name to a score, and nothing should be
   added that does. Counting turns is a scheduling question; scoring
   turns is an evaluation question, and only the first belongs in a
   permanent identified file.
   ================================================================== */

(function (global) {
  "use strict";

  var PATH = "roster.json";

  var ROLES = [
    { id: "presenter",         label: "Presenter" },
    { id: "scribe",            label: "Scribe" },
    { id: "pgy1_discussant",   label: "PGY-1 discussant" },
    { id: "senior_discussant", label: "Senior discussant" },
    { id: "facilitator",       label: "Facilitator" }
  ];

  var DISCUSSANT_ROLES = ["pgy1_discussant", "senior_discussant"];
  var LEVELS = ["PGY-1", "PGY-2", "PGY-3"];

  /* ---------- academic blocks -------------------------------------
     Calendar arithmetic only. What each block *asks* of the intern,
     and how long the senior's block runs, live in content/roles.json
     so the web pages, the print view and the run-of-show cannot drift.
     ---------------------------------------------------------------- */

  var BLOCKS = [
    { id: "jul-sep", label: "Jul–Sep", months: [6, 7, 8] },
    { id: "oct-dec", label: "Oct–Dec", months: [9, 10, 11] },
    { id: "jan-mar", label: "Jan–Mar", months: [0, 1, 2] },
    { id: "apr-jun", label: "Apr–Jun", months: [3, 4, 5] }
  ];

  function blockFor(date) {
    var m = parseDate(date).getMonth();
    for (var i = 0; i < BLOCKS.length; i++) {
      if (BLOCKS[i].months.indexOf(m) !== -1) return BLOCKS[i];
    }
    return BLOCKS[0];
  }

  /* ---------- dates ------------------------------------------------ */

  function parseDate(d) {
    if (d instanceof Date) return d;
    var p = String(d || "").split("-");
    // constructed local, not UTC, so a date never slips a day westward
    return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
  }

  function daysBetween(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
  }

  function weeksSince(date, today) {
    if (!date) return null;
    return daysBetween(date, today || MRStore.today()) / 7;
  }

  /* The academic year a date falls in: 1 July rolls it over. */
  function academicYearOf(date) {
    var d = parseDate(date);
    var y = d.getFullYear();
    var start = d.getMonth() >= 6 ? y : y - 1;
    return start + "-" + (start + 1);
  }

  /* ---------- the empty roster ------------------------------------- */

  function blank() {
    return {
      academic_year: academicYearOf(MRStore.today()),
      residents: [],
      log: [],
      cycle: {},
      settings: { overdue_weeks: 8 },
      updated: new Date().toISOString()
    };
  }

  function normalise(r) {
    if (!r || typeof r !== "object") return blank();
    r.residents = Array.isArray(r.residents) ? r.residents : [];
    r.log = Array.isArray(r.log) ? r.log : [];
    r.cycle = r.cycle && typeof r.cycle === "object" ? r.cycle : {};
    r.settings = r.settings && typeof r.settings === "object" ? r.settings : {};
    if (typeof r.settings.overdue_weeks !== "number") r.settings.overdue_weeks = 8;
    if (!r.academic_year) r.academic_year = academicYearOf(MRStore.today());
    r.residents.forEach(function (p) {
      if (!Array.isArray(p.unavailable)) p.unavailable = [];
      if (typeof p.active !== "boolean") p.active = true;
    });
    return r;
  }

  function load() {
    return MRStore.read(PATH).then(normalise);
  }

  function save(r) {
    r.updated = new Date().toISOString();
    return MRStore.write(PATH, r).then(function (ok) { return ok ? r : r; });
  }

  function nextId(r) {
    var max = 0;
    r.residents.forEach(function (p) {
      var m = /^r-(\d+)$/.exec(p.id || "");
      if (m) max = Math.max(max, +m[1]);
    });
    return "r-" + String(max + 1).padStart(3, "0");
  }

  /* ---------- availability ----------------------------------------- */

  function isUnavailable(res, date) {
    var d = parseDate(date);
    return (res.unavailable || []).some(function (w) {
      if (!w.from && !w.to) return false;
      var from = w.from ? parseDate(w.from) : new Date(-8640000000000000);
      var to = w.to ? parseDate(w.to) : new Date(8640000000000000);
      return d >= from && d <= to;
    });
  }

  /* Days inside [from,to] that the resident was unavailable. Used so
     the equity view does not flag someone on an away rotation as
     neglected — without this the list fills with false positives and
     nobody reads it after week three. */
  function unavailableDaysBetween(res, from, to) {
    var a = parseDate(from), b = parseDate(to), n = 0;
    (res.unavailable || []).forEach(function (w) {
      var s = w.from ? parseDate(w.from) : a;
      var e = w.to ? parseDate(w.to) : b;
      if (s < a) s = a;
      if (e > b) e = b;
      if (e >= s) n += Math.round((e - s) / 86400000) + 1;
    });
    return n;
  }

  function levelMatches(res, role) {
    if (role === "pgy1_discussant") return res.level === "PGY-1";
    if (role === "senior_discussant") return res.level === "PGY-2" || res.level === "PGY-3";
    return true;
  }

  /* ---------- the log ---------------------------------------------- */

  function entriesFor(r, residentId, role) {
    return r.log.filter(function (e) {
      return e.resident_id === residentId && (!role || e.role === role);
    });
  }

  function countFor(r, residentId, role) {
    return entriesFor(r, residentId, role).length;
  }

  /* Most recent date this resident served `role`, or any discussant
     role when role is the string "discussant". null if never. */
  function lastServed(r, residentId, role) {
    var rows = r.log.filter(function (e) {
      if (e.resident_id !== residentId) return false;
      if (role === "discussant") return DISCUSSANT_ROLES.indexOf(e.role) !== -1;
      return !role || e.role === role;
    });
    if (!rows.length) return null;
    return rows.map(function (e) { return e.date; }).sort().pop();
  }

  function logEntry(r, entry) {
    r.log.push({
      date: entry.date,
      site: entry.site || "",
      resident_id: entry.resident_id,
      role: entry.role,
      feedback_sent: !!entry.feedback_sent
    });
    return r;
  }

  /* ---------- the draw pool ----------------------------------------- */

  function cycleFor(r, role) {
    if (!r.cycle[role]) r.cycle[role] = { drawn: [], benched: [] };
    var c = r.cycle[role];
    if (!Array.isArray(c.drawn)) c.drawn = [];
    if (!Array.isArray(c.benched)) c.benched = [];
    return c;
  }

  /* Everyone who could be drawn today: on the roster, active, the
     right level, and not away. Benching and the drawn cycle are
     applied on top of this by pool(). */
  function eligible(r, role, date) {
    return r.residents.filter(function (p) {
      return p.active && levelMatches(p, role) && !isUnavailable(p, date);
    });
  }

  /* The pool the wheel spins over.

     Weighted by neglect rather than uniform: among everyone still in
     the cycle, only those tied for the longest gap since they last
     held this role are candidates. Never-served outranks everyone.
     The wheel still spins over the whole eligible list, so it stays
     visibly random — it just stops the same three people carrying
     the year. */
  function pool(r, role, date) {
    var c = cycleFor(r, role);
    var all = eligible(r, role, date);
    var open = all.filter(function (p) { return c.benched.indexOf(p.id) === -1; });

    var remaining = open.filter(function (p) { return c.drawn.indexOf(p.id) === -1; });
    var refilled = false;
    if (!remaining.length && open.length) { remaining = open.slice(); refilled = true; }

    var candidates = neglected(r, remaining, role, date);

    return {
      eligible: all,        // everyone shown on the wheel
      open: open,           // minus the benched
      remaining: remaining, // minus those already drawn this cycle
      candidates: candidates,
      refilled: refilled
    };
  }

  /* Of `people`, those tied for the longest gap since serving `role`. */
  function neglected(r, people, role, date) {
    if (!people.length) return [];
    var scored = people.map(function (p) {
      var last = lastServed(r, p.id, role);
      return { p: p, gap: last === null ? Infinity : daysBetween(last, date) };
    });
    var max = scored.reduce(function (m, s) { return s.gap > m ? s.gap : m; }, -Infinity);
    return scored.filter(function (s) { return s.gap === max; }).map(function (s) { return s.p; });
  }

  /* Record a draw: log it, and mark the cycle so the exclusion
     survives a reload and travels to the other site.

     If everyone still in the pool has already had a turn, this draw
     is the one that refills it — clear the cycle first, or `drawn`
     grows without bound and every chip stays struck off for the rest
     of the year. */
  function recordDraw(r, role, residentId, date, site) {
    var c = cycleFor(r, role);
    var open = eligible(r, role, date).filter(function (p) {
      return c.benched.indexOf(p.id) === -1;
    });
    var exhausted = open.length > 0 && open.every(function (p) {
      return c.drawn.indexOf(p.id) !== -1;
    });
    if (exhausted) c.drawn = [];
    if (c.drawn.indexOf(residentId) === -1) c.drawn.push(residentId);
    logEntry(r, { date: date, site: site, resident_id: residentId, role: role });
    return r;
  }

  function resetCycle(r, role) {
    var c = cycleFor(r, role);
    c.drawn = [];
    return r;
  }

  function toggleBench(r, role, residentId) {
    var c = cycleFor(r, role);
    var i = c.benched.indexOf(residentId);
    if (i === -1) c.benched.push(residentId); else c.benched.splice(i, 1);
    return r;
  }

  /* ---------- year rollover ------------------------------------------
     1 July. Promote every level, archive the year's log, start fresh.
     Nobody should have to hand-edit JSON in July.
     ------------------------------------------------------------------ */

  function rollYear(r) {
    var prev = r.academic_year;
    var archive = {
      academic_year: prev,
      residents: JSON.parse(JSON.stringify(r.residents)),
      log: JSON.parse(JSON.stringify(r.log)),
      archived: new Date().toISOString()
    };

    var next = {};
    next["PGY-1"] = "PGY-2";
    next["PGY-2"] = "PGY-3";

    var graduated = [];
    r.residents.forEach(function (p) {
      if (p.level === "PGY-3") { p.active = false; p.graduated = true; graduated.push(p.name); }
      else if (next[p.level]) p.level = next[p.level];
      // an away rotation from last year is not an away rotation this year
      p.unavailable = [];
    });

    var startYear = +String(prev).split("-")[0] + 1;
    r.academic_year = startYear + "-" + (startYear + 1);
    r.log = [];
    r.cycle = {};

    return { roster: r, archive: archive, archivePath: "roster-" + prev + ".json", graduated: graduated };
  }

  global.MRRoster = {
    PATH: PATH,
    ROLES: ROLES,
    LEVELS: LEVELS,
    DISCUSSANT_ROLES: DISCUSSANT_ROLES,
    BLOCKS: BLOCKS,
    blockFor: blockFor,
    blank: blank,
    normalise: normalise,
    load: load,
    save: save,
    nextId: nextId,
    isUnavailable: isUnavailable,
    unavailableDaysBetween: unavailableDaysBetween,
    levelMatches: levelMatches,
    eligible: eligible,
    pool: pool,
    neglected: neglected,
    recordDraw: recordDraw,
    resetCycle: resetCycle,
    toggleBench: toggleBench,
    cycleFor: cycleFor,
    lastServed: lastServed,
    countFor: countFor,
    entriesFor: entriesFor,
    logEntry: logEntry,
    rollYear: rollYear,
    weeksSince: weeksSince,
    daysBetween: daysBetween,
    parseDate: parseDate,
    academicYearOf: academicYearOf,
    roleLabel: function (id) {
      var r = ROLES.filter(function (x) { return x.id === id; })[0];
      return r ? r.label : id;
    }
  };
})(window);
