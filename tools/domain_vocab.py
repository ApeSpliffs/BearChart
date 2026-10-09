"""
BearChart's domain vocabulary: the one definition of every code the pipeline,
the engine config and the database share.

Plain data, no side effects, no imports beyond the standard library. Consumers:

  tools/build_data.py     builds CONFIG (condition_*, completeness_*, modifiers,
                          fees, recency, operator_cap) from this module
  tools/import_sales.py   builds CONDITION_PATTERNS / COMPLETENESS_PATTERNS from it
                          (re-exported for import_my_sales.py and ebay_active.py)
  tools/sale_attributes.py size classes and the size tolerance
  supabase/migrations     the sales.condition check list must equal CONDITION_CODES
                          (tools/test_import.py enforces it)

engine.js never reads this file. It reads data.json's config, which is built from it.

Python 3.9 compatible.
"""

import re

# ---------------------------------------------------------------------------
# Condition
# ---------------------------------------------------------------------------
#
# Display order, multiplier and label. The multiplier normalises a sale to the
# "Good, nothing extra" baseline the engine takes its median of.

CONDITIONS = [
    {"code": "NWT", "label": "New with tags", "multiplier": 1.25},
    # ASSUMPTION - owner to confirm. New, but no tag in evidence: worth less
    # than NWT because the hang tag is part of what a collector pays for.
    {"code": "NWOT", "label": "New without tags", "multiplier": 1.15},
    # ASSUMPTION - owner to confirm. A used copy in like-new condition. It was
    # 1.25 (equal to NWT), which priced a used bear like one with its tags on.
    {"code": "Mint", "label": "Mint / like new, used", "multiplier": 1.15},
    {"code": "Excellent", "label": "Excellent", "multiplier": 1.10},
    {"code": "Good", "label": "Good", "multiplier": 1.00},
    {"code": "Fair", "label": "Fair", "multiplier": 0.75},
    {"code": "Poor", "label": "Poor", "multiplier": 0.50},
    {"code": "Damaged", "label": "Damaged", "multiplier": 0.35},
    {"code": "Incomplete", "label": "Incomplete", "multiplier": 0.60},
    {"code": "Unknown", "label": "Unknown", "multiplier": 1.00},
]

CONDITION_CODES = [c["code"] for c in CONDITIONS]

# Free-text condition wording -> condition code. Order matters: the first
# pattern that matches wins. Explicit "without tags" comes first so the NWT
# tag patterns can never claim it; only explicit tag evidence gives NWT; a bare
# "new" with no tag evidence is NWOT.
CONDITION_PATTERNS = [
    (r"new\s*without\s*(?:hang\s*)?tags?|\bnwot\b|\bnew\b.*\bno\s*(?:hang\s*)?tags?\b", "NWOT"),
    (r"new\s*with\s*(?:hang\s*)?tags?|\bnwt\b|\bbnwt\b|\btags?\s*attached"
     r"|\bwith\s*(?:hang\s*)?tags?\b", "NWT"),
    (r"\bmint\b|like\s*new", "Mint"),
    (r"\bbrand\s*new\b|new\s*\(other\)|open\s*box|\bnew\b|\bsealed\b|\bbnib\b", "NWOT"),
    (r"excellent|near\s*mint|\bvgc\b|very\s*good", "Excellent"),
    (r"\bgood\b|pre[\s-]*owned|\bused\b|second\s*hand|previously\s*owned", "Good"),
    (r"\bfair\b|acceptable|played\s*with", "Fair"),
    (r"\bpoor\b|\brough\b|well\s*loved", "Poor"),
    (r"damaged|broken|for\s*parts|not\s*working|repair", "Damaged"),
    (r"incomplete|missing", "Incomplete"),
]

# Explicit "new, but no tags" wording. Used by tools/reclassify_conditions.py
# (Rule A) to find rows the old mapping stored as Mint or NWT.
NWOT_EVIDENCE = re.compile(
    r"without\s*(?:hang\s*)?tags?|\bnwot\b|\bno\s*(?:hang\s*)?tags?\b", re.I)
# Explicit tag evidence: what an NWT row should be able to point at.
TAG_EVIDENCE = re.compile(
    r"new\s*with\s*(?:hang\s*)?tags?|\bnwt\b|\bbnwt\b|\btags?\s*attached"
    r"|\bwith\s*(?:hang\s*)?tags?\b", re.I)

# ---------------------------------------------------------------------------
# Completeness
# ---------------------------------------------------------------------------
#
# unstuffed = 1.00 is deliberately neutral: unstuffed with tags is the normal
# state of a recent release, not a defect. (It used to be ALSO a 0.85
# calculator modifier, which counted the same fact twice.)

COMPLETENESS = [
    {"code": "complete", "label": "Complete - outfit + extras", "multiplier": 1.15},
    {"code": "packaged", "label": "With original packaging", "multiplier": 1.15},
    {"code": "some_originals", "label": "Some originals present", "multiplier": 1.05},
    {"code": "bare", "label": "Bare bear", "multiplier": 1.00},
    {"code": "unstuffed", "label": "Unstuffed", "multiplier": 1.00},
    {"code": "altered", "label": "Missing / altered", "multiplier": 0.85},
    {"code": "unknown", "label": "Not recorded", "multiplier": 1.00},
]

