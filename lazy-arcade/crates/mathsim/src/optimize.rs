//! Gradient-free search over strip weights until the RTP target is met
//! (spec Sec. 6.2, `mathsim optimize`).
//!
//! Hill climbing with common random numbers: every candidate is scored on the
//! SAME seed, so the difference between two candidates reflects the weights
//! rather than simulation noise. Without that, the search happily "improves"
//! by chasing sampling error.

use crate::game::*;
use crate::rng::{FastRng, Rng};
use crate::sim::{run, GameKind, RngMode, RunConfig, Stats};

pub struct Targets {
    pub rtp: f64,
    pub tolerance: f64,
    pub hit_frequency: f64,
    pub volatility: f64,
}

pub struct OptimizeConfig {
    pub kind: GameKind,
    pub targets: Targets,
    /// Spins per candidate evaluation. Small enough to search, large enough
    /// that the RTP estimate is not noise. The winner is re-verified at full
    /// scale afterwards -- the search never gets the last word.
    pub eval_spins: u64,
    pub iterations: usize,
    pub threads: usize,
    pub seed: u64,
}

pub struct OptimizeResult {
    pub strips: StripSpec,
    pub coin_probability: f64,
    pub pay_scale: f64,
    pub loss: f64,
    pub stats: Stats,
    pub iterations_run: usize,
    pub accepted: usize,
}

/// RTP dominates; hit frequency and volatility are soft pulls that only break
/// ties among candidates that already land near the RTP target.
fn loss(stats: &Stats, t: &Targets) -> f64 {
    let rtp_err = (stats.rtp() - t.rtp).abs();
    let hit_err = (stats.hit_frequency() - t.hit_frequency).abs();
    let vol_err = (stats.volatility() - t.volatility).abs();
    rtp_err * 1000.0 + hit_err * 2.0 + vol_err * 0.25
}

fn evaluate(
    cfg: &OptimizeConfig,
    strips: &StripSpec,
    coin_probability: f64,
    pay_scale: f64,
) -> Stats {
    run(&RunConfig {
        kind: cfg.kind,
        spins: cfg.eval_spins,
        seed: cfg.seed,
        threads: cfg.threads,
        // Search-only RNG. See rng::Rng -- no figure from here is quotable.
        rng_mode: RngMode::Fast,
        strips: strips.clone(),
        coin_probability,
        pay_scale,
    })
}

/// A weight change is legal only if it preserves the game's structural rules.
fn is_legal(kind: GameKind, strips: &StripSpec, reel: usize, symbol: usize) -> bool {
    if symbol == WILD as usize && kind.wild_forbidden_reels().contains(&reel) {
        return false;
    }
    let total: u32 = strips.weights[reel].iter().sum();
    if total < MIN_STRIP_LEN as u32 {
        return false;
    }
    // Every symbol that can pay must remain reachable on reel 1, or a whole
    // paytable row silently becomes dead.
    if strips.weights[reel][symbol] == 0 && symbol != WILD as usize {
        return false;
    }
    true
}

