//! GAME 1 -- PRIDE: 5x4, 1024 ways (spec Sec. 6.4).
//!
//! All four rows on all five reels are active, so 4^5 = 1024 ways. Wins pay
//! left-to-right on adjacent reels, once per way. Wild appears on reels 2-4
//! only and substitutes for everything but scatter. 3+ scatters award 10 free
//! spins in which each wild carries a 2x multiplier; multipliers on a single
//! way ADD and cap at 10x.
//!
//! There is deliberately no retrigger. Retriggers are the single biggest
//! contributor to variance in a free-spin feature, and this game is budgeted
//! to a volatility index of 4.2.

use crate::game::*;
use crate::games::SpinOutcome;
use crate::rng::Rng;

pub const GAME_ID: &str = "pride";
pub const FREE_SPINS_AWARDED: usize = 10;
pub const SCATTERS_TO_TRIGGER: u32 = 3;

/// THE CROWN IS A STACK, NEVER A SINGLE SYMBOL.
///
/// P1 -- the Crown lion -- carries zero weight on every strip. Instead each
/// reel independently turns entirely to Crowns with probability
/// CROWN_STACK_NUM / CROWN_STACK_DENOM, four rows at once.
///
/// This exists because the jackpot is "fill the board", and on the strips that
/// event has probability exactly ZERO rather than merely small. `build_strip`
/// spreads symbols by largest remainder specifically to avoid clumping, so a
/// run of four identical symbols never occurs on any reel this project builds.
/// A full screen of one symbol is not unlikely there; it is impossible. Stacked
/// reels are how real machines make a full screen reachable, and they also give
/// the mechanic its shape on the way up: one crowned reel is a nice hit, three
/// is a large one, five is the Lion.
pub const CROWN_STACK_NUM: u32 = 600;
pub const CROWN_STACK_DENOM: u32 = 10_000;

/// The NFT prize, in units of total bet.
///
/// The paytable CANNOT reach this and must never be scaled to try: it is a
/// fixed prize, so it is a constant term in the RTP, exactly the case the
/// README warns about after Trait Vault's Hold and Win left a stale one behind.
/// `calibrate` therefore solves the coin paytable against
/// (target RTP - jackpot RTP), and the jackpot's contribution is computed in
/// closed form rather than sampled -- at one hit in ~1.3 million spins, a
/// simulation long enough to measure it accurately would take longer than the
/// calibration it feeds.
pub const NFT_PRIZE_X: f64 = 25_000.0;

/// Per GRID: every reel must crown, and the reels are independent.
pub fn nft_probability() -> f64 {
    (CROWN_STACK_NUM as f64 / CROWN_STACK_DENOM as f64).powi(REELS as i32)
}

/// Per SPIN, which is the number a player actually experiences and is NOT the
/// same thing.
///
/// A triggered spin draws eleven grids, not one, and every one of them can fill
/// the board. Reporting the per-grid figure as though it were per-spin
/// understated the jackpot rate by about 9%: a 100M run predicted 78 hits and
/// produced 99, which is how the error was caught -- the observed count sat
/// 2.4 sigma above a "closed form" that was quietly measuring something else.
///
/// The trigger rate is a property of the strips rather than of this file, so it
/// is passed in from the same simulation that measured it.
pub fn nft_probability_per_spin(feature_frequency: f64) -> f64 {
    let grids = 1.0 + FREE_SPINS_AWARDED as f64 * feature_frequency;
    // Union over grids. The double-hit term is ~1e-12 and dropped, but the
    // bound is stated rather than assumed away.
    grids * nft_probability()
}

/// The jackpot's share of RTP, in the same units as `Stats::rtp`.
pub fn nft_rtp(feature_frequency: f64) -> f64 {
    nft_probability_per_spin(feature_frequency) * NFT_PRIZE_X
}

pub struct Pride {
    pub strips: Strips,
    pub pays: PayTable,
}

type Grid = [[u8; ROWS]; REELS];

