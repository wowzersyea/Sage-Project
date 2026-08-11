//! GAME 3 -- TRAIT VAULT: 40 fixed lines + persistent Mane Meter (spec Sec. 6.4).
//!
//! The lowest-variance product in the suite. Every M-tier symbol landed adds +1
//! to a meter that PERSISTS ACROSS SESSIONS; at 40 it awards a guaranteed
//! 6-respin Hold and Win in which only $LAZY coins land.
//!
//! Because the meter carries over, spins here are NOT independent and the
//! simulator must run them sequentially through `GameState` -- treating them as
//! independent would misprice the feature badly (spec Sec. 6.4).

use crate::game::*;
use crate::games::{GameState, SpinOutcome};
use crate::rng::Rng;

pub const GAME_ID: &str = "traitvault";
pub const LINES: usize = 40;
pub const MANE_METER_TARGET: u32 = 40;
pub const HOLD_AND_WIN_RESPINS: usize = 6;

/// Coin values and their weights. Heavily skewed to 1x-3x per spec.
pub const COIN_VALUES: [f64; 6] = [1.0, 2.0, 3.0, 5.0, 10.0, 20.0];
pub const COIN_WEIGHTS: [u32; 6] = [400, 300, 180, 80, 30, 10];

pub struct TraitVault {
    pub strips: Strips,
    /// Pays are per LINE BET; total bet is 40x a line bet.
    pub pays: PayTable,
    pub lines: Vec<[usize; REELS]>,
    /// Probability an empty cell lands a coin on a Hold and Win respin. This is
    /// the feature's only free parameter and is what holds the meter inside its
    /// share of the 97% budget.
    pub coin_probability: f64,
}

type Grid = [[u8; ROWS]; REELS];

impl TraitVault {
    pub fn new(spec: &StripSpec, pays: PayTable, coin_probability: f64) -> Self {
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
            coin_probability,
        }
    }

    pub fn spin(&self, rng: &mut impl Rng, state: &mut GameState) -> SpinOutcome {
        let mut grid = [[0u8; ROWS]; REELS];
        for reel in 0..REELS {
            let stop = rng.below(self.strips.len(reel));
            for row in 0..ROWS {
                grid[reel][row] = self.strips.at(reel, stop, row);
            }
        }

        let mut out = SpinOutcome::default();
        out.base = self.evaluate_lines(&grid);

        // Meter advances by the number of M-tier symbols on the grid.
        let mane_landed: u32 = (0..REELS)
            .flat_map(|reel| (0..ROWS).map(move |row| (reel, row)))
            .filter(|&(reel, row)| is_mane_symbol(grid[reel][row]))
            .count() as u32;
        state.mane_meter += mane_landed;

        if state.mane_meter >= MANE_METER_TARGET {
            // Carry the remainder rather than discarding it; discarding would
            // quietly lower the feature rate below what the meter UI promises.
            state.mane_meter -= MANE_METER_TARGET;
            out.feature_triggered = true;
            out.feature += self.hold_and_win(rng);
        }
        out
    }

    /// Line wins, returned in units of TOTAL BET.
    fn evaluate_lines(&self, grid: &Grid) -> f64 {
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
            total_line_units += self.pays[s as usize][count];
        }
        total_line_units / LINES as f64
    }

    /// Exactly six respins, no reset-on-land. Coins that land are held.
    fn hold_and_win(&self, rng: &mut impl Rng) -> f64 {
        const SCALE: u32 = 1_000_000;
        let threshold = (self.coin_probability * SCALE as f64).round() as u32;
        let weight_total: u32 = COIN_WEIGHTS.iter().sum();

        let mut filled = [false; CELLS];
        let mut total = 0.0;

        for _ in 0..HOLD_AND_WIN_RESPINS {
            for cell in 0..CELLS {
                if filled[cell] {
                    continue;
                }
                if rng.below(SCALE) < threshold {
                    filled[cell] = true;
                    let mut pick = rng.below(weight_total);
                    for (i, w) in COIN_WEIGHTS.iter().enumerate() {
                        if pick < *w {
                            total += COIN_VALUES[i];
                            break;
                        }
                        pick -= w;
                    }
                }
            }
        }
        total
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::FastRng;

    fn game(coin_p: f64) -> TraitVault {
        let mut pays = empty_paytable();
        pays[P1 as usize][3] = 10.0;
        pays[P1 as usize][4] = 40.0;
        pays[P1 as usize][5] = 200.0;
        let mut weights = [[0u32; NUM_SYMBOLS]; REELS];
        for (r, w) in weights.iter_mut().enumerate() {
            w[P1 as usize] = 20;
            w[M1 as usize] = 20;
            w[L4 as usize] = 85;
            if (1..=3).contains(&r) {
                w[WILD as usize] = 5;
                w[L4 as usize] -= 5;
            }
        }
        TraitVault::new(&StripSpec { weights }, pays, coin_p)
    }

    #[test]
    fn a_full_screen_of_p1_pays_every_line() {
        let g = game(0.05);
        let grid = [[P1; ROWS]; REELS];
        // All 40 lines hit 5-of-a-kind at 200 per line bet; total bet is 40 line
        // bets, so the result is 200x total bet.
        assert!((g.evaluate_lines(&grid) - 200.0).abs() < 1e-9);
    }

    #[test]
    fn two_of_a_kind_does_not_pay_when_the_table_says_zero() {
        let g = game(0.05);
        let mut grid = [[L4; ROWS]; REELS];
        for row in 0..ROWS {
            grid[0][row] = P1;
            grid[1][row] = P1;
        }
        assert_eq!(g.evaluate_lines(&grid), 0.0);
    }

    #[test]
    fn meter_persists_across_spins_and_carries_the_remainder() {
        let g = game(0.0);
        let mut state = GameState { mane_meter: 39 };
        let mut rng = FastRng::new(3);
        let mut triggers = 0;
        for _ in 0..200 {
            let out = g.spin(&mut rng, &mut state);
            if out.feature_triggered {
                triggers += 1;
            }
            assert!(state.mane_meter < MANE_METER_TARGET, "meter never drains");
        }
        assert!(triggers > 0, "a meter starting at 39 must trigger quickly");
    }

    #[test]
    fn meter_does_not_reset_between_spins() {
        let g = game(0.0);
        let mut state = GameState::default();
        let mut rng = FastRng::new(11);
        g.spin(&mut rng, &mut state);
        let after_one = state.mane_meter;
        g.spin(&mut rng, &mut state);
        assert!(
            state.mane_meter >= after_one,
            "meter went backwards without a trigger: {after_one} -> {}",
            state.mane_meter
        );
    }

    #[test]
    fn hold_and_win_is_bounded_by_the_grid() {
        // With certainty of landing, every cell fills and the max payout is
        // 20 cells at the 20x top coin.
        let g = game(1.0);
        let mut rng = FastRng::new(5);
        let win = g.hold_and_win(&mut rng);
        assert!(win > 0.0);
        assert!(win <= CELLS as f64 * 20.0, "hold and win exceeded grid maximum");
    }

    #[test]
    fn zero_coin_probability_pays_nothing() {
        let g = game(0.0);
        let mut rng = FastRng::new(5);
        assert_eq!(g.hold_and_win(&mut rng), 0.0);
    }
}
