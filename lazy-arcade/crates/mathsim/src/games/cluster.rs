//! GAME 2 -- CUB CLUSTER: 5x4 cluster pays with tumbles (spec Sec. 6.4).
//!
//! A cluster is 5+ orthogonally adjacent matching symbols. Winning clusters
//! vanish, the symbols above them fall, fresh symbols enter from the top, and
//! the grid is re-evaluated. The multiplier climbs 1,2,3,5,8 across a tumble
//! chain and caps at 8x.
//!
//! Wild handling: a wild joins the cluster of every symbol it touches. Several
//! shipped cluster games behave this way and it is materially more generous
//! than forcing a wild to pick one cluster -- which is precisely why it must be
//! stated here rather than discovered later. The optimizer prices it in.

use crate::game::*;
use crate::games::SpinOutcome;
use crate::rng::Rng;

pub const GAME_ID: &str = "cubcluster";
pub const MIN_CLUSTER: usize = 5;

/// `pays[symbol][cluster_size]`, as a multiple of TOTAL BET.
pub type ClusterPays = [[f64; CELLS + 1]; NUM_SYMBOLS];

pub fn empty_cluster_pays() -> ClusterPays {
    [[0.0; CELLS + 1]; NUM_SYMBOLS]
}

pub struct CubCluster {
    pub strips: Strips,
    pub pays: ClusterPays,
}

type Grid = [[u8; ROWS]; REELS];

impl CubCluster {
    pub fn new(spec: &StripSpec, pays: ClusterPays) -> Self {
        CubCluster { strips: spec.build(), pays }
    }

    pub fn spin(&self, rng: &mut impl Rng) -> SpinOutcome {
        let mut grid = [[0u8; ROWS]; REELS];
        for reel in 0..REELS {
            let stop = rng.below(self.strips.len(reel));
            for row in 0..ROWS {
                grid[reel][row] = self.strips.at(reel, stop, row);
            }
        }

        let mut out = SpinOutcome::default();
        let mut chain = 0usize;

        loop {
            let mut remove = [[false; ROWS]; REELS];
            let win = self.evaluate(&grid, &mut remove);
            if win == 0.0 {
                break;
            }
            let paid = win * tumble_multiplier(chain);
            if chain == 0 {
                out.base += paid;
            } else {
                out.feature += paid;
                out.feature_triggered = true;
            }
            self.tumble(&mut grid, &remove, rng);
            chain += 1;
        }
        out
    }

    /// Returns the raw (pre-multiplier) win and marks every cell to clear.
    fn evaluate(&self, grid: &Grid, remove: &mut [[bool; ROWS]; REELS]) -> f64 {
        let mut total = 0.0;

        for s in P1..NUM_SYMBOLS as u8 {
            let mut visited = [[false; ROWS]; REELS];
            for reel in 0..REELS {
                for row in 0..ROWS {
                    if visited[reel][row] || !matches(grid[reel][row], s) {
                        continue;
                    }
                    // Flood fill this component.
                    let mut stack = vec![(reel, row)];
                    let mut component = Vec::new();
                    let mut naturals = 0;
                    visited[reel][row] = true;
                    while let Some((c, r)) = stack.pop() {
                        component.push((c, r));
                        if grid[c][r] == s {
                            naturals += 1;
                        }
                        for (nc, nr) in neighbours(c, r) {
                            if !visited[nc][nr] && matches(grid[nc][nr], s) {
                                visited[nc][nr] = true;
                                stack.push((nc, nr));
                            }
                        }
                    }
                    // A component of pure wilds is not a win for `s`; without
                    // this check every wild blob would pay once per symbol.
                    if naturals == 0 || component.len() < MIN_CLUSTER {
                        continue;
                    }
                    let pay = self.pays[s as usize][component.len().min(CELLS)];
                    if pay == 0.0 {
                        continue;
                    }
                    total += pay;
                    for (c, r) in component {
                        remove[c][r] = true;
                    }
                }
            }
        }
        total
    }

    /// Clear marked cells, let survivors fall, refill from the top.
    fn tumble(&self, grid: &mut Grid, remove: &[[bool; ROWS]; REELS], rng: &mut impl Rng) {
        for reel in 0..REELS {
            let mut column: Vec<u8> = (0..ROWS)
                .filter(|&row| !remove[reel][row])
                .map(|row| grid[reel][row])
                .collect();
            let missing = ROWS - column.len();
            let strip = &self.strips.reels[reel];
            let mut fresh: Vec<u8> = (0..missing)
                .map(|_| strip[rng.below(strip.len() as u32) as usize])
                .collect();
            fresh.extend(column.drain(..));
            for (row, sym) in fresh.into_iter().enumerate() {
                grid[reel][row] = sym;
            }
        }
    }
}