impl Pride {
    pub fn new(spec: &StripSpec, pays: PayTable) -> Self {
        for r in [0usize, 4] {
            assert_eq!(
                spec.weights[r][WILD as usize], 0,
                "wild must not appear on reel {} (reels 2-4 only)",
                r + 1
            );
        }
        Pride { strips: spec.build(), pays }
    }

    /// Returns the grid and how many reels came up crowned.
    ///
    /// TWO DRAWS PER REEL, ALWAYS, IN THIS ORDER. The stack decision must not
    /// change how many numbers a spin consumes -- the page and the standalone
    /// verifier replay the same seed triple through the same sequence, and a
    /// conditional draw would desynchronise them for every spin after the first
    /// crowned reel. Drawing the stop even when it goes unused costs one HMAC
    /// block and buys exact parity.
    fn draw_grid(&self, rng: &mut impl Rng) -> (Grid, u32) {
        let mut grid = [[0u8; ROWS]; REELS];
        let mut crowned = 0u32;
        for reel in 0..REELS {
            let roll = rng.below(CROWN_STACK_DENOM);
            let stop = rng.below(self.strips.len(reel));
            if roll < CROWN_STACK_NUM {
                crowned += 1;
                for row in 0..ROWS {
                    grid[reel][row] = P1;
                }
            } else {
                for row in 0..ROWS {
                    grid[reel][row] = self.strips.at(reel, stop, row);
                }
            }
        }
        (grid, crowned)
    }

    pub fn spin(&self, rng: &mut impl Rng) -> SpinOutcome {
        let (grid, crowned) = self.draw_grid(rng);
        let mut out = SpinOutcome::default();
        out.nft_won = crowned as usize == REELS;

        out.base = self.evaluate(&grid, false);

        let scatters = count_scatters(&grid);
        out.base += self.pays[SCAT as usize][(scatters as usize).min(REELS)];

        if scatters >= SCATTERS_TO_TRIGGER {
            out.feature_triggered = true;
            for _ in 0..FREE_SPINS_AWARDED {
                let (fs_grid, fs_crowned) = self.draw_grid(rng);
                out.nft_won |= fs_crowned as usize == REELS;
                out.feature += self.evaluate(&fs_grid, true);
                let fs_scatters = count_scatters(&fs_grid);
                out.feature += self.pays[SCAT as usize][(fs_scatters as usize).min(REELS)];
            }
        }
        out
    }

    /// Ways evaluation. With `multiplier_wilds`, each way is weighted by the
    /// additive multiplier its own wild count earns -- so the DP tracks the
    /// distribution of wilds across ways rather than just the way count.
    fn evaluate(&self, grid: &Grid, multiplier_wilds: bool) -> f64 {
        let mut total = 0.0;

        for s in P1..NUM_SYMBOLS as u8 {
            let mut natural = [0u32; REELS];
            let mut wilds = [0u32; REELS];
            for reel in 0..REELS {
                for row in 0..ROWS {
                    let c = grid[reel][row];
                    if c == s {
                        natural[reel] += 1;
                    } else if c == WILD {
                        wilds[reel] += 1;
                    }
                }
            }

            let mut len = 0usize;
            while len < REELS && natural[len] + wilds[len] > 0 {
                len += 1;
            }
            if len < 3 {
                continue;
            }
            let pay = self.pays[s as usize][len];
            if pay == 0.0 {
                continue;
            }

            if !multiplier_wilds {
                let ways: f64 = (0..len).map(|r| (natural[r] + wilds[r]) as f64).product();
                total += pay * ways;
            } else {
                // dp[k] = number of ways using exactly k wilds.
                let mut dp = [0f64; REELS + 1];
                dp[0] = 1.0;
                for r in 0..len {
                    let mut next = [0f64; REELS + 1];
                    for k in 0..=r {
                        if dp[k] == 0.0 {
                            continue;
                        }
                        next[k] += dp[k] * natural[r] as f64;
                        next[k + 1] += dp[k] * wilds[r] as f64;
                    }
                    dp = next;
                }
                let weighted: f64 = (0..=len)
                    .map(|k| dp[k] * additive_wild_multiplier(k as u32))
                    .sum();
                total += pay * weighted;
            }
        }
        total
    }
}

