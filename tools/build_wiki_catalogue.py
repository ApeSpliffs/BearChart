#!/usr/bin/env python3
"""
Turn the Build-A-Bear Wiki's article index into BearChart catalogue entries.

    python3 tools/fetch_wiki.py            # refresh tools/research/*.json
    python3 tools/build_wiki_catalogue.py  # -> tools/catalogue_wiki.json
    npm run build

WHAT THIS DOES AND DOES NOT IMPORT
    Imports:     identification only - name, year, species, line, franchise,
                 exclusivity. All of it drawn from the wiki's own category tags.
    Never:       prices, values, rarity ratings, or anything resembling a comp.

That split is the whole point. The wiki tells us WHAT EXISTS; it is not a price
guide, and treating a hobbyist wiki as one would poison every valuation on the
site. Items land with no sales attached, which the engine reports honestly as
VERY LOW confidence rather than guessing.

Source: The Build-A-Bear Wiki (buildabearwiki.info), CC BY-SA 4.0.
Read through the MediaWiki API - five requests for the index, forty for the
category tags - rather than crawled page by page.
"""

import json
import os
import re
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESEARCH = os.path.join(ROOT, "tools", "research")
OUT = os.path.join(ROOT, "tools", "catalogue_wiki.json")

# --- taxonomy ---------------------------------------------------------------
# The wiki tags species inconsistently (both "Domestic cats" and "Domestic
# Cats" exist as separate categories, for instance). Everything is lowercased
# before lookup so the two spellings cannot become two species.

SPECIES = {
    "bears": "Bear", "baby bears": "Bear", "curly bears": "Bear", "kit bears": "Bear",
    "champ bears": "Bear", "autograph bears": "Bear", "glowing bears": "Bear",
    "domestic dogs": "Dog", "domestic canines": "Dog", "dogs": "Dog",
    "domestic cats": "Cat", "domesticated cat": "Cat", "cats": "Cat", "cat": "Cat",
    "bunnies": "Bunny", "big cats": "Big Cat", "big cat": "Big Cat",
    "tigers": "Tiger", "lions": "Lion", "leopards and cheetahs": "Leopard",
    "jaguars and panthers": "Panther", "pandas": "Panda", "red pandas": "Red Panda",
    "dinosaurs": "Dinosaur", "dragons": "Dragon", "dragon": "Dragon",
    "unicorns": "Unicorn", "pegasi and unicorns": "Unicorn",
    "mythical creatures": "Mythical Creature", "werewolves": "Werewolf",
    "aliens and monsters": "Monster", "elves": "Elf", "humans": "Human",
    "birds": "Bird", "bird": "Bird", "birds and owls": "Bird", "owls": "Owl",
    "penguins": "Penguin", "flamingos": "Flamingo",
    "chickens and ducks": "Duck", "duck": "Duck",
    "frogs": "Frog", "spring frogs": "Frog", "amphibians": "Amphibian",
    "reptiles": "Reptile", "snakes": "Snake", "snakes and lizards": "Reptile",
    "turtles": "Turtle", "alligators": "Alligator",
    "fish and sharks": "Fish", "sharks": "Shark", "octopuses": "Octopus",
    "aquatic animals": "Aquatic Animal", "crabs and lobsters": "Crustacean",
    "slugs and snails": "Mollusc", "tardigrades": "Tardigrade",
    "insects and spiders": "Insect", "insect": "Insect", "praying mantis": "Insect",
    "invertebrates": "Invertebrate",
    "monkeys": "Monkey", "monkeys and primates": "Primate", "primates": "Primate",
    "elephants": "Elephant", "elephant": "Elephant", "giraffes": "Giraffe",
    "zebras": "Zebra", "hippos": "Hippo",
    "equines": "Horse", "horses and donkeys": "Horse",
    "bovines": "Cow", "cows and buffaloes": "Cow",
    "sheep and goats": "Sheep", "pigs and warthogs": "Pig",
    "deer and moose": "Deer", "cervines": "Deer", "reindeer": "Reindeer",
    "foxes": "Fox", "fox": "Fox", "wolves and coyotes": "Wolf", "wild canines": "Wolf",
    "raccoons": "Raccoon", "skunks": "Skunk", "moles": "Mole",
    "badgers and otters": "Mustelid", "mustelids": "Mustelid",
    "sloths": "Sloth", "koalas": "Koala", "kangaroos": "Kangaroo",
    "marsupials": "Marsupial", "hedgehogs": "Hedgehog",
    "mice and rodents": "Rodent", "rodents": "Rodent",
    "chipmunks and squirrels": "Rodent", "capybaras": "Capybara",
    "llamas": "Llama", "camelids": "Camelid", "camels": "Camel",
    "bats": "Bat", "sea lions and seals": "Seal", "pinnipeds": "Seal",
    "axolotls": "Axolotl", "monotremes": "Monotreme",
    "woodland animals": "Woodland Animal", "woodland friends": "Woodland Animal",
    "plants": "Plant", "inanimate objects": "Object", "animals": None,
}

