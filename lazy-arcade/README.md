# Lazy Arcade

Provably-fair Web3 arcade on Base: three slots plus a rarity card duel, wagered
in $LAZY. Cub Cluster, Trait Vault and Hi/Lo return 97%; Pride returns 87% in
coins by design, with the difference part-funding the Lion's Crown -- a Lazy
Lion NFT paid for filling the board (0.89125 total return, both figures
disclosed in-game).

**Status: Phase 0 (blocking unknowns) and Phase 1 (math harness) only.**
No contracts are deployed, no client is built, and nothing here should touch
mainnet. See [`docs/PHASE-0-1-FINDINGS.md`](docs/PHASE-0-1-FINDINGS.md) for what
was resolved, what is still blocked, and which spec targets the math cannot
currently hit.

## Layout

```
packages/
  config/          chain constants, including the [CONFIRM] gate
  engine/          framework-agnostic game logic (TypeScript)
    rng/           HMAC derivation + rejection sampling
    paytables/     optimized strip weights per game
  assets/          symbol -> art source manifest
crates/mathsim/    Rust Monte Carlo harness (zero dependencies)
tools/
  trait-ingest/    on-chain holdings -> owned_traits.json
  atlas-build/     licensing gate (CI)
tests/
  golden/          10,000 cross-implementation RNG fixtures
  browser.mjs      headless gate for play/index.html
verify/            standalone provably-fair verifier (static page)
```

## Verifying the build

```sh
npm run check       # everything below, in order
```

Individually:

```sh
npm run math:test        # Rust tests, incl. RFC 4231 HMAC vectors and all six engines
npm run verify:golden    # TypeScript RNG must match Rust bit-for-bit
npm run verify:play      # the page's odds, the verifier's copy of the strips, and the
                         # high profile reproduced EXACTLY, round by round
npm run verify:browser   # the page itself, in a headless browser
npm run verify:audio     # what actually reaches the speakers, in dBFS
npm run gate:licensing   # no symbol may use art the operator does not own
```

`verify:browser` needs `npm i -D playwright`; without it the script skips and
exits 0, so a checkout that only wants the math gates is never blocked. If the
browser lives outside the package, point at it with `CHROMIUM_PATH`.

`verify:audio` renders each sound through the page's real audio graph on an
OfflineAudioContext and checks it lands in a sane band. It exists because the
limiter had been verified to EXIST while nothing had measured what came out of
it: the Epic fanfare peaked at -6.7 dBFS and a reel stop at -28.8, so the limiter
never engaged and the routine sounds sat twelve times quieter in amplitude than
the big ones.

The split matters: `verify:play` extracts the page's math and checks the odds,
which leaves the entire renderer, money handling, keyboard and accessibility
unproven. `verify:browser` covers that half, and each of its checks was proven
to fail by breaking the page on purpose before the check was trusted.

## The bench, as a player meets it

`play/index.html` plays each round the way the reference's flagships do. The
maths settles the whole round before the first reel moves -- that is what makes
it replayable from the seed -- and the page plays that script back as a game:
every free spin lands on spinning reels, tumbles fall cell by cell, each result
is counted up once (and a return at or below the stake not at all), big wins
climb a 15x/30x/45x/60x ladder whose label upgrades as the count passes each
tier, and a bonus opens and closes on screens that wait for the player.

Normal spins take the reference's 1.5s minimum with stops 0.15s apart; quick
spin drops the minimum; holding Space or the spin button runs turbo; a tap,
Space or Enter stops the reels on the result already decided. Every reel
cruises at one speed, so a reel about to tease a scatter cannot be told apart
until the reel before it lands. Autoplay stops on any win, a bonus, a single
win over a limit, or a balance change. Settings carries the volatility profile,
a market preset (a UK-style one holds spins to 2.5s and removes turbo, quick
spin, the player-led stop and the feature buy), separate music and effects
switches, and a battery saver. Portrait phones get a centred spin button with
bet minus and plus either side; landscape phones put the board beside the
controls.

The score is synthesised in five layers -- idle, spin, win, bonus, big win --
crossfaded over a second, falling back to idle ten seconds after the last spin.
Every symbol's idle, land, win and explode states go through one function,
`symState`, which a skeletal-animation runtime can take over by registering
`window.LazyArcadeAnimator`.

## Two volatility profiles

Each slot has a LOW profile -- the original game, verified as it was -- and a
HIGH profile built on the reference's distribution: a bonus about one spin in
300 to 450, multipliers that build, retriggers, and max wins of 5,000x to
10,000x enforced inside the round. Cub Cluster's high profile plays on 7x7 with
Sugar Rush-style multiplier spots; Pride's crowns stick through its bonus and
its wilds carry x2/x3/x5; Trait Vault's orbs land in the base game too. The page
plays HIGH by default; production config (`VOLATILITY_PROFILE`) stays LOW
pending spec Sec. 6.5. Mechanics, calibration method and every measured figure:
[docs/HIGH-PROFILE.md](docs/HIGH-PROFILE.md).

