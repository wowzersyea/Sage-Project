# Lazy Arcade

Provably-fair Web3 arcade on Base: three slots plus a rarity card duel, all at
97% RTP, wagered in $LAZY.

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
verify/            standalone provably-fair verifier (static page)
```

## Verifying the build

```sh
npm run check       # Rust tests + golden vectors + licensing gate
```

Individually:

```sh
npm run math:test        # 45 Rust tests, incl. RFC 4231 HMAC vectors
npm run verify:golden    # TypeScript RNG must match Rust bit-for-bit
npm run gate:licensing   # no symbol may use art the operator does not own
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

`simulate` exits non-zero when RTP falls outside [0.9695, 0.9705].

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
than nudge numbers by hand, `calibrate` measures RTP at two pay scales, fits the
line through them, and solves for 0.97. The fit is linear but not proportional:
Trait Vault's Hold and Win pays coin values that do not scale with the paytable,
so RTP carries a constant term. The two-point fit recovers both terms without
needing to know which game has one. (Pride's fitted intercept came out at
~0.000000, exactly as its structure predicts — a useful sanity check on the
model.)

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
- No HIGH volatility profile. The loader accepts alternate strip sets so it is a
  data swap, but the HIGH strips are absent by design.
- No guessed contract addresses. `assertChainConfigResolved()` throws at startup
  while any `[CONFIRM]` constant is unresolved.
