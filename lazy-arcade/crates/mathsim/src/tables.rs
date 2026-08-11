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
    let outer = weights_from(&[
        (SCAT, 4), (P1, 6), (P2, 7), (P3, 8), (P4, 9),
        (M1, 12), (M2, 13), (M3, 14), (M4, 15),
        (L1, 18), (L2, 18), (L3, 18), (L4, 18),
    ]);
    let inner = |wild: u32| {
        weights_from(&[
            (WILD, wild), (SCAT, 4), (P1, 6), (P2, 7), (P3, 8), (P4, 9),
            (M1, 12), (M2, 13), (M3, 14), (M4, 15),
            (L1, 16), (L2, 16), (L3, 16), (L4, 16),
        ])
    };
    StripSpec { weights: [outer, inner(6), inner(8), inner(6), outer] }
}

pub fn pride_pays() -> PayTable {
    let mut p = empty_paytable();
    let set = |p: &mut PayTable, s: u8, v: [f64; 3]| {
        p[s as usize][3] = v[0];
        p[s as usize][4] = v[1];
        p[s as usize][5] = v[2];
    };
    set(&mut p, P1, [0.40, 1.60, 8.00]);
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
    StripSpec { weights: [reel, reel, reel, reel, reel] }
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
    let outer = weights_from(&[
        (P1, 5), (P2, 6), (P3, 7), (P4, 8),
        (M1, 11), (M2, 12), (M3, 13), (M4, 14),
        (L1, 20), (L2, 20), (L3, 21), (L4, 21),
    ]);
    let inner = weights_from(&[
        (WILD, 5), (P1, 5), (P2, 6), (P3, 7), (P4, 8),
        (M1, 11), (M2, 12), (M3, 13), (M4, 14),
        (L1, 19), (L2, 19), (L3, 20), (L4, 20),
    ]);
    StripSpec { weights: [outer, inner, inner, inner, outer] }
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
    set(&mut p, P1, 0.5, [5.0, 25.0, 125.0]);
    set(&mut p, P2, 0.4, [4.0, 20.0, 100.0]);
    set(&mut p, P3, 0.0, [3.0, 15.0, 75.0]);
    set(&mut p, P4, 0.0, [2.5, 12.0, 60.0]);
    set(&mut p, M1, 0.0, [1.5, 6.0, 30.0]);
    set(&mut p, M2, 0.0, [1.2, 5.0, 25.0]);
    set(&mut p, M3, 0.0, [1.0, 4.0, 20.0]);
    set(&mut p, M4, 0.0, [0.8, 3.0, 15.0]);
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
