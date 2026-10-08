#!/usr/bin/env python3
"""
BearChart seed-data builder.

Transcribes the research in BuildaBear1.md (sections 9-12, 26) into data.json.

Rules that govern this file (see BuildaBear1.md sections 3 and 33):
  - Every price here traces back to a sold observation recorded during research.
  - Nothing is invented. Where the source gave no date, date stays null.
  - Where the source gave a range instead of a point sale, price_high is set
    and the row is flagged ranged; the engine uses the midpoint and says so.
  - Only rows with full provenance (date + marketplace + listing id) are
    evidence_type "completed_sale". Undated research notes are
    "collector_report" - weaker evidence, still sold data, never an asking price.

To expand the database, add rows to ITEMS / SALES below and re-run:
    python3 tools/build_data.py
"""

import json
import os
import re
from collections import OrderedDict

ITEMS = []
SALES = []


def slug(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s


def I(name, category, species=None, year=None, month=None, aliases=None, **flags):
    """Register an item. Returns its id so sales can reference it."""
    item_id = flags.pop("id", None) or slug(name)
    item = OrderedDict()
    item["id"] = item_id
    item["canonical_name"] = name
    item["aliases"] = aliases or []
    item["category"] = category
    item["species"] = species
    item["release_year"] = year
    item["release_month"] = month
    item["version"] = flags.pop("version", None)
    item["variant"] = flags.pop("variant", None)
    item["licensed"] = flags.pop("licensed", False)
    item["franchise"] = flags.pop("franchise", None)
    item["limited_edition"] = flags.pop("limited_edition", False)
    item["edition_size"] = flags.pop("edition_size", None)
    item["employee_exclusive"] = flags.pop("employee_exclusive", False)
    item["store_exclusive"] = flags.pop("store_exclusive", False)
    item["event_exclusive"] = flags.pop("event_exclusive", False)
    item["international_exclusive"] = flags.pop("international_exclusive", False)
    item["online_exclusive"] = flags.pop("online_exclusive", False)
    item["vault_release"] = flags.pop("vault_release", False)
    item["original_release"] = flags.pop("original_release", True)
    item["mini_bean"] = flags.pop("mini_bean", False)
    item["retired"] = flags.pop("retired", None)
    # "upcoming"  - announced, not yet on sale. Nothing has sold, so nothing is priced.
    # "current"   - on sale at retail now.
    # None        - historical / status not tracked.
    item["release_status"] = flags.pop("release_status", None)
    item["expected_release"] = flags.pop("expected_release", None)
    # Announced retail price. A RETAIL reference only - never a resale value.
    item["announced_msrp"] = flags.pop("announced_msrp", None)
    item["announcement_source"] = flags.pop("announcement_source", None)
    item["is_lot"] = flags.pop("is_lot", False)
    item["sound"] = flags.pop("sound", None)
    item["scent"] = flags.pop("scent", None)
    item["rarity"] = flags.pop("rarity", None)
    item["notes"] = flags.pop("notes", None)
    # Images: BearChart ships with none. Official Build-A-Bear product photography
    # is copyrighted, so nothing is hotlinked or bundled. Attach your own photos, or
    # images you have the right to use, via the admin tools or tools/attach_images.py.
    # Every image carries its credit and source so provenance survives, exactly as
    # sold observations do.
    # Set automatically below: an identification question a human still has to
    # settle, surfaced as a work queue on the admin page.
    item["needs_review"] = False
    item["image_url"] = flags.pop("image_url", None)
    item["image_credit"] = flags.pop("image_credit", None)
    item["image_source"] = flags.pop("image_source", None)
    if flags:
        raise ValueError("unknown flags for %s: %s" % (name, list(flags)))
    if any(x["id"] == item_id for x in ITEMS):
        raise ValueError("duplicate item id: %s" % item_id)
    ITEMS.append(item)
    return item_id


def S(item_id, price, condition="Unknown", completeness="unknown",
      date=None, marketplace=None, source_url=None, listing_id=None,
      evidence="collector_report", price_high=None, notes=None, sample_size=None):
    """Register a sold observation."""
    if not any(x["id"] == item_id for x in ITEMS):
        raise ValueError("sale references unknown item: %s" % item_id)
    sale = OrderedDict()
    sale["id"] = "%s-%02d" % (item_id, sum(1 for s in SALES if s["item_id"] == item_id) + 1)
    sale["item_id"] = item_id
    sale["sale_date"] = date
    sale["sold_price"] = price
    sale["price_high"] = price_high
    sale["ranged"] = price_high is not None
    sale["currency"] = "USD"
    sale["condition"] = condition
    sale["completeness"] = completeness
    sale["marketplace"] = marketplace
    sale["source_url"] = source_url
    sale["listing_id"] = listing_id
    sale["evidence_type"] = evidence
    sale["shipping_included"] = None
    # >1 when the row is an average across several sales (e.g. a Terapeak summary).
    sale["sample_size"] = sample_size
    # True when this is a sale you made yourself - the strongest evidence there is.
    sale["first_party"] = False
    sale["notes"] = notes
    SALES.append(sale)
    return sale["id"]


# ---------------------------------------------------------------------------
# Section 9 - vintage and dated observations
# ---------------------------------------------------------------------------

# 1997
x = I("Classic Brown Teddy", "Stuffed Animal", "Bear", 1997,
      aliases=["Brown Teddy", "1997 Brown Teddy", "Classic Teddy", "Original Brown Teddy"],
      notes="Founding-era classic teddy.")
S(x, 15.99, "Excellent", "bare")

x = I("Shaggy Dog", "Stuffed Animal", "Dog", 1997)
S(x, 14.99, "Good", "bare")

x = I("Black/Orange Halloween Teddy", "Stuffed Animal", "Bear", 1997,
      aliases=["Halloween Teddy"], notes="Seasonal release.")
S(x, 30.00)

x = I("Aviator/Pilot Bear", "Stuffed Animal", "Bear", 1997, aliases=["Pilot Bear", "Aviator Bear"])
S(x, 39.99)

x = I("Pawlette Bunny", "Stuffed Animal", "Bunny", 1997, aliases=["Pawlette"])
S(x, 39.99)

x = I("Polar Bear V2", "Stuffed Animal", "Polar Bear", 1997, version="V2",
      notes="Research recorded a range rather than a single sale.")
S(x, 19.00, price_high=30.00, notes="Source gave an approximate range, not one transaction.")

I("Buddy Bear (30-inch)", "Stuffed Animal", "Bear", 1997,
  aliases=["Buddy Bear"], rarity="Rare",
  notes="Rare large 30-inch model. Historical sales are known to exist but no "
        "price was captured during research - needs a sourced comp.")

# 1998
I("Floppy Kitty", "Stuffed Animal", "Cat", 1998, month=5,
  notes="Identified as released May 1998. No sold comps captured yet.")
I("Roly Poly Panda", "Stuffed Animal", "Panda", 1998, month=8,
  notes="Identified as released August 1998. No sold comps captured yet.")

# 1999
x = I("Bunny Big Ears", "Stuffed Animal", "Bunny", 1999)
S(x, 25.00, "Mint", "bare")
S(x, 19.00, "Good", "some_originals", notes="Sold with pink sweater.")

# IDENTIFICATION CONFLICT, unresolved on purpose: the handoff records Lucky Kitty
# under 1999, while the CollectionHero index repeatedly shows a "1997 Halloween
# solid black / orange Lucky Kitty cat" - which may be this item, may be the 1997
# Halloween entry above, or may be two different products. Resolving it by guessing
# would be exactly the kind of invention this database exists to avoid, so the year
# stays as researched and the conflict is recorded here.
x = I("Lucky Kitty", "Stuffed Animal", "Cat", 1999,
      aliases=["Halloween Kitty", "Black Cat"],
      notes="Year needs confirmation. The CollectionHero index lists a Lucky Kitty "
            "under BOTH 1997 and 1999 - its 1999 page describes a black cat with orange "
            "nose and green eyes, Beary Limited, Halloween themed. Listing titles are "
            "written by sellers and disagree with each other, so the year is not settled "
            "by the index. Confirm against a tush tag before merging this with the 1997 "
            "Halloween Teddy or splitting it in two.")
S(x, 114.00, marketplace="Mercari")
S(x, 85.00, marketplace="eBay", evidence="historical_archive",
  source_url="https://buildabear.collectionhero.com/",
  notes="Approximate historical CollectionHero sale.")

# 2000
x = I("Chocolate Bunny", "Stuffed Animal", "Bunny", 2000)
S(x, 50.00, marketplace="Mercari")

# 2001
x = I("WWF Tiger", "Stuffed Animal", "Tiger", 2001, licensed=True, franchise="WWF / Wildlife")
S(x, 21.99)

x = I("McBearish", "Stuffed Animal", "Bear", 2001)
S(x, 42.47, "NWT", date="2020-10-25", marketplace="eBay", listing_id="303276414389",
  evidence="completed_sale", source_url="https://buildabear.collectionhero.com/")

x = I("Polar Bear II (20-inch)", "Stuffed Animal", "Polar Bear", 2001, version="II")
S(x, 40.00, date="2020-12-14", marketplace="eBay", listing_id="164576943954",
  evidence="completed_sale", source_url="https://buildabear.collectionhero.com/")

x = I("Employee Exclusive Holiday Moose", "Stuffed Animal", "Moose", 2001,
      employee_exclusive=True, rarity="Exclusive")
S(x, 100.00, date="2021-06-17", marketplace="eBay", listing_id="174799040558",
  evidence="completed_sale", source_url="https://buildabear.collectionhero.com/")

x = I("Kennel Pals Calico Cat", "Stuffed Animal", "Cat", 2001, aliases=["Calico Cat", "Kennel Pals"])
S(x, 250.00, "NWT", date="2023-07-18", marketplace="eBay", listing_id="364353106238",
  evidence="completed_sale", source_url="https://buildabear.collectionhero.com/",
  notes="Mint / NWT. Highest verified comp in the seed set.")

x = I("WWF Panda", "Stuffed Animal", "Panda", 2001, licensed=True, franchise="WWF / Wildlife",
      notes="Research listed a $20 NWT sale under both 2001 and 2002; release year "
            "needs confirmation. Both observations kept, not averaged away.")
S(x, 20.00, "NWT", notes="Recorded under 2001 in research.")
S(x, 20.00, "NWT", notes="Recorded under 2002 in research.")

# 2002
x = I("WWF Cheetah", "Stuffed Animal", "Cheetah", 2002, licensed=True,
      franchise="WWF / Wildlife", sound="Yes")
S(x, 11.99, completeness="some_originals", notes="Sold with sound.")

x = I("WWF Leopard", "Stuffed Animal", "Leopard", 2002, licensed=True, franchise="WWF / Wildlife")
S(x, 39.60, completeness="some_originals", notes="Sold with pirate outfit.")

x = I("Centennial Teddy", "Stuffed Animal", "Bear", 2002, sound="Yes",
      notes="The Centennial Series appears to span several years - a 1999 'first in "
            "series' release is catalogued separately. Confirm which release a comp "
            "belongs to before merging.")
S(x, 17.99, completeness="some_originals", notes="Sold with clothes and sound.")

# 2003
x = I("Shaggy Teddy", "Stuffed Animal", "Bear", 2003)
S(x, 24.69)

x = I("Pudgie Pink Pig", "Stuffed Animal", "Pig", 2003, aliases=["Pudgie Pig"])
S(x, 28.00)
S(x, 29.99)

# 2004
x = I("Friendly Frog", "Stuffed Animal", "Frog", 2004)
S(x, 18.99)

x = I("Elmo", "Stuffed Animal", "Character", 2004, licensed=True, franchise="Sesame Street")
S(x, 20.00, "Good", price_high=25.00, notes="Source gave a used range, not one transaction.")

# 2005
x = I("Loveable Lamb", "Stuffed Animal", "Lamb", 2005)
S(x, 45.00, "Good", "bare")
S(x, 204.49, "NWT", notes="NWT commands a very large premium over used for this item.")

x = I("WWF Giraffe", "Stuffed Animal", "Giraffe", 2005, licensed=True, franchise="WWF / Wildlife")
S(x, 13.90)

x = I("Vanilla Fudge Bunny", "Stuffed Animal", "Bunny", 2005,
      aliases=["Vanilla Fudge"], version="V1",
      notes="Known to exist in multiple versions (V1/V2, face and tag variations). "
            "Do not merge versions - see section 18 of the handoff.")
S(x, 189.99, "Excellent", date="2025-02-04", marketplace="eBay", listing_id="276842550193",
  evidence="completed_sale", source_url="https://buildabear.collectionhero.com/")

# 2008
x = I("Original Pumpkin Kitty", "Stuffed Animal", "Cat", 2008,
      aliases=["Pumpkin Kitty"], original_release=True,
      notes="Original 2008 release, 11 inch. Reissued as the 2023 Vault Pumpkin Kitty, "
            "the 2024 Giant (28 inch) and the 2024 Masked variant, all catalogued "
            "separately. An original and a reissue are different markets - never merge "
            "them. Note the index also shows a 'Pumpkin Fun Kitty' and an 'Orange "
            "Pumpkin Cat'; whether those are this item is unconfirmed.")
S(x, 60.00)
S(x, 59.99)

# 2010
x = I("Hello Kitty / My Melody / Pink Wink (Lot of 3)", "Lot", "Character", 2010,
      licensed=True, franchise="Sanrio", is_lot=True,
      notes="Multi-item lot. Excluded from single-item valuation.")
S(x, 64.95, notes="Lot of three; not a single-item comp.")

x = I("Hello Kitty Hawaiian Sun-Kissed Tan", "Stuffed Animal", "Character", 2010,
      licensed=True, franchise="Sanrio")
S(x, 45.00, price_high=55.00, notes="Source gave an approximate range, not one transaction.")

x = I("Wizards of Waverly Place Purple Bear", "Stuffed Animal", "Bear", 2010,
      licensed=True, franchise="Disney")
S(x, 20.00)

I("Chococat (Limited Edition)", "Stuffed Animal", "Character", 2010, licensed=True,
  franchise="Sanrio", limited_edition=True, edition_size=56000,
  notes="Sanrio 50th anniversary run, limited to 56,000 per the CollectionHero "
        "index. Historical sales exist but no price captured during research.")
I("Keroppi (Limited Edition)", "Stuffed Animal", "Character", 2010, licensed=True,
  franchise="Sanrio", limited_edition=True, edition_size=66000,
  notes="Sanrio 50th anniversary run, limited to 66,000 per the CollectionHero "
        "index. Historical sales exist but no price captured during research.")

# 2011
for nm, sp in [("Ford Mustang \"Bossy\"", "Character"), ("Patchwork Hearts Puppy", "Dog"),
               ("Cherry Blossom Teddy", "Bear")]:
    I(nm, "Stuffed Animal", sp, 2011,
      licensed=(nm.startswith("Ford")), franchise="Ford" if nm.startswith("Ford") else None,
      notes="Historical sales are known to exist; no price captured during research.")

# Year conflict left open: the handoff lists Candy Corn Kitty under 2011, the
# CollectionHero index shows a 2010 limited-edition "Candy Corn Kitty Cat".
I("Candy Corn Kitty", "Stuffed Animal", "Cat", 2011,
  notes="Year needs confirmation: the handoff records 2011, the CollectionHero index "
        "shows a 2010 limited edition. Historical sales exist; no price captured "
        "during research.")

# 2012
x = I("Vanilla Cream Bunny", "Stuffed Animal", "Bunny", 2012)
S(x, 55.00)

# 2016
x = I("Sonic the Hedgehog", "Stuffed Animal", "Character", 2016, licensed=True, franchise="Sonic")
S(x, 64.99, "NWT", "unstuffed")
S(x, 17.85, "Good", "bare")

x = I("Knuckles", "Stuffed Animal", "Character", 2016, licensed=True, franchise="Sonic")
S(x, 95.00)

# Licensed - year not recorded in research
x = I("Mew (Pokemon)", "Stuffed Animal", "Character", None, licensed=True,
      franchise="Pokemon", retired=True, sound="Yes")
S(x, 35.99, completeness="some_originals", notes="Retired, sound working.")
S(x, 25.00)

x = I("Trixie Lulamoon", "Stuffed Animal", "Character", None, licensed=True,
      franchise="My Little Pony")
S(x, 32.00)
S(x, 34.99, completeness="some_originals", notes="Sold with sound.")

x = I("TMNT Donatello / Leonardo", "Stuffed Animal", "Character", None, licensed=True,
      franchise="TMNT", retired=True,
      notes="Research did not record which of the two the $28 comp belongs to. The 2016 "
            "line ran to all four turtles - Raphael and Michelangelo are catalogued "
            "separately. Split this record once the comp is confirmed.")
S(x, 28.00, notes="Retired.")

x = I("Umbreon", "Stuffed Animal", "Character", None, licensed=True,
      franchise="Pokemon", sound="Yes")
S(x, 89.99, completeness="complete", notes="Sold with cape, sleeper and sound.")

x = I("Shadow the Hedgehog", "Stuffed Animal", "Character", None, licensed=True,
      franchise="Sonic", sound="Yes")
S(x, 82.00, completeness="some_originals",
  notes="Customized build with sound and chaos emerald - customization affects comparability.")

x = I("Gengar", "Stuffed Animal", "Character", None, licensed=True,
      franchise="Pokemon", sound="Yes")
S(x, 69.95, "NWT", completeness="some_originals", notes="NWT with sound.")

x = I("Husky Mama + Puppy (Magnetic Mouth)", "Stuffed Animal", "Dog", None)
S(x, 39.99, completeness="complete", notes="Magnetic-mouth pair.")

x = I("Pirate Bear", "Stuffed Animal", "Bear", None)
S(x, 45.00, completeness="some_originals", notes="Sold with accessories.")

# ---------------------------------------------------------------------------
# Catalogue expansion - identification only
#
# Item identities confirmed against the CollectionHero Build-A-Bear index
# (handoff section 12 names it as a secondary reference). These are catalogue
# entries: the index shows that the item exists and was sold, but the gallery
# pages do not expose a per-item sold price, so NO price is recorded here.
# They are searchable, filterable and flagged "needs comps" until a sourced
# sale arrives via tools/import_sales.py.
# ---------------------------------------------------------------------------

# 1997 era, seen repeatedly in the index
I("Our Founding Bear", "Stuffed Animal", "Bear", 1997,
  aliases=["Founding Bear", "Founding Founders Brown Bear", "Founders Bear"],
  version="1st Version", rarity="Rare",
  notes="18-19 inch brown bear. Year needs confirmation: the index shows this under "
        "both 1997 and 2000 (retired). It may have been produced across several years, "
        "or the listing titles may simply be wrong. Confirm before treating a comp as "
        "belonging to a specific year.")

I("Kuddly Kitty", "Stuffed Animal", "Cat", 1997, limited_edition=True,
  aliases=["Kuddly Kitty White Cat", "Cat and Mouse"],
  notes="Limited edition white cat sold with an attachable mouse; red velvet nose "
        "noted. Year needs confirmation: the index shows this under both 1997 and "
        "November 2000. Confirm before treating a comp as belonging to a year.")

I("Huggable Kitty", "Stuffed Animal", "Cat", 1997, limited_edition=True,
  notes="Limited edition white cat. Catalogued from the CollectionHero index; "
        "no sourced price captured yet.")

I("Latte Teddy", "Stuffed Animal", "Bear", None, international_exclusive=True,
  aliases=["Latte Bear"], version="V1", rarity="Rare",
  notes="A German exclusive, described as very hard to find and noted as a V1. Year "
        "not yet sourced. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")

I("Red Panda", "Stuffed Animal", "Red Panda", None, retired=True,
  aliases=["Red Panda Raccoon"],
  notes="18 inch, retired. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")

# 2001, alongside the items already carrying sold data
I("Black Labrador Retriever Puppy", "Stuffed Animal", "Dog", 2001, limited_edition=True,
  notes="Limited edition set noted in 6 inch and 15 inch sizes. Sizes may need "
        "splitting into separate items once comps exist.")

I("Mummy Bear", "Stuffed Animal", "Bear", 2001, retired=True,
  aliases=["Mummy"],
  notes="16 inch retired Halloween workshop teddy. Catalogued from the "
        "CollectionHero index; no sourced price captured yet.")

I("Elvis Hound Dog", "Stuffed Animal", "Dog", 2001, licensed=True, franchise="Elvis",
  sound="Yes",
  notes="18 inch, sold with satin fringe wig and boots, voice recording. "
        "Catalogued from the CollectionHero index; no sourced price captured yet.")

I("Marvelous Chimp", "Stuffed Animal", "Monkey", 2001,
  aliases=["Marvelous Chimp Monkey"],
  notes="Birthday party promotional item. Catalogued from the CollectionHero index; "
        "no sourced price captured yet.")

# WWF / Wildlife series - a yearly conservation series running roughly 2000-2011.
# Only the entries the index actually showed are listed.
WWF = [
    ("WWF Black Jaguar", "Jaguar", 2008, None),
    ("WWF Gray Wolf", "Wolf", 2009, None),
    ("WWF Timber Wolf", "Wolf", 2010, "Noted with a pup variant."),
    ("WWF Coyote", "Coyote", 2010, None),
    ("WWF Wolf Dog", "Wolf", 2011, "Retired 2011."),
    ("WWF Polar Bear", "Polar Bear", 2004, "CollectiBear series."),
    ("WWF Snow Leopard", "Leopard", None, None),
    ("WWF White Tiger", "Tiger", None, "Unstuffed long-leg style noted."),
    ("WWF Zebra", "Zebra", None, None),
    ("WWF Red Fox", "Fox", None, "St. Louis Zoo association noted - may be a zoo exclusive."),
]
for nm, sp, yr, note in WWF:
    I(nm, "Stuffed Animal", sp, yr, licensed=True, franchise="WWF / Wildlife",
      notes=((note + " ") if note else "") +
            "WWF conservation series. Catalogued from the CollectionHero index; "
            "no sourced price captured yet.")

# Sanrio - the 2010 50th-anniversary run. Chococat and Keroppi already exist above
# with their edition sizes now recorded.
I("My Melody", "Stuffed Animal", "Character", 2010, licensed=True, franchise="Sanrio",
  retired=True, rarity="Rare",
  notes="Sanrio 50th anniversary run. Retired. Catalogued from the CollectionHero "
        "index; no sourced price captured yet.")

I("Cinnamoroll", "Stuffed Animal", "Character", None, licensed=True, franchise="Sanrio",
  notes="Catalogued from the CollectionHero index; year and price not yet sourced.")

# Seasons of Hugs, 2009 - a four-bear set
for season in ["Spring", "Summer", "Autumn", "Winter"]:
    I("%s Hugs Bear" % season, "Stuffed Animal", "Bear", 2009,
      aliases=["%s of Hugs" % season],
      retired=(season == "Autumn") or None,
      notes="One of the four-bear Seasons of Hugs set (2009), each with its own "
            "clothing and accessories. Catalogued from the CollectionHero index; "
            "no sourced price captured yet.")

I("Harry Potter Otter Patronus", "Stuffed Animal", "Otter", None, licensed=True,
  franchise="Harry Potter",
  notes="Catalogued from the CollectionHero index; year and price not yet sourced.")


# --- Licensed franchises, from the CollectionHero index (identification only) ---
# Names confirmed to exist and to have sold. No per-item price is exposed on the
# gallery pages, so no price is recorded for any of these.

POKEMON = ["Eevee", "Vaporeon", "Jolteon", "Flareon", "Espeon", "Leafeon",
           "Glaceon", "Sylveon", "Charmander", "Pikachu", "Bulbasaur",
           "Alolan Vulpix", "Meowth", "Pichu", "Snorlax", "Piplup"]
for nm in POKEMON:
    I("%s (Pokemon)" % nm, "Stuffed Animal", "Character",
      2018 if nm in ("Alolan Vulpix", "Piplup") else
      2017 if nm in ("Snorlax", "Psyduck") else None, licensed=True,
      franchise="Pokemon", aliases=[nm],
      notes="Pokemon line. Commonly sold with outfit and sound box - check what a "
            "comp included before comparing. Catalogued from the CollectionHero "
            "index; no sourced price captured yet.")

# Umbreon and Gengar already exist above with sold comps.

DISNEY = [
    ("Cinderella", "Disney Princess line. 2016 limited edition, 1,500 made.", 2016, 1500),
    ("Rapunzel", "Disney Princess line. 2016 limited edition, 1,500 made.", 2016, 1500),
    ("Ariel", "Disney Princess line. Singing variant noted. 2016 limited edition, "
              "1,500 made.", 2016, 1500),
    ("Winnie the Pooh", "Winnie the Pooh collection, sold with sound.", None, None),
    ("Eeyore", "Winnie the Pooh collection, sold with sound.", None, None),
    ("Tigger", "Winnie the Pooh collection, sold with sound.", None, None),
    ("Piglet", "Winnie the Pooh collection, sold with sound.", None, None),
]
for nm, note, yr, size in DISNEY:
    I("%s (Disney)" % nm, "Stuffed Animal", "Character", yr, licensed=True,
      franchise="Disney", aliases=[nm], limited_edition=bool(size), edition_size=size,
      notes=note + " Catalogued from the CollectionHero index; no sourced price "
                   "captured yet.")

I("Downtown Disney Exclusive Puppy", "Stuffed Animal", "Dog", None, licensed=True,
  franchise="Disney", store_exclusive=True,
  notes="Downtown Disney store exclusive with a hidden-Mickey design. Catalogued "
        "from the CollectionHero index; no sourced price captured yet.")

# --- Promise Pets line ---
PROMISE_PETS = [
    ("Promise Pets Black Cat", "Cat", None,
     "Solid black with green eyes; meow sound box and scent variants noted."),
    ("Promise Pets Corgi Pup", "Dog", 2017,
     "14 inch. Retired 2017."),
    ("Promise Pets Husky", "Dog", None, None),
    ("Promise Pets Beagle", "Dog", None, None),
    ("Promise Pets Retriever", "Dog", None, None),
    ("Promise Pets Yorkie", "Dog", None, None),
    ("Promise Pets Spaniel", "Dog", None, "UK exclusive. Retired."),
]
for nm, sp, yr, note in PROMISE_PETS:
    I(nm, "Stuffed Animal", sp, yr,
      retired=True if (note and "Retired" in note) else None,
      notes=((note + " ") if note else "") +
            "Promise Pets line. Catalogued from the CollectionHero index; no "
            "sourced price captured yet.")


# --- Star Wars ---------------------------------------------------------------
STAR_WARS = [
    ("Boba Fett", "Character", None, None, "Marketed as the original Mandalorian."),
    ("Darth Maul", "Character", None, None, "Sold with a lightsaber accessory."),
    ("R2-D2", "Droid", None, "Yes", None),
    ("Stormtrooper", "Character", None, None, "Sold with a blaster accessory."),
    ("Grogu", "Character", None, None, "The Child, from The Mandalorian."),
    ("The Mandalorian", "Character", None, "Yes", None),
    ("Darth Vader", "Character", None, None,
     "25th celebration anniversary edition with a light-up red lightsaber noted."),
    ("Millennium Falcon", "Vehicle", 2018, None, "Plush vehicle. Limited edition."),
    ("Bantha", "Creature", None, None, "Sold with a saddle accessory."),
]
for nm, sp, yr, snd, note in STAR_WARS:
    I("%s (Star Wars)" % nm, "Stuffed Animal", sp, yr, licensed=True, franchise="Star Wars",
      aliases=[nm], sound=snd, limited_edition=(nm == "Millennium Falcon"),
      notes=((note + " ") if note else "") +
            "Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Marvel ------------------------------------------------------------------
MARVEL = [
    ("Scarlet Witch", 2021, "WandaVision line. Roughly 16-18 inch, red fur, wand accessory."),
    ("Vision", 2021, "WandaVision line."),
    ("Deadpool", 2019, "Sold with sword accessories."),
    ("Pandapool", 2019, "Deadpool panda variant."),
]
for nm, yr, note in MARVEL:
    I("%s (Marvel)" % nm, "Stuffed Animal", "Character", yr, licensed=True, franchise="Marvel",
      aliases=[nm],
      notes=note + " Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Harry Potter, 2020 limited-edition collection ---------------------------
HP_PLUSH = [
    ("Gryffindor House Bear", "Bear"), ("Slytherin House Bear", "Bear"),
    ("Ravenclaw House Bear", "Bear"), ("Hufflepuff House Bear", "Bear"),
    ("Hufflepuff Badger", "Badger"), ("Gryffindor Lion", "Lion"),
]
for nm, sp in HP_PLUSH:
    I("%s (Harry Potter)" % nm, "Stuffed Animal", sp, 2020, licensed=True,
      franchise="Harry Potter", limited_edition=True, aliases=[nm],
      notes="2020 limited-edition Harry Potter collection; house bears sold with robe, "
            "scarf and wand. Catalogued from the CollectionHero index; no sourced "
            "price captured yet.")

HP_ACCESSORIES = [
    ("Hogwarts Express Train", "Props"), ("Sorting Hat", "Hats"),
    ("Golden Snitch", "Props"), ("Firebolt Broom Wristie", "Accessories"),
    ("Monster Book Wristie", "Accessories"), ("Hogwarts House Robe", "Costumes"),
    ("Hogwarts House Scarf", "Accessories"), ("Quidditch Outfit", "Costumes"),
    ("Hogwarts Uniform Pants", "Clothing"), ("Wizard Wand", "Props"),
]
for nm, sub in HP_ACCESSORIES:
    I("%s (Harry Potter)" % nm, "Clothing & Accessories", sub, 2020, licensed=True,
      franchise="Harry Potter", aliases=[nm],
      notes="2020 Harry Potter collection accessory. Produced per house where "
            "applicable - split into separate items once comps distinguish them. "
            "Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Honey Girls, in-house music line ----------------------------------------
HONEY_GIRLS = [
    ("Teegan", "Cat", "Lead singer. Purple tiger cat."),
    ("Viv", "Bear", "Drummer. Blue bear."),
    ("Misha", "Fox", "Dancer."),
    ("Risa", "Bunny", "Guitarist."),
    ("Stella", "Dog", "Fashionista. White poodle. A 2016 example was noted."),
    ("Keely", "Leopard", None),
]
for nm, sp, note in HONEY_GIRLS:
    I("%s (Honey Girls)" % nm, "Stuffed Animal", sp, None, aliases=[nm], sound="Yes",
      notes=((note + " ") if note else "") +
            "Honey Girls music line; sound boxes play songs from the storyline. "
            "Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Nintendo ----------------------------------------------------------------
I("Bowser (Super Mario)", "Stuffed Animal", "Character", None, licensed=True,
  franchise="Super Mario", aliases=["Bowser"],
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Psyduck (Pokemon)", "Stuffed Animal", "Character", None, licensed=True,
  franchise="Pokemon", aliases=["Psyduck"],
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Emo Axolotl", "Stuffed Animal", "Axolotl", None, limited_edition=True,
  notes="Noted as limited edition, year not shown. Catalogued from the "
        "CollectionHero index; no sourced price captured yet.")

# --- 2010 releases -----------------------------------------------------------
I("Sparkle Hello Kitty", "Stuffed Animal", "Character", 2010, licensed=True,
  franchise="Sanrio", limited_edition=True,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Gazelle (St. Louis Zoo)", "Stuffed Animal", "Gazelle", 2010, event_exclusive=True,
  rarity="Rare", aliases=["Gazelle"],
  notes="St. Louis Zoo collection, noted as extremely rare. Catalogued from the "
        "CollectionHero index; no sourced price captured yet.")
I("Year of the Tiger", "Stuffed Animal", "Tiger", 2010, rarity="Rare",
  notes="Zodiac collection. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Springbok", "Stuffed Animal", "Springbok", 2010, international_exclusive=True,
  notes="South African exclusive. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("River Otter", "Stuffed Animal", "Otter", 2010, rarity="Rare",
  notes="Noted as rare, with a St. Louis Zoo association on some listings. "
        "Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- 2005 releases -----------------------------------------------------------
I("Barbie Doll Cuddly Teddy", "Stuffed Animal", "Bear", 2005, licensed=True,
  franchise="Barbie", retired=True,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("WWF Clouded Snow Leopard", "Stuffed Animal", "Leopard", 2005, licensed=True,
  franchise="WWF / Wildlife",
  notes="15 inch, unstuffed examples noted. May or may not be the same product as the "
        "WWF Snow Leopard already catalogued - confirm before merging. Catalogued from "
        "the CollectionHero index; no sourced price captured yet.")

INTERNATIONAL = [
    ("Han Bok", "Korean costume."),
    ("Alpine Boy", "Oktoberfest costume."),
    ("Euro Flower Girl", "Sold with bear in some listings."),
    ("Cheong Sam", "Listed as a geisha-girl costume, though the name is Chinese - "
                   "the listing wording may be wrong."),
]
for nm, note in INTERNATIONAL:
    I("%s (Collectibear Costume)" % nm, "Clothing & Accessories", "Costumes", 2005,
      aliases=[nm],
      notes="International Collectibear/Collectiwear costume line. " + note +
            " Catalogued from the CollectionHero index; no sourced price captured yet.")

I("Wizard of Oz Costume Set", "Clothing & Accessories", "Costumes", 2005,
  limited_edition=True, licensed=True, franchise="Wizard of Oz", is_lot=True,
  notes="Complete set of five character costumes. Catalogued from the CollectionHero "
        "index; no sourced price captured yet.")
I("Wicked Witch Costume", "Clothing & Accessories", "Costumes", 2005, licensed=True,
  franchise="Wizard of Oz",
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Armoire / Closet", "Clothing & Accessories", "Furniture", 2005,
  notes="Furniture accessory. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")

# --- Holiday -----------------------------------------------------------------
NBC = [("Jack Skellington", "Yes"), ("Sally", None), ("Oogie Boogie", "Yes"), ("Zero", None)]
for nm, snd in NBC:
    I("%s (Nightmare Before Christmas)" % nm, "Stuffed Animal", "Character", None,
      licensed=True, franchise="Nightmare Before Christmas", aliases=[nm], sound=snd,
      notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

I("Christmas Hello Kitty", "Stuffed Animal", "Character", 2023, licensed=True,
  franchise="Sanrio",
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Gingerbread Hello Kitty", "Stuffed Animal", "Character", None, licensed=True,
  franchise="Sanrio",
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Jumbo Cinnamoroll (36-inch)", "Stuffed Animal", "Character", None, licensed=True,
  franchise="Sanrio", aliases=["Giant Cinnamoroll"],
  notes="Jumbo 36 inch size, sold with a bow. Size variants are priced separately from "
        "the standard Cinnamoroll. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("Swarovski Crystal Bear", "Stuffed Animal", "Bear", None, limited_edition=True,
  notes="Pink, green and white variants noted, sold around Christmas and Valentine's. "
        "Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Outfits and accessories -------------------------------------------------
OUTFITS = [
    ("Year of the Pig Outfit", "Costumes", 2007, None, None,
     "Hat, shirt and pants."),
    ("South Africa World Cup Outfit", "Clothing", 2010, None, None,
     "Shirt and boxers in the South African flag."),
    ("Hot Wheels 50th Anniversary Outfit", "Clothing", None, True, "Hot Wheels",
     "Sold with a car accessory."),
    ("Barbie Movie Outfit Set", "Clothing", None, True, "Barbie",
     "Multi-piece set."),
    ("Hula Skirt Outfit", "Costumes", None, True, "Sanrio",
     "From the Hello Kitty tropical line."),
    ("I Love New York Outfit", "Clothing", None, None, None, None),
    ("Chococat Matching Outfit Set", "Clothing", None, True, "Sanrio",
     "Shirt, jeans and shoes."),
    ("Formal Tuxedo Suit", "Clothing", 2010, True, "Sanrio",
     "Chococat limited edition, sold with bow ties."),
    ("St. Louis Zoo Otter Outfit", "Clothing", None, None, None,
     "Zoo-exclusive shirt; an Arctic Fisherman variant was also noted."),
    ("Little Mermaid Ariel Outfit", "Costumes", None, True, "Disney",
     "Limited edition."),
    ("Promise Pets Black Cat Outfit", "Clothing", None, None, None,
     "From the Promise Pets line."),
]
for nm, sub, yr, lic, fr, note in OUTFITS:
    I(nm, "Clothing & Accessories", sub, yr, licensed=bool(lic), franchise=fr,
      notes=((note + " ") if note else "") +
            "Catalogued from the CollectionHero index; no sourced price captured yet.")


# --- Chinese zodiac series ---------------------------------------------------
ZODIAC = [
    ("Year of the Pig", "Pig", 2007, False),
    ("Year of the Mouse", "Mouse", 2008, False),
    ("Year of the Ox", "Ox", 2009, True),
    ("Lucky Lunar Dragon", "Dragon", 2024, True),
]
for nm, sp, yr, le in ZODIAC:
    I(nm, "Stuffed Animal", sp, yr, limited_edition=le,
      aliases=["Year of the Rat"] if nm == "Year of the Mouse" else
              (["Lucky Red Dragon", "Chinese New Year Dragon"] if "Dragon" in nm else []),
      notes="Chinese zodiac / Lunar New Year series. Catalogued from the "
            "CollectionHero index; no sourced price captured yet.")
# Year of the Tiger (2010) is catalogued above.

# --- St. Louis Zoo exclusives ------------------------------------------------
# A long-running zoo-exclusive line. Several of these look close to WWF-series
# animals already catalogued; where that is possible it is flagged rather than
# merged, because a zoo exclusive and a retail release are not the same item.
ZOO = [
    ("Otter", "Otter", 2008, "May overlap with the River Otter catalogued above."),
    ("Black Jaguar", "Jaguar", None, "May overlap with the WWF Black Jaguar (2008)."),
    ("Black and White Ruffed Lemur", "Lemur", None, None),
    ("Monarch Butterfly", "Butterfly", None, None),
    ("Rhino", "Rhino", None, None),
    ("White Billy Goat", "Goat", None, None),
    ("Andean Bear", "Bear", None, None),
    ("Red Kangaroo and Joey", "Kangaroo", 2010, "Sold as a mother-and-joey pair."),
    ("Red Fox Mom and Baby", "Fox", None, "Pair. May overlap with the WWF Red Fox."),
]
for nm, sp, yr, note in ZOO:
    I("%s (St. Louis Zoo)" % nm, "Stuffed Animal", sp, yr, event_exclusive=True,
      aliases=[nm],
      notes=((note + " ") if note else "") +
            "St. Louis Zoo exclusive. Catalogued from the CollectionHero index; "
            "no sourced price captured yet.")

# --- Employee exclusives -----------------------------------------------------
# The Holiday Moose (2001) above is the only one of these with a sourced price.
EMPLOYEE = [
    ("Glisten", "Bear", None, "Christmas line."),
    ("Glisten Reindeer", "Reindeer", None, "Christmas line."),
    ("Glisten Unicorn", "Unicorn", None, "Christmas line."),
    ("Team Santa", "Bear", None, "Christmas line."),
    ("Lavender Cuddles", "Bear", 2016, None),
    ("Platinum Bear", "Bear", 2008, None),
    ("Merry Mouse (13-inch)", "Mouse", None,
     "13 inch version, priced apart from the 15 inch."),
    ("Merry Mouse (15-inch)", "Mouse", 2013,
     "15 inch grey version, priced apart from the 13 inch."),
    ("Bearemy Special Delivery Mini", "Bear", 2016, None),
]
for nm, sp, yr, note in EMPLOYEE:
    I(nm, "Stuffed Animal", sp, yr, employee_exclusive=True, rarity="Exclusive",
      notes=((note + " ") if note else "") +
            "Employee exclusive. Catalogued from the CollectionHero index; no "
            "sourced price captured yet.")

I("Vulpix (Employee Exclusive)", "Stuffed Animal", "Character", 2017, licensed=True,
  franchise="Pokemon", employee_exclusive=True, rarity="Exclusive",
  aliases=["Vulpix"],
  notes="Employee exclusive, distinct from the Alolan Vulpix retail release - do not "
        "merge the two. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Shopkins Bear", "Stuffed Animal", "Bear", None, licensed=True, franchise="Shopkins",
  employee_exclusive=True, retired=True,
  notes="Employee exclusive. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Shopkins D'Lish Donut Bear", "Stuffed Animal", "Bear", None, licensed=True,
  franchise="Shopkins", employee_exclusive=True, retired=True,
  notes="Employee exclusive. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Build-A-Bear Employee Backpack", "Clothing & Accessories", "Bags", None,
  employee_exclusive=True,
  notes="Employee exclusive. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")

# --- Disney Frozen -----------------------------------------------------------
FROZEN = [
    ("Elsa", "Character", "Sold with outfit."),
    ("Anna", "Character", "Sold with outfit."),
    ("Olaf", "Character", "Vacation outfit and pyjama variants noted."),
    ("Sven", "Reindeer", "From Frozen II."),
    ("Snowgie", "Character", "Snow-baby from Frozen Fever / Olaf's Frozen Adventure."),
]
for nm, sp, note in FROZEN:
    I("%s (Frozen)" % nm, "Stuffed Animal", sp, None, licensed=True, franchise="Disney",
      aliases=[nm],
      notes=note + " Catalogued from the CollectionHero index; no sourced price "
                   "captured yet.")
I("Frozen Dress and Crown", "Clothing & Accessories", "Costumes", None, licensed=True,
  franchise="Disney",
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- More 1999 -----------------------------------------------------------------
I("Frosty the Snowman", "Stuffed Animal", "Character", 1999, licensed=True,
  franchise="Frosty the Snowman",
  notes="Sold with scarf, pipe, broom and hat. Professor Hinkle, Hocus Pocus and Karen "
        "companions were also produced - add them as separate items once comps exist. "
        "Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Jigglypuff (Pokemon)", "Stuffed Animal", "Character", None, licensed=True,
  franchise="Pokemon", sound="Yes", retired=True, rarity="Rare", aliases=["Jigglypuff"],
  notes="Year unresolved and deliberately left blank. A seller title placed one under "
        "1999, but the index also shows a 2018 release with signature cape, plush "
        "microphone and TCG card, which matches the modern Pokemon line. Rather than "
        "pick, the year stays empty until a tush tag settles it.")
I("Centennial Series Teddy (1999)", "Stuffed Animal", "Bear", 1999, limited_edition=True,
  version="First in series",
  notes="Described as the first in the Centennial Series, clothed with polo shirt, denim "
        "jeans and knit sweater. The series is genuinely tangled: the index shows "
        "Centennial entries under 1998, 1999 and 2002, and a 2002 Centennial Teddy is "
        "catalogued separately with a sourced sale. Confirm which release a comp belongs "
        "to before merging any of them.")
I("Sparkle (Halloween Cub)", "Stuffed Animal", "Bear", 1999, limited_edition=True,
  notes="Halloween cub teddy, Beary Limited edition, late 1999 into 2000. Distinct from "
        "the 2010 Sparkle Hello Kitty. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("Bison", "Stuffed Animal", "Bison", 1999, rarity="Rare", aliases=["Buffalo"],
  notes="Described as rare and exclusive. Catalogued from the CollectionHero index; "
        "no sourced price captured yet.")


# --- Sonic movie line (2024) -------------------------------------------------
# Distinct from the 2016 game-styled releases already catalogued. Movie and game
# versions of the same character are different products and are priced apart.
SONIC_MOVIE = [
    ("Shadow the Hedgehog (Movie)", "Sonic the Hedgehog 3 tie-in. Stuffed, unstuffed, "
                                    "dressed and undressed configurations all noted."),
    ("Sonic (Movie)", "Sold with onesie and shoes."),
    ("Tails (Movie)", "A separate Sonic 2 variant was also noted."),
    ("Knuckles (Movie)", None),
    ("Super Sonic", None),
]
for nm, note in SONIC_MOVIE:
    I(nm, "Stuffed Animal", "Character", 2024, licensed=True, franchise="Sonic",
      sound="Yes",
      notes=((note + " ") if note else "") +
            "2024 film line - do not merge with the 2016 releases. Catalogued from "
            "the CollectionHero index; no sourced price captured yet.")
I("Chaos Emerald Wristband", "Clothing & Accessories", "Accessories", 2024, licensed=True,
  franchise="Sonic", aliases=["Master Emerald Wristband"],
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Care Bears (2015) -------------------------------------------------------
for nm, colour in [("Grumpy Bear", "Blue."), ("Funshine Bear", "Yellow, sunshine symbol.")]:
    I("%s (Care Bears)" % nm, "Stuffed Animal", "Bear", 2015, licensed=True,
      franchise="Care Bears", aliases=[nm],
      notes=colour + " One of a set of five. The remaining three are not yet "
                     "identified. Catalogued from the CollectionHero index; no "
                     "sourced price captured yet.")

# --- 2000 releases -----------------------------------------------------------
I("Millennium Cub", "Stuffed Animal", "Bear", 2000, limited_edition=True,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Royal King (International Collection)", "Stuffed Animal", "Bear", None,
  aliases=["Royal King"],
  notes="International Collection series. Catalogued from the CollectionHero index; "
        "no sourced price captured yet.")
I("Orange Pumpkin Cat", "Stuffed Animal", "Cat", None,
  notes="Early-2000s Halloween release. Possibly related to the Pumpkin Kitty line - "
        "confirm before merging. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("G.J. Coyote", "Stuffed Animal", "Coyote", 2008,
  notes="Distinct from the 2010 WWF Coyote - confirm before merging. Catalogued from "
        "the CollectionHero index; no sourced price captured yet.")
I("Hello Kitty Tropical", "Stuffed Animal", "Character", None, licensed=True,
  franchise="Sanrio",
  notes="Pink flower attachment noted. Related to the Hawaiian Sun-Kissed Tan release "
        "already catalogued - confirm whether they are the same product. Catalogued "
        "from the CollectionHero index; no sourced price captured yet.")

# --- CollectiBear series -----------------------------------------------------
# A long-running numbered collector series. Several entries overlap with items
# already catalogued from other searches; those are cross-referenced, not merged.
COLLECTIBEAR = [
    ("Pumpkin Fun Kitty", "Cat", None, "May relate to the Pumpkin Kitty line - confirm."),
    ("Holiday Reindeer", "Reindeer", None, None),
    ("WWF Fennec Fox", "Fox", None, None),
    ("All Seasons Winter Bear", "Bear", 2007, None),
    ("Gem of a Friend Bearilliant Blue", "Bear", None, None),
    ("Cuddly Lamb", "Lamb", 2007, "A V1 with a Japanese tag variant is noted, so "
                                   "tag origin may distinguish versions."),
]
for nm, sp, yr, note in COLLECTIBEAR:
    I(nm, "Stuffed Animal", sp, yr,
      notes=((note + " ") if note else "") +
            "CollectiBear collector series. Catalogued from the CollectionHero index; "
            "no sourced price captured yet.")

I("Big Bird (Sesame Street)", "Stuffed Animal", "Character", 2006, licensed=True,
  franchise="Sesame Street", aliases=["Big Bird"],
  notes="CollectiBear series. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")


# --- Vault reissues ----------------------------------------------------------
# Section 25 of the handoff exists for exactly this. The Pumpkin Kitty has been
# reissued repeatedly; an original 2008 example and a 2023 Vault reissue are
# different items with different markets and must never share a valuation.
I("Pumpkin Kitty (Vault 2023)", "Stuffed Animal", "Cat", 2023, vault_release=True,
  original_release=False, limited_edition=True, scent="Pumpkin",
  notes="Vault Collection reissue of the 2008 Original Pumpkin Kitty. A reissue does "
        "not carry the value of an original - do not merge the two.")
I("Giant Pumpkin Kitty (2024)", "Stuffed Animal", "Cat", 2024, vault_release=True,
  original_release=False, online_exclusive=True,
  notes="28 inch online exclusive. Size variants price separately from the standard "
        "Pumpkin Kitty.")
I("Masked Pumpkin Kitty (2024)", "Stuffed Animal", "Cat", 2024, vault_release=True,
  original_release=False, variant="Masked",
  notes="Mask-style eye patches; sold as a duo in some listings. A pattern variant, "
        "priced apart from the plain Vault release.")

# --- Loveable Legends (2024), full size --------------------------------------
# Distinct from the Mini Beans versions of the same characters catalogued above.
I("Mothman (Loveable Legends)", "Stuffed Animal", "Cryptid", 2024,
  notes="Full-size Loveable Legends release, sold with certificate, shirt, sleeper and "
        "wristie variants; strawberry scent noted. Do not merge with the Mini Beans "
        "Mothman - different product, different price.")
I("Gargoyle (Loveable Legends)", "Stuffed Animal", "Cryptid", 2024,
  notes="Full-size Loveable Legends release; pumpkin scent noted. Do not merge with "
        "the Mini Beans Gargoyle.")

# --- Paw Patrol --------------------------------------------------------------
for nm in ["Chase", "Skye", "Marshall", "Rubble", "Tracker", "Rocky", "Zuma", "Everest"]:
    I("%s (Paw Patrol)" % nm, "Stuffed Animal", "Dog", None, licensed=True,
      franchise="Paw Patrol", aliases=[nm], sound="Yes", retired=True,
      notes="Nickelodeon Paw Patrol line, roughly 2016. Paw-activated sound box; check "
            "whether it still works before comparing comps. Catalogued from the "
            "CollectionHero index; no sourced price captured yet.")
for nm, sub in [("Paw Patrol Pup Pack", "Accessories"), ("Paw Patrol Jet Pack", "Accessories"),
                ("Paw Patrol Vest", "Clothing"), ("Paw Patrol Scuba Gear", "Costumes"),
                ("Paw Patrol Aviator Uniform", "Costumes")]:
    I(nm, "Clothing & Accessories", sub, None, licensed=True, franchise="Paw Patrol",
      notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- DC ----------------------------------------------------------------------
I("The Joker (DC)", "Stuffed Animal", "Character", 2017, licensed=True, franchise="DC",
  online_exclusive=True, limited_edition=True, aliases=["Joker"],
  notes="16 inch, Batman Day 2017 online exclusive. Catalogued from the CollectionHero "
        "index; no sourced price captured yet.")
I("Harley Quinn (DC)", "Stuffed Animal", "Character", 2017, licensed=True, franchise="DC",
  online_exclusive=True, limited_edition=True, aliases=["Harley Quinn"],
  notes="16 inch, Batman Day 2017 online exclusive. Catalogued from the CollectionHero "
        "index; no sourced price captured yet.")
I("Batgirl (DC)", "Stuffed Animal", "Character", 2015, licensed=True, franchise="DC",
  aliases=["Batgirl"],
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Batman (DC)", "Stuffed Animal", "Character", None, licensed=True, franchise="DC",
  aliases=["Batman"],
  notes="Several versions exist including unstuffed. Catalogued from the CollectionHero "
        "index; no sourced price captured yet.")

# --- TMNT (2016) -------------------------------------------------------------
# The existing combined Donatello/Leonardo record holds the sourced $28 comp and
# its ambiguity note; these are the individually confirmed products.
for nm in ["Raphael", "Michelangelo"]:
    I("%s (TMNT)" % nm, "Stuffed Animal", "Character", 2016, licensed=True,
      franchise="TMNT", aliases=[nm], retired=True,
      notes="Part of the 2016 set of four, sold with removable shell and character "
            "weapon; a reversible combat/cool face and sound box are noted on some. "
            "Catalogued from the CollectionHero index; no sourced price captured yet.")
I("TMNT Weapon Set", "Clothing & Accessories", "Props", 2016, licensed=True,
  franchise="TMNT",
  notes="Swords, sais, staff and nunchucks. Catalogued from the CollectionHero index; "
        "no sourced price captured yet.")

# --- Transformers ------------------------------------------------------------
for nm in ["Optimus Prime", "Bumblebee"]:
    I("%s (Transformers)" % nm, "Stuffed Animal", "Character", None, licensed=True,
      franchise="Transformers", aliases=[nm], sound="Yes",
      notes="16 inch. Jointed, flip-face and unstuffed variants noted - confirm which "
            "a comp refers to. Catalogued from the CollectionHero index; no sourced "
            "price captured yet.")
    I("%s Costume" % nm, "Clothing & Accessories", "Costumes", None, licensed=True,
      franchise="Transformers",
      notes="Two-piece suit and mask. Catalogued from the CollectionHero index; no "
            "sourced price captured yet.")

# --- SpongeBob ---------------------------------------------------------------
SPONGEBOB = [("SpongeBob SquarePants", "Character", None), ("Patrick Star", "Character", None),
             ("Sandy Cheeks", "Squirrel", "Smallfrys 10 inch."),
             ("Gary the Snail", "Snail", "7 inch, 2019.")]
for nm, sp, note in SPONGEBOB:
    I("%s (SpongeBob)" % nm, "Stuffed Animal", sp, None, licensed=True,
      franchise="SpongeBob SquarePants", aliases=[nm],
      notes=((note + " ") if note else "") +
            "Catalogued from the CollectionHero index; no sourced price captured yet.")
for nm in ["Pineapple House Playset", "Krabby Patty"]:
    I("%s (SpongeBob)" % nm, "Clothing & Accessories", "Props", None, licensed=True,
      franchise="SpongeBob SquarePants",
      notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Girl Scouts -------------------------------------------------------------
GIRL_SCOUTS = [
    ("Thin Mint Cookie Bear", 2021, "Stuffed Animal", "Bear"),
    ("Samoa Cookie Bear", 2013, "Stuffed Animal", "Bear"),
    ("S'mores Cookie Bear", 2021, "Stuffed Animal", "Bear"),
    ("Coconut Caramel Bear", 2019, "Stuffed Animal", "Bear"),
    ("Daisy Uniform with Shoes", 2021, "Clothing & Accessories", "Costumes"),
    ("Vest with Badges", None, "Clothing & Accessories", "Clothing"),
    ("Cookie Sleeper", None, "Clothing & Accessories", "Pajamas"),
    ("Thin Mint Hoodie and Denim Skirt", None, "Clothing & Accessories", "Clothing"),
    ("Blue Apron and Shorts", None, "Clothing & Accessories", "Clothing"),
]
for nm, yr, cat, sp in GIRL_SCOUTS:
    I("Girl Scouts %s" % nm, cat, sp, yr, licensed=True, franchise="Girl Scouts",
      notes="Girl Scouts tie-in, US. The Daisy uniform is noted as a 100-year "
            "anniversary edition. Catalogued from the CollectionHero index; no sourced "
            "price captured yet.")

# --- Advent calendars --------------------------------------------------------
I("Beary Merry Advent Calendar (2021)", "Clothing & Accessories", "Props", 2021,
  is_lot=True,
  notes="Gingerbread-house design with 6 mini plush and 19 clothing/accessory pieces. "
        "A multi-piece set, not a single-item comparable. Each year's calendar holds "
        "different contents and is priced apart from the 2022 edition.")
I("Beary Merry Advent Calendar (2022)", "Clothing & Accessories", "Props", 2022,
  is_lot=True,
  notes="Multi-piece set, not a single-item comparable. Contents differ from the 2021 "
        "edition, so the two are priced apart.")
I("Merry Mission Advent Calendar (2024)", "Clothing & Accessories", "Props", 2024,
  is_lot=True,
  notes="Glisten and the Merry Mission film tie-in; 25 pieces. Multi-piece set, not a "
        "single-item comparable.")

# --- Birthday line -----------------------------------------------------------
I("Yellow Birthday Bear", "Stuffed Animal", "Bear", 2010, retired=True,
  aliases=["Happy Birthday Bear"],
  notes="16 inch. Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Happy Birthday Cake Bear", "Stuffed Animal", "Bear", None,
  notes="Yellow with embroidered sprinkles. Catalogued from the CollectionHero index; "
        "no sourced price captured yet.")
I("Pink Birthday Celebration Bear", "Stuffed Animal", "Bear", None,
  notes="Embroidered cake and sprinkles. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")

# --- Beary Limited and other retired releases --------------------------------
BEARY_LIMITED = [
    ("Spring Frog", "Frog", None, "Produced in several colourways - Spring Green, Spring "
                                  "Pink, an online-exclusive Rainbow and a Hoppy Swirls "
                                  "variant. Split into separate items once comps "
                                  "distinguish them."),
    ("Farmers Market Sheep", "Lamb", None, None),
    ("Hearts Fur You Puppy", "Dog", 2008, "A jumbo size was also produced."),
    ("Be Mine Valentines Dalmatian", "Dog", 2010, None),
    ("Swirly Lamb", "Lamb", 2011, None),
    ("Oodles the Octopus", "Octopus", 2012, "Under the Sea collection."),
]
for nm, sp, yr, note in BEARY_LIMITED:
    I(nm, "Stuffed Animal", sp, yr, limited_edition=True,
      notes=((note + " ") if note else "") +
            "Beary Limited edition. Catalogued from the CollectionHero index; no "
            "sourced price captured yet.")

# --- Lil Furry Friends and Smallfrys -----------------------------------------
I("Coqui Frog (Lil Furry Friends)", "Stuffed Animal", "Frog", None,
  international_exclusive=True, rarity="Rare",
  aliases=["Puerto Rican Frog", "Coqui"],
  notes="Puerto Rico exclusive. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Mini Pumpkin Kitty Jack-O-Lantern", "Stuffed Animal", "Cat", None,
  notes="Lil Furry Friends mini. Related to the Pumpkin Kitty line but a different "
        "product and size - confirm before merging.")
I("Sanrio Lil Furry Friends Set", "Lot", "Character", 2010, licensed=True,
  franchise="Sanrio", is_lot=True, retired=True,
  notes="Multi-item set, not a single-item comparable.")
I("Wolf Pup", "Stuffed Animal", "Wolf", None,
  notes="Unstuffed variants noted. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Misfit Spotted Elephant", "Stuffed Animal", "Elephant", 2010, licensed=True,
  franchise="Rudolph the Red-Nosed Reindeer",
  notes="Smallfrys line. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Zombear", "Stuffed Animal", "Bear", None,
  notes="Smallfrys line. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Clydesdale Pony", "Stuffed Animal", "Horse", 2013,
  notes="Smallfrys line. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Squirtle (Pokemon)", "Stuffed Animal", "Character", None, licensed=True,
  franchise="Pokemon", aliases=["Squirtle"],
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Share Bear (Care Bears)", "Stuffed Animal", "Bear", None, licensed=True,
  franchise="Care Bears", aliases=["Share Bear"],
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Harajuku Hugs Panda", "Stuffed Animal", "Panda", None, licensed=True,
  franchise="Harajuku Lovers",
  notes="Gwen Stefani tie-in; sold with a doll in some listings. Catalogued from the "
        "CollectionHero index; no sourced price captured yet.")

# --- 2008 zoo and wildlife releases ------------------------------------------
I("North American River Otter", "Stuffed Animal", "Otter", 2008, sound="Yes",
  notes="2008-09 model with sound. May overlap with the River Otter and St. Louis Zoo "
        "Otter records - confirm before merging any of them.")
I("Black Bear (Wildcare Institute)", "Stuffed Animal", "Bear", 2008, event_exclusive=True,
  notes="St. Louis Zoo Wildcare Institute exclusive, sold with a medallion. Catalogued "
        "from the CollectionHero index; no sourced price captured yet.")
I("Brown Otter (St. Louis Zoo)", "Stuffed Animal", "Otter", 2008, event_exclusive=True,
  notes="St. Louis Zoo exclusive. May overlap with the other otter records - confirm "
        "before merging.")

# --- Sleepwear and outfits ---------------------------------------------------
PAJAMAS = [
    ("Sonic the Hedgehog 3 Pajamas", "Sonic"),
    ("Vaporeon Pokeball Sleeper", "Pokemon"),
    ("Sylveon Cape Sleeper", "Pokemon"),
    ("Umbreon and Espeon Pajama Set", "Pokemon"),
    ("Flareon Pajamas", "Pokemon"),
    ("Keroppi Pajamas", "Sanrio"),
    ("Kuromi Halloween Pajamas", "Sanrio"),
    ("Hello Kitty Valentine's Pajamas", "Sanrio"),
    ("Hello Kitty 25th Anniversary Pajamas", "Sanrio"),
    ("FRIENDS Christmas Pajamas", "FRIENDS"),
    ("Harajuku Hugs Panda Pajamas", "Harajuku Lovers"),
]
for nm, fr in PAJAMAS:
    I(nm, "Clothing & Accessories", "Pajamas", None, licensed=True, franchise=fr,
      notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Christmas Reindeer Pajamas", "Clothing & Accessories", "Pajamas", None,
  notes="Red, white and green stripe. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("Blue Bunny Suit", "Clothing & Accessories", "Costumes", None,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Scents ------------------------------------------------------------------
# Sold separately at retail and frequently included with a bear, which changes
# what a comp represents - the completeness field is what tracks that.
for nm in ["Lavender", "Strawberry", "Vanilla", "Cotton Candy", "Birthday Cake",
           "Pumpkin", "Apple"]:
    I("%s Scent" % nm, "Clothing & Accessories", "Props", None,
      scent=nm, aliases=["%s SCENTiment" % nm],
      notes="Scent insert, sold separately at retail. Catalogued from the "
            "CollectionHero index; no sourced price captured yet.")


# --- 2018 releases -----------------------------------------------------------
I("Kabu Bearnard", "Stuffed Animal", "Bear", 2018, aliases=["Bearnard"],
  notes="Kabu line. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Doctor Who 10th Doctor Bear", "Stuffed Animal", "Bear", 2018, licensed=True,
  franchise="Doctor Who", international_exclusive=True,
  notes="BBC exclusive set with costume and sonic screwdriver. Catalogued from the "
        "CollectionHero index; no sourced price captured yet.")
I("Meatlug the Gronckle", "Stuffed Animal", "Dragon", 2018, licensed=True,
  franchise="How to Train Your Dragon", aliases=["Meatlug", "Gronckle"],
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Longhorn II", "Stuffed Animal", "Longhorn", 2018, version="II",
  notes="Texas steer. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Rainbow Dash", "Stuffed Animal", "Character", 2018, licensed=True,
  franchise="My Little Pony",
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- 2021 sweep --------------------------------------------------------------
I("Happy Hugs IV Teddy", "Stuffed Animal", "Bear", None, version="IV",
  notes="Light brown. One of a numbered Happy Hugs series - earlier versions are not "
        "yet catalogued. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Pink Power Ranger", "Stuffed Animal", "Character", None, licensed=True,
  franchise="Power Rangers", retired=True,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("South Africa Beary Best Leopard", "Stuffed Animal", "Leopard", 2007,
  international_exclusive=True, retired=True,
  notes="From the South African 'Beary Best 5' series, retired 2007. Catalogued from "
        "the CollectionHero index; no sourced price captured yet.")
I("South Africa Beary Best Elephant", "Stuffed Animal", "Elephant", 2007,
  international_exclusive=True, retired=True,
  notes="From the South African 'Beary Best 5' series, retired 2007. The remaining "
        "three of the five are not yet identified. Catalogued from the CollectionHero "
        "index; no sourced price captured yet.")
I("Baby Panther", "Stuffed Animal", "Panda", None, rarity="Rare",
  notes="Blue eyes, described as a Beary exclusive edition. Catalogued from the "
        "CollectionHero index; no sourced price captured yet.")
I("Black and White Puppy", "Stuffed Animal", "Dog", None, rarity="Rare",
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Halloween Pumpkin Nose Bear", "Stuffed Animal", "Bear", None, limited_edition=True,
  rarity="Rare",
  notes="Orange pumpkin nose. Possibly related to the Autumn Hugs 'pumpkin nose' bear - "
        "confirm before merging. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")

# --- Easter and spring -------------------------------------------------------
I("Cherry Blossom Bunny", "Stuffed Animal", "Bunny", 2013,
  notes="Distinct from the 2011 Cherry Blossom Teddy already catalogued. Catalogued "
        "from the CollectionHero index; no sourced price captured yet.")
I("Snuggly Bunny (White Pawlette)", "Stuffed Animal", "Bunny", 2020,
  aliases=["White Pawlette", "Snuggly Bunny"],
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Peeps Spring Frog Family (Mini Buddies)", "Lot", "Frog", None, licensed=True,
  franchise="Peeps", is_lot=True,
  notes="Mini Buddies multi-piece Easter set, not a single-item comparable.")

# --- Valentine ---------------------------------------------------------------
I("Hello Kitty Valentine Pink Hearts", "Stuffed Animal", "Character", 2013, licensed=True,
  franchise="Sanrio", limited_edition=True,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Hello Kitty 40th Anniversary Confetti Love", "Stuffed Animal", "Character", None,
  licensed=True, franchise="Sanrio", limited_edition=True,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("White and Red Patchwork Puppy", "Stuffed Animal", "Dog", None,
  notes="Valentine colourway. Distinct from the pink Patchwork Hearts Puppy - confirm "
        "before merging. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")

# --- Shoes and footwear ------------------------------------------------------
SHOES = [
    ("Dorothy Shoes", 2007, "Wizard of Oz"),
    ("Chococat Shoes", 2010, "Sanrio"),
    ("Chococat High Top Converse", None, "Sanrio"),
    ("Chococat Raincoat and Boots", 2010, "Sanrio"),
    ("Keroppi Sneakers", 2010, "Sanrio"),
    ("My Melody Shoes", 2010, "Sanrio"),
    ("Hello Kitty Shoes", 2014, "Sanrio"),
    ("Hello Kitty 25th Anniversary White Tennis Shoes", None, "Sanrio"),
    ("Barbie Movie Tennis Shoes", None, "Barbie"),
    ("Barbie Movie Bunny Slippers", None, "Barbie"),
    ("Barbie Movie Dress Shoes", None, "Barbie"),
    ("Sonic Gold Ring and Shoes", None, "Sonic"),
]
for nm, yr, fr in SHOES:
    I(nm, "Clothing & Accessories", "Shoes", yr, licensed=True, franchise=fr,
      notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Pumpkin Kitty Glitter Flower Shoes", "Clothing & Accessories", "Shoes", 2008,
  notes="White with silver glitter flowers, sold with the 2008 Pumpkin Kitty. "
        "Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Accessibility accessories -----------------------------------------------
# A genuine Build-A-Bear line, and one collectors search for by name.
I("Foldable Wheelchair", "Clothing & Accessories", "Props", 2021,
  aliases=["Wild Wheels Wheelchair"],
  notes="Blue and yellow collapsible wheelchair; also fits 12-18 inch dolls. Grey and "
        "other colourways noted. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Crutches and Cast Set", "Clothing & Accessories", "Props", 2021,
  notes="Medical accessory set, sold alongside the wheelchair. Catalogued from the "
        "CollectionHero index; no sourced price captured yet.")


# --- Disney Stitch -----------------------------------------------------------
I("Stitch (Disney)", "Stuffed Animal", "Character", None, licensed=True,
  franchise="Disney", aliases=["Stitch"],
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Giant Stitch (25-inch)", "Stuffed Animal", "Character", 2023, licensed=True,
  franchise="Disney", online_exclusive=True,
  notes="Giant size, with a 3ft variant also noted. Size variants price separately. "
        "Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Disney100 Stitch Celebration", "Stuffed Animal", "Character", 2024, licensed=True,
  franchise="Disney", limited_edition=True,
  notes="Disney100 anniversary release. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("Snowflake Fun Stitch", "Stuffed Animal", "Character", 2025, licensed=True,
  franchise="Disney", sound="Yes", scent="Yes",
  notes="Sold with scent and sound. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")

# --- Minions / Despicable Me -------------------------------------------------
for nm in ["Kevin", "Stuart", "Bob"]:
    I("%s (Minions)" % nm, "Stuffed Animal", "Character", 2015, licensed=True,
      franchise="Minions", aliases=[nm], sound="Yes",
      notes="Minions line, roughly 2015-2016 with later restocks. Catalogued from the "
            "CollectionHero index; no sourced price captured yet.")
I("Fluffy the Unicorn", "Stuffed Animal", "Unicorn", None, licensed=True,
  franchise="Minions",
  notes="From Despicable Me 3. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Tim Bear (Minions)", "Stuffed Animal", "Bear", None, licensed=True,
  franchise="Minions",
  notes="Bob's teddy bear. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
for nm in ["Minion Overalls", "Minion Guitar", "Minion Banana"]:
    I(nm, "Clothing & Accessories", "Props" if nm != "Minion Overalls" else "Clothing",
      None, licensed=True, franchise="Minions",
      notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

I("Toy Story Bear", "Stuffed Animal", "Bear", None, licensed=True,
  franchise="Disney / Pixar", sound="Yes",
  notes="Sold with outfit, hat and sound. Catalogued from the CollectionHero index; "
        "no sourced price captured yet.")

# --- Shark Week and aquatic --------------------------------------------------
SHARKS = [
    ("Hammerhead Shark", "Shark", 2018, True,
     "Shark Week 30th anniversary limited edition - the most collected of the sharks."),
    ("Great White Shark", "Shark", 2018, False, "Shark Week."),
    ("Spotted Shark", "Shark", None, False, "Shark Week."),
    ("Toothy Shark", "Shark", 2020, False, "Shark Week."),
    ("Blue Lobster", "Lobster", 2020, False, "Shark Week."),
]
for nm, sp, yr, le, note in SHARKS:
    I(nm, "Stuffed Animal", sp, yr, licensed=True, franchise="Shark Week",
      limited_edition=le,
      notes=note + " Catalogued from the CollectionHero index; no sourced price "
                   "captured yet.")
I("Shamu Orca (SeaWorld)", "Stuffed Animal", "Whale", None, event_exclusive=True,
  aliases=["Shamu", "Killer Whale"],
  notes="SeaWorld exclusive. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")

NARWHALS = [("Sparkle Narwhal", 2018), ("Mystical Narwhal", None),
            ("Teal Glitter Narwhal", None)]
for nm, yr in NARWHALS:
    I(nm, "Stuffed Animal", "Narwhal", yr,
      notes="Several narwhal colourways exist and listing titles blur them - confirm "
            "which a comp refers to. Catalogued from the CollectionHero index; no "
            "sourced price captured yet.")

# --- Sloths, including subscription-box and store exclusives -----------------
SLOTHS = [
    ("Brown Sloth (15-inch)", None, "Walmart store exclusive. A separate item from the "
                                    "18 inch version - sizes are priced apart.",
     dict(store_exclusive=True)),
    ("Brown Sloth (18-inch)", None, "Distinct from the 15 inch Walmart exclusive; "
                                    "sizes are priced apart.", {}),
    ("Peppermint Twist Sloth", 2019, "A Christmas family set with mini ornament was "
                                     "also produced.", {}),
    ("Rainbow Sloth", 2021, "Spring 2021 Cubscription Box exclusive. UNRESOLVED: the "
                            "index also lists a Heartables Rainbow Sloth, catalogued "
                            "separately. They may be the same product described two "
                            "ways - confirm before merging or pricing either.", {}),
    ("Multicolor Sloth", 2021, "Spring 2021 Cubscription Box exclusive.", {}),
    ("Mini Fluffy Sloth (9-inch)", 2019, "Blue and purple colourways noted.", {}),
]
for nm, yr, note, flags in SLOTHS:
    I(nm, "Stuffed Animal", "Sloth", yr,
      notes=((note + " ") if note else "") +
            "Catalogued from the CollectionHero index; no sourced price captured yet.",
      **flags)
I("Sid the Sloth", "Stuffed Animal", "Sloth", None, licensed=True, franchise="Ice Age",
  notes="16 inch, Ice Age Continental Drift. Catalogued from the CollectionHero index; "
        "no sourced price captured yet.")
I("Loth-Cat (Star Wars)", "Stuffed Animal", "Cat", None, licensed=True,
  franchise="Star Wars",
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Theme park exclusives ---------------------------------------------------
PARK = [
    ("Yeti (Busch Gardens)", "Yeti", "Busch Gardens exclusive, also sold unstuffed.",
     ["Snow Monster"]),
    ("Highland Cow (SeaWorld / Busch Gardens)", "Cow",
     "SeaWorld and Busch Gardens exclusive.", ["Highland Cow"]),
    ("Cheetah (Busch Gardens)", "Cheetah", "Busch Gardens exclusive.", []),
    ("Iron Gwazi Monkey", "Monkey",
     "Busch Gardens Tampa Bay, tied to the Iron Gwazi coaster.", []),
]
for nm, sp, note, al in PARK:
    I(nm, "Stuffed Animal", sp, None, event_exclusive=True, aliases=al, rarity="Exclusive",
      notes=note + " Catalogued from the CollectionHero index; no sourced price "
                   "captured yet.")

# --- Japan exclusives and 2022 releases --------------------------------------
I("My Melody (Japan)", "Stuffed Animal", "Character", 2022, licensed=True,
  franchise="Sanrio", international_exclusive=True,
  notes="Japan-exclusive collaboration, distinct from the 2010 My Melody already "
        "catalogued. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Shiba Inu (Japan)", "Stuffed Animal", "Dog", 2022, international_exclusive=True,
  version="V1", rarity="Rare",
  notes="Japan-exclusive; a V1 leather-nose variant is noted, so nose style may "
        "distinguish versions. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Kokoro (Japan)", "Stuffed Animal", "Bear", 2022, international_exclusive=True,
  notes="Japan-exclusive. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Chef Karl", "Stuffed Animal", "Bear", 2022, store_exclusive=True,
  notes="Bissinger Chocolatier collaboration. Catalogued from the CollectionHero index; "
        "no sourced price captured yet.")
FORD = [("Ford Mustang 50 Years Horse", "50th anniversary edition."),
        ("Black Mustang Horse", "Rare variant, scarf option noted."),
        ("Grey Mustang Horse", "50th anniversary edition.")]
for nm, note in FORD:
    I(nm, "Stuffed Animal", "Horse", 2022, licensed=True, franchise="Ford",
      limited_edition=True,
      notes=note + " Distinct from the 2011 Ford Mustang 'Bossy' already catalogued. "
                   "Catalogued from the CollectionHero index; no sourced price "
                   "captured yet.")

# --- NASCAR and motorsport ---------------------------------------------------
NASCAR = [
    ("Jeff Gordon NASCAR Bear", "Bear", "Sold with a retired NASCAR outfit."),
    ("Dupont Racing Border Collie", "Dog", "Dupont Racing #24."),
    ("NASCAR Groundhog", "Groundhog", None),
    ("NASCAR Turtle", "Turtle", "Sold with a backpack."),
]
for nm, sp, note in NASCAR:
    I(nm, "Stuffed Animal", sp, None, licensed=True, franchise="NASCAR",
      notes=((note + " ") if note else "") +
            "Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Hot Wheels Plush Race Car", "Stuffed Animal", "Vehicle", 2018, licensed=True,
  franchise="Hot Wheels", aliases=["Hot Wheels Race Car #3"],
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
for nm, fr in [("NCAA Texas Longhorns Sweatshirt", "NCAA"),
               ("NHL Philadelphia Flyers Hoodie", "NHL"),
               ("NASCAR Racing Jumpsuit", "NASCAR")]:
    I(nm, "Clothing & Accessories", "Clothing", None, licensed=True, franchise=fr,
      notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Halloween, seasonal and occasion ----------------------------------------
I("Howl-o-Ween Werewolf", "Stuffed Animal", "Werewolf", 2019,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Bearclops", "Stuffed Animal", "Cryptid", None,
  notes="Halloween collection. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Nessie", "Stuffed Animal", "Cryptid", None, aliases=["Loch Ness Monster"],
  notes="Distinct from the Sea Monster Mini Bean - confirm before merging. Catalogued "
        "from the CollectionHero index; no sourced price captured yet.")
I("Derpy Hooves", "Stuffed Animal", "Character", None, licensed=True,
  franchise="My Little Pony",
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Tardigrade Water Bear", "Stuffed Animal", "Tardigrade", None,
  notes="Full-size release, sold with a bandana. Distinct from the Mint Tardigrade "
        "Mini Bean. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Oh, the Places You'll Go! Graduation Bear", "Stuffed Animal", "Bear", 2021,
  licensed=True, franchise="Dr. Seuss",
  notes="Class of 2021 gift set with gown, cap, diploma and sash. Catalogued from the "
        "CollectionHero index; no sourced price captured yet.")
I("Graduation Gown", "Clothing & Accessories", "Costumes", None,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")


# --- My Little Pony ----------------------------------------------------------
MLP = [
    ("Princess Cadance", 2015, "Pink unicorn."),
    ("Princess Celestia", 2015, None),
    ("Princess Luna", None, "Dark unicorn."),
    ("Twilight Sparkle", 2017, None),
    ("Rarity", 2014, None),
    ("Sweetie Belle", None, "White unicorn."),
    ("Shining Armor", None, "Sold with outfit."),
    ("Sunset Shimmer", None, "Yellow unicorn."),
    ("Big Macintosh", 2017, None),
    ("Spike", None, "Baby dragon."),
]
for nm, yr, note in MLP:
    I("%s (My Little Pony)" % nm, "Stuffed Animal",
      "Dragon" if nm == "Spike" else "Unicorn", yr, licensed=True,
      franchise="My Little Pony", aliases=[nm],
      notes=((note + " ") if note else "") +
            "Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- How to Train Your Dragon ------------------------------------------------
I("Toothless", "Stuffed Animal", "Dragon", None, licensed=True,
  franchise="How to Train Your Dragon", limited_edition=True,
  notes="Special edition. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Light Fury", "Stuffed Animal", "Dragon", None, licensed=True,
  franchise="How to Train Your Dragon", limited_edition=True,
  notes="Special edition. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Night Lights (Set of 3)", "Lot", "Dragon", None, licensed=True,
  franchise="How to Train Your Dragon", is_lot=True,
  notes="Baby dragons from The Hidden World, sold as a set of three. Multi-item set, "
        "not a single-item comparable.")

# --- Cubscription Box exclusives ---------------------------------------------
# A subscription line: the plush is often only available in the box, which makes
# these scarcer than their retail-looking descriptions suggest.
CUBSCRIPTION = [
    ("Don't Worry Be Hoppy Frog", "Frog", 2021, "Summer 2021 box, with matching shirt."),
    ("Good Vibes Fox", "Fox", 2021, "Autumn 2021 box, with shirts, stickers, playmat "
                                    "and thermos."),
    ("Hawaiian Shirt Axolotl", "Axolotl", 2022, "Summer 2022 box."),
    ("Believe in Meowgic Kitty", "Cat", 2022, "Fall 2022 box; glow-in-the-dark black cat."),
    ("Curly Valentine Teddy", "Bear", None, "Valentine box; curly fur."),
]
for nm, sp, yr, note in CUBSCRIPTION:
    I("%s (Cubscription)" % nm, "Stuffed Animal", sp, yr, online_exclusive=True,
      notes=note + " Cubscription Box exclusive - the plush was generally not sold at "
                   "retail, so box-only releases can be scarcer than they look. "
                   "Catalogued from the CollectionHero index; no sourced price "
                   "captured yet.")

# --- Hot Topic exclusives ----------------------------------------------------
I("Furry N' Fierce Bear", "Stuffed Animal", "Bear", 2017, store_exclusive=True,
  limited_edition=True,
  notes="Hot Topic limited edition. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("Goth Punk Bear", "Stuffed Animal", "Bear", 2017, store_exclusive=True,
  notes="Hot Topic. Emo/punk styling with a pink mohawk; produced in two sizes, which "
        "price separately. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")

# --- More 2017 ---------------------------------------------------------------
I("Giant Champ", "Stuffed Animal", "Bear", 2017,
  notes="Jumbo size. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Boo-rific Ghost", "Stuffed Animal", "Ghost", 2017, online_exclusive=True, retired=True,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Dogs --------------------------------------------------------------------
I("Husky (2009)", "Stuffed Animal", "Dog", 2009,
  notes="Distinct from the Promise Pets Husky and the Paw Patrol Everest. Catalogued "
        "from the CollectionHero index; no sourced price captured yet.")
I("Great Wolf Lodge Husky Pup", "Stuffed Animal", "Dog", None, event_exclusive=True,
  rarity="Exclusive",
  notes="Great Wolf Lodge partnership exclusive. Catalogued from the CollectionHero "
        "index; no sourced price captured yet.")
I("Blue Husky Wolf Pup", "Stuffed Animal", "Wolf", None,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Unicorns ----------------------------------------------------------------
I("Jumbo Pink Unicorn", "Stuffed Animal", "Unicorn", None,
  notes="Jumbo size, also sold unstuffed. Catalogued from the CollectionHero index; "
        "no sourced price captured yet.")
I("Color Craze Rainbow Unicorn", "Stuffed Animal", "Unicorn", None,
  notes="Color Craze line. Distinct from the Rainbow Unicorn Mini Bean. Catalogued "
        "from the CollectionHero index; no sourced price captured yet.")

# --- Jumbo and store-display sizes -------------------------------------------
# Size is a price driver in its own right, so jumbo releases are their own items.
I("Jumbo Frosty the Snowman", "Stuffed Animal", "Character", None, licensed=True,
  franchise="Frosty the Snowman",
  notes="Jumbo size, priced apart from the standard release. Catalogued from the "
        "CollectionHero index; no sourced price captured yet.")
I("Jumbo Rudolph (36-inch)", "Stuffed Animal", "Reindeer", None, licensed=True,
  franchise="Rudolph the Red-Nosed Reindeer",
  notes="36 inch store-display size. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("Glittery Kitty", "Stuffed Animal", "Cat", None, rarity="Rare",
  notes="Described as ultra rare. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Plush Stuffing Machine", "Clothing & Accessories", "Furniture", None,
  notes="Toy stuffing machine playset. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")


# ---------------------------------------------------------------------------
# Upcoming and current releases
#
# Announced products, tracked before any secondary market exists. Nothing here
# has a sold price and nothing here gets one: an item that has not been resold
# has no resale value, and pre-release sales are hype, not market evidence.
#
# Announced retail prices belong in announced_msrp, which is retail reference
# data and is never treated as resale value (handoff section 24).
# ---------------------------------------------------------------------------

TOYBOOK = "https://toybook.com/build-a-bear-2026-halloween-launch/"
PRESS = ("https://ir.buildabear.com/news-releases/news-release-details/"
         "spooky-stuff-you-love-collection-returns-build-bear-workshopr")

# 2026 "Spooky Stuff You Love" Halloween collection - announced August 2026 and
# reported as available at launch.
HALLOWEEN_2026 = [
    ("Jumping Spider", "Spider", "Headlines the collection. Also released as a Mini "
                                 "Bean and a bag charm - three different products."),
    ("Midnight Bat", "Bat", None),
    ("Poseable Bat", "Bat", "Returning favourite."),
    ("Batty Kitty", "Cat", "Returning favourite."),
    ("Pumpkin Pal Teddy", "Bear", "Returning favourite. Not the same item as the 2008 "
                                  "Original Pumpkin Kitty or its Vault reissues."),
    ("Mystical Werewolf", "Werewolf", None),
    ("Enchanting Kitty", "Cat", None),
    ("Owloween Cauldron Mashimal", "Owl", "Mashimals line."),
]
for nm, sp, note in HALLOWEEN_2026:
    I("%s (2026 Halloween)" % nm, "Stuffed Animal", sp, 2026, aliases=[nm],
      release_status="current", expected_release="2026-08",
      announcement_source=TOYBOOK,
      notes=((note + " ") if note else "") +
            "2026 'Spooky Stuff You Love' Halloween collection, announced August 2026 "
            "and reported as available at launch. No secondary market yet.")

# The Halloween Mini Beans assortment. Candy Corn Longhorn and the Jumping Spider
# Mini Bean are already catalogued from the 2025/2026 collector guides.
for nm, sp in [("Midnight Bat", "Bat"), ("Mystical Werewolf", "Werewolf"),
               ("Batty Kitty", "Cat")]:
    I("%s (Mini Beans 2026)" % nm, "Mini Bean", sp, 2026, mini_bean=True,
      release_status="current", expected_release="2026-08", announcement_source=TOYBOOK,
      notes="Part of the 2026 Halloween Mini Beans assortment. No secondary market yet.")

# Frosted Animal Cookie collection.
for nm, sp in [("Frosted Animal Cookie Giraffe", "Giraffe"),
               ("Frosted Animal Cookie Camel", "Camel")]:
    I(nm, "Stuffed Animal", sp, 2026, release_status="current",
      announcement_source=TOYBOOK,
      notes="Frosted Animal Cookie collection, inspired by pink-and-white frosted "
            "animal cookies. Make-your-own format. No secondary market yet.")
for nm, sp in [("Frosted Animal Cookie Giraffe", "Giraffe"),
               ("Frosted Animal Cookie Camel", "Camel"),
               ("Frosted Animal Cookie Lion", "Lion")]:
    I("%s (Mini Beans)" % nm, "Mini Bean", sp, 2026, mini_bean=True,
      release_status="current", announcement_source=TOYBOOK,
      notes="Frosted Animal Cookie Mini Beans assortment. No secondary market yet.")

# Announced but not yet in hand.
I("Werebears Take Tokyo (Blind Box)", "Stuffed Animal", "Bear", 2026,
  release_status="upcoming", limited_edition=True, announcement_source=TOYBOOK,
  notes="Blind-box plush range announced for 2026. Blind boxes create per-character "
        "scarcity that only becomes visible once pull rates are known - expect wide "
        "price spreads between characters, and do not price the range as one item.")


# --- Heartables (blind bag / mystery line) -----------------------------------
# Sold blind, so per-character scarcity is set by pull rates rather than by
# production numbers. Do not price the line as one item.
HEARTABLES = [
    ("Sprinkle", "Unicorn", "Unicorn Land series, blue heart, with sound."),
    ("Bubbles", "Unicorn", "Unicorn Land series, blue heart. Do not confuse with "
                           "the Powerpuff Girls Bubbles - unrelated character."),
    ("Dottie", "Unicorn", "Unicorn Land series, pink heart."),
    ("Kiki Koala", "Koala", "Safari Stripes series."),
    ("Sapphire Sloth", "Sloth", "Safari Stripes series."),
    ("Rainbow Sloth", "Sloth", "Blue, pink and rainbow colourways noted. UNRESOLVED: "
                               "may be the same product as the 2021 Cubscription "
                               "Rainbow Sloth - confirm before merging."),
    ("Striped Heart Panda", "Panda", "Pink, blue and purple striped."),
]
for nm, sp, note in HEARTABLES:
    # No bare alias: several of these names (Bubbles, Rainbow Sloth) also belong
    # to unrelated items, and an alias that identifies two items identifies none.
    I("%s (Heartables)" % nm, "Stuffed Animal", sp, None,
      notes=note + " Heartables blind-bag line - characters were sold sealed, so "
                   "scarcity depends on pull rates. Catalogued from the CollectionHero "
                   "index; no sourced price captured yet.")

# --- Lisa Frank --------------------------------------------------------------
LISA_FRANK = [
    ("Hunter Leopard", "Leopard", "Jumbo Beans size, 22-23 inch."),
    ("Alien Bear", "Alien", "18 inch, bright green."),
    ("Rainbow Giraffe", "Giraffe", "Wild Style; 18 and 20 inch sizes noted."),
    ("Rainbow Panda", "Panda", None),
    ("Rainbow Leopard", "Leopard", "17 inch."),
    ("Tiger Striped Rainbow Cat", "Cat", "16 inch."),
    ("Rainbow Hearts Bear", "Bear", "17 inch, hearts and popsicles."),
    ("Reversible Heart Surprise Bear", "Bear", "9 inch."),
    ("Rainbow Zebra", "Zebra", None),
]
for nm, sp, note in LISA_FRANK:
    I("%s (Lisa Frank)" % nm, "Stuffed Animal", sp, None, licensed=True,
      franchise="Lisa Frank", aliases=[nm],
      notes=((note + " ") if note else "") +
            "Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Animal Crossing (2021) --------------------------------------------------
for nm in ["Isabelle", "Tom Nook"]:
    I("%s (Animal Crossing)" % nm, "Stuffed Animal", "Character", 2021, licensed=True,
      franchise="Animal Crossing", aliases=[nm], sound="Yes",
      notes="New Horizons tie-in. Sold with phrase and music sound chips, and as gift "
            "bundles - confirm what a comp included. Catalogued from the CollectionHero "
            "index; no sourced price captured yet.")

# --- Sports teams ------------------------------------------------------------
SPORTS = [
    ("Boston Red Sox Teddy", "Bear", "MLB", "12 inch."),
    ("St. Louis Cardinals Clydesdale", "Horse", "MLB", "18 inch, with sound."),
    ("St. Louis Cardinals Dugout Dog", "Dog", "MLB", "Musical. Retired."),
    ("Mr. Met", "Character", "MLB", "New York Mets mascot, 24 inch. Retired."),
    ("Chicago Cubs Clark", "Bear", "MLB", "Cubs mascot."),
    ("Kansas City Royals Koala", "Koala", "MLB", "12 inch."),
    ("Puerto Rico Baseball Bear", "Bear", "MLB", "Sold with outfit. Described as rare."),
]
for nm, sp, fr, note in SPORTS:
    I(nm, "Stuffed Animal", sp, None, licensed=True, franchise=fr,
      notes=((note + " ") if note else "") +
            "Team tie-in. Catalogued from the CollectionHero index; no sourced price "
            "captured yet.")
for nm, fr in [("Los Angeles Dodgers Uniform", "MLB"),
               ("Carolina Hurricanes Hoodie", "NHL")]:
    I(nm, "Clothing & Accessories", "Clothing", None, licensed=True, franchise=fr,
      notes="Team apparel. Catalogued from the CollectionHero index; no sourced price "
            "captured yet.")

# --- 2016 licensed sets ------------------------------------------------------
for nm in ["Blossom", "Bubbles", "Buttercup"]:
    # "Bubbles" alone is ambiguous with the Heartables unicorn, so it is not an alias.
    I("%s (Powerpuff Girls)" % nm, "Stuffed Animal", "Character", 2016, licensed=True,
      franchise="Powerpuff Girls", aliases=[] if nm == "Bubbles" else [nm],
      notes="Sold with character dress. Catalogued from the CollectionHero index; no "
            "sourced price captured yet.")
GHOSTBUSTERS = [("Ghostbuster Bear", "Bear", "Sold with proton pack."),
                ("Stay Puft Marshmallow Man", "Character", None),
                ("Slimer", "Character", None)]
for nm, sp, note in GHOSTBUSTERS:
    I("%s (Ghostbusters)" % nm, "Stuffed Animal", sp, 2016, licensed=True,
      franchise="Ghostbusters", limited_edition=True, aliases=[nm],
      notes=((note + " ") if note else "") +
            "Limited edition. Catalogued from the CollectionHero index; no sourced "
            "price captured yet.")
I("Miles 'Tails' Prower (2016)", "Stuffed Animal", "Character", 2016, licensed=True,
  franchise="Sonic", aliases=["Tails"],
  notes="Sonic 25th anniversary release. Distinct from the 2024 film Tails - different "
        "product, different market. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("Maleficent Dragon", "Stuffed Animal", "Dragon", 2016, licensed=True,
  franchise="Disney", limited_edition=True,
  notes="Disney Villains, sold with a scepter. Catalogued from the CollectionHero "
        "index; no sourced price captured yet.")
for nm in ["Minty", "DJ Pon-3"]:
    I("%s (My Little Pony)" % nm, "Stuffed Animal", "Unicorn", 2015, licensed=True,
      franchise="My Little Pony", aliases=[nm],
      notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- 2015 --------------------------------------------------------------------
I("Crumbs Sugar Cookie", "Stuffed Animal", "Character", 2015, licensed=True,
  franchise="Lalaloopsy", sound="Yes",
  notes="19 inch, with sound box and accessories. Catalogued from the CollectionHero "
        "index; no sourced price captured yet.")
I("Snoopy (Flying Ace)", "Stuffed Animal", "Dog", 2015, licensed=True, franchise="Peanuts",
  aliases=["Snoopy"],
  notes="Peanuts Movie tie-in, sold with flying ace outfit and a Woodstock companion. "
        "Catalogued from the CollectionHero index; no sourced price captured yet.")
I("The Grinch", "Stuffed Animal", "Character", 2015, licensed=True, franchise="Dr. Seuss",
  notes="Sold alongside Max the Dog. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("Max the Dog (Grinch)", "Stuffed Animal", "Dog", 2015, licensed=True,
  franchise="Dr. Seuss",
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Somebunny Loves You Bunny", "Stuffed Animal", "Bunny", 2015,
  notes="Embroidered brown bunny. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Seashell Bear", "Stuffed Animal", "Bear", 2015, store_exclusive=True,
  notes="Myrtle Beach exclusive. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")

# --- 2003 --------------------------------------------------------------------
I("Kisses For You Teddy", "Stuffed Animal", "Bear", 2003,
  notes="Magnetic-kiss variant noted. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("Lucky Teddy (St. Patrick's Day)", "Stuffed Animal", "Bear", 2003, limited_edition=True,
  aliases=["St. Patrick's Day Bear"],
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Good Luck Bear (Care Bears)", "Stuffed Animal", "Bear", 2003, licensed=True,
  franchise="Care Bears", limited_edition=True, aliases=["Good Luck Bear"],
  notes="Care Bears 20th anniversary collector's edition. Catalogued from the "
        "CollectionHero index; no sourced price captured yet.")
I("CollectiBear V", "Stuffed Animal", "Bear", 2003, limited_edition=True, version="V",
  notes="Described as the finale of the Teddy Bear Centennial CollectiBear series - "
        "which suggests I through IV also exist and are not yet catalogued.")
I("Holiday Pals Snowman", "Stuffed Animal", "Snowman", 2003,
  notes="9 inch variant noted. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
for nm, sp in [("WWF Lion", "Lion"), ("WWF Amur Leopard", "Leopard")]:
    I(nm, "Stuffed Animal", sp, 2003, licensed=True, franchise="WWF / Wildlife",
      notes="WWF conservation series. Catalogued from the CollectionHero index; no "
            "sourced price captured yet.")

# --- 2006 --------------------------------------------------------------------
I("Ring-Tailed Lemur (St. Louis Zoo)", "Stuffed Animal", "Lemur", 2006,
  event_exclusive=True, retired=True, rarity="Rare",
  notes="Distinct from the Black and White Ruffed Lemur. Catalogued from the "
        "CollectionHero index; no sourced price captured yet.")
I("Cream Cub", "Stuffed Animal", "Bear", 2006,
  notes="Frequently found unstuffed. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("Singing Birthday Bear", "Stuffed Animal", "Bear", 2006, retired=True, sound="Yes",
  notes="19 inch, sings Happy Birthday. Distinct from the plain Birthday Bear. "
        "Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Build-A-Dino Orange", "Stuffed Animal", "Dinosaur", 2006, rarity="Rare",
  aliases=["Build A Dino"],
  notes="From the Build-A-Dino line. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("Purrfect Garden Bunny", "Stuffed Animal", "Bunny", 2006, rarity="Rare",
  notes="8 inch. Listing titles associate it with the Vanilla Fudge Bunny line - "
        "confirm before merging. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Hello Kitty Kimono", "Stuffed Animal", "Character", 2006, licensed=True,
  franchise="Sanrio",
  notes="Sold in a pink kimono with fan. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")

# --- 2009 --------------------------------------------------------------------
I("German American Festival Raccoon", "Stuffed Animal", "Raccoon", 2009,
  event_exclusive=True, rarity="Exclusive",
  notes="Toledo, Ohio festival exclusive. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("Black Scottie Dog", "Stuffed Animal", "Dog", 2009, international_exclusive=True,
  notes="UK release. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Mini Baby Otter (St. Louis Zoo)", "Stuffed Animal", "Otter", 2009, event_exclusive=True,
  notes="7 inch zoo collection size. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("Giggly Piggly", "Stuffed Animal", "Pig", 2009,
  notes="16 inch, pink striped. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Hello Kitty 35th Anniversary", "Stuffed Animal", "Character", 2009, licensed=True,
  franchise="Sanrio", limited_edition=True,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- 2012 Sanrio -------------------------------------------------------------
I("Hello Kitty Waffle Pink", "Stuffed Animal", "Character", 2012, licensed=True,
  franchise="Sanrio", international_exclusive=True,
  notes="UK exclusive, sold with a raincoat set. Catalogued from the CollectionHero "
        "index; no sourced price captured yet.")
I("LOVE Hello Kitty", "Stuffed Animal", "Character", 2012, licensed=True,
  franchise="Sanrio", limited_edition=True, edition_size=46600,
  notes="White with red hearts. Numbered limited edition of 46,600. Catalogued from "
        "the CollectionHero index; no sourced price captured yet.")
I("Tuxedosam", "Stuffed Animal", "Penguin", 2024, licensed=True, franchise="Sanrio",
  notes="Sold with a penguin ice cream wristie. Catalogued from the CollectionHero "
        "index; no sourced price captured yet.")

# --- Zoo and species variants ------------------------------------------------
ZOO_EXTRA = [
    ("Ring-Tailed Red Panda", "Red Panda", None, True, "Retired."),
    ("Red Panda with Baby (St. Louis Zoo)", "Red Panda", None, True,
     "Momma 16 inch with a 7 inch baby - a pair, not a single item, and distinct from "
     "the Mini Baby Red Panda sold on its own."),
    ("Mini Baby Red Panda (St. Louis Zoo)", "Red Panda", None, True, None),
    ("Okapi (Forest Giraffe)", "Okapi", 2017, True, None),
    ("Zoo Giraffe III", "Giraffe", 2017, True, "Third in a numbered zoo series."),
]
for nm, sp, yr, zoo, note in ZOO_EXTRA:
    I(nm, "Stuffed Animal", sp, yr, event_exclusive=zoo,
      notes=((note + " ") if note else "") +
            "Catalogued from the CollectionHero index; no sourced price captured yet.")

GIRAFFES = [("Yellow Giraffe", 2020), ("Purple Giraffe (Smallfrys)", None),
            ("Mini Baby Giraffe", 2016)]
for nm, yr in GIRAFFES:
    I(nm, "Stuffed Animal", "Giraffe", yr,
      notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

KOALAS = [
    ("Koala", None, "Standard grey and white, 16 inch. UNRESOLVED: may be the same "
                    "product as the 2007 Koala catalogued separately - the index gives "
                    "no year for this one. Confirm before merging.", {}),
    ("Koala (2007)", 2007, "Vintage special edition. UNRESOLVED: may be the same "
                           "product as the undated Koala record.", {}),
    ("Blue Koala", 2024, "16 inch.", {}),
    ("Koala Ken", None, "From 'The Koala Times' series. Described as rare.",
     dict(rarity="Rare")),
    ("Kuddly Koala", None, "13 inch. Retired.", dict(retired=True)),
    ("Cody Simpson Koala", None, "Musician tie-in.", dict(licensed=True)),
]
for nm, yr, note, flags in KOALAS:
    if flags.get("licensed"):
        flags["franchise"] = "Cody Simpson"
    I(nm, "Stuffed Animal", "Koala", yr,
      notes=note + " Catalogued from the CollectionHero index; no sourced price "
                   "captured yet.", **flags)

I("One Direction 1D Bear", "Stuffed Animal", "Bear", 2013, licensed=True,
  franchise="One Direction", retired=True,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")


# --- 2004 --------------------------------------------------------------------
I("Harley-Davidson Bear", "Stuffed Animal", "Bear", 2004, licensed=True,
  franchise="Harley-Davidson",
  notes="Special edition with leather accessories. Catalogued from the CollectionHero "
        "index; no sourced price captured yet.")
I("Rudolph (Light-Up Nose)", "Stuffed Animal", "Reindeer", 2004, licensed=True,
  franchise="Rudolph the Red-Nosed Reindeer",
  notes="Light-up nose. Distinct from the 36 inch store-display Jumbo Rudolph. "
        "Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Green Floppy Gator", "Stuffed Animal", "Alligator", 2004, store_exclusive=True,
  aliases=["Floppy Alligator"],
  notes="Myrtle Beach exclusive. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
for nm in ["Holiday Bear Kit", "Holiday Reindeer Kit"]:
    I(nm, "Lot", "Bear" if "Bear" in nm else "Reindeer", 2004, store_exclusive=True,
      is_lot=True,
      notes="Target exclusive boxed kit. A multi-piece set, not a single-item "
            "comparable. Catalogued from the CollectionHero index; no sourced price "
            "captured yet.")

# --- 2007 --------------------------------------------------------------------
I("Pawfect Patchwork Bunny (Australia)", "Stuffed Animal", "Bunny", 2007,
  international_exclusive=True, limited_edition=True,
  notes="Australian release. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Friend Fur All Seasons Set", "Lot", "Bear", 2007, limited_edition=True, is_lot=True,
  notes="Four-piece limited edition - Winter, Spring, Summer and Fall. A set, not a "
        "single-item comparable. Related to but distinct from the 2009 Seasons of Hugs "
        "bears - confirm before merging.")
I("Hello Kitty White Metallic", "Stuffed Animal", "Character", 2007, licensed=True,
  franchise="Sanrio",
  notes="Metallic white with pink bow. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
I("Autism Speaks Awareness Bear", "Stuffed Animal", "Bear", 2007, limited_edition=True,
  notes="Blue charity awareness bear. Catalogued from the CollectionHero index; no "
        "sourced price captured yet.")
WIZARD_OF_OZ = ["Dorothy", "Tin Man", "Glinda", "Cowardly Lion", "Scarecrow"]
for nm in WIZARD_OF_OZ:
    I("%s Costume (Wizard of Oz)" % nm, "Clothing & Accessories", "Costumes", 2007,
      licensed=True, franchise="Wizard of Oz", aliases=[nm],
      notes="Sold individually and in 5, 6, 11 and 14 piece sets - confirm what a comp "
            "included. Catalogued from the CollectionHero index; no sourced price "
            "captured yet.")

# --- 2011 --------------------------------------------------------------------
I("I Heart NY Bear", "Stuffed Animal", "Bear", 2011, store_exclusive=True,
  aliases=["I Love New York Bear"],
  notes="New York City exclusive. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Hello Kitty Halloween (2011)", "Stuffed Animal", "Character", 2011, licensed=True,
  franchise="Sanrio", limited_edition=True, edition_size=57000,
  notes="Orange plush, numbered limited edition of 57,000. Catalogued from the "
        "CollectionHero index; no sourced price captured yet.")
I("Tasmanian Wolf and Baby", "Stuffed Animal", "Wolf", 2011, rarity="Rare",
  notes="Sold as an adult-and-baby set, frequently unstuffed. A pair, not a single "
        "item. Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Patchwork White Bunny", "Stuffed Animal", "Bunny", 2011, limited_edition=True,
  notes="Heart-patterned. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")

# --- 2014 --------------------------------------------------------------------
I("Werewolf Moons-A-Glow", "Stuffed Animal", "Werewolf", 2014, limited_edition=True,
  rarity="Rare",
  notes="Glow-in-the-dark, sold only at Halloween 2014. Distinct from the 2019 "
        "Howl-o-Ween Werewolf. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
for nm, note in [("Hello Kitty Watercolor", "Sold with dress, jacket and shoes."),
                 ("Hello Kitty Pastel Tie Dye", None)]:
    I(nm, "Stuffed Animal", "Character", 2014, licensed=True, franchise="Sanrio",
      notes=((note + " ") if note else "") +
            "Catalogued from the CollectionHero index; no sourced price captured yet.")
for nm in ["Apple Jack", "Zecora"]:
    I("%s (My Little Pony)" % nm, "Stuffed Animal", "Horse", 2014, licensed=True,
      franchise="My Little Pony", aliases=[nm],
      notes="Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- 2020 --------------------------------------------------------------------
I("Dots-A-Lot Cat", "Stuffed Animal", "Cat", 2020, international_exclusive=True,
  notes="Australian exclusive. Catalogued from the CollectionHero index; no sourced "
        "price captured yet.")
I("Way of Lights Fox", "Stuffed Animal", "Fox", 2020,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Red Fox (2020)", "Stuffed Animal", "Fox", 2020, retired=True,
  notes="Distinct from the WWF Red Fox and the St. Louis Zoo Red Fox pair - confirm "
        "before merging. Catalogued from the CollectionHero index; no sourced price "
        "captured yet.")
I("Caramel Brown Pony", "Stuffed Animal", "Horse", 2020,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Downtown Mickey Ears Puppy", "Stuffed Animal", "Dog", 2020, licensed=True,
  franchise="Disney", store_exclusive=True,
  notes="Catalogued from the CollectionHero index; no sourced price captured yet.")
I("Jumbo Snorlax (24-inch)", "Stuffed Animal", "Character", 2020, licensed=True,
  franchise="Pokemon", online_exclusive=True,
  notes="Jumbo size online exclusive, priced apart from the standard Snorlax. "
        "Catalogued from the CollectionHero index; no sourced price captured yet.")

# --- Wristies ----------------------------------------------------------------
# Small wrist-worn accessories, usually sold alongside a specific plush. They
# turn up loose constantly, which is why they are worth cataloguing separately.
WRISTIES = [
    ("Cupcake Wristie", None, None),
    ("Hershey Kisses Wristie", "Hershey", "Silver."),
    ("Hello Kitty 25th Anniversary Cupcake Wristie", "Sanrio", None),
    ("Candy Cane Wristie", "Sanrio", None),
    ("Popsicle Wristie", "Sanrio", "Spring Gingham line."),
    ("Central Perk Mug Wristie", "FRIENDS", None),
    ("Sonic Screwdriver Wristie", "Doctor Who", "Makes sounds."),
    ("Chili Dog Wristie", "Sonic", "Super Sonic line."),
    ("Santa's Milk and Cookie Wristie", None, None),
    ("Dilophosaurus Bandana Wristie", None, "Build-A-Dino line."),
]
for nm, fr, note in WRISTIES:
    I(nm, "Clothing & Accessories", "Accessories", None,
      licensed=bool(fr), franchise=fr,
      notes=((note + " ") if note else "") +
            "Wristie accessory. Catalogued from the CollectionHero index; no sourced "
            "price captured yet.")


# ---------------------------------------------------------------------------
# Section 10 - accessory and clothing observations
# ---------------------------------------------------------------------------

ACCESSORIES = [
    ("Blue Satin Pajama Set", "Pajamas", 15.25, "Unknown", "complete", None),
    ("Football Outfit (5 pieces)", "Costumes", 14.00, "Unknown", "complete", "Five-piece set."),
    ("Red/White/Blue Sequin Outfit", "Clothing", 17.99, "Unknown", "complete", None),
    ("Fishing Outfit (Complete Set)", "Costumes", 26.95, "Unknown", "complete",
     "Components: hat, vest, waders, fishing rod, fish, boots."),
    ("Shoes / Roller Skates Lot (6 pairs)", "Shoes", 24.95, "Unknown", "complete",
     "Six-pair lot; not a single-item comp."),
    ("Red High-Top Shoes", "Shoes", 8.00, "Unknown", "complete", None),
    ("Black Roller Blades", "Shoes", 9.99, "Unknown", "complete", None),
    ("Woody Costume", "Costumes", 14.99, "Unknown", "complete", None),
    ("Cookie Monster Outfit", "Costumes", 13.50, "Unknown", "complete", None),
    ("Pastel Bunny Costume", "Costumes", 13.99, "Unknown", "complete", None),
    ("Minions Vampire Costume", "Costumes", 14.99, "NWT", "complete", None),
    ("We Wear Cute Emma Top + Lace Star Jeans", "Clothing", 25.00, "Unknown", "complete", None),
    ("Vintage Pink Glam Outfit Set", "Clothing", 23.00, "Unknown", "complete", None),
    ("Pumpkin Suit + Pumpkin Patch Shirt", "Costumes", 18.99, "NWT", "complete", None),
    ("Wonder Woman Sleeper", "Pajamas", 21.14, "Unknown", "complete", None),
    ("Khaki Shorts + T-Shirt + Bows + Sandals", "Clothing", 10.00, "Unknown", "complete", None),
    ("2 Pink Summer Outfits + Sandals + Backpack", "Clothing", 18.00, "Unknown", "complete",
     "Multi-piece lot."),
    ("Mixed Clothing Lot (with bear)", "Lot", 35.00, "Unknown", "complete",
     "Mixed lot including a bear; not a single-item comp."),
]

LICENSED_ACC = {
    "Woody Costume": "Disney / Pixar",
    "Cookie Monster Outfit": "Sesame Street",
    "Minions Vampire Costume": "Minions",
    "Wonder Woman Sleeper": "DC",
}

for nm, sub, price, cond, comp, note in ACCESSORIES:
    is_lot = "Lot" in nm or sub == "Lot"
    x = I(nm, "Clothing & Accessories", sub if sub != "Lot" else "Clothing",
          None, is_lot=is_lot,
          licensed=nm in LICENSED_ACC, franchise=LICENSED_ACC.get(nm),
          notes=note)
    S(x, price, cond, comp, notes=note)

# ---------------------------------------------------------------------------
# Section 11 - Mini Beans
# ---------------------------------------------------------------------------

# Mini Beans with recorded sold observations
x = I("Rainbow Unicorn (Mini Beans)", "Mini Bean", "Unicorn", 2026, mini_bean=True)
S(x, 18.99, "NWT")

x = I("Grey Panda (Mini Beans)", "Mini Bean", "Panda", 2026, mini_bean=True,
      notes="Two comps $15 apart - a clear example of why one sale is never enough.")
S(x, 26.00, "NWT")
S(x, 11.00)

x = I("Swirly Clouds Lamb (Mini Beans)", "Mini Bean", "Lamb", 2026, mini_bean=True)
S(x, 26.95, "NWT")

x = I("Dino-Mite T-Rex, Green (Mini Beans)", "Mini Bean", "Dinosaur", 2025, mini_bean=True,
      aliases=["Green Dino-Mite T-Rex"])
S(x, 10.00, "NWT")

x = I("Tie Dye Axolotl (Mini Beans)", "Mini Bean", "Axolotl", None, mini_bean=True)
S(x, 11.98)
S(x, 35.00, "NWT")

x = I("Skelebara (Mini Beans)", "Mini Bean", "Capybara", 2025, mini_bean=True)
S(x, 14.99)

x = I("Kuromi (Mini Beans)", "Mini Bean", "Character", None, mini_bean=True,
      licensed=True, franchise="Sanrio")
S(x, 19.95, "NWT")

x = I("Jumping Spider (Mini Beans)", "Mini Bean", "Spider", 2026, mini_bean=True,
      notes="Sold out at retail at time of research.")
S(x, 40.00, "NWT")

x = I("Mothman (Mini Beans)", "Mini Bean", "Cryptid", 2025, mini_bean=True)
S(x, 32.00, "NWT")

x = I("Chococat (Mini Beans)", "Mini Bean", "Character", None, mini_bean=True,
      licensed=True, franchise="Sanrio")
S(x, 26.70, marketplace="Mercari")

# 2026 collector guide - catalog entries, no sold comps captured
GUIDE_2026 = [
    ("Fiery Dragon", "Dragon", True),
    ("Pink Gingham Pawlette", "Bunny", False),
    ("Fuzzy Pink Pig", "Pig", False),
    ("Spring Pastures Longhorn", "Longhorn", False),
    ("Love You Tons Elephant", "Elephant", False),
    ("Wild Hearts Leopard", "Leopard", False),
    ("Red Rose Kitty", "Cat", True),
]
for nm, sp, le in GUIDE_2026:
    I("%s (Mini Beans)" % nm, "Mini Bean", sp, 2026, mini_bean=True, limited_edition=le,
      notes="Listed in the official 2026 Mini Beans collector guide. "
            "No sold comps captured yet.")

# 2025 collector guide - catalog entries, no sold comps captured
GUIDE_2025 = [
    ("Skunk", "Skunk"), ("Hoppy Colors Frog", "Frog"), ("Blue Pterodactyl", "Dinosaur"),
    ("Kiwi Koala", "Koala"), ("Spooky Kitty", "Cat"), ("Gargoyle", "Cryptid"),
    ("Posh Penguin", "Penguin"), ("Cozy Cuddles Teddy", "Bear"), ("Sea Monster", "Cryptid"),
    ("Autumn Puppy", "Dog"), ("Pumpkin Bear", "Bear"), ("Candy Corn Longhorn", "Longhorn"),
    ("Zombie Axolotl", "Axolotl"), ("Timeless Teddy", "Bear"), ("Pink Capybara", "Capybara"),
    ("Mint Tardigrade", "Tardigrade"), ("Blueberry Cow", "Cow"),
    ("Dragon Fruit Dragon", "Dragon"), ("Strawberry Cow", "Cow"), ("Pineapplotl", "Axolotl"),
    ("Red Raptor", "Dinosaur"), ("Rainbow Triceratops", "Dinosaur"), ("Hamster", "Hamster"),
    ("Pastel Paws Pawlette", "Bunny"), ("Sunshine Cuddles Chick", "Chick"),
    ("Be Mine Kitty", "Cat"), ("Be Mine Dalmatian", "Dog"), ("Spring Pink Frog", "Frog"),
    ("Heartwarming Hippo", "Hippo"),
]
for nm, sp in GUIDE_2025:
    I("%s (Mini Beans)" % nm, "Mini Bean", sp, 2025, mini_bean=True,
      notes="Listed in the official 2025 Mini Beans collector guide. "
            "No sold comps captured yet.")

# Wiki titles for items already curated above. Registering each as an alias
# makes load_wiki_catalogue skip the wiki's copy, so one bear is one item and
# its sold comps are not split between two pages.
WIKI_DUPLICATES = [
    ("hello-kitty-35th-anniversary", "35th Anniversary Hello Kitty"),
    ("jumbo-snorlax-24-inch", "Pokémon Jumbo Snorlax"),
    ("happy-hugs-iv-teddy", "Happy Hugs Teddy IV"),
    ("zombie-axolotl-mini-beans", "Mini Beans Zombie Axolotl"),
]
for _id, _alias in WIKI_DUPLICATES:
    _item = next(i for i in ITEMS if i["id"] == _id)
    if _alias not in _item["aliases"]:
        _item["aliases"].append(_alias)
# The wiki dates Happy Hugs Teddy IV to 2018; keep that now its row is skipped.
next(i for i in ITEMS if i["id"] == "happy-hugs-iv-teddy")["release_year"] = 2018

# ---------------------------------------------------------------------------
# Config and reference data
# ---------------------------------------------------------------------------

CONFIG = OrderedDict([
    # Section 4 - condition multipliers. Configurable, not hard-coded in the app.
    ("condition_multipliers", OrderedDict([
        ("NWT", 1.25), ("Mint", 1.25), ("Excellent", 1.10), ("Good", 1.00),
        ("Fair", 0.75), ("Poor", 0.50), ("Damaged", 0.35), ("Incomplete", 0.60),
        ("Unknown", 1.00),
    ])),
    # Section 5 - completeness multipliers.
    ("completeness_multipliers", OrderedDict([
        ("complete", 1.15), ("packaged", 1.15), ("some_originals", 1.05),
        ("bare", 1.00), ("unstuffed", 1.00), ("altered", 0.85), ("unknown", 1.00),
    ])),
    ("completeness_labels", OrderedDict([
        ("complete", "Complete - outfit + extras"), ("packaged", "With original packaging"),
        ("some_originals", "Some originals present"), ("bare", "Bare bear"),
        ("unstuffed", "Unstuffed"), ("altered", "Missing / altered"),
        ("unknown", "Not recorded"),
    ])),
    # Per-copy modifiers, applied on top of condition and completeness.
    #
    # Two kinds, deliberately modelled differently:
    #
    #   multiplicative - scales with the item's own value. A tag authenticates
    #   whatever it is attached to, so its worth is proportional.
    #
    #   additive - separately traded goods with their own market price. A sound
    #   module is about $7 whether it is in a $12 Mini Bean or a $250 exclusive;
    #   pricing it as a percentage would value the same chip at $25 on one and
    #   $1.50 on the other.
    ("modifiers", OrderedDict([
        ("multiplicative", OrderedDict([
            ("birth_certificate", 1.15),
            ("hang_tag", 1.10),
            ("tush_tag_missing", 0.70),
            ("unstuffed", 0.85),
            ("customised", 0.80),
        ])),
        ("additive_usd", OrderedDict([
            ("sound_module", 7.00),
            ("scent_chip", 6.00),
        ])),
        ("labels", OrderedDict([
            ("birth_certificate", "Birth certificate present"),
            ("hang_tag", "Hang tag attached"),
            ("tush_tag_missing", "Tush tag missing or cut"),
            ("unstuffed", "Unstuffed"),
            ("customised", "Customised or altered"),
            ("sound_module", "Sound module fitted"),
            ("scent_chip", "Scent chip fitted"),
        ])),
        # Multipliers compound silently: 1.15 x 1.10 x 1.25 x 1.15 = 1.82, a
        # figure no comp supports and no user can trace. The cap is the
        # backstop; if it binds often, the attribute wanted to be additive.
        ("max_combined_multiplier", 1.45),
    ])),
    # Section 8 - buy / trade / sell bands, as fractions of fair market value.
    ("bands", OrderedDict([
        ("buy", [0.55, 0.70]),
        ("trade", [0.75, 0.90]),
        ("high_ask", [1.10, 1.30]),
    ])),
    # Section 3 / 17 - confidence thresholds by comparable sale count.
    ("confidence", OrderedDict([
        ("high_min", 10), ("medium_min", 4), ("low_min", 1),
    ])),
    # Accounts. OFF until a Supabase project exists. While off, BearChart runs
    # anonymously and keeps collections in the browser - a fully working mode.
    #
    # The anon key belongs in client code: it is public by design and grants only
    # what the row-level security policies allow. The service_role key is the
    # secret one and must never be put here.
    ("auth", OrderedDict([
        ("enabled", True),
        ("supabase_url", "https://stfkxfhffblajqbbyqze.supabase.co"),
        # Publishable key. Public by design - it ships in client code and grants
        # only what the RLS policies allow. The service_role key is the secret
        # one and must never appear here or anywhere a browser can reach.
        ("supabase_anon_key", "sb_publishable___jAIp9os6_gs7v9N8JD7A_Tj67O96i"),
    ])),
    # Evidence types that count as market evidence at all.
    ("market_evidence_types", ["completed_sale", "auction_result", "collector_report",
                               "historical_archive"]),
    ("strong_evidence_types", ["completed_sale", "auction_result"]),
    ("condition_order", ["NWT", "Mint", "Excellent", "Good", "Fair", "Poor",
                         "Damaged", "Incomplete", "Unknown"]),
    # How the conservative lower bound is derived. A deal is judged against this,
    # never against the median: with three comps a point estimate carries the same
    # authority as with thirty, which is what makes naive deal rules fire endlessly
    # on exactly the rare items whose data is thinnest.
    ("bootstrap", OrderedDict([
        ("percentile", 0.25),          # of the bootstrapped median distribution
        ("iterations", 2000),
        ("single_comp_haircut", 0.75), # n=1 carries no dispersion information
    ])),
    # Reseller economics for the deal finder. These are ASSUMPTIONS, not facts -
    # check them against your own account before trusting a margin figure.
    # A gross discount is not profit: fees and shipping come out first.
    ("reseller", OrderedDict([
        ("marketplace_fee_pct", 0.1325),   # eBay final value fee, typical category
        ("payment_fee_fixed", 0.30),       # per-order fixed fee
        ("shipping_cost", 9.00),           # what it costs YOU to ship one
        ("min_net_margin", 15.00),         # ignore anything thinner than this
        ("min_discount_pct", 20.0),        # and anything not this far below value
        ("min_confidence", "LOW"),         # never flag a deal with no sold data
    ])),
])

# Section 26 - current official retail, kept strictly separate from resale value.
RETAIL_REFERENCE = OrderedDict([
    ("as_of", "2026-09"),
    ("source", "https://www.buildabear.com/prices"),
    ("warning", "Current retail is a baseline only. It is never secondary-market value."),
    ("bands", [
        {"label": "Standard Bears", "low": 16, "high": 48},
        {"label": "Mini Stuffed Animals", "low": 10, "high": 17.50},
        {"label": "Large / Giant", "low": 98, "high": 128},
        {"label": "Voice / Scent (each)", "low": 5, "high": 9.50},
        {"label": "Outfits & Accessories (each)", "low": 5, "high": 25},
    ]),
    ("notes", "Current Mini Beans retail sits around $10, licensed Mini Beans around "
              "$12.50, with bundles higher."),
])

# ---------------------------------------------------------------------------
# Business configuration
#
# Everything here is OFF until it is filled in. Nothing about BearChart's
# valuations changes when it is switched on: the buy range shown to a seller is
# the same number the engine publishes to everybody, from the same sold data.
#
# The disclosure is not optional decoration. A guide that tells you what your
# bear is worth AND offers to buy it has an obvious conflict of interest. Saying
# so plainly is what keeps the valuations worth trusting - and the trust is the
# only thing here a competitor cannot copy.
# ---------------------------------------------------------------------------

BUSINESS = OrderedDict([
    ("enabled", True),
    ("name", "Jay's Retro Exchange"),
    ("contact_email", None),
    ("contact_url", "https://jaysretroexchange.com"),

    # The shop promo. Shown where it is useful rather than everywhere: in the
    # sidebar of the price guide, and on item pages that have no sold data -
    # the 1,974 pages that currently have nothing to offer a visitor. Priced
    # items get the "sell yours" panel below instead, so nobody sees both.
    ("shop_url", "https://jaysretroexchange.com"),
    ("shop_eyebrow", "The shop behind BearChart"),
    ("shop_headline", "Buying and selling Build-A-Bear all week"),
    ("shop_blurb", "BearChart is built and run by Jay's Retro Exchange. Browse what "
                   "is in stock, or send us a collection and we will make an offer "
                   "on it."),
    ("shop_cta", "Visit the shop"),
    # Said plainly, because the site's whole argument is that its numbers are
    # not for sale. A reader who works out for themselves that the person
    # publishing the valuations also buys at them will trust nothing else here.
    ("shop_disclosure", "We buy and sell the same items this guide values. No "
                        "valuation on this site is adjusted because of it - the "
                        "numbers come from recorded sold transactions, and you can "
                        "see every one of them."),
    ("blurb", "We buy Build-A-Bear collections. The range below is what we would pay, "
              "calculated from the same sold data shown on this page."),
    ("disclosure", "Jay's Retro Exchange buys and sells Build-A-Bear items, and would "
                   "be buying this one from you. Our offer is generated from the same "
                   "public sold-comp data you can see above - we do not adjust a "
                   "valuation because we want to buy it. You are free to sell "
                   "elsewhere, and the guide will tell you the same number if you do."),
    # eBay Partner Network campaign id. When set, outbound listing links carry it.
    ("ebay_campaign_id", "5339219665"),
    ("affiliate_disclosure", "Some links to eBay listings are affiliate links. They do "
                             "not affect any valuation on this site, and they never "
                             "influence which listings are shown."),
])

# ---------------------------------------------------------------------------
# Membership
#
# Tiering follows one rule: a paid feature must cost the operator real money or
# real quota to provide. That is not a philosophy, it is a consequence of the
# architecture.
#
# BearChart ships as static files. data.js - the whole catalogue, every comp -
# is downloaded by every visitor. Nothing computed in the browser from that file
# can be paywalled, because the data is already on the visitor's machine and a
# devtools panel is all it takes to prove it. Hiding the valuation engine behind
# a tier would be a lock on a door with no wall attached.
#
# So the free tier is everything the static bundle can do, and paid tiers are
# things a SERVER does: storing your collection, generating and retaining an
# evidence-backed schedule, sending notifications, spending API quota. Those can
# be enforced, and they are also the only things that cost anything to run.
# ---------------------------------------------------------------------------

PLANS = OrderedDict([
    ("free", OrderedDict([
        ("name", "Free"),
        ("price_monthly", 0),
        ("audience", "For looking things up"),
        ("badge", None),
        ("perk", None),
        ("blurb", "Price any bear, any time. No account needed."),
        ("features", [
            "Values for every bear in the guide, built from real sold prices",
            "Condition calculator - NWT, played-with, missing outfit",
            "Track your collection on this device",
            "Collector checklists",
            "Deal finder over the listings we have loaded",
        ]),
        ("entitlements", []),
    ])),
    ("pro", OrderedDict([
        ("name", "Pro"),
        ("price_monthly", 7),
        ("audience", "For collectors"),
        ("badge", "Recommended"),
        # A shop perk, honoured by Jay's Retro Exchange at the till rather than by
        # anything on this site - see ENTITLEMENTS["shop_discount"].
        ("perk", "5% off one bear a month from Jay's Retro Exchange"),
        ("blurb", "Know what your collection is worth, on every device."),
        ("features", [
            "Your collection synced across phone, tablet and computer",
            "Collection value history that is never lost",
            "Wishlist alerts - an email when a bear you want is listed",
            "Insurance-ready valuation report, with the evidence behind every figure",
            "Bear identification help, answered first",
        ]),
        ("entitlements", [
            "collection_sync", "hosted_history", "wishlist_alerts",
            "insurance_archive", "id_priority", "shop_discount",
        ]),
    ])),
    ("power", OrderedDict([
        ("name", "Power"),
        ("price_monthly", 14),
        ("audience", "For resellers"),
        ("badge", None),
        ("perk", "10% off one bear a month from Jay's Retro Exchange"),
        ("blurb", "Find underpriced bears before anyone else does."),
        ("features", [
            "Instant deal alerts by push and email when a bear lists below its value, after fees",
            "Your watched bears checked first in the scanning queue",
            "A monthly email with what your collection is worth now",
            "Outfit and complete-set valuations",
            "Export and API access to your own data",
            "Your collection synced across phone, tablet and computer",
            "Collection value history that is never lost",
            "Wishlist alerts - an email when a bear you want is listed",
            "Insurance-ready valuation report, with the evidence behind every figure",
            "Bear identification help, answered first",
            "A public showcase page for your top 12 bears",
        ]),
        ("entitlements", [
            "collection_sync", "hosted_history", "value_digest", "wishlist_alerts",
            "insurance_archive", "id_priority", "shop_discount",
            "alerts_push", "alerts_email", "poll_priority", "outfit_assembly", "api_access",
        ]),
    ])),
])

# What each entitlement actually unlocks, and where it is enforced. "server"
# means the database or an edge function refuses without it; "ux" means the
# client only hides a prompt and enforcement is impossible or pointless; "shop"
# means Jay's Retro Exchange checks the membership when an order is placed.
ENTITLEMENTS = OrderedDict([
    ("collection_sync", OrderedDict([("label", "Collection sync"), ("enforced", "server")])),
    ("hosted_history", OrderedDict([("label", "Server-side collection history"), ("enforced", "server")])),
    ("value_digest", OrderedDict([("label", "Monthly collection value email"), ("enforced", "server")])),
    ("wishlist_alerts", OrderedDict([("label", "Wishlist alerts"), ("enforced", "server")])),
    ("insurance_archive", OrderedDict([("label", "Insurance valuation reports"), ("enforced", "server")])),
    ("id_priority", OrderedDict([("label", "Identification help, answered first"), ("enforced", "server")])),
    ("shop_discount", OrderedDict([("label", "Monthly discount at Jay's Retro Exchange (5% Pro, 10% Power)"), ("enforced", "shop")])),
    ("alerts_push", OrderedDict([("label", "Push deal alerts"), ("enforced", "server")])),
    ("alerts_email", OrderedDict([("label", "Email deal alerts"), ("enforced", "server")])),
    ("poll_priority", OrderedDict([("label", "Scanning priority"), ("enforced", "server")])),
    ("outfit_assembly", OrderedDict([("label", "Outfit and set valuations"), ("enforced", "ux")])),
    ("api_access", OrderedDict([("label", "Export and API access"), ("enforced", "server")])),
])

MEMBERSHIP = OrderedDict([
    ("enabled", False),          # no plans are sold until a payment provider exists
    ("currency", "USD"),
    ("provider", None),          # "stripe" once configured
    ("stripe_publishable_key", None),
    # Edge functions that do the parts a browser must not: create a checkout
    # session against the secret key, and open the billing portal.
    ("checkout_function", "create-checkout"),
    ("portal_function", "create-portal"),
    ("plans", PLANS),
    ("entitlements", ENTITLEMENTS),
    # Hot polling slots are shared across the whole platform, not per subscriber.
    # A default eBay key affords about three 60-second queries in total, so
    # "60-second polling on anything you like" is a promise that cannot be kept
    # past the third customer. What a subscriber actually buys is PRIORITY: the
    # scarce hot slots go to the most-subscribed items, so a hundred people
    # watching one bear share one query and all get it fast.
    ("hot_slots_total", 3),
    ("hot_slot_note",
     "Hot slots are shared. The most-watched items across all members get the "
     "60-second queue; watching an item nobody else watches puts it in the "
     "30-minute tier."),
])

# ---------------------------------------------------------------------------
# Bulk catalogue: The Build-A-Bear Wiki
# ---------------------------------------------------------------------------
# Everything above this line is hand-transcribed and carries sold comps. What
# follows is identification ONLY - name, year, species, line, franchise,
# exclusivity - lifted from the wiki's own category tags by
# tools/build_wiki_catalogue.py. No price, value or rarity crosses this line.
#
# These items arrive with zero sales, which the engine reports as VERY LOW
# confidence. That is the honest answer: we know the bear exists, and we do not
# know what it is worth. A catalogue you can search is worth having on its own,
# and every entry is now a row a comp can attach to later.
#
# Hand-written entries always win. A wiki page whose name already matches a
# curated item - by id, canonical name or alias - is skipped rather than
# merged, so research done by hand is never overwritten by a bulk import.

# Whichever spelling the hand-curated entries already use wins, so existing
# item ids and filters keep working.
FRANCHISE_SPELLING = {
    "Pokémon": "Pokemon",
    "PAW Patrol": "Paw Patrol",
    "PEEPS": "Peeps",
}


def load_wiki_catalogue():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalogue_wiki.json")
    if not os.path.exists(path):
        print("  (no catalogue_wiki.json - run tools/build_wiki_catalogue.py)")
        return 0, 0

    with open(path) as f:
        payload = json.load(f)

    # Names listed in catalogue_exclude.json are never catalogued - the way to
    # take back a bad entry that the weekly wiki check added.
    exclude_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalogue_exclude.json")
    exclude = set()
    if os.path.exists(exclude_path):
        with open(exclude_path) as f:
            exclude = {str(n).strip().lower() for n in json.load(f)}

    def key(text):
        return re.sub(r"[^a-z0-9]", "", str(text or "").lower())

    def loose(text):
        """Same name allowing for the noise that is not part of the name.

        Two kinds. Filler collectors add and drop at will - "Gem Of A Friend:
        Bearilliant Blue Teddy" and "Gem of a Friend Bearilliant Blue" are one
        bear. And the wiki's own disambiguation: it titles pages "Lucky Kitty
        (1999)" where our curated record is simply "Lucky Kitty", and importing
        both put a second Lucky Kitty in the guide that sold comps then
        resolved to instead of the curated one.

        Matching loosely can cost us a genuine wiki row; matching strictly
        costs us a duplicate in the price guide, which is the worse of the two.
        """
        text = re.sub(r"\s*\((?:19|20)\d\d\)\s*$", "", str(text or ""))
        k = key(text)
        for suffix in ("teddy", "plush", "bear", "the"):
            while k.endswith(suffix) and len(k) > len(suffix) + 3:
                k = k[: -len(suffix)]
        return k

    taken = {i["id"] for i in ITEMS}
    names = [i["canonical_name"] for i in ITEMS] + [a for i in ITEMS for a in i["aliases"]]
    known = {key(n) for n in names}
    # Loose matching runs against the CURATED names only. If it also grew as
    # wiki items were added, then a wiki that legitimately lists both
    # "Alligator" and "Alligator (2016)" would lose the second one to the
    # first. Against curated names, the loose rule catches the real duplicates
    # and nothing else.
    curated_loose = {loose(n) for n in names}

    added = skipped = 0
    for e in payload["items"]:
        name = e["canonical_name"]
        if name.strip().lower() in exclude:
            skipped += 1
            continue
        if key(name) in known or loose(name) in curated_loose or slug(name) in taken:
            skipped += 1
            continue
        flags = {k: v for k, v in e.items()
                 if k not in ("canonical_name", "category", "species", "year")}
        # The wiki and the curated entries spell some franchises differently
        # ("Pokemon" / "Pokémon"). Two spellings means two filter chips for one
        # franchise, which looks like a bug to anybody browsing.
        if flags.get("franchise") in FRANCHISE_SPELLING:
            flags["franchise"] = FRANCHISE_SPELLING[flags["franchise"]]
        flags["notes"] = "Catalogued from The Build-A-Bear Wiki (CC BY-SA 4.0). " \
                         "Identification only - no sold comps recorded yet."
        I(name, e["category"], species=e["species"], year=e["year"], **flags)
        taken.add(slug(name))
        known.add(key(name))
        added += 1
    return added, skipped


WIKI_ADDED, WIKI_SKIPPED = load_wiki_catalogue()

SOURCES = [
    {"name": "eBay sold listings (Terapeak Product Research)",
     "url": "https://www.ebay.com/sh/research",
     "role": "Main price source: completed eBay sales from the last three years, each matched "
             "to a bear by its title and checked by hand. Item price only, shipping left out"},
    {"name": "eBay Browse API",
     "url": "https://developer.ebay.com/api-docs/buy/browse/overview.html",
     "role": "Live asking prices for the Deal finder, refreshed daily. An asking price is never "
             "used to set a value"},
    {"name": "CollectionHero (Build-A-Bear)", "url": "https://buildabear.collectionhero.com/",
     "role": "Historical sales index used in early research - corroborating evidence, not sole authority"},
    {"name": "The Build-A-Bear Wiki", "url": "https://buildabearwiki.info/",
     "role": "Catalogue identification only (CC BY-SA 4.0) - never a price source"},
    {"name": "Official Build-A-Bear", "url": "https://www.buildabear.com/",
     "role": "Retail prices and product identification - never a resale value"},
    {"name": "Mini Beans collector guide", "url": "https://www.buildabear.com/mini-beans-collector-guide.html",
     "role": "Identification and checklist reference"},
]


def apply_image_overrides(root):
    """Photos attached via tools/attach_images.py survive every rebuild."""
    path = os.path.join(root, "tools", "image_overrides.json")
    if not os.path.exists(path):
        return 0
    with open(path) as f:
        overrides = json.load(f)
    by_id = {i["id"]: i for i in ITEMS}
    applied = 0
    for item_id, img in overrides.items():
        item = by_id.get(item_id)
        if not item:
            continue
        item["image_url"] = img.get("image_url")
        item["image_credit"] = img.get("image_credit")
        item["image_source"] = img.get("image_source")
        applied += 1
    return applied


def merge_imported_sales(root):
    """Sales brought in by tools/import_sales.py survive every rebuild."""
    path = os.path.join(root, "tools", "imported_sales.json")
    if not os.path.exists(path):
        return 0
    with open(path) as f:
        imported = json.load(f)
    known = {i["id"] for i in ITEMS}
    have = {(s["item_id"], round(float(s["sold_price"]), 2),
             s.get("sale_date") or "", s.get("listing_id") or "") for s in SALES}
    merged = 0
    for s in imported:
        if s["item_id"] not in known:
            continue
        key = (s["item_id"], round(float(s["sold_price"]), 2),
               s.get("sale_date") or "", s.get("listing_id") or "")
        if key in have:
            continue
        have.add(key)
        SALES.append(OrderedDict(s))
        merged += 1
    return merged


# eBay user data. Never allowed into data.json - see load_active_listings.
USER_DATA_FIELDS = ("seller", "seller_username", "username", "eiasToken", "userId")


def load_active_listings(root):
    """Active eBay listings, kept in their own array.

    These are asking prices. They live apart from SALES so they cannot be
    swept into a valuation by accident - a second line of defence behind the
    engine's own evidence-type filter.
    """
    path = os.path.join(root, "tools", "active_listings.json")
    if not os.path.exists(path):
        return [], None
    with open(path) as f:
        payload = json.load(f)
    known = {i["id"] for i in ITEMS}
    listings = [l for l in payload.get("listings", []) if l.get("item_id") in known]
    for l in listings:
        assert l.get("evidence_type") == "active_listing", \
            "active_listings.json contained a non-listing row: %s" % l.get("id")
        # data.json is published to a public static site, so no eBay user data
        # may pass this point. ebay_active.py stopped collecting these, but a
        # file written before that change still carries them, and a redeploy
        # would otherwise publish names nobody agreed to publish.
        for field in USER_DATA_FIELDS:
            l.pop(field, None)
    return listings, payload.get("fetched_at")


OPEN_QUESTION = re.compile(
    r"unresolved|confirm before|before merging|may overlap|may be the same|"
    r"may or may not be the same|whether they are the same|needs confirmation",
    re.I)


def flag_open_questions():
    """Mark items whose notes record an unsettled identification question."""
    n = 0
    for item in ITEMS:
        if item.get("notes") and OPEN_QUESTION.search(item["notes"]):
            item["needs_review"] = True
            n += 1
    return n


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    open_questions = flag_open_questions()
    active, active_fetched_at = load_active_listings(root)
    photos = apply_image_overrides(root)
    imported = merge_imported_sales(root)
    out = OrderedDict([
        ("meta", OrderedDict([
            ("name", "BearChart"),
            ("subtitle", "Build-A-Bear Price Guide"),
            ("generated_by", "tools/build_data.py"),
            ("schema_version", 1),
        # Where the site lives, once it lives somewhere. Needed for canonical
        # links and the sitemap; both are absolute by specification, and a
        # sitemap full of wrong URLs is worse than no sitemap at all.
        ("site_url", ""),
            ("disclaimer", "BearChart is an independent collector/reseller research tool and "
                           "is not affiliated with Build-A-Bear Workshop. Market values fluctuate."),
            ("item_count", len(ITEMS)),
            ("photo_count", sum(1 for i in ITEMS if i.get("image_url"))),
            ("sale_count", len(SALES)),
        ])),
        ("config", CONFIG),
        ("retail_reference", RETAIL_REFERENCE),
        ("business", BUSINESS),
        ("membership", MEMBERSHIP),
        ("sources", SOURCES),
        ("items", ITEMS),
        ("sales", SALES),
        ("active_listings", active),
        ("active_listings_fetched_at", active_fetched_at),
    ])
    path = os.path.join(root, "data.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")

    # data.js carries the same payload as a global so the site also works when
    # opened straight off the filesystem, where fetch() of a local file is blocked.
    js_path = os.path.join(root, "data.js")
    with open(js_path, "w") as f:
        f.write("/* Generated by tools/build_data.py - do not edit by hand. */\n")
        f.write("globalThis.BEARCHART_DATA = ")
        json.dump(out, f, indent=2)
        f.write(";\n")
    priced = len({s["item_id"] for s in SALES})
    print("wrote %s" % path)
    print("  items: %d  (%d with sold data, %d awaiting comps)"
          % (len(ITEMS), priced, len(ITEMS) - priced))
    print("  sales: %d  (%d fully sourced completed_sale)"
          % (len(SALES), sum(1 for s in SALES if s["evidence_type"] == "completed_sale")))
    if active:
        print("  active listings: %d (asking prices - never used in a valuation)"
              % len(active))
    if open_questions:
        print("  open questions: %d item(s) flagged for a human to settle"
              % open_questions)
    upcoming = sum(1 for i in ITEMS if i.get("release_status") == "upcoming")
    current = sum(1 for i in ITEMS if i.get("release_status") == "current")
    if upcoming or current:
        print("  release tracking: %d upcoming, %d currently at retail" % (upcoming, current))
    with_photo = sum(1 for i in ITEMS if i.get("image_url"))
    print("  photos: %d attached (%d items still showing a placeholder)"
          % (with_photo, len(ITEMS) - with_photo))


if __name__ == "__main__":
    main()
