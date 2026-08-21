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

## 0.5 The reference game was misread, and it is not Dead or Alive

The `/goal` brief says: *"here is wanted dead or alive
https://www.youtube.com/watch?v=RgwClSrW8y0 review it and get our animation to
this level."*

That was read as "here is [what I] wanted: Dead or Alive" — NetEnt's 2009
western — and every animation and audio note in this project since was written
against that game. It is the wrong game. The linked video is titled **"How to
Play Wanted Dead or Wild Slots and WIN BIG"**. The operator was naming the
game: Hacksaw Gaming's **Wanted Dead or a Wild** (2021). "Wanted" is the first
word of the title, not a verb.

This matters beyond a citation, because the two games want opposite things:

| | Dead or Alive (NetEnt, 2009) | Wanted Dead or a Wild (Hacksaw, 2021) |
|---|---|---|
| Era | pre-mobile, 9 lines | modern, 12,500x max win |
| Signature | sticky wilds in free spins | whole REELS turning wild, and DUEL/RAILROAD/DEAD modes |
| Multiplier shape | fixed 2x-3x per sticky wild | multipliers stacked into a running total |
| Read across a room | subdued sepia | saturated red columns, deliberately loud |
| Audio | period western stems | modern produced stems, heavy sub, hard transients |

**What was checked against the actual reference.** Ninety-five frames were
extracted from the linked video. Its multiplied reels are a saturated red block
readable at a glance from across a room. Ours were `#5A2408` into near-black — a
dark desaturated brown — and, worse, they were *binary*: a x2 row was painted
identically to a x25 row, so the number in the rail was annotating the grid
rather than describing it. The heat now scales with the multiplier on a log
curve, and a screenshot-reading test holds it there.

**What is still open, and it is a mechanic question rather than a paint
question.** The reference's identity is columns — a whole reel goes wild and
sticks. Ours is rows — a horizontal band takes a multiplier. Matching the
reference's *feel* by adjusting colour is the cheap half; whether the mechanic
itself should be reconsidered is the operator's call, not a rendering decision,
and it is a maths change (new strips, fresh RTP verification) rather than a
front-end one.

**The pattern this belongs to.** Three faulty instruments are recorded further
down this file — the mane, the IPFS fetch, the blink fur sample — each one a
measurement mistaken for a property of the world. This is the same class of
error one level up: a misparsed sentence taken as a settled premise and never
re-checked against the artefact it pointed at. The link was in the brief the
whole time.

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

## What is left, and it is art rather than code

The presentation systems are built and measured. Reel motion is drawn on canvas
with velocity-proportional blur; the spin curve is solved rather than tuned
(peak velocity provably equals cruise, deceleration monotonic, overshoot 2.5%,
landing exact); wins use a three-beat character animation with a specular sweep
composited inside the symbol's own alpha; the row multiplier turns its row hot
at reel scale; the win ladder has four tiers; features are staged as a set piece
and sold from a priced menu.

The remaining gap is that **the twelve Lions are static portrait PNGs**, and no
amount of further engineering changes that. This was tested rather than assumed:

* **Mesh deformation was built twice and rejected twice.** Horizontal slices
  with a travelling sine moved the muzzle along with the mane -- shearing rigid
  cartoon line art reads as the lion melting. Splitting each slice into three so
  the displacement could fall off horizontally held the face still and left hard
  vertical seams down the cheek and tongue. Both were rendered and inspected
  before being reverted. A continuous mesh needs many columns with smoothly
  varying offsets, and tile-based warping seams regardless without WebGL and a
  real mesh.
* **A silhouette "breathe" was tried and rejected.** Compositing a slightly
  enlarged copy of the sprite BEHIND the original leaves the face untouched and
  lets only the outer edge peek out, which on a lion is mostly mane -- no
  isolation needed, no shearing possible. It reads correctly where the silhouette
  is fur and fails wherever it is hardware: on the Crown lion the halo emerges as
  a second gold rim above the first, and the same doubling appears on hats, horns
  and ears. The effect cannot tell fur from object, and half this cast is wearing
  something.
* **What DID work is anatomy-free.** A specular band travelling across the
  symbol, clipped by `source-atop` to its own alpha, changes the artwork's
  appearance over time without displacing a pixel. That shipped. Anything
  anatomy-AWARE cannot be applied uniformly, for a reason specific to this cast.

Three techniques were tried against the static art. One shipped. The two that
failed did so for the same underlying reason: an effect applied uniformly to a
flat composite cannot distinguish the parts of a lion from each other.

### What eventually worked, and the rule it exposed

A fifth route SHIPPED, and it reframes every failure above: **separate a layer
and move it rigidly; never deform the composite.**

Lazy Lions render in flat vector colour, so a mane is one RGB value rather than
a gradient, and it sits BEHIND the head. That makes it liftable. The mane is cut
out at build time as its own image, grown slightly so it stays tucked under the
jaw, and shipped alongside a base with a mane-shaped hole. On a win it swings
about a low pivot, LAGGING the roar rather than matching it -- appendages arrive
late and leave late, and a mane moving in step with the head is just a bigger
head. Face, crown, glasses and mouth hold still. No shear, no seam.

