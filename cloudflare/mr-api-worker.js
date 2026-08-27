/* The same-origin corridor to the shared sheet — Cloudflare Worker form.

   The site is GitHub Pages behind Cloudflare, so server code cannot
   live in this repository; it lives as a Worker in the owner's
   Cloudflare account, with a route on sageproject.xyz/mr-api*. This
   file is the code to paste there, kept here so it is versioned.

   Why it exists: institutional networks (hospital WiFi among them)
   block script.google.com wholesale, and a blocked fetch reads as
   "shared roster unavailable" on a phone that did nothing wrong.
   Browsers talk only to sageproject.xyz; this forwards verbatim.

   It holds no key and adds no authority — the endpoint applies the
   same rules it would have applied to a direct call. The site falls
   back to calling the endpoint directly whenever this route is
   absent, so removing the Worker degrades rather than breaks.

   Setup (once, ~5 minutes) — see cloudflare/SETUP.md. */

const EXEC = "https://script.google.com/macros/s/AKfycbyNyxxrMQyryOtc0wvxiafjmSW-kCpZjHGWbljHvpgI11xL6f3qfRn_OxxCkVqgJn0m/exec";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = EXEC + url.search;

    const init = { method: request.method, redirect: "follow" };
    if (request.method === "POST") {
      init.body = await request.text();
      init.headers = { "Content-Type": "text/plain;charset=utf-8" };
    } else if (request.method !== "GET") {
      return new Response(JSON.stringify({ status: "error", message: "GET or POST only." }),
        { status: 405, headers: { "Content-Type": "application/json" } });
    }

    let upstream;
    try {
      upstream = await fetch(target, init);
    } catch (err) {
      return new Response(JSON.stringify({ status: "error", message: "The endpoint could not be reached." }),
        { status: 502, headers: { "Content-Type": "application/json" } });
    }

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  },
};
