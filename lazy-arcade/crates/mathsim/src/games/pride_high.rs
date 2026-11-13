//! GAME 1, HIGH PROFILE -- PRIDE with sticky crowns, multiplier wilds and
//! retriggers.
//!
//! The base game is the low profile's, unchanged: 5x4, 1024 ways, each reel
//! turning entirely to Crowns on its own roll. The free-spin round is where
//! the profile differs, in three ways:
//!
//!   * CROWNS STICK. A reel that crowns during the round stays crowned for the
//!     rest of it, so the board can fill up over the round -- the column-by-
//!     column build the reference brief pointed at. Because a sticky crown
//!     makes the full board (the Lion) enormously likelier, the round rolls
//!     its own, much lower, crown rate. At the base rate of 6% per reel a
//!     ten-spin round would fill the board about one time in fifty, and the
//!     jackpot alone would be worth several times the stake.
//!   * WILDS CARRY x2, x3 or x5. Multipliers on one way ADD, to a ceiling of
//!     x25.
//!   * RETRIGGERS. Three or more scatters in the round add five spins.
//!
//! The round opens with 10/12/15 spins for 3/4/5 scatters. The coin max win
//! is enforced inside the round. The NFT is a prize outside the coin
//! economy: never capped, never scaled, reported on its own line.
//!
//! RNG draw order, which the page and the verifier replay exactly:
//!   per grid, per reel: crown roll, then stop -- ALWAYS two draws, even on a
//!   reel already crowned, so a sticky crown cannot shift the stream;
//!   then, free spins only, one multiplier draw per wild, reel-major.

use crate::game::*;
use crate::games::SpinOutcome;
use crate::rng::Rng;

pub const GAME_ID: &str = "pride-high";
pub const CROWN_STACK_NUM: u32 = 600;
pub const CROWN_STACK_DENOM: u32 = 10_000;
/// The round's crown rate per non-crowned reel per spin.
pub const CROWN_FS_NUM: u32 = 150;
pub const NFT_PRIZE_X: f64 = 25_000.0;
pub const RETRIGGER_SPINS: usize = 5;
pub const WILD_MULT_V: [u32; 3] = [2, 3, 5];
pub const WILD_MULT_W: [u32; 3] = [60, 30, 10];
pub const WILD_MULT_CAP: u32 = 25;
pub const MAX_FREE_SPINS: usize = 500;
/// Wild weight ADDED to reels 2-4 for the free-spin round. The round plays on
/// its own reels -- the convention for a bonus worth waiting for -- and a
/// multiplier wild only matters if wilds actually land.
pub const FS_WILD_BOOST: u32 = 18;

pub fn spins_for_scatters(n: u32) -> usize {
    match n {
        0..=2 => 0,
        3 => 10,
        4 => 12,
        _ => 15,
    }
}

type Grid = [[u8; ROWS]; REELS];
type Mults = [[u32; ROWS]; REELS];

pub struct PrideHigh {
    pub strips: Strips,
    pub fs_strips: Strips,
    pub pays: PayTable,
    pub cap: f64,
}

/// The round's reels: the base reels with FS_WILD_BOOST more wilds on 2-4.
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

/// One free-spin round's result.
pub struct Round {
    pub coins: f64,
    pub nft: bool,
    pub spins: usize,
}

impl PrideHigh {
    pub fn new(spec: &StripSpec, pays: PayTable, cap: f64) -> Self {
        for r in [0usize, 4] {
            assert_eq!(spec.weights[r][WILD as usize], 0, "wild must not appear on reel {}", r + 1);
        }
        PrideHigh { strips: spec.build(), fs_strips: fs_spec(spec).build(), pays, cap }
    }

