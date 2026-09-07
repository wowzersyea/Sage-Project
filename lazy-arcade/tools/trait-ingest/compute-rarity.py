#!/usr/bin/env python3
"""
Statistical rarity + 0-100 rank assignment (spec Sec. 5.2 item 3).

Rarity is computed the way the spec names it and no other way:

    r_t   = count_t / collection_size          per-trait frequency
    score = sum(1 / r_t) across a token's traits

Tokens are then sorted common -> rare and dropped into 101 equal-population
buckets, giving every Lion a rank in 0..100 where 0 is the most common and 100
the rarest.

Why equal-population buckets rather than `round(percentile)`: the game draws a
RANK uniformly, so the ranks must partition the collection evenly for that draw
to be equivalent to picking a uniformly random Lion. Rounding a percentile
leaves ranks 0 and 100 holding half a bucket each, which would quietly bias the
deck toward the middle.

Two consequences worth stating, because both are load-bearing for Hi/Lo:

  * The rank, not the token, is the game object. Ranks are unique in 0..100 by
    construction, so there are no ties and no push rule is needed -- the same
    property the spec relied on when it used unique ordinals over 10,078.
  * Changing the rarity METHOD changes the odds. Anyone swapping in a
    third-party rarity score must re-verify Hi/Lo, not just re-skin it.

  python3 tools/trait-ingest/compute-rarity.py
"""

import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
COLLECTION = os.path.join(DATA, "collection_traits.json")
OUT = os.path.join(DATA, "rarity.json")

RANKS = 101  # 0..100 inclusive

# Traits that describe the token rather than its appearance would skew the
# score if counted; Lazy Lions metadata has none today, but keep the hook
# explicit so a future field cannot silently join the calculation.
IGNORED_CATEGORIES: set[str] = set()


def main() -> int:
    if not os.path.exists(COLLECTION):
        print(f"missing {COLLECTION} -- run fetch-collection.py first", file=sys.stderr)
        return 2

    tokens = json.load(open(COLLECTION))
    size = len(tokens)
    if size < 1000:
        print(f"only {size} tokens ingested; rarity over a partial collection is "
              f"biased and must not be used", file=sys.stderr)
        return 1

    counts: dict[str, Counter] = {}
    for traits in tokens.values():
        for cat, val in traits.items():
            if cat in IGNORED_CATEGORIES:
                continue
            counts.setdefault(cat, Counter())[val] += 1

    scored = []
    for tid, traits in tokens.items():
        score = 0.0
        for cat, val in traits.items():
            if cat in IGNORED_CATEGORIES:
                continue
            r = counts[cat][val] / size
            score += 1.0 / r
        scored.append((score, int(tid)))

    # Common -> rare. Ties in score are broken by token id so the ordering is
    # deterministic and reproducible across runs.
    scored.sort(key=lambda s: (s[0], s[1]))

    rank_of = {}
    for index, (_score, tid) in enumerate(scored):
        rank_of[tid] = min(RANKS - 1, index * RANKS // size)

    bucket_sizes = Counter(rank_of.values())
    payload = {
        "method": "statistical rarity: sum(1 / (count_t / collection_size))",
        "collectionSize": size,
        "ranks": RANKS,
        "rankOf": {str(k): v for k, v in rank_of.items()},
        "scoreOf": {str(tid): round(score, 4) for score, tid in scored},
        "bucketSizes": {str(k): v for k, v in sorted(bucket_sizes.items())},
    }
    json.dump(payload, open(OUT, "w"))

    print(f"collection size      : {size}")
    print(f"trait categories     : {', '.join(sorted(counts))}")
    print(f"bucket population    : min {min(bucket_sizes.values())}, "
          f"max {max(bucket_sizes.values())} (target {size/RANKS:.1f})")
    rarest = scored[-5:][::-1]
    print("rarest 5             : " + ", ".join(f"#{t} ({s:.0f})" for s, t in rarest))
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
