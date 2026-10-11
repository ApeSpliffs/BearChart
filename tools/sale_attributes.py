"""
What a sold listing's title says about the copy that sold, beyond its price.

Pure functions, no I/O:

    parse(title, condition_text="") -> {condition, completeness, size_in, size_class, sound}
    parse_condition / parse_completeness / parse_size / parse_size_class / parse_sound
    resolve_variant(item, attrs, catalogue) -> (item, variant_basis)

Attributes are recorded, never used to set a price: a seller's "16 inch" is a
measurement by someone holding a tape to a plush, so the evidence decides
whether a size split exists (see tools/catalogue_gaps.md), not this parser.
A size class is never inferred from price.

Python 3.9 compatible.
"""

import re

import domain_vocab as V

# "fits 18 inch bears", "for 16in Build-A-Bear": a size of the bear the item is
# made FOR, not of the item. Shared with tools/ebay_active.py.
FITS_RE = re.compile(
    r"\b(?:fits|for)\s+(?:most\s+|all\s+)?(?:build|bab|babw|\d{2}|stuffed|plush|bears?\b|teddy)")

SIZE_RE = re.compile(
    r"(?<![\d.])(\d{1,2}(?:\.\d)?)\s*(?:\"|”|''|-?\s?inch(?:es)?\b|in\b)", re.I)

SOUND_BROKEN = re.compile(
    r"sound\s+(?:not|doesn'?t|does\s+not)\s+work|speaker\s+(?:does\s+not|doesn'?t)\s+work"
    r"|\bno\s+sound\b", re.I)
SOUND_WORKING = re.compile(
    r"with\s+sound|sound\s*box|voice\s*box|\btalking\b|sound\s+works", re.I)


def _match(patterns, text):
    t = str(text or "").lower()
    for pat, value in patterns:
        if re.search(pat, t):
            return value
    return None


def parse_condition(text):
    return _match(V.CONDITION_PATTERNS, text)


def parse_completeness(text):
    return _match(V.COMPLETENESS_PATTERNS, text)


def parse_size(title):
    """Inches stated in the title, or None. A size in a "fits 18in" phrase
    describes the bear an outfit is made for, so it is ignored."""
    text = str(title or "")
    for m in SIZE_RE.finditer(text):
        before = text[max(0, m.start() - 24):m.start()].lower()
        if FITS_RE.search(before + " 00"):
            continue
        try:
            v = float(m.group(1))
        except ValueError:
            continue
        if 3 <= v <= 48:
            return v
    return None


def parse_size_class(size_in, title=""):
    """A size class from inches, else from the words that name one. Never price."""
    if size_in is not None:
        for c in V.SIZE_CLASSES:
            hi = c["max_in"]
            if size_in >= c["min_in"] and (hi is None or size_in < hi):
                return c["code"]
    low = " %s " % re.sub(r"[^a-z0-9]+", " ", str(title or "").lower())
    for c in V.SIZE_CLASSES:
        for w in c["words"]:
            if " %s " % w in low:
                return c["code"]
    return None


def parse_sound(title):
    """'working' | 'broken' | None. A broken report wins over a working one."""
    text = str(title or "")
    if SOUND_BROKEN.search(text):
        return "broken"
    if SOUND_WORKING.search(text):
        return "working"
    return None


def parse(title, condition_text=""):
    text = " ".join(filter(None, [str(condition_text or ""), str(title or "")]))
    size = parse_size(title)
    return {
        "condition": parse_condition(text),
        "completeness": parse_completeness(text),
        "size_in": size,
        "size_class": parse_size_class(size, title),
        "sound": parse_sound(title),
    }


def stored(attrs):
    """The attributes kept on a sale record: size and sound only."""
    return {"size_in": attrs.get("size_in"), "sound": attrs.get("sound")}


def resolve_variant(item, attrs, catalogue):
    """Pick the variant a sale belongs to -> (item, variant_basis).

    Only items wired into a variant group take part. A parsed size within
    SIZE_TOLERANCE_IN of exactly one member assigns the sale to that member
    ("size_parsed"). Anything else - no size, two members in tolerance, none in
    tolerance - goes to the group's parent ("ambiguous"), or stays on the
    matched item when the group has no parent ("unverified"). An item in no
    group is returned unchanged with basis None.
    """
    if not item:
        return item, None
    parent_id = item.get("variant_of") or None
    group = item.get("variant_group") or parent_id
    is_parent = any(c.get("variant_of") == item["id"] for c in catalogue)
    if is_parent:
        group = item.get("variant_group") or item["id"]
        parent_id = item["id"]
    if not group:
        return item, None
    members = [c for c in catalogue
               if (c.get("variant_group") or c.get("variant_of")) == group
               or c["id"] == group or c.get("variant_of") == group]
    parent = next((c for c in catalogue if c["id"] == parent_id), None) if parent_id else None
    size = (attrs or {}).get("size_in")
    if size is not None:
        near = [c for c in members if c.get("size_in") is not None
                and abs(c["size_in"] - size) <= V.SIZE_TOLERANCE_IN]
        if len(near) == 1:
            return near[0], "size_parsed"
    if parent is not None:
        return parent, "ambiguous"
    return item, "unverified"
