"""
A normalised identity key for catalogue items, for the duplicate audit.

Pure functions, no I/O. Two items whose keys collide are probably one bear
catalogued twice; tools/catalogue_identity.json records the human decision
(merge, or keep distinct) and tools/audit_duplicates.py --strict fails on any
high-severity collision without one.

    name_key(item) -> NameKey(core, year, size_in, qualifiers, mini_bean, vault, category)
    collides(a, b) -> None | "high" | "review"

Python 3.9 compatible.
"""

import re
import unicodedata
from collections import namedtuple

NameKey = namedtuple("NameKey", ["core", "year", "size_in", "qualifiers", "mini_bean",
                                 "vault", "category", "release_year"])

# Franchise and line names that prefix or bracket a name without identifying the
# bear. "Grogu (Star Wars)" and "Star Wars Grogu" are one item. "Vault
# Collection", "Kennel Pals" and "Promise Pets" are deliberately NOT here: they
# are distinct product lines.
FRANCHISE_ALIASES = [
    "disney pixar", "disney", "lilo and stitch", "star wars", "the mandalorian",
    "pokemon", "harry potter", "marvel", "sanrio", "dc comics", "dc", "mini beans",
    "mini bean", "nickelodeon", "dreamworks",
]

# Words with no identifying weight.
NOISE = {"the", "a", "bear", "teddy", "plush", "bearemys", "bearemy", "build",
         "buildabear", "babw", "s"}

# Spelling synonyms. Kept minimal on purpose: every entry is a claim that two
# words name the same thing.
SYN = {"lab": "labrador"}

SIZE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:-|\s)?\s*(?:inch(?:es)?|in)\b")
YEAR_RE = re.compile(r"\b(19\d\d|20\d\d)\b")
SIZE_TOLERANCE_IN = 1.5


def fold(text):
    """ASCII, lower case, '&' as 'and', possessive 's joined, apostrophes gone."""
    t = unicodedata.normalize("NFKD", str(text or ""))
    t = t.encode("ascii", "ignore").decode("ascii").lower()
    t = t.replace("&", " and ")
    t = re.sub(r"['’]s\b", "s", t)
    t = t.replace("'", "").replace("’", "")
    return t


def _norm_phrase(text):
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def _aliases_for(item):
    out = list(FRANCHISE_ALIASES)
    fr = item.get("franchise")
    if fr:
        out.append(_norm_phrase(fold(fr)))
    # Longest first, so "disney pixar" is stripped before "disney".
    return sorted(set(a for a in out if a), key=lambda a: -len(a))


def _tokens(text):
    out = []
    for w in _norm_phrase(text).split():
        if w in NOISE:
            continue
        out.append(SYN.get(w, w))
    return out


def name_key(item):
    name = fold(item.get("canonical_name"))
    aliases = _aliases_for(item)
    year = None
    size_in = None
    qualifiers = set()

    def take_paren(m):
        nonlocal year, size_in
        inner = m.group(1)
        y = YEAR_RE.search(inner)
        if y:
            year = int(y.group(1))
            inner = YEAR_RE.sub(" ", inner)
        sz = SIZE_RE.search(inner)
        if sz:
            size_in = float(sz.group(1))
            inner = SIZE_RE.sub(" ", inner)
        phrase = _norm_phrase(inner)
        if phrase and phrase not in aliases:
            qualifiers.update(_tokens(phrase))
        return " "

    name = re.sub(r"\(([^)]*)\)", take_paren, name)

    if size_in is None:
        sz = SIZE_RE.search(name)
        if sz:
            size_in = float(sz.group(1))
            name = SIZE_RE.sub(" ", name)

    phrase = _norm_phrase(name)
    changed = True
    while changed:
        changed = False
        for a in aliases:
            if phrase == a:
                break
            if phrase.startswith(a + " "):
                phrase = phrase[len(a) + 1:]
                changed = True
                break

    toks = set(_tokens(phrase))
    vault = bool(item.get("vault_release")) or "vault" in toks
    toks.discard("vault")
    core = frozenset(toks | qualifiers)
    return NameKey(core=core, year=year, size_in=size_in, qualifiers=frozenset(qualifiers),
                   mini_bean=bool(item.get("mini_bean")), vault=vault,
                   category=item.get("category"), release_year=item.get("release_year"))


def collides(a, b):
    """None if the two items are distinct by key, else "high" or "review".

    high   - release years equal, or one side has none
    review - release years differ with no explicit (year) to separate them:
             the "Curly Bear 1997 / Curly Teddy 2005" case
    """
    ka = a if isinstance(a, NameKey) else name_key(a)
    kb = b if isinstance(b, NameKey) else name_key(b)
    if not ka.core or ka.core != kb.core:
        return None
    if (ka.mini_bean, ka.category, ka.vault) != (kb.mini_bean, kb.category, kb.vault):
        return None
    if ka.year and kb.year and ka.year != kb.year:
        return None
    if ka.size_in and kb.size_in and abs(ka.size_in - kb.size_in) > SIZE_TOLERANCE_IN:
        return None
    ra, rb = ka.release_year, kb.release_year
    if ra and rb and ra != rb:
        return "review"
    return "high"


def find_collisions(items):
    """[(severity, a, b)] for every colliding pair, grouped by key."""
    keyed = [(name_key(i), i) for i in items]
    groups = {}
    for k, i in keyed:
        if k.core:
            groups.setdefault(k.core, []).append((k, i))
    out = []
    for members in groups.values():
        for x in range(len(members)):
            for y in range(x + 1, len(members)):
                sev = collides(members[x][0], members[y][0])
                if sev:
                    out.append((sev, members[x][1], members[y][1]))
    out.sort(key=lambda t: (t[0] != "high", t[1]["id"], t[2]["id"]))
    return out
