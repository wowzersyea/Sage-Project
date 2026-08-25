/* ==================================================================
   MRSummarise — the rollup, and the optional model call over it.

   Two layers, and the first one never fails:

     1. The arithmetic. How many answered, what they rated it, which
        ticks held, and every comment as written. This needs no key,
        no network and no model, and it is what the page renders
        first. If the second layer never runs, nothing is missing —
        the numbers and the comments are the feedback.

     2. The summary. One model call per unit — three sections and six
        roles — never one call for all nine. Per-unit calls keep the
        reasoning clean and let a unit with two comments be told to
        say so rather than being averaged in with a unit that has
        eight. The instructions are prose in content/feedback.json,
        editable by the people who run report, not string literals
        in here.

   There is no server in this module, so a model call goes from the
   browser to the API with a key the user pastes in and which stays in
   their browser. Nothing is proxied through anything of ours, and
   there is no account. The payload can be printed before it is sent —
   the same courtesy the CLI's --show-api-payload extends — because
   nobody should have to take our word for what left the machine.

   Every draft comes back with a confidence, and a low one is marked
   as low. The model is a second reader of comments a human can read
   in a minute; it is not the record.
   ================================================================== */

(function (global) {
  "use strict";

  var VERSION = "2023-06-01";
  var KEY_STORE = "mr.model.key";
  var MODEL_STORE = "mr.model.name";
  var PROVIDER_STORE = "mr.model.provider";

  /* ---------- who is being asked -------------------------------------

     Two shapes of the same request. Everything above this layer — the
     rollup, the per-unit prompts, the confidence floor — is identical
     either way; only the envelope differs. Adding a third provider
     means adding a row here and nothing else.

     Both are called straight from the browser. Anthropic wants an
     explicit opt-in header to allow that; xAI answers the preflight
     with a wildcard and needs nothing. Neither arrangement puts the
     key anywhere but this browser. */

  var PROVIDERS = {
    anthropic: {
      label: "Anthropic",
      endpoint: "https://api.anthropic.com/v1/messages",
      prefix: "sk-ant-",
      headers: function (key) {
        return {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": VERSION,
          "anthropic-dangerous-direct-browser-access": "true"
        };
      },
      body: function (p) {
        return {
          model: p.model,
          max_tokens: p.max_tokens,
          system: p.system,
          messages: [{ role: "user", content: p.user }]
        };
      },
      read: function (body) {
        return body && body.content && body.content[0] && body.content[0].text;
      }
    },
    xai: {
      label: "xAI",
      endpoint: "https://api.x.ai/v1/chat/completions",
      prefix: "xai-",
      headers: function (key) {
        return {
          "content-type": "application/json",
          "authorization": "Bearer " + key
        };
      },
      body: function (p) {
        return {
          model: p.model,
          max_tokens: p.max_tokens,
          messages: [
            { role: "system", content: p.system },
            { role: "user", content: p.user }
          ]
        };
      },
      read: function (body) {
        return body && body.choices && body.choices[0] &&
          body.choices[0].message && body.choices[0].message.content;
      }
    }
  };

  function providerNames() { return Object.keys(PROVIDERS); }

  /* A key says who it belongs to, so pasting one is enough. */
  function providerOfKey(k) {
    k = String(k || "").trim();
    var found = "";
    providerNames().forEach(function (name) {
      if (!found && k.indexOf(PROVIDERS[name].prefix) === 0) found = name;
    });
    return found;
  }

  function provider() {
    var stored = read(global.localStorage, PROVIDER_STORE) ||
      read(global.sessionStorage, PROVIDER_STORE);
    if (stored && PROVIDERS[stored]) return stored;
    return providerOfKey(key()) || "anthropic";
  }

  function setProvider(name) {
    drop(PROVIDER_STORE);
    if (!name || !PROVIDERS[name]) return;
    try { global.sessionStorage.setItem(PROVIDER_STORE, name); } catch (e) { /* private mode */ }
  }

  function spec() { return PROVIDERS[provider()]; }

  /* ---------- the key ------------------------------------------------

     Where the key is kept follows remote.js, and for the same reason:

       sessionStorage — the default. Gone when the tab closes, which is
       the right default for a shared workroom machine.

       localStorage — only when the user ticks "keep it in this
       browser". Their own laptop, their call.

     The ban on localStorage in this module is about DATA, none of
     which may live there because it is invisible to the other site and
     to the folder. A key the user typed and can retype is not data.
     -------------------------------------------------------------------- */

  function read(store, name) {
    try { return store.getItem(name) || ""; } catch (e) { return ""; }
  }

  function drop(name) {
    try { global.sessionStorage.removeItem(name); } catch (e) { /* private mode */ }
    try { global.localStorage.removeItem(name); } catch (e) { /* private mode */ }
  }

  function key() {
    return read(global.localStorage, KEY_STORE) || read(global.sessionStorage, KEY_STORE);
  }

  function setKey(k, remember) {
    k = (k || "").trim();
    drop(KEY_STORE);
    if (!k) return;
    try {
      (remember ? global.localStorage : global.sessionStorage).setItem(KEY_STORE, k);
    } catch (e) { /* private mode: it lives for this page only */ }
  }

  function clearKey() { drop(KEY_STORE); }

  function remembered() { return !!read(global.localStorage, KEY_STORE); }

  function defaultModel(content) {
    var m = (content && content.model) || {};
    var per = (m.providers || {})[provider()];
    return (per && per.model) || m.default_model || "claude-sonnet-5";
  }

  /* A model chosen by hand is remembered per provider: switching from
     one to the other must not carry a model name the other has never
     heard of. */
  function model(content) {
    var chosen = read(global.localStorage, MODEL_STORE) || read(global.sessionStorage, MODEL_STORE);
    if (!chosen) return defaultModel(content);
    var parts = chosen.split("|");
    if (parts.length === 2) {
      return parts[0] === provider() ? parts[1] : defaultModel(content);
    }
    return chosen;                       /* written before providers existed */
  }

  function setModel(m) {
    drop(MODEL_STORE);
    if (!m) return;
    try { global.sessionStorage.setItem(MODEL_STORE, provider() + "|" + m); } catch (e) { /* private mode */ }
  }

  /* ---------- the arithmetic --------------------------------------- */

  function mean(values) {
    if (!values.length) return null;
    var sum = values.reduce(function (a, b) { return a + b; }, 0);
    return Math.round((sum / values.length) * 10) / 10;
  }

  function distribution(values) {
    var d = [0, 0, 0, 0, 0];
    values.forEach(function (v) { if (v >= 1 && v <= 5) d[v - 1]++; });
    return d;
  }

  function clean(text) {
    return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  }

  /* Did this person engage with the section at all? A rating, a tick
     or a comment is engagement; an empty object is somebody who
     scrolled past it. */
  function touched(a) {
    if (!a) return false;
    if (typeof a.rating === "number") return true;
    if (a.comment && String(a.comment).trim()) return true;
    return !!(a.checks && Object.keys(a.checks).some(function (k) { return a.checks[k]; }));
  }

  /* subs is [{ data }] as readAll returns, or plain objects. */
  function rollup(subs, content) {
    var rows = subs.map(function (s) { return s && s.data ? s.data : s; }).filter(Boolean);
    var out = { n: rows.length, sections: {}, roles: {}, submitted: [] };

    rows.forEach(function (r) { if (r.submitted) out.submitted.push(r.submitted); });
    out.submitted.sort();

    content.sections.forEach(function (sec) {
      var answers = rows.map(function (r) { return r[sec.id] || {}; });
      var ratings = answers.map(function (a) { return a.rating; })
        .filter(function (v) { return typeof v === "number"; });
      /* A section nobody touched is not five failed ticks. Only a
         submission that engaged with the section at all counts
         toward the denominator. */
      var engaged = answers.filter(function (a) { return touched(a); });
      var checks = {};
      sec.checks.forEach(function (c) {
        var ticked = engaged.filter(function (a) { return a.checks && a.checks[c.id]; }).length;
        checks[c.id] = { text: c.text, ticked: ticked, of: engaged.length };
      });
      out.sections[sec.id] = {
        id: sec.id,
        title: sec.title,
        n: ratings.length,
        mean: mean(ratings),
        dist: distribution(ratings),
        checks: checks,
        comments: answers.map(function (a) { return clean(a.comment); }).filter(Boolean)
      };
    });

    content.roles.order.forEach(function (slug) {
      var answers = rows.map(function (r) { return (r.roles && r.roles[slug]) || {}; });
      var ratings = answers.map(function (a) { return a.rating; })
        .filter(function (v) { return typeof v === "number"; });
      out.roles[slug] = {
        id: slug,
        n: ratings.length,
        mean: mean(ratings),
        dist: distribution(ratings),
        comments: answers.map(function (a) { return clean(a.comment); }).filter(Boolean)
      };
    });

    return out;
  }

  /* What the model is shown, and nothing else. Built here so the page
     can print it unchanged before anything is sent. */
  function payload(unit, content) {
    var m = content.model;
    var ratings = unit.dist && unit.dist.some(function (c) { return c > 0; })
      ? unit.dist.map(function (c, i) { return c ? c + "×" + (i + 1) : null; })
          .filter(Boolean).join(", ") + " (mean " + unit.mean + ")"
      : "nobody rated this";
    var ticks = unit.checks && Object.keys(unit.checks).length
      ? Object.keys(unit.checks).map(function (id) {
          var c = unit.checks[id];
          return c.ticked + " of " + c.of + " — " + c.text;
        }).join("\n")
      : "no ticks in this unit";

    var head = m.user_header
      .replace("{unit}", unit.title)
      .replace("{about}", unit.about || unit.title)
      .replace("{n}", String(unit.n))
      .replace("{total}", String(unit.total))
      .replace("{ratings}", ratings)
      .replace("{ticks}", ticks);

    var body = unit.comments && unit.comments.length
      ? unit.comments.map(function (c) { return "- " + c; }).join("\n")
      : m.no_comments;

    return {
      provider: provider(),
      endpoint: spec().endpoint,
      model: model(content),
      max_tokens: m.max_tokens || 700,
      system: m.system.join("\n"),
      user: head + "\n" + body
    };
  }

  /* Anything the identifier check would have blocked never leaves the
     browser, whatever the form let through earlier. */
  function screen(unit) {
    if (!global.MRPhi) return [];
    var fields = {};
    (unit.comments || []).forEach(function (c, i) { fields["comment " + (i + 1)] = c; });
    return MRPhi.blocking(MRPhi.scanAll(fields));
  }

  function parse(text) {
    var t = String(text || "").trim()
      .replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    var start = t.indexOf("{");
    var end = t.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("the model did not reply with JSON");
    return JSON.parse(t.slice(start, end + 1));
  }

  function reason(status, body) {
    if (status === 401 || status === 403) return "the key was rejected by " + spec().label;
    if (status === 429) return "the rate limit was hit — wait a moment and summarise again";
    if (status === 529 || status === 503) return "the API is overloaded";
    var msg = body && body.error && body.error.message;
    return msg || ("HTTP " + status);
  }

  function run(unit, content) {
    var k = key();
    if (!k) return Promise.reject(new Error("no key set, so nothing was sent"));

    var blocked = screen(unit);
    if (blocked.length) {
      return Promise.reject(new Error(
        "a comment still contains " + blocked[0].kind + " (" + blocked[0].match + "), so nothing was sent. " +
        "Edit it in the submission and summarise again."));
    }

    var p = payload(unit, content);
    var api = spec();
    return global.fetch(p.endpoint, {
      method: "POST",
      headers: api.headers(k),
      body: JSON.stringify(api.body(p))
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (!res.ok) throw new Error(reason(res.status, body));
        var text = api.read(body);
        var draft = parse(text);
        var low = content.model.low_confidence || 0.7;
        return {
          unit: unit.id,
          summary: clean(draft.summary),
          one_thing: clean(draft.one_thing),
          agreement: draft.agreement || null,
          confidence: typeof draft.confidence === "number" ? draft.confidence : null,
          low: typeof draft.confidence === "number" ? draft.confidence < low : true,
          model: p.model,
          provider: p.provider,
          drafted: new Date().toISOString()
        };
      });
    }).catch(function (err) {
      if (err instanceof TypeError) {
        throw new Error("the call could not be made at all — no network, or something between this " +
          "browser and the API blocked it. Nothing was sent twice.");
      }
      throw err;
    });
  }

  global.MRSummarise = {
    rollup: rollup,
    payload: payload,
    screen: screen,
    run: run,
    key: key,
    setKey: setKey,
    clearKey: clearKey,
    remembered: remembered,
    model: model,
    setModel: setModel,
    defaultModel: defaultModel,
    provider: provider,
    setProvider: setProvider,
    providerOfKey: providerOfKey,
    providers: function () {
      return providerNames().map(function (name) {
        return { id: name, label: PROVIDERS[name].label, endpoint: PROVIDERS[name].endpoint };
      });
    },
    endpoint: function () { return spec().endpoint; },
    mean: mean
  };
})(window);