FRANCHISE = {
    "pokémon": "Pokémon", "sanrio": "Sanrio", "my little pony": "My Little Pony",
    "marvel": "Marvel", "disney": "Disney", "disney princess": "Disney Princess",
    "disney villains": "Disney Villains", "disney and pixar": "Disney/Pixar",
    "mickey and friends": "Disney", "frozen": "Frozen", "toy story": "Toy Story",
    "lilo and stitch": "Lilo & Stitch", "turning red": "Turning Red",
    "raya and the last dragon": "Raya and the Last Dragon",
    "star wars": "Star Wars", "harry potter": "Harry Potter",
    "fantastic beasts": "Fantastic Beasts", "lord of the rings": "Lord of the Rings",
    "sonic the hedgehog": "Sonic the Hedgehog", "super mario": "Super Mario",
    "animal crossing": "Animal Crossing", "peanuts": "Peanuts",
    "sesame street": "Sesame Street", "care bears": "Care Bears",
    "winnie the pooh": "Winnie the Pooh", "paddington": "Paddington",
    "paw patrol": "PAW Patrol", "bluey": "Bluey", "minions": "Minions",
    "shrek": "Shrek", "kung fu panda": "Kung Fu Panda", "dreamworks": "DreamWorks",
    "how to train your dragon": "How to Train Your Dragon",
    "dr. seuss": "Dr. Seuss", "doctor who": "Doctor Who",
    "dungeons & dragons": "Dungeons & Dragons", "jurassic world": "Jurassic World",
    "stranger things": "Stranger Things", "wicked": "Wicked",
    "the nightmare before christmas": "The Nightmare Before Christmas",
    "gremlins": "Gremlins", "e.t.": "E.T.", "elvis": "Elvis",
    "hannah montana": "Hannah Montana", "high school musical": "High School Musical",
    "jonas brothers": "Jonas Brothers", "miraculous": "Miraculous",
    "alvin and the chipmunks": "Alvin and the Chipmunks",
    "peter rabbit": "Peter Rabbit", "rainbow friends": "Rainbow Friends",
    "ryan's world": "Ryan's World", "the wiggles": "The Wiggles",
    "avatar: the last airbender": "Avatar: The Last Airbender",
    "happy feet": "Happy Feet", "surf's up": "Surf's Up",
    "rudolph the red-nosed reindeer": "Rudolph the Red-Nosed Reindeer",
    "frosty the snowman": "Frosty the Snowman",
    "how the grinch stole christmas": "The Grinch",
    "love, diana": "Love, Diana", "honey girls": "Honey Girls",
    "rebel girls": "Rebel Girls", "girl scouts": "Girl Scouts",
    "wwf": "WWF", "mlb": "MLB", "nfl": "NFL", "nba": "NBA",
    "crayola": "Crayola", "tommy hilfiger": "Tommy Hilfiger",
    "john deere": "John Deere", "jelly belly": "Jelly Belly",
    "peeps": "PEEPS", "peeps collection": "PEEPS", "sweethearts": "Sweethearts",
    "frosted animal cookie": "Frosted Animal Cookie",
    "kabu": "Kabu", "trudi": "Trudi", "casdon": "Casdon",
}

