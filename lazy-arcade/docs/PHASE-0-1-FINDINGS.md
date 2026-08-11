# Phase 0 + Phase 1 findings

Phase 0 is the consolidated `[CONFIRM]` list. Phase 1 is the math harness and
the RTP proof. Everything below is measured, not asserted.

---

## 1. Blocking unknowns -- RESOLVED

| Constant | Value | How it was established |
|---|---|---|
| `LAZY_TOKEN_BASE` | `0xE4dA9889Db3d1987856e56da08Ec7e9F484f6434` | Read on Base: `symbol()` = `LAZY`, `decimals()` = 18, `totalSupply()` = 21,000,000e18. Corroborated by lazyonbase.com and Phantom's Base token page. |
| `LAZY_DECIMALS` | `18` | `decimals()` on-chain. Was an assumption; now verified. |
| `OPERATOR_WALLET` | `0x575161e774566Fb51E0a217ff6f64825eafE850a` | `yahoooo.eth`, resolved by two independent ENS resolvers that agree. |
| Lions custody chain | **Ethereum mainnet, 73 Lions** | `balanceOf()` on `0x8943c7ba...`, then all 73 token IDs enumerated via `tokenOfOwnerByIndex`. |
| Lions metadata root | `QmNpHFmk4GbJxDon2r2soYpwmrKaz1s6QfGMnBJtjA2ESd` | `tokenURI()` on-chain. |

### The impostor check earned its keep

Spec Sec. 2 warns that many impostor $LAZY tokens exist. That is not
hypothetical: a **different** token markets itself as "Lazy on BASE" at
`0x1fCE957429270d0f609d0B0D444c4C7A426ad8c6`. Two further details worth knowing
before anyone audits the vault:

- The official token's on-chain `name()` is **"King Kovu"**, not "Lazy". A
  reviewer grepping for "Lazy" in the contract will not find it and may
  wrongly conclude the address is wrong.
- It is an **EIP-1167 minimal proxy** delegating to
  `0xc6ee58d3eda2e36f893d243de69eef431666a6dd` (10,134 bytes). Clones have an
  immutable implementation, so this is not an upgradeability risk, but the
  token logic lives at that second address.

### Custody answer changes nothing structurally -- and that is the point

The Lions are on Ethereum, not Base. The cross-chain sacrifice flow in spec
Sec. 9.1 is therefore **required, not optional**. This was listed as an open
question that "decides Sec. 9.1 entirely"; it is now closed, in favour of the
more expensive design.

---

## 2. Blocking unknowns -- STILL OPEN

These must be resolved before any mainnet deployment.
`assertChainConfigResolved()` throws while any of them is unset.

| Constant | Why it blocks |
|---|---|
| `LAZY_CUBS_CONTRACT` | Needed for the Bronze sacrifice tier and Cub Cluster art sourcing. |
| `TREASURY_MULTISIG` | Must be a Safe. Deploy scripts should assert `code.length > 0` so an EOA cannot be pasted in by accident. |
| `VRF_PROVIDER` | Spec Sec. 3.2 requires verifying at build time that a Base coordinator actually exists rather than assuming one. Not verified here. Until it is, the operator can in principle grind server seeds, which undercuts the whole fairness claim. |
| `LAZY_TRANSFER_SEMANTICS` | **Newly added.** Reading `decimals()` does not tell you whether the token takes a transfer fee or rebases. If it does, balance deltas must be *measured* rather than assumed and every accounting path in `LazyVault` changes shape (spec Sec. 8.1). Needs a fork test that transfers a known amount and asserts the recipient delta. Left `UNVERIFIED` on purpose. |
| $LAZY TWAP depth on Base | Spec Sec. 9.3 oracle safety. If a 30-min TWAP can be moved >5% for under $50k, free-spin pricing must fall back to a governance-set fixed table. Not measured. |
| Licensing posture | Gates Phase 10 and mainnet. |

---

## 3. Licensing gate -- one symbol is not licensable

`tools/trait-ingest` pulled all 73 owned Lions and their metadata, yielding
**142 distinct licensed traits** across 8 categories.

`tools/atlas-build/check-licensing.py` is the CI gate required by spec
Sec. 5.3. It passes, with one symbol flagged:

