//! Outcome derivation (spec Sec. 3.2), implemented literally.
//!
//! ```text
//! rawBytes = HMAC_SHA256(key = serverSeed, msg = "<clientSeed>:<nonce>:<gameId>")
//!   extend  = HMAC_SHA256(serverSeed, "<clientSeed>:<nonce>:<gameId>:<counter>")
//! ```
//! Block 0 carries no `:<counter>` suffix; block k >= 1 carries `:k`. Uniform
//! integers come from rejection sampling on 4-byte big-endian chunks -- never
//! modulo, which would bias every reel stop toward low indices.

use crate::sha256::hmac_sha256;

/// A source of uniform integers.
///
/// Two implementations exist and the distinction matters:
///   * [`HmacRng`] is the production path, byte-identical to the TS engine and
///     to what a player can replay on /verify. Every published RTP figure is
///     measured through this.
///   * [`FastRng`] is a plain xorshift used only to make the strip-weight
///     search tractable. It never produces a number a player sees, and no
///     result measured through it may be quoted as an RTP.
pub trait Rng {
    /// Uniform in [0, n). Panics if n == 0.
    fn below(&mut self, n: u32) -> u32;
}

pub struct HmacRng {
    server_seed: Vec<u8>,
    prefix: String,
    block: [u8; 32],
    /// Byte cursor inside `block`.
    pos: usize,
    /// Index of the block currently held. 0 means the no-suffix block.
    block_index: u64,
    primed: bool,
}

impl HmacRng {
    pub fn new(server_seed: &[u8], client_seed: &str, nonce: u64, game_id: &str) -> Self {
        HmacRng {
            server_seed: server_seed.to_vec(),
            prefix: format!("{}:{}:{}", client_seed, nonce, game_id),
            block: [0u8; 32],
            pos: 32,
            block_index: 0,
            primed: false,
        }
    }

    fn refill(&mut self) {
        let msg = if !self.primed {
            self.primed = true;
            self.prefix.clone()
        } else {
            self.block_index += 1;
            format!("{}:{}", self.prefix, self.block_index)
        };
        self.block = hmac_sha256(&self.server_seed, msg.as_bytes());
        self.pos = 0;
    }

    fn next_u32(&mut self) -> u32 {
        if self.pos + 4 > 32 {
            self.refill();
        }
        let b = &self.block[self.pos..self.pos + 4];
        self.pos += 4;
        u32::from_be_bytes([b[0], b[1], b[2], b[3]])
    }
}

impl Rng for HmacRng {
    fn below(&mut self, n: u32) -> u32 {
        uniform_below(n, || self.next_u32())
    }
}

/// Rejection sampling shared by both RNGs so the acceptance rule cannot drift
/// between the production path and the search path.
#[inline]
pub fn uniform_below(n: u32, mut next: impl FnMut() -> u32) -> u32 {
    assert!(n > 0, "uniform_below(0) is undefined");
    if n == 1 {
        return 0;
    }
    let n64 = n as u64;
    let span = 1u64 << 32;
    // Largest multiple of n that fits in u32 space. Values at or above this
    // are rejected; keeping them would over-represent [0, span % n).
    let limit = span - (span % n64);
    loop {
        let x = next() as u64;
        if x < limit {
            return (x % n64) as u32;
        }
    }
}

/// xorshift128+ -- search-only, see [`Rng`].
pub struct FastRng {
    s0: u64,
    s1: u64,
}

impl FastRng {
    pub fn new(seed: u64) -> Self {
        // SplitMix64 to spread a small seed across the full state.
        let mut z = seed.wrapping_add(0x9E3779B97F4A7C15);
        let mut next = || {
            z = z.wrapping_add(0x9E3779B97F4A7C15);
            let mut x = z;
            x = (x ^ (x >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
            x = (x ^ (x >> 27)).wrapping_mul(0x94D049BB133111EB);
            x ^ (x >> 31)
        };
        let a = next();
        let b = next();
        FastRng { s0: a | 1, s1: b | 1 }
    }

    #[inline]
    fn next_u64(&mut self) -> u64 {
        let mut x = self.s0;
        let y = self.s1;
        self.s0 = y;
        x ^= x << 23;
        self.s1 = x ^ y ^ (x >> 17) ^ (y >> 26);
        self.s1.wrapping_add(y)
    }
}

impl Rng for FastRng {
    #[inline]
    fn below(&mut self, n: u32) -> u32 {
        uniform_below(n, || (self.next_u64() >> 32) as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejection_sampling_is_unbiased_for_a_hostile_modulus() {
        // n = 3 divides 2^32 with remainder 1, so naive modulo would skew.
        // Over a large sample the three buckets must stay within noise.
        let mut rng = FastRng::new(1);
        let mut counts = [0u64; 3];
        let n = 3_000_000u64;
        for _ in 0..n {
            counts[rng.below(3) as usize] += 1;
        }
        for c in counts {
            let dev = (c as f64 / n as f64) - (1.0 / 3.0);
            assert!(dev.abs() < 0.002, "bucket deviation {dev} too large: {counts:?}");
        }
    }

    #[test]
    fn below_one_is_always_zero() {
        let mut rng = FastRng::new(7);
        for _ in 0..100 {
            assert_eq!(rng.below(1), 0);
        }
    }

    #[test]
    fn hmac_stream_is_reproducible_and_block_boundaries_advance() {
        let seed = [0xABu8; 32];
        let draw = |count: usize| {
            let mut r = HmacRng::new(&seed, "player-client-seed", 42, "pride");
            (0..count).map(|_| r.below(1000)).collect::<Vec<_>>()
        };
        let a = draw(64);
        let b = draw(64);
        assert_eq!(a, b, "same seed triple must replay identically");
        // 64 draws spans several 32-byte blocks; if refill were broken we would
        // see a 8-value cycle.
        assert!(a[..8] != a[8..16], "stream appears to repeat per block");
    }
}
