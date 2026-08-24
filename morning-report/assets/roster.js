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
  var ROTATIONS_PATH = "rotations.json";

  var ROLES = [
    { id: "presenter",         label: "Presenter" },
    { id: "scribe",            label: "Scribe" },
    { id: "pgy1_discussant",   label: "PGY-1 discussant" },
    { id: "senior_discussant", label: "Senior discussant" },
    { id: "facilitator",       label: "Facilitator" }
  ];

  var DISCUSSANT_ROLES = ["pgy1_discussant", "senior_discussant"];
  var LEVELS = ["PGY-1", "PGY-2", "PGY-3"];

  /* ---------- the rotation ------------------------------------------

     rotations.json says who is on service each day, and which tasks make
     up each site's ward team. On a presenting day that site's ward team
     is off the wheels — they are the ones presenting — and everyone else
     on service is a candidate.

     It is entirely optional. With no file, or on a date the file does not
     cover, nothing is filtered and the whole roster is eligible, which is
     how this behaved before rotations existed.
     ------------------------------------------------------------------- */

  var rotations = null;

  function setRotations(data) {
    rotations = (data && data.days) ? data : null;
    return rotations;
  }

  function loadRotations() {
    return MRStore.read(ROTATIONS_PATH).then(setRotations);
  }

  function hasRotations() { return !!rotations; }

  function rotationMeta() { return rotations; }

  function siteList() {
    if (!rotations || !rotations.sites) return [];
    return Object.keys(rotations.sites).map(function (id) {
      return { id: id, label: rotations.sites[id].label || id };
    });
  }

  function rotationDay(date) {
    if (!rotations || !rotations.days) return null;
    return rotations.days[date] || null;
  }

  /* The people the presenting site is fielding — off the wheels. */
  function presentingTeam(date, site) {
    var day = rotationDay(date);
    if (!day || !site || !rotations.sites || !rotations.sites[site]) return [];
    var out = [];
    (rotations.sites[site].ward || []).forEach(function (task) {
      (day[task] || []).forEach(function (id) {
        if (out.indexOf(id) === -1) out.push(id);
      });
    });
    return out;
  }

  /* Everyone on service that day who is not on the presenting ward team.
     null when the rotation says nothing about this date. */
  function onDuty(date, site) {
    var day = rotationDay(date);
    if (!day) return null;
    var ward = presentingTeam(date, site);
    var out = [];
    Object.keys(day).forEach(function (task) {
      (day[task] || []).forEach(function (id) {
        if (ward.indexOf(id) === -1 && out.indexOf(id) === -1) out.push(id);
      });
    });
    return out;
  }

  /* Which tasks a person is on that day — for a chip tooltip. */
  function tasksOn(date, residentId) {
    var day = rotationDay(date);
    if (!day) return [];
    return Object.keys(day).filter(function (task) {
      return (day[task] || []).indexOf(residentId) !== -1;
    });
  }

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

  /* What to show where space is tight — a wheel wedge, a pool chip.
     A real roster carries four-part names, and two people who share a
     given name are common. Truncated to fit a wedge, both can render as
     the same string — which is worse than useless on a wheel whose whole
     job is to name one person. `short` is optional and falls back to the
     full name, so a roster without one still works. */
  function displayName(res) {
    if (!res) return "";
    var s = (res.short || "").trim();
    return s || res.name || "";
  }

  /* How a residency list is always ordered: by surname. `sort_name` is
     optional and holds "Surname, Given"; without it we fall back to the
     displayed name, which sorts by given name — better than nothing but
     not what anyone scanning a roster expects. */
  function sortKey(res) {
    if (!res) return "";
    return ((res.sort_name || res.name || "") + "").toLowerCase();
  }

  /* First given name plus the surname's initial. Used to propose a
     short name in the editor; the user can always overrule it. */
  function suggestShort(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return parts[0] || "";
    var first = parts[0];
    var last = parts[parts.length - 1].replace(/^-+/, "");
    return first + " " + (last.charAt(0) || "").toUpperCase() + ".";
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
      if (typeof p.short !== "string") p.short = "";
      if (typeof p.sort_name !== "string") p.sort_name = "";
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
  function eligible(r, role, date, opts) {
    var duty = onDuty(date, (opts || {}).site);
    return r.residents.filter(function (p) {
      if (!p.active || !levelMatches(p, role) || isUnavailable(p, date)) return false;
      if (duty && duty.indexOf(p.id) === -1) return false;
      return true;
    });
  }

  /* The pool the wheel spins over.

     Weighted by neglect rather than uniform: among everyone still in
     the cycle, only those tied for the longest gap since they last
     held this role are candidates. Never-served outranks everyone.
     The wheel still spins over the whole eligible list, so it stays
     visibly random — it just stops the same three people carrying
     the year. */
  function pool(r, role, date, opts) {
    var c = cycleFor(r, role);
    var all = eligible(r, role, date, opts);
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
      refilled: refilled,
      rotationApplied: !!onDuty(date, (opts || {}).site)
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
  function recordDraw(r, role, residentId, date, site, opts) {
    var c = cycleFor(r, role);
    var open = eligible(r, role, date, opts).filter(function (p) {
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

  /* ---------- the equity view ----------------------------------------

     Counting turns is a scheduling question. Scoring turns is an
     evaluation question. Only the first is computed here, and nothing
     below reaches for sessions/ — there is deliberately no way to join
     a name to a score.
     -------------------------------------------------------------------- */

  /* When a resident first became available to be drawn. Defaults to
     the start of the academic year, so "never" does not fire on
     somebody who joined three weeks ago. */
  function startedOn(r, res) {
    if (res.started) return res.started;
    var y = +String(r.academic_year || "").split("-")[0];
    return (y ? y : parseDate(MRStore.today()).getFullYear()) + "-07-01";
  }

  /* Weeks since `from`, with days the resident was away taken out, so
     an away rotation does not read as neglect. */
  function activeWeeksSince(res, from, today) {
    var to = today || MRStore.today();
    if (!from || parseDate(from) > parseDate(to)) return 0;
    var days = daysBetween(from, to);
    return Math.max(0, days - unavailableDaysBetween(res, from, to)) / 7;
  }

  function median(nums) {
    if (!nums.length) return 0;
    var a = nums.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /* One row per active resident. */
  function equity(r, today) {
    var when = today || MRStore.today();
    var overdueWeeks = (r.settings && r.settings.overdue_weeks) || 8;
    var active = r.residents.filter(function (p) { return p.active; });

    var rows = active.map(function (p) {
      var counts = {};
      ROLES.forEach(function (role) { counts[role.id] = countFor(r, p.id, role.id); });

      var entries = entriesFor(r, p.id);
      var total = entries.length;
      var feedback = entries.filter(function (e) { return e.feedback_sent; }).length;

      var lastDisc = lastServed(r, p.id, "discussant");
      var since = startedOn(r, p);

      return {
        id: p.id,
        name: p.name,
        display: displayName(p),
        sort_key: sortKey(p),
        level: p.level,
        counts: counts,
        total: total,
        feedback_sent: feedback,
        feedback_gap: total - feedback,
        last_discussant: lastDisc,
        weeks_since: lastDisc ? weeksSince(lastDisc, when) : null,
        active_weeks_since: activeWeeksSince(p, lastDisc || since, when),
        weeks_on_roster: activeWeeksSince(p, since, when),
        away_now: isUnavailable(p, when),
        flags: []
      };
    });

    /* over-drawn is relative to the resident's own level */
    var byLevel = {};
    rows.forEach(function (row) { (byLevel[row.level] = byLevel[row.level] || []).push(row.total); });
    var med = {};
    Object.keys(byLevel).forEach(function (lv) { med[lv] = median(byLevel[lv]); });

    rows.forEach(function (row) {
      if (row.total === 0 && row.weeks_on_roster > overdueWeeks) {
        row.flags.push({ id: "never", label: "Never", why:
          "Active " + Math.round(row.weeks_on_roster) + " weeks with no logged turn at all." });
      } else if (row.active_weeks_since > overdueWeeks) {
        row.flags.push({ id: "overdue", label: "Overdue", why:
          "No discussant role in " + Math.round(row.active_weeks_since) +
          " weeks, not counting time away." });
      }
      if (med[row.level] > 0 && row.total > 2 * med[row.level]) {
        row.flags.push({ id: "over", label: "Over-drawn", why:
          row.total + " turns against a median of " + med[row.level] + " for " + row.level + "." });
      }
      if (row.feedback_gap > 0) {
        row.flags.push({ id: "gap", label: "Feedback gap", why:
          row.feedback_gap + " of " + row.total + " turns with no feedback recorded as sent." });
      }
    });

    /* The default sort, and the whole point of the table: whoever has
       gone longest without a discussant role is at the top, and that
       is who you draw next. */
    rows.sort(function (a, b) {
      if (a.active_weeks_since !== b.active_weeks_since) return b.active_weeks_since - a.active_weeks_since;
      return a.sort_key.localeCompare(b.sort_key);
    });

    return { rows: rows, medians: med, overdue_weeks: overdueWeeks };
  }

  function equityCsv(r, today) {
    var e = equity(r, today);
    var head = ["Name", "Level"]
      .concat(ROLES.map(function (x) { return x.label; }))
      .concat(["Total", "Last discussant role", "Weeks since", "Weeks since (excl. away)",
               "Feedback sent", "Feedback gap", "Away today", "Flags"]);
    var lines = [head];
    e.rows.forEach(function (row) {
      lines.push([row.name, row.level]
        .concat(ROLES.map(function (x) { return row.counts[x.id]; }))
        .concat([
          row.total,
          row.last_discussant || "never",
          row.weeks_since === null ? "" : row.weeks_since.toFixed(1),
          row.active_weeks_since.toFixed(1),
          row.feedback_sent,
          row.feedback_gap,
          row.away_now ? "yes" : "no",
          row.flags.map(function (f) { return f.label; }).join("; ")
        ]));
    });
    return lines.map(function (cols) {
      return cols.map(function (c) {
        var v = String(c == null ? "" : c);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(",");
    }).join("\n") + "\n";
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
    equity: equity,
    equityCsv: equityCsv,
    activeWeeksSince: activeWeeksSince,
    startedOn: startedOn,
    median: median,
    weeksSince: weeksSince,
    daysBetween: daysBetween,
    parseDate: parseDate,
    academicYearOf: academicYearOf,
    displayName: displayName,
    suggestShort: suggestShort,
    sortKey: sortKey,
    ROTATIONS_PATH: ROTATIONS_PATH,
    loadRotations: loadRotations,
    setRotations: setRotations,
    hasRotations: hasRotations,
    rotationMeta: rotationMeta,
    rotationDay: rotationDay,
    siteList: siteList,
    presentingTeam: presentingTeam,
    onDuty: onDuty,
    tasksOn: tasksOn,
    roleLabel: function (id) {
      var r = ROLES.filter(function (x) { return x.id === id; })[0];
      return r ? r.label : id;
    }
  };
})(window);
