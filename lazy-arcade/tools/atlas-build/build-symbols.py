#!/usr/bin/env python3
"""
Symbol art builder (spec Sec. 5.2 step 5 / Sec. 5.3).

Builds slot symbol tiles from the operator's OWNED Lions and Cubs and injects
them into play/index.html as inline data URIs (the bench stays self-contained).

Two things make the licensing constraint structural rather than a convention:

  * every source token is looked up in owned_traits.json / owned_cubs.json --
    there is no code path that reaches a token the operator does not hold; and
  * trait symbols are selected BY TRAIT NAME. Ask for "Headgear::Crown" and the
    builder finds an owned token wearing one, or fails the build. It cannot
    silently fall back to art from a Lion nobody owns.

Symbol tiers follow spec Sec. 6.3: premiums are whole characters, mids and lows
are trait crops. Lazy Lions and Cubs are framed consistently enough that one box
per trait region works across both collections.

WILD, SCATTER and the Lazy drinks are NOT built here -- they are original SVG
drawn in the page. WILD because the gate blocks it (no Signature Series owned),
the rest because they are project artwork rather than collection traits.

  python3 tools/atlas-build/build-symbols.py
"""

import base64
import io
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFile

Image.MAX_IMAGE_PIXELS = None
ImageFile.LOAD_TRUNCATED_IMAGES = True

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
INGEST = os.path.join(ROOT, "tools", "trait-ingest", "data")
CACHE = os.path.join(HERE, "cache")
PAGE = os.path.join(ROOT, "play", "index.html")
SYMBOLS = os.path.join(ROOT, "packages", "assets", "symbols.json")
GATEWAYS = ["https://ipfs.io/ipfs", "https://dweb.link/ipfs", "https://gateway.pinata.cloud/ipfs"]

TILE = 240
KEY = (1, 254, 3)

# Crop boxes as fractions of the square source. A cigar sticks out sideways and
# a Hawaiian shirt runs to the frame edge, so those boxes are deliberately wide.
# Lions and Cubs are NOT framed alike: a Cub sits lower and smaller in frame,
# so the Lion boxes land on empty background above its head. Measured per
# collection rather than assumed shared.
REGION = {
    "lion": {
        "character": (0.11, 0.02, 0.89, 0.80),
        # Head and shoulders. `character` stops at 80% height, which is above the
        # bodygear line -- fine when the trait naming the symbol is worn on the
        # head, useless when it is a coat. The Leopard Fur Coat lion cropped to
        # `character` is just a lion in sunglasses; the trait it is named for is
        # below the cut. `bust` runs to the frame edge so the garment is in shot.
        "bust":      (0.06, 0.06, 0.94, 1.00),
        "headgear":  (0.18, 0.02, 0.82, 0.36),
        "eyes":      (0.22, 0.32, 0.80, 0.53),
        "mouth":     (0.14, 0.42, 0.92, 0.76),
        "bodygear":  (0.06, 0.66, 0.94, 1.00),
    },
    "cub": {
        "character": (0.16, 0.24, 0.84, 0.94),
        "headgear":  (0.24, 0.28, 0.76, 0.54),
        "eyes":      (0.28, 0.44, 0.72, 0.64),
        "mouth":     (0.26, 0.54, 0.74, 0.76),
        "bodygear":  (0.12, 0.72, 0.88, 1.00),
    },
}

