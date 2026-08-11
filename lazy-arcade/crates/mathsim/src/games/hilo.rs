//! GAME 4 -- RARITY HI/LO (spec Sec. 7).
//!
//! NFTs are ordered by rarity into UNIQUE ordinals p in 1..=N, where p=1 is the
//! most common and p=N the rarest. Unique ordinals mean no ties, which removes
//! push/tie ambiguity entirely. For a card at position p, drawing from the
//! remaining N-1 cards:
//!
//! ```text
//! P(rarer)    = (N - p) / (N - 1)
//! P(commoner) = (p - 1) / (N - 1)          these sum to exactly 1
//! payout(dir) = 0.97 / P(dir)
//! ```
//!
//! The edge is therefore 3% PER DECISION and is exact for every offered bet --
//! which is why a direction below the probability floor is DISABLED rather than
//! payout-capped. Capping would silently claw back RTP on the very bets players
//! scrutinise most.

use crate::rng::Rng;

pub const GAME_ID: &str = "hilo";
pub const HOUSE_RETURN: f64 = 0.97;
/// Below this probability a direction is not offered at all (spec Sec. 7.2).
pub const MIN_OFFERED_PROBABILITY: f64 = 0.05;
pub const MAX_ROUND_MULTIPLIER: f64 = 5_000.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Rarer,
    Commoner,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeckMode {
    /// N = full collection. Smooth curve, good UX. Default.
    Collection,
    /// N = operator holdings. Chunky odds, thematically tight.
    Owned,
}

/// P(rarer) for a card at ordinal `p` in a deck of `n`.
#[inline]
pub fn p_rarer(n: u32, p: u32) -> f64 {
    debug_assert!(n >= 2 && p >= 1 && p <= n);
    (n - p) as f64 / (n - 1) as f64
}

#[inline]
pub fn p_commoner(n: u32, p: u32) -> f64 {
    (p - 1) as f64 / (n - 1) as f64
}

#[inline]
pub fn probability(n: u32, p: u32, dir: Direction) -> f64 {
    match dir {
        Direction::Rarer => p_rarer(n, p),
        Direction::Commoner => p_commoner(n, p),
    }
}

/// The multiplier a correct call pays, or None when the direction is disabled.
#[inline]
pub fn payout(n: u32, p: u32, dir: Direction) -> Option<f64> {
    let prob = probability(n, p, dir);
    if prob < MIN_OFFERED_PROBABILITY {
        None
    } else {
        Some(HOUSE_RETURN / prob)
    }
}

/// Fee for a Rarity Swap, priced at EXACT expected value so it cannot move RTP
/// in either direction (spec Sec. 7.4).
///
/// Redrawing replaces the current card with a uniform draw from the other N-1
/// cards. Its value to the player is the change in the best multiplier
/// available; charging precisely that leaves the edge untouched.
pub fn swap_fee(n: u32, p: u32) -> f64 {
    let current = best_available_ev(n, p);
    let mut sum = 0.0;
    for q in 1..=n {
        if q == p {
            continue;
        }
        sum += best_available_ev(n, q);
    }
    let after = sum / (n - 1) as f64;
    (after - current).max(0.0)
}

/// EV of the best offered direction at `p`, per unit staked. Always 0.97 when
/// any direction is offered -- that is the whole point of the design.
fn best_available_ev(n: u32, p: u32) -> f64 {
    let mut best: f64 = 0.0;
    for dir in [Direction::Rarer, Direction::Commoner] {
        if let Some(mult) = payout(n, p, dir) {
            best = best.max(probability(n, p, dir) * mult);
        }
    }
    best
}

pub struct HiLo {
    pub n: u32,
}

/// Outcome of one decision, in units of the amount at risk on that decision.
#[derive(Clone, Copy, Debug)]
pub struct DecisionOutcome {
    pub returned: f64,
    pub correct: bool,
}

impl HiLo {
    pub fn new(mode: DeckMode, collection_size: u32, owned_size: u32) -> Self {
        let n = match mode {
            DeckMode::Collection => collection_size,
            DeckMode::Owned => owned_size,
        };
        assert!(n >= 2, "a deck needs at least two cards");
        HiLo { n }
    }

    #[inline]
    pub fn draw_card(&self, rng: &mut impl Rng) -> u32 {
        rng.below(self.n) + 1
    }

    /// Draw uniformly from the N-1 cards that are not `current`.
    #[inline]
    pub fn draw_excluding(&self, rng: &mut impl Rng, current: u32) -> u32 {
        let k = rng.below(self.n - 1) + 1;
        if k >= current {
            k + 1
        } else {
            k
        }
    }

