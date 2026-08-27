/* The same-origin corridor to the shared sheet.

   Every browser request to sageproject.xyz/mr-api is forwarded, by
   Cloudflare, to the Apps Script endpoint — so a device never talks
   to script.google.com itself. That matters because institutional
   networks (hospital WiFi among them) routinely block script.google.com
   wholesale, and a blocked fetch reads as "shared roster unavailable"
   on a phone that did nothing wrong.

   This holds no key and adds no authority: it forwards exactly what it
   was sent, and the endpoint applies the same rules it would have
   applied to a direct call. The site falls back to calling the
   endpoint directly if this route is ever absent, so deleting this
   file degrades rather than breaks. */

const EXEC = "https://script.google.com/macros/s/AKfycbyNyxxrMQyryOtc0wvxiafjmSW-kCpZjHGWbljHvpgI11xL6f3qfRn_OxxCkVqgJn0m/exec";

export async function onRequest({ request }) {
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
}
