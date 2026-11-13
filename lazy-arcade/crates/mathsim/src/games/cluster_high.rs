//! GAME 2, HIGH PROFILE -- CUB CLUSTER on a 7x7 grid with multiplier spots.
//!
//! The low-profile Cub Cluster plays on 5x4, and that grid cannot carry its own
//! mechanic: a 5-cell orthogonal cluster on twenty cells hits 10.4% of spins
//! against a 44% target, and PHASE-0-1-FINDINGS records that no weight search
//! can fix geometry. Forty-nine cells can. Six paying symbols on a 7x7 board
//! carry a 5+ cluster on roughly a third of boards before any weighting.
//!
//! Rules, in the order the round applies them:
//!
//!   * Seven reels, seven rows, and EVERY CELL its own draw from its reel's
//!     strip. A strip window would not do: `build_strip` spreads each symbol
//!     as evenly as its count allows, so in a 7-row window two vertically
//!     adjacent cells almost never match, clusters can only grow sideways, and
//!     the hit rate measured 12% against the ~36% the geometry supports.
//!   * A cluster is 5+ orthogonally adjacent identical symbols. There is no
//!     wild in this profile -- the board needs none, and the WILD art is still
//!     blocked by the licensing gate. The $LAZY scatter never clusters.
//!   * Every winning cluster pays at once. Then every cell that exploded
//!     updates its SPOT: the first explosion on a cell marks it, the second
//!     puts x2 on it, and each one after doubles it, to a ceiling of x128.
//!     A cluster's pay is multiplied by the SUM of the spot multipliers under
//!     it, read BEFORE that explosion updates them.
//!   * Winners clear, survivors fall, and each reel refills from the top with
//!     fresh symbols drawn from its own strip. Repeat until nothing wins.
//!   * Base game: spots clear when the tumble sequence ends. Scatters on the
//!     final board award free spins: 3/4/5/6/7+ give 10/12/15/20/30.
//!   * Free spins: spots PERSIST for the whole round, and the same scatter
//!     counts retrigger.
//!   * The published max win is enforced inside the round: the moment the
//!     running total reaches it, the round ends and pays exactly the cap.
//!
//! The RNG draw order is part of the rules: one draw per cell, reel-major,
//! top row first; then, per tumble, refills reel by reel, top cell first. The page's port
//! and the standalone verifier replay exactly this sequence.

use crate::game::*;
use crate::games::SpinOutcome;
use crate::rng::Rng;

pub const GAME_ID: &str = "cubcluster-high";
pub const C7_REELS: usize = 7;
pub const C7_ROWS: usize = 7;
pub const C7_CELLS: usize = C7_REELS * C7_ROWS;
pub const MIN_CLUSTER: usize = 5;
/// Cluster sizes at and above this pay as this size, as the reference does.
pub const PAY_SIZE_CAP: usize = 15;
pub const SPOT_CAP: u32 = 128;
/// A guard, not a mechanic: no round may run longer than this many free
/// spins. Retriggers are rare enough that it never binds in measurement; it
/// exists so a pathological seed cannot loop forever.
pub const MAX_FREE_SPINS: usize = 500;
/// Free spins open with every cell already MARKED, so a cell's first explosion
/// in the round puts x2 on it. Without this the round spent its first several
/// spins just marking the board and carried 12% of the return against a third.
pub const FS_START_MARKED: bool = false;
/// The round plays on its own reels: the base reels with the commonest low
/// removed. Five symbols on 49 cells cluster far more often than six, so the
/// spots actually build over a round instead of resetting to a near-empty board.
pub const FS_DROP: u8 = 11; // L2

pub fn fs_spec(spec: &StripSpec) -> StripSpec {
    let mut s = spec.clone();
    for w in s.weights.iter_mut() {
        w[FS_DROP as usize] = 0;
    }
    s
}

/// Free spins awarded (or added, in the round) by scatter count.
pub fn spins_for_scatters(n: usize) -> usize {
    match n {
        0..=2 => 0,
        3 => 10,
        4 => 12,
        5 => 15,
        6 => 20,
        _ => 30,
    }
}

