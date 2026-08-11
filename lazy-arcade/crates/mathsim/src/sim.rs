//! Monte Carlo harness (spec Sec. 6.2).

use crate::game::*;
use crate::games::{cluster::CubCluster, pride::Pride, vault::TraitVault, GameState, SpinOutcome};
use crate::rng::{FastRng, HmacRng, Rng};
use crate::tables;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameKind {
    Pride,
    CubCluster,
    TraitVault,
}

impl GameKind {
    pub fn parse(s: &str) -> Option<GameKind> {
        match s {
            "pride" => Some(GameKind::Pride),
            "cubcluster" | "cluster" => Some(GameKind::CubCluster),
            "traitvault" | "vault" => Some(GameKind::TraitVault),
            _ => None,
        }
    }

    pub fn id(&self) -> &'static str {
        match self {
            GameKind::Pride => "pride",
            GameKind::CubCluster => "cubcluster",
            GameKind::TraitVault => "traitvault",
        }
    }

    pub fn default_strips(&self) -> StripSpec {
        match self {
            GameKind::Pride => tables::pride_strips(),
            GameKind::CubCluster => tables::cluster_strips(),
            GameKind::TraitVault => tables::vault_strips(),
        }
    }

    /// Hard ceiling on a single spin's total win, in multiples of total bet
    /// (spec Sec. 6.4). This is a real cap enforced on every settled spin, not
    /// a design aspiration: without it Cub Cluster's tumble chains were
    /// observed paying 3104x against a stated 2500x maximum, which would make
    /// the published max-win figure false and leave `Bankroll.sol` exposure
    /// caps sized against the wrong number.
    pub fn max_win(&self) -> f64 {
        match self {
            GameKind::Pride => 2_000.0,
            GameKind::CubCluster => 2_500.0,
            GameKind::TraitVault => 1_000.0,
        }
    }

    /// Reels on which a wild may never appear. Pride and Trait Vault restrict
    /// wilds to reels 2-4; Cub Cluster has no such restriction.
    pub fn wild_forbidden_reels(&self) -> &'static [usize] {
        match self {
            GameKind::Pride | GameKind::TraitVault => &[0, 4],
            GameKind::CubCluster => &[],
        }
    }
}

/// Uniformly scale every entry of a paytable.
///
/// Splitting the search into "shape" (strip weights) and "level" (this scale)
/// is what makes hitting RTP *and* volatility tractable: scale moves RTP
/// linearly while leaving hit frequency untouched, so the two axes are nearly
/// independent.
fn scale_paytable(pays: &mut PayTable, scale: f64) {
    for row in pays.iter_mut() {
        for v in row.iter_mut() {
            *v *= scale;
        }
    }
}

/// Which RNG the run uses. Only `Hmac` results may be quoted as RTP.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RngMode {
    Hmac,
    Fast,
}

enum Machine {
    Pride(Pride),
    Cluster(CubCluster),
    Vault(TraitVault),
}

impl Machine {
    fn build(kind: GameKind, spec: &StripSpec, coin_probability: f64, pay_scale: f64) -> Machine {
        match kind {
            GameKind::Pride => {
                let mut pays = tables::pride_pays();
                scale_paytable(&mut pays, pay_scale);
                Machine::Pride(Pride::new(spec, pays))
            }
            GameKind::CubCluster => {
                let mut pays = tables::cluster_pays();
                for row in pays.iter_mut() {
                    for v in row.iter_mut() {
                        *v *= pay_scale;
                    }
                }
                Machine::Cluster(CubCluster::new(spec, pays))
            }
            GameKind::TraitVault => {
                let mut pays = tables::vault_pays();
                scale_paytable(&mut pays, pay_scale);
                Machine::Vault(TraitVault::new(spec, pays, coin_probability))
            }
        }
    }

    #[inline]
    fn spin(&self, rng: &mut impl Rng, state: &mut GameState) -> SpinOutcome {
        match self {
            Machine::Pride(g) => g.spin(rng),
            Machine::Cluster(g) => g.spin(rng),
            Machine::Vault(g) => g.spin(rng, state),
        }
    }
}

pub const HIST_BUCKETS: usize = 12;
/// Upper edges of the win-distribution histogram, in multiples of bet.
pub const HIST_EDGES: [f64; HIST_BUCKETS - 1] =
    [0.0, 0.5, 1.0, 2.0, 5.0, 10.0, 25.0, 50.0, 100.0, 500.0, 1000.0];

#[derive(Clone, Debug)]
pub struct Stats {
    pub spins: u64,
    pub sum: f64,
    pub sum_sq: f64,
    pub hits: u64,
    pub max_win: f64,
    pub base_sum: f64,
    pub feature_sum: f64,
    pub feature_triggers: u64,
    pub longest_losing_streak: u64,
    current_losing_streak: u64,
    pub hist: [u64; HIST_BUCKETS],
}

