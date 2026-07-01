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
- **Storyline campaign** — three hand-crafted levels (Bloodstream → Lymph Node →
  Deep Tissue) with narrative intro cards and a boss finale.
- **Upgradable weapons** — five tower types (Macrophage, Neutrophil, Antibiotic
  Battery, T-Cell Sniper, Fever Coil), each with distinct roles: single-target,
  splash, damage-over-time, long-range burst, and crowd-control.
- **Dual currency** — earn **gold** in battle to build/upgrade, and spend
  premium **tokens** (💎) to *rush* upgrades instantly and power hero abilities,
  mirroring the convenience-currency model common to mobile TD games.
- **Token Vault** — a mock in-app-purchase store to top up tokens. Purchases are
  **simulated locally** (no real payment); balance and campaign progress are
  saved in the browser via `localStorage`.
- **Hero abilities** — Immunoglobulin Strike (AoE burst) and Fever Spike (mass
  freeze), on cooldown and token-gated.

## Controls

- Tap a build slot (`+`) to place a tower; tap a tower to upgrade, rush, or sell.
- **Start Wave** (or `Space`) to send the next wave.
- Speed toggle cycles 1× / 2× / 3×.
- Ability hotkeys: `1` = Immunoglobulin Strike, `2` = Fever Spike.

## Enemies

Bacteria, Strep chains, MRSA clusters, flying Viruses, Fungal spores, Biofilms
(heavily armored), and a Pan-Resistant Superbug boss. Armor, flying, and
slow/stun resistances make tower variety matter.
