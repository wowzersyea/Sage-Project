#!/usr/bin/env python3
"""
trait-ingest (spec Sec. 5.2).

Enumerates the operator's holdings on-chain and pulls their metadata, emitting
`owned_traits.json` -- the ONLY legal symbol source for the art pipeline
(spec Sec. 5.3, a licensing constraint).

Deliberately uses public JSON-RPC + an IPFS gateway rather than the OpenSea or
Reservoir APIs: both now require keys, and holdings read straight from the
token contract cannot be stale or filtered by a third party.

Rarity note: `r_t = count_t / 10078` requires trait counts over the FULL
collection, not just the owned subset. Pass --full-collection to walk all
10,078 tokens (slow, thousands of gateway fetches -- run it once and commit
the result). Without it, per-trait rarity is left null rather than computed
from a biased 73-token sample, because a wrong rarity number silently changes
Hi/Lo odds (spec Sec. 5.2 item 3).
"""

import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

RPC = "https://ethereum-rpc.publicnode.com"
IPFS_GATEWAY = "https://ipfs.io/ipfs"
LAZY_LIONS_L1 = "0x8943c7bac1914c9a7aba750bf2b6b09fd21037e0"
COLLECTION_SIZE = 10078
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")


def curl(url, data=None, timeout=60):
    """The sandbox routes HTTPS through an agent proxy that curl honours and
    python's urllib does not, so shell out rather than fight it."""
    cmd = ["curl", "-sS", "-L", "--max-time", str(timeout)]
    if data is not None:
        cmd += ["-X", "POST", "-H", "content-type: application/json", "--data", json.dumps(data)]
    cmd.append(url)
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"curl failed for {url}: {p.stderr.strip()}")
    return p.stdout


def rpc(batch):
    return json.loads(curl(RPC, data=batch))


def owned_token_ids(owner: str) -> list[int]:
    owner_arg = owner.lower().removeprefix("0x").rjust(40, "0")
    balance_call = {
        "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{"to": LAZY_LIONS_L1, "data": "0x70a08231" + "0" * 24 + owner_arg}, "latest"],
    }
    balance = int(rpc([balance_call])[0]["result"], 16)
    print(f"balanceOf({owner}) = {balance} Lions on Ethereum mainnet", file=sys.stderr)

    ids = []
    for start in range(0, balance, 25):
        batch = [
            {"jsonrpc": "2.0", "id": i, "method": "eth_call",
             "params": [{"to": LAZY_LIONS_L1,
                         "data": "0x2f745c59" + "0" * 24 + owner_arg + f"{i:064x}"}, "latest"]}
            for i in range(start, min(start + 25, balance))
        ]
        for r in rpc(batch):
            if "result" not in r:
                raise RuntimeError(f"tokenOfOwnerByIndex failed: {r.get('error')}")
            ids.append(int(r["result"], 16))
    return sorted(set(ids))


def token_uri_base() -> str:
    call = {"jsonrpc": "2.0", "id": 1, "method": "eth_call",
            "params": [{"to": LAZY_LIONS_L1, "data": "0xc87b56dd" + f"{1:064x}"}, "latest"]}
    raw = rpc([call])[0]["result"][2:]
    length = int(raw[64:128], 16)
    uri = bytes.fromhex(raw[128:128 + length * 2]).decode()
    return uri.removeprefix("ipfs://").rsplit("/", 1)[0]


def fetch_metadata(cid: str, token_id: int) -> dict | None:
    for attempt in range(3):
        try:
            body = curl(f"{IPFS_GATEWAY}/{cid}/{token_id}", timeout=45)
            return json.loads(body)
        except Exception:
            if attempt == 2:
                print(f"  token {token_id}: FAILED", file=sys.stderr)
                return None
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--owner", required=True, help="operator wallet (0x...)")
    ap.add_argument("--full-collection", action="store_true",
                    help="walk all 10,078 tokens to compute true trait rarity (slow)")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    os.makedirs(DATA, exist_ok=True)
    cid = token_uri_base()
    print(f"metadata CID: {cid}", file=sys.stderr)

    ids = owned_token_ids(args.owner)
    json.dump(ids, open(os.path.join(DATA, "owned_lion_ids.json"), "w"))

    targets = range(1, COLLECTION_SIZE + 1) if args.full_collection else ids
    print(f"fetching metadata for {len(list(targets))} tokens...", file=sys.stderr)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        metas = list(pool.map(lambda t: (t, fetch_metadata(cid, t)), targets))

    tokens = {}
    trait_counts: dict[str, dict[str, int]] = {}
    for token_id, meta in metas:
        if meta is None:
            continue
        attrs = {a["trait_type"]: a["value"] for a in meta.get("attributes", [])}
        tokens[str(token_id)] = {"id": token_id, "name": meta.get("name"),
                                 "image": meta.get("image"), "traits": attrs}
        for k, v in attrs.items():
            trait_counts.setdefault(k, {}).setdefault(v, 0)
            trait_counts[k][v] += 1

    owned = {t: v for t, v in tokens.items() if int(t) in set(ids)}

    out = {
        "source": "on-chain enumeration + IPFS metadata",
        "collection": LAZY_LIONS_L1,
        "collection_size": COLLECTION_SIZE,
        "operator_wallet": args.owner,
        "owned_count": len(owned),
        "rarity_basis": "FULL_COLLECTION" if args.full_collection else None,
        "trait_counts": trait_counts if args.full_collection else None,
        "owned_tokens": owned,
        # Every distinct (category, value) the operator actually holds. The
        # atlas builder must refuse any symbol outside this set.
        "licensed_traits": sorted(
            {f"{k}::{v}" for tok in owned.values() for k, v in tok["traits"].items()}
        ),
    }
    path = os.path.join(DATA, "owned_traits.json")
    json.dump(out, open(path, "w"), indent=2)
    print(f"wrote {path}: {len(owned)} tokens, "
          f"{len(out['licensed_traits'])} licensed traits", file=sys.stderr)


if __name__ == "__main__":
    main()
