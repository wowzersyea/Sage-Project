//! Baseline strip weights and paytables.
//!
//! These are STARTING POINTS for `mathsim optimize`, not shipped math. The
//! paytable shape (which symbol pays what, relative to the others) is a design
//! choice made here; the RTP is not. RTP comes out of the strip-weight search
//! and is only real once `mathsim simulate` confirms it at 100M spins
//! (spec Sec. 0 rule 2).

use crate::game::*;
use crate::games::cluster::{empty_cluster_pays, ClusterPays};

fn weights_from(pairs: &[(u8, u32)]) -> [u32; NUM_SYMBOLS] {
    let mut w = [0u32; NUM_SYMBOLS];
    for &(sym, n) in pairs {
        w[sym as usize] = n;
    }
    w
}

const P2: u8 = 3;
const P3: u8 = 4;
const P4: u8 = 5;
const M2: u8 = 7;
const M3: u8 = 8;
const L1: u8 = 10;
const L2: u8 = 11;
const L3: u8 = 12;

/* ------------------------------------------------------------------ */
/* PRIDE                                                               */
/* ------------------------------------------------------------------ */

pub fn pride_strips() -> StripSpec {
    // Wild is absent from reels 1 and 5 by construction (spec Sec. 6.4).
    //
    // P1 carries NO strip weight in Pride. The Crown arrives only as a full-reel
    // stack, drawn per reel in pride::draw_grid -- see CROWN_STACK_NUM. Leaving
    // a weight here would put loose single Crowns on the reels alongside the
    // stacks, which both breaks the mechanic's read and quietly changes the
    // return away from what the weights file was calibrated against.
    let outer = weights_from(&[
        (SCAT, 4), (P2, 7), (P3, 8), (P4, 9),
        (M1, 12), (M2, 13), (M3, 14), (M4, 15),
        (L1, 18), (L2, 18), (L3, 18), (L4, 18),
    ]);
    let inner = |wild: u32| {
        weights_from(&[
            (WILD, wild), (SCAT, 4), (P2, 7), (P3, 8), (P4, 9),
            (M1, 12), (M2, 13), (M3, 14), (M4, 15),
            (L1, 16), (L2, 16), (L3, 16), (L4, 16),
        ])
    };
    StripSpec { weights: vec![outer, inner(6), inner(8), inner(6), outer] }
}

pub fn pride_pays() -> PayTable {
    let mut p = empty_paytable();
    let set = |p: &mut PayTable, s: u8, v: [f64; 3]| {
        p[s as usize][3] = v[0];
        p[s as usize][4] = v[1];
        p[s as usize][5] = v[2];
    };
    // The Crown pays far less PER WAY than its tier would suggest, because it
    // never arrives alone: a crowned reel contributes four rows, so three
    // crowned reels is already 64 ways and four is 256. The old numbers were
    // set for a symbol that landed one row at a time, and carried straight over
    // they took the volatility index to 10.6 against a 5.5 ceiling. The stack
    // supplies the ways; the paytable no longer has to.
    set(&mut p, P1, [0.10, 0.35, 1.40]);
    set(&mut p, P2, [0.30, 1.20, 6.00]);
    set(&mut p, P3, [0.24, 0.90, 4.50]);
    set(&mut p, P4, [0.20, 0.70, 3.50]);
    set(&mut p, M1, [0.12, 0.40, 1.60]);
    set(&mut p, M2, [0.10, 0.32, 1.30]);
    set(&mut p, M3, [0.08, 0.26, 1.05]);
    set(&mut p, M4, [0.07, 0.22, 0.85]);
    set(&mut p, L1, [0.05, 0.14, 0.55]);
    set(&mut p, L2, [0.04, 0.12, 0.45]);
    set(&mut p, L3, [0.035, 0.10, 0.38]);
    set(&mut p, L4, [0.03, 0.08, 0.32]);
    set(&mut p, SCAT, [1.0, 3.0, 20.0]);
    p
}

/* ------------------------------------------------------------------ */
/* CUB CLUSTER                                                         */
/* ------------------------------------------------------------------ */

/// Cub Cluster deliberately runs a REDUCED symbol set: wild plus six paying
/// symbols, not the full thirteen.
///
/// This is forced by geometry, not taste. On a 20-cell grid a 5-cell
/// orthogonal cluster is already a rare event; spreading thirteen symbols over
/// those cells drives the hit rate to ~0.6%, three orders of magnitude short of
/// the 44% target, and no weighting fixes it. Six symbols concentrate the grid
/// enough for clusters to form at a playable rate. Symbols left at weight zero
/// stay zero -- the optimizer will not reintroduce them.
pub fn cluster_strips() -> StripSpec {
    let reel = weights_from(&[
        (WILD, 8), (P1, 18), (P2, 20), (M1, 26), (M2, 28), (L1, 32), (L2, 34),
    ]);
    StripSpec { weights: vec![reel, reel, reel, reel, reel] }
}