/// `pays[symbol][size]` for size 5..=PAY_SIZE_CAP, in units of TOTAL BET.
pub type ClusterPaysHigh = [[f64; PAY_SIZE_CAP + 1]; NUM_SYMBOLS];

pub fn empty_pays() -> ClusterPaysHigh {
    [[0.0; PAY_SIZE_CAP + 1]; NUM_SYMBOLS]
}

pub type Grid7 = [[u8; C7_ROWS]; C7_REELS];
/// Spot state per cell: 0 untouched, 1 marked, >=2 the multiplier on it.
pub type Spots = [[u32; C7_ROWS]; C7_REELS];

pub struct CubClusterHigh {
    pub strips: Strips,
    pub fs_strips: Strips,
    pub pays: ClusterPaysHigh,
    pub cap: f64,
}

/// What one tumble sequence did.
pub struct Sequence {
    pub win: f64,
    pub scatters: usize,
    pub capped: bool,
}

impl CubClusterHigh {
    pub fn new(spec: &StripSpec, pays: ClusterPaysHigh, cap: f64) -> Self {
        assert_eq!(spec.weights.len(), C7_REELS, "Cub Cluster high profile needs 7 reels");
        for (r, w) in spec.weights.iter().enumerate() {
            assert_eq!(w[WILD as usize], 0, "no wild in the high profile (reel {})", r + 1);
        }
        CubClusterHigh { strips: spec.build(), fs_strips: fs_spec(spec).build(), pays, cap }
    }

    pub fn draw(&self, rng: &mut impl Rng, fs: bool) -> Grid7 {
        let strips = if fs { &self.fs_strips } else { &self.strips };
        let mut g = [[0u8; C7_ROWS]; C7_REELS];
        for reel in 0..C7_REELS {
            let strip = &strips.reels[reel];
            for row in 0..C7_ROWS {
                g[reel][row] = strip[rng.below(strip.len() as u32) as usize];
            }
        }
        g
    }

    pub fn spin(&self, rng: &mut impl Rng) -> SpinOutcome {
        let mut out = SpinOutcome::default();
        let mut grid = self.draw(rng, false);
        let mut spots: Spots = [[0; C7_ROWS]; C7_REELS];
        let seq = self.sequence(&mut grid, &mut spots, rng, self.cap, false);
        out.base = seq.win;
        if seq.capped {
            return out;
        }
        let award = spins_for_scatters(seq.scatters);
        if award > 0 {
            out.feature_triggered = true;
            out.feature = self.free_spins(rng, award, self.cap - out.base);
        }
        out
    }

    /// The round on its own, so a buy price is the round actually bought.
    /// `room` is how much of the max win is left to pay.
    pub fn free_spins(&self, rng: &mut impl Rng, award: usize, room: f64) -> f64 {
        let mut spots: Spots = [[if FS_START_MARKED { 1 } else { 0 }; C7_ROWS]; C7_REELS];
        let mut left = award;
        let mut played = 0usize;
        let mut total = 0.0;
        while left > 0 && played < MAX_FREE_SPINS {
            left -= 1;
            played += 1;
            let mut grid = self.draw(rng, true);
            let seq = self.sequence(&mut grid, &mut spots, rng, room - total, true);
            total += seq.win;
            if seq.capped {
                return room;
            }
            left += spins_for_scatters(seq.scatters);
        }
        total
    }

    /// Evaluate, explode, update spots, fall, refill -- until nothing wins or
    /// the remaining room is used up.
    pub fn sequence(&self, grid: &mut Grid7, spots: &mut Spots, rng: &mut impl Rng, room: f64, fs: bool) -> Sequence {
        let mut win = 0.0;
        loop {
            let mut remove = [[false; C7_ROWS]; C7_REELS];
            let paid = self.evaluate(grid, spots, &mut remove);
            if paid == 0.0 {
                break;
            }
            if win + paid >= room {
                return Sequence { win: room, scatters: count_scatters(grid), capped: true };
            }
            win += paid;
            for reel in 0..C7_REELS {
                for row in 0..C7_ROWS {
                    if remove[reel][row] {
                        spots[reel][row] = match spots[reel][row] {
                            0 => 1,
                            1 => 2,
                            v => (v * 2).min(SPOT_CAP),
                        };
                    }
                }
            }
            self.tumble(grid, &remove, rng, fs);
        }
        Sequence { win, scatters: count_scatters(grid), capped: false }
    }