    /// Two draws per reel, always. `sticky` marks reels already crowned this
    /// round; they stay crowned whatever their roll says.
    fn draw(&self, rng: &mut impl Rng, crown_num: u32, sticky: &mut [bool; REELS]) -> Grid {
        let strips = if crown_num == CROWN_STACK_NUM { &self.strips } else { &self.fs_strips };
        let mut g = [[0u8; ROWS]; REELS];
        for reel in 0..REELS {
            let roll = rng.below(CROWN_STACK_DENOM);
            let stop = rng.below(strips.len(reel));
            if sticky[reel] || roll < crown_num {
                sticky[reel] = true;
                for row in 0..ROWS {
                    g[reel][row] = P1;
                }
            } else {
                for row in 0..ROWS {
                    g[reel][row] = strips.at(reel, stop, row);
                }
            }
        }
        g
    }

    pub fn spin(&self, rng: &mut impl Rng) -> SpinOutcome {
        let mut out = SpinOutcome::default();
        // The base game is not sticky: a fresh mask every spin.
        let mut fresh = [false; REELS];
        let grid = self.draw(rng, CROWN_STACK_NUM, &mut fresh);
        out.nft_won = fresh.iter().all(|&c| c);
        let scat = count_scatters(&grid);
        out.base = (self.evaluate(&grid, None) + self.pays[SCAT as usize][(scat as usize).min(REELS)])
            .min(self.cap);
        if out.base >= self.cap {
            return out;
        }
        let award = spins_for_scatters(scat);
        if award > 0 {
            out.feature_triggered = true;
            let r = self.free_spins(rng, award, self.cap - out.base);
            out.feature = r.coins;
            out.nft_won |= r.nft;
        }
        out
    }

    /// The round on its own, so a bought round is literally the same round.
    pub fn free_spins(&self, rng: &mut impl Rng, award: usize, room: f64) -> Round {
        let mut sticky = [false; REELS];
        let mut left = award;
        let mut spins = 0usize;
        let mut coins = 0.0;
        let mut nft = false;
        let wt: u32 = WILD_MULT_W.iter().sum();
        while left > 0 && spins < MAX_FREE_SPINS {
            left -= 1;
            spins += 1;
            let grid = self.draw(rng, CROWN_FS_NUM, &mut sticky);
            nft |= sticky.iter().all(|&c| c);
            let mut mults: Mults = [[0; ROWS]; REELS];
            for reel in 0..REELS {
                for row in 0..ROWS {
                    if grid[reel][row] == WILD {
                        let mut pick = rng.below(wt);
                        for (i, w) in WILD_MULT_W.iter().enumerate() {
                            if pick < *w {
                                mults[reel][row] = WILD_MULT_V[i];
                                break;
                            }
                            pick -= w;
                        }
                    }
                }
            }
            let scat = count_scatters(&grid);
            coins += self.evaluate(&grid, Some(&mults)) + self.pays[SCAT as usize][(scat as usize).min(REELS)];
            if coins >= room {
                return Round { coins: room, nft, spins };
            }
            if scat >= 3 {
                left += RETRIGGER_SPINS;
            }
        }
        Round { coins, nft, spins }
    }

    /// Ways evaluation. With `mults`, each way is weighted by the SUM of the
    /// multipliers on the wilds it uses (x1 when it uses none), capped at
    /// WILD_MULT_CAP; the DP tracks that sum across reels.
    pub fn evaluate(&self, grid: &Grid, mults: Option<&Mults>) -> f64 {
        let mut total = 0.0;
        const S: usize = WILD_MULT_CAP as usize + 1;
        for s in P1..NUM_SYMBOLS as u8 {
            let mut len = 0usize;
            while len < REELS && (0..ROWS).any(|row| grid[len][row] == s || grid[len][row] == WILD) {
                len += 1;
            }
            if len < 3 {
                continue;
            }
            let pay = self.pays[s as usize][len];
            if pay == 0.0 {
                continue;
            }
            match mults {
                None => {
                    let ways: f64 = (0..len)
                        .map(|r| (0..ROWS).filter(|&row| grid[r][row] == s || grid[r][row] == WILD).count() as f64)
                        .product();
                    total += pay * ways;
                }
                Some(m) => {
                    let mut dp = [0f64; S];
                    dp[0] = 1.0;
                    for r in 0..len {
                        let mut next = [0f64; S];
                        let naturals = (0..ROWS).filter(|&row| grid[r][row] == s).count() as f64;
                        for k in 0..S {
                            if dp[k] == 0.0 {
                                continue;
                            }
                            next[k] += dp[k] * naturals;
                            for row in 0..ROWS {
                                if grid[r][row] == WILD {
                                    let to = (k + m[r][row] as usize).min(S - 1);
                                    next[to] += dp[k];
                                }
                            }
                        }
                        dp = next;
                    }
                    let weighted: f64 = (0..S).map(|k| dp[k] * if k == 0 { 1.0 } else { k as f64 }).sum();
                    total += pay * weighted;
                }
            }
        }
        total
    }
}