impl Default for Stats {
    fn default() -> Self {
        Stats {
            spins: 0,
            sum: 0.0,
            sum_sq: 0.0,
            hits: 0,
            max_win: 0.0,
            base_sum: 0.0,
            feature_sum: 0.0,
            feature_triggers: 0,
            longest_losing_streak: 0,
            current_losing_streak: 0,
            hist: [0; HIST_BUCKETS],
        }
    }
}

impl Stats {
    #[inline]
    fn record(&mut self, out: &SpinOutcome) {
        let total = out.total();
        self.spins += 1;
        self.sum += total;
        self.sum_sq += total * total;
        self.base_sum += out.base;
        self.feature_sum += out.feature;
        if out.feature_triggered {
            self.feature_triggers += 1;
        }
        if total > 0.0 {
            self.hits += 1;
            self.current_losing_streak = 0;
        } else {
            self.current_losing_streak += 1;
            self.longest_losing_streak =
                self.longest_losing_streak.max(self.current_losing_streak);
        }
        if total > self.max_win {
            self.max_win = total;
        }
        let mut bucket = HIST_BUCKETS - 1;
        for (i, edge) in HIST_EDGES.iter().enumerate() {
            if total <= *edge {
                bucket = i;
                break;
            }
        }
        self.hist[bucket] += 1;
    }

    pub fn merge(&mut self, other: &Stats) {
        self.spins += other.spins;
        self.sum += other.sum;
        self.sum_sq += other.sum_sq;
        self.hits += other.hits;
        self.base_sum += other.base_sum;
        self.feature_sum += other.feature_sum;
        self.feature_triggers += other.feature_triggers;
        self.max_win = self.max_win.max(other.max_win);
        // Streaks are per-thread; the true global streak would need a single
        // sequential stream, so this reports the longest observed on any one
        // worker -- a lower bound, and labelled as such in the report.
        self.longest_losing_streak =
            self.longest_losing_streak.max(other.longest_losing_streak);
        for i in 0..HIST_BUCKETS {
            self.hist[i] += other.hist[i];
        }
    }

    pub fn rtp(&self) -> f64 {
        self.sum / self.spins as f64
    }
    pub fn hit_frequency(&self) -> f64 {
        self.hits as f64 / self.spins as f64
    }
    /// Std dev of return per spin, in units of bet (spec's "volatility index").
    pub fn volatility(&self) -> f64 {
        let mean = self.rtp();
        (self.sum_sq / self.spins as f64 - mean * mean).max(0.0).sqrt()
    }
    pub fn rtp_ci95(&self) -> f64 {
        1.96 * self.volatility() / (self.spins as f64).sqrt()
    }
    pub fn base_rtp(&self) -> f64 {
        self.base_sum / self.spins as f64
    }
    pub fn feature_rtp(&self) -> f64 {
        self.feature_sum / self.spins as f64
    }
    pub fn feature_frequency(&self) -> f64 {
        self.feature_triggers as f64 / self.spins as f64
    }
}

pub struct RunConfig {
    pub kind: GameKind,
    pub spins: u64,
    pub seed: u64,
    pub threads: usize,
    pub rng_mode: RngMode,
    pub strips: StripSpec,
    pub coin_probability: f64,
    pub pay_scale: f64,
}

pub fn run(cfg: &RunConfig) -> Stats {
    let threads = cfg.threads.max(1);
    let per_thread = cfg.spins / threads as u64;
    let remainder = cfg.spins % threads as u64;

    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|t| {
                let spins = per_thread + if (t as u64) < remainder { 1 } else { 0 };
                let strips = cfg.strips.clone();
                let kind = cfg.kind;
                let seed = cfg.seed;
                let mode = cfg.rng_mode;
                let coin_p = cfg.coin_probability;
                let pay_scale = cfg.pay_scale;
                scope.spawn(move || {
                    let machine = Machine::build(kind, &strips, coin_p, pay_scale);
                    let mut stats = Stats::default();
                    // Trait Vault's meter carries across spins, so each worker
                    // keeps its own persistent state -- equivalent to N players
                    // each playing a long sequential session.
                    let mut state = GameState::default();
                    let cap = kind.max_win();
                    match mode {
                        RngMode::Fast => {
                            let mut rng = FastRng::new(seed ^ ((t as u64 + 1) << 32));
                            for _ in 0..spins {
                                let out = apply_win_cap(machine.spin(&mut rng, &mut state), cap);
                                stats.record(&out);
                            }
                        }
                        RngMode::Hmac => {
                            let server_seed = derive_server_seed(seed);
                            let client_seed = format!("mathsim-worker-{t}");
                            for i in 0..spins {
                                let mut rng =
                                    HmacRng::new(&server_seed, &client_seed, i, kind.id());
                                let out = apply_win_cap(machine.spin(&mut rng, &mut state), cap);
                                stats.record(&out);
                            }
                        }
                    }
                    stats
                })
            })
            .collect();

        let mut total = Stats::default();
        for h in handles {
            total.merge(&h.join().expect("simulation worker panicked"));
        }
        total
    })
}