    /// Pay every winning cluster on the board and mark its cells for removal.
    pub fn evaluate(&self, grid: &Grid7, spots: &Spots, remove: &mut [[bool; C7_ROWS]; C7_REELS]) -> f64 {
        let mut total = 0.0;
        let mut seen = [[false; C7_ROWS]; C7_REELS];
        for reel in 0..C7_REELS {
            for row in 0..C7_ROWS {
                let s = grid[reel][row];
                if seen[reel][row] || s == SCAT || s == WILD {
                    continue;
                }
                let mut stack = vec![(reel, row)];
                let mut comp: Vec<(usize, usize)> = Vec::new();
                seen[reel][row] = true;
                while let Some((c, r)) = stack.pop() {
                    comp.push((c, r));
                    let nbrs = [
                        (c.wrapping_sub(1), r),
                        (c + 1, r),
                        (c, r.wrapping_sub(1)),
                        (c, r + 1),
                    ];
                    for (nc, nr) in nbrs {
                        if nc < C7_REELS && nr < C7_ROWS && !seen[nc][nr] && grid[nc][nr] == s {
                            seen[nc][nr] = true;
                            stack.push((nc, nr));
                        }
                    }
                }
                if comp.len() < MIN_CLUSTER {
                    continue;
                }
                let pay = self.pays[s as usize][comp.len().min(PAY_SIZE_CAP)];
                if pay == 0.0 {
                    continue;
                }
                let mut mult = 0u32;
                for &(c, r) in &comp {
                    if spots[c][r] >= 2 {
                        mult += spots[c][r];
                    }
                }
                total += pay * if mult == 0 { 1.0 } else { mult as f64 };
                for &(c, r) in &comp {
                    remove[c][r] = true;
                }
            }
        }
        total
    }

    /// Clear marked cells, let survivors fall, refill each reel from the top.
    pub fn tumble(&self, grid: &mut Grid7, remove: &[[bool; C7_ROWS]; C7_REELS], rng: &mut impl Rng, fs: bool) {
        let strips = if fs { &self.fs_strips } else { &self.strips };
        for reel in 0..C7_REELS {
            let keep: Vec<u8> = (0..C7_ROWS).filter(|&r| !remove[reel][r]).map(|r| grid[reel][r]).collect();
            let need = C7_ROWS - keep.len();
            if need == 0 {
                continue;
            }
            let strip = &strips.reels[reel];
            let mut col: Vec<u8> = (0..need).map(|_| strip[rng.below(strip.len() as u32) as usize]).collect();
            col.extend(keep);
            for (row, sym) in col.into_iter().enumerate() {
                grid[reel][row] = sym;
            }
        }
    }
}

