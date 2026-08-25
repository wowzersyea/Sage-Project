/* ==================================================================
   MRGate — a shared code on the front door of /morning-report/.

   Be clear about what this is. It is a sign, not a lock.

   This repository is public and these pages are static, so the code
   below is readable by anyone who looks for it, and a four-digit year
   would be guessed in seconds even if it were not. Nothing here would
   survive somebody who actually wanted in.

   That is fine, because of what is behind the door: nothing. The pages
   carry no roster. Names live in the user's own data folder and behind
   the key the shared-roster endpoint checks server-side, and neither is
   reachable from a page. A stranger who typed the code correctly would
   see empty tools asking them to connect a folder they do not have.

   So this keeps the casually curious out of a working tool, which is
   the modest thing it was asked to do, and it must never be relied on
   for anything more. If something genuinely sensitive ever lands on one
   of these pages, this is not what should be protecting it — Cloudflare
   Access in front of the path is, and that is a dashboard change rather
   than a file.

   Deliberately NOT the same value as MR_KEY, which gates the names and
   has to stay long and random.
   ================================================================== */

(function (global) {
  "use strict";

  var CODE = "2026";                     /* the academic year: easy to say out loud, rolls yearly */
  var STORE_KEY = "sage-mr-gate";
  var STYLE_ID = "mr-gate-style";

  /* Remembered per device so nobody types it twice a day. localStorage
     is right for this and only this: it is a convenience, it is not
     data, and losing it costs four keystrokes. */
  function passed() {
    try { return global.localStorage.getItem(STORE_KEY) === CODE; }
    catch (e) { return false; }          /* private mode: ask every time */
  }

  function remember() {
    try { global.localStorage.setItem(STORE_KEY, CODE); } catch (e) { /* nothing to do */ }
  }

  function forget() {
    try { global.localStorage.removeItem(STORE_KEY); } catch (e) { /* nothing to do */ }
    location.reload();
  }

  /* Styles are injected rather than left to mr.css, so the overlay is
     correct even on a page whose stylesheet has not arrived yet. */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      ".mr-gate{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;" +
      "justify-content:center;padding:24px;background:#16283C;" +
      "font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif}" +
      ".mr-gate-box{width:100%;max-width:390px;background:#fff;border-radius:10px;" +
      "padding:30px 32px 26px;box-shadow:0 18px 50px rgba(0,0,0,.3)}" +
      ".mr-gate-box h1{margin:0 0 6px;font-size:21px;color:#1B2733;" +
      "font-family:Cambria,'Hoefler Text',Georgia,serif;font-weight:600}" +
      ".mr-gate-box p{margin:0 0 18px;font-size:13.5px;line-height:1.55;color:#6B7885}" +
      ".mr-gate-box input{width:100%;box-sizing:border-box;padding:11px 13px;font-size:19px;" +
      "letter-spacing:.22em;text-align:center;border:1px solid #D3DCE4;border-radius:6px;" +
      "color:#1B2733;background:#fff;font-family:Consolas,'SFMono-Regular',Menlo,monospace}" +
      ".mr-gate-box input:focus{outline:2px solid #E8A33D;outline-offset:1px;border-color:#E8A33D}" +
      ".mr-gate-box button{width:100%;margin-top:11px;padding:11px 13px;font-size:14.5px;" +
      "font-weight:600;color:#16283C;background:#E8A33D;border:0;border-radius:6px;cursor:pointer}" +
      ".mr-gate-box button:hover{background:#d8942f}" +
      ".mr-gate-err{margin:11px 0 0;font-size:13px;color:#B23A48;min-height:18px}" +
      ".mr-gate-foot{margin:17px 0 0;font-size:11.5px;line-height:1.5;color:#98A5B2}" +
      "html.mr-locked body>*:not(.mr-gate){display:none !important}";
    (document.head || document.documentElement).appendChild(s);
  }

  function build() {
    var wrap = document.createElement("div");
    wrap.className = "mr-gate";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "mr-gate-h");

    var box = document.createElement("div");
    box.className = "mr-gate-box";

    var h = document.createElement("h1");
    h.id = "mr-gate-h";
    h.textContent = "Morning Report";

    var p = document.createElement("p");
    p.textContent = "Enter the code to open the tools. Your browser will remember it.";

    var input = document.createElement("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Code");
    input.placeholder = "••••";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Open";

    var err = document.createElement("p");
    err.className = "mr-gate-err";
    err.setAttribute("role", "status");

    var foot = document.createElement("p");
    foot.className = "mr-gate-foot";
    foot.textContent =
      "This keeps the page tidy, not secret. Nothing about any resident is stored on this " +
      "page — the roster lives in your data folder and behind its own key.";

    function tryIt() {
      if (input.value.trim() === CODE) {
        remember();
        open();
        return;
      }
      err.textContent = "That is not the code.";
      input.select();
    }

    btn.addEventListener("click", tryIt);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") tryIt();
      else err.textContent = "";
    });

    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(input);
    box.appendChild(btn);
    box.appendChild(err);
    box.appendChild(foot);
    wrap.appendChild(box);
    return { wrap: wrap, input: input };
  }

  function open() {
    document.documentElement.classList.remove("mr-locked");
    var el = document.querySelector(".mr-gate");
    if (el) el.remove();
  }

  function lock() {
    injectStyle();
    document.documentElement.classList.add("mr-locked");

    function mount() {
      if (document.querySelector(".mr-gate")) return;
      var built = build();
      document.body.appendChild(built.wrap);
      try { built.input.focus(); } catch (e) { /* not focusable yet */ }
    }

    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount);
  }

  if (!passed()) lock();

  global.MRGate = {
    passed: passed,
    forget: forget,
    /* Exposed so the tests can drive it without hardcoding the value in
       two places, and so a page can offer "sign out of this device". */
    code: function () { return CODE; }
  };
})(window);
