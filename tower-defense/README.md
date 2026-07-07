# Immunopolis: Sage Defense

A self-contained HTML5 tower-defense game, themed to the Sage Project — you defend the body against waves of pathogens using immune and antimicrobial "towers."

Play locally by opening `index.html`, or (once deployed to GitHub Pages) at
`https://wowzersyea.github.io/Sage-Project/tower-defense/`.

No build step, no dependencies — a single `index.html` (HTML + CSS + Canvas JS).

## Design

The mechanics are drawn from the top-ranked Google Play tower-defense games
(Bloons TD 6, Kingdom Rush, Plants vs. Zombies):

- **Branching upgrade paths** — every tower has two paths of three tiers each.
  You can't fully max both, so each placement is a build decision, not just a
  position. (Bloons/Kingdom Rush style.)
- **Storyline campaign** — five hand-crafted chapters (Bloodstream → Lymph Node →
  Deep Tissue → Bone Marrow → The Heart) with narrative intro cards, a boss
  finale, and a twin-boss last stand — plus an **Endless mode** (Septic Surge)
  with open-ended scaling, a superbug every 10th wave, and a saved personal
  best.
- **Upgradable weapons** — five tower types (Macrophage, Neutrophil, Antibiotic
  Battery, T-Cell Sniper, Fever Coil), each with distinct roles: single-target,
  splash (ground-only — it cannot target flying viruses), damage-over-time,
  long-range burst, and crowd-control.
- **Dual currency** — earn **gold** in battle to build/upgrade, and spend
  premium **tokens** (💎) to *rush* upgrades instantly and power hero abilities,
  mirroring the convenience-currency model common to mobile TD games.
- **Token Vault** — the token hub: claim a daily booster and see how tokens are
  earned. All tokens are earned in-game (no purchases — Google Play policy
  forbids real-money price tags without Play Billing; `grantTokens()` is the
  hook if real Play Billing is wired in later). Balance and campaign progress
  are saved via `localStorage` with type-validated loading.
- **Hero abilities** — Immunoglobulin Strike (AoE burst) and Fever Spike (mass
  freeze), on cooldown and token-gated.

## Controls

- Tap a build slot (`+`) to place a tower; tap a tower to upgrade, rush, or sell.
- **Start Wave** (or `Space`) to send the next wave.
- Speed toggle cycles 1× / 2× / 3×.
- Ability hotkeys: `1` = Immunoglobulin Strike, `2` = Fever Spike.

## Enemies

Bacteria, Strep chains, MRSA clusters, flying Viruses (which slip past
Neutrophil bursts), Fungal spores, Biofilms (heavily armored), and a
Pan-Resistant Superbug boss. Armor, flying, and slow/stun resistances make
tower variety matter. Wave compositions are generated from a fixed per-level
seed, so levels play the same on every device and replay.

## PWA & Offline

The game is an installable PWA: `manifest.webmanifest` (landscape, standalone,
192/512 + maskable icons in `icons/`) and `sw.js`, a cache-first service worker
that makes the game fully playable offline after the first visit. Bump
`CACHE_VERSION` in `sw.js` whenever a shell file changes. Synthesized WebAudio
sound effects (no binary assets) with a persistent mute toggle.

## Packaging for Google Play (TWA)

The repo ships the web prerequisites; producing an `.aab` requires the Android
tooling below (not part of this repo):

1. **Deploy to HTTPS** — merge to `main`; GitHub Pages serves
   `https://wowzersyea.github.io/Sage-Project/tower-defense/`.
2. **Wrap as a Trusted Web Activity** with
   [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap):
   `npx @bubblewrap/cli init --manifest="https://wowzersyea.github.io/Sage-Project/tower-defense/manifest.webmanifest"`
   then `npx @bubblewrap/cli build` (needs JDK + Android SDK; Bubblewrap can
   install both).
3. **Digital Asset Links** — publish the generated
   `.well-known/assetlinks.json` (with your signing key's SHA-256) at the
   site root so the TWA opens full-screen without browser chrome.
4. **Play Console** — create the app; complete the **Data safety** form
   (data collected: none on-device; analytics: GA4 anonymous usage), the
   content-rating questionnaire, and link the privacy policy at
   `tower-defense/privacy.html`. New personal accounts must run a closed test
   (12+ testers for 14 days) before production access.
5. **Monetization** — the game currently has **no purchases** (all tokens
   earned in-game), so no Play Billing integration is required. If paid token
   packs are added later they MUST go through Google Play Billing; wire
   purchases through `grantTokens()` in `index.html` and re-answer the Data
   safety form.

Store-listing assets are pre-generated in `store/`: a 1024×500 feature
graphic and four 1920×1080 screenshots (gameplay, upgrades, campaign,
endless boss wave). Still needed: 7"/10" tablet screenshots if targeting
tablets, and the short/full store descriptions.