Six of twelve ship a mane layer: Crown #4230, LAZY Hat #5216, Shades #4522,
Leopard Coat #482, Bucket Hat #4837, Pirate Hat #4117. The other six hold still
on purpose -- White, Black, Brown, Fire and Emerald manes cannot be told apart
from outline and shadow in flat-shaded art, and a still mane is a far smaller
defect than a face that moves with it.

The colours are DECLARED, not detected. Detection was built and abandoned: tuned
one way it read the LAZY lion's cap as its mane; tuned another it merged the
orange lion's mane with its orange face at 39% coverage; a guard against that
rejected two good lions and kept the one bad one, because `character` and `bust`
crops do not frame the face at the same place. Twelve symbols do not need a
classifier.

**The rule this exposes:** the question is not "is this anatomy-aware" but "is
there a layer to LIFT". A mane is a large region of its own flat colour, so
there is. That is the test to apply to any future effect.

A fourth route was checked and closed: **the frames cannot be sourced from the
collection itself.** If a Lion existed that differed from one of ours in ONLY
the Eyes trait, it would be a blink frame drawn by the original artist. Across
all 9,999 collection entries there are **zero** such single-trait eye variants
for any of the twelve symbols -- the trait space is combinatorial enough that an
exact match on the other seven categories essentially never occurs. The frames
have to be drawn.

### The multiplier files were never received, and here is the proof

This was reported for many rounds as "not on this machine", which was true but
weak: absence from a filesystem does not prove absence from the conversation,
and the operator's own images arrive as message attachments rather than as files
on disk. Two filesystem sweeps were the wrong instrument for the question.

The right instrument is the session transcript, which records every attachment
as base64. Scanning all 6,525 lines of it, from 2026-08-11 to 2026-08-21, the
operator sent exactly **two distinct images** in the entire project history:

| what | when | used as |
|---|---|---|
| Lion #5216, "Lazy Butt" full-body render | attached to the `/goal` command | P2, the LAZY Hat symbol |
| Lion #4230, the Crown lion | sent three times, 04:42 / 05:24 / 12:16 | P1, the top symbol |

No video. No multiplier art. No document, archive or non-image upload of any
kind -- the only `type=file` attachments in the transcript are project files
already in this repo.

Two details are worth keeping. The `/goal` message states "I have attached a
video" and "i have also inputed files to be used for the multiplier", and
**only the single Lion image accompanied it** -- so at least two intended
attachments did not survive that send. And the Crown image was sent three
separate times, byte-identical on each (md5 554600f2...), which is what
re-sending looks like when someone believes an attachment has not landed.

So the multiplier art is not lost, mislaid, or somewhere this session cannot
reach. It never arrived. The row-multiplier mechanic is built, calibrated to
0.97 RTP and covered by tests; it draws procedural orbs (`svgOrb`) purely
because there is no supplied art to draw instead. Re-sending the files -- ideally
one per message, given the evidence above -- is all that is needed.

### Cub Cluster's trait crops, and a blocker I invented

Found by screenshotting the board rather than testing around it, the same way
the off-centre playfield was found.

The Lion set was deliberately re-cast as twelve WHOLE Lions because trait crops
do not work as slot symbols: a floating hat on a background has no silhouette,
so at reel size the grid stops being scannable at a glance. Cub Cluster never
got that treatment. Two of its six symbols were still region crops --
`Headgear::LAZY Hat` and `Mouth::Money Mouth` -- and on the board they read
exactly as the Lion crops did: clip art, with the cap's lettering clipped by the
tile edge on several cells.

**I first recorded this as unfixable, and that was wrong.** The claim was that
whole-Cub art could not be fetched because every IPFS gateway returned 403
through the agent proxy. That test used Python's `urllib`, which does not pick
up the proxy configuration. `curl` -- which is what the builder actually uses --
fetches from `ipfs.io` and `pinata` without trouble. The blocker was in the test,
not the environment, and the fix took one rebuild once that was understood. The
lesson is the same one that runs through this whole file: check the tool before
believing what it reports.

Both mids are now whole Cubs, chosen for silhouette and colour separation from
the two premiums -- neither wears a Crown (P1) or a LAZY Hat (P2), and neither
has a red mane (P2):

| | token | trait | reads as |
|---|---|---|---|
| CUB:M1 | #14147 | Bucket Hat | tan Cub, orange bucket hat, water goggles |
| CUB:M2 | #1458 | Police Hat | white Cub, striped cap, blue shades, bubble gum |

One real trap surfaced on the way. #1458 first cached as exactly 5,242,880
bytes -- a clean 5 MiB, which is a gateway cutting the stream, not an image.
The builder's `decodes_fully()` caught it and said so rather than shipping a
half-drawn tile, which is precisely why that check exists.

### What each Lion actually does, and why the rest do not