# (symbol, collection, region, trait or None, note)
# `trait` picks an owned token wearing it; None means "any listed token id".
#
# Every paying symbol is a WHOLE LION, not a trait crop. Trait crops read as
# clip art at reel size -- a floating crown on transparency has no silhouette to
# recognise at a glance, which is exactly what a symbol has to have. Whole
# characters give each symbol its own colour block and outline, so a player
# reads the reel by shape before they read it by detail.
#
# Each symbol is still IDENTIFIED by a trait: the Crown lion, the LAZY Hat lion.
# The trait is what names the symbol; the lion wearing it is what gets drawn.
# Tier order is pay order, so P1 is the top symbol -- the Crown lion, by request.
LIONS = [
    ("P1", "lion", "character", None, 4230, "CROWN -- top symbol. Blue mane, dork glasses, money mouth"),
    ("P2", "lion", "character", None, 5216, "LAZY HAT -- red mane, leopard body, gold chain, money mouth"),
    ("P3", "lion", "character", None, 4522, "SHADES -- purple mane, referee shirt, big smile"),
    ("P4", "lion", "bust",      None, 482,  "LEOPARD FUR COAT -- red top knot, shades, bunny ears"),
    ("M1", "lion", "character", None, 4837, "BUCKET HAT -- orange mane, money eyes, big smile"),
    ("M2", "lion", "character", None, 840,  "Monocle, roaring, fire mane"),
    ("M3", "lion", "character", None, 5813, "BTC eyes, gold smile, bunny ears"),
    ("M4", "lion", "character", None, 1506, "Sheriff hat, white mane, pipe"),
    ("L1", "lion", "character", None, 2038, "Police hat, emerald mane, water goggles"),
    ("L2", "lion", "character", None, 1725, "Horns, black mane, party horn"),
    ("L3", "lion", "character", None, 4117, "Pirate hat, green top knot, purple fur coat"),
    ("L4", "lion", "character", None, 5348, "Black cap, lab coat, bubble gum"),
]

# Cub Cluster runs a reduced symbol set (wild + 6), all Cub-sourced.
# L1/L2 are the Lazy drinks and are drawn as SVG in the page, not here.
CUBS = [
    ("P1", "cub", "character", None, 21095, "Crown, dork glasses"),
    ("P2", "cub", "character", None, 3097, "LAZY hat, red mane"),
    ("M1", "cub", "headgear", "Headgear::LAZY Hat", None, "cub mid"),
    ("M2", "cub", "mouth",    "Mouth::Money Mouth", None, "cub mid"),
]


def load_owned():
    lions = json.load(open(os.path.join(INGEST, "owned_traits.json")))["owned_tokens"]
    cubs_path = os.path.join(INGEST, "owned_cubs.json")
    cubs = json.load(open(cubs_path)) if os.path.exists(cubs_path) else {}
    return lions, cubs


def pick_token(pool, trait, explicit, collection):
    """Resolve a symbol to an owned token id, by trait name or explicit id."""
    if explicit is not None:
        if str(explicit) not in pool:
            raise RuntimeError(f"token #{explicit} is not in the owned {collection} set")
        return explicit
    cat, val = trait.split("::", 1)
    # Prefer whichever owned token is already cached, to avoid a needless fetch.
    matches = [int(k) for k, v in pool.items() if v["traits"].get(cat) == val]
    if not matches:
        raise RuntimeError(f"LICENSING: no owned {collection} carries {trait!r}")
    matches.sort()
    for t in matches:
        if os.path.exists(cache_path(collection, t)):
            return t
    return matches[0]


def cache_path(collection, token_id):
    prefix = "cub" if collection == "cub" else ""
    return os.path.join(CACHE, f"{prefix}{token_id}.img")


def decodes_fully(path):
    """True only if every scanline is present.

    A size check cannot answer this. These tokens are 10000x10000 JPEGs, so a
    gateway that hangs up early still leaves a file far above any plausible size
    floor -- #4522 cached at 232 KB against a true 2.35 MB and passed a 50 KB
    guard. PIL then loads it anyway because LOAD_TRUNCATED_IMAGES is on, and the
    missing scanlines come through as blank. The symbol built from it was an
    empty tile, with nothing anywhere reporting a failure.

    Decoding under LOAD_TRUNCATED_IMAGES = False is the only check that
    distinguishes "small because the art is simple" from "small because the
    download stopped".
    """
    prev = ImageFile.LOAD_TRUNCATED_IMAGES
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    try:
        with Image.open(path) as im:
            im.load()
        return True
    except Exception:
        return False
    finally:
        ImageFile.LOAD_TRUNCATED_IMAGES = prev