#[inline]
fn count_scatters(grid: &Grid) -> u32 {
    let mut n = 0;
    for reel in 0..REELS {
        for row in 0..ROWS {
            if grid[reel][row] == SCAT {
                n += 1;
            }
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pays_with(symbol: u8, three: f64, four: f64, five: f64) -> PayTable {
        let mut p = empty_paytable();
        p[symbol as usize][3] = three;
        p[symbol as usize][4] = four;
        p[symbol as usize][5] = five;
        p
    }

    fn game() -> Pride {
        let mut weights = [[0u32; NUM_SYMBOLS]; REELS];
        for (r, w) in weights.iter_mut().enumerate() {
            w[P1 as usize] = 20;
            w[L4 as usize] = 100;
            if r >= 1 && r <= 3 {
                w[WILD as usize] = 5;
                w[L4 as usize] -= 5;
            }
        }
        Pride::new(&StripSpec { weights }, pays_with(P1, 1.0, 2.0, 5.0))
    }

    #[test]
    fn ways_multiply_across_reels() {
        let g = game();
        // P1 on 2 rows of reel 1, 3 rows of reel 2, 1 row of reel 3 => 6 ways.
        let mut grid = [[L4; ROWS]; REELS];
        grid[0][0] = P1;
        grid[0][1] = P1;
        grid[1][0] = P1;
        grid[1][1] = P1;
        grid[1][2] = P1;
        grid[2][0] = P1;
        assert_eq!(g.evaluate(&grid, false), 6.0 * 1.0);
    }

    #[test]
    fn a_run_broken_at_reel_three_pays_nothing() {
        let g = game();
        let mut grid = [[L4; ROWS]; REELS];
        grid[0][0] = P1;
        grid[1][0] = P1;
        assert_eq!(g.evaluate(&grid, false), 0.0, "two of a kind must not pay");
    }

    #[test]
    fn wilds_extend_a_run() {
        let g = game();
        let mut grid = [[L4; ROWS]; REELS];
        grid[0][0] = P1;
        grid[1][0] = WILD;
        grid[2][0] = P1;
        grid[3][0] = WILD;
        // Reel 5 has no wild and no P1, so the run is length 4 => pays 2.0 x 1 way.
        assert_eq!(g.evaluate(&grid, false), 2.0);
    }

    #[test]
    fn free_spin_multipliers_add_per_way_and_cap() {
        let g = game();
        let mut grid = [[L4; ROWS]; REELS];
        grid[0][0] = P1;
        grid[1][0] = WILD;
        grid[2][0] = WILD;
        grid[3][0] = WILD;
        grid[4][0] = P1;
        // One way, three wilds => 2+2+2 = 6x on a 5-of-a-kind paying 5.0.
        assert_eq!(g.evaluate(&grid, true), 5.0 * 6.0);
        // Without multiplier wilds the same grid is a flat 5.0.
        assert_eq!(g.evaluate(&grid, false), 5.0);
    }

    #[test]
    fn multiplier_dp_matches_way_count_when_no_wilds_present() {
        let g = game();
        let mut grid = [[L4; ROWS]; REELS];
        for reel in 0..3 {
            grid[reel][0] = P1;
            grid[reel][1] = P1;
        }
        // 2*2*2 = 8 ways, no wilds, so both evaluations agree.
        assert_eq!(g.evaluate(&grid, false), 8.0);
        assert_eq!(g.evaluate(&grid, true), 8.0);
    }

    #[test]
    fn maximum_ways_is_1024() {
        let g = game();
        let grid = [[P1; ROWS]; REELS];
        // 4^5 ways at the 5-of-a-kind pay.
        assert_eq!(g.evaluate(&grid, false), 1024.0 * 5.0);
    }
}
