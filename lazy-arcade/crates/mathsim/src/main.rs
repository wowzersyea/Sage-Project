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
use sim::{run, GameKind, RngMode, RunConfig, Stats, HIST_BUCKETS, HIST_EDGES};
use std::collections::HashMap;

const EXIT_RTP_LOW: f64 = 0.9695;
const EXIT_RTP_HIGH: f64 = 0.9705;

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
        "hilo" => cmd_hilo(&flags),
        "golden" => cmd_golden(&flags),
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

  simulate --game <pride|cubcluster|traitvault> [--spins N] [--bet N] [--seed N]
           [--threads N] [--rng hmac|fast] [--weights FILE]
  optimize --game <...> [--target-rtp R] [--tolerance T] [--iters N]
           [--eval-spins N] [--seed N] [--threads N] [--out FILE]
  calibrate --game <...> --weights FILE [--spins N] [--target-rtp R] [--out FILE]
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
            eprintln!("--game must be one of: pride, cubcluster, traitvault");
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
        Some(path) => load_weights(path),
        None => (kind.default_strips(), tables::VAULT_COIN_PROBABILITY, 1.0),
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
    });
    let elapsed = started.elapsed();

    report(kind, &stats, bet, rng_mode, elapsed);

    let in_band = stats.rtp() >= EXIT_RTP_LOW && stats.rtp() <= EXIT_RTP_HIGH;
    if rng_mode != RngMode::Hmac {
        println!("\nNOTE: --rng fast is a search aid. This figure is NOT a quotable RTP.");
        return 0;
    }
    if in_band {
        println!("\nEXIT CRITERION MET: RTP is inside [{EXIT_RTP_LOW}, {EXIT_RTP_HIGH}].");
        0
    } else {
        println!("\nEXIT CRITERION FAILED: RTP {:.5} is outside [{EXIT_RTP_LOW}, {EXIT_RTP_HIGH}].", stats.rtp());
        1
    }
}