#[inline]
fn matches(cell: u8, s: u8) -> bool {
    cell == s || cell == WILD
}

fn neighbours(reel: usize, row: usize) -> impl Iterator<Item = (usize, usize)> {
    let mut out = Vec::with_capacity(4);
    if reel > 0 {
        out.push((reel - 1, row));
    }
    if reel + 1 < REELS {
        out.push((reel + 1, row));
    }
    if row > 0 {
        out.push((reel, row - 1));
    }
    if row + 1 < ROWS {
        out.push((reel, row + 1));
    }
    out.into_iter()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::FastRng;

    fn game_with(pay_for_size: f64) -> CubCluster {
        let mut pays = empty_cluster_pays();
        for size in MIN_CLUSTER..=CELLS {
            pays[P1 as usize][size] = pay_for_size * size as f64;
        }
        let mut weights = [[0u32; NUM_SYMBOLS]; REELS];
        for w in weights.iter_mut() {
            w[P1 as usize] = 30;
            w[L4 as usize] = 90;
            w[WILD as usize] = 5;
        }
        CubCluster::new(&StripSpec { weights }, pays)
    }

    #[test]
    fn four_adjacent_is_not_a_cluster() {
        let g = game_with(1.0);
        let mut grid = [[L4; ROWS]; REELS];
        for reel in 0..4 {
            grid[reel][0] = P1;
        }
        let mut remove = [[false; ROWS]; REELS];
        assert_eq!(g.evaluate(&grid, &mut remove), 0.0);
    }

    #[test]
    fn five_adjacent_pays_and_is_marked_for_removal() {
        let g = game_with(1.0);
        let mut grid = [[L4; ROWS]; REELS];
        for reel in 0..5 {
            grid[reel][0] = P1;
        }
        let mut remove = [[false; ROWS]; REELS];
        assert_eq!(g.evaluate(&grid, &mut remove), 5.0);
        for reel in 0..5 {
            assert!(remove[reel][0], "winning cell not cleared");
            assert!(!remove[reel][1]);
        }
    }

    #[test]
    fn diagonal_adjacency_does_not_connect() {
        let g = game_with(1.0);
        let mut grid = [[L4; ROWS]; REELS];
        // A diagonal staircase of 5 -- orthogonally these are all separate.
        for i in 0..4 {
            grid[i][i] = P1;
        }
        grid[4][3] = P1;
        let mut remove = [[false; ROWS]; REELS];
        assert_eq!(g.evaluate(&grid, &mut remove), 0.0);
    }

    #[test]
    fn a_pure_wild_blob_pays_nothing() {
        let g = game_with(1.0);
        let mut grid = [[L4; ROWS]; REELS];
        for reel in 0..5 {
            grid[reel][0] = WILD;
        }
        let mut remove = [[false; ROWS]; REELS];
        assert_eq!(
            g.evaluate(&grid, &mut remove),
            0.0,
            "wilds with no natural symbol must not pay"
        );
    }

    #[test]
    fn wilds_complete_a_cluster() {
        let g = game_with(1.0);
        let mut grid = [[L4; ROWS]; REELS];
        for reel in 0..4 {
            grid[reel][0] = P1;
        }
        grid[4][0] = WILD;
        let mut remove = [[false; ROWS]; REELS];
        assert_eq!(g.evaluate(&grid, &mut remove), 5.0);
    }

    #[test]
    fn tumble_drops_survivors_and_refills_the_top() {
        let g = game_with(1.0);
        let mut grid = [[L4; ROWS]; REELS];
        grid[0][3] = P1; // bottom of reel 1 survives
        let mut remove = [[false; ROWS]; REELS];
        remove[0][0] = true;
        remove[0][1] = true;
        let mut rng = FastRng::new(9);
        g.tumble(&mut grid, &remove, &mut rng);
        assert_eq!(grid[0][3], P1, "survivor should stay at the bottom");
        // Two cells were cleared, so exactly two fresh symbols entered on top.
        assert_eq!(grid[0][2], L4);
    }

    #[test]
    fn a_spin_always_terminates() {
        let g = game_with(0.1);
        let mut rng = FastRng::new(4);
        for _ in 0..5_000 {
            let _ = g.spin(&mut rng);
        }
    }
}
