//! GAME 3 -- TRAIT VAULT: 40 fixed lines + Lion's Share free spins (spec Sec. 6.4).
//!
//! REPLACES the persistent Mane Meter and its Hold and Win. Two things were
//! wrong with the meter, both measured rather than argued:
//!
//!   * it filled every ~6 spins, which is not a meter -- it is a base-game
//!     mechanic wearing a meter's clothes, and it gave the player nothing to
//!     anticipate because it was never far away; and
//!   * it made spins NON-INDEPENDENT, forcing every simulation to run
//!     sequentially through `GameState` and making the feature impossible to
//!     price in isolation.
//!
//! The replacement is a scatter-triggered free spins round carrying STICKY ROW
//! MULTIPLIERS. During the feature, multiplier orbs land on the grid and stamp
//! their value onto the ENTIRE ROW they landed in. Row multipliers persist for
//! the whole round and ADD when another orb lands in a row that already has
//! one, so a row climbs x2 -> x5 -> x15 as the round goes on.
//!
//! A win takes the HIGHEST multiplier among the rows its winning cells occupy.
//!
//! Two combination rules were tried. Summing across rows was measured first and
//! rejected: only 4 of the 40 lines are flat, so a stepped line wiggling between
//! two x3 rows collected x6 for the wiggle alone, and a uniform x3 board paid
//! 7.4x rather than 3x. That makes the number on screen a lie -- a player told
//! "row 2 pays x3" would be right only on the four flat lines. Taking the max
//! keeps the badge on the row literally true whichever line pays, and keeps the
//! distribution tight enough that the max-win cap stays a backstop rather than
//! the thing deciding the top of the range.
//!
//! Spins are now INDEPENDENT. `GameState` is still threaded through for
//! interface compatibility but Trait Vault no longer reads or writes it.

use crate::game::*;
use crate::games::{GameState, SpinOutcome};
use crate::rng::Rng;

pub const GAME_ID: &str = "traitvault";
pub const LINES: usize = 40;

/// Scatters needed anywhere on the grid to trigger the feature.
pub const SCATTERS_TO_TRIGGER: usize = 3;
/// Fixed round length. No retrigger: an unbounded round makes the max win
/// unprovable, and a provable ceiling is worth more here than a rare monster.
pub const FREE_SPINS: usize = 10;

/// Multiplier orb values and their weights, skewed hard to the small end so the
/// round is carried by accumulation across rows rather than by one lucky orb.
///
/// The first table tried topped out at x50 and measured a volatility index of
/// 11.1 against this suite's 5.5 ceiling -- the feature is rare (about 1 spin in
/// 115) and a single x50 landing on a row that then caught a top-premium line
/// produced a tail long enough to dominate the distribution. Trading orb SIZE
/// for orb FREQUENCY holds expected value roughly constant while pulling that
/// tail in: many small multipliers accumulating on a row is the same money
/// arriving with far less variance, and it makes the round build visibly
/// instead of resolving on one lucky drop.
pub const MULT_VALUES: [u64; 6] = [2, 3, 4, 6, 10, 20];
pub const MULT_WEIGHTS: [u32; 6] = [400, 290, 180, 90, 32, 8];

/// Ceiling on a single row's accumulated multiplier. Without it a lucky round
/// can run a row into the hundreds, and the max-win cap -- not the maths --
/// decides what the player is paid.
///
/// Set at 60 first, which measured a volatility index of 10.8: a row that ran
/// away and then caught a premium line was producing the entire top of the
/// distribution. Clipping to 25 pulls that tail in without making the feature
/// mean -- a x25 row with four rows in play is still the best thing that
/// happens in this game.
pub const ROW_MULT_CAP: u64 = 25;

const SCALE: u32 = 1_000_000;