fn cmd_optimize(flags: &HashMap<String, String>) -> i32 {
    let kind = require_game(flags);
    let targets = Targets {
        rtp: flag(flags, "target-rtp", 0.97),
        tolerance: flag(flags, "tolerance", 0.0005),
        hit_frequency: flag(
            flags,
            "target-hit",
            match kind {
                GameKind::Pride => 0.38,
                GameKind::CubCluster => 0.44,
                GameKind::TraitVault => 0.48,
            },
        ),
        volatility: flag(
            flags,
            "target-volatility",
            match kind {
                GameKind::Pride => 4.2,
                GameKind::CubCluster => 5.4,
                GameKind::TraitVault => 3.1,
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
/// The relationship is linear but NOT proportional: Trait Vault's Hold and Win
/// pays in coin values that do not scale with the paytable, so RTP has a
/// constant term. A two-point fit recovers both terms without needing to know
/// which game has one.
fn cmd_calibrate(flags: &HashMap<String, String>) -> i32 {
    let kind = require_game(flags);
    let spins: u64 = flag(flags, "spins", 20_000_000);
    let target: f64 = flag(flags, "target-rtp", 0.97);
    let seed: u64 = flag(flags, "seed", 42);
    let threads: usize = flag(flags, "threads", default_threads());

    let path = match flags.get("weights") {
        Some(p) => p.clone(),
        None => {
            eprintln!("--weights FILE is required");
            return 2;
        }
    };
    let (strips, coin_probability, scale0) = load_weights(&path);

    println!("calibrating {} at {spins} spins per point (production HMAC rng)", kind.id());

    // Trait Vault needs two axes, not one. Its Hold and Win pays coin values
    // that are independent of the paytable, so pay scale moves only the base
    // game. Solve the feature first (via coin probability), then the base.
    let mut coin_probability = coin_probability;
    if kind == GameKind::TraitVault {
        let target_feature: f64 = flag(flags, "target-feature-rtp", 0.23);
        let measure_coin = |coin: f64, scale: f64| -> Stats {
            run(&RunConfig {
                kind,
                spins,
                seed,
                threads,
                rng_mode: RngMode::Hmac,
                strips: strips.clone(),
                coin_probability: coin,
                pay_scale: scale,
            })
        };
        let coin_a = coin_probability;
        let coin_b = coin_probability * 0.5;
        let fa = measure_coin(coin_a, scale0).feature_rtp();
        let fb = measure_coin(coin_b, scale0).feature_rtp();
        println!("  coin_p {coin_a:.6} -> feature RTP {fa:.5}");
        println!("  coin_p {coin_b:.6} -> feature RTP {fb:.5}");
        let slope = (fa - fb) / (coin_a - coin_b);
        let intercept = fa - slope * coin_a;
        if slope.is_finite() && slope > 1e-9 {
            let solved_coin = ((target_feature - intercept) / slope).clamp(0.00005, 0.5);
            println!("  solved coin_probability for feature RTP {target_feature:.3}: {solved_coin:.6}");
            coin_probability = solved_coin;
        } else {
            eprintln!("  WARNING: feature RTP does not respond to coin probability; leaving it alone");
        }
    }

    let measure = |scale: f64| -> Stats {
        run(&RunConfig {
            kind,
            spins,
            seed,
            threads,
            rng_mode: RngMode::Hmac,
            strips: strips.clone(),
            coin_probability,
            pay_scale: scale,
        })
    };

    let scale1 = scale0 * 1.5;
    let stats0 = measure(scale0);
    println!("  scale {scale0:.6} -> RTP {:.5}", stats0.rtp());
    let stats1 = measure(scale1);
    println!("  scale {scale1:.6} -> RTP {:.5}", stats1.rtp());

    let alpha = (stats1.rtp() - stats0.rtp()) / (scale1 - scale0);
    let beta = stats0.rtp() - alpha * scale0;
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

    println!("  fit: RTP = {alpha:.6} * scale + {beta:.6}");
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
    let (target_hit, target_vol, target_max, split) = match kind {
        GameKind::Pride => (0.38, 4.2, 2_000.0, "68 / 29"),
        GameKind::CubCluster => (0.44, 5.4, 2_500.0, "71 / 26"),
        GameKind::TraitVault => (0.48, 3.1, 1_000.0, "74 / 23"),
    };

    println!("=== {} ===", kind.id().to_uppercase());
    println!("  rng                    : {mode:?}");
    println!("  spins                  : {}", s.spins);
    println!("  bet                    : {bet} $LAZY");
    println!("  wall clock             : {:.1}s", elapsed.as_secs_f64());
    println!();
    println!("  RTP                    : {:.5}   (target 0.97000)", s.rtp());
    println!("  95% CI on RTP          : +/- {:.5}", s.rtp_ci95());
    println!("  hit frequency          : {:.4}    (target {target_hit:.2})", s.hit_frequency());
    println!("  volatility index       : {:.3}     (target {target_vol:.1}, ceiling 5.5)", s.volatility());
    println!("  max win observed       : {:.1}x    (design cap {target_max:.0}x)", s.max_win);
    println!(
        "  RTP split base/feature : {:.1} / {:.1}   (target {split})",
        100.0 * s.base_rtp(),
        100.0 * s.feature_rtp()
    );
    println!("  feature trigger freq   : {:.5}  (1 in {:.0})", s.feature_frequency(),
             if s.feature_frequency() > 0.0 { 1.0 / s.feature_frequency() } else { f64::INFINITY });
    println!("  longest losing streak  : {} (per-worker lower bound)", s.longest_losing_streak);
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

    if s.volatility() > 5.5 {
        println!("\n  WARNING: volatility index exceeds the 5.5 ceiling (spec Sec. 1).");
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
    for reel in 0..REELS {
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
    for reel in 0..REELS {
        let row: Vec<String> = strips.weights[reel].iter().map(|w| w.to_string()).collect();
        out.push_str(&format!("reel {}\n", row.join(" ")));
    }
    if let Some(parent) = std::path::Path::new(path).parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, out)
}

fn load_weights(path: &str) -> (StripSpec, f64, f64) {
    let body = match std::fs::read_to_string(path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("cannot read weights file {path}: {e}");
            std::process::exit(2);
        }
    };
    let mut weights = [[0u32; NUM_SYMBOLS]; REELS];
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
            if values.len() != NUM_SYMBOLS || reel >= REELS {
                eprintln!("malformed weights file {path}: bad reel row");
                std::process::exit(2);
            }
            weights[reel].copy_from_slice(&values);
            reel += 1;
        }
    }
    if reel != REELS {
        eprintln!("malformed weights file {path}: expected {REELS} reels, found {reel}");
        std::process::exit(2);
    }
    (StripSpec { weights }, coin_probability, pay_scale)
}