pub fn optimize(cfg: &OptimizeConfig) -> OptimizeResult {
    let mut best = cfg.kind.default_strips();
    let mut best_coin = crate::tables::VAULT_COIN_PROBABILITY;
    let mut best_scale = 1.0f64;
    let mut best_stats = evaluate(cfg, &best, best_coin, best_scale);
    let mut best_loss = loss(&best_stats, &cfg.targets);

    let mut rng = FastRng::new(cfg.seed ^ 0xC0FFEE);
    let mut accepted = 0usize;
    let mut iterations_run = 0usize;

    const DELTAS: [i32; 6] = [1, -1, 2, -2, 5, -5];

    for iteration in 0..cfg.iterations {
        iterations_run = iteration + 1;

        let mut candidate = best.clone();
        let mut candidate_coin = best_coin;
        let mut candidate_scale = best_scale;

        // Trait Vault's meter share is driven by the coin probability, not the
        // strips, so it needs its own move or the search cannot reach target.
        // Half of all moves adjust the pay scale. RTP is the dominant term in
        // the loss and scale is the axis that moves it most directly, so
        // starving this move makes the search crawl.
        let roll = rng.below(100);
        let tune_scale = roll < 50;
        let tune_coin = !tune_scale && cfg.kind == GameKind::TraitVault && roll < 70;

        if tune_scale {
            let step = 1.0 + (rng.below(2001) as f64 - 1000.0) / 8_000.0; // +/-12.5%
            candidate_scale = (best_scale * step).clamp(1e-4, 1e5);
        } else if tune_coin {
            let step = 1.0 + (rng.below(2001) as f64 - 1000.0) / 20_000.0; // +/-5%
            candidate_coin = (best_coin * step).clamp(0.0005, 0.5);
        } else {
            // Perturb one or two weights at a time. Two-weight moves let the
            // search trade one symbol against another without first passing
            // through a worse single-weight state.
            let moves = 1 + rng.below(2) as usize;
            for _ in 0..moves {
                let reel = rng.below(REELS as u32) as usize;
                let symbol = rng.below(NUM_SYMBOLS as u32) as usize;
                if !is_legal(cfg.kind, &candidate, reel, symbol) {
                    continue;
                }
                let delta = DELTAS[rng.below(DELTAS.len() as u32) as usize];
                let current = candidate.weights[reel][symbol] as i32;
                let next = (current + delta).max(if symbol == WILD as usize { 0 } else { 1 });
                candidate.weights[reel][symbol] = next as u32;
            }
            for reel in 0..REELS {
                let total: u32 = candidate.weights[reel].iter().sum();
                if total < MIN_STRIP_LEN as u32 {
                    // Restore the strip-length floor by padding the commonest low.
                    candidate.weights[reel][L4 as usize] += MIN_STRIP_LEN as u32 - total;
                }
            }
        }

        if candidate == best && candidate_coin == best_coin && candidate_scale == best_scale {
            continue;
        }

        let stats = evaluate(cfg, &candidate, candidate_coin, candidate_scale);
        let candidate_loss = loss(&stats, &cfg.targets);
        if candidate_loss < best_loss {
            best = candidate;
            best_coin = candidate_coin;
            best_scale = candidate_scale;
            best_loss = candidate_loss;
            best_stats = stats;
            accepted += 1;

            if (best_stats.rtp() - cfg.targets.rtp).abs() < cfg.targets.tolerance * 0.25 {
                // Comfortably inside tolerance on the search RNG. Stop here and
                // let full-scale verification decide -- more search would just
                // be fitting the evaluation seed.
                break;
            }
        }
    }

    OptimizeResult {
        strips: best,
        coin_probability: best_coin,
        pay_scale: best_scale,
        loss: best_loss,
        stats: best_stats,
        iterations_run,
        accepted,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn optimizer_moves_rtp_toward_the_target() {
        let cfg = OptimizeConfig {
            kind: GameKind::Pride,
            targets: Targets {
                rtp: 0.97,
                tolerance: 0.0005,
                hit_frequency: 0.38,
                volatility: 4.2,
            },
            eval_spins: 40_000,
            iterations: 120,
            threads: 4,
            seed: 2024,
        };
        let before = evaluate(&cfg, &GameKind::Pride.default_strips(), 0.0, 1.0);
        let result = optimize(&cfg);
        let before_err = (before.rtp() - 0.97).abs();
        let after_err = (result.stats.rtp() - 0.97).abs();
        assert!(
            after_err <= before_err,
            "optimizer made RTP worse: {before_err} -> {after_err}"
        );
    }

    #[test]
    fn optimizer_never_puts_a_wild_on_a_forbidden_reel() {
        let cfg = OptimizeConfig {
            kind: GameKind::Pride,
            targets: Targets { rtp: 0.97, tolerance: 0.0005, hit_frequency: 0.38, volatility: 4.2 },
            eval_spins: 20_000,
            iterations: 200,
            threads: 4,
            seed: 5,
        };
        let result = optimize(&cfg);
        for reel in GameKind::Pride.wild_forbidden_reels() {
            assert_eq!(result.strips.weights[*reel][WILD as usize], 0);
        }
    }

    #[test]
    fn optimizer_respects_the_minimum_strip_length() {
        let cfg = OptimizeConfig {
            kind: GameKind::CubCluster,
            targets: Targets { rtp: 0.97, tolerance: 0.0005, hit_frequency: 0.44, volatility: 5.4 },
            eval_spins: 20_000,
            iterations: 150,
            threads: 4,
            seed: 8,
        };
        let result = optimize(&cfg);
        for reel in 0..REELS {
            let total: u32 = result.strips.weights[reel].iter().sum();
            assert!(total >= MIN_STRIP_LEN as u32, "reel {reel} has {total} stops");
        }
    }
}