    /// Which directions the UI may offer at `p`.
    pub fn offered(&self, p: u32) -> Vec<Direction> {
        [Direction::Rarer, Direction::Commoner]
            .into_iter()
            .filter(|&d| payout(self.n, p, d).is_some())
            .collect()
    }

    /// Resolve a single decision. Returns the amount returned per unit staked.
    pub fn decide(&self, rng: &mut impl Rng, p: u32, dir: Direction) -> DecisionOutcome {
        let mult = payout(self.n, p, dir).expect("caller offered a disabled direction");
        let next = self.draw_excluding(rng, p);
        let correct = match dir {
            Direction::Rarer => next > p,
            Direction::Commoner => next < p,
        };
        DecisionOutcome { returned: if correct { mult } else { 0.0 }, correct }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::FastRng;

    const N: u32 = 10_078;

    #[test]
    fn probabilities_sum_to_exactly_one() {
        for p in [1u32, 2, 5_000, N - 1, N] {
            let total = p_rarer(N, p) + p_commoner(N, p);
            assert!((total - 1.0).abs() < 1e-12, "p={p} summed to {total}");
        }
    }

    #[test]
    fn the_extremes_behave() {
        // The most common card can only go rarer.
        assert_eq!(p_commoner(N, 1), 0.0);
        assert_eq!(p_rarer(N, 1), 1.0);
        // The rarest can only go commoner.
        assert_eq!(p_rarer(N, N), 0.0);
        assert_eq!(p_commoner(N, N), 1.0);
    }

    #[test]
    fn thin_directions_are_disabled_not_capped() {
        // Just under the 5% floor -> no bet offered.
        let p = N - (N as f64 * 0.04) as u32;
        assert!(p_rarer(N, p) < MIN_OFFERED_PROBABILITY);
        assert!(payout(N, p, Direction::Rarer).is_none());
    }

    #[test]
    fn max_single_step_multiplier_is_19_4x() {
        // The largest payout ever offered sits exactly at the floor.
        let max = HOUSE_RETURN / MIN_OFFERED_PROBABILITY;
        assert!((max - 19.4).abs() < 1e-9);
        // Nothing offered may exceed it.
        for p in 1..=N {
            for dir in [Direction::Rarer, Direction::Commoner] {
                if let Some(m) = payout(N, p, dir) {
                    assert!(m <= max + 1e-9, "p={p} offered {m}x");
                }
            }
        }
    }

    #[test]
    fn every_offered_bet_returns_exactly_97_percent() {
        for p in 1..=N {
            for dir in [Direction::Rarer, Direction::Commoner] {
                if let Some(mult) = payout(N, p, dir) {
                    let ev = probability(N, p, dir) * mult;
                    assert!(
                        (ev - HOUSE_RETURN).abs() < 1e-9,
                        "p={p} {dir:?} has EV {ev}, not {HOUSE_RETURN}"
                    );
                }
            }
        }
    }

    #[test]
    fn at_least_one_direction_is_always_offered() {
        let g = HiLo { n: N };
        for p in 1..=N {
            assert!(!g.offered(p).is_empty(), "p={p} had no playable bet");
        }
    }

    #[test]
    fn draw_excluding_never_returns_the_current_card_and_covers_the_range() {
        let g = HiLo { n: 6 };
        let mut rng = FastRng::new(2);
        let mut seen = [0u32; 7];
        for _ in 0..20_000 {
            let d = g.draw_excluding(&mut rng, 3);
            assert_ne!(d, 3);
            assert!((1..=6).contains(&d));
            seen[d as usize] += 1;
        }
        for q in [1usize, 2, 4, 5, 6] {
            assert!(seen[q] > 3_000, "card {q} under-drawn: {}", seen[q]);
        }
    }

    #[test]
    fn swap_fee_is_zero_edge_in_a_deck_where_every_bet_is_offered() {
        // With all directions offered, best EV is 0.97 everywhere, so a redraw
        // changes nothing and must be free.
        let n = 100;
        for p in 40..=60 {
            assert!(swap_fee(n, p).abs() < 1e-9, "p={p} fee {}", swap_fee(n, p));
        }
    }

    #[test]
    fn measured_per_decision_rtp_matches_theory() {
        let g = HiLo { n: N };
        let mut rng = FastRng::new(77);
        let mut staked = 0.0;
        let mut returned = 0.0;
        for _ in 0..400_000 {
            let p = g.draw_card(&mut rng);
            let offered = g.offered(p);
            let dir = offered[0];
            staked += 1.0;
            returned += g.decide(&mut rng, p, dir).returned;
        }
        let rtp = returned / staked;
        assert!((rtp - 0.97).abs() < 0.01, "measured per-decision RTP {rtp}");
    }
}
