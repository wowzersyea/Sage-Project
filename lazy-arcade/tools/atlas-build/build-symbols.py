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

from PIL import Image, ImageDraw, ImageFile, ImageFilter

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
# Whole Cubs, for the same reason the Lion set is whole Lions.
#
# M1 and M2 were region crops -- Headgear::LAZY Hat and Mouth::Money Mouth --
# and on the board they read as exactly what the Lion set was re-cast to escape:
# clip art with no silhouette, the cap's lettering clipped by the tile edge. A
# symbol has to be recognisable by shape before it is recognisable by detail.
#
# The two premiums are the operator's 1/1s. Lazy Cubs marks them in metadata by
# the ABSENCE of everything: a generative Cub carries ten traits, a Special
# carries {"Age": "Special"} and nothing else, which is how these two were found
# rather than guessed at. They are the only two in a 63-token holding.
#
# #32010 takes P1 over #2195 on legibility at reel size. Both are strong, but a
# symbol has to survive being 32px tall on a phone, and #32010 has a silhouette
# -- feathered cap, ruff collar -- where #2195's datamosh can read as a broken
# image at a glance. Top symbol goes to the one that is unmistakable small.
CUBS = [
    ("P1", "cub", "oneofone", None, 32010, "1/1 -- Elizabethan: feathered cap, ruff, tongue out"),
    ("P2", "cub", "oneofone", None, 2195,  "1/1 -- glitch: datamosh, heterochromatic eyes"),
    ("M1", "cub", "character", None, 21095, "Crown, dork glasses, red double tied up"),
    ("M2", "cub", "character", None, 3097, "LAZY hat, red mane, stoner eyes"),
]

