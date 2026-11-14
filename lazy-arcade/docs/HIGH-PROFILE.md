# The high-volatility profile

Each slot now has two profiles. **LOW** is the original game, verified as it was
and unchanged. **HIGH** is the reference's distribution -- multipliers,
retriggers, a bonus roughly one spin in 300 to 450, and max wins of 5,000x and
up -- built because COMPETITIVE-GAPS Sec. 0 is right that Pragmatic's feel is a
volatility product a 5.5 volatility ceiling cannot reach.

The page plays HIGH by default; Settings switches profile. Each high game is its
own game id (`pride-high`, `cubcluster-high`, `traitvault-high`), so it draws
its own HMAC stream and its rounds verify on their own. `VOLATILITY_PROFILE` in
`packages/config/src/chain.ts` names the profile production should ship.

## The three games

### Pride, high profile (`games/pride_high.rs`)

The base game is Pride's, unchanged: 5x4, 1024 ways, each reel turning entirely
to Crowns on its own 6% roll. The free-spin round differs:

* **3/4/5 scatters award 10/12/15 free spins.** Three or more scatters in the
  round add five more.
* **The round plays on its own reels**: the base reels with 18 more wilds on
  reels 2-4 (`FS_WILD_BOOST`).
* **Every wild carries x2, x3 or x5** (60/30/10). Multipliers on one way add,
  to x25. The ways DP tracks the multiplier sum across reels.
* **Crowns stick.** A reel that crowns during the round stays crowned until it
  ends, so the board can fill column by column, and a filled board wins the
  Lion. At the base game's 6% a ten-spin round would fill the board about one
  time in fifty and the jackpot alone would be worth several times the stake,
  so the round rolls its own crown rate, 1.5% (`CROWN_FS_NUM`). The page holds
  crowned reels still while the others spin.
* Every grid still draws exactly two numbers per reel -- crown roll, then stop --
  even on a reel already crowned, so a sticky crown cannot shift the stream.

### Cub Cluster, high profile (`games/cluster_high.rs`)

* **7x7, every cell its own draw** from its reel's strip. A strip window would
  not do: `build_strip` spreads each symbol as evenly as its count allows, so in
  a 7-row window vertical neighbours almost never match and the hit rate
  measured 12% against the ~36% the geometry supports.
* **Clusters of 5+, no wild.** The board needs none, and the WILD art is still
  blocked by the licensing gate. The scatter never clusters.
* **Multiplier spots.** The first time a cell explodes it is marked; the second,
  it carries x2; every explosion after that doubles it, to x128. A cluster is
  multiplied by the SUM of the spots under it, read before that explosion
  updates them. Spots belong to cells, not symbols: the page draws them in their
  own layer, so falling symbols pass under them.
* **Unlimited tumbles.** Spots clear when a base-game sequence ends.
* **3/4/5/6/7+ scatters award 10/12/15/20/30 free spins**, played on reels with
  the commonest low removed (`FS_DROP`), where spots persist for the whole
  round. The same counts retrigger.

### Trait Vault, high profile (`games/vault_high.rs`)

* The row multipliers stay: orbs stamp their value onto the whole row, rows
  stick and add, and a line takes the highest row it crosses. Bigger orbs, and
  a x100 row ceiling.
* **Orbs land in the base game too.** If the spin wins, the line win is
  multiplied by the sum of the orbs on the board -- the Gates of Olympus rule.
* **3/4/5 scatters award 10/12/15 free spins** on reels with 10 more wilds on
  2-4; three or more scatters add five spins.
* Two-of-a-kind pays on the four premiums only.

### Rules common to all three

* **The max win is enforced inside the round.** The moment the running total
  reaches the cap, the round ends and pays exactly the cap. (The low profile
  clamps at settle time and scales base and feature together; it is unchanged.)
* **Retriggers are bounded** by a 500-spin guard that never binds in
  measurement; it exists so no seed can loop forever.
