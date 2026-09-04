/* ==================================================================
   MRContent — content/roles.json, loaded once and cached.

   Everything block-dependent is resolved here rather than written
   down twice: the senior's block length, the intern's first pass
   (which absorbs whatever the senior gives up, so the three called
   handoffs at 0:07, 0:16 and 0:22 hold all year), and the added ask
   the intern owes this quarter.

   Change a timing in roles.json and the role page, the print view
   and the run-of-show card all follow. That is the whole point of
   the file.
   ================================================================== */

(function (global) {
  "use strict";

  var data = null;
  var pending = null;

  function url() {
    return MRStore.base() + "content/roles.json";
  }

  function load() {
    if (data) return Promise.resolve(data);
    if (pending) return pending;
    pending = fetch(url(), { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (j) { data = j; return j; })
      .catch(function (err) {
        MRStore.notify("err",
          "Could not load the role card content (content/roles.json) — " +
          (err && err.message ? err.message : err) +
          ". Timings and card text will be missing. Serve this page over http rather than opening the file directly.", true);
        data = { roles: [], blocks: [], run_of_show: [], strip: [] };
        return data;
      });
    return pending;
  }

  function get() { return data; }

  function blocks() { return (data && data.blocks) || []; }

  function frameworks() { return (data && data.frameworks) || []; }

  function block(id) {
    var b = blocks().filter(function (x) { return x.id === id; })[0];
    return b || null;
  }

  function blockForDate(date) {
    return block(MRRoster.blockFor(date || MRStore.today()).id);
  }

  function blockAsk(id) {
    var b = block(id);
    return b ? (b.ask || "") : "";
  }

  function blockSummary(id) {
    var b = block(id);
    return b ? (b.summary || "") : "";
  }

  /* The senior's block for a given quarter, and the baseline it is
     measured against. */
  function seniorMinutes(id) {
    var b = block(id);
    return b && typeof b.senior_minutes === "number" ? b.senior_minutes : baselineSenior();
  }

  function row(key) {
    return ((data && data.run_of_show) || []).filter(function (r) {
      return r.minutes_from_block && key === "senior" ||
             r.absorbs_senior_slack && key === "pgy1";
    })[0] || null;
  }

  function baselineSenior() {
    var r = row("senior");
    return r ? r.minutes : 5;
  }

  function baselinePgy1() {
    var r = row("pgy1");
    return r ? r.minutes : 4;
  }

  /* Minutes the intern's first pass runs in this block: the baseline
     plus whatever the senior gave up. */
  function pgy1Minutes(id) {
    return baselinePgy1() + (baselineSenior() - seniorMinutes(id));
  }

  function minutesFor(key, blockId) {
    if (key === "senior") return seniorMinutes(blockId);
    if (key === "pgy1") return pgy1Minutes(blockId);
    var seg = ((data && data.run_of_show) || []).filter(function (r) { return r.segment === key; })[0];
    return seg ? seg.minutes : null;
  }

  function fmt(mins) {
    return Math.floor(mins / 60) + ":" + String(mins % 60).padStart(2, "0");
  }

  /* The run of show with this block's durations applied and the start
     times recomputed, so the table is always internally consistent. */
  function runOfShow(blockId) {
    var rows = ((data && data.run_of_show) || []).map(function (r) {
      return {
        segment: r.segment, what: r.what, driver: r.driver,
        minutes: r.minutes_from_block ? seniorMinutes(blockId)
               : r.absorbs_senior_slack ? pgy1Minutes(blockId)
               : r.minutes,
        varies: !!(r.minutes_from_block || r.absorbs_senior_slack)
      };
    });
    var t = 0;
    rows.forEach(function (r) { r.start = t; r.startLabel = fmt(t); t += r.minutes; });
    return rows;
  }

  /* The 25-minute strip, with the two block-dependent segments moved
     so a role card's highlight lands in the right place. */
  function strip(blockId) {
    var ros = runOfShow(blockId);
    var byKey = {
      hook: "The hook", history: "History & exam", pgy1: "First pass",
      senior: "Second pass", labs: "Labs & imaging", converge: "Converge", reveal: "Reveal"
    };
    return ((data && data.strip) || []).map(function (s) {
      var seg = ros.filter(function (r) { return r.segment === byKey[s.key]; })[0];
      return {
        key: s.key,
        label: s.label,
        start: seg ? seg.start : s.start,
        end: seg ? seg.start + seg.minutes : s.end
      };
    });
  }

  function role(slug) {
    return ((data && data.roles) || []).filter(function (r) { return r.slug === slug; })[0] || null;
  }

  /* The chip on a role card and on the draw page: "0:11 — 5 min". */
  function slotLabel(key, blockId) {
    var ros = runOfShow(blockId);
    var name = key === "pgy1" ? "First pass" : key === "senior" ? "Second pass" : null;
    if (!name) return "";
    var seg = ros.filter(function (r) { return r.segment === name; })[0];
    if (!seg) return "";
    return fmt(seg.start) + " — " + seg.minutes + " min";
  }

  /* A role's tagline, resolved for the block when it varies. */
  function taglineFor(slug, blockId) {
    var r = role(slug);
    if (!r) return "";
    if (r.minutes_from_block) return slotLabel("senior", blockId);
    if (r.block_aware) return slotLabel("pgy1", blockId);
    return r.tagline || "";
  }

  global.MRContent = {
    load: load,
    get: get,
    role: role,
    blocks: blocks,
    frameworks: frameworks,
    block: block,
    blockForDate: blockForDate,
    blockAsk: blockAsk,
    blockSummary: blockSummary,
    seniorMinutes: seniorMinutes,
    pgy1Minutes: pgy1Minutes,
    minutesFor: minutesFor,
    runOfShow: runOfShow,
    strip: strip,
    slotLabel: slotLabel,
    taglineFor: taglineFor,
    fmt: fmt
  };
})(window);