pub fn count_scatters(grid: &Grid7) -> usize {
    grid.iter().flat_map(|c| c.iter()).filter(|&&s| s == SCAT).count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::FastRng;

    const L1: u8 = 10;
    const L2: u8 = 11;

    fn game() -> CubClusterHigh {
        let mut pays = empty_pays();
        for size in MIN_CLUSTER..=PAY_SIZE_CAP {
            pays[P1 as usize][size] = 1.0;
            pays[L1 as usize][size] = 0.1;
        }
        let mut w = [0u32; NUM_SYMBOLS];
        // Big enough that the round's reels, which drop L2, still clear the
        // 120-symbol strip minimum.
        w[P1 as usize] = 60;
        w[L1 as usize] = 70;
        w[L2 as usize] = 50;
        w[SCAT as usize] = 3;
        CubClusterHigh::new(&StripSpec { weights: vec![w; C7_REELS] }, pays, 5_000.0)
    }

    fn checker() -> Grid7 {
        // No two orthogonal neighbours share a symbol: nothing can cluster.
        let mut g = [[L1; C7_ROWS]; C7_REELS];
        for c in 0..C7_REELS {
            for r in 0..C7_ROWS {
                g[c][r] = if (c + r) % 2 == 0 { L1 } else { L2 };
            }
        }
        g
    }

    #[test]
    fn four_cells_do_not_pay_five_do() {
        let g0 = game();
        let mut g = checker();
        for c in 0..4 {
            g[c][0] = P1;
        }
        let spots = [[0; C7_ROWS]; C7_REELS];
        let mut rm = [[false; C7_ROWS]; C7_REELS];
        assert_eq!(g0.evaluate(&g, &spots, &mut rm), 0.0);
        g[4][0] = P1;
        let mut rm = [[false; C7_ROWS]; C7_REELS];
        assert_eq!(g0.evaluate(&g, &spots, &mut rm), 1.0);
        assert!(rm[4][0] && !rm[5][0]);
    }

    #[test]
    fn spot_multipliers_add_under_one_cluster() {
        let g0 = game();
        let mut g = checker();
        for c in 0..5 {
            g[c][0] = P1;
        }
        let mut spots = [[0; C7_ROWS]; C7_REELS];
        spots[0][0] = 4;
        spots[3][0] = 8;
        spots[4][0] = 1; // marked, carries no multiplier yet
        let mut rm = [[false; C7_ROWS]; C7_REELS];
        assert_eq!(g0.evaluate(&g, &spots, &mut rm), 12.0, "x4 + x8 = x12");
    }

    #[test]
    fn spots_mark_then_double_to_the_cap() {
        let mut v = 0u32;
        let mut seen = vec![];
        for _ in 0..10 {
            v = match v { 0 => 1, 1 => 2, x => (x * 2).min(SPOT_CAP) };
            seen.push(v);
        }
        assert_eq!(seen, vec![1, 2, 4, 8, 16, 32, 64, 128, 128, 128]);
    }

    #[test]
    fn scatters_never_cluster() {
        let g0 = game();
        let mut g = checker();
        for c in 0..6 {
            g[c][3] = SCAT;
        }
        let spots = [[0; C7_ROWS]; C7_REELS];
        let mut rm = [[false; C7_ROWS]; C7_REELS];
        assert_eq!(g0.evaluate(&g, &spots, &mut rm), 0.0);
    }

    #[test]
    fn award_table_matches_the_rules() {
        let got: Vec<usize> = (0..9).map(spins_for_scatters).collect();
        assert_eq!(got, vec![0, 0, 0, 10, 12, 15, 20, 30, 30]);
    }

    #[test]
    fn the_cap_ends_the_round_at_exactly_the_cap() {
        let mut pays = empty_pays();
        for size in MIN_CLUSTER..=PAY_SIZE_CAP {
            pays[P1 as usize][size] = 4_000.0;
        }
        let mut w = [0u32; NUM_SYMBOLS];
        w[P1 as usize] = 100;
        w[L1 as usize] = 20;
        let g0 = CubClusterHigh::new(&StripSpec { weights: vec![w; C7_REELS] }, pays, 5_000.0);
        let mut rng = FastRng::new(3);
        let mut worst: f64 = 0.0;
        for _ in 0..2_000 {
            worst = worst.max(g0.spin(&mut rng).total());
        }
        assert!(worst <= 5_000.0 + 1e-9, "paid {worst}");
        assert!((worst - 5_000.0).abs() < 1e-9, "the cap never bound: {worst}");
    }

    #[test]
    fn a_spin_always_terminates_and_conserves_the_grid() {
        let g0 = game();
        let mut rng = FastRng::new(11);
        for _ in 0..5_000 {
            let _ = g0.spin(&mut rng);
        }
        let mut grid = g0.draw(&mut rng, false);
        let mut spots = [[0; C7_ROWS]; C7_REELS];
        let _ = g0.sequence(&mut grid, &mut spots, &mut rng, 1e12, false);
        for c in 0..C7_REELS {
            for r in 0..C7_ROWS {
                assert!(grid[c][r] < NUM_SYMBOLS as u8);
            }
        }
    }
}