def fetch(collection, token_id, meta):
    os.makedirs(CACHE, exist_ok=True)
    path = cache_path(collection, token_id)
    if os.path.exists(path) and os.path.getsize(path) > 50_000 and decodes_fully(path):
        return path
    cid = meta["image"].replace("ipfs://", "")
    best, best_size = None, 0
    for attempt in range(2):
        for gw in GATEWAYS:
            tmp = path + ".part"
            subprocess.run(["curl", "-sSL", "--max-time", "180", "-o", tmp, f"{gw}/{cid}"],
                           capture_output=True)
            if not os.path.exists(tmp):
                continue
            size = os.path.getsize(tmp)
            if size > 50_000 and decodes_fully(tmp):
                os.replace(tmp, path)
                return path
            # Keep the longest partial as a last resort, but never prefer it.
            if size > best_size:
                best, best_size = tmp + f".{gw.count('/')}", size
                os.replace(tmp, best)
            elif os.path.exists(tmp):
                os.remove(tmp)
    if best and best_size > 50_000:
        os.replace(best, path)
        print(f"    WARNING: {collection} #{token_id} never decoded cleanly; "
              f"using longest partial ({best_size} bytes)", file=sys.stderr)
        return path
    raise RuntimeError(f"could not fetch a complete image for {collection} #{token_id}")


def square_box(w, h, b):
    """Expand a fractional box to a square in source pixels, clamped to frame.

    Padding a non-square crop leaves flat bars down the sides; growing the box
    to a square instead fills them with real artwork."""
    x0, y0, x1, y1 = int(b[0]*w), int(b[1]*h), int(b[2]*w), int(b[3]*h)
    cx, cy = (x0+x1)//2, (y0+y1)//2
    side = max(x1-x0, y1-y0)
    half = side//2
    x0, x1 = max(0, cx-half), min(w, cx+half)
    y0, y1 = max(0, cy-half), min(h, cy+half)
    return (x0, y0, x1, y1)


