/* ==================================================================
   MRStore — the one way anything under /morning-report/ touches data.
   No tool calls the File System Access API directly.

   The user picks a data folder once. The handle is kept in IndexedDB
   so it survives a reload. The DATA never lives in the browser — it
   lives in the folder, which is the point: put the folder on OneDrive
   and both sites share state with no server.

   localStorage is deliberately not used for anything that matters.
   It is per-browser, per-device, and invisible to the other site.

   Chrome and Edge have showDirectoryPicker. Everything else falls
   back to explicit Download JSON / Load JSON, and the bar says so.
   ================================================================== */

(function (global) {
  "use strict";

  var IDB_NAME = "sage-morning-report";
  var IDB_STORE = "handles";
  var IDB_KEY = "dataDir";

  var state = {
    mode: null,        // "fsa" | "fallback"
    dir: null,         // FileSystemDirectoryHandle
    name: null,        // folder name for the bar
    ready: false,      // connected and writable
    cache: {}          // fallback mode only: path -> object
  };

  var listeners = [];

  /* ---------- IndexedDB: the handle, not the data ------------------ */

  function idb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbPut(key, val) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(val, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readonly");
        var r = tx.objectStore(IDB_STORE).get(key);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function idbDel(key) {
    return idb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    });
  }

  /* ---------- alerts: a failed write must say so loudly ------------ */

  function alertHost() {
    var host = document.getElementById("mr-alerts");
    if (!host) {
      host = document.createElement("div");
      host.id = "mr-alerts";
      host.className = "mr-alerts";
      document.body.insertBefore(host, document.body.firstChild);
    }
    return host;
  }

  function notify(kind, msg, sticky) {
    var host = alertHost();
    var el = document.createElement("div");
    el.className = "mr-alert " + kind;
    var m = document.createElement("div");
    m.className = "msg";
    m.textContent = msg;
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = "Dismiss";
    b.addEventListener("click", function () { el.remove(); });
    el.appendChild(m);
    el.appendChild(b);
    host.appendChild(el);
    if (!sticky) setTimeout(function () { el.remove(); }, 6000);
    return el;
  }

  function fail(what, err) {
    var detail = err && err.message ? err.message : String(err || "unknown error");
    notify("err", what + " — " + detail + ". Nothing was saved. Fix this before you keep going.", true);
    console.error(what, err);
  }

  /* ---------- path helpers ----------------------------------------- */

  function parts(path) {
    return String(path).split("/").filter(Boolean);
  }

  function dirFor(path, create) {
    var p = parts(path);
    p.pop();
    var h = Promise.resolve(state.dir);
    p.forEach(function (seg) {
      h = h.then(function (d) { return d.getDirectoryHandle(seg, { create: !!create }); });
    });
    return h;
  }

  function leaf(path) {
    var p = parts(path);
    return p[p.length - 1];
  }

  /* ---------- connection -------------------------------------------- */

  var supported = typeof global.showDirectoryPicker === "function";

  function emit() {
    listeners.forEach(function (fn) { try { fn(api.status()); } catch (e) { /* a bad listener must not break the store */ } });
    renderBars();
  }

  function verify(handle, prompt) {
    var opts = { mode: "readwrite" };
    return handle.queryPermission(opts).then(function (p) {
      if (p === "granted") return true;
      if (!prompt) return false;
      return handle.requestPermission(opts).then(function (r) { return r === "granted"; });
    });
  }

  function connect() {
    if (!supported) {
      state.mode = "fallback";
      emit();
      notify("warn",
        "This browser has no folder access. Use Chrome or Edge for the shared folder, " +
        "or work with Download JSON / Load JSON — nothing is saved automatically.", true);
      return Promise.resolve(false);
    }
    return global.showDirectoryPicker({ id: "sage-mr-data", mode: "readwrite", startIn: "documents" })
      .then(function (handle) {
        return verify(handle, true).then(function (ok) {
          if (!ok) { notify("err", "Read-write permission was declined, so nothing can be saved.", true); return false; }
          state.dir = handle;
          state.name = handle.name;
          state.mode = "fsa";
          state.ready = true;
          return idbPut(IDB_KEY, handle).catch(function () {
            notify("warn", "Connected, but this browser would not remember the folder — you will have to pick it again after a reload.");
          }).then(function () { emit(); return true; });
        });
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return false;   // user closed the picker
        fail("Could not open the data folder", err);
        return false;
      });
  }

  function disconnect() {
    state.dir = null; state.name = null; state.ready = false;
    state.mode = supported ? null : "fallback";
    return idbDel(IDB_KEY).then(emit);
  }

  /* Restore on load. Never prompts — a prompt outside a user gesture
     is rejected by the browser, so the bar offers a Reconnect button. */
  function restore() {
    if (!supported) { state.mode = "fallback"; emit(); return Promise.resolve(false); }
    return idbGet(IDB_KEY).then(function (handle) {
      if (!handle) { emit(); return false; }
      state.dir = handle;
      state.name = handle.name;
      state.mode = "fsa";
      return verify(handle, false).then(function (ok) {
        state.ready = ok;
        emit();
        return ok;
      });
    }).catch(function () { emit(); return false; });
  }

  function reconnect() {
    if (!state.dir) return connect();
    return verify(state.dir, true).then(function (ok) {
      state.ready = ok;
      emit();
      if (!ok) notify("err", "Permission was not granted, so nothing can be saved.", true);
      return ok;
    }).catch(function (err) { fail("Could not re-open the data folder", err); return false; });
  }

  /* ---------- read / write / list / remove --------------------------- */

  /* The optional shared endpoint, consulted only where the folder has
     no answer. MRRemote decides which paths it will serve — the store
     does not need to know, and asks about every path it cannot find.

     The order matters and is deliberate: the folder wins. Someone who
     has connected a folder is holding the authoritative copy for their
     own site, and a stale endpoint must never quietly overwrite what
     they can see in front of them. */
  function remoteRead(path) {
    if (!global.MRRemote) return Promise.resolve(null);
    return global.MRRemote.get(path).catch(function () { return null; });
  }

  function read(path) {
    if (state.mode === "fallback" || !state.ready) {
      if (Object.prototype.hasOwnProperty.call(state.cache, path)) {
        return Promise.resolve(state.cache[path]);
      }
      /* No folder at all: the endpoint is the only source there is. */
      return remoteRead(path);
    }
    return dirFor(path, false)
      .then(function (d) { return d.getFileHandle(leaf(path)); })
      .then(function (fh) { return fh.getFile(); })
      .then(function (f) { return f.text(); })
      .then(function (t) { return t.trim() ? JSON.parse(t) : null; })
      .then(function (obj) { return obj === null ? remoteRead(path) : obj; })
      .catch(function (err) {
        if (err && (err.name === "NotFoundError")) return remoteRead(path);   // absent is not an error
        if (err instanceof SyntaxError) {
          fail("The file " + path + " is not valid JSON", err);
          return null;
        }
        fail("Could not read " + path, err);
        return null;
      });
  }

  function write(path, obj) {
    var text = JSON.stringify(obj, null, 2) + "\n";
    if (state.mode === "fallback" || !state.ready) {
      state.cache[path] = obj;
      notify("warn", "No folder connected — " + path + " is held in this tab only. Use Download JSON before you close it.");
      return Promise.resolve(false);
    }
    return dirFor(path, true)
      .then(function (d) { return d.getFileHandle(leaf(path), { create: true }); })
      .then(function (fh) { return fh.createWritable(); })
      .then(function (w) { return w.write(text).then(function () { return w.close(); }); })
      .then(function () { state.cache[path] = obj; return true; })
      .catch(function (err) { fail("Could not save " + path, err); return false; });
  }

  function list(dir) {
    if (state.mode === "fallback" || !state.ready) {
      var pre = dir.replace(/\/*$/, "/");
      return Promise.resolve(Object.keys(state.cache)
        .filter(function (k) { return k.indexOf(pre) === 0 && k.slice(pre.length).indexOf("/") === -1; })
        .map(function (k) { return k.slice(pre.length); }));
    }
    var p = parts(dir);
    var h = Promise.resolve(state.dir);
    p.forEach(function (seg) { h = h.then(function (d) { return d.getDirectoryHandle(seg); }); });
    return h.then(function (d) {
      var out = [];
      var it = d.values();
      function step() {
        return it.next().then(function (r) {
          if (r.done) return out;
          if (r.value.kind === "file") out.push(r.value.name);
          return step();
        });
      }
      return step();
    }).then(function (names) { return names.sort(); })
      .catch(function (err) {
        if (err && err.name === "NotFoundError") return [];   // folder not created yet
        fail("Could not list " + dir, err);
        return [];
      });
  }

  /* Read every .json file in a directory. The review game and the
     group report both want the whole folder, not one file. */
  function readAll(dir) {
    return list(dir).then(function (names) {
      var jsons = names.filter(function (n) { return /\.json$/i.test(n); });
      return Promise.all(jsons.map(function (n) {
        return read(dir.replace(/\/*$/, "/") + n).then(function (o) {
          return o ? { file: n, data: o } : null;
        });
      })).then(function (rows) { return rows.filter(Boolean); });
    });
  }

  function remove(path) {
    delete state.cache[path];
    if (state.mode === "fallback" || !state.ready) return Promise.resolve(true);
    return dirFor(path, false)
      .then(function (d) { return d.removeEntry(leaf(path)); })
      .then(function () { return true; })
      .catch(function (err) {
        if (err && err.name === "NotFoundError") return true;
        fail("Could not delete " + path, err);
        return false;
      });
  }

  /* ---------- fallback: explicit download / load --------------------- */

  function download(path, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2) + "\n"], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = String(path).replace(/\//g, "-");
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function upload() {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json,.json";
      inp.multiple = true;
      inp.addEventListener("change", function () {
        var files = [].slice.call(inp.files || []);
        Promise.all(files.map(function (f) {
          return f.text().then(function (t) {
            try { return { name: f.name, data: JSON.parse(t) }; }
            catch (e) { notify("err", f.name + " is not valid JSON.", true); return null; }
          });
        })).then(function (rows) { resolve(rows.filter(Boolean)); });
      });
      inp.click();
    });
  }

  /* ---------- the shared bar ----------------------------------------- */

  var bars = [];

  function base() {
    // depth of this page below /morning-report/, so links work on
    // GitHub Pages project paths and on the custom domain alike
    var m = location.pathname.match(/morning-report\/(.*)$/);
    var rest = m ? m[1].replace(/[^/]*$/, "") : "";
    var up = rest.split("/").filter(Boolean).length;
    return up ? new Array(up + 1).join("../") : "./";
  }

  function renderBar(el) {
    var b = base();
    el.className = "mr-bar";
    el.innerHTML = "";
    var inner = document.createElement("div");
    inner.className = "mr-bar-in";

    var home = document.createElement("a");
    home.className = "home";
    home.href = b;
    home.textContent = "← Morning Report";
    inner.appendChild(home);

    var st = document.createElement("div");
    st.className = "state";

    var dot = document.createElement("span");
    dot.className = "mr-dot" + (state.ready ? " on" : (state.dir ? " warn" : ""));
    st.appendChild(dot);

    var label = document.createElement("span");
    if (state.mode === "fallback") {
      label.innerHTML = "No folder access in this browser — <span class='why'>use Chrome or Edge, or Download / Load JSON by hand</span>";
    } else if (state.ready) {
      label.innerHTML = "Data folder <span class='folder'>" + esc(state.name) + "</span>";
    } else if (state.dir) {
      label.innerHTML = "<span class='folder'>" + esc(state.name) + "</span> <span class='why'>needs permission again</span>";
    } else {
      label.innerHTML = "<span class='why'>No data folder connected — nothing will be saved</span>";
    }
    st.appendChild(label);

    if (state.mode !== "fallback") {
      var btn = document.createElement("button");
      if (state.ready) {
        btn.textContent = "Change";
        btn.addEventListener("click", function () { connect(); });
      } else if (state.dir) {
        btn.className = "solid";
        btn.textContent = "Reconnect";
        btn.addEventListener("click", function () { reconnect(); });
      } else {
        btn.className = "solid";
        btn.textContent = "Connect data folder";
        btn.addEventListener("click", function () { connect(); });
      }
      st.appendChild(btn);
    }

    /* The shared roster, when one is configured. It is a second source,
       not a second folder, so it gets a word rather than a control —
       the controls live on the settings page. */
    var rem = global.MRRemote && global.MRRemote.summary && global.MRRemote.summary();
    if (rem) {
      var chip = document.createElement("a");
      chip.className = "mr-remote " + rem.kind;
      chip.href = b + "settings/";
      chip.textContent = rem.text;
      chip.title = "Shared roster settings";
      st.appendChild(chip);
    }

    inner.appendChild(st);
    el.appendChild(inner);
  }

  function renderBars() {
    bars.forEach(renderBar);
  }

  function mountBar(el) {
    if (typeof el === "string") el = document.getElementById(el);
    if (!el) return;
    if (bars.indexOf(el) === -1) bars.push(el);
    renderBar(el);
  }

  /* ---------- small shared helpers ----------------------------------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function slug(s) {
    return String(s || "").toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function sessionId(date, site) {
    return date + (site ? "-" + slug(site) : "");
  }

  /* ---------- api ----------------------------------------------------- */

  var api = {
    supported: supported,
    connect: connect,
    reconnect: reconnect,
    disconnect: disconnect,
    restore: restore,
    read: read,
    write: write,
    list: list,
    readAll: readAll,
    remove: remove,
    download: download,
    upload: upload,
    notify: notify,
    fail: fail,
    mountBar: mountBar,
    base: base,
    esc: esc,
    slug: slug,
    today: today,
    sessionId: sessionId,
    onChange: function (fn) { listeners.push(fn); return fn; },
    status: function () {
      /* `dir` distinguishes "never connected" from "connected but the
         permission lapsed on reload" — different sentences, different
         buttons, and the pages that ask cannot tell them apart without it. */
      return {
        mode: state.mode, ready: state.ready, name: state.name,
        supported: supported, dir: !!state.dir
      };
    },
    /* Resolve once the store has finished trying to restore, so a page
       can render against a known state instead of a guessed one. */
    whenReady: null
  };

  /* Wired after restore() rather than at load, so the script order of
     remote.js and store.js on a page does not matter. */
  api.whenReady = restore().then(function () {
    if (global.MRRemote) {
      global.MRRemote.onChange(renderBars);
      if (global.MRRemote.configured()) global.MRRemote.fetchAll().then(renderBars);
    }
    return api.status();
  });

  global.MRStore = api;
})(window);