/// Cluster pays grow super-linearly with size; the ladder below is the shape,
/// `base` scales it per symbol tier.
pub fn cluster_pays() -> ClusterPays {
    const GROWTH: [f64; 16] = [
        1.0, 1.6, 2.5, 4.0, 6.0, 9.0, 13.0, 18.0, 25.0, 34.0, 45.0, 60.0, 80.0, 105.0, 140.0,
        180.0,
    ];
    let bases: [(u8, f64); 12] = [
        (P1, 0.50), (P2, 0.40), (P3, 0.32), (P4, 0.26),
        (M1, 0.16), (M2, 0.13), (M3, 0.11), (M4, 0.09),
        (L1, 0.06), (L2, 0.05), (L3, 0.045), (L4, 0.04),
    ];
    let mut pays = empty_cluster_pays();
    for (sym, base) in bases {
        for size in 5..=CELLS {
            pays[sym as usize][size] = base * GROWTH[size - 5];
        }
    }
    pays
}

/* ------------------------------------------------------------------ */
/* TRAIT VAULT                                                         */
/* ------------------------------------------------------------------ */

pub fn vault_strips() -> StripSpec {
    // SCAT appears on every reel now. The Mane Meter needed no scatter -- it
    // counted M-tier symbols instead -- so these strips carried none at all.
    // Lion's Share is scatter-triggered, and a scatter-triggered feature with
    // zero scatter weight simply never fires.
    //
    // Weight 8 was tried and triggered 1 spin in 16. Ten free spins that often
    // means most spins played are free spins, and the feature carried 58% of
    // the return before a single multiplier orb landed -- there was no orb
    // probability that could bring the split back to a third. The trigger rate,
    // not the orb table, is the lever for that.
    let outer = weights_from(&[
        (SCAT, 5), (P1, 5), (P2, 6), (P3, 7), (P4, 8),
        (M1, 11), (M2, 12), (M3, 13), (M4, 14),
        (L1, 18), (L2, 18), (L3, 19), (L4, 19),
    ]);
    let inner = weights_from(&[
        (WILD, 5), (SCAT, 5), (P1, 5), (P2, 6), (P3, 7), (P4, 8),
        (M1, 11), (M2, 12), (M3, 13), (M4, 14),
        (L1, 17), (L2, 17), (L3, 18), (L4, 18),
    ]);
    StripSpec { weights: vec![outer, inner, inner, inner, outer] }
}

/// Per-LINE-bet pays. Two-of-a-kind on the two top premiums is what lifts this
/// game's hit frequency toward its 48% target without adding variance.
pub fn vault_pays() -> PayTable {
    let mut p = empty_paytable();
    let set = |p: &mut PayTable, s: u8, two: f64, v: [f64; 3]| {
        p[s as usize][2] = two;
        p[s as usize][3] = v[0];
        p[s as usize][4] = v[1];
        p[s as usize][5] = v[2];
    };
    // Two-of-a-kind runs down through the mids, not just the top two.
    //
    // Hit frequency is a property of paytable SHAPE -- which symbols pay at
    // which count -- and cannot be reached by moving strip weights, which is
    // why the optimiser kept landing at 0.17 against a 0.44 target however long
    // it searched. Paying two-of-a-kind on the eight higher symbols is the lever
    // that actually moves it.
    //
    // The lows deliberately stay at zero. Extending it to them as well would
    // push hit frequency past 0.6, and nearly all of the added "wins" would pay
    // less than the stake -- a loss dressed as a win, which is a dark pattern
    // and not something this game needs to feel generous.
    set(&mut p, P1, 0.50, [5.0, 25.0, 125.0]);
    set(&mut p, P2, 0.40, [4.0, 20.0, 100.0]);
    set(&mut p, P3, 0.35, [3.0, 15.0, 75.0]);
    set(&mut p, P4, 0.30, [2.5, 12.0, 60.0]);
    set(&mut p, M1, 0.25, [1.5, 6.0, 30.0]);
    set(&mut p, M2, 0.20, [1.2, 5.0, 25.0]);
    set(&mut p, M3, 0.18, [1.0, 4.0, 20.0]);
    set(&mut p, M4, 0.15, [0.8, 3.0, 15.0]);
    set(&mut p, L1, 0.0, [0.5, 2.0, 10.0]);
    set(&mut p, L2, 0.0, [0.4, 1.6, 8.0]);
    set(&mut p, L3, 0.0, [0.35, 1.4, 7.0]);
    set(&mut p, L4, 0.0, [0.3, 1.2, 6.0]);
    p
}

/// Starting coin-land probability for the Hold and Win. Tuned by the optimizer
/// alongside the strips because it, not the strips, sets the meter's share of
/// the RTP budget.
pub const VAULT_COIN_PROBABILITY: f64 = 0.030;

/* ------------------------------------------------------------------ */
/* HIGH PROFILE                                                        */
/* ------------------------------------------------------------------ */
/* Starting points for the high-volatility profile. Same rule as above: the
   SHAPE is chosen here, the level comes from `calibrate`, and nothing is real
   until `simulate` confirms it at a spin count derived from the game's own
   measured volatility. The scatter weights are set for a bonus roughly one
   spin in 300 to 450, the reference range. */