COMPLETENESS_CODES = [c["code"] for c in COMPLETENESS]

COMPLETENESS_PATTERNS = [
    (r"\bcomplete\b|with\s*outfit|full\s*set|all\s*accessories", "complete"),
    (r"\bpackag|\bboxed\b|in\s*box", "packaged"),
    (r"unstuffed|flat|skin\s*only", "unstuffed"),
    (r"some\s*original|with\s*clothes|with\s*sound|with\s*accessor", "some_originals"),
    (r"\bbare\b|no\s*clothes|nude", "bare"),
    (r"altered|custom|missing", "altered"),
]

# ---------------------------------------------------------------------------
# Calculator modifiers (per copy, on top of condition and completeness)
# ---------------------------------------------------------------------------

MODIFIERS = {
    "multiplicative": [
        ("birth_certificate", 1.15),
        ("hang_tag", 1.10),
        ("tush_tag_missing", 0.70),
        ("customised", 0.80),
    ],
    "additive_usd": [
        ("sound_module", 7.00),
        ("scent_chip", 6.00),
    ],
    "labels": [
        ("birth_certificate", "Birth certificate present"),
        ("hang_tag", "Hang tag attached"),
        ("tush_tag_missing", "Tush tag missing or cut"),
        ("customised", "Customised or altered"),
        ("sound_module", "Sound module fitted"),
        ("scent_chip", "Scent chip fitted"),
    ],
    # A modifier listed here is ignored when the copy's condition is one of
    # the codes given: NWT already prices the hang tag, so it must not count twice.
    "exclusive_with": [
        ("hang_tag", ["NWT"]),
    ],
    "max_combined_multiplier": 1.45,
}

# ---------------------------------------------------------------------------
# Marketplace fees
# ---------------------------------------------------------------------------
#
# The per-order fixed fee is fixed_over when the order total is above
# fixed_threshold, otherwise fixed_under. applies_to is "item" or
# "item_plus_shipping". These are ASSUMPTIONS to verify against each
# platform's own fee page before trusting a margin.

FEE_SCHEDULE = {
    "as_of": "2026-10",
    "default_platform": "ebay",
    "platforms": {
        "ebay": {
            "label": "eBay", "pct": 0.136, "fixed_over": 0.40, "fixed_under": 0.30,
            "fixed_threshold": 10.00, "applies_to": "item_plus_shipping",
            "verify": "VERIFY on https://www.ebay.com/help/selling/fees-credits-invoices/"
                      "selling-fees?id=4822 (category rate; eBay also charges on sales "
                      "tax - approximated as item+shipping)",
        },
        "mercari": {
            "label": "Mercari", "pct": 0.10, "fixed_over": 0, "fixed_under": 0,
            "fixed_threshold": 0, "applies_to": "item_plus_shipping",
            "verify": "VERIFY on Mercari fee page",
        },
    },
}

# ---------------------------------------------------------------------------
# Sizes
# ---------------------------------------------------------------------------
#
# Half-open inch ranges [min_in, max_in). Words map a title straight to a class
# when no measurement is given.

SIZE_CLASSES = [
    {"code": "mini", "min_in": 0, "max_in": 10, "words": ["mini", "wristie", "smallfry", "smallfrys"]},
    {"code": "small", "min_in": 10, "max_in": 14, "words": []},
    {"code": "standard", "min_in": 14, "max_in": 21.5, "words": []},
    {"code": "large", "min_in": 21.5, "max_in": 28, "words": ["large"]},
    {"code": "giant", "min_in": 28, "max_in": None, "words": ["giant", "jumbo", "3 ft", "3ft"]},
]
SIZE_CLASS_CODES = [c["code"] for c in SIZE_CLASSES]
SIZE_TOLERANCE_IN = 1.5

# ---------------------------------------------------------------------------
# Evidence policy
# ---------------------------------------------------------------------------

# Sales made by the operator (Jay's Retro Exchange, which runs BearChart) may
# make up at most this share of the points behind any published value.
OPERATOR_EVIDENCE_CAP = 0.25

# Prefer recent sales; flag a value whose newest sale is outside the window.
RECENCY = {"window_days": 365, "min_recent": 10}

MARKET_EVIDENCE_TYPES = ["completed_sale", "auction_result", "collector_report",
                         "historical_archive"]
STRONG_EVIDENCE_TYPES = ["completed_sale", "auction_result"]
# Never a sale. A row carrying one of these must not reach SALES at all.
NON_SALE_EVIDENCE_TYPES = ["operator_offer", "operator_ask", "active_listing",
                           "retail_reference"]

# Hand-written claims about the evidence that go stale the moment a comp
# arrives. The UI states the evidence position from the valuation instead.
EVIDENCE_CLAIM = re.compile(
    r"no sold comps|no sourced price|no secondary market|no price (?:was )?captured"
    r"|needs a sourced comp|price not yet sourced",
    re.I)

CATALOGUE_SOURCES = ["curated", "wiki", "collectionhero", "mini_beans_guide"]
