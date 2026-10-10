pub mod cluster;
pub mod hilo;
pub mod pride;
pub mod vault;

/// One resolved spin, in units of TOTAL BET.
#[derive(Clone, Copy, Debug, Default)]
pub struct SpinOutcome {
    /// Winnings attributable to the base game.
    pub base: f64,
    /// Winnings attributable to the feature (free spins, tumbles, meter).
    pub feature: f64,
    pub feature_triggered: bool,
    /// Pride only: the board filled with Crowns and the NFT was won. Kept OUT
    /// of base/feature deliberately -- it is a fixed prize the coin paytable
    /// cannot express, so folding it into the coin return would corrupt every
    /// figure derived from it, `calibrate` first among them.
    pub nft_won: bool,
}

impl SpinOutcome {
    #[inline]
    pub fn total(&self) -> f64 {
        self.base + self.feature
    }
}

/// Per-game persistent state. Only Trait Vault has any: its Mane Meter
/// carries across spins, which is why spins there are NOT independent and the
/// simulator must run them sequentially (spec Sec. 6.4).
#[derive(Clone, Copy, Debug, Default)]
pub struct GameState {
    pub mane_meter: u32,
}