```sh
cd crates/mathsim && cargo build --release
W=../../packages/engine/src/paytables/weights/high

# calibrate on the fast stream (a search), then verify on the production one
./target/release/mathsim calibrate --game cubcluster-high --weights $W/cubcluster-high.weights \
    --spins 2000000000 --rng fast
./target/release/mathsim simulate --game cubcluster-high --weights $W/cubcluster-high.weights \
    --spins 1000000000 --rng hmac

# prices: bought rounds are played directly; the ante stake is solved per tier
./target/release/mathsim buyprice --game pride-high --weights $W/pride-high.weights --rounds 4000000
./target/release/mathsim ante --game pride-high --weights $W/pride-high.weights --spins 400000000 --rng fast

# the Lion's odds with sticky crowns, and the exact outcomes the page must reproduce
./target/release/mathsim nft --game pride-high --weights $W/pride-high.weights --feature-frequency F
./target/release/mathsim golden-high --count 300

# then regenerate the page's copy of the weights and prices
node ../../tools/high-conf.mjs
```

## The math harness

RTP is proven here or it does not exist (spec Sec. 0 rule 2). Hand-tuning a
paytable and asserting a number is not acceptable.

```sh
cd crates/mathsim && cargo build --release

# search strip weights + pay scale toward the targets (cheap RNG)
./target/release/mathsim optimize --game pride --iters 900 --eval-spins 250000 \
    --out ../../packages/engine/src/paytables/weights/pride.weights

# correct the pay scale against a full-scale measurement (production RNG)
./target/release/mathsim calibrate --game pride --spins 12000000 \
    --weights ../../packages/engine/src/paytables/weights/pride.weights

# the actual exit criterion
./target/release/mathsim simulate --game pride --spins 100000000 --rng hmac \
    --weights ../../packages/engine/src/paytables/weights/pride.weights
```

`simulate` exits non-zero when coin RTP falls outside the game's own band --
[0.9695, 0.9705] for most, [0.8695, 0.8705] for Pride, whose jackpot is
reported as a separate closed-form line rather than folded into the coin
figure (see `exit_band` in main.rs).

### Why there are two RNGs

`HmacRng` is the production path: byte-identical to the TypeScript engine and to
what a player replays on `/verify`. Every quotable RTP figure is measured
through it.

`FastRng` is a xorshift used only to make the weight search tractable. It never
produces a number a player sees, and `simulate --rng fast` prints an explicit
warning that its output is not a quotable RTP. A test asserts the two agree on
RTP within noise, which is what licenses the substitution.

### Why `calibrate` exists

`optimize` searches at a few hundred thousand spins, so its winner is fitted to
that sample. Pride came out of the search at 0.96995 and measured **0.97280**
over 100M spins on the production RNG — a real 4-sigma miss, not noise. Rather
than nudge numbers by hand, `calibrate` measures RTP against pay scale and
solves for 0.97.

Every current feature pays through the **scaled** paytable, so RTP is strictly
proportional to pay scale and the fit has no constant term. That was not always
true, and the exception is worth remembering: Trait Vault's old Hold and Win
paid fixed coin values the paytable never touched, which genuinely did give it a
constant term. The special case outlived the mechanic — after the Lion's Share
rework, `calibrate` was still solving the scale as though the feature would stay
put while the base game tripled, and produced a build measuring **1.62** RTP
with the feature carrying 96.8% of the return. If a future feature pays values
the paytable cannot reach — a fixed jackpot, a coin round — the constant term
needs to come back deliberately rather than be inherited.

Trait Vault also needs a second axis, because orb probability sets how the
return splits between base and feature while pay scale sets the total. That
solve works on the scale-invariant **share**, not on an absolute feature RTP,
and it fails loudly rather than clamping when the target is out of reach: the
share cannot be pushed below whatever ten free spins are worth at the current
trigger rate, and when that happens the lever is the scatter weight, not the
orb table.

## Provable fairness

```
serverSeed     32 random bytes, secret
serverSeedHash SHA256(serverSeed), published on Base BEFORE first use
clientSeed     user-editable, changeable any time
nonce          uint64, increments per spin, never reused for a seed pair

rawBytes = HMAC_SHA256(serverSeed, "<clientSeed>:<nonce>:<gameId>")
  extend   HMAC_SHA256(serverSeed, "<clientSeed>:<nonce>:<gameId>:<counter>")

uniform [0,n): rejection sampling on 4-byte chunks. Never modulo.
```

Block 0 carries no counter suffix; block k >= 1 carries `:k`. Three
implementations follow this exactly — Rust (`crates/mathsim/src/rng.rs`),
TypeScript (`packages/engine/src/rng/`), and the browser verifier
(`verify/index.html`, via Web Crypto). All three are checked against the same
golden fixtures.

`verify/index.html` is standalone and talks to no server: paste a revealed seed,
your client seed and a nonce, and it re-derives the reel stops locally.

## What this build deliberately does not do

- No modulo-biased sampling anywhere.
- No near-miss weighting, adaptive RNG, or per-player outcome shaping.
- No HIGH profile in production. The HIGH strips now exist and are verified, and
  the play-money bench plays them by default, but `VOLATILITY_PROFILE` stays LOW
  until spec Sec. 6.5's decision is made.
- No guessed contract addresses. `assertChainConfigResolved()` throws at startup
  while any `[CONFIRM]` constant is unresolved.
