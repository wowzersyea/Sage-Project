/**
 * Chain / deployment configuration.
 *
 * EVERY value marked __CONFIRM__ is a BLOCKING UNKNOWN (spec Sec. 2).
 * Nothing in this repo may guess an address. `assertChainConfigResolved()`
 * is called by the server and by any deploy script, so an unresolved
 * constant fails loudly at startup rather than silently sending funds
 * to the zero address.
 */

export const UNCONFIRMED = "0x__CONFIRM__" as const;

/**
 * Official $LAZY on Base. CONFIRMED 2026-08-11.
 *
 * Verified by reading the contract on Base rather than trusting a listing:
 *   symbol()      -> "LAZY"
 *   name()        -> "King Kovu"   (the on-chain name is NOT "Lazy" -- expected)
 *   decimals()    -> 18
 *   totalSupply() -> 21,000,000 * 1e18
 *   code          -> EIP-1167 minimal proxy delegating to
 *                    0xc6ee58d3eda2e36f893d243de69eef431666a6dd
 *
 * The check earned its keep: a DIFFERENT token also markets itself as "Lazy on
 * BASE" at 0x1fCE957429270d0f609d0B0D444c4C7A426ad8c6. Do not substitute it.
 */
export const LAZY_TOKEN_BASE = "0xE4dA9889Db3d1987856e56da08Ec7e9F484f6434" as const;

/** Implementation behind the EIP-1167 clone above. Recorded so a future
 *  reviewer can diff the token logic without re-deriving it from bytecode. */
export const LAZY_TOKEN_IMPLEMENTATION = "0xc6ee58d3eda2e36f893d243de69eef431666a6dd" as const;

/** CONFIRMED on-chain via decimals(). Affects every bet-increment check. */
export const LAZY_DECIMALS = 18;

/** Lazy Lions, Ethereum mainnet. Verified. */
export const LAZY_LIONS_L1 = "0x8943c7bac1914c9a7aba750bf2b6b09fd21037e0" as const;

/** Lazy Lions metadata root, read from tokenURI(). Pinning this means the
 *  trait pipeline cannot be silently repointed at different art. */
export const LAZY_LIONS_METADATA_CID =
  "QmNpHFmk4GbJxDon2r2soYpwmrKaz1s6QfGMnBJtjA2ESd" as const;

/**
 * Lazy Cubs. CONFIRMED 2026-08-11 by reading the contract, not by trusting a
 * listing: name() -> "Lazy Cubs", symbol() -> "CUBS", totalSupply() -> 9,099.
 *
 * Note the supply: several third-party sources still describe Lazy Cubs as an
 * 834-piece collection. On-chain says 9,099. Trust the contract.
 *
 * The operator holds 63 Cubs on Ethereum mainnet — the same chain as the
 * Lions, so the Bronze sacrifice tier shares the cross-chain path in Sec. 9.1
 * rather than needing a second one.
 */
export const LAZY_CUBS_CONTRACT = "0xe6a9826e3b6638d01de95b55690bd4ee7eff9441" as const;
export const LAZY_CUBS_SUPPLY = 9_099;
export const OPERATOR_CUBS_COUNT_AT_INGEST = 63;

/**
 * yahoooo.eth -- CONFIRMED 2026-08-11.
 * Resolved by two independent ENS resolvers (ensideas, web3.bio), which agree.
 * Holdings are enumerated on-chain at build time by tools/trait-ingest.
 */
export const OPERATOR_WALLET = "0x575161e774566Fb51E0a217ff6f64825eafE850a" as const;

/**
 * CONFIRMED: the operator holds 73 Lions on ETHEREUM MAINNET
 * (balanceOf at block time of writing). This settles spec Sec. 2's open
 * question about custody chain -- the Lions are NOT on Base, so the sacrifice
 * flow in Sec. 9.1 genuinely has to be cross-chain. It is not optional.
 */
export const OPERATOR_LIONS_CHAIN = "ethereum-mainnet" as const;

/**
 * A second operator wallet, added 2026-08-11 to widen rarity coverage in Hi/Lo.
 *
 * CONFIRMED by the operator. Originally inferred from the OpenSea profile
 * "LazyTerminatorsV2" and corroborated on-chain (47 Lions, 1 Cub; no other
 * candidate on that page holds any), then confirmed directly.
 */
export const OPERATOR_WALLET_2 = "0x5d466e6f2b4ae0b2256574e2268c777f114297b2" as const;
export const OPERATOR_WALLET_2_CONFIRMED = true;   // confirmed by the operator

/** 73 in the primary wallet + 47 in the second. */
export const OPERATOR_LIONS_COUNT_AT_INGEST = 120;
export const OPERATOR_CUBS_COUNT_AT_INGEST_TOTAL = 64;

/**
 * Collection size, and a discrepancy worth knowing about: the spec says
 * 10,078 Lions, lazylionsnft.com says 10,000, and totalSupply() says 10,080.
 * The metadata API serves 9,999 of them. Rarity here is computed over the
 * 9,999 actually retrievable, which is what `rarity.json` records -- if the
 * missing tokens ever resolve, ranks shift and Hi/Lo must be re-verified.
 */
export const LIONS_TOTAL_SUPPLY_ONCHAIN = 10_080;
export const LIONS_RARITY_BASIS = 9_999;

/**
 * Lazy Drinks, ERC-1155. id 0 = Juice, 1 = Milk, 2 = Special.
 * The operator holds 11 Juice and ZERO Milk/Special on-chain; Milk art is used
 * on asserted permission rather than holdings (see packages/assets/symbols.json).
 * That distinction is deliberate -- it is the only art in the build whose
 * rights the licensing gate cannot verify for itself.
 */
