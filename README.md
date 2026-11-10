# Sage Project

Pediatric ID & Antimicrobial Stewardship Intelligence Platform.

## Hosting

**GitHub Pages** — deployed from `main` branch at [wowzersyea.github.io/Sage-Project](https://wowzersyea.github.io/Sage-Project/).

Changes pushed to `main` go live automatically via GitHub Pages. There is no build step — the site is static HTML served directly.

## Structure

```
index.html                    # Landing page
literature-monitor/           # Bi-weekly literature digest viewer
  index.html                  # Digest UI
  digests/                    # JSON digest data files
qi-dashboard/                 # QI metrics & run charts
asp-advisor/                  # Empiric therapy calculator
podcast/                      # RSS feed for Sage Podcast
mission-control/              # Operations overlay (localhost only)
```

## Deployment

1. Edit files locally
2. Commit and push to `main`
3. GitHub Pages deploys automatically (usually within 1-2 minutes)

No build tools, no CI pipeline needed — just push.

## Related Repos

| Component | Location | Purpose |
|-----------|----------|---------|
| sage-db | `F:\Coding\sage-db` | Database helpers, PubMed client, digest generator |
| sage-qi-dashboard | `F:\Coding\sage-qi-dashboard` | Canonical QI dashboard dev repo (mirrored here) |
| mission-control | `F:\Coding\mission-control` | Next.js operations dashboard (localhost:3000) |

## Morning Report access

Morning Report opens without a page passcode. The homepage focuses on role cards,
the presenter template, and the board. Draw Discussants is retained under
`morning-report/archive/` (Parked tools), and its existing URL still works.

Visitors do not fetch a resident list or rota automatically. The archived draw
can use a folder the user connects or an endpoint and key they explicitly
configure. Existing private files and shared-sheet data are retained. The built-in
endpoint remains available for de-identified board/session storage; its server
settings and deployment are managed separately from this static site.

Verify changes with `node morning-report/tests/access.test.js`,
`node morning-report/tests/remote.test.js`, and `node morning-report/tests/site.test.js`
while serving the repository at `http://localhost:8899`.
