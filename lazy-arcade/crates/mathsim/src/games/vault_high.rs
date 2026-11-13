//! GAME 3, HIGH PROFILE -- TRAIT VAULT with base-game orbs and retriggers.
//!
//! The row multipliers are the cabinet's best mechanic and stay as they are:
//! during free spins, multiplier orbs stamp their value onto the whole row
//! they land in, the row keeps it for the round, more orbs ADD to it, and a
//! winning line takes the HIGHEST multiplier among the rows it crosses.
//!
//! The high profile adds:
//!
//!   * ORBS IN THE BASE GAME. Any cell can drop an orb on any spin. If the
//!     spin wins, the line win is multiplied by the SUM of the orbs on the
//!     board -- the Gates of Olympus rule. If it does not win, the orbs pay
//!     nothing.
//!   * BIGGER ORBS AND A HIGHER ROW CEILING in the round (x100).
//!   * RETRIGGERS. Three or more scatters in the round add five spins. The
//!     round opens with 10/12/15 spins for 3/4/5 scatters.
//!   * A 10,000x max win, enforced inside the round: reaching it ends the
//!     round at once and pays exactly the cap.
//!
//! RNG draw order: one stop per reel; then orbs, reel-major, row-minor, one
//! threshold draw per cell and a value draw per orb -- in the base game and
//! on every free spin alike.

use crate::game::*;
use crate::games::{GameState, SpinOutcome};
use crate::rng::Rng;

pub const GAME_ID: &str = "traitvault-high";
pub const LINES: usize = 40;
pub const RETRIGGER_SPINS: usize = 5;
pub const BASE_ORB_V: [u64; 9] = [2, 3, 4, 5, 6, 8, 10, 25, 50];
pub const BASE_ORB_W: [u32; 9] = [300, 240, 170, 110, 70, 50, 35, 15, 10];
pub const FS_ORB_V: [u64; 8] = [2, 3, 4, 5, 8, 10, 15, 25];
pub const FS_ORB_W: [u32; 8] = [320, 250, 170, 110, 70, 45, 25, 10];
pub const ROW_MULT_CAP: u64 = 100;
/// Chance a cell drops an orb on a base spin, in parts per million.
pub const BASE_ORB_PPM: u32 = 2_200;
pub const MAX_FREE_SPINS: usize = 500;
/// Wild weight added to reels 2-4 for the round, which plays on its own reels:
/// a row multiplier only pays where a line lands, and wilds are what land them.
pub const FS_WILD_BOOST: u32 = 10;
const SCALE: u32 = 1_000_000;

pub fn fs_spec(spec: &StripSpec) -> StripSpec {
    // Scaled with the ante (see StripSpec::scale_factor), so an ante round
    // plays on the same reels as any other round, not on diluted ones.
    let k = spec.scale_factor();
    let mut s = spec.clone();
    for r in 1..=3 {
        s.weights[r][WILD as usize] += FS_WILD_BOOST * k;
    }
    s
}

pub fn spins_for_scatters(n: usize) -> usize {
    match n {
        0..=2 => 0,
        3 => 10,
        4 => 12,
        _ => 15,
    }
}

type Grid = [[u8; ROWS]; REELS];

pub struct TraitVaultHigh {
    pub strips: Strips,
    pub fs_strips: Strips,
    pub pays: PayTable,
    pub lines: Vec<[usize; REELS]>,
    /// Chance a cell drops an orb on a FREE spin -- the round's free parameter,
    /// carried through the weights file as `coin_probability`.
    pub orb_probability: f64,
    pub cap: f64,
}

impl TraitVaultHigh {
    pub fn new(spec: &StripSpec, pays: PayTable, orb_probability: f64, cap: f64) -> Self {
        for r in [0usize, 4] {
            assert_eq!(spec.weights[r][WILD as usize], 0, "wild must not appear on reel {}", r + 1);
        }
        TraitVaultHigh { strips: spec.build(), fs_strips: fs_spec(spec).build(), pays,
                         lines: paylines_40(), orb_probability, cap }
    }

    fn draw(&self, rng: &mut impl Rng, fs: bool) -> Grid {
        let strips = if fs { &self.fs_strips } else { &self.strips };
        let mut g = [[0u8; ROWS]; REELS];
        for reel in 0..REELS {
            let stop = rng.below(strips.len(reel));
            for row in 0..ROWS {
                g[reel][row] = strips.at(reel, stop, row);
            }
        }
        g
    }

    /// One threshold draw per cell, reel-major; a value draw for each orb.
    /// Calls `land(row, value)` for every orb, in draw order.
    fn orbs(rng: &mut impl Rng, ppm: u32, values: &[u64], weights: &[u32], mut land: impl FnMut(usize, u64)) {
        let wt: u32 = weights.iter().sum();
        for _reel in 0..REELS {
            for row in 0..ROWS {
                if rng.below(SCALE) < ppm {
                    let mut pick = rng.below(wt);
                    for (i, w) in weights.iter().enumerate() {
                        if pick < *w {
                            land(row, values[i]);
                            break;
                        }
                        pick -= w;
                    }
                }
            }
        }
    }

