# Security fixes: staged rollout and verification

These changes were prepared from main at `3e44e9e` on October 23, 2026. Source changes do not rotate deployed credentials or update Apps Script deployments. Do not publish the assessment migration until its backend and faculty access are ready.

## Live status: October 27, 2026

- The owner approved PR #39. It merged as `e6918ee39645d542b6e32ada304409221c481dd8`; GitHub Pages run `40567698235` succeeded. Both deployed files match that commit by SHA-256, and both Chromium security regressions pass against the downloaded live code.
- Cloudflare now redirects apex HTTP requests to HTTPS with status 308 while preserving paths and queries. Apex HTTPS responses have `nosniff`, `strict-origin-when-cross-origin`, and HSTS `max-age=300` without subdomains or preload. `/admin` and `/admin/*` additionally have `private, no-store`, `no-referrer`, and `SAMEORIGIN`. Checks after each rule change passed; the booking embed, assessment link, existing login gates and QI chart still load.
- **Morning Report is explicitly on hold:** the owner said facilitator devices are not configured yet and asked to prepare but wait. Both anonymous-access properties remain `yes`; neither the script nor its deployment was changed. Do not switch them until facilitator readiness is confirmed.
- The owner supplied three faculty email addresses. They are saved in the separate reusable Cloudflare policy `Sage faculty - pending rollout`, with a 12-hour session duration and zero application assignments. The existing Cloudflare Access application protects Workbench only; its policy was not modified. Assessment secrets have not been rotated and the private API migration remains draft.
- The actual assessment app is `wowzersyea/Sage-app` (`F:/peds-id-assessment` locally), running Next.js with SQLite and Resend. Its current source and README show that the Google Sheets writer was removed. It is not an active collector writer in that source; inventory retained/cached legacy pages before retiring collector access. A separate framework security upgrade is being tested in an isolated checkout; no assessment process has been restarted.
- Origin TLS remains a separate issue: certificate validation directly against all four configured Pages origin IPs fails hostname verification. GitHub's Pages API does not include certificate information for this repository, so it does not establish certificate-provisioning status. Cloudflare currently uses Full. Do not enable Full (strict) until origin certificate provisioning and hostname verification pass, or requests could fail. The edge HTTPS certificate is valid.

Account inventory was read-only: Morning Report has one active Version 8 deployment (August 26, 2026); the collector has one active Version 5 deployment (August 21, 2026), with no Script Properties configured. Editor source matched the legacy main-branch files; editor contents alone do not prove an active deployment's source. Historical deployments still need review during credential retirement.

## Release 1: browser rendering