# Trait Vault's OWN twelve. Pride and Trait Vault shipped the same twelve
# Lions, which made them one game wearing two colour schemes -- the single
# biggest gap between this cabinet and a studio catalogue, where no two titles
# share a symbol. The operator holds 120 Lions; twelve more, chosen for a
# "vault riches" identity: top hat and halo premiums, exotic bodies in the
# mids (zebra, galaxy, zombie), and a matched crew of spinner-hat lows that
# read as a family the way card royals do.
#
# No mane/blink/tongue layers here yet, and that is the measured-not-assumed
# rule, not neglect: every layer in the default set rests on per-token declared
# colours and eye boxes that took repeated correction against the art. These
# twelve ship with pop, settle and idle -- the vault's drama is the multiplier
# rows, not character acting -- and layers can be declared later token by token.
VAULT = [
    ("P1", "lion", "character", None, 7234, "TOP HAT -- black-and-gold mane, lizard blue, shades"),
    ("P2", "lion", "character", None, 5443, "HALO -- ice mane, purple fur coat, anime eyes"),
    ("P3", "lion", "bust",      None, 5523, "GLADIATOR ARMOUR -- spinner hat, fake glasses"),
    ("P4", "lion", "character", None, 6159, "SANTA HAT -- rainbow top knot, black body"),
    ("M1", "lion", "character", None, 1328, "Zebra body, bunny ears, bubble gum"),
    ("M2", "lion", "character", None, 1589, "Galaxy body, straw hat, red top knot"),
    ("M3", "lion", "character", None, 7250, "Zombie body, shades, tongue out"),
    ("M4", "lion", "character", None, 7213, "Safari hat, water goggles, Ethereum shirt"),
    ("L1", "lion", "character", None, 7184, "Gold chain, bloody mane, straw hat"),
    ("L2", "lion", "character", None, 8908, "Fire top knot, grey body, spinner"),
    ("L3", "lion", "character", None, 9315, "Rainbow mane, zombie body, spinner"),
    ("L4", "lion", "character", None, 2790, "Monocle, business shirt, spinner"),
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


def strike_coin(im):
    """The 1/1 treatment: the whole artwork struck into a gold medallion.

    The two Special Cubs the operator holds -- #2195 and #32010 -- do not have
    the flat generative backdrop the rest of the collection has. Both sit on a
    painted gold swirl, and a corner flood fill cannot lift a gradient: seeded
    on the lightest gold it stops at the first dark band, and opened wide enough
    to cross that band it starts eating tan fur, which is the same hue. Keying
    them left 0.87 of the tile opaque -- a square photograph pasted on the reel.

    #2195 makes the point harder. It is glitch art whose datamosh deliberately
    smears the subject out across its own background, so there is no boundary to
    cut along; "cut the character out" is not a thing that can be done to it.

    So they are not cut out, they are FRAMED, and framed on purpose. The game
    already speaks in struck medallions -- svgWild and svgOrb are both milled
    gold discs -- so a 1/1 reads as a coin bearing the Cub, the swirl becomes
    the coin's field, and the pair announce themselves as different from the
    generative Cubs beside them, which is exactly what they are.
    """
    w, h = im.size
    b = (0.12, 0.16, 0.88, 0.92)
    crop = im.crop((int(b[0]*w), int(b[1]*h), int(b[2]*w), int(b[3]*h))).convert("RGB")
    side = max(crop.size)
    sq = Image.new("RGB", (side, side), crop.getpixel((1, 1)))
    sq.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
    t = sq.resize((800, 800), Image.LANCZOS).convert("RGBA")
    d = ImageDraw.Draw(t, "RGBA")
    d.ellipse((10, 10, 789, 789), outline=(107, 68, 5, 255), width=16)       # struck rim
    d.arc((26, 26, 773, 773), 190, 350, fill=(255, 238, 190, 150), width=9)  # lit from above
    d.arc((26, 26, 773, 773), 10, 170, fill=(90, 55, 4, 120), width=9)       # and shaded below
    mask = Image.new("L", (800, 800), 0)
    ImageDraw.Draw(mask).ellipse((8, 8, 791, 791), fill=255)
    t.putalpha(mask.filter(ImageFilter.GaussianBlur(2.5)))
    return t.resize((TILE, TILE), Image.LANCZOS), None


def build_tile(path: str, region: str, collection: str):
    im = Image.open(path)
    had_alpha = im.mode in ("RGBA", "LA")
    im = im.convert("RGBA") if had_alpha else im.convert("RGB")
    w, h = im.size

    if region == "oneofone":
        return strike_coin(im)

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

    # Is the SOURCE ART already a cut-out? That is the only thing this branch is
    # for -- art that arrives with its own alpha needs no keying.
    #
    # It used to ask the PADDED CANVAS instead, which answers a different
    # question entirely. `side` is the longer edge, so any non-square crop gets
    # transparent margin added right here, and that margin alone drove the
    # minimum alpha to 0. The Cub character box is (0.16,0.24)-(0.84,0.94) --
    # 6800x7000, never square -- so every Cub with an RGBA master returned here
    # unkeyed. All four Cub Cluster symbols shipped as opaque squares carrying
    # their backgrounds, measured at 0.967 opaque against 0.32-0.52 for the
    # Lions, which is the whole visual gap between the two games: Lions are
    # objects sitting on the reel, Cubs were photographs pasted onto it.
    #
    # The test now reads the crop's own alpha, before anything is padded.
    if had_alpha and crop.getchannel("A").getextrema()[0] < 250:
        sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        sq.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
        return sq.resize((TILE, TILE), Image.LANCZOS), None

    # Pad with the artwork's own background rather than with black or with
    # transparency, so the corner seeds the flood fill uses below land on
    # background instead of on a margin this function introduced.
    flat = crop.convert("RGB")
    sq = Image.new("RGB", (side, side), flat.getpixel((1, 1)))
    sq.paste(flat, ((side - flat.width) // 2, (side - flat.height) // 2))
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





# Mane colour per symbol, as data.
#
# Auto-detection was tried and abandoned, and the reason is worth keeping: a
# heuristic that picks the biggest non-face colour in a head band scores well on
# average and fails unpredictably at the edges. Tuned one way it read the LAZY
# lion's cap as its mane; tuned another it merged the orange lion's mane with
# its orange face at 39% coverage; a guard against that then rejected two good
# lions and kept the one bad one, because `character` and `bust` crops do not
# frame the face at the same place. Twelve symbols do not need a classifier.
#
# These values are sampled from the art and each was checked by rendering the
# swing and looking at it. Symbols absent from this table keep a still mane --
# White, Black, Fire and Emerald cannot be told apart from outline and shadow in
# flat-shaded art, and a still mane is a far smaller defect than a face that
# moves with it.
MANE_COLOUR = {
    "P1": (32, 160, 235),    # Double Tied Up - Blue
    "P2": (230, 56, 57),     # Red
    "P3": (113, 1, 210),     # Purple
    "P4": (230, 56, 57),     # Top Knot - Red
    "M1": (229, 134, 50),    # Double Tied Up - Orange
    "L3": (35, 199, 64),     # Top Knot - Green
    # No Cub entries, and that is a measurement rather than an oversight. A Cub
    # is drawn head-on with its mane as a small tuft rather than the wide collar
    # a Lion wears: #21095's Double Tied Up - Red covers 1.9% of its tile, and
    # what there is sits UNDER the Crown, so lifting it slides the tuft out from
    # beneath the headgear. #3097's mane is Red in metadata and not visible at
    # all -- the LAZY Hat covers it. Below roughly a tenth of the tile a swing
    # is invisible at reel size, which is the same reason Lion M3 has no mane
    # layer at 15.8% of its muzzle box.
}


# Eye boxes for a blink, declared rather than detected -- for the same reason
# the mane colours are. Detection finds a clean symmetric pair on exactly ONE of
# the twelve: it reads the LAZY lion's cap lettering as eyes and returns twenty
# candidate blobs for the white lion, whose whole face is white.
#
# Only lions with plainly visible eyes appear. Shades and goggles hide three
# (P3, P4, L1), two have symbol eyes that should not blink (M1 money, M3 BTC),
# two sit behind lenses (P1 dork glasses, M2 monocle), and the white Sheriff
# (M4) was TRIED AND REJECTED on inspection: against white fur with heavy dark
# linework the lid reads as a grey block rather than a closed eye.
#
# Boxes are in tile pixels at TILE resolution. Each was checked by rendering the
# closed frame and looking at it.
EYE_BOXES = {
    "P2": [(106, 95, 137, 112), (145, 95, 178, 112)],
    "L2": [(110, 100, 142, 117), (146, 100, 178, 117)],
    "L3": [(114, 97, 134, 120), (159, 97, 175, 117)],
    "L4": [(103, 93, 137, 120), (146, 93, 180, 118)],
    # Cub Cluster. One of its four blinks, and the other three are refusals with
    # a reason, the same way eight of the twelve Lions are:
    #
    #   CUB:M1  #21095 wears Dork Glasses -- gold rims over both eyes. Same
    #           exclusion as Lion P1 and M2, who sit behind lenses.
    #   CUB:P1  #32010's eyes are ALREADY closed in the source art. There is
    #           nothing to shut.
    #   CUB:P2  #2195 is the glitch 1/1. Its eyes are open and mismatched, but
    #           the datamosh runs straight through the eye line, so a clean lid
    #           drawn over it would be the one undistorted thing on a face whose
    #           whole subject is distortion.
    #
    # M2 #3097 has bare Stoner eyes and blinks. Fur is sampled between them at
    # x=137, which on this Cub is the bridge of the nose -- yellow body fur, not
    # the black brow line that made the Lion attempt look like redaction.
    "CUB:M2": [(88, 99, 128, 120), (146, 97, 180, 118)],
}
LASH = (28, 10, 4)


# The money tongue, for the two Lions that loll one.
#
# Money Mouth is a generative LAYER, so it lands on identical pixels for every
# Lion wearing it -- P1 and P2 report the same bounding box and the same 1,068
# pixels, which is a property of the source art rather than a coincidence.
#
# ymin keeps the mask below the muzzle. Without it the green match also catches
# the LAZY Lion's green EYES, which stretched the bounding box across most of
# the tile and put the pivot in the wrong place. The cavity colour is declared
# because sampling just above the tongue hits the TEETH on one lion and muzzle
# fur on the other, and painting the gap in either produced a pale smear.
TONGUE_GREEN = (23, 157, 50)
TONGUE = {
    "P1": {"ymin": 170, "cavity": (74, 32, 30)},
    "P2": {"ymin": 170, "cavity": (96, 40, 36)},
}


def split_tongue(tile, cfg):
    """(tile with the tongue lifted and its gap filled, the tongue on its own).

    Unlike the mane, the tongue sits IN FRONT of the head, so lifting it leaves
    a hole rather than hiding one -- the gap is painted with mouth-cavity colour
    first, which is what the moving tongue then swings across.
    """
    im = tile.convert("RGBA")
    px = im.load()
    w, h = im.size
    near = lambda a, b, t: all(abs(a[i] - b[i]) < t for i in range(3))
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    xs, ys = [], []
    for y in range(cfg["ymin"], h):
        for x in range(w):
            c = px[x, y]
            if c[3] > 8 and near(c[:3], TONGUE_GREEN, 70) \
               and c[1] > c[0] + 30 and c[1] > c[2] + 30:
                mp[x, y] = 255
                xs.append(x); ys.append(y)
    if not xs:
        return None, None, None
    tongue = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    tongue.paste(im, (0, 0), mask)
    base = im.copy()
    base.paste(Image.new("RGBA", (w, h), cfg["cavity"] + (255,)), (0, 0),
               mask.filter(ImageFilter.MaxFilter(5)))
    # pivot: the middle of the tongue where it leaves the mouth, as a fraction
    # of the tile so the page can place it without knowing the tile size.
    pivot = [((min(xs) + max(xs)) / 2) / w, min(ys) / h]
    return base, tongue, pivot


def close_eyes(tile, boxes):
    """A copy of the tile with its eyes shut.

    The lid is filled with the face's OWN fur, sampled from between the eyes --
    the one place guaranteed to be face rather than mane or outline. An earlier
    attempt sampled a few pixels ABOVE each eye, hit the black brow line every
    time, and drew what looked like redaction bars; that failure was in the
    sampling, not the idea. The curved lash line is what makes it read as a
    closed eye rather than a patch of fur.
    """
    from PIL import ImageDraw
    out = tile.convert("RGBA")
    px = out.load()
    dr = ImageDraw.Draw(out)
    mid = (boxes[0][2] + boxes[1][0]) // 2
    for (x0, y0, x1, y1) in boxes:
        cy = (y0 + y1) // 2
        fur = px[mid, cy][:3]
        if sum(fur) < 150:
            fur = px[mid, max(0, cy - 8)][:3]
        lid = y1 + 2
        dr.rectangle([x0 - 2, y0 - 5, x1 + 2, lid - 4], fill=fur + (255,))
        dr.ellipse([x0 - 2, lid - 12, x1 + 2, lid + 2], fill=fur + (255,))
        dr.arc([x0 - 2, lid - 12, x1 + 2, lid + 2], start=10, end=170,
               fill=LASH + (255,), width=3)
    return out


def split_mane(tile, colour):
    """(tile with the mane lifted out, the mane on its own).

    The mane is grown before it is lifted so that it stays tucked under the face
    when it swings; the mane sits BEHIND the head in this art, so growing it
    inward costs nothing and closes the gap that would otherwise open along the
    jaw. Everything moves rigidly -- this is a separation, not a deformation,
    which is why it does not shear the muzzle the way four earlier attempts did.
    """
    im = tile.convert("RGBA")
    px = im.load()
    w, h = im.size
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    near = lambda a, b, t=44: all(abs(a[i] - b[i]) < t for i in range(3))
    for y in range(h):
        for x in range(w):
            c = px[x, y]
            if c[3] > 8 and near(c[:3], colour):
                mp[x, y] = 255
    grown = mask.filter(ImageFilter.MaxFilter(7))
    mane = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    mane.paste(im, (0, 0), grown)
    base = im.copy()
    base.putalpha(Image.composite(Image.new("L", (w, h), 0), base.split()[3], mask))
    return base, mane


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


def build_set(manifest, lions, cubs, label, key_prefix=None):
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
        # symbols.json keys Cub entries as "CUB:M2", so a bare "M2" lookup finds
        # the LION's M2 and records a Cub as a Monocle. Prefix by collection.
        # The animation tables are keyed by this. A third set reusing Lion
        # symbol ids MUST NOT inherit the default set's mane colours and eye
        # boxes -- the same collision the Cubs hit -- so each set carries its
        # own prefix.
        key = (key_prefix if key_prefix is not None
               else ("CUB:" if collection == "cub" else "")) + sym
        # Secondary motion: lift the mane so it can lag behind the roar. The
        # tables below are keyed the same way, because a Cub and a Lion share
        # symbol ids and a bare "M1" would hand a Cub the Lion's mane colour.
        mane_uri = None
        colour = MANE_COLOUR.get(key)
        if colour is not None:
            base_tile, mane_tile = split_mane(tile, colour)
            mane_uri = to_uri(mane_tile)
            tile = base_tile
        # The tongue comes off BEFORE the blink is drawn, so the closed-eye copy
        # does not carry a second static tongue that would ghost behind the
        # moving one whenever a Lion blinked.
        tongue_uri, tongue_pivot = None, None
        tcfg = TONGUE.get(key)
        if tcfg is not None:
            tb, tt, tp = split_tongue(tile, tcfg)
            if tb is not None:
                tongue_uri = to_uri(tt); tongue_pivot = tp; tile = tb
        # The blink is drawn on the BASE, after the mane is lifted, so the three
        # layers stay consistent: mane behind, body, closed-eye body over it.
        blink_uri = None
        boxes = EYE_BOXES.get(key)
        if boxes is not None:
            blink_uri = to_uri(close_eyes(tile, boxes))
        uri = to_uri(tile)
        total += len(uri) + (len(mane_uri) if mane_uri else 0)
        mane = meta["traits"].get("Mane", f"#{token_id}")
        name = (trait.split("::", 1)[1] if trait else None) or named.get(key) or mane
        out[sym] = {"tokenId": token_id, "collection": collection, "region": region,
                    "trait": trait, "name": name, "mane": mane, "uri": uri, "bg": bg}
        if mane_uri:
            out[sym]["maneUri"] = mane_uri
        if blink_uri:
            out[sym]["blinkUri"] = blink_uri
        if tongue_uri:
            out[sym]["tongueUri"] = tongue_uri
            out[sym]["tonguePivot"] = tongue_pivot
        print(f"  {sym:<3} {collection:<4} #{token_id:<6} {region:<10} "
              f"{(trait or note):<28} {len(uri)//1024:>4} KB"
              f"{'  +mane ' + str(len(mane_uri)//1024) + ' KB' if mane_uri else ''}"
              f"{'  +blink ' + str(len(blink_uri)//1024) + ' KB' if blink_uri else ''}"
              f"{'  +tongue ' + str(len(tongue_uri)//1024) + ' KB' if tongue_uri else ''}")
    return out, total


def main() -> int:
    lions, cubs = load_owned()
    default_set, a = build_set(LIONS, lions, cubs, "default set (Pride)")
    cub_set, b = build_set(CUBS, lions, cubs, "cubcluster overrides")
    vault_set, c = build_set(VAULT, lions, cubs, "traitvault overrides", key_prefix="TV:")

    payload = {
        "generatedBy": "tools/atlas-build/build-symbols.py",
        "default": default_set,
        "cubcluster": cub_set,
        "traitvault": vault_set,
    }
    block = "/* @@@SYMBOL_ART@@@ */\nconst SYMBOL_ART=" + json.dumps(payload) + ";\n"

    page = open(PAGE).read()
    start = page.find("/* @@@SYMBOL_ART@@@ */")
    end = page.find("/* @@@SYMBOL_ART_END@@@ */")
    if start == -1 or end == -1:
        print("PAGE MISSING MARKERS", file=sys.stderr)
        return 2
    open(PAGE, "w").write(page[:start] + block + page[end:])
    print(f"\ninjected {len(default_set)} + {len(cub_set)} + {len(vault_set)} tiles "
          f"({(a + b)//1024} KB) into {PAGE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
