/* ==================================================================
   MRVoice — dictation for the free-text boxes.

   The feedback that never gets written is the feedback nobody had
   ninety seconds to type. This puts a microphone next to every
   comment box: press it, say the thing, press it again. What comes
   back is text in the box, editable like anything else — there is no
   audio file, and nothing is uploaded by this module.

   Where the words are turned into text is the browser's business,
   not ours. In Chrome and Edge that means the vendor's speech
   service: the audio leaves the machine. That is disclosed on every
   page that mounts a microphone, and it is the reason the identifier
   check still runs on whatever the dictation produced. Never dictate
   a name, an MRN or a date of service into any box in this module.

   Firefox and Safari have no SpeechRecognition worth the name, so
   there the button is not rendered at all and the box is simply
   typed into. Nothing else on the page changes.
   ================================================================== */

(function (global) {
  "use strict";

  var Rec = global.SpeechRecognition || global.webkitSpeechRecognition || null;

  /* Chrome ends a recognition after a stretch of silence. A person
     thinking mid-sentence is not a person who has finished, so we
     start it again — unless they pressed stop, or the restarts are
     running away from us, which means something is wrong with the
     device rather than the speaker. */
  var RESTART_LIMIT = 40;

  var live = null;      /* the one session that may be running */

  function supported() { return !!Rec; }

  function why(code) {
    switch (code) {
      case "not-allowed":
      case "service-not-allowed":
        return "The microphone is blocked for this page. Allow it in the padlock menu and press the microphone again.";
      case "audio-capture":
        return "No microphone was found. Plug one in, or type it instead.";
      case "network":
        return "The speech service could not be reached, so dictation stopped. What was already transcribed is still in the box.";
      case "aborted":
        return null;    /* we aborted it ourselves */
      default:
        return "Dictation stopped (" + code + "). What was already transcribed is still in the box.";
    }
  }

  function notify(kind, msg) {
    if (!msg) return;
    if (global.MRStore && MRStore.notify) MRStore.notify(kind, msg);
    else if (kind === "err") global.alert(msg);
  }

  /* Insert at the caret when there is one, otherwise at the end.
     Someone who has clicked into the middle of what they wrote means
     to add it there. */
  function insert(field, text) {
    var at = typeof field.selectionStart === "number" ? field.selectionStart : field.value.length;
    var before = field.value.slice(0, at);
    var after = field.value.slice(at);
    var pad = before && !/\s$/.test(before) ? " " : "";
    field.value = before + pad + text + after;
    var caret = (before + pad + text).length;
    try { field.setSelectionRange(caret, caret); } catch (e) { /* not focusable right now */ }
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function stop() {
    if (!live) return;
    var s = live;
    live = null;
    s.wanted = false;
    s.setState("off");
    try { s.rec.stop(); } catch (e) { /* already ended */ }
  }

  function start(session) {
    stop();
    live = session;
    session.wanted = true;
    session.restarts = 0;
    try {
      session.rec.start();
    } catch (e) {
      live = null;
      session.wanted = false;
      session.setState("off");
      notify("err", "Dictation would not start — " + (e && e.message ? e.message : e));
    }
  }

  /* Mount a microphone for one field. Returns the button, or null in
     a browser that cannot do this, so the caller can decide what to
     say in its place. */
  function mount(field, opts) {
    if (!Rec || !field) return null;
    opts = opts || {};

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mic";
    btn.setAttribute("aria-label", "Dictate into " + (opts.label || "this box"));

    var dot = document.createElement("span");
    dot.className = "mic-dot";
    var txt = document.createElement("span");
    txt.className = "mic-txt";
    btn.appendChild(dot);
    btn.appendChild(txt);

    var interim = null;
    if (opts.interim !== false) {
      interim = document.createElement("p");
      interim.className = "mic-interim";
      interim.hidden = true;
    }

    var rec = new Rec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = opts.lang || global.navigator.language || "en-US";

    var session = {
      rec: rec,
      wanted: false,
      restarts: 0,
      setState: function (state) {
        btn.setAttribute("data-state", state);
        btn.setAttribute("aria-pressed", state === "on" ? "true" : "false");
        txt.textContent = state === "on" ? (opts.stopText || "Stop") : (opts.startText || "Dictate");
        if (interim) {
          if (state !== "on") { interim.hidden = true; interim.textContent = ""; }
        }
        if (opts.onstate) opts.onstate(state);
      }
    };
    session.setState("off");

    rec.onresult = function (e) {
      var pending = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var r = e.results[i];
        var said = (r[0] && r[0].transcript ? r[0].transcript : "").trim();
        if (!said) continue;
        if (r.isFinal) {
          insert(field, said);
          if (opts.onfinal) opts.onfinal(said);
        } else {
          pending += said + " ";
        }
      }
      if (interim) {
        interim.hidden = !pending;
        interim.textContent = pending;
      }
    };

    rec.onerror = function (e) {
      if (e.error === "no-speech") return;        /* onend will restart it */
      var msg = why(e.error);
      if (msg) {
        session.wanted = false;
        notify(e.error === "network" ? "warn" : "err", msg);
      }
    };

    rec.onend = function () {
      if (session.wanted && session.restarts < RESTART_LIMIT) {
        session.restarts++;
        try { rec.start(); return; } catch (e) { /* fall through to off */ }
      }
      if (session.wanted && session.restarts >= RESTART_LIMIT) {
        notify("warn", "Dictation kept dropping out, so it has been switched off. What was transcribed is in the box.");
      }
      session.wanted = false;
      if (live === session) live = null;
      session.setState("off");
    };

    btn.addEventListener("click", function () {
      if (live === session && session.wanted) { stop(); return; }
      session.setState("on");
      start(session);
      field.focus();
    });

    return { button: btn, interim: interim, stop: function () { if (live === session) stop(); } };
  }

  global.MRVoice = {
    supported: supported,
    mount: mount,
    stop: stop,
    NOTE: "Dictation uses the browser's own speech service, so the audio leaves this machine. " +
          "Say nothing you would not put in the box by hand — no names, no MRNs, no dates of service.",
    UNSUPPORTED: "This browser has no dictation, so the boxes are typed into. Chrome or Edge if you want the microphone."
  };
})(window);
