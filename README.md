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