> **WILD is blocked.** Spec Sec. 6.3 assigns WILD to a Signature Series lion.
> The operator holds **zero** Signature Series Lions, so no Signature art is
> licensed to this project.

Per Sec. 5.3 the remedy is explicit: commission original art in the same style.
Do not source the trait elsewhere. The manifest records WILD as
`BLOCKED_PENDING_ART` with a brief, and the gate reports it without silently
passing.

Every other tier is comfortably covered: 73 Lions for the four premiums, and
15 Headgear / 22 Bodygear / 22 Eyes / 21 Mouth / 11 Background values for the
mid and low tiers.

**Rarity caveat.** Per-trait rarity `r_t = count_t / 10078` needs trait counts
over the *full* collection, not the 73-token subset. `ingest.py --full-collection`
walks all 10,078 tokens for this; it has not been run (thousands of gateway
fetches). Until it is, rarity is left `null` rather than computed from a biased
sample, because a wrong rarity number silently changes Hi/Lo odds.

---

## 4. Math harness -- what is proven

45 Rust tests pass, including RFC 4231 HMAC vectors, NIST SHA-256 vectors, and
a rejection-sampling bias test on a hostile modulus.

**Cross-implementation:** 10,000 golden fixtures / 60,000 draws. Rust,
TypeScript and the browser verifier's Web Crypto path all agree **exactly**.

### Rarity Hi/Lo is exact, not simulated-close

Hi/Lo's 97% is proven analytically, not just statistically. A test asserts that
for **every** ordinal `p` in 1..10,078 and both directions, `P(dir) x payout(dir)`
equals 0.97 to within 1e-9. Also asserted:

- `P(rarer) + P(commoner) == 1` exactly (unique ordinals, so no ties).
- Directions below 5% probability are **disabled**, never payout-capped.
  Capping would silently break RTP on exactly the bets players scrutinise most.
- Max single-step multiplier is exactly 19.4x (`0.97 / 0.05`), and no offered
  bet anywhere in the deck exceeds it.
- At least one direction is always offered, at every position.
- Rarity Swap is priced at exact EV, so it cannot move RTP either way.

### 100M spins cannot resolve RTP to the spec's own tolerance

Spec Sec. 6.2 sets the exit criterion at "RTP in [0.9695, 0.9705] at 100M
spins" — a +/-0.0005 band. But Pride's measured volatility index is 3.645, so
at 100M spins the 95% confidence interval on RTP is **+/-0.00071**, which is
*wider than the band it is being tested against*. A run can land inside the
band while the true RTP sits outside it, and vice versa.

The two numbers need each other to be consistent:

| Spins | 95% CI at volatility 3.645 |
|---|---|
| 100M | +/-0.00071 |
| 200M | +/-0.00051 |
| 400M | +/-0.00036 |

**204M spins** is the point where the CI finally matches the +/-0.0005
tolerance. Anything less is not a proof at the claimed precision — it is a
measurement whose error bar exceeds the thing being measured. Pride is
therefore re-verified at 400M here, and any certification submission should
quote a spin count derived from the game's measured volatility rather than a
flat 100M. Higher-volatility games need proportionally more: the requirement
scales with variance, so Cub Cluster at ~5.2 needs roughly twice Pride's count.

### The optimizer overfits, and the harness catches it

`optimize` searches at a few hundred thousand spins on the cheap RNG. Pride came
out of the search at 0.96995 and measured **0.97280** over 100M spins on the
production RNG. With a 95% CI of +/-0.00072 that is a ~4-sigma miss: the search
had fitted its evaluation seed, not the game.

This is why `calibrate` exists, and why the search is never allowed the last
word. The two-point linear fit on pay scale is measured with the production RNG.
Pride's fitted intercept came out at ~0.000000, exactly as its structure
predicts (every Pride win scales with the paytable) -- a useful check that the
calibration model matches the game.

---

## 5. Math harness -- where the spec's targets cannot be met as written

Two of these are geometry problems, not tuning problems. No amount of weight
search fixes them.

### 5.1 Cub Cluster: a 5x4 grid is too small for cluster pays