fn count_scatters(grid: &Grid) -> u32 {
    grid.iter().flat_map(|c| c.iter()).filter(|&&s| s == SCAT).count() as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::FastRng;

    const L4: u8 = 13;
    const M2: u8 = 7;

    fn game() -> PrideHigh {
        let mut pays = empty_paytable();
        pays[M2 as usize][3] = 1.0;
        pays[M2 as usize][4] = 2.0;
        pays[M2 as usize][5] = 4.0;
        let mut weights = [[0u32; NUM_SYMBOLS]; REELS];
        for (r, w) in weights.iter_mut().enumerate() {
            w[M2 as usize] = 30;
            w[L4 as usize] = 90;   // keeps every strip over the 120 minimum
            w[SCAT as usize] = 6;
            if (1..=3).contains(&r) {
                w[WILD as usize] = 6;
            }
        }
        PrideHigh::new(&StripSpec { weights: weights.to_vec() }, pays, 5_000.0)
    }

    #[test]
    fn wild_multipliers_add_along_a_way() {
        let g = game();
        let mut grid = [[L4; ROWS]; REELS];
        grid[0][0] = M2;
        grid[1][0] = WILD;
        grid[2][0] = WILD;
        let mut m = [[0u32; ROWS]; REELS];
        m[1][0] = 3;
        m[2][0] = 5;
        // one way, wilds x3 + x5 = x8, pays 3-of-a-kind (1.0)
        assert!((g.evaluate(&grid, Some(&m)) - 8.0).abs() < 1e-9);
        // without multipliers the same way pays x1
        assert!((g.evaluate(&grid, None) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn the_wild_multiplier_caps_at_25() {
        let g = game();
        let mut grid = [[L4; ROWS]; REELS];
        grid[0][0] = M2;
        for reel in 1..4 {
            for row in 0..ROWS {
                grid[reel][row] = WILD;
            }
        }
        let mut m = [[0u32; ROWS]; REELS];
        for reel in 1..4 {
            for row in 0..ROWS {
                m[reel][row] = 5;
            }
        }
        // 4 x 4 x 4 = 64 ways through reels 2-4, every one summing 15 -> x15,
        // and a 4-of-a-kind... reel 5 is L4, so len is 4.
        let v = g.evaluate(&grid, Some(&m));
        assert!((v - 64.0 * 15.0 * 2.0).abs() < 1e-6, "{v}");
        m[1][0] = 25; // one path now sums 35 and is clamped to 25
        let v2 = g.evaluate(&grid, Some(&m));
        assert!(v2 > v && v2 < v + 16.0 * 20.0 * 2.0 + 1e-6);
    }

    #[test]
    fn crowns_stick_for_the_round_and_two_draws_per_reel_always() {
        let g = game();
        let mut rng = FastRng::new(5);
        let mut sticky = [false, true, false, false, false];
        for _ in 0..50 {
            let grid = g.draw(&mut rng, 0, &mut sticky);
            assert!(grid[1].iter().all(|&s| s == P1), "a sticky reel stayed crowned");
        }
    }

    #[test]
    fn retriggers_extend_the_round_and_the_cap_binds_exactly() {
        let g = game();
        let mut rng = FastRng::new(9);
        let mut longest = 0;
        for _ in 0..3_000 {
            let r = g.free_spins(&mut rng, 10, 5_000.0);
            longest = longest.max(r.spins);
            assert!(r.coins <= 5_000.0 + 1e-9);
        }
        assert!(longest > 10, "no retrigger in 3000 rounds");
    }
}
