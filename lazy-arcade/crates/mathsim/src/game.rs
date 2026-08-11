//! Symbol set, virtual reel strips and paytables (spec Sec. 6.1 / 6.3).

pub const REELS: usize = 5;
pub const ROWS: usize = 4;
pub const CELLS: usize = REELS * ROWS;

pub const WILD: u8 = 0;
pub const SCAT: u8 = 1;
pub const P1: u8 = 2;
pub const M1: u8 = 6;
pub const M4: u8 = 9;
pub const L4: u8 = 13;
pub const NUM_SYMBOLS: usize = 14;

pub const SYMBOL_NAMES: [&str; NUM_SYMBOLS] = [
    "WILD", "SCAT", "P1", "P2", "P3", "P4", "M1", "M2", "M3", "M4", "L1", "L2", "L3", "L4",
];

/// M-tier symbols feed the Mane Meter (spec Sec. 6.4, Trait Vault).
#[inline]
pub fn is_mane_symbol(s: u8) -> bool {
    (M1..=M4).contains(&s)
}

/// Minimum virtual strip length (spec Sec. 6.1).
pub const MIN_STRIP_LEN: usize = 120;

/// Per-reel symbol weights. The optimizer's entire search space.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StripSpec {
    pub weights: [[u32; NUM_SYMBOLS]; REELS],
}

/// Materialized virtual strips.
#[derive(Clone, Debug)]
pub struct Strips {
    pub reels: [Vec<u8>; REELS],
}

impl StripSpec {
    pub fn build(&self) -> Strips {
        let reels: Vec<Vec<u8>> = (0..REELS).map(|r| build_strip(&self.weights[r])).collect();
        for (i, reel) in reels.iter().enumerate() {
            assert!(
                reel.len() >= MIN_STRIP_LEN,
                "reel {i} strip length {} is below the {MIN_STRIP_LEN} minimum",
                reel.len()
            );
        }
        Strips { reels: reels.try_into().expect("REELS entries") }
    }
}

/// Lay out `weights[s]` copies of each symbol across a strip of length
/// `sum(weights)`, spreading each symbol as evenly as the counts allow.
///
/// Even spreading matters: a strip that clumps three P1s together changes the
/// odds of a 4-row window catching multiple P1s on one reel, which moves RTP
/// without moving any weight. Deterministic placement keeps the optimizer's
/// objective a function of the weights alone.
pub fn build_strip(weights: &[u32; NUM_SYMBOLS]) -> Vec<u8> {
    let total: u32 = weights.iter().sum();
    assert!(total > 0, "empty strip");
    let mut placed = [0u32; NUM_SYMBOLS];
    let mut out = Vec::with_capacity(total as usize);

    for i in 1..=total {
        // Largest-remainder: place whichever symbol is furthest behind its
        // ideal share at this point in the strip.
        let mut best = usize::MAX;
        let mut best_debt = f64::NEG_INFINITY;
        for s in 0..NUM_SYMBOLS {
            if weights[s] == 0 || placed[s] >= weights[s] {
                continue;
            }
            let ideal = weights[s] as f64 * (i as f64 / total as f64);
            let debt = ideal - placed[s] as f64;
            if debt > best_debt + 1e-12 {
                best_debt = debt;
                best = s;
            }
        }
        debug_assert!(best != usize::MAX);
        placed[best] += 1;
        out.push(best as u8);
    }
    out
}

impl Strips {
    /// Symbol at `row` of the window whose top row is `stop`. Strips wrap.
    #[inline]
    pub fn at(&self, reel: usize, stop: u32, row: usize) -> u8 {
        let strip = &self.reels[reel];
        strip[(stop as usize + row) % strip.len()]
    }

    #[inline]
    pub fn len(&self, reel: usize) -> u32 {
        self.reels[reel].len() as u32
    }
}

/// `pays[symbol][count]`, expressed as a multiple of TOTAL BET.
/// Index 0..=1 are unused (a win needs at least 2 of a kind); index 2 is only
/// non-zero where a game explicitly pays two-of-a-kind.
pub type PayTable = [[f64; REELS + 1]; NUM_SYMBOLS];

pub fn empty_paytable() -> PayTable {
    [[0.0; REELS + 1]; NUM_SYMBOLS]
}

/// Free-spin wild multipliers add and cap at 10x (spec Sec. 6.4, Pride).
#[inline]
pub fn additive_wild_multiplier(wild_count: u32) -> f64 {
    if wild_count == 0 {
        1.0
    } else {
        (2.0 * wild_count as f64).min(10.0)
    }
}

