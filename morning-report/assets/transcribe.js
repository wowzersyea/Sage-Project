/* ==================================================================
   MRStt — recordings into text, on this machine and nowhere else.

   Dictation while filling the form depends on the browser having a
   speech engine, which in practice means Chrome, Edge and sometimes
   Safari, and never a locked-down hospital build of anything. That
   was the wrong place to put the requirement: the person giving
   feedback should only need a microphone, which every browser has.

   So the deal is now: ANY browser records (voice.js), the recording
   travels with the submission, and the words are recovered HERE, on
   the facilitator's machine, by a speech model that ships with the
   site itself. /assets/stt/ holds transformers.js, the onnx runtime
   and whisper-tiny.en — about sixty megabytes, all served from the
   same place as the pages, all running inside this browser tab.

   Which means, and this is the point:

     - no browser requirement for the person speaking
     - no API key and no per-use cost
     - the audio is never sent anywhere to be transcribed — a
       recording of a resident criticising a session stays on the
       machine it was collected to

   whisper-tiny is the smallest of the family, chosen because a
   feedback comment is twenty seconds of one person speaking near a
   phone, not a lecture hall. It will mangle a drug name here and
   there. The recording stays right next to the transcript, so a
   mangled word is a click away from being checked; and everything a
   transcript feeds into — the identifier check, the rollup, the
   drafted summaries — treats it exactly like typed text.

   Nothing loads until the first transcription is asked for: the
   model is fetched (from this site, once, then browser-cached) at
   the moment somebody presses the button, not on page load.
   ================================================================== */

(function (global) {
  "use strict";

  var loading = null;    /* memoised pipeline promise */

  function supported() {
    return typeof WebAssembly === "object" &&
      typeof (global.AudioContext || global.webkitAudioContext) === "function";
  }

  function base() {
    return (global.MRStore && MRStore.base) ? MRStore.base() : "../";
  }

  /* The model, loaded once per tab. onprogress hears loading stages
     so the page can say what the wait is. */
  function ready(onprogress) {
    if (loading) return loading;
    if (!supported()) {
      return Promise.reject(new Error("This browser cannot run the transcriber (no WebAssembly)."));
    }
    var root = new URL(base(), global.location.href).href;
    loading = import(root + "assets/stt/transformers.min.js").then(function (T) {
      T.env.allowLocalModels = true;
      T.env.allowRemoteModels = false;                 /* this site or nothing */
      T.env.localModelPath = root + "assets/stt/models/";
      T.env.backends.onnx.wasm.wasmPaths = root + "assets/stt/";
      T.env.backends.onnx.wasm.numThreads = 1;         /* GitHub Pages sends no COOP/COEP */
      return T.pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
        quantized: true,
        progress_callback: function (p) {
          if (onprogress && p && p.status === "progress" && p.file && /onnx/.test(p.file)) {
            onprogress("Loading the speech model — " + Math.round(p.progress || 0) + "%");
          }
        }
      });
    });
    loading.catch(function () { loading = null; });    /* a failed load can be retried */
    return loading;
  }

  /* A recording (webm/mp4/ogg blob) to mono 16kHz samples, which is
     the one shape whisper accepts. Decoding happens in the browser's
     own decoder, so whatever the device could record, this can read. */
  function toSamples(blob) {
    var AC = global.AudioContext || global.webkitAudioContext;
    return blob.arrayBuffer().then(function (buf) {
      var ctx = new AC();
      return ctx.decodeAudioData(buf).then(function (decoded) {
        ctx.close();
        var length = Math.ceil(decoded.duration * 16000);
        if (!length) throw new Error("The recording is empty.");
        var off = new OfflineAudioContext(1, length, 16000);
        var src = off.createBufferSource();
        src.buffer = decoded;
        src.connect(off.destination);
        src.start();
        return off.startRendering();
      });
    }).then(function (rendered) {
      return { samples: rendered.getChannelData(0), seconds: rendered.duration };
    });
  }

  function transcribe(blob, onprogress) {
    return ready(onprogress).then(function (asr) {
      if (onprogress) onprogress("Reading the recording…");
      return toSamples(blob).then(function (audio) {
        if (onprogress) onprogress("Transcribing " + Math.round(audio.seconds) + "s of audio…");
        return asr(audio.samples, { chunk_length_s: 30, stride_length_s: 5 }).then(function (out) {
          var text = (out && out.text ? String(out.text) : "").trim();
          return { text: text, seconds: audio.seconds };
        });
      });
    });
  }

  global.MRStt = {
    supported: supported,
    ready: ready,
    transcribe: transcribe
  };
})(window);
