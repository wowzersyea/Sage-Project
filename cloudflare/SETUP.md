# The /mr-api corridor — one-time setup

The site tries `sageproject.xyz/mr-api` first for every shared-sheet
request and falls back to Google directly when the route is absent.
This makes the wheel and saving work on networks that block
script.google.com (hospital WiFi). Nothing breaks while it is unset up.

1. Sign in at **dash.cloudflare.com**.
2. **Workers & Pages → Create → Create Worker.** Name it `mr-api`,
   press Deploy (the hello-world is fine for now).
3. **Edit code** → delete everything → paste all of
   `cloudflare/mr-api-worker.js` from this repository → **Deploy**.
4. Back on the Worker's page: **Settings → Domains & Routes →
   Add → Route.** Zone: `sageproject.xyz`. Route: `sageproject.xyz/mr-api*`.
5. Verify: open `https://sageproject.xyz/mr-api` in a browser — it
   should show JSON that starts with `{"status":"ok"` and the roster.

To switch it off, delete the route. The site falls back on its own.
