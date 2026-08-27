/* ==================================================================
   MRVoice — dictation for the free-text boxes.

   The feedback that never gets written is the feedback nobody had
   ninety seconds to type. This puts a microphone next to every
   comment box: press it, say the thing, press it again. What comes
   back is text in the box, editable like anything else.

   The audio is kept too, but only in the tab, and only until the form
   is sent: a transcript can be wrong in ways nobody notices, and the
   recording is the thing that settles it. On send it is discarded
   unless the person ticked the box that keeps it. Nothing here
   uploads anything — the page decides what happens to a clip.

   Where the words are turned into text is the browser's business,
   not ours. In Chrome and Edge that means the vendor's speech
   service: the audio leaves the machine. That is disclosed on every
   page that mounts a microphone, and it is the reason the identifier
   check still runs on whatever the dictation produced. Never dictate
   a name, an MRN or a date of service into any box in this module.

   And note what the identifier check cannot do: it reads the words,
   so it can clean a transcript, and it cannot touch what is in the
   recording. A name said out loud is in the audio whatever the text
   ends up saying. A kept recording also identifies its speaker —
   everyone in a group this small knows everyone's voice — which is
   why keeping one is a deliberate tick and not the default.

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

  /* Long enough for anything anyone should be saying into a feedback
     box, short enough that a microphone left on by accident is not a
     twenty-minute file. */
  var MAX_SECONDS = 180;

  var PREFERRED = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

  var live = null;      /* the one session that may be running */

  function recorderSupported() {
    return typeof global.MediaRecorder === "function" &&
      !!(global.navigator && global.navigator.mediaDevices &&
         global.navigator.mediaDevices.getUserMedia);
  }

  function bestMime() {
    if (!global.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    for (var i = 0; i < PREFERRED.length; i++) {
      if (MediaRecorder.isTypeSupported(PREFERRED[i])) return PREFERRED[i];
    }
    return "";
  }

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
    if (s.stopRecorder) s.stopRecorder();
    if (s.rec) { try { s.rec.stop(); } catch (e) { /* already ended */ } }
  }

  function start(session) {
    stop();
    live = session;
    session.wanted = true;
    session.restarts = 0;
    if (!session.rec) return;          /* recording only; nothing to transcribe with */
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
    opts = opts || {};
    var recognises = !!Rec;
    var records = opts.record !== false && recorderSupported();
    /* Either half is worth having. A browser that transcribes and
       cannot record still fills the box; one that records and cannot
       transcribe — an iPhone, most days — still catches what was
       said, and the person types the gist. */
    if (!field || (!recognises && !records)) return null;

    var startText = opts.startText || (recognises ? "Dictate" : "Record");
    var stopText = opts.stopText || "Stop";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mic";
    btn.setAttribute("aria-label",
      (recognises ? "Dictate into " : "Record a note for ") + (opts.label || "this box"));

    var dot = document.createElement("span");
    dot.className = "mic-dot";
    var txt = document.createElement("span");
    txt.className = "mic-txt";
    btn.appendChild(dot);
    btn.appendChild(txt);

    var interim = null;
    if (opts.interim !== false && recognises) {
      interim = document.createElement("p");
      interim.className = "mic-interim";
      interim.hidden = true;
    }

    var rec = null;
    if (recognises) {
      rec = new Rec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = opts.lang || global.navigator.language || "en-US";
    }

    var clip = null;        /* { blob, mime, seconds } once something was said */
    var recognitionDead = false;   /* recogniser gone, recorder carrying on */
    var recognitionFailure = null; /* the sentence to say when it ends */
    var media = null;       /* the live MediaRecorder, while running */
    var stream = null;      /* its microphone stream, so it can be released */
    var chunks = [];
    var startedAt = 0;
    var capTimer = null;

    function clipChanged() { if (opts.onclip) opts.onclip(clip); }

    /* The recorder is a second, independent listener on the same
       microphone. If it cannot start — no permission, no device, a
       browser without MediaRecorder — dictation still runs and the
       page simply has no recording to offer. */
    function startRecorder() {
      if (opts.record === false || !recorderSupported()) return;
      var mime = bestMime();
      global.navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        if (!session.wanted) {                       /* stopped while asking */
          s.getTracks().forEach(function (t) { t.stop(); });
          return;
        }
        stream = s;
        chunks = [];
        media = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
        media.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        media.onstop = function () {
          var seconds = Math.round((Date.now() - startedAt) / 1000);
          var type = (media && media.mimeType) || mime || "audio/webm";
          releaseStream();
          if (chunks.length) {
            clip = { blob: new Blob(chunks, { type: type }), mime: type, seconds: seconds };
            clipChanged();
          }
          chunks = [];
          media = null;
        };
        startedAt = Date.now();
        media.start();
        capTimer = global.setTimeout(function () {
          if (live === session) {
            stop();
            notify("warn", "Three minutes is the limit for one recording, so it was stopped there.");
          }
        }, MAX_SECONDS * 1000);
      }).catch(function (err) {
        notify("warn", "Dictation is running, but nothing is being recorded — " +
          (err && err.name === "NotAllowedError"
            ? "the microphone was refused for recording."
            : (err && err.message ? err.message : err)));
      });
    }

    function releaseStream() {
      if (capTimer) { global.clearTimeout(capTimer); capTimer = null; }
      if (stream) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
      }
    }

    function recorderRunning() {
      return !!(media && media.state !== "inactive");
    }

    function stopRecorder() {
      if (media && media.state !== "inactive") {
        try { media.stop(); return; } catch (e) { /* fall through and release */ }
      }
      releaseStream();
    }

    var session = {
      rec: rec,
      wanted: false,
      restarts: 0,
      stopRecorder: stopRecorder,
      setState: function (state) {
        btn.setAttribute("data-state", state);
        btn.setAttribute("aria-pressed", state === "on" ? "true" : "false");
        txt.textContent = state === "on" ? stopText : startText;
        if (interim) {
          if (state !== "on") { interim.hidden = true; interim.textContent = ""; }
        }
        if (opts.onstate) opts.onstate(state);
      }
    };
    session.setState("off");

    if (rec) rec.onresult = function (e) {
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

    /* Recognition dying must never orphan the recorder. The failure
       that actually happens — a hospital network refusing the speech
       service mid-sentence — used to flip the button to "off" while
       the microphone stayed hot and recording: a live mic the page
       denied having. Now a dead recogniser DEMOTES the session to
       record-only instead: the button stays on and honest, the
       recording continues, and the words are recovered later by the
       transcriber on the summary page. */
    function demoteToRecordOnly(msg) {
      if (!recorderRunning()) {
        session.wanted = false;
        if (live === session) live = null;
        session.setState("off");
        if (msg) notify("warn", msg);
        return;
      }
      recognitionDead = true;
      if (msg) notify("warn", msg + " Still recording — the words can be recovered from the recording.");
    }

    if (rec) rec.onerror = function (e) {
      if (e.error === "no-speech") return;        /* onend will restart it */
      recognitionFailure = why(e.error);
    };

    if (rec) rec.onend = function () {
      if (recognitionDead) return;                /* already demoted */
      if (session.wanted && !recognitionFailure && session.restarts < RESTART_LIMIT) {
        session.restarts++;
        try { rec.start(); return; } catch (e) { /* fall through */ }
      }
      if (!session.wanted) {                      /* the user pressed stop */
        if (live === session) live = null;
        session.setState("off");
        return;
      }
      var msg = recognitionFailure ||
        "Dictation kept dropping out, so it has stopped. What was transcribed is in the box.";
      recognitionFailure = null;
      demoteToRecordOnly(msg);
    };

    btn.addEventListener("click", function () {
      if (live === session && session.wanted) { stop(); return; }
      recognitionDead = false;
      recognitionFailure = null;
      session.setState("on");
      start(session);
      if (session.wanted) startRecorder();
      field.focus();
    });

    return {
      button: btn,
      interim: interim,
      stop: function () { if (live === session) stop(); },
      clip: function () { return clip; },
      discard: function () {
        clip = null;
        clipChanged();
      }
    };
  }

  global.MRVoice = {
    supported: supported,
    records: recorderSupported,
    mount: mount,
    stop: stop,
    MAX_SECONDS: MAX_SECONDS,
    NOTE: "Dictation uses the browser's own speech service, so the audio leaves this machine. " +
          "Say nothing you would not put in the box by hand — no names, no MRNs, no dates of service.",
    RECORD_ONLY: "This browser records without live dictation: press Record, speak, and the words are " +
          "recovered from the recording when the feedback is collected.",
    UNSUPPORTED: "This browser can neither dictate nor record, so the boxes are typed into."
  };
})(window);