[PR #39](https://github.com/wowzersyea/Sage-Project/pull/39) fixes unsafe rendering in the faculty dashboard and QI interface while preserving their existing backend/login interfaces. It also clears displayed learner data on lock and failed refresh. Its Chromium tests exercise malicious stored text and normal filter/detail/removal controls. It can be reviewed and released independently of the authentication migration.

Follow the repository's CODEOWNERS approval and CI requirements. After release, verify the faculty filters, opening/closing a result, lock, QI project cards, and intervention removal. Use synthetic records in staging for editing and submission tests. Rolling back this release would reopen the rendering vulnerabilities; prefer a narrow corrective change.

## Release 2: private APIs and authenticated assessment access

This release has dependencies across Google Apps Script, Cloudflare, static pages, and potentially the separate assessment application. Keep it in draft until every dependency is ready. Existing cached tabs may still call old endpoints; coordinate the transition outside an active assessment session and ask facilitators to reload after the cutover. A simultaneous cross-service rollout cannot be guaranteed to have zero interruption.

### Assessment preparation

1. Identify the Apps Script project and every still-active deployment of the collector. Inventory clients writing to it, including cached legacy pages. The October 27 inventory found that `test.sageproject.xyz` now uses the separate `wowzersyea/Sage-app` SQLite backend and its source no longer writes to Google Sheets. `scripts/resident-saveToSheets.ts` is only an optional integration template, not proof of a deployed caller.
2. Create a staging Sheet and Apps Script deployment containing `scripts/sheets_webhook.gs`. Set its `SPREADSHEET_ID` to the staging Sheet before deployment. Configure independent random secrets of at least 32 characters in Script Properties: `ASSESSMENT_ADMIN_KEY` and `ASSESSMENT_WRITE_KEY`. Never commit them. The owner must enter replacement credentials in the account UI or a secure CLI workflow.
3. Prepare `cloudflare/assessment-api.mjs` with `cloudflare/wrangler.assessment.jsonc`. Set `ASSESSMENT_ENDPOINT` to the correct deployment URL and store the matching read/write keys as Worker secrets. Keep staging on a separate hostname and route; do not use the production route from the sample config for staging.
4. Create a Cloudflare Access application covering the faculty page and `/assessment-api/admin`. Restrict it to the intended faculty identities. Set `ACCESS_TEAM_DOMAIN` to the team's HTTPS issuer and `ACCESS_AUD` to that application's audience. The Worker verifies the JWT signature, issuer, audience, expiry, subject and email using [Cloudflare's validation requirements](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/). An email header alone is insufficient.
5. Keep `/assessment-api/submit` available to learners. Its required rate limiter is 120 requests per minute per connecting IP so a cohort sharing hospital WiFi can submit together. Verify the intended cohort size in staging. This is approximate edge throttling, not a global quota or identity check; see the [rate-limit binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
6. Any separate server integration must supply the private write key and a stable submission ID before the protected collector is activated. Update its callers of `saveResidentToSheets` accordingly. Do not cut off a still-active external writer without migrating it.

### Assessment staging checks and cutover

- Submit synthetic examples from all four retained assessment producers and any separate resident app. Confirm one durable summary per submission ID, correct zero scores, and unchanged grading/display. The legacy client-computed practice scores are not authoritative server grading.
- Repeat a successful request with the same ID and contents: one row and one faculty notification must remain. Reusing the ID for different contents must fail. Optional detail-sheet/mail failures must not erase the durable summary record.
- Simulate timeout, 429 and 502 responses: the page must show an unconfirmed submission and retain its queue for retry. Multiple pending attempts must survive in the tab. Closing the tab can discard the queue; it is not durable offline storage.
- Confirm faculty sign-in, filtering, detailed review, refresh, logout, expired login, and history restoration. Unauthenticated, expired, wrong-issuer, wrong-audience and forged tokens must not retrieve results.
- Confirm direct Apps Script reads with no key or an old published key are rejected. Direct writes without the new private write key must fail. Use only synthetic data for write tests; do not send test emails to learners.
- Student CC delivery is intentionally removed because ownership of submitted addresses was not verified. Faculty notifications remain. Restoring learner copies requires a verified recipient workflow.
- Once staging and client migration pass, configure production properties/secrets, update the existing Apps Script deployment, deploy the Worker, and publish the frontend as a coordinated release. Revoke every historical read credential and retire old deployments accepting one. Removing text from Git does not revoke a credential.

### Morning Report

The owner's chosen policy is private roster access as well as private documents and edits. `MR_KEY` now gates all roster, rota, draw, document, PDF, collection and recording operations. The old `MR_PUBLIC_ROSTER` and `MR_PUBLIC_SAVE` properties are ignored by the new code; delete them in the account as immediate containment when facilitators have been prepared.

The owner explicitly deferred this access switch on October 27 because facilitator devices are not ready. Keep the code prepared and the current production flags unchanged until that prerequisite is met.

1. Verify a trusted facilitator's existing `MR_KEY` and endpoint are configured in Morning Report Settings. The settings page prefills the built-in endpoint so entering the key is sufficient. Do not distribute it in public links or the repository. Publicly shared feedback links must use the separate feedback key.
2. Test the new Apps Script against a staging spreadsheet and Drive folders: keyless/wrong-key requests deny access; the facilitator key reads the roster, saves and retrieves documents, renders a PDF, records/replaces a draw, collects audio, and acknowledges collection. Replacing one site's draw must preserve the other site's rows.
3. Verify the feedback key submits feedback but cannot read the roster or records. Feedback has a 45,000-character record bound, at most four clips, a 10 MiB aggregate base64 bound, and the existing per-clip bound. These limits protect request size; they do not by themselves authenticate attendees or prevent all quota abuse.
4. Verify only files both registered in the feedback post box and located in its audio folder can be read or trashed through collection. An unrelated owner-accessible Drive ID must fail.
5. During a coordinated session transition, update the existing Apps Script deployment and publish the matching client changes. Authenticated clients keep the same endpoint/key protocol. Devices formerly using anonymous access must enter the facilitator key; this is an intentional access change. Local data folders continue to work.

## HTTPS and browser headers

These are hosting-account changes, not settings a GitHub Pages HTML file can enforce securely. Prepare them in Cloudflare after checking HTTPS on the relevant hosts.

- Add a redirect from HTTP to HTTPS on `sageproject.xyz`, preserving paths and query strings. A host-specific redirect avoids changing unrelated hostnames. Alternatively, [Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/) applies throughout the zone; use it only after validating every active hostname.
- Verify `/`, `/admin/`, `/morning-report/`, the booking integration, and assessment redirects. Confirm valid certificates and no loops before enabling HSTS. Start with a short lifetime on the validated host, without `includeSubDomains` or preload until all subdomains are verified.
- Add `X-Content-Type-Options: nosniff` and an appropriate referrer policy. For the faculty route, set `Cache-Control: private, no-store` and framing restrictions. Avoid a blanket frame policy that breaks intentional booking embeds.
- Test a route-appropriate CSP in report-only mode before enforcing script restrictions; these pages contain inline scripts and use external integrations. The API already uses no-store and nosniff. Repository changes alone do not install edge headers.

## Validation and release gates

With Node 22 and Python 3.11+:

```text
npm ci
npx playwright install chromium
python -m http.server 8899 --bind 127.0.0.1
```

In another terminal, from the repository root:

```text
npm test
npm run test:morning-report
python -m pip install -e "./morning-report-cli[dev]"
python -m pytest morning-report-cli/tests
python scripts/validate_repo_governance.py
npx wrangler@4.131.0 deploy --dry-run --config cloudflare/wrangler.assessment.jsonc
```

CI runs the browser, Apps Script, CLI, syntax and governance tests, plus checksum-verified Gitleaks with redacted output. The Firebase browser identifier is explicitly marked public; its presence does not establish database authorization. Firebase rules, account access policies and the separately hosted test/booking backends still require their own account-side verification. The scanner checks current source, not all Git history.

After deployment, run `node scripts/smoke-security.mjs`. Set `SAGE_MR_ENDPOINT` and `SAGE_ASSESSMENT_ENDPOINT` locally to include direct-backend anonymous checks. This script performs only GET/HEAD requests and emits status summaries, never response records or keys. Separately verify authorized flows using staging synthetic records and a faculty sign-in.

Do not mark the security migration complete until account configuration, credential revocation, deployed-version verification, authorized smoke checks and anonymous denial checks all pass. Monitor the first 30 minutes per the repository's release procedure. If an authenticated flow fails, preserve its data and fix or narrowly roll back the affected frontend; do not re-enable anonymous access or a disclosed credential as a fallback.