def fit_transparent(crop):
    """Fit a crop into a square tile, padding with TRANSPARENCY.

    Headgear is a wide, short region: squaring the crop box drags a slab of
    flat background in underneath, which is what put a dead grey block under
    the LAZY Hat. Keeping the natural aspect and letting the reel show through
    the padding reads as a framed detail instead."""
    side = max(crop.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(crop.convert("RGB"), ((side - crop.width) // 2, (side - crop.height) // 2))
    return canvas


def build_tile(path: str, region: str, collection: str):
    im = Image.open(path)
    had_alpha = im.mode in ("RGBA", "LA")
    im = im.convert("RGBA") if had_alpha else im.convert("RGB")
    w, h = im.size

    # Trait close-ups are NOT keyed. On a tight crop the frame corners sit
    # inside the character, so a border flood fill either eats the artwork or
    # does nothing and leaves grey bars -- which is exactly what it did to the
    # LAZY Hat and the Cub trait tiles. A framed detail is the honest render
    # for a trait anyway: it is a zoom, not a cut-out object.
    if region not in ("character", "bust"):
        b = REGION[collection][region]
        crop = im.crop((int(b[0]*w), int(b[1]*h), int(b[2]*w), int(b[3]*h))).convert("RGB")
        return fit_transparent(crop).resize((TILE, TILE), Image.LANCZOS), None

    b = REGION[collection][region]
    crop = im.crop((int(b[0] * w), int(b[1] * h), int(b[2] * w), int(b[3] * h)))
    side = max(crop.size)
    if had_alpha:
        sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        sq.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
        work = sq.resize((800, 800), Image.LANCZOS)
        if work.getchannel("A").getextrema()[0] < 250:
            return work.resize((TILE, TILE), Image.LANCZOS), None
        work = work.convert("RGB")
    else:
        sq = Image.new("RGB", (side, side), crop.getpixel((1, 1)))
        sq.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
        work = sq.resize((800, 800), Image.LANCZOS)

    bg = work.getpixel((3, 3))
    if bg == KEY:
        raise RuntimeError("sentinel colour collides with the artwork")

    # Seed the fill from CORNERS ONLY, and verify the result.
    #
    # The old seed list included the edge midpoints (0,400), (799,400). The
    # character crop is a tall box, so at half height those points sit ON the
    # lion -- mane, shoulder, fur coat. Seeding there floods outward THROUGH the
    # artwork at thresh=42 and erases the symbol: #4522 came out a 0 KB fully
    # transparent tile and #5216 lost everything but a scrap.
    #
    # Corners are background for every framed token in this collection, but a
    # single threshold still is not safe for all of them -- a lion whose fur is
    # close to its own backdrop bleeds at 42 and survives at 18. So try
    # progressively tighter thresholds and keep the first result whose opaque
    # fraction is plausible for a character tile. If none is, the honest answer
    # is an unkeyed tile, not a silently destroyed one.
    def keyed(thresh):
        w2 = work.copy()
        for xy in [(0, 0), (799, 0), (0, 799), (799, 799)]:
            ImageDraw.floodfill(w2, xy, KEY, thresh=thresh)
        rgba = w2.convert("RGBA")
        px = rgba.load()
        cleared = 0
        for y in range(800):
            for x in range(800):
                if px[x, y][:3] == KEY:
                    px[x, y] = (0, 0, 0, 0)
                    cleared += 1
        return rgba, 1.0 - cleared / 640000.0

    for thresh in (42, 30, 20, 12, 6):
        rgba, opaque = keyed(thresh)
        # A framed character fills roughly a third to four-fifths of its tile.
        # Below that the fill has eaten the lion; above it, it never caught.
        if 0.22 <= opaque <= 0.93:
            return rgba.resize((TILE, TILE), Image.LANCZOS), "#%02x%02x%02x" % bg

    print(f"    background key unreliable -- keeping opaque tile", file=sys.stderr)
    return work.convert("RGBA").resize((TILE, TILE), Image.LANCZOS), "#%02x%02x%02x" % bg


def to_uri(tile):
    buf = io.BytesIO()
    tile.save(buf, format="WEBP", quality=88, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def licensed_traits():
    """symbol id -> the trait symbols.json says the symbol stands for.

    A symbol is named for its TRAIT -- Crown, Shades, Bucket Hat -- and the
    lion wearing it is merely what gets drawn. The manifest used to fall back
    to the lion's MANE whenever the tile was picked by explicit token id,
    which is every entry in the Lion set, so it recorded P2 as "Red" and P3 as
    "Purple" while the page showed the player "LAZY Hat" and "Shades". Two
    names for one symbol, and the recorded one was the wrong one.
    """
    if not os.path.exists(SYMBOLS):
        return {}
    return {s["id"]: s["identifiesTrait"]
            for s in json.load(open(SYMBOLS))["symbols"] if s.get("identifiesTrait")}


def build_set(manifest, lions, cubs, label):
    out, total = {}, 0
    named = licensed_traits()
    print(f"\n{label}")
    for sym, collection, region, trait, explicit, note in manifest:
        pool = lions if collection == "lion" else cubs
        if not pool:
            print(f"  {sym}: no owned {collection} data -- skipped", file=sys.stderr)
            continue
        token_id = pick_token(pool, trait, explicit, collection)
        meta = pool[str(token_id)]
        path = fetch(collection, token_id, meta)
        tile, bg = build_tile(path, region, collection)
        uri = to_uri(tile)
        total += len(uri)
        mane = meta["traits"].get("Mane", f"#{token_id}")
        name = (trait.split("::", 1)[1] if trait else None) or named.get(sym) or mane
        out[sym] = {"tokenId": token_id, "collection": collection, "region": region,
                    "trait": trait, "name": name, "mane": mane, "uri": uri, "bg": bg}
        print(f"  {sym:<3} {collection:<4} #{token_id:<6} {region:<10} "
              f"{(trait or note):<28} {len(uri)//1024:>4} KB")
    return out, total


def main() -> int:
    lions, cubs = load_owned()
    default_set, a = build_set(LIONS, lions, cubs, "default set (Pride, Trait Vault)")
    cub_set, b = build_set(CUBS, lions, cubs, "cubcluster overrides")

    payload = {
        "generatedBy": "tools/atlas-build/build-symbols.py",
        "default": default_set,
        "cubcluster": cub_set,
    }
    block = "/* @@@SYMBOL_ART@@@ */\nconst SYMBOL_ART=" + json.dumps(payload) + ";\n"

    page = open(PAGE).read()
    start = page.find("/* @@@SYMBOL_ART@@@ */")
    end = page.find("/* @@@SYMBOL_ART_END@@@ */")
    if start == -1 or end == -1:
        print("PAGE MISSING MARKERS", file=sys.stderr)
        return 2
    open(PAGE, "w").write(page[:start] + block + page[end:])
    print(f"\ninjected {len(default_set)} + {len(cub_set)} tiles "
          f"({(a + b)//1024} KB) into {PAGE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