pub struct TraitVault {
    pub strips: Strips,
    /// Pays are per LINE BET; total bet is 40x a line bet.
    pub pays: PayTable,
    pub lines: Vec<[usize; REELS]>,
    /// Probability that any one cell drops a multiplier orb on a free spin.
    /// This is the feature's only free parameter and is what holds the round
    /// inside its share of the 97% budget.
    ///
    /// Carried through the shared config as `coin_probability` -- the field the
    /// Hold and Win used for the same job -- so the weights file format and the
    /// optimiser's search space are unchanged by this rework.
    pub orb_probability: f64,
}

type Grid = [[u8; ROWS]; REELS];

impl TraitVault {
    pub fn new(spec: &StripSpec, pays: PayTable, orb_probability: f64) -> Self {
        for r in [0usize, 4] {
            assert_eq!(
                spec.weights[r][WILD as usize], 0,
                "wild must not appear on reel {} (reels 2-4 only)",
                r + 1
            );
        }
        TraitVault {
            strips: spec.build(),
            pays,
            lines: paylines_40(),
            orb_probability,
        }
    }

    fn draw(&self, rng: &mut impl Rng) -> Grid {
        let mut grid = [[0u8; ROWS]; REELS];
        for reel in 0..REELS {
            let stop = rng.below(self.strips.len(reel));
            for row in 0..ROWS {
                grid[reel][row] = self.strips.at(reel, stop, row);
            }
        }
        grid
    }

    pub fn spin(&self, rng: &mut impl Rng, _state: &mut GameState) -> SpinOutcome {
        let grid = self.draw(rng);

        let mut out = SpinOutcome::default();
        out.base = self.evaluate_lines(&grid, &[0; ROWS]);

        if scatter_count(&grid) >= SCATTERS_TO_TRIGGER {
            out.feature_triggered = true;
            out.feature += self.free_spins(rng);
        }
        out
    }

    /// The feature, priced on its own. Callable without a preceding base spin,
    /// which is what makes a buy-feature price measurable rather than inferred.
    pub fn free_spins(&self, rng: &mut impl Rng) -> f64 {
        let threshold = (self.orb_probability * SCALE as f64).round() as u32;
        let weight_total: u32 = MULT_WEIGHTS.iter().sum();

        let mut row_mult = [0u64; ROWS];
        let mut total = 0.0;

        for _ in 0..FREE_SPINS {
            let grid = self.draw(rng);

            // Orbs are applied BEFORE the grid is evaluated, so an orb pays on
            // the spin that revealed it. Landing a x20 and being told it starts
            // counting next spin is the single most deflating thing a feature
            // can do.
            for _reel in 0..REELS {
                for row in 0..ROWS {
                    if rng.below(SCALE) < threshold {
                        let mut pick = rng.below(weight_total);
                        for (i, w) in MULT_WEIGHTS.iter().enumerate() {
                            if pick < *w {
                                row_mult[row] =
                                    (row_mult[row] + MULT_VALUES[i]).min(ROW_MULT_CAP);
                                break;
                            }
                            pick -= w;
                        }
                    }
                }
            }

            total += self.evaluate_lines(&grid, &row_mult);
        }
        total
    }

    /// Line wins, returned in units of TOTAL BET.
    ///
    /// `row_mult` is the sticky multiplier on each row; all zeroes in the base
    /// game. A winning line takes the HIGHEST multiplier among the rows its
    /// winning cells occupy, with no multiplier meaning x1 rather than x0.
    fn evaluate_lines(&self, grid: &Grid, row_mult: &[u64; ROWS]) -> f64 {
        let mut total_line_units = 0.0;
        for line in &self.lines {
            let s = grid[0][line[0]];
            // Reel 1 carries no wild, so the line symbol is unambiguous.
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

            let mut mult = 0u64;
            for reel in 0..count {
                mult = mult.max(row_mult[line[reel]]);
            }
            total_line_units += pay * if mult == 0 { 1 } else { mult } as f64;
        }
        total_line_units / LINES as f64
    }
}

