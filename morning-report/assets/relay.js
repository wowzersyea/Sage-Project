/* ==================================================================
   MRRelay — the post box, for feedback filled in somewhere that has
   no data folder.

   A phone cannot write to the facilitator's laptop. So a submission
   from a phone goes to the same keyed endpoint the shared roster uses
   and waits there, and the facilitator's browser later drains it into
   the folder and tells the endpoint to forget it. The folder is the
   permanent home; the endpoint is a corridor.

   Two keys, and this module is careful about which it uses:

     the submit key   posts feedback and can do nothing else. It is
                      the one that travels — in the link handed round
                      a room, in a QR code on the screen.

     the roster key   drains the post box. It also reads the roster,
                      which is the file with the names in it, so it
                      stays on the facilitator's machine and is never
                      put in a link.

   A link may carry ?relay=<endpoint>&k=<submit key>, which is how
   somebody's phone is configured without anybody typing anything. It
   is held for that tab only.

   Nothing here writes to the data folder and nothing here reads the
   roster. When there is no endpoint configured at all, every call
   answers "not set up" and the page falls back to what it did before
   this module existed.
   ================================================================== */

(function (global) {
  "use strict";

  var STORE_KEY = "mr.relay";
  var SHARE_KEY = "mr.relay.share";

  var state = { loaded: false, endpoint: "", submitKey: "" };

  /* ---------- the site's own collection point -------------------------

     Everything above configures one device at a time: a link, a QR, a
     settings page. Each of those was a way for a device to end up with
     no configuration at all — somebody types the short address off a
     slide, gets a working form, presses send, and their answers
     download to their own phone where nobody will ever file them.

     content/relay.json closes that hole. It is committed to the site,
     so the bare address works on a device that has never been
     configured. It carries the SUBMIT key only — the weak key, which
     can put a submission in and can read nothing back — and the file's
     own note says why the roster key must never go in it.

     Lowest priority on purpose: a link or a setting on the device
     still wins, so handing somebody a link to a different endpoint
     still behaves. Fetched once per page; before the fetch resolves,
     canSubmit() reports what the device alone knows, which is why the
     pages that care await MRRelay.whenReady first. */

  var site = { endpoint: "", submitKey: "" };

  var whenReady = (function () {
    var base = (global.MRStore && global.MRStore.base) ? global.MRStore.base() : "../";
    return global.fetch(base + "content/relay.json", { cache: "no-cache" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (cfg) {
        if (cfg && typeof cfg.endpoint === "string" && typeof cfg.submit_key === "string") {
          site.endpoint = cfg.endpoint.trim();
          site.submitKey = cfg.submit_key.trim();
        }
        return true;
      })
      .catch(function () { return true; });   /* no file, no fallback — same as before */
  })();

  function readStore(store) {
    try {
      var raw = store.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* A link wins over anything stored: somebody who has just been sent
     a new link means to use it. */
  function fromLink() {
    try {
      var p = new URLSearchParams(global.location.search);
      var endpoint = (p.get("relay") || "").trim();
      var key = (p.get("k") || "").trim();
      if (!endpoint || !key) return null;
      return { endpoint: endpoint, submitKey: key };
    } catch (e) { return null; }
  }

  function load() {
    if (state.loaded) return;
    state.loaded = true;

    var link = fromLink();
    if (link) {
      state.endpoint = link.endpoint;
      state.submitKey = link.submitKey;
      try { global.sessionStorage.setItem(STORE_KEY, JSON.stringify(link)); } catch (e) { /* private mode */ }
      return;
    }
    var s = readStore(global.sessionStorage) || readStore(global.localStorage);
    if (s) {
      state.endpoint = typeof s.endpoint === "string" ? s.endpoint : "";
      state.submitKey = typeof s.submitKey === "string" ? s.submitKey : "";
    }
  }

  /* The roster module holds the facilitator's endpoint and key. On
     their machine that is all the configuration this needs. */
  function shared() {
    if (!global.MRRemote || !global.MRRemote.settings) return { endpoint: "", key: "" };
    var s = global.MRRemote.settings();
    return { endpoint: s.endpoint || "", key: s.key || "" };
  }

  function endpoint() {
    load();
    return state.endpoint || shared().endpoint || site.endpoint;
  }

  function submitKey() {
    load();
    return state.submitKey || shared().key || site.submitKey;
  }

  function canSubmit() { return !!(endpoint() && submitKey()); }

  /* Draining needs the roster key specifically. A machine holding only
     a submit key can put things in and never take them out. */
  function canDrain() {
    var s = shared();
    return !!(s.endpoint && s.key);
  }

  /* The same-origin corridor remote.js already rides (a Cloudflare
     function at /mr-api): hospital WiFi blocks script.google.com
     wholesale, and a feedback submit dies there exactly the way the
     roster fetch did. Corridor first, but ONLY when the endpoint in
     play is the site's own — the corridor forwards to one fixed
     deployment, and a link that configured a different endpoint must
     keep going where it points. Unreachable falls through to direct;
     a denied or error answer is an answer. */
  var CORRIDOR = (global.MR_PROXY !== undefined) ? global.MR_PROXY : "/mr-api";

  function postTargets(url) {
    var own = (site.endpoint && url === site.endpoint) || url === shared().endpoint;
    return (CORRIDOR && own) ? [CORRIDOR, url] : [url];
  }

  function post(body, key) {
    var url = body.action === "feedback" ? endpoint() : shared().endpoint;
    if (!url || !key) return Promise.resolve({ ok: false, error: "No endpoint and key are set." });

    body.key = key;
    var urls = postTargets(url);
    /* text/plain on purpose: Apps Script does not answer the CORS
       preflight a JSON content-type would provoke. */
    var attempt = function (i) {
      return global.fetch(urls[i], {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body)
      })
        .then(function (res) {
          if (!res.ok) throw new Error("The endpoint answered " + res.status + ".");
          return res.json().catch(function () {
            throw new Error("The endpoint did not return JSON.");
          });
        })
        .catch(function (err) {
          if (i + 1 < urls.length) return attempt(i + 1);
          throw err;
        });
    };
    return attempt(0)
      .then(function (r) {
        if (!r || r.status !== "ok") {
          return {
            ok: false,
            error: (r && (r.message || (r.status === "denied" ? "That key was not accepted." : ""))) ||
              "The endpoint refused it."
          };
        }
        r.ok = true;
        return r;
      })
      .catch(function (err) {
        return {
          ok: false,
          error: "The endpoint could not be reached — " + (err && err.message ? err.message : err)
        };
      });
  }

  /* ---------- blobs over a JSON wire -------------------------------- */

  function encode(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error("That recording could not be read.")); };
      fr.onload = function () {
        var s = String(fr.result || "");
        var comma = s.indexOf(",");
        resolve(comma === -1 ? "" : s.slice(comma + 1));
      };
      fr.readAsDataURL(blob);
    });
  }

  function decode(data, mime) {
    var bin = global.atob(String(data || ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || "application/octet-stream" });
  }

  /* ---------- the four calls ---------------------------------------- */

  /* clips is [{ unit, mime, blob }] and may be empty. */
  function submit(record, clips) {
    if (!canSubmit()) return Promise.resolve({ ok: false, error: "No endpoint and key are set." });

    var list = clips || [];
    return Promise.all(list.map(function (c) {
      return encode(c.blob).then(function (data) {
        return { unit: c.unit, mime: c.mime || c.blob.type || "audio/webm", data: data };
      });
    })).then(function (audio) {
      return post({ action: "feedback", record: record, audio: audio }, submitKey());
    });
  }

  function pending() { return post({ action: "collect" }, shared().key); }

  function recording(id) { return post({ action: "recording", id: id }, shared().key); }

  function collected(submissions) {
    return post({ action: "collected", submissions: submissions || [] }, shared().key);
  }

  function forget() {
    state.loaded = true;
    state.endpoint = "";
    state.submitKey = "";
    try { global.sessionStorage.removeItem(STORE_KEY); } catch (e) { /* private mode */ }
    try { global.localStorage.removeItem(STORE_KEY); } catch (e) { /* private mode */ }
  }

  /* ---------- the key that goes in the link -------------------------

     MR_FEEDBACK_KEY, kept on the facilitator's machine so the link can
     be built without typing it out every week. It is the weak key by
     design — it submits and nothing else — so it lives under the same
     rules as the strong one rather than looser ones. */

  function shareKey() {
    var v = "";
    try { v = global.localStorage.getItem(SHARE_KEY) || ""; } catch (e) { /* private mode */ }
    if (v) return v;
    try { return global.sessionStorage.getItem(SHARE_KEY) || ""; } catch (e) { return ""; }
  }

  function setShareKey(k, remember) {
    k = (k || "").trim();
    try { global.sessionStorage.removeItem(SHARE_KEY); } catch (e) { /* private mode */ }
    try { global.localStorage.removeItem(SHARE_KEY); } catch (e) { /* private mode */ }
    if (!k) return;
    try {
      (remember ? global.localStorage : global.sessionStorage).setItem(SHARE_KEY, k);
    } catch (e) { /* it still works for this page */ }
  }

  /* The link to hand round. Built where the roster key already is, and
     it carries the submit key instead — never that one. */
  function linkFor(base, feedbackKey) {
    var s = shared();
    var k = feedbackKey || shareKey();
    if (!s.endpoint || !k) return "";
    return base + (base.indexOf("?") === -1 ? "?" : "&") +
      "relay=" + encodeURIComponent(s.endpoint) + "&k=" + encodeURIComponent(k);
  }

  /* True when this machine can produce a link for somebody else. */
  function canShare() { return !!(shared().endpoint && shareKey()); }

  global.MRRelay = {
    whenReady: whenReady,
    siteConfigured: function () { return !!(site.endpoint && site.submitKey); },
    canSubmit: canSubmit,
    canDrain: canDrain,
    endpoint: endpoint,
    submit: submit,
    pending: pending,
    recording: recording,
    collected: collected,
    encode: encode,
    decode: decode,
    linkFor: linkFor,
    canShare: canShare,
    shareKey: shareKey,
    setShareKey: setShareKey,
    forget: forget,
    fromLink: function () { load(); return !!fromLink(); }
  };
})(window);