# Product line -> (BearChart category, variant label, is a mini bean)
LINES = {
    "mini beans": ("Mini Bean", "Mini Beans", True),
    "build-a-bear mini beans": ("Mini Bean", "Mini Beans", True),
    "mini furry friends": ("Mini Bean", "Mini", True),
    "smallfrys": ("Stuffed Animal", "Smallfrys", False),
    "jumbo furry friends": ("Stuffed Animal", "Jumbo", False),
    "build-a-bear buddies": ("Stuffed Animal", "Buddies", False),
    "lil' furry friends": ("Stuffed Animal", "Lil' Furry Friends", False),
    "lil' cubs": ("Stuffed Animal", "Lil' Cubs", False),
    "little cub hugs": ("Stuffed Animal", "Little Cub Hugs", False),
    "promise pets": ("Stuffed Animal", "Promise Pets", False),
    "collectibears": ("Stuffed Animal", "Collectibears", False),
    "collectibunnies": ("Stuffed Animal", "Collectibunnies", False),
    "collectifriends": ("Stuffed Animal", "Collectifriends", False),
    "bearemy's kennel pals": ("Stuffed Animal", "Bearemy's Kennel Pals", False),
    "lil' bearemy's kennel pals": ("Stuffed Animal", "Lil' Kennel Pals", False),
    "beary fairy friends": ("Stuffed Animal", "Beary Fairy Friends", False),
    "mystfurry friends": ("Stuffed Animal", "Mystfurry Friends", False),
    "pawlettes": ("Stuffed Animal", "Pawlettes", False),
    "heartables": ("Stuffed Animal", "Heartables", False),
    "mashimals": ("Stuffed Animal", "Mashimals", False),
    "slushie plushies": ("Stuffed Animal", "Slushie Plushies", False),
    "skoosherz": ("Stuffed Animal", "Skoosherz", False),
    "pop-out plush": ("Stuffed Animal", "Pop-Out Plush", False),
    "surprise plush": ("Stuffed Animal", "Surprise Plush", False),
    "bearville pack pals": ("Stuffed Animal", "Bearville Pack Pals", False),
    "wristies": ("Clothing & Accessories", "Wristies", False),
    "backpack clips": ("Clothing & Accessories", "Backpack Clip", False),
    "bag charms": ("Clothing & Accessories", "Bag Charm", False),
    "tiny clips": ("Clothing & Accessories", "Tiny Clip", False),
    "backpacks and purses": ("Clothing & Accessories", "Bag", False),
    "internal accessories": ("Clothing & Accessories", "Internal Accessory", False),
    "advent calendars": ("Clothing & Accessories", "Advent Calendar", False),
}

EXCLUSIVES = {
    "online exclusives": "online_exclusive",
    "employee exclusives": "employee_exclusive",
    "corporate exclusives": "store_exclusive",
    "mass market retail exclusives": "store_exclusive",
    "test market exclusives": "store_exclusive",
    "special workshop exclusives": "store_exclusive",
    "stadium giveaways": "event_exclusive",
    "region exclusives": "international_exclusive",
    "uk exclusives": "international_exclusive",
    "australia exclusives": "international_exclusive",
    "denmark exclusives": "international_exclusive",
    "italy exclusives": "international_exclusive",
    "global exclusives": "international_exclusive",
}

