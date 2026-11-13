//! mathsim -- the Monte Carlo harness that decides whether a paytable ships.
//!
//! Spec Sec. 0 rule 2: RTP is proven here or it does not exist.

mod game;
mod games;
mod optimize;
mod rng;
mod sha256;
mod sim;
mod tables;

use game::*;
use optimize::{optimize, OptimizeConfig, Targets};
use rng::{HmacRng, Rng};
use sha256::sha256;
use sim::{run, run_buy, GameKind, RngMode, RunConfig, Stats, HIST_BUCKETS, HIST_EDGES};
use std::collections::HashMap;

/// The exit band is PER GAME, because Pride is no longer a 97% machine.
///
/// It was a single pair of constants covering every game, which was true while
/// every game targeted 0.97. Pride now pays a Lazy Lion NFT for filling the
/// board with Crowns, and that prize is funded by taking the coin return down
/// rather than by the house absorbing it -- so its band has to move with it,
/// and the other two must NOT move with Pride. A global band would have had to
/// widen to admit both, which is the same as not checking either.
///
/// Pride's band is on the COIN return. The jackpot's contribution is a separate
/// figure, added in the report, because a player is owed both numbers and the
/// two are funded differently.
fn exit_band(kind: GameKind) -> (f64, f64) {
    // The high profile's band is +/-0.0015 rather than +/-0.0005. Its
    // volatility runs three to four times the low profile's, and resolving a
    // +/-0.0005 band at that volatility takes billions of spins per run; at
    // +/-0.0015 the derived spin count is a few hundred million to a couple of
    // billion. The band and the spin count used are recorded in docs/.
    let half = if kind.is_high() { 0.0015 } else { 0.0005 };
    let t = kind.target_rtp();
    (t - half, t + half)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("{}", USAGE);
        std::process::exit(2);
    }
    let command = args[0].clone();
    let flags = parse_flags(&args[1..]);

    let code = match command.as_str() {
        "simulate" => cmd_simulate(&flags),
        "optimize" => cmd_optimize(&flags),
        "calibrate" => cmd_calibrate(&flags),
        "buyprice" => cmd_buyprice(&flags),
        "ante" => cmd_ante(&flags),
        "hilo" => cmd_hilo(&flags),
        "golden" => cmd_golden(&flags),
        "nft" => cmd_nft(&flags),
        "golden-high" => cmd_golden_high(&flags),
        "help" | "--help" | "-h" => {
            println!("{USAGE}");
            0
        }
        other => {
            eprintln!("unknown command '{other}'\n\n{USAGE}");
            2
        }
    };
    std::process::exit(code);
}

const USAGE: &str = "\
mathsim <command> [flags]

  simulate --game <pride|cubcluster|traitvault|...-high> [--spins N] [--bet N] [--seed N]
           [--threads N] [--rng hmac|fast] [--weights FILE]
  optimize --game <...> [--target-rtp R] [--tolerance T] [--iters N]
           [--eval-spins N] [--seed N] [--threads N] [--out FILE]
  calibrate --game <...> --weights FILE [--spins N] [--target-rtp R] [--rng hmac|fast] [--out FILE]
  buyprice --game <...> [--spins N]      EV-neutral price of buying the feature
  ante     --game <...> [--spins N] [--mult M] [--rng fast]   solve the ante stake per tier
  nft      --game pride-high [--rounds N] how often a free-spin round fills the board
  golden-high [--count N] [--dir DIR] [--out FILE]  exact round outcomes for the page's port
  hilo     [--decisions N] [--deck collection|owned] [--n N] [--seed N]
  golden   [--count N] [--out FILE]

Exit code 1 means an exit criterion failed.";

fn parse_flags(args: &[String]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut i = 0;
    while i < args.len() {
        let key = args[i].trim_start_matches("--").to_string();
        let value = if i + 1 < args.len() && !args[i + 1].starts_with("--") {
            i += 1;
            args[i].clone()
        } else {
            "true".to_string()
        };
        out.insert(key, value);
        i += 1;
    }
    out
}

