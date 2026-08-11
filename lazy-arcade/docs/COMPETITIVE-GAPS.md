# Gap analysis: Pragmatic Play slots, MetaWin Hi/Lo

Benchmarked against Pragmatic Play's scatter-pays titles (Gates of Olympus,
Sweet Bonanza, Sugar Rush) and MetaWin Originals' Hi-Lo, which uses NFT art for
its card faces.

---

## 0. The finding that outranks the rest

**Pragmatic's feel is a volatility product. This spec forbids volatility.**

| | Gates of Olympus | Lazy Arcade spec |
|---|---|---|
| RTP | 96.50% | 97.00% |
| Max win | 5,000x | 2,000x / 2,500x / 1,000x |
| Volatility | very high | **index <= 5.5, "low volatility" mandated** |
| Multipliers | random 2x-500x orbs | none |
| Tumbles | unlimited | ladder caps at 8x |

What makes a Gates of Olympus session memorable is that almost every spin is a
loss and a rare one pays 500x. That distribution *is* the product. Our spec
Sec. 1 mandates the opposite — a low-volatility penny slot where the whole
point is that the bankroll drains slowly.

So a straight "make it feel like Pragmatic" is not a UI task. Chasing it means
either raising the volatility ceiling and max win (a maths and licensing
decision, not a front-end one), or accepting that we match Pragmatic on
*production values* while deliberately differing on *distribution*.

Everything below separates those two. **Presentation gaps are worth closing
outright. Distribution gaps need a decision first.**

The `VOLATILITY_PROFILE` flag already exists for exactly this: the paytable
loader accepts alternate strip sets, so a HIGH profile is a data swap, not a
code change. What it needs is a mandate, new strips, and a fresh 250M+
verification run.

---

## 1. Slots vs Pragmatic Play

### Presentation — closable without touching the maths

| Feature | Pragmatic | Before this pass | Status |
|---|---|---|---|
| Reels physically spin, stagger, overshoot | yes | none | **DONE** |
| Anticipation on near-scatter | yes | none | **DONE** |
| Win pop + dim losers + count-up | yes | none | **DONE** |
| Big/Mega/Epic escalation + coin shower | yes | none | **DONE** |
| Tumble burst-and-drop | yes | frame swap | **DONE** |
| Cumulative win meter across a feature | yes | no | **DONE** |
| Ambient music bed, not just SFX | yes | SFX only | **DONE** |
| Symbol idle motion | yes (per-symbol animation) | static | **PARTIAL** — subtle float only; true idle loops need animated art |
| In-game info / paytable screen | yes | bench drawer only | **DONE** |
| Autoplay with stop conditions | yes (loss limit, single-win limit) | fixed Auto 100 | **DONE** |
| Round history, replayable | game history | spin log | **DONE** — replays from the seed triple, which Pragmatic cannot do |
| Turbo / quick spin | yes | yes | already had |
| Max-win cap surfaced | yes | yes | already had |

### Distribution — needs a mandate, not a sprint

| Feature | Pragmatic | Ours | Why it is blocked |
|---|---|---|---|
| Random multiplier orbs (2x-500x) | core of the feel | none | Would blow the 5.5 volatility ceiling on its own. This is *the* signature mechanic and it is incompatible with the current spec. |
| Unlimited tumbles | yes | ladder caps at 8x | Same reason: uncapped chains are a variance engine. |
| Free-spin retrigger | yes | deliberately none | Retriggers are the biggest single variance contributor in a feature. |
| Ante bet (+25% stake, 2x scatter chance) | yes | **DONE** | Implementable EV-neutrally; see below. |
| Buy free spins (~100x) | yes | **DONE** | Priced from measured feature EV, see below. |

**Ante bet and Buy Bonus are now implemented and priced from measurement, not
guesswork.** Both must stay EV-neutral or they become an arbitrage on the
bankroll — the same failure mode as the sacrifice packages in spec Sec. 9.3.
Note that buy-bonus mechanics are prohibited in several regulated markets (UK
among them); the feature is behind a flag for that reason.

---

## 2. Rarity Hi/Lo vs MetaWin Hi-Lo

MetaWin's Hi-Lo is a Stake-style instant game: fast rounds, a running
multiplier, cash out whenever, provably fair via server seed / client seed /
nonce, and NFT art on the card faces.

| Feature | MetaWin | Before | Status |
|---|---|---|---|
| NFT art as the card | KILLABEARS | ordinal number only | **DONE** — all 73 owned Lions |
| Running multiplier, prominent | yes | yes | already had |
| Win % shown per option | yes | yes | already had |
| Cash-out button shows the amount | yes | bare "Cash out" | **DONE** |
| Card history strip | yes | none | **DONE** |
| Skip / change the current card | yes | Rarity Swap specced, never built | **DONE** — priced at exact EV |
| Auto-bet | yes | none | **DONE** |
| Provably fair panel | yes | yes | already had |
| Live social feed of other players | yes | none | out of scope for this phase |

### Where ours is already stronger

- **The edge is exact on every offered bet.** `P(dir) x payout(dir) == 0.97` to
  within 1e-9 for all 10,078 ordinals in both directions, asserted by test.
  Most Hi-Lo implementations round the multiplier and quietly leak a few basis
  points.
- **Thin directions are disabled, not capped.** Below 5% probability the bet is
  not offered at all. Capping the payout is the industry norm and it silently
  breaks the stated RTP on exactly the bets players scrutinise hardest.
- **Rarity Swap is priced at exact EV**, so it cannot move RTP either way —
  proven in the harness rather than asserted.
- **Every round replays from its seed triple**, including the deck position.

### Where ours is still weaker

- No live/social layer. MetaWin leans on shared presence; that is a server
  feature, not a client one.
- The owned deck's **rarity ordering is provisional** (token id, not true
  rarity). True ordinals need per-trait counts across all 10,078 tokens —
  `ingest.py --full-collection`. This does not affect odds, which are purely
  positional, but it does mean the portrait at a given ordinal is not yet the
  genuinely n-th rarest Lion.

---

## 3. What remains genuinely out of reach

Honest about the ceiling of a DOM/CSS build:

1. **Per-symbol animation.** Pragmatic symbols have idle loops, win reactions
   and character personality. That is commissioned animated art plus a sprite
   pipeline — not something to fake. The current build adds subtle float only.
2. **PixiJS render layer.** Spec Sec. 3.3 calls for Pixi v8 + GSAP. The
   choreography is now proven in DOM (timings, stagger, anticipation, win
   escalation) and ports directly, but layered parallax backgrounds and
   particle-heavy feature intros want the real renderer.
3. **Licensed WILD art.** Still blocked — no Signature Series is owned.
4. **Audio design.** Synthesised bleeps stand in for a scored soundtrack.