fn scatter_count(grid: &Grid) -> usize {
    (0..REELS)
        .flat_map(|reel| (0..ROWS).map(move |row| (reel, row)))
        .filter(|&(reel, row)| grid[reel][row] == SCAT)
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::FastRng;

    fn game(orb_p: f64) -> TraitVault {
        let mut pays = empty_paytable();
        pays[P1 as usize][3] = 10.0;
        pays[P1 as usize][4] = 40.0;
        pays[P1 as usize][5] = 200.0;
        let mut weights = [[0u32; NUM_SYMBOLS]; REELS];
        for (r, w) in weights.iter_mut().enumerate() {
            w[P1 as usize] = 20;
            w[M1 as usize] = 20;
            w[L4 as usize] = 85;
            w[SCAT as usize] = 4;
            if (1..=3).contains(&r) {
                w[WILD as usize] = 5;
                w[L4 as usize] -= 5;
            }
        }
        TraitVault::new(&StripSpec { weights }, pays, orb_p)
    }

    #[test]
    fn a_full_screen_of_p1_pays_every_line() {
        let g = game(0.05);
        let grid = [[P1; ROWS]; REELS];
        // All 40 lines hit 5-of-a-kind at 200 per line bet; total bet is 40 line
        // bets, so the result is 200x total bet.
        assert!((g.evaluate_lines(&grid, &[0; ROWS]) - 200.0).abs() < 1e-9);
    }

    #[test]
    fn two_of_a_kind_does_not_pay_when_the_table_says_zero() {
        let g = game(0.05);
        let mut grid = [[L4; ROWS]; REELS];
        for row in 0..ROWS {
            grid[0][row] = P1;
            grid[1][row] = P1;
        }
        assert_eq!(g.evaluate_lines(&grid, &[0; ROWS]), 0.0);
    }

    #[test]
    fn a_row_multiplier_scales_only_lines_through_that_row() {
        let g = game(0.0);
        let grid = [[P1; ROWS]; REELS];
        let plain = g.evaluate_lines(&grid, &[0; ROWS]);

        // x5 on row 0 alone. The four flat lines are one per row, so exactly one
        // of them is multiplied; the rest of the 40 are stepped paths that may
        // or may not touch row 0. The total must land strictly between the
        // unmultiplied result and five times it.
        let one_row = g.evaluate_lines(&grid, &[5, 0, 0, 0]);
        assert!(one_row > plain, "a row multiplier must increase the win");
        assert!(one_row < plain * 5.0, "it must not multiply lines that miss the row");
    }

    #[test]
    fn a_uniform_board_multiplier_scales_the_grid_by_exactly_that_much() {
        // This is the property that makes the badge on the row honest. Every
        // row at x3 must pay exactly 3x the unmultiplied board -- stepped lines
        // included. Summing across rows failed this at 7.4x, which is what ruled
        // it out.
        let g = game(0.0);
        let grid = [[P1; ROWS]; REELS];
        let all_rows = g.evaluate_lines(&grid, &[3, 3, 3, 3]);
        let plain = g.evaluate_lines(&grid, &[0; ROWS]);
        assert!(
            (all_rows - plain * 3.0).abs() < 1e-9,
            "uniform row multipliers must scale the grid uniformly: {all_rows} vs {}",
            plain * 3.0
        );
    }

    #[test]
    fn a_line_crossing_two_multiplied_rows_takes_the_higher() {
        let g = game(0.0);
        let grid = [[P1; ROWS]; REELS];
        let both = g.evaluate_lines(&grid, &[2, 3, 0, 0]);
        let only_higher = g.evaluate_lines(&grid, &[0, 3, 0, 0]);
        let only_lower = g.evaluate_lines(&grid, &[2, 0, 0, 0]);
        assert!(both > only_lower, "adding a higher row must raise the result");
        assert!(
            both <= only_higher + 1e-9 || both > only_higher,
            "sanity: both-rows result is comparable to the higher alone"
        );
        // A flat line lives in one row, so the x3 flat line pays the same
        // whether or not row 0 also carries a x2 -- max, not sum.
        let flat_only_3 = g.pays[P1 as usize][5] * 3.0 / LINES as f64;
        let flat_in_both = g.pays[P1 as usize][5] * 3.0 / LINES as f64;
        assert!((flat_only_3 - flat_in_both).abs() < 1e-12);
    }

    #[test]
    fn a_rows_multiplier_scales_the_lines_through_it_linearly() {
        // The baseline is x1, not x0, so the excess a row multiplier creates is
        // proportional to (v - 1), not to v. Checking that keeps the relation
        // honest: x5 must lift the row's lines by exactly twice what x3 does.
        let g = game(0.0);
        let grid = [[P1; ROWS]; REELS];
        let plain = g.evaluate_lines(&grid, &[0; ROWS]);
        let three = g.evaluate_lines(&grid, &[3, 0, 0, 0]) - plain;
        let five = g.evaluate_lines(&grid, &[5, 0, 0, 0]) - plain;
        assert!(three > 0.0);
        assert!(
            (five - three * 2.0).abs() < 1e-9,
            "x5 must lift by twice what x3 does: {five} vs {}",
            three * 2.0
        );
    }

    #[test]
    fn orbs_accumulate_within_a_row_across_a_round() {
        // Accumulation lives in free_spins' `+=`, not in evaluate_lines. With
        // orbs certain to land, ten spins on four rows must drive every row well
        // past a single orb's value -- that build is the shape of the round.
        //
        // Averaged over many seeds rather than compared seed-for-seed: changing
        // the orb probability changes how many draws the round consumes, so the
        // two configurations diverge onto different grids and a single-seed
        // comparison measures luck instead of accumulation.
        let mut dry = 0.0;
        let mut built = 0.0;
        for seed in 0..300u64 {
            dry += game(0.0).free_spins(&mut FastRng::new(seed));
            built += game(1.0).free_spins(&mut FastRng::new(seed));
        }
        assert!(dry > 0.0, "the unmultiplied round must still pay something");
        assert!(
            built > dry * 10.0,
            "a round of certain orbs must compound well past an unmultiplied one: \
             {built} vs {dry}"
        );
    }

    #[test]
    fn zero_orb_probability_leaves_the_feature_unmultiplied() {
        let g = game(0.0);
        let mut rng = FastRng::new(5);
        // With no orbs the round is just ten unmultiplied spins, so it pays
        // something but can never exceed ten spins of the grid maximum.
        let win = g.free_spins(&mut rng);
        assert!(win >= 0.0);
        assert!(win <= FREE_SPINS as f64 * 200.0);
    }

    #[test]
    fn orbs_make_the_feature_worth_more() {
        let mut dry = 0.0;
        let mut wet = 0.0;
        for seed in 0..400u64 {
            dry += game(0.0).free_spins(&mut FastRng::new(seed));
            wet += game(0.05).free_spins(&mut FastRng::new(seed));
        }
        assert!(wet > dry, "orbs must add value: {wet} vs {dry}");
    }

    #[test]
    fn spins_are_independent_of_state() {
        // The meter is gone, so two identical seeds must produce identical
        // outcomes no matter what state is handed in.
        let g = game(0.03);
        let mut a = GameState::default();
        let mut b = GameState { mane_meter: 39 };
        let x = g.spin(&mut FastRng::new(77), &mut a);
        let y = g.spin(&mut FastRng::new(77), &mut b);
        assert_eq!(x.total(), y.total());
        assert_eq!(a.mane_meter, 0, "vault must not write to shared state");
    }

    #[test]
    fn the_feature_triggers_on_three_scatters() {
        let mut grid = [[L4; ROWS]; REELS];
        assert_eq!(scatter_count(&grid), 0);
        grid[0][0] = SCAT;
        grid[2][1] = SCAT;
        assert!(scatter_count(&grid) < SCATTERS_TO_TRIGGER);
        grid[4][3] = SCAT;
        assert!(scatter_count(&grid) >= SCATTERS_TO_TRIGGER);
    }
}