Every symbol has motion. All twelve idle -- a bob and sway on staggered phases
and periods -- and all twelve perform the seven-stop squash-and-stretch roar on
a win. The three layers below are ADDITIONAL, and are the ones the art has to
cooperate with.

| | mane | blink | tongue |
|---|---|---|---|
| P1 Crown #4230 | yes | — | yes |
| P2 LAZY Hat #5216 | yes | yes | yes |
| P3 Shades #4522 | yes | — | — |
| P4 Leopard Coat #482 | yes | — | — |
| M1 Bucket Hat #4837 | yes | — | — |
| M2 Monocle #840 | — | — | — |
| M3 BTC Eyes #5813 | — | — | — |
| M4 Sheriff #1506 | — | — | — |
| L1 Police Hat #2038 | — | — | — |
| L2 Horns #1725 | — | yes | — |
| L3 Pirate Hat #4117 | yes | yes | — |
| L4 Black Cap #5348 | — | yes | — |

The two top-paying symbols carry the most, which is where the attention is.

**Why the four bare ones stay bare.** Each was attempted and measured, not
assumed. The test for a mane is whether its colour takes the muzzle: a mask that
catches more than about 4% of the muzzle box is taking face, and swinging it
would drag the mouth along.

* **M2 Monocle** — the Fire mane is a gradient, not a flat colour, and the best
  single candidate catches **8.9% of the muzzle**.
* **M3 BTC Eyes** — the orange top knot is very close to the orange face:
  **15.8% of the muzzle**, which is the same over-capture that showed up as 39%
  tile coverage during detection.
* **M4 Sheriff** — a white mane on a white face. The mane candidate IS the face
  colour. Its blink was also built and rejected: a lid on white fur with heavy
  dark linework reads as a grey block.
* **L1 Police Hat** — the Emerald mane is spread over at least three teal shades
  totalling about 6.5% of the tile, and its darker portions are the same value
  as its dark face. Even at a tolerance of 120 the mask reaches only 13.3%,
  below the working floor, and widening further starts taking other things.

Blink and tongue have their own gates: three Lions wear opaque hardware over
their eyes, two have symbol eyes that should not blink, two sit behind lenses,
and only the two Money Mouth Lions have a tongue to lift at all.

These are properties of the source art. Nothing in the pipeline fixes a mane
that is the same colour as the face it sits on -- that needs a different Lion or
a drawn frame.

### The blink, and being wrong about it twice

It ships. Four Lions blink: LAZY Hat #5216, Horns #1725, Pirate Hat #4117 and
Black Cap #5348.

This file previously argued the blink was the one thing that genuinely needed a
drawn frame, because a lid "does not exist anywhere in the source; it has to be
invented". The argument was wrong, and the evidence for it was a bug. That
attempt filled the lid with fur sampled a few pixels ABOVE the eye, which in
this art is the black brow line every time, so it rendered two dark bars and
read as redaction. The failure was in the sampling.

Sampling BETWEEN the eyes -- the one place on the face guaranteed to be neither
mane nor outline -- gives the true fur colour, and a curved lash line on the
lid's leading edge is what turns a patch of fur into a closed eye. The result
reads as drawn, and the muzzle, mane and headgear never move.

Eye boxes are DECLARED, not detected, for exactly the reason the mane colours
are: detection finds a clean symmetric pair on one of the twelve. It reads the
LAZY Lion's cap lettering as eyes and returns twenty candidate blobs for the
white Sheriff, whose whole face is white.

Eight of the twelve do not blink, and each for a stated reason: Shades #4522,
Leopard Coat #482 and Police Hat #2038 have opaque hardware over their eyes;
Bucket Hat #4837 and BTC Eyes #5813 have symbol eyes that should not blink;
Crown #4230 and Monocle #840 sit behind lenses; and Sheriff #1506 was BUILT AND
REJECTED on inspection -- against white fur with heavy dark linework the lid
reads as a grey block rather than a closed eye.

Blinks fire one cell at a time on an uneven timer and never while the reels are
moving. Twenty animals blinking together reads as a strobe, which is the same
lockstep problem the idle bob solves with staggered phases.

**The pattern worth keeping.** Three times in this project something was called
impossible and was not: the mane (deforming failed, lifting a layer worked), Cub
Cluster's crops (the IPFS test used a client that ignores the proxy), and now
the blink (the fur sample hit an outline). Every one was a faulty instrument
read as a property of the world. When this file says something cannot be done,
check what was actually measured.

### The brief

Twelve symbols. For each: an **idle loop** (2-4s, seamless) and a **win
reaction** (600-900ms). House style is Lazy Lions as drawn; the game reads the
frames, it does not restyle them.

Deliver as a horizontal sprite sheet per symbol, frames of equal size, plus a
JSON sidecar giving frame count and duration. The renderer already draws symbols
from pre-scaled offscreen canvases (`sprite()` in play/index.html), so a sheet
drops in where the single frame is cached today -- the change is the cache key
gaining a frame index, not a new pipeline.

Six of the twelve want a blink in the idle. The other six want something else
entirely, and deciding what is the job.