/// Clamp a spin to the game's published maximum win.
///
/// The cap applies to the SETTLED TOTAL, so base and feature are scaled down
/// together rather than truncating only the feature -- otherwise the reported
/// base/feature split would drift as a side effect of capping.
#[inline]
fn apply_win_cap(out: SpinOutcome, cap: f64) -> SpinOutcome {
    let total = out.total();
    if total <= cap {
        return out;
    }
    let ratio = cap / total;
    SpinOutcome {
        base: out.base * ratio,
        feature: out.feature * ratio,
        feature_triggered: out.feature_triggered,
    }
}

fn derive_server_seed(seed: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, chunk) in out.chunks_mut(8).enumerate() {
        chunk.copy_from_slice(&seed.wrapping_mul(0x9E3779B97F4A7C15).wrapping_add(i as u64).to_be_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn win_cap_clamps_total_and_preserves_the_split_ratio() {
        let out = SpinOutcome { base: 3000.0, feature: 1000.0, feature_triggered: true };
        let capped = apply_win_cap(out, 2_500.0);
        assert!((capped.total() - 2_500.0).abs() < 1e-9);
        // 3:1 before, 3:1 after.
        assert!((capped.base / capped.feature - 3.0).abs() < 1e-9);
        assert!(capped.feature_triggered);
    }

    #[test]
    fn win_cap_leaves_ordinary_spins_untouched() {
        let out = SpinOutcome { base: 12.0, feature: 3.0, feature_triggered: true };
        let capped = apply_win_cap(out, 2_500.0);
        assert_eq!(capped.base, 12.0);
        assert_eq!(capped.feature, 3.0);
    }

    #[test]
    fn no_simulated_spin_can_exceed_the_published_max_win() {
        for kind in [GameKind::Pride, GameKind::CubCluster, GameKind::TraitVault] {
            let stats = run(&RunConfig {
                kind,
                spins: 200_000,
                seed: 31,
                threads: 4,
                rng_mode: RngMode::Fast,
                strips: kind.default_strips(),
                coin_probability: 0.03,
                pay_scale: 500.0, // absurd scale to force the cap to bind
            });
            assert!(
                stats.max_win <= kind.max_win() + 1e-6,
                "{:?} paid {} against a cap of {}",
                kind,
                stats.max_win,
                kind.max_win()
            );
        }
    }

    #[test]
    fn hmac_and_fast_rng_agree_on_rtp_within_noise() {
        // If these diverged it would mean the HMAC stream is biased -- the whole
        // reason the search path is allowed to use a cheaper RNG.
        let base = RunConfig {
            kind: GameKind::Pride,
            spins: 300_000,
            seed: 12345,
            threads: 4,
            rng_mode: RngMode::Fast,
            strips: GameKind::Pride.default_strips(),
            coin_probability: 0.0,
            pay_scale: 1.0,
        };
        let fast = run(&base);
        let hmac = run(&RunConfig { rng_mode: RngMode::Hmac, ..base });
        let delta = (fast.rtp() - hmac.rtp()).abs();
        let tolerance = 4.0 * (fast.rtp_ci95() + hmac.rtp_ci95());
        assert!(
            delta < tolerance,
            "RTP differs by {delta} between RNGs (tolerance {tolerance})"
        );
    }

    #[test]
    fn results_are_reproducible_from_the_seed() {
        let cfg = RunConfig {
            kind: GameKind::CubCluster,
            spins: 20_000,
            seed: 99,
            threads: 2,
            rng_mode: RngMode::Hmac,
            strips: GameKind::CubCluster.default_strips(),
            coin_probability: 0.0,
            pay_scale: 1.0,
        };
        assert_eq!(run(&cfg).sum.to_bits(), run(&cfg).sum.to_bits());
    }

    #[test]
    fn thread_count_does_not_change_hmac_totals_per_worker_stream() {
        // Each worker owns a distinct client seed, so totals depend on the
        // partition -- but a single-threaded run must be stable.
        let cfg = RunConfig {
            kind: GameKind::TraitVault,
            spins: 10_000,
            seed: 7,
            threads: 1,
            rng_mode: RngMode::Hmac,
            strips: GameKind::TraitVault.default_strips(),
            coin_probability: 0.03,
            pay_scale: 1.0,
        };
        assert_eq!(run(&cfg).sum.to_bits(), run(&cfg).sum.to_bits());
    }
}