* **A bought round opens with the 3-scatter award of 10 spins** and is priced by
  playing exactly that round (`mathsim buyprice`, which plays bought rounds
  directly for the high profile), not by averaging natural triggers, which award
  12 or 15 when more scatters land.
* **The ante adds a fraction of a scatter to every reel that carries one.** The
  high profile's reels carry one to three scatters, and a whole extra scatter
  raised the bonus rate 2.4 to 6.6 times -- an ante priced at 1.6x to 9.3x the
  bet. So the ante's strips are the base weights multiplied by `ante_mult`, with
  `ante_extra` scatters added on top (`StripSpec::ante`); both are recorded in
  each weights file, because they define the game, while the stake is a
  measured price (`mathsim ante --mult`). The round's reels are derived after
  the ante is applied and scale with it, so an ante round plays on the same
  reels as any other. The ante disables the buy while it is on.

## How the numbers were made

**Shape first, then level.** Strip weights, the round's reels and the
multiplier tables set the hit rate, the bonus frequency and the bonus's share of
the return; `calibrate` then solves the pay scale (and, for Trait Vault, the
round's orb rate) for the target RTP.

**Calibration ran on the fast RNG; verification on the production HMAC
stream.** At this volatility, a calibration precise enough to land inside the
band needs a billion spins or more per point, which the fast stream does in
minutes. Calibration is a search -- it solves a scale -- and the solved scale is
then verified by `simulate` on the production stream, which is the only figure
quoted anywhere. `sim::tests::hmac_and_fast_rng_agree_on_rtp_within_noise`
already holds the two streams together.

**The caps bind, so calibration iterates.** Every high game reaches its cap even
at pay scale 1, so RTP is not strictly proportional to scale and one solve
overshoots. Pride and Cub Cluster were calibrated until a pass moved the scale
by well under a percent; Trait Vault's second pass also solved its orb rate, and
the production-stream verification is what settles it (Results, below).

**The exit band is +/-0.0015, not +/-0.0005.** The high profile's volatility is
roughly three to four times the low profile's; resolving +/-0.0005 at that volatility
takes several billion spins per run. Each verification's spin count is derived
from that game's measured volatility so the 95% confidence interval is no wider
than the band.

**The page's port is checked exactly, not loosely.** `mathsim golden-high`
writes `tests/golden/high.json`: base and feature for 300 rounds per engine in
each of spin, ante and buy, played on the production HMAC stream.
`tests/verify-play-math.mjs` requires the page to reproduce every one. A
reordered draw, a dropped retrigger or a misread spot rule changes a round's
total; a loose RTP check at a few hundred thousand spins cannot see a slip that
moves RTP by less than a percent. The page also carries no hand-kept copy of the
weights: `tools/high-conf.mjs` generates its HIGH_CONF block from the weights
files and the measured prices, and the parity test fails if the page is stale.

## Results

Every figure below is a measurement, made with the commands in the README. RTP
is quoted only from the production HMAC stream; fast-stream figures appear only
as calibration steps and cross-checks.

### Calibration (fast stream, a search)

| Game | Passes | Pay scale, pass by pass | Shipped scale | Other solved values |
|---|---:|---|---:|---|
| `pride-high` | 2 | 1.779396 -> 1.782402 (+0.17%) | 1.7824024 | -- |
| `cubcluster-high` | 3 + pooled | 1.419367 -> 1.431351 -> 1.432765 (+0.10%) -> 1.431717 (-0.07%, pooled; see below) | 1.4317174 | -- |
| `traitvault-high` | 2 | 18.790047 -> 18.455485 (-1.78%) | 18.4554846 | round orb rate 0.0655684 (feature share 0.41) |

Trait Vault's second pass solved the round's orb rate as well as the scale, so
its scale moved further than the others' did; the production-stream run below is
what certifies the result.

### Verification (production HMAC stream)

| Game | Seed | Spins | Coin RTP | 95% CI | In band | Hit rate | Volatility | Base / feature | Bonus | Max win seen |
|---|---:|---:|---:|---:|:-:|---:|---:|---:|---:|---:|
| `pride-high` | 9101 | 450M | **0.86882 (+0.02365 Lion = 0.89247)** | +/-0.00115 | yes | 48.6% | 12.39 | 49.8 / 37.1 | 1 in 340 | 5,000x |
| `cubcluster-high` (superseded) | 9101 | 850M | 0.97195 | +/-0.00151 | **no** | 39.0% | 22.53 | 58.4 / 38.8 | 1 in 443 | 5,000x |
| `cubcluster-high` | 9102 | 1400M | **0.96895** | +/-0.00117 | yes | 39.0% | 22.34 | 58.3 / 38.5 | 1 in 444 | 5,000x |
| `traitvault-high` | 9101 | 550M | **0.96996** | +/-0.00126 | yes | 17.9% | 15.05 | 57.3 / 39.7 | 1 in 364 | 10,000x |

**Cub Cluster needed a second run.** Its first production run, at scale
1.432765 on seed 9101, measured 0.97195 +/-0.00151: outside the band by 0.00045,
and with an interval slightly wider than the band, because the game's volatility
came out at 22.5 rather than the 22 the spin count had been sized for. The scale
was re-solved from all three independent measurements -- both fast passes and
that run, weighted by inverse variance, which put the RTP at 1.432765 at
0.97071 +/-0.00067 -- and verified again on a fresh seed, 9102, at 1.4B spins.
The run that moved the scale is not the run that certifies it. Both runs are in
the table; only the second describes the shipped game. It sits nearer the band's
lower edge than its upper, so the two production runs were also read together:
the first, rescaled to the shipped scale, reads 0.97124, and pooled with the
second by inverse variance they give 0.9698 +/-0.0009. The scale was not moved
again; a third solve would be chasing noise.

Pride's figure sits 0.0012 under target, inside the band. The fast stream's
1B-spin check at the same scale read 0.86991 +/-0.00077, so the gap is within
the two runs' combined noise.

Hit rate counts any return, including returns below the stake. Volatility is the
standard deviation of a spin's return in units of the bet. The exit band is
+/-0.0015 around 0.87 (Pride) and 0.97 (the others).

### Prices

| Game | Feature buy | EV of a bought round | Rounds played | Ante | Ante stake | Bonus, base -> ante |
|---|---:|---:|---:|---|---:|---|
| `pride-high` | **144.11x** | 125.37x +/-0.18 | 4,000,000 | strips x6, +3 scatters | **1.2516x** +/-0.0025 | 1 in 339 -> 1 in 213 |
| `cubcluster-high` | **169.85x** | 164.75x +/-0.68 | 1,500,000 | strips x8, +1 scatter | **1.2172x** +/-0.0050 | 1 in 443 -> 1 in 320 |
| `traitvault-high` | **147.18x** | 142.76x +/-0.23 | 4,000,000 | strips x6, +3 scatters | **1.2708x** +/-0.0027 | 1 in 364 -> 1 in 220 |

A buy price is the bought round's EV divided by the target RTP, so buying returns
exactly what spinning does. Bought rounds were played on the production stream;
the ante tiers on the fast stream at 150-200M spins per tier, where each table's
+0 row came out at 1.0000x to 1.0012x, inside its own interval -- the check that
the base calibration had not drifted. Cub Cluster's buy was re-measured at its
recalibrated scale; its ante stake is a ratio of two returns at the same scale,
so the -0.07% move leaves it where it was.

### The Lion's Crown with sticky crowns

| | |
|---|---|
| Rounds simulated (10-spin award, retriggers live) | 400 million |
| Board filled | 22,892 times: 1 in 17,473 rounds |
| Base grid alone (closed form) | 1 in 1,286,008 spins |
| Per spin, at a bonus 1 in 340 | 1 in 1,057,243 |
| Jackpot RTP (25,000x prize) | **0.02365** |

Pride's high profile therefore returns 0.86882 in coin plus 0.02365 from the
Lion, 0.8925 in all, against the low profile's 0.87001 + 0.02124 = 0.89125.