/// Tumble multiplier ladder 1,2,3,5,8 capping at 8 (spec Sec. 6.4, Cub Cluster).
#[inline]
pub fn tumble_multiplier(chain_index: usize) -> f64 {
    const LADDER: [f64; 5] = [1.0, 2.0, 3.0, 5.0, 8.0];
    LADDER[chain_index.min(LADDER.len() - 1)]
}

/// The 40 fixed paylines of Trait Vault, as row indices per reel.
///
/// Generated deterministically rather than hand-typed: the four flat lines
/// first, then every row path that steps by at most one row between adjacent
/// reels, in lexicographic order, truncated to 40. Documented here because a
/// silent change to this table changes the game's RTP.
pub fn paylines_40() -> Vec<[usize; REELS]> {
    let mut lines: Vec<[usize; REELS]> = Vec::new();
    for r in 0..ROWS {
        lines.push([r; REELS]);
    }
    let mut path = [0usize; REELS];
    fn walk(
        pos: usize,
        path: &mut [usize; REELS],
        lines: &mut Vec<[usize; REELS]>,
    ) {
        if lines.len() >= 40 {
            return;
        }
        if pos == REELS {
            let flat = path.iter().all(|&r| r == path[0]);
            if !flat {
                lines.push(*path);
            }
            return;
        }
        let start = if pos == 0 { 0 } else { path[pos - 1].saturating_sub(1) };
        let end = if pos == 0 { ROWS - 1 } else { (path[pos - 1] + 1).min(ROWS - 1) };
        for r in start..=end {
            path[pos] = r;
            walk(pos + 1, path, lines);
            if lines.len() >= 40 {
                return;
            }
        }
    }
    walk(0, &mut path, &mut lines);
    assert_eq!(lines.len(), 40, "payline generator must yield exactly 40 lines");
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_strip_honours_weights_exactly() {
        let mut w = [0u32; NUM_SYMBOLS];
        w[WILD as usize] = 3;
        w[P1 as usize] = 10;
        w[L4 as usize] = 47;
        let strip = build_strip(&w);
        assert_eq!(strip.len(), 60);
        for s in 0..NUM_SYMBOLS {
            let n = strip.iter().filter(|&&x| x as usize == s).count() as u32;
            assert_eq!(n, w[s], "symbol {s} count mismatch");
        }
    }

    #[test]
    fn build_strip_spreads_rather_than_clumps() {
        // 1 wild in 120 positions, 20 P1: the P1s must not all be adjacent.
        let mut w = [0u32; NUM_SYMBOLS];
        w[P1 as usize] = 20;
        w[L4 as usize] = 100;
        let strip = build_strip(&w);
        let mut longest_run = 0;
        let mut run = 0;
        for &s in &strip {
            if s == P1 {
                run += 1;
                longest_run = longest_run.max(run);
            } else {
                run = 0;
            }
        }
        assert!(longest_run <= 1, "P1 clumped into a run of {longest_run}");
    }

    #[test]
    fn build_strip_is_deterministic() {
        let mut w = [0u32; NUM_SYMBOLS];
        for (i, slot) in w.iter_mut().enumerate() {
            *slot = (i as u32 % 7) + 3;
        }
        assert_eq!(build_strip(&w), build_strip(&w));
    }

    #[test]
    fn paylines_are_distinct_and_well_formed() {
        let lines = paylines_40();
        assert_eq!(lines.len(), 40);
        let mut seen = std::collections::HashSet::new();
        for l in &lines {
            assert!(seen.insert(*l), "duplicate payline {l:?}");
            for r in l {
                assert!(*r < ROWS);
            }
            for w in l.windows(2) {
                assert!(w[0].abs_diff(w[1]) <= 1, "payline {l:?} jumps more than one row");
            }
        }
    }

    #[test]
    fn wild_multiplier_adds_and_caps() {
        assert_eq!(additive_wild_multiplier(0), 1.0);
        assert_eq!(additive_wild_multiplier(1), 2.0);
        assert_eq!(additive_wild_multiplier(3), 6.0);
        assert_eq!(additive_wild_multiplier(5), 10.0);
        assert_eq!(additive_wild_multiplier(9), 10.0, "must cap at 10x");
    }

    #[test]
    fn tumble_ladder_caps_at_eight() {
        assert_eq!(tumble_multiplier(0), 1.0);
        assert_eq!(tumble_multiplier(4), 8.0);
        assert_eq!(tumble_multiplier(40), 8.0);
    }
}
