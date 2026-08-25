/* ==================================================================
   MRRemote — an optional read-only source for the two files that
   carry names: roster.json and rotations.json.

   Why this exists. The data folder works, but it is per-machine: every
   browser has to pick it, and a co-chief on their own laptop has their
   own copy. A programme that wants one live answer to "who is on
   today" needs the roster to come from somewhere shared.

   Why it is NOT in this repo. This repository is public, and GitHub
   serves every committed file to anyone who asks. A password on the
   pages does not change that — the JSON would be its own URL. So the
   roster lives behind an endpoint that checks a key, and the pages
   stay public and empty, which is the only arrangement where "the
   site is public" and "the names are not" are both true.

   What this module will not do:
     - it never writes session data anywhere but the folder
     - it only ever fetches the two paths in PATHS
     - it never throws into a page; a dead endpoint degrades to
       whatever the folder has, exactly as an absent file does

   The endpoint URL and key are settings held on the device, not in
   this repo — see settings() below for where and why.
   ================================================================== */

(function (global) {
  "use strict";

  /* The only paths this module will ever serve. Session data, board
     notes and scorecards stay in the folder; a shared endpoint is for
     the roster, not for the room. */
  var PATHS = ["roster.json", "rotations.json"];

  /* Option A, chosen knowingly: with this set to the /exec URL, every
     visitor's wheel loads names and levels with nothing configured —
     the endpoint serves that subset to a keyless GET only when its
     owner has also set MR_PUBLIC_ROSTER in Script Properties, so
     either side can switch it off alone. The rota, the draws, leave
     windows and every write stay behind the key.

     Tests override via global.MR_PUBLIC_ENDPOINT before this loads. */
  var PUBLIC_ENDPOINT = (global.MR_PUBLIC_ENDPOINT !== undefined)
    ? global.MR_PUBLIC_ENDPOINT
    : "";

  var STORE_KEY = "sage-mr-remote";

  var state = {
    endpoint: "",
    key: "",
    remember: false,
    loaded: false,     // settings have been read off the device
    pending: null,     // memoised fetch promise
    result: null,      // last { ok, data, warnings, error }
    tried: false
  };

  var listeners = [];

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(api.status()); } catch (e) { /* a bad listener must not break a page */ }
    });
  }

  /* ---------- settings: on the device, never in the repo ------------

     Two places, deliberately:

       sessionStorage — the default. The key is gone when the tab
       closes, which is the right default for a shared workroom
       machine that half the residency signs into.

       localStorage — only when the user ticks "remember on this
       device". Their own laptop, their call.

     The module-level ban on localStorage in this project is about
     DATA: nothing that matters may live there, because it is invisible
     to the other site and to the folder. A key the user typed and can
     retype is not data, and is never written anywhere else.
     ------------------------------------------------------------------ */

  function readStore(store) {
    try {
      var raw = store.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function loadSettings() {
    if (state.loaded) return;
    state.loaded = true;
    var s = readStore(global.localStorage) ;
    var remembered = !!s;
    if (!s) s = readStore(global.sessionStorage);
    if (!s) return;
    state.endpoint = typeof s.endpoint === "string" ? s.endpoint : "";
    state.key = typeof s.key === "string" ? s.key : "";
    state.remember = remembered;
  }

  function persist() {
    var payload = JSON.stringify({ endpoint: state.endpoint, key: state.key });
    try { global.sessionStorage.removeItem(STORE_KEY); } catch (e) { /* private mode */ }
    try { global.localStorage.removeItem(STORE_KEY); } catch (e) { /* private mode */ }
    if (!state.endpoint && !state.key) return;
    try {
      (state.remember ? global.localStorage : global.sessionStorage).setItem(STORE_KEY, payload);
    } catch (e) { /* storage refused; the settings still work for this page */ }
  }

  function settings() {
    loadSettings();
    return { endpoint: state.endpoint, key: state.key, remember: state.remember };
  }

  /* An endpoint must be https. A page served over https cannot fetch
     http, and failing here with a clear message beats a mixed-content
     error in the console that nobody reads. */
  function validate(url) {
    if (!url) return "";
    var u;
    try { u = new URL(url); } catch (e) { return "That is not a URL."; }
    if (u.protocol !== "https:") return "The endpoint must start with https://";
    return "";
  }

  function setSettings(next) {
    loadSettings();
    next = next || {};
    if (typeof next.endpoint === "string") state.endpoint = next.endpoint.trim();
    if (typeof next.key === "string") state.key = next.key.trim();
    if (typeof next.remember === "boolean") state.remember = next.remember;
    persist();
    reload();
    emit();
    return settings();
  }

  function forget() {
    state.endpoint = "";
    state.key = "";
    state.remember = false;
    persist();
    reload();
    emit();
  }

  function configured() {
    loadSettings();
    return !!(state.endpoint && state.key);
  }

  /* ---------- fetching ----------------------------------------------

     One request per page load, memoised. Every tool that wants the
     roster asks the store, the store asks here, and they all share the
     single answer rather than each hitting the endpoint.
     ------------------------------------------------------------------ */

  function reload() {
    state.pending = null;
    state.result = null;
    state.tried = false;
  }

  function fetchAll() {
    if (state.pending) return state.pending;

    var url;
    if (configured()) {
      url = state.endpoint +
        (state.endpoint.indexOf("?") === -1 ? "?" : "&") +
        "key=" + encodeURIComponent(state.key);
    } else if (PUBLIC_ENDPOINT) {
      url = PUBLIC_ENDPOINT;              /* keyless: the public subset */
    } else {
      return Promise.resolve(null);
    }

    state.pending = global.fetch(url, { method: "GET", credentials: "omit" })
      .then(function (res) {
        if (!res.ok) throw new Error("The endpoint answered " + res.status + ".");
        return res.json();
      })
      .then(function (body) {
        if (!body || typeof body !== "object") throw new Error("The endpoint did not return JSON.");
        if (body.status === "denied") {
          return finish(configured()
            ? { ok: false, denied: true, error: "That key was not accepted." }
            : { ok: false, error: "The site's built-in roster is switched off at the endpoint." });
        }
        if (body.status !== "ok") {
          return finish({ ok: false, error: body.message || "The endpoint reported a problem." });
        }
        var roster = body.roster || null;
        var rotations = body.rotations || null;
        return finish({
          ok: true,
          public: !!body.public,
          data: { "roster.json": roster, "rotations.json": rotations },
          counts: {
            residents: roster && Array.isArray(roster.residents) ? roster.residents.length : 0,
            days: rotations && rotations.days ? Object.keys(rotations.days).length : 0
          },
          warnings: Array.isArray(body.warnings) ? body.warnings : [],
          generated: body.generated || ""
        });
      })
      .catch(function (err) {
        /* A blocked or unreachable endpoint is not an error the user
           can act on mid-session. Record it, surface it in the bar,
           and let the folder answer instead. */
        return finish({ ok: false, error: (err && err.message) || "Could not reach the endpoint." });
      });

    return state.pending;
  }

  function finish(result) {
    state.result = result;
    state.tried = true;
    emit();
    return result;
  }

  /* The store calls this. Returns null for anything not remote-backed,
     for an endpoint that is not configured, and for a failure — null
     means "I have nothing", which is what an absent file means too. */
  function get(path) {
    if (PATHS.indexOf(path) === -1) return Promise.resolve(null);
    if (!configured() && !PUBLIC_ENDPOINT) return Promise.resolve(null);
    return fetchAll().then(function (r) {
      if (!r || !r.ok || !r.data) return null;
      return r.data[path] || null;
    });
  }

  /* ---------- publishing --------------------------------------------

     Seeds the sheet from the folder. POSTed as text/plain on purpose:
     Apps Script does not answer the CORS preflight that a JSON
     content-type would trigger.
     ------------------------------------------------------------------ */

  function publish(payload) {
    if (!configured()) {
      return Promise.resolve({ ok: false, error: "No endpoint and key are set." });
    }
    var body = JSON.stringify({
      key: state.key,
      roster: payload && payload.roster ? payload.roster : null,
      rotations: payload && payload.rotations ? payload.rotations : null
    });
    return global.fetch(state.endpoint, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: body
    })
      .then(function (res) {
        if (!res.ok) throw new Error("The endpoint answered " + res.status + ".");
        return res.json();
      })
      .then(function (r) {
        if (!r || r.status !== "ok") {
          return { ok: false, error: (r && (r.message || (r.status === "denied" ? "That key was not accepted." : ""))) || "The endpoint refused the publish." };
        }
        reload();
        emit();
        return { ok: true, wrote: r.wrote || {}, warnings: Array.isArray(r.warnings) ? r.warnings : [] };
      })
      .catch(function (err) {
        return { ok: false, error: (err && err.message) || "Could not reach the endpoint." };
      });
  }

  /* ---------- recording today's discussants ---------------------------

     The only write that comes from the room rather than from a data
     folder, and the point of it: a chief on a borrowed laptop can leave
     a record without connecting anything.

     Confirming a date replaces that date's rows at the far end, so
     pressing it twice is safe and a re-spin corrects rather than
     duplicates.
     ------------------------------------------------------------------- */

  function confirmDraw(session) {
    if (!configured()) {
      return Promise.resolve({ ok: false, error: "No shared roster is set up on this browser." });
    }
    var entries = (session && session.entries ? session.entries : []).filter(function (e) {
      return e && (e.name || e.resident_id);
    });
    if (!entries.length) {
      return Promise.resolve({ ok: false, error: "There is nobody to record." });
    }

    return global.fetch(state.endpoint, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        key: state.key,
        action: "draw",
        date: session.date,
        site: session.site || "",
        presenting: session.presenting || "",
        entries: entries
      })
    })
      .then(function (res) {
        if (!res.ok) throw new Error("The endpoint answered " + res.status + ".");
        return res.json();
      })
      .then(function (r) {
        if (!r || r.status !== "ok") {
          return {
            ok: false,
            error: (r && (r.message || (r.status === "denied" ? "That key was not accepted." : ""))) ||
              "The endpoint refused it."
          };
        }
        reload();                       /* the next read should see it */
        return { ok: true, wrote: r.wrote || 0, replaced: r.replaced || 0, date: r.date || session.date };
      })
      .catch(function (err) {
        return { ok: false, error: (err && err.message) || "Could not reach the endpoint." };
      });
  }

  /* ---------- the shared document store -------------------------------

     The permanent artifacts, for a device that has no data folder and
     cannot get one: a phone, an iPad, a borrowed laptop. The folder is
     still the store where there is one — these are the same documents,
     kept somewhere every device can reach.

     Only these three directories, and the endpoint refuses anything
     else independently. working/ and manifests/ are identified and
     swept at seven days, and a central copy would outlive the sweep;
     working-board.json writes every few seconds during a session and
     is crash recovery for the machine driving the board, not something
     anyone else reads.
     ------------------------------------------------------------------- */

  var DOC_DIRS = ["board-archive/", "sessions/", "casebank/"];

  function docBacked(path) {
    var p = String(path || "");
    for (var i = 0; i < DOC_DIRS.length; i++) {
      if (p.indexOf(DOC_DIRS[i]) !== 0) continue;
      var rest = p.slice(DOC_DIRS[i].length);
      return rest.length > 0 && rest.indexOf("/") === -1;     // dir/name.json, no deeper
    }
    return false;
  }

  function docDirBacked(dir) {
    var d = String(dir || "").replace(/\/*$/, "/");
    return DOC_DIRS.indexOf(d) !== -1;
  }

  function docAction(action, extra) {
    if (!configured()) return Promise.resolve(null);
    var body = { key: state.key, action: action };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });

    return global.fetch(state.endpoint, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        if (!res.ok) throw new Error("The endpoint answered " + res.status + ".");
        return res.json();
      })
      .then(function (r) {
        if (!r || r.status !== "ok") {
          throw new Error((r && (r.message || (r.status === "denied" ? "That key was not accepted." : ""))) ||
            "The endpoint refused it.");
        }
        return r;
      });
  }

  /* Reads are best-effort: a document that cannot be fetched is the
     same as one that is not there, because the caller's next move is
     identical either way. Writes are not — see docPut. */
  function docGet(path) {
    if (!docBacked(path) || !configured()) return Promise.resolve(null);
    return docAction("docget", { path: path })
      /* read() promises null for anything absent. An endpoint that
         answers ok without a data field would otherwise hand back
         undefined, and a caller testing === null would miss it. */
      .then(function (r) { return (r && r.data !== undefined) ? r.data : null; })
      .catch(function () { return null; });
  }

  /* A failed write must reach the caller. Losing a scorecard quietly is
     the one outcome worth being noisy about. */
  function docPut(path, data) {
    if (!docBacked(path) || !configured()) return Promise.resolve(false);
    return docAction("docput", { path: path, data: data }).then(function () { return true; });
  }

  function docList(dir) {
    if (!docDirBacked(dir) || !configured()) return Promise.resolve([]);
    return docAction("doclist", { dir: String(dir).replace(/\/*$/, "") })
      .then(function (r) { return (r && r.names) || []; })
      .catch(function () { return []; });
  }

  function docRemove(path) {
    if (!docBacked(path) || !configured()) return Promise.resolve(false);
    return docAction("docdel", { path: path })
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  /* The board as a PDF, made by Google and kept beside the archives.
     A failure reaches the caller: the point of this is that the board
     is filed without anybody choosing a folder, so silently not filing
     it is the one outcome that would be worse than the old dialog. */
  function renderPdf(name, html) {
    if (!configured()) {
      return Promise.reject(new Error("No shared store is set up on this browser."));
    }
    return docAction("pdf", { name: name, html: html })
      .then(function (r) { return { name: r.name, url: r.url, bytes: r.bytes }; });
  }

  /* ---------- status for the bar -------------------------------------- */

  function status() {
    loadSettings();
    return {
      configured: configured(),
      endpoint: state.endpoint,
      remember: state.remember,
      tried: state.tried,
      ok: !!(state.result && state.result.ok),
      denied: !!(state.result && state.result.denied),
      public: !!(state.result && state.result.public),
      sourced: configured() || !!PUBLIC_ENDPOINT,
      error: state.result && !state.result.ok ? state.result.error : "",
      warnings: (state.result && state.result.warnings) || [],
      counts: (state.result && state.result.counts) || { residents: 0, days: 0 },
      generated: (state.result && state.result.generated) || ""
    };
  }

  /* Reached the endpoint, and there is nothing in it yet. Worth its own
     answer: it is the normal state between deploying the script and
     publishing, and reporting it as warnings reads as a fault. */
  function isEmpty() {
    var s = status();
    return s.ok && !s.counts.residents && !s.counts.days;
  }

  /* A short line for the shared bar. Null when there is nothing to say. */
  function summary() {
    var s = status();
    if (!s.configured && !PUBLIC_ENDPOINT) return null;
    if (!s.tried) return { kind: "wait", text: "Checking the shared roster…" };
    if (s.ok) {
      if (isEmpty()) return { kind: "warn", text: "Shared roster: sheet is empty" };
      if (s.public) return { kind: "ok", text: "Shared roster (view only)" };
      var n = s.warnings.length;
      return {
        kind: n ? "warn" : "ok",
        text: n ? "Shared roster loaded, " + n + " name" + (n === 1 ? "" : "s") + " unmatched"
                : "Shared roster loaded"
      };
    }
    return { kind: "err", text: s.denied ? "Shared roster: key refused" : "Shared roster unavailable" };
  }

  var api = {
    PATHS: PATHS,
    settings: settings,
    setSettings: setSettings,
    forget: forget,
    configured: configured,
    validate: validate,
    fetchAll: fetchAll,
    reload: reload,
    get: get,
    publish: publish,
    confirmDraw: confirmDraw,
    docBacked: docBacked,
    docDirBacked: docDirBacked,
    docGet: docGet,
    docPut: docPut,
    docList: docList,
    docRemove: docRemove,
    renderPdf: renderPdf,
    DOC_DIRS: DOC_DIRS,
    status: status,
    isEmpty: isEmpty,
    summary: summary,
    onChange: function (fn) { listeners.push(fn); return fn; }
  };

  global.MRRemote = api;
})(window);