pub fn pride_high_strips() -> StripSpec {
    let outer = weights_from(&[
        (SCAT, 3), (P2, 7), (P3, 8), (P4, 9),
        (M1, 12), (M2, 13), (M3, 14), (M4, 15),
        (L1, 18), (L2, 18), (L3, 18), (L4, 18),
    ]);
    let inner = |wild: u32, scat: u32| {
        weights_from(&[
            (WILD, wild), (SCAT, scat), (P2, 7), (P3, 8), (P4, 9),
            (M1, 12), (M2, 13), (M3, 14), (M4, 15),
            (L1, 16), (L2, 16), (L3, 16), (L4, 16),
        ])
    };
    // Reel 3 carries one scatter fewer: 3 on every reel triggered 1 in 273,
    // 2 on every reel 1 in 876.
    StripSpec { weights: vec![outer, inner(6, 3), inner(8, 2), inner(6, 3), outer] }
}

/// Pride's shape carries straight over: the Crown pays little per way because
/// it only ever arrives as a stack, and the stack supplies the ways.
pub fn pride_high_pays() -> PayTable {
    pride_pays()
}

/// Seven reels, six paying symbols and the scatter. No wild.
pub fn cluster_high_strips() -> StripSpec {
    let reel = weights_from(&[
        (SCAT, 1), (P1, 31), (P2, 32), (M1, 33), (M2, 34), (L1, 35), (L2, 36),
    ]);
    StripSpec { weights: vec![reel; crate::games::cluster_high::C7_REELS] }
}

/// Cluster pays by size, 5 to 15+, in the reference's shape: steep enough that
/// a 15-cell cluster of a premium is a big hit before any spot multiplies it.
pub fn cluster_high_pays() -> crate::games::cluster_high::ClusterPaysHigh {
    use crate::games::cluster_high::{empty_pays, MIN_CLUSTER, PAY_SIZE_CAP};
    const GROWTH: [f64; 11] = [1.0, 1.5, 2.2, 3.2, 4.5, 6.5, 9.0, 13.0, 18.0, 25.0, 35.0];
    let bases: [(u8, f64); 6] = [(P1, 1.0), (P2, 0.75), (M1, 0.5), (M2, 0.4), (L1, 0.25), (L2, 0.2)];
    let mut pays = empty_pays();
    for (sym, base) in bases {
        for size in MIN_CLUSTER..=PAY_SIZE_CAP {
            pays[sym as usize][size] = base * GROWTH[size - MIN_CLUSTER];
        }
    }
    pays
}

pub fn vault_high_strips() -> StripSpec {
    let outer = weights_from(&[
        (SCAT, 2), (P1, 5), (P2, 6), (P3, 7), (P4, 8),
        (M1, 11), (M2, 12), (M3, 13), (M4, 14),
        (L1, 18), (L2, 18), (L3, 19), (L4, 19),
    ]);
    let inner = weights_from(&[
        (WILD, 5), (SCAT, 3), (P1, 5), (P2, 6), (P3, 7), (P4, 8),
        (M1, 11), (M2, 12), (M3, 13), (M4, 14),
        (L1, 17), (L2, 17), (L3, 18), (L4, 18),
    ]);
    StripSpec { weights: vec![outer, inner, inner, inner, outer] }
}

/// Per-LINE-bet pays. Two-of-a-kind pays on the four premiums only -- enough
/// to lift the hit rate into the reference's 1-in-4-to-7 range for line games
/// without the low profile's flood of sub-stake wins.
pub fn vault_high_pays() -> PayTable {
    let mut p = empty_paytable();
    let set = |p: &mut PayTable, s: u8, v: [f64; 3]| {
        p[s as usize][3] = v[0];
        p[s as usize][4] = v[1];
        p[s as usize][5] = v[2];
    };
    for (s, two) in [(P1, 0.5), (P2, 0.4), (P3, 0.3), (P4, 0.25)] {
        p[s as usize][2] = two;
    }
    set(&mut p, P1, [6.0, 30.0, 150.0]);
    set(&mut p, P2, [5.0, 24.0, 120.0]);
    set(&mut p, P3, [4.0, 18.0, 90.0]);
    set(&mut p, P4, [3.0, 14.0, 70.0]);
    set(&mut p, M1, [2.0, 7.0, 35.0]);
    set(&mut p, M2, [1.6, 6.0, 28.0]);
    set(&mut p, M3, [1.3, 5.0, 22.0]);
    set(&mut p, M4, [1.0, 4.0, 18.0]);
    set(&mut p, L1, [0.6, 2.4, 12.0]);
    set(&mut p, L2, [0.5, 2.0, 10.0]);
    set(&mut p, L3, [0.45, 1.7, 8.5]);
    set(&mut p, L4, [0.4, 1.5, 7.5]);
    p
}

pub const VAULT_HIGH_ORB_PROBABILITY: f64 = 0.05;