With the full 13-symbol set spread over 20 cells, a 5+ orthogonally adjacent
cluster is so rare that the measured hit frequency was **0.57%** against a
**44%** target, with RTP at 0.0009. That is not a weighting problem — thirteen
symbols simply cannot concentrate on twenty cells.

Cutting the symbol set to wild plus six paying symbols brings RTP to target, but
hit frequency still lands near **10%**, well short of 44%.

**Recommendation:** cluster games conventionally run 6x5 or 7x7 grids for
exactly this reason. Either grow the grid (which contradicts the 5x4 in
Sec. 6.4) or lower the cluster minimum from 5 to 4. Shipping a 44% hit-frequency
claim on a 5x4 grid with 5+ clusters is not achievable.

Note also the pay scale the optimizer needed: **~41x** the baseline table. Rare
events with large pays is the definition of high variance, which is in tension
with the 5.5 volatility ceiling.

### 5.2 Trait Vault: a 40-count Mane Meter fills every ~6 spins

Four M-tier symbols across 20 cells land roughly 6-7 M symbols per spin, so a
40-count meter completes about every 6 spins. Measured feature trigger frequency
was **1 in 6**, and the baseline feature RTP was **128%** of total bet.

The optimizer can force this back inside budget by driving coin probability
down, but that produces a "Hold and Win" where most respins land nothing — the
math fits while the feature feels broken.

**Recommendation:** raise the meter target to roughly 250-400, or count only one
specific M-tier symbol instead of all four. Either keeps the spec's stated
mechanic while making the meter behave like a meter. A feature that fires every
6 spins is a base-game mechanic wearing a meter's clothes.

### 5.3 The max-win figures were aspirational, not enforced

Spec Sec. 6.4 states a max win per game (2,000x / 2,500x / 1,000x). Nothing in
the mechanics enforces them: Cub Cluster's tumble chains were measured paying
**3,104x** against its stated 2,500x maximum.

That is not a cosmetic overshoot. A published max-win number that the game can
exceed is false disclosure, and `Bankroll.sol`'s per-round exposure caps
(Sec. 7.5) would be sized against the wrong number — the bankroll would be
under-reserved for exactly the outcomes that threaten it.

A hard cap is now applied to every settled spin. It clamps the **total**, then
scales base and feature down together, so capping cannot silently distort the
reported base/feature split. Three tests cover it, including one that drives an
absurd pay scale through all three games and asserts no spin can exceed the
published ceiling.

Because the cap removes probability mass from the top of the win distribution,
it lowers RTP slightly — so every game was recalibrated *after* the cap was
introduced, not before.

### 5.4 Hit frequency and volatility targets are not yet met

RTP is the hard exit criterion and is treated as such. The secondary targets are
soft pulls in the optimizer's loss function and currently miss:

| Game | Hit freq (target) | Volatility (target) | Base/feature split (target) |
|---|---|---|---|
| Pride | 0.573 (0.38) | 3.65 (4.2) | 79.6 / 17.3 (68 / 29) |
| Cub Cluster | 0.104 (0.44) | 5.32 (5.4) | 70.2 / 26.8 (71 / 26) |
| Trait Vault | 0.222 (0.48) | 3.71 (3.1) | 74.2 / 23.0 (74 / 23) |

Cub Cluster and Trait Vault both hit their base/feature split closely — Trait
Vault's 74.2 / 23.0 against a 74 / 23 target is the two-axis calibration
working as intended. Pride's split is the one that is off, because its free
spins carry less of the return than the spec budgets for.

Hit frequency and volatility cannot be closed by strip weights alone. Both are
governed by the *shape* of the paytable — which symbol pays what at which
count — and the optimizer currently searches only weights and a single global
scale. Giving it the paytable shape as a search axis, subject to the max-win
caps, is the natural next iteration.

All three are within the 5.5 volatility ceiling, which is the constraint that
actually backs the "low volatility" product claim.

---

## 6. Not started

Phases beyond the math harness are untouched: contracts (Foundry is not
installed in this environment, so nothing could be compiled or tested), the
Pixi client, the Fastify server, the attestation layer, and the sacrifice
arbitrage guard. The `FreeSpinPricer` EV cap in Sec. 9.3 is arithmetic that
depends on the unresolved TWAP-depth question above.