# Pages that describe a grouping, a policy, or the wiki itself - not a product.
META = {
    "collections", "collection categories", "collections of collections",
    "collections of exclusives", "species collections", "release date collections",
    "release year collections", "license collections", "seasonal collections",
    "feature-based collections", "build-a-bear collections", "lines",
    "product lines", "licensed lines", "navigation pages", "maintenance",
    "maintenance categories", "image categories", "organizational categories",
    "workshop pages", "build-a-bear history", "retail presence",
    "retail partnerships", "lawsuits", "essays", "sayings", "mascots", "species",
    "years", "hidden categories", "personal collections", "infobox templates",
    "community photos", "seasonal products", "bundles", "nikki's bears",
    "build-a-bear workshop", "recalled bears",
}

TITLE_IS_META = re.compile(
    r"\b(collection|collections|line|lines|list|category|categories|gallery|index"
    r"|timeline|history|policy|guidelines|template)\s*$", re.I)

YEAR = re.compile(r"^(19|20)\d\d$")


def load_category_names():
    """Every category name, so articles that merely NAME a category are dropped.

    "Dragons" and "Domestic cats" are landing pages. They carry a species tag
    and are otherwise indistinguishable from a product, so the only reliable
    tell is that the title is itself a category.
    """
    path = os.path.join(RESEARCH, "wiki_cats.json")
    if not os.path.exists(path):
        return set()
    with open(path) as f:
        return {re.sub(r"[^a-z0-9]", "", n.lower()) for n, _size in json.load(f)}


CATEGORY_NAMES = load_category_names()


def classify(title, raw_cats):
    """One wiki article -> one catalogue entry, or None if it is not a product."""
    cats = [c.strip() for c in raw_cats]
    low = {c.lower() for c in cats}

    if low & META:
        return None
    if TITLE_IS_META.search(title):
        return None
    if re.sub(r"[^a-z0-9]", "", title.lower()) in CATEGORY_NAMES:
        return None

    species = None
    for c in low:
        if c in SPECIES and SPECIES[c]:
            species = SPECIES[c]
            break

    category, variant, mini = "Stuffed Animal", None, False
    for c in low:
        if c in LINES:
            category, variant, mini = LINES[c]
            break

    # A page has to be identifiable as a thing before it can be catalogued. A
    # species tag, a product line, or the site's own "furry friends" tag all
    # count; a page with none of those is a collection or a stub, and guessing
    # would fill the catalogue with articles rather than bears.
    if not species and variant is None and not (
            low & {"furry friends", "mini furry friends", "jumbo furry friends"}):
        return None

    years = sorted(int(c) for c in cats if YEAR.match(c))
    franchise = next((FRANCHISE[c] for c in low if c in FRANCHISE), None)

    entry = OrderedDict([
        ("canonical_name", title),
        ("category", category),
        ("species", species),
        ("year", years[0] if years else None),
        ("variant", variant),
        ("mini_bean", mini),
        ("franchise", franchise),
        ("licensed", bool(franchise)),
    ])
    for c in low:
        if c in EXCLUSIVES:
            entry[EXCLUSIVES[c]] = True
    if "vault collection" in low:
        entry["vault_release"] = True
    return entry


def main():
    with open(os.path.join(RESEARCH, "wiki_page_cats.json")) as f:
        page_cats = json.load(f)

    entries, skipped = [], 0
    for title in sorted(page_cats):
        e = classify(title, page_cats[title])
        if e is None:
            skipped += 1
            continue
        entries.append(e)

    payload = OrderedDict([
        ("source", "The Build-A-Bear Wiki (buildabearwiki.info)"),
        ("license", "CC BY-SA 4.0"),
        ("retrieved", "2026-09-13"),
        ("contains", "Identification only. No prices, values or rarity ratings."),
        ("items", entries),
    ])
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=1, sort_keys=False)
        f.write("\n")

    print("wrote %s" % OUT)
    print("  %d product entries, %d non-product pages skipped" % (len(entries), skipped))
    named = sum(1 for e in entries if e["species"])
    dated = sum(1 for e in entries if e["year"])
    print("  %d with a species, %d with a release year, %d licensed"
          % (named, dated, sum(1 for e in entries if e["licensed"])))


if __name__ == "__main__":
    main()