export const LAZY_DRINKS_CONTRACT = "0x65f9f7f4a4ddd517b35c9357f575f0f1df431cbc" as const;
export const OPERATOR_DRINKS_HELD = { juice: 11, milk: 0, special: 0 } as const;

/** Hi/Lo rarity ranks: 0..100 inclusive, equal-population buckets. */
export const HILO_RARITY_RANKS = 101;

/** MUST be a Safe, not an EOA. Deploy scripts assert `code.length > 0`. */
export const TREASURY_MULTISIG = UNCONFIRMED;

/* ------------------------------------------------------------------ */
/* Wagering                                                            */
/* ------------------------------------------------------------------ */

/** Strict increment. Contract reverts on any wager not divisible by this. */
export const BET_INCREMENT_LAZY = 100n;

/** Total-bet levels, in whole $LAZY (spec Sec. 6.1). */
export const BET_LEVELS_LAZY = [100n, 200n, 300n, 500n, 1000n, 2500n, 5000n] as const;

/** HIGH is scaffolded but MUST NOT ship (spec Sec. 6.5). The paytable loader
 *  accepts alternate strip sets, so flipping this is a data swap, not a
 *  code change -- but the HIGH strips are deliberately absent from this build. */
export const VOLATILITY_PROFILE: "LOW" | "HIGH" = "LOW";

/* ------------------------------------------------------------------ */
/* Provable-fairness                                                   */
/* ------------------------------------------------------------------ */

/** Forced serverSeed rotation cadence (spec Sec. 3.2). */
export const SEED_ROTATION_NONCES = 10_000;

/**
 * Entropy source for the NEXT serverSeed. Left unresolved on purpose:
 * spec Sec. 3.2 requires verifying Base availability at build time rather
 * than assuming a coordinator exists.
 */
export type VrfProvider = "CHAINLINK_V25" | "PYTH_ENTROPY" | "GELATO" | "BLOCKHASH_FALLBACK";
export const VRF_PROVIDER: VrfProvider | null = null; // CONFIRM

/* ------------------------------------------------------------------ */
/* Guard rails                                                         */
/* ------------------------------------------------------------------ */

/** Hi/Lo: a direction offered below this probability is DISABLED, not capped.
 *  Capping would silently break the 97% RTP; disabling preserves it exactly. */
export const HILO_MIN_OFFERED_PROBABILITY = 0.05;

/** Round max win, in units of stake. */
export const HILO_MAX_ROUND_MULTIPLIER = 5_000;

/** A round may not start if stake * HILO_MAX_ROUND_MULTIPLIER exceeds this
 *  fraction of bankroll (spec Sec. 7.5). Enforced in Bankroll.sol, not here. */
export const MAX_ROUND_EXPOSURE_FRACTION = 0.02;

/** packageEV <= ALPHA * floorPrice_in_LAZY (spec Sec. 9.3). */
export const SACRIFICE_EV_ALPHA = 0.5;

export const TARGET_RTP = 0.97;
export const RTP_TOLERANCE = 0.0005;

/**
 * Spec Sec. 8.1: if $LAZY takes a transfer fee or rebases, balance deltas must
 * be MEASURED rather than assumed, and every accounting path in LazyVault
 * changes shape. Reading `decimals()` does not answer this -- it needs a fork
 * test that transfers a known amount and asserts the recipient delta matches.
 *
 * Left UNVERIFIED on purpose: the token is an EIP-1167 clone whose 10,134-byte
 * implementation was not audited as part of this phase. Flipping this to
 * "STANDARD" without that fork test is exactly the kind of assumption that
 * quietly breaks a vault's solvency invariant.
 */
export type TransferSemantics = "STANDARD" | "FEE_ON_TRANSFER" | "REBASING" | "UNVERIFIED";
export const LAZY_TRANSFER_SEMANTICS: TransferSemantics = "UNVERIFIED";

/* ------------------------------------------------------------------ */

export interface UnresolvedConstant {
  name: string;
  why: string;
}

/** Returns every still-unresolved blocking unknown. */
export function unresolvedChainConfig(): UnresolvedConstant[] {
  const out: UnresolvedConstant[] = [];
  const check = (name: string, value: string, why: string) => {
    if (value === UNCONFIRMED) out.push({ name, why });
  };
  check("LAZY_TOKEN_BASE", LAZY_TOKEN_BASE, "official $LAZY on Base; impostor tokens exist");
  check("OPERATOR_WALLET", OPERATOR_WALLET, "needed to enumerate owned traits (licensing gate)");
  if (!OPERATOR_WALLET_2_CONFIRMED) {
    out.push({
      name: "OPERATOR_WALLET_2",
      why: "address inferred from an OpenSea profile, not confirmed by the operator",
    });
  }
  check("TREASURY_MULTISIG", TREASURY_MULTISIG, "must be a Safe; deploy asserts contract code");
  if (VRF_PROVIDER === null) {
    out.push({ name: "VRF_PROVIDER", why: "no Base VRF coordinator confirmed available" });
  }
  if (LAZY_TRANSFER_SEMANTICS === "UNVERIFIED") {
    out.push({
      name: "LAZY_TRANSFER_SEMANTICS",
      why: "fee-on-transfer/rebasing not ruled out; changes every accounting path",
    });
  }
  return out;
}

/** Call at server startup and at the top of every deploy script. */
export function assertChainConfigResolved(): void {
  const unresolved = unresolvedChainConfig();
  if (unresolved.length > 0) {
    throw new Error(
      "Refusing to start: unresolved chain config -- " +
        unresolved.map((u) => `${u.name} (${u.why})`).join("; ")
    );
  }
}
