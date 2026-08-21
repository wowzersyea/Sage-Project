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
| Ante bet | yes | **DONE** | Priced by solving the stake, not the odds — see 1.1. |
| Buy free spins | yes | **DONE** | Priced from measured feature EV — see 1.2. |

### 1.1 The ante bet cannot be "+25% stake for double the scatters"

That formulation does not survive contact with integer strip weights. Pride
carries 4–5 scatters per reel, so the smallest bump available is +1, which
moves the trigger rate about 40% and jumps RTP from 0.91 to 1.05. Nothing lands
on 0.97, and there is no multiplier in between to solve for: k = 1.387 and
k = 1.430 round to identical strips and return identical numbers.

So the solve is inverted — fix the scatter supply at each achievable integer
step, solve the *stake*, which is continuous. `mathsim ante` reports:

| Extra scatter/reel | Return per base bet | Feature frequency | EV-neutral stake |
|---|---|---|---|
| +0 (base game) | 0.97052 | 1 in 102 | **1.0005x** |
| +1 | 1.10973 | 1 in 57 | **1.1441x** |
| +2 | 1.30731 | 1 in 36 | **1.3477x** |
| +3 | 1.57383 | 1 in 24 | **1.6225x** |

The +0 row is a free correctness check: it must come out at 1.0000x, and it
does. If it ever drifts, the base calibration has moved and every row under it
is untrustworthy.

The bench ships the **+1 tier at 1.1441x stake** — cheaper than Pragmatic's
+25% and it nearly doubles the trigger rate.

### 1.2 Buy-feature prices, measured

`mathsim buyprice` measures the EV of one triggered round and prices at
EV / 0.97, so buying returns exactly what spinning for it returns.

| Game | Feature EV per trigger | EV-neutral price | Verified return |
|---|---|---|---|
| Pride | 17.758x | **18.3073x** total bet | 0.97000 |
| Trait Vault | 17.317x | **17.8525x** total bet | 0.97000 |

Two things fall out of this that are worth stating plainly:

- **Pragmatic charges ~100x because their feature is worth ~97x. Ours is worth
  17.8x.** That gap is the volatility ceiling showing up in the shop window: a
  low-variance free-spin round simply is not worth much, so the buy button
  cannot feel like a big decision. This is the clearest single illustration of
  Sec. 0's tension.
- **Trait Vault's buy price was 1.635x, which was faintly absurd** — a "buy the
  feature" button for 1.6x on something that already fired every 7 spins. That
  was never a pricing problem; the price was correct for the feature it priced.
  The Mane Meter has since been replaced by **Lion's Share** (see
  PHASE-0-1-FINDINGS.md §5.2), which fires 1 spin in 57 and is worth **17.3x** a
  bet, so the button now costs 17.85x and represents a real decision. The
  measured RTP after the rework is **0.97000 ±0.00044 over 600M spins**.
- **The gap to Pragmatic narrowed for one game, and the reason is instructive.**
  Trait Vault's feature went from 1.6x to 17.3x without breaking the 97% budget
  or the volatility ceiling, because the return was moved rather than created:
  a rare round carrying sticky row multipliers concentrates the same money into
  a moment. Pride is still a 17.8x feature against Pragmatic's ~97x, and that
  gap is still the volatility ceiling in the shop window.

Both prices are asserted EV-neutral by test, and the bought round is *literally
the same code path* as the spun one — `prideFreeSpins` and `vaultFreeSpins` are
shared between the trigger and the button, so a bought feature cannot silently
diverge from the feature whose EV set the price.

Buy-bonus mechanics are prohibited in several regulated markets (the UK among
them). Ship behind a jurisdiction flag.

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