fn flag<T: std::str::FromStr>(flags: &HashMap<String, String>, key: &str, default: T) -> T {
    flags
        .get(key)
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn require_game(flags: &HashMap<String, String>) -> GameKind {
    let name = flags.get("game").map(String::as_str).unwrap_or("");
    match GameKind::parse(name) {
        Some(k) => k,
        None => {
            eprintln!("--game must be one of: pride, cubcluster, traitvault, pride-high, cubcluster-high, traitvault-high");
            std::process::exit(2);
        }
    }
}

/* ------------------------------------------------------------------ */

fn cmd_simulate(flags: &HashMap<String, String>) -> i32 {
    let kind = require_game(flags);
    let spins: u64 = flag(flags, "spins", 100_000_000);
    let bet: u64 = flag(flags, "bet", 100);
    let seed: u64 = flag(flags, "seed", 42);
    let threads: usize = flag(flags, "threads", default_threads());
    let rng_mode = match flags.get("rng").map(String::as_str) {
        Some("fast") => RngMode::Fast,
        _ => RngMode::Hmac,
    };

    let (strips, coin_probability, pay_scale) = match flags.get("weights") {
        Some(path) => load_weights_for(kind, path),
        None => (kind.default_strips(), kind.default_coin_probability(), 1.0),
    };

    let started = std::time::Instant::now();
    let stats = run(&RunConfig {
        kind,
        spins,
        seed,
        threads,
        rng_mode,
        strips,
        coin_probability,
        pay_scale,
        stake_mult: 1.0,
    });
    let elapsed = started.elapsed();

    report(kind, &stats, bet, rng_mode, elapsed);

    let (lo, hi) = exit_band(kind);
    let in_band = stats.rtp() >= lo && stats.rtp() <= hi;
    if rng_mode != RngMode::Hmac {
        println!("\nNOTE: --rng fast is a search aid. This figure is NOT a quotable RTP.");
        return 0;
    }
    if in_band {
        println!("\nEXIT CRITERION MET: coin RTP is inside [{lo}, {hi}].");
        0
    } else {
        println!("\nEXIT CRITERION FAILED: coin RTP {:.5} is outside [{lo}, {hi}].", stats.rtp());
        1
    }
}

fn cmd_optimize(flags: &HashMap<String, String>) -> i32 {
    let kind = require_game(flags);
    let targets = Targets {
        rtp: flag(flags, "target-rtp", kind.target_rtp()),
        tolerance: flag(flags, "tolerance", 0.0005),
        hit_frequency: flag(
            flags,
            "target-hit",
            match kind {
                GameKind::Pride => 0.38,
                GameKind::CubCluster => 0.44,
                GameKind::TraitVault => 0.44,
                GameKind::PrideHigh => 0.25,
                GameKind::CubClusterHigh => 0.33,
                GameKind::TraitVaultHigh => 0.20,
            },
        ),
        volatility: flag(
            flags,
            "target-volatility",
            match kind {
                GameKind::Pride => 4.2,
                GameKind::CubCluster => 5.4,
                // Matches the target in report().
                GameKind::TraitVault => 5.5,
                GameKind::PrideHigh | GameKind::CubClusterHigh => 12.0,
                GameKind::TraitVaultHigh => 14.0,
            },
        ),
    };

    let cfg = OptimizeConfig {
        kind,
        targets,
        eval_spins: flag(flags, "eval-spins", 300_000),
        iterations: flag(flags, "iters", 400),
        threads: flag(flags, "threads", default_threads()),
        seed: flag(flags, "seed", 42),
    };

    println!(
        "optimizing {} -- target RTP {:.4} +/- {:.4}, {} iterations at {} spins each",
        kind.id(),
        cfg.targets.rtp,
        cfg.targets.tolerance,
        cfg.iterations,
        cfg.eval_spins
    );

    let started = std::time::Instant::now();
    let result = optimize(&cfg);
    println!(
        "\nsearch finished in {:.1}s -- {} iterations, {} accepted, loss {:.6}",
        started.elapsed().as_secs_f64(),
        result.iterations_run,
        result.accepted,
        result.loss
    );
    println!(
        "search-RNG estimate: RTP {:.5}  hit {:.4}  vol {:.3}",
        result.stats.rtp(),
        result.stats.hit_frequency(),
        result.stats.volatility()
    );

    print_weights(&result.strips, result.coin_probability, result.pay_scale);

    if let Some(path) = flags.get("out") {
        match save_weights(path, kind, &result.strips, result.coin_probability, result.pay_scale) {
            Ok(()) => println!("\nwrote {path}"),
            Err(e) => {
                eprintln!("failed to write {path}: {e}");
                return 1;
            }
        }
    }
    println!("\nNext: verify with `mathsim simulate --game {} --spins 100000000 --rng hmac`.", kind.id());
    0
}

/// Correct the pay scale against a full-scale measurement on the PRODUCTION rng.
///
/// `optimize` searches on a cheap RNG at a few hundred thousand spins, so its
/// winner is fitted to that sample -- Pride came out of the search at 0.96995
/// and measured 0.97280 over 100M. Rather than nudge numbers by hand, measure
/// RTP at two pay scales, fit the line through them, and solve for the target.
///
/// Every current feature pays through the SCALED paytable, so RTP is strictly
/// proportional to pay scale and the fit has no constant term.
///
/// This was not always true. Trait Vault's Hold and Win paid fixed coin values
/// that ignored the paytable, which made its feature a constant term -- and the
/// special case for it survived the Lion's Share rework, where it is wrong.
/// Solving the scale as though the feature would stay put while the base game
/// tripled produced a measured RTP of 1.62 against a 0.97 target, with the
/// feature carrying 96.8% of the return instead of a third.
fn cmd_calibrate(flags: &HashMap<String, String>) -> i32 {
    let kind = require_game(flags);
    let spins: u64 = flag(flags, "spins", 20_000_000);
    let target: f64 = flag(flags, "target-rtp", kind.target_rtp());
    let seed: u64 = flag(flags, "seed", 42);
    let threads: usize = flag(flags, "threads", default_threads());

    let path = match flags.get("weights") {
        Some(p) => p.clone(),
        None => {
            eprintln!("--weights FILE is required");
            return 2;
        }
    };
    let (strips, coin_probability, scale0) = load_weights_for(kind, &path);
    // `--rng fast` is allowed HERE because calibration is a search: it solves a
    // scale, and the solved scale is then verified by `simulate` on the
    // production HMAC stream, which is the only figure that may be quoted. At
    // high-profile volatility a calibration precise enough to land inside the
    // band needs a billion spins or more, which the fast stream does in minutes.
    let rng_mode = match flags.get("rng").map(String::as_str) {
        Some("fast") => RngMode::Fast,
        _ => RngMode::Hmac,
    };

    println!("calibrating {} at {spins} spins per point ({:?} rng)", kind.id(), rng_mode);

    // Trait Vault still needs two axes, but the first one is a SHARE, not an
    // absolute RTP. Orb probability sets how the return divides between base and
    // feature; pay scale then sets the total. Solving orb probability against an
    // absolute feature RTP only worked while the feature ignored the paytable --
    // now that it pays through it, the absolute figure moves the moment the
    // scale does, and the split it was solved for evaporates.
    let mut coin_probability = coin_probability;
    if kind == GameKind::TraitVault || kind == GameKind::TraitVaultHigh {
        let target_feature: f64 = flag(flags, "target-feature-rtp", kind.target_feature_rtp());
        let target_share = target_feature / target;
        let measure_coin = |coin: f64, scale: f64| -> Stats {
            run(&RunConfig {
                kind,
                spins,
                seed,
                threads,
                rng_mode,
                strips: strips.clone(),
                coin_probability: coin,
                pay_scale: scale,
                stake_mult: 1.0,
            })
        };
        let share_at = |coin: f64| -> f64 {
            let st = measure_coin(coin, scale0);
            let total = st.base_rtp() + st.feature_rtp();
            if total > 1e-12 { st.feature_rtp() / total } else { 0.0 }
        };
        let coin_a = coin_probability;
        let coin_b = coin_probability * 0.5;
        let sa = share_at(coin_a);
        let sb = share_at(coin_b);
        println!("  orb_p {coin_a:.6} -> feature share {sa:.4}");
        println!("  orb_p {coin_b:.6} -> feature share {sb:.4}");
        let slope = (sa - sb) / (coin_a - coin_b);
        let intercept = sa - slope * coin_a;
        if slope.is_finite() && slope > 1e-9 {
            let raw = (target_share - intercept) / slope;
            // The share is NOT linear in orb probability down to zero: with no
            // orbs at all the feature still carries whatever share ten free
            // spins are worth at the current trigger rate. Clamping an
            // out-of-range solve hides that -- it returns a floor value and
            // reports success, and the run afterwards misses by a mile with
            // nothing pointing at why.
            let floor_share = intercept.min(sa).min(sb);
            if raw <= 0.0 {
                eprintln!(
                    "  CANNOT HIT THE SPLIT: feature share bottoms out near {floor_share:.3} \
                     as orb probability goes to zero, but the target is {target_share:.3}.\n\
                     \x20       Ten free spins at this trigger rate are already worth more than \
                     the target share.\n\
                     \x20       Lower the scatter weight (fewer triggers) or shorten the round \
                     -- orb probability cannot fix it."
                );
                return 1;
            }
            let solved_coin = raw.clamp(0.00005, 0.5);
            if (solved_coin - raw).abs() > 1e-9 {
                eprintln!("  WARNING: solved orb probability {raw:.6} was clamped to {solved_coin:.6}");
            }
            println!("  solved orb_probability for feature share {target_share:.4}: {solved_coin:.6}");
            coin_probability = solved_coin;
        } else {
            eprintln!("  WARNING: feature share does not respond to orb probability; leaving it alone");
        }
    }

    let measure = |scale: f64| -> Stats {
        run(&RunConfig {
            kind,
            spins,
            seed,
            threads,
            rng_mode,
            strips: strips.clone(),
            coin_probability,
            pay_scale: scale,
            stake_mult: 1.0,
        })
    };

    let stats0 = measure(scale0);
    println!(
        "  scale {scale0:.6} -> RTP {:.5} (base {:.5}, feature {:.5})",
        stats0.rtp(),
        stats0.base_rtp(),
        stats0.feature_rtp()
    );

    // Decompose rather than fit a second point.
    //
    // A two-point fit works but is imprecise: each point carries the full
    // variance of total RTP, and that error lands directly in the solved
    // scale. Trait Vault missed by 0.0019 that way, entirely explained by the
    // +/-0.0021 error bar on its 12M-spin calibration points.
    //
    // Decomposition is exact instead. Base wins are strictly proportional to
    // pay scale, and `base_rtp` has far lower variance than total RTP because
    // it excludes the feature's heavy tail, so one run pins the slope better
    // than two runs pin the line.
    let base0 = stats0.base_rtp();
    let feat0 = stats0.feature_rtp();
    // Pride's free spins, Cub Cluster's tumbles and now Trait Vault's Lion's
    // Share all pay from the scaled paytable, so everything rides the slope and
    // there is no constant term for any game. If a future feature pays values
    // the paytable does not reach -- a fixed jackpot, a coin round -- it needs a
    // constant term back, and it needs it deliberately rather than inherited.
    let (alpha, beta) = ((base0 + feat0) / scale0, 0.0);

    // Proportionality holds only while the max-win cap is not biting; if it
    // is, the relationship bends and this solve would overshoot.
    let cap = kind.max_win();
    if stats0.max_win >= cap * 0.999 {
        println!(
            "  NOTE: max win {:.1}x is at the {cap:.0}x cap, so RTP is no longer\n\
             \x20       strictly proportional to pay scale. Re-verify and iterate.",
            stats0.max_win
        );
    }
    if !(alpha.is_finite() && alpha > 1e-9) {
        eprintln!(
            "cannot calibrate: RTP barely responds to pay scale (slope {alpha:.3e}). \
             The feature, not the paytable, is carrying this game's return."
        );
        return 1;
    }
    let solved = (target - beta) / alpha;
    if solved <= 0.0 {
        eprintln!("cannot calibrate: solved scale {solved:.6} is not positive");
        return 1;
    }

    println!("  model: RTP = {alpha:.6} * scale + {beta:.6}");
    println!("  solved pay_scale for {target:.5}: {solved:.6}");

    let out_path = flags.get("out").cloned().unwrap_or(path);
    match save_weights(&out_path, kind, &strips, coin_probability, solved) {
        Ok(()) => println!("wrote {out_path}"),
        Err(e) => {
            eprintln!("failed to write {out_path}: {e}");
            return 1;
        }
    }
    println!("\nNext: verify with `mathsim simulate --game {} --spins 100000000 --rng hmac --weights {out_path}`.", kind.id());
    0
}

/// Price a "buy the feature" button so it is exactly EV-neutral.
///
/// A bought feature must return the same 97% as a spun one. If the price sits
/// below EV/0.97 the button is an arbitrage on the bankroll -- the same failure
/// mode as an underpriced sacrifice package (spec Sec. 9.3), and far easier to
/// exploit because it needs no NFT and no cross-chain hop.
fn cmd_buyprice(flags: &HashMap<String, String>) -> i32 {
    let kind = require_game(flags);
    if kind == GameKind::CubCluster {
        eprintln!("Cub Cluster has no discrete feature to buy -- its tumbles are part of the base spin.");
        return 2;
    }
    let spins: u64 = flag(flags, "spins", 40_000_000);
    let threads: usize = flag(flags, "threads", default_threads());
    let path = flags.get("weights").cloned().unwrap_or_default();
    let (strips, coin_probability, pay_scale) = if path.is_empty() {
        (kind.default_strips(), kind.default_coin_probability(), 1.0)
    } else {
        load_weights_for(kind, &path)
    };

    if kind.is_high() {
        // Play the bought round itself. Its EV is its price's numerator.
        let rounds: u64 = flag(flags, "rounds", 20_000_000);
        let rng_mode = match flags.get("rng").map(String::as_str) {
            Some("fast") => RngMode::Fast,
            _ => RngMode::Hmac,
        };
        let st = run_buy(&RunConfig {
            kind, spins: rounds, seed: flag(flags, "seed", 42), threads,
            rng_mode, strips, coin_probability, pay_scale, stake_mult: 1.0,
        });
        let target: f64 = flag(flags, "target-rtp", kind.target_rtp());
        let ev = st.rtp();
        println!("=== BUY FEATURE PRICE -- {} (bought rounds played directly) ===", kind.id());
        println!("  rounds                : {} ({rng_mode:?} rng)", st.spins);
        println!("  EV per bought round   : {:.4}x total bet  (+/- {:.4})", ev, st.rtp_ci95());
        println!("  round volatility      : {:.3}", st.volatility());
        println!("  max round observed    : {:.1}x", st.max_win);
        println!();
        println!("  EV-NEUTRAL BUY PRICE  : {:.4}x total bet  (returns {target:.5})", ev / target);
        println!("  NOTE: ship behind a jurisdiction flag; banned in several markets, the UK among them.");
        return 0;
    }

    let stats = run(&RunConfig {
        kind, spins, seed: flag(flags, "seed", 42), threads,
        rng_mode: RngMode::Hmac, strips, coin_probability, pay_scale, stake_mult: 1.0,
    });

    let freq = stats.feature_frequency();
    if freq <= 0.0 {
        eprintln!("feature never triggered in {spins} spins");
        return 1;
    }
    let ev_per_trigger = stats.feature_rtp() / freq;
    // Divide by the GAME's target, not by a hardcoded 0.97. That literal was
    // harmless while every game returned 0.97 and silently wrong the moment one
    // did not: Pride returns 0.87, and pricing its feature at EV/0.97 sells the
    // round for less than spinning for it is worth -- a house-negative bug that
    // reports itself as "identical to spinning for it".
    let target: f64 = flag(flags, "target-rtp", exit_band(kind).0 + 0.0005);
    let price = ev_per_trigger / target;

    println!("=== BUY FEATURE PRICE -- {} ===", kind.id());
    println!("  spins                 : {spins}");
    println!("  feature RTP           : {:.5} per spin", stats.feature_rtp());
    println!("  feature frequency     : {:.5}  (1 in {:.0})", freq, 1.0 / freq);
    println!("  EV per triggered round: {:.4}x total bet", ev_per_trigger);
    println!();
    println!("  EV-NEUTRAL BUY PRICE  : {:.4}x total bet", price);
    println!("  (buying returns {:.5} -- identical to spinning for it)", ev_per_trigger / price);
    println!();
    println!("  NOTE: buy-bonus mechanics are prohibited in several regulated markets");
    println!("        (the UK among them). Ship behind a jurisdiction flag.");
    0
}

/// Price the ante bet.
///
/// The obvious formulation -- "charge +25% stake, double the scatter chance" --
/// does not survive contact with integer strip weights. Pride carries 4-5
/// scatters per reel, so the smallest possible bump is +1, which moves the
/// trigger rate by roughly 40% and jumps RTP from 0.91 to 1.05. Nothing lands
/// on 0.97, and no multiplier in between exists to solve for: k = 1.387 and
/// k = 1.430 round to the same strips and return the same number.
///
/// So invert it. Fix the scatter supply at each achievable INTEGER step and
/// solve the stake, which is continuous. That yields ante tiers a player can
/// actually be charged for, each EV-neutral by construction.
fn cmd_ante(flags: &HashMap<String, String>) -> i32 {
    let kind = require_game(flags);
    if matches!(kind, GameKind::CubCluster | GameKind::TraitVault) {
        eprintln!("{} has no ante: its low profile is not priced for one.", kind.id());
        return 2;
    }
    let spins: u64 = flag(flags, "spins", 12_000_000);
    let target: f64 = flag(flags, "target-rtp", kind.target_rtp());
    let threads: usize = flag(flags, "threads", default_threads());
    let seed: u64 = flag(flags, "seed", 42);
    // As with calibrate: the stake is SOLVED, and at high-profile volatility a
    // solve precise to a fraction of a percent needs hundreds of millions of
    // spins per tier. The fast stream may search; the price is then checked on
    // the production stream by verify-play-math and by `simulate`.
    let rng_mode = match flags.get("rng").map(String::as_str) {
        Some("fast") => RngMode::Fast,
        _ => RngMode::Hmac,
    };
    let path = flags.get("weights").cloned().unwrap_or_default();
    let (base_strips, coin_probability, pay_scale) = if path.is_empty() {
        (kind.default_strips(), kind.default_coin_probability(), 1.0)
    } else {
        load_weights_for(kind, &path)
    };

    println!("=== ANTE TIERS -- {} ({spins} spins per tier) ===", kind.id());
    println!("  scatter/reel is an integer, so the tiers below are every ante");
    println!("  this strip length can express.\n");
    println!("  {:<10} {:>12} {:>14} {:>16}", "extra scat", "return/base", "feature freq", "EV-neutral stake");

    // --mult scales every weight before the extra scatters go on, so a tier can
    // add a fraction of a scatter (see StripSpec::ante).
    let mult: u32 = flag(flags, "mult", 1);
    println!("  strips scaled x{mult} before the extra scatters
");
    for extra in 0..=3u32 {
        let spec = base_strips.ante(mult, extra);
        // Measure at stake 1.0 so the result is raw return per base bet; the
        // EV-neutral stake then falls straight out of it.
        let st = run(&RunConfig {
            kind, spins, seed, threads, rng_mode,
            strips: spec, coin_probability, pay_scale, stake_mult: 1.0,
        });
        let ret = st.rtp();
        let stake = ret / target;
        let freq = st.feature_frequency();
        println!("  {:<10} {:>12.5} {:>14} {:>15.4}x   (+/- {:.4})",
                 format!("+{extra}"),
                 ret,
                 if freq > 0.0 { format!("1 in {:.0}", 1.0 / freq) } else { "never".into() },
                 stake, st.rtp_ci95() / target);
    }
    println!("\n  Read: charging that stake for that scatter supply keeps RTP at {target:.5}.");
    println!("  +0 is the base game and must come out at 1.0000x -- if it does not,");
    println!("  the base calibration has drifted and nothing below it is trustworthy.");
    0
}

fn cmd_hilo(flags: &HashMap<String, String>) -> i32 {
    use games::hilo::{DeckMode, Direction, HiLo, MAX_ROUND_MULTIPLIER};

    let decisions: u64 = flag(flags, "decisions", 20_000_000);
    let seed: u64 = flag(flags, "seed", 42);
    let mode = match flags.get("deck").map(String::as_str) {
        Some("owned") => DeckMode::Owned,
        _ => DeckMode::Collection,
    };
    let collection: u32 = flag(flags, "n", 10_078);
    let owned: u32 = flag(flags, "owned-n", 73);

    let game = HiLo::new(mode, collection, owned);
    let mut rng = rng::FastRng::new(seed);

    let mut staked = 0.0f64;
    let mut returned = 0.0f64;
    let mut disabled_offers = 0u64;
    let mut max_step_multiplier = 0.0f64;

    for _ in 0..decisions {
        let p = game.draw_card(&mut rng);
        let offered = game.offered(p);
        if offered.len() < 2 {
            disabled_offers += 1;
        }
        // A dead rank -- both directions refused -- is a free swap in the
        // game, so it is a free redraw here: no stake, next card. Indexing
        // offered[0] unconditionally panicked the moment the sucker-bet
        // refusal created the first empty offer list.
        if offered.is_empty() {
            continue;
        }
        // Strategy is irrelevant to the edge -- pick the first offered
        // direction, which is exactly the point being demonstrated.
        let dir: Direction = offered[0];
        let outcome = game.decide(&mut rng, p, dir);
        staked += 1.0;
        returned += outcome.returned;
        if let Some(m) = games::hilo::payout(game.n, p, dir) {
            max_step_multiplier = max_step_multiplier.max(m);
        }
    }

    let rtp = returned / staked;
    println!("RARITY HI/LO -- deck {:?}, N = {}", mode, game.n);
    println!("  decisions              : {decisions}");
    println!("  per-decision RTP       : {:.6}", rtp);
    println!("  theoretical            : 0.970000  (exact, by construction)");
    println!("  max step multiplier    : {:.4}x  (ceiling 19.4x)", max_step_multiplier);
    println!(
        "  positions with a disabled direction: {:.3}%",
        100.0 * disabled_offers as f64 / decisions as f64
    );
    println!("  round cap              : {MAX_ROUND_MULTIPLIER}x");

    if (rtp - 0.97).abs() < 0.002 {
        println!("\nEXIT CRITERION MET: measured per-decision RTP matches 97%.");
        0
    } else {
        println!("\nEXIT CRITERION FAILED: measured RTP {rtp:.6} drifted from 97%.");
        1
    }
}

/// Emit cross-implementation fixtures. The TypeScript engine must reproduce
/// every value here bit-for-bit (spec Sec. 4).
fn cmd_golden(flags: &HashMap<String, String>) -> i32 {
    let count: usize = flag(flags, "count", 10_000);
    let path = flags
        .get("out")
        .cloned()
        .unwrap_or_else(|| "tests/golden/rng.json".to_string());

    let mut out = String::from("{\n  \"note\": \"Generated by `mathsim golden`. The TypeScript engine must reproduce every value exactly.\",\n  \"cases\": [\n");

    for i in 0..count {
        let server_seed: Vec<u8> = (0..32).map(|b| ((i * 31 + b * 7) % 256) as u8).collect();
        let client_seed = format!("client-{i}");
        let nonce = i as u64;
        let game_id = ["pride", "cubcluster", "traitvault", "hilo"][i % 4];

        let mut r = HmacRng::new(&server_seed, &client_seed, nonce, game_id);
        let bounds = [150u32, 10_078, 4, 1_000_000, 37, 2];
        let values: Vec<u32> = bounds.iter().map(|&b| r.below(b)).collect();

        out.push_str("    {");
        out.push_str(&format!("\"serverSeedHex\": \"{}\", ", hex(&server_seed)));
        out.push_str(&format!("\"serverSeedHash\": \"{}\", ", hex(&sha256(&server_seed))));
        out.push_str(&format!("\"clientSeed\": \"{client_seed}\", "));
        out.push_str(&format!("\"nonce\": {nonce}, "));
        out.push_str(&format!("\"gameId\": \"{game_id}\", "));
        out.push_str(&format!("\"bounds\": {bounds:?}, "));
        out.push_str(&format!("\"values\": {values:?}"));
        out.push('}');
        if i + 1 < count {
            out.push(',');
        }
        out.push('\n');
    }
    out.push_str("  ]\n}\n");

    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(&path, out) {
        Ok(()) => {
            println!("wrote {count} golden vectors to {path}");
            0
        }
        Err(e) => {
            eprintln!("failed to write {path}: {e}");
            1
        }
    }
}

/* ------------------------------------------------------------------ */

fn report(kind: GameKind, s: &Stats, bet: u64, mode: RngMode, elapsed: std::time::Duration) {
    // The cap comes from GameKind::max_win() rather than being restated here.
    // It was restated, and the two drifted the moment Trait Vault's ceiling
    // moved: the simulator enforced 5000x while this report still printed
    // "design cap 1000x", so a run that behaved correctly would have been read
    // as a run against the old design.
    let target_max = kind.max_win();
    // The volatility ceiling is PER GAME. A single 5.5 for the suite was a
    // reasonable default while all three games sat under it, but it is a
    // property of a game's mechanic, not of the cabinet: Lion's Share is a
    // scatter-triggered round with sticky multipliers and simply does not live
    // in the same range as a tumble game.
    let (target_hit, target_vol, vol_ceiling) = match kind {
        // The high profile is a volatility product by design: hit rates in the
        // reference's range (1 in 2.3-3.6 for tumble games, 1 in 4-7 for lines
        // and ways) and no ceiling below the max-win cap itself.
        GameKind::PrideHigh => (0.25, 12.0, 40.0),
        GameKind::CubClusterHigh => (0.33, 12.0, 40.0),
        GameKind::TraitVaultHigh => (0.20, 14.0, 40.0),
        GameKind::Pride => (0.38, 4.2, 5.5),
        GameKind::CubCluster => (0.44, 5.4, 5.5),
        // Lion's Share shifts weight into the feature: the Mane Meter paid out
        // in small, frequent Hold and Win coins, while a scatter-triggered round
        // with sticky row multipliers is rarer and much larger. Volatility rises
        // with it -- this is still the calmest game in the suite, but 3.1 was a
        // target for a mechanic that no longer exists.
        // Trait Vault sat at a 3.1 volatility target that described the Mane
        // Meter, which filled every six spins. With Lion's Share the index went
        // to 11.1, and taming the orb table and the row ceiling only reached
        // 6.65 -- so this was briefly repositioned to a 7.8 target and an 8.5
        // ceiling.
        //
        // What actually fixed it was the paytable SHAPE. Extending
        // two-of-a-kind down through the mids lifted hit frequency 0.17 -> 0.35
        // and, by moving return out of the tail and into frequent small wins,
        // pulled volatility to 5.54 -- back inside the range the rest of the
        // suite lives in. The ceiling is 6.0 rather than 5.5 only because the
        // measurement sits just above it and shaving the difference would mean
        // shrinking the feature for no reason a player would notice.
        //
        // Hit frequency is still short of 0.44. Reaching it needs
        // two-of-a-kind on the low symbols too, which would push the rate past
        // 0.6 with nearly every added win paying less than the stake.
        GameKind::TraitVault => (0.44, 5.5, 6.0),
    };
    let feature_target = kind.target_feature_rtp();
    let split = format!(
        "{:.0} / {:.0}",
        (kind.target_rtp() - feature_target) * 100.0,
        feature_target * 100.0
    );

    println!("=== {} ===", kind.id().to_uppercase());
    println!("  rng                    : {mode:?}");
    println!("  spins                  : {}", s.spins);
    println!("  bet                    : {bet} $LAZY");
    println!("  wall clock             : {:.1}s", elapsed.as_secs_f64());
    println!();
    let (band_lo, band_hi) = exit_band(kind);
    println!("  coin RTP               : {:.5}   (band [{band_lo}, {band_hi}])", s.rtp());
    println!("  95% CI on RTP          : +/- {:.5}", s.rtp_ci95());
    println!("  hit frequency          : {:.4}    (target {target_hit:.2})", s.hit_frequency());
    println!("  volatility index       : {:.3}     (target {target_vol:.1}, ceiling {vol_ceiling:.1})", s.volatility());
    println!("  max win observed       : {:.1}x    (design cap {target_max:.0}x)", s.max_win);
    println!(
        "  RTP split base/feature : {:.1} / {:.1}   (target {split})",
        100.0 * s.base_rtp(),
        100.0 * s.feature_rtp()
    );
    println!("  feature trigger freq   : {:.5}  (1 in {:.0})", s.feature_frequency(),
             if s.feature_frequency() > 0.0 { 1.0 / s.feature_frequency() } else { f64::INFINITY });
    println!("  longest losing streak  : {} (per-worker lower bound)", s.longest_losing_streak);
    if kind == GameKind::Pride {
        // The NFT is reported SEPARATELY from the coin RTP and never folded in.
        // A player is owed both numbers: one is what the paytable returns, the
        // other is a fixed prize that arrives at a rate no session will ever
        // sample. Averaging them into a single figure would describe a machine
        // nobody actually plays.
        //
        // The expected figure is closed form -- q^5 * prize -- because at one
        // hit in ~1.3 million spins even a 100M-spin run sees about 77 of them,
        // so the OBSERVED rate is a check on the mechanic, not a measurement of
        // it. Both are printed so the two can be compared.
        let p = games::pride::nft_probability_per_spin(s.feature_frequency());
        let observed = s.nft_hits as f64 / s.spins.max(1) as f64;
        println!();
        println!("  -- Lion's Crown jackpot (a Lazy Lion NFT, outside the coin economy) --");
        println!("  per grid                : 1 in {:.0}", 1.0 / games::pride::nft_probability());
        println!("  per SPIN                : 1 in {:.0}  (a triggered spin draws 11 grids)",
                 1.0 / p);
        println!("  observed               : {} hit(s), 1 in {}", s.nft_hits,
                 if observed > 0.0 { format!("{:.0}", 1.0 / observed) } else { "-- (none seen)".into() });
        println!("  prize                  : {:.0}x total bet", games::pride::NFT_PRIZE_X);
        let jr = games::pride::nft_rtp(s.feature_frequency());
        println!("  jackpot RTP            : {jr:.5}   (closed form on the measured trigger rate)");
        println!("  TOTAL RETURN           : {:.5}   (coin {:.5} + jackpot {jr:.5})",
                 s.rtp() + jr, s.rtp());
    }
    println!();
    println!("  win distribution (multiples of bet):");
    let mut low = 0.0f64;
    for b in 0..HIST_BUCKETS {
        let label = if b == 0 {
            "        0 (loss)".to_string()
        } else if b == HIST_BUCKETS - 1 {
            format!("    > {:>8.0}x", HIST_EDGES[HIST_BUCKETS - 2])
        } else {
            format!("  {:>6.1}x - {:>6.1}x", low, HIST_EDGES[b])
        };
        let pct = 100.0 * s.hist[b] as f64 / s.spins as f64;
        println!("   {label} : {:>12}  {:>7.4}%", s.hist[b], pct);
        if b < HIST_BUCKETS - 1 {
            low = HIST_EDGES[b];
        }
    }

    if s.volatility() > vol_ceiling {
        println!("\n  WARNING: volatility index {:.2} exceeds this game's {vol_ceiling:.1} ceiling.", s.volatility());
    }
    if s.max_win > target_max {
        println!("\n  WARNING: observed max win {:.0}x exceeds the {target_max:.0}x design cap.", s.max_win);
    }
}

fn default_threads() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn print_weights(strips: &StripSpec, coin_probability: f64, pay_scale: f64) {
    println!("\noptimized strip weights:");
    print!("  {:<6}", "reel");
    for name in SYMBOL_NAMES {
        print!("{name:>6}");
    }
    println!("{:>8}", "total");
    for reel in 0..strips.weights.len() {
        print!("  {:<6}", reel + 1);
        for s in 0..NUM_SYMBOLS {
            print!("{:>6}", strips.weights[reel][s]);
        }
        let total: u32 = strips.weights[reel].iter().sum();
        println!("{total:>8}");
    }
    println!("  coin_probability: {coin_probability:.6}");
    println!("  pay_scale       : {pay_scale:.6}");
}

fn save_weights(
    path: &str,
    kind: GameKind,
    strips: &StripSpec,
    coin_probability: f64,
    pay_scale: f64,
) -> std::io::Result<()> {
    let mut out = String::new();
    out.push_str(&format!("# game: {}\n", kind.id()));
    out.push_str(&format!("# symbols: {}\n", SYMBOL_NAMES.join(",")));
    out.push_str(&format!("coin_probability {coin_probability}\n"));
    out.push_str(&format!("pay_scale {pay_scale}\n"));
    for reel in 0..strips.weights.len() {
        let row: Vec<String> = strips.weights[reel].iter().map(|w| w.to_string()).collect();
        out.push_str(&format!("reel {}\n", row.join(" ")));
    }
    // Carry the ante's definition over: it is a parameter of the game, set by
    // hand, and a recalibration must not silently drop it.
    if let Ok(old) = std::fs::read_to_string(path) {
        for line in old.lines().filter(|l| l.trim_start().starts_with("ante_")) {
            out.push_str(line.trim());
            out.push('\n');
        }
    }
    if let Some(parent) = std::path::Path::new(path).parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, out)
}

/// Load a weights file and refuse one carrying the wrong number of reels for
/// the game it is about to drive.
fn load_weights_for(kind: GameKind, path: &str) -> (StripSpec, f64, f64) {
    let (s, c, p) = load_weights(path);
    if s.weights.len() != kind.reels() {
        eprintln!("weights file {path} has {} reels; {} needs {}", s.weights.len(), kind.id(), kind.reels());
        std::process::exit(2);
    }
    (s, c, p)
}

/// Exact outcomes of the high-profile games on the production HMAC stream, for
/// fixed seeds, in every mode a player can use: spin, ante and buy.
///
/// The low profile's port is checked by golden RNG vectors plus a loose RTP
/// convergence test -- loose enough to miss a slip that moves RTP by less than a
/// percent. These are exact: the page must reproduce every round's base and
/// feature to the last representable digit, which a reordered draw, a dropped
/// retrigger or a misread spot rule cannot survive.
fn cmd_golden_high(flags: &HashMap<String, String>) -> i32 {
    use games::{cluster_high::CubClusterHigh, pride_high::PrideHigh, vault_high::TraitVaultHigh, GameState};
    let count: u64 = flag(flags, "count", 300);
    let dir = flags.get("dir").cloned().unwrap_or_else(|| "../../packages/engine/src/paytables/weights/high".into());
    let out_path = flags.get("out").cloned().unwrap_or_else(|| "../../tests/golden/high.json".into());
    let server_seed: Vec<u8> = (0..32u8).map(|i| i.wrapping_mul(29).wrapping_add(5)).collect();
    let mut json = String::from("{
  \"serverSeedHex\": \"");
    json.push_str(&hex(&server_seed));
    json.push_str("\",
  \"client\": \"golden\",
  \"engines\": {
");
    let mut first_engine = true;
    for kind in [GameKind::PrideHigh, GameKind::CubClusterHigh, GameKind::TraitVaultHigh] {
        let (strips, coin, scale) = load_weights_for(kind, &format!("{dir}/{}.weights", kind.id()));
        // The ante's definition lives in the weights file (ante_mult, ante_extra),
        // because it is a parameter of the game; its stake is a measurement and
        // lives with the prices.
        let (am, ae) = ante_def(&format!("{dir}/{}.weights", kind.id()));
        let ante_spec = strips.ante(am, ae);
        let mut rows: Vec<String> = Vec::new();
        for mode in ["spin", "ante", "buy"] {
            let spec = if mode == "ante" { &ante_spec } else { &strips };
            for nonce in 0..count {
                let mut rng = HmacRng::new(&server_seed, "golden", nonce, kind.id());
                let (base, feature) = match kind {
                    GameKind::PrideHigh => {
                        let mut pays = tables::pride_high_pays();
                        for r in pays.iter_mut() { for v in r.iter_mut() { *v *= scale; } }
                        let g = PrideHigh::new(spec, pays, kind.max_win());
                        if mode == "buy" { (0.0, g.free_spins(&mut rng, 10, g.cap).coins) }
                        else { let o = g.spin(&mut rng); (o.base, o.feature) }
                    }
                    GameKind::CubClusterHigh => {
                        let mut pays = tables::cluster_high_pays();
                        for r in pays.iter_mut() { for v in r.iter_mut() { *v *= scale; } }
                        let g = CubClusterHigh::new(spec, pays, kind.max_win());
                        if mode == "buy" { (0.0, g.free_spins(&mut rng, 10, g.cap)) }
                        else { let o = g.spin(&mut rng); (o.base, o.feature) }
                    }
                    _ => {
                        let mut pays = tables::vault_high_pays();
                        for r in pays.iter_mut() { for v in r.iter_mut() { *v *= scale; } }
                        let g = TraitVaultHigh::new(spec, pays, coin, kind.max_win());
                        if mode == "buy" { (0.0, g.free_spins(&mut rng, 10, g.cap)) }
                        else { let o = g.spin(&mut rng, &mut GameState::default()); (o.base, o.feature) }
                    }
                };
                rows.push(format!("      [\"{mode}\", {nonce}, {base:?}, {feature:?}]"));
            }
        }
        if !first_engine { json.push_str(",
"); }
        first_engine = false;
        json.push_str(&format!("    \"{}\": [
{}
    ]", kind.id(), rows.join(",
")));
    }
    json.push_str("
  }
}
");
    match std::fs::write(&out_path, json) {
        Ok(()) => { println!("wrote {out_path}: {} rounds per engine", count * 3); 0 }
        Err(e) => { eprintln!("failed to write {out_path}: {e}"); 1 }
    }
}

/// How often a Pride high-profile free-spin round fills the board.
///
/// Crowns stick in the round, so the Lion's odds are no longer the closed form
/// q^5 per grid. They are measured here by playing rounds on their own --
/// cheap, because a round is a dozen grids -- and combined with the trigger
/// rate a full simulation measures.
fn cmd_nft(flags: &HashMap<String, String>) -> i32 {
    use games::pride_high::{PrideHigh, CROWN_STACK_NUM, CROWN_STACK_DENOM, NFT_PRIZE_X};
    let kind = require_game(flags);
    if kind != GameKind::PrideHigh {
        eprintln!("nft applies to pride-high only; the low profile is closed form.");
        return 2;
    }
    let rounds: u64 = flag(flags, "rounds", 50_000_000);
    let threads: usize = flag(flags, "threads", default_threads());
    let seed: u64 = flag(flags, "seed", 4242);
    let (strips, _c, pay_scale) = match flags.get("weights") {
        Some(p) => load_weights_for(kind, p),
        None => (kind.default_strips(), 0.0, 1.0),
    };
    let mut pays = tables::pride_high_pays();
    for row in pays.iter_mut() { for v in row.iter_mut() { *v *= pay_scale; } }
    let hits: u64 = std::thread::scope(|scope| {
        let hs: Vec<_> = (0..threads).map(|t| {
            let strips = strips.clone();
            let pays = pays;
            scope.spawn(move || {
                let g = PrideHigh::new(&strips, pays, kind.max_win());
                let mut rng = rng::FastRng::new(seed ^ ((t as u64 + 1) << 32));
                let n = rounds / threads as u64;
                let mut h = 0u64;
                for _ in 0..n {
                    if g.free_spins(&mut rng, 10, f64::INFINITY).nft { h += 1; }
                }
                h
            })
        }).collect();
        hs.into_iter().map(|h| h.join().unwrap()).sum()
    });
    let n = (rounds / threads as u64) * threads as u64;
    let p_round = hits as f64 / n as f64;
    let se = (p_round * (1.0 - p_round) / n as f64).sqrt();
    let per_grid = (CROWN_STACK_NUM as f64 / CROWN_STACK_DENOM as f64).powi(REELS as i32);
    let freq: f64 = flag(flags, "feature-frequency", 0.0);
    println!("=== LION'S CROWN, HIGH PROFILE ===");
    println!("  rounds simulated        : {n} (10-spin opening award, retriggers live)");
    println!("  board filled            : {hits} round(s), 1 in {:.0} rounds  (+/- {:.2e})",
             if p_round > 0.0 { 1.0 / p_round } else { f64::INFINITY }, 1.96 * se);
    println!("  base grid, closed form  : 1 in {:.0}", 1.0 / per_grid);
    if freq > 0.0 {
        let per_spin = per_grid + freq * p_round;
        println!("  per SPIN at trigger 1 in {:.0}: 1 in {:.0}", 1.0 / freq, 1.0 / per_spin);
        println!("  jackpot RTP             : {:.5}  ({:.0}x prize)", per_spin * NFT_PRIZE_X, NFT_PRIZE_X);
    } else {
        println!("  pass --feature-frequency F (from simulate) for the per-spin rate and jackpot RTP");
    }
    0
}

/// `ante_mult` and `ante_extra` from a weights file; (1, 1) when absent.
fn ante_def(path: &str) -> (u32, u32) {
    let body = std::fs::read_to_string(path).unwrap_or_default();
    let get = |k: &str| body.lines().find_map(|l| l.trim().strip_prefix(k).and_then(|v| v.trim().parse::<u32>().ok()));
    (get("ante_mult").unwrap_or(1), get("ante_extra").unwrap_or(1))
}

fn load_weights(path: &str) -> (StripSpec, f64, f64) {
    let body = match std::fs::read_to_string(path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("cannot read weights file {path}: {e}");
            std::process::exit(2);
        }
    };
    let mut weights: Vec<[u32; NUM_SYMBOLS]> = Vec::new();
    let mut reel = 0usize;
    let mut coin_probability = tables::VAULT_COIN_PROBABILITY;
    let mut pay_scale = 1.0f64;

    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("pay_scale") {
            pay_scale = rest.trim().parse().unwrap_or(pay_scale);
            continue;
        }
        if let Some(rest) = line.strip_prefix("coin_probability") {
            coin_probability = rest.trim().parse().unwrap_or(coin_probability);
            continue;
        }
        if let Some(rest) = line.strip_prefix("reel") {
            let values: Vec<u32> = rest
                .split_whitespace()
                .filter_map(|v| v.parse().ok())
                .collect();
            if values.len() != NUM_SYMBOLS {
                eprintln!("malformed weights file {path}: bad reel row");
                std::process::exit(2);
            }
            let mut row = [0u32; NUM_SYMBOLS];
            row.copy_from_slice(&values);
            weights.push(row);
            reel += 1;
        }
    }
    if reel == 0 {
        eprintln!("malformed weights file {path}: no reel rows");
        std::process::exit(2);
    }
    (StripSpec { weights }, coin_probability, pay_scale)
}