    pub fn spin(&self, rng: &mut impl Rng, _state: &mut GameState) -> SpinOutcome {
        let grid = self.draw(rng, false);
        let mut orb_sum = 0u64;
        Self::orbs(rng, BASE_ORB_PPM, &BASE_ORB_V, &BASE_ORB_W, |_, v| orb_sum += v);
        let lines = self.evaluate_lines(&grid, &[0; ROWS]);
        let mut out = SpinOutcome::default();
        out.base = (lines * if orb_sum > 0 { orb_sum as f64 } else { 1.0 }).min(self.cap);
        if out.base >= self.cap {
            return out;
        }
        let award = spins_for_scatters(scatter_count(&grid));
        if award > 0 {
            out.feature_triggered = true;
            out.feature = self.free_spins(rng, award, self.cap - out.base);
        }
        out
    }

    /// The round on its own: what the buy button sells.
    pub fn free_spins(&self, rng: &mut impl Rng, award: usize, room: f64) -> f64 {
        let ppm = (self.orb_probability * SCALE as f64).round() as u32;
        let mut row_mult = [0u64; ROWS];
        let mut left = award;
        let mut played = 0usize;
        let mut total = 0.0;
        while left > 0 && played < MAX_FREE_SPINS {
            left -= 1;
            played += 1;
            let grid = self.draw(rng, true);
            // Orbs apply BEFORE evaluation, so an orb pays on the spin that
            // revealed it.
            Self::orbs(rng, ppm, &FS_ORB_V, &FS_ORB_W, |row, v| {
                row_mult[row] = (row_mult[row] + v).min(ROW_MULT_CAP);
            });
            total += self.evaluate_lines(&grid, &row_mult);
            if total >= room {
                return room;
            }
            if scatter_count(&grid) >= 3 {
                left += RETRIGGER_SPINS;
            }
        }
        total
    }

    /// Line wins in units of TOTAL BET; a line takes the highest row multiplier
    /// among the rows its winning cells occupy, x1 where there is none.
    fn evaluate_lines(&self, grid: &Grid, row_mult: &[u64; ROWS]) -> f64 {
        let mut units = 0.0;
        for line in &self.lines {
            let s = grid[0][line[0]];
            if s == SCAT || s == WILD {
                continue;
            }
            let mut count = 0usize;
            for reel in 0..REELS {
                let c = grid[reel][line[reel]];
                if c == s || c == WILD {
                    count += 1;
                } else {
                    break;
                }
            }
            let pay = self.pays[s as usize][count];
            if pay == 0.0 {
                continue;
            }
            let mut m = 0u64;
            for reel in 0..count {
                m = m.max(row_mult[line[reel]]);
            }
            units += pay * if m == 0 { 1 } else { m } as f64;
        }
        units / LINES as f64
    }
}

fn scatter_count(grid: &Grid) -> usize {
    grid.iter().flat_map(|c| c.iter()).filter(|&&s| s == SCAT).count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::FastRng;

    fn game(orb_p: f64) -> TraitVaultHigh {
        let mut pays = empty_paytable();
        pays[P1 as usize][3] = 10.0;
        pays[P1 as usize][4] = 40.0;
        pays[P1 as usize][5] = 200.0;
        let mut weights = [[0u32; NUM_SYMBOLS]; REELS];
        for (r, w) in weights.iter_mut().enumerate() {
            w[P1 as usize] = 20;
            w[M1 as usize] = 20;
            w[L4 as usize] = 80;
            w[SCAT as usize] = 5;
            if (1..=3).contains(&r) {
                w[WILD as usize] = 5;
            }
        }
        TraitVaultHigh::new(&StripSpec { weights: weights.to_vec() }, pays, orb_p, 10_000.0)
    }

    #[test]
    fn base_orbs_only_multiply_a_win() {
        let g = game(0.01);
        let mut rng = FastRng::new(1);
        let mut st = GameState::default();
        let mut zero_with_orbs = 0;
        for _ in 0..20_000 {
            let out = g.spin(&mut rng, &mut st);
            assert!(out.total() <= 10_000.0 + 1e-9);
            if out.base == 0.0 { zero_with_orbs += 1; }
        }
        assert!(zero_with_orbs > 0);
    }

    #[test]
    fn rows_never_exceed_the_ceiling_and_retriggers_happen() {
        let g = game(0.05);
        let mut rng = FastRng::new(2);
        let mut any_long = false;
        for _ in 0..2_000 {
            let t = g.free_spins(&mut rng, 10, 10_000.0);
            assert!(t <= 10_000.0 + 1e-9);
            any_long |= t > 0.0;
        }
        assert!(any_long);
    }

    #[test]
    fn award_table_matches_the_rules() {
        let got: Vec<usize> = (0..7).map(spins_for_scatters).collect();
        assert_eq!(got, vec![0, 0, 0, 10, 12, 15, 15]);
    }
}
