#!/usr/bin/env python3
"""
Fetch CURRENT ACTIVE eBay listings via the official Browse API.

    export EBAY_CLIENT_ID=...  EBAY_CLIENT_SECRET=...
    python3 tools/ebay_active.py --limit 10 --dry     # preview
    python3 tools/ebay_active.py --limit 25           # fetch and store
    python3 tools/ebay_active.py --query "vanilla fudge bunny"

Get a free key at https://developer.ebay.com — create an application, then use the
Production "App ID" (client id) and "Cert ID" (client secret). No approval process:
Browse is a general-release API, unlike Marketplace Insights.

=============================================================================
WHAT THIS IS NOT
=============================================================================
These are ASKING PRICES. They are what somebody hopes to get, not what anything
sold for. BearChart stores them as evidence_type "active_listing", which the
valuation engine refuses to treat as market evidence — a rule with a test behind
it (see tools/test_engine.js, "active listings are never treated as market
evidence"). They can never move a valuation.

They are still worth having. The gap between what people ask and what things
actually sell for is real signal: a large premium means sellers are dreaming, a
discount means the market has moved and the sold comps are stale.

The Browse API returns active inventory only. eBay's sold data lives behind the
Marketplace Insights API, which is a Limited Release that is not open to new
users. For sold comps, use tools/import_sales.py with a Terapeak export.
"""

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_sales import (Matcher, match_pattern, normalise, tokens,  # noqa: E402
                          CONDITION_PATTERNS)
import env_file  # noqa: E402

env_file.load()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tools", "active_listings.json")
TOKEN_CACHE = os.path.join(ROOT, "tools", ".ebay_token.json")

OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token"
SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"
SCOPE = "https://api.ebay.com/oauth/api_scope"
MARKETPLACE = "EBAY_US"

# Be a good citizen: the Browse API is rate limited and we are not in a hurry.
DELAY_SECONDS = 0.4


class EbayError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# HTTP - kept behind two seams so the tests can drive it without a network
# ---------------------------------------------------------------------------

def http_post_form(url, data, headers):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise EbayError("eBay auth failed (HTTP %s): %s"
                        % (e.code, e.read().decode()[:400])) from None


def http_get_json(url, headers):
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:400]
        if e.code == 429:
            raise EbayError("eBay rate limit reached. Wait, then re-run with a "
                            "smaller --limit.") from None
        raise EbayError("eBay request failed (HTTP %s): %s" % (e.code, detail)) from None


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def get_token(client_id, client_secret, cache=True):
    """Client-credentials OAuth. Tokens last two hours, so they are cached."""
    if cache and os.path.exists(TOKEN_CACHE):
        try:
            with open(TOKEN_CACHE) as f:
                t = json.load(f)
            if t.get("expires_at", 0) > time.time() + 60 and t.get("client_id") == client_id:
                return t["access_token"]
        except (ValueError, KeyError):
            pass

    basic = base64.b64encode(("%s:%s" % (client_id, client_secret)).encode()).decode()
    payload = http_post_form(
        OAUTH_URL,
        {"grant_type": "client_credentials", "scope": SCOPE},
        {"Authorization": "Basic " + basic,
         "Content-Type": "application/x-www-form-urlencoded"},
    )
    if "access_token" not in payload:
        raise EbayError("no access_token in eBay response: %r" % payload)

    if cache:
        try:
            with open(TOKEN_CACHE, "w") as f:
                json.dump({"access_token": payload["access_token"],
                           "client_id": client_id,
                           "expires_at": time.time() + int(payload.get("expires_in", 7200))}, f)
            os.chmod(TOKEN_CACHE, 0o600)
        except OSError:
            pass
    return payload["access_token"]


# ---------------------------------------------------------------------------
# Search and normalisation
# ---------------------------------------------------------------------------

def search(token, query, limit=50):
    params = {
        "q": query,
        "limit": str(min(limit, 200)),
        "filter": "buyingOptions:{FIXED_PRICE|AUCTION},conditionIds:{1000|1500|2000|2500|3000|4000|5000|6000|7000}",
    }
    url = SEARCH_URL + "?" + urllib.parse.urlencode(params)
    return http_get_json(url, {
        "Authorization": "Bearer " + token,
        "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
        "Accept": "application/json",
    })


def price_of(summary):
    p = (summary.get("price") or {})
    try:
        v = float(p.get("value"))
    except (TypeError, ValueError):
        return None, None
    return (v if v > 0 else None), p.get("currency") or "USD"


def image_of(summary):
    img = (summary.get("image") or {}).get("imageUrl")
    if img:
        return img
    thumbs = summary.get("thumbnailImages") or []
    return thumbs[0].get("imageUrl") if thumbs else None


def normalise_listing(summary, item):
    """One Browse result -> one active_listing record. Always an asking price."""
    price, currency = price_of(summary)
    if price is None:
        return None
    title = summary.get("title") or ""
    return OrderedDict([
        ("id", "active-%s" % summary.get("itemId", "")),
        ("item_id", item["id"]),
        ("listing_id", summary.get("legacyItemId") or summary.get("itemId")),
        ("title", title),
        ("ask_price", round(price, 2)),
        ("currency", currency),
        ("condition", match_pattern(CONDITION_PATTERNS,
                                    (summary.get("condition") or "") + " " + title, "Unknown")),
        ("buying_option", ",".join(summary.get("buyingOptions") or [])),
        ("marketplace", "eBay"),
        ("source_url", summary.get("itemWebUrl")),
        ("image_url", image_of(summary)),
        # The seller username is deliberately NOT kept. It is eBay user data,
        # and holding it drags the whole catalogue into the Marketplace Account
        # Deletion obligation - every closure notice would mean rebuilding and
        # redeploying a static site to erase a name. The ask-vs-sold signal
        # this file exists for does not need to know who is asking.
        # The whole point: this can never be mistaken for a sale.
        ("evidence_type", "active_listing"),
    ])


# Catalogue bookkeeping that no seller ever types into a listing title. Leaving
# these in the query turns an AND-matched keyword search into zero results.
VERSION_RE = re.compile(r"\s+(v\.?\s?\d+|version\s+\d+|i{2,3}|iv|vi{0,3})$", re.I)


def build_query(item, with_year=False):
    """A search string specific enough to avoid dragging in the whole catalogue.

    eBay's q parameter is effectively AND across keywords, so every word added
    here is a word a seller must also have typed. That cuts both ways: too few
    and we get the entire plush aisle, too many and we get nothing at all.
    """
    name = re.sub(r"\s*\([^)]*\)", "", item["canonical_name"]).strip()
    name = VERSION_RE.sub("", name).strip()
    # A slash in a catalogue name means "and", not "or" - it is a lot, and there
    # is no such product to search for.
    name = name.replace("/", " ")
    parts = ["build-a-bear", name]
    # Mini Beans share their names with the full-size friends. Without the line
    # name the query returns 18-inch bears and prices this like one.
    if item.get("mini_bean"):
        parts.append("mini beans")
    if with_year and item.get("release_year") and str(item["release_year"]) not in name:
        parts.append(str(item["release_year"]))
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Confirming a result actually IS the item we searched for
# ---------------------------------------------------------------------------
#
# eBay's search is tuned for recall, not precision: ask for "build-a-bear kennel
# pals calico cat" and it will happily hand back a Kennel Pals dalmatian, a
# generic white cat, and a lot of five bears. Before this gate existed, a
# targeted search stamped item_id onto EVERY result it got, because we had asked
# about that item - so those asking prices would have landed on the wrong bear
# and skewed its ask-vs-sold spread with nothing on screen to show it.
#
# The rule is deliberately strict. A rejected listing costs us one data point.
# A wrongly-attached one is bad data wearing the right label.

LOT_RE = re.compile(
    r"\b(lots?|bundles?|job\s*lot|set\s+of\s+\d|\d+\s*pcs?\b|x\s?\d+\b"
    r"|your\s+choice|choose\s+\w+|pick\s+\d)\b")
BRAND_RE = re.compile(r"buildabear|babw")

# Things sold *for* or *alongside* a bear that carry its name in the title.
# Kennel Pals food bowls, pet carriers, McDonald's Happy Meal versions and
# keychains all arrived attached to $150+ bears and showed up as 90%-off deals.
JUNK_RE = re.compile(
    r"mcdonald|happy\s*meal|\bbowls?\b|\bmats?\b|pet\s*(?:house|bed|carrier)|carrying\s*case"
    r"|\bcarrier\b|key\s*chain|keychain|key\s*ring|ornament|magnet|sticker|figurine"
    r"|cookie\s*cutter|trading\s*card|\bpins?\b|\bbook\b"
    r"|(?:outfit|clothes|clothing|shoes|accessor(?:y|ies)|costume|box|tags?|certificate)\s+only"
    r"|no\s+bear\b|bear\s+not\s+included|empty\s+box|for\s+parts")
# A smaller version shares the name and nothing like the price. "Lil" alone is
# not on this list: "Lil' Bunny Big Ears" is the full-size 16-inch bunny.
SMALL_RE = re.compile(
    r"lil'?\s+bearemy|\bsmall\s?frys?\b|\bwristies?\b|\bmini\b"
    r"|(?:^|\s)[4-9]\s*(?:\"|\u201d|''|in\b|inch)")
# Clothing sold to fit a bear, rather than a bear wearing clothes.
CLOTHING_RE = re.compile(
    r"\b(?:outfits?|costumes?|clothes|clothing|shoes|sneakers|boots|pajamas?|pjs|sleeper"
    r"|dress|skirt|shirt|hoodie|jacket|hat)\s+(?:set|only|\d+\s*(?:pc|piece))")
FITS_RE = re.compile(
    r"\b(?:fits|for)\s+(?:most\s+|all\s+)?(?:build|bab|babw|\d{2}|stuffed|plush|bears?\b|teddy)")
BRAND_STRIP_RE = re.compile(r"build[\s-]*a[\s-]*bear(?:\s*workshop)?|buildabear|babw|\bbab\b")


def _not_the_bear(item, title):
    """An accessory, a smaller version or an outfit sold under the bear's name."""
    low = str(title or "").lower()
    own = str(item.get("canonical_name") or "").lower()
    junk = JUNK_RE.search(low)
    if junk and junk.group(0).strip() not in own:
        return "accessory or other product (%s)" % junk.group(0).strip()
    small = SMALL_RE.search(low)
    if small and not item.get("mini_bean") and small.group(0).strip("' ") not in own:
        return "smaller version (%s)" % small.group(0).strip()
    if item.get("category") != "Clothing & Accessories":
        bare = BRAND_STRIP_RE.sub(" ", low)
        if FITS_RE.search(bare) or CLOTHING_RE.search(bare):
            return "clothing or accessory, not the bear"
    return None


def _stem(word):
    return word[:-1] if len(word) > 3 and word.endswith("s") else word


def _words(text):
    return {_stem(w) for w in re.sub(r"[^a-z0-9 ]", " ", str(text or "").lower()).split()}


def _phrase(text):
    """Whole words, single-spaced, with a space at each end, so a name is found
    as a phrase. A squashed-substring test let "Otter" match "Harry Potter" and
    "Bob" match "bobblehead"."""
    return " %s " % " ".join(re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).split())

# Aliases that name a product line rather than one bear. "Kennel Pals" is an
# alias of the Calico Cat and part of the name of thirty-odd other items, so a
# Kennel Pals dog, a pet coat and a food set all "named the item" and showed up
# as Calico Cat deals. Filled from the catalogue by load_items(); while it is
# empty no alias is skipped.
GENERIC_ALIASES = set()

def mark_generic_aliases(items):
    names = [_phrase(i.get("canonical_name")) for i in items]
    GENERIC_ALIASES.clear()
    for item in items:
        own = _phrase(item.get("canonical_name"))
        for alias in item.get("aliases") or []:
            p = _phrase(alias)
            if p.strip() and sum(1 for n in names if n != own and p in n) >= 2:
                GENERIC_ALIASES.add(p)


def title_confirms(item, title, loose=False):
    """Does this listing title actually name this item? -> (ok, reason)

    Returns the reason either way so a --dry run can show you what it threw out
    and why, and you can argue with the rule before it silently costs you data.
    """
    norm = normalise(title)
    if LOT_RE.search(str(title or "").lower()):
        return False, "multi-item lot"
    other = _not_the_bear(item, title)
    if other:
        return False, other
    if not loose and not BRAND_RE.search(norm):
        return False, "no Build-A-Bear branding in title"

    # Mini Beans and the full-size friend share a name and nothing else -
    # including, by a wide margin, a price.
    mini_in_title = "minibean" in norm
    if bool(item.get("mini_bean")) != mini_in_title:
        return False, ("Mini Beans wanted, full size listed" if item.get("mini_bean")
                       else "full size wanted, Mini Beans listed")

    need = {_stem(w) for w in tokens(item.get("canonical_name"))}
    if not need:
        # e.g. an item called just "Bear": every word in the name is a word that
        # appears in half the plush aisle, so there is no honest way to confirm
        # a match. Checked before containment, or "Bear" would match everything.
        return False, "item name too generic to confirm"

    # The canonical name, or a specific alias, appearing whole is proof enough.
    title_words = _phrase(title)
    canonical = item.get("canonical_name")
    if canonical and (_phrase(canonical) in title_words
                      or (len(normalise(canonical)) >= 10 and normalise(canonical) in norm)):
        return True, "names the item"
    for alias in item.get("aliases") or []:
        p = _phrase(alias)
        if p.strip() and p not in GENERIC_ALIASES and p in title_words:
            return True, "names the item"
    missing = need - _words(title)
    if missing:
        return False, "missing " + ", ".join(sorted(missing))
    return True, "all name words present"


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def load_items(args, data):
    items = data["items"]
    mark_generic_aliases(items)
    if args.item:
        picked = [i for i in items if i["id"] == args.item]
        if not picked:
            raise SystemExit("no such item: %s" % args.item)
        return picked
    if args.priced_only:
        items = [i for i in items if i.get("_has_sales")]
    # A lot is a thing you happened to sell together, not a thing anyone lists.
    # Searching for "Shoes / Roller Skates Lot" returns noise and attaches it.
    # "+" in a catalogue name means the same thing whether or not is_lot was set,
    # and several multi-piece outfit records were never flagged.
    return [i for i in items
            if not i.get("is_lot") and "+" not in (i.get("canonical_name") or "")]


def attach_images(listings, data):
    """Write listing photos into tools/image_overrides.json for items with none.

    Opt-in via --images. eBay permits displaying listing imagery alongside listing
    data, and every attachment records its credit and source so the provenance is
    visible. These URLs die when the listing ends, so they are a stopgap - your own
    photographs are the durable answer.
    """
    path = os.path.join(ROOT, "tools", "image_overrides.json")
    overrides = {}
    if os.path.exists(path):
        with open(path) as f:
            overrides = json.load(f)

    has_photo = {i["id"] for i in data["items"] if i.get("image_url")}
    attached = 0
    for l in listings:
        item_id = l["item_id"]
        if not l.get("image_url"):
            continue
        # Never overwrite a photo that is already attached.
        if item_id in has_photo or item_id in overrides:
            continue
        overrides[item_id] = {
            "image_url": l["image_url"],
            "image_credit": "eBay listing photo",
            "image_source": l.get("source_url"),
        }
        attached += 1

    if attached:
        with open(path, "w") as f:
            json.dump(overrides, f, indent=2, sort_keys=True)
            f.write("\n")
    return attached, path


def run(args, searcher=None, token=None):
    with open(os.path.join(ROOT, "data.json")) as f:
        data = json.load(f)

    with_sales = {s["item_id"] for s in data["sales"]}
    for i in data["items"]:
        i["_has_sales"] = i["id"] in with_sales

    matcher = Matcher(data["items"])

    if args.query:
        targets = [{"id": None, "canonical_name": args.query, "release_year": None}]
        queries = [(None, args.query)]
    else:
        eligible = load_items(args, data)
        pool = [i for i in data["items"] if not args.priced_only or i.get("_has_sales")]
        if len(pool) > len(eligible):
            print("skipping %d lot/multi-piece record(s) - no single product to search for"
                  % (len(pool) - len(eligible)))
        targets = eligible[: args.limit]
        queries = [(i, build_query(i, args.with_year)) for i in targets]

    # Auditing the search strings costs nothing and needs no credentials. Query
    # quality decides everything downstream, so it is worth reading them first.
    if getattr(args, "print_queries", False):
        for item, q in queries:
            print("%-56s  %s" % (q, (item or {}).get("id") or "(free text)"))
        print("\n%d quer%s - no API call made"
              % (len(queries), "y" if len(queries) == 1 else "ies"))
        return 0

    if searcher is None:
        cid = args.client_id or os.environ.get("EBAY_CLIENT_ID")
        secret = args.client_secret or os.environ.get("EBAY_CLIENT_SECRET")
        if not cid or not secret:
            raise SystemExit(
                "eBay credentials missing.\n\n"
                + env_file.describe(["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"]) +
                "\n\nPut them in a .env file next to package.json:\n"
                "  cp .env.example .env      then fill it in\n\n"
                "Use the PRODUCTION keyset from developer.ebay.com. Sandbox keys fail\n"
                "against api.ebay.com with a misleading auth error.")
        token = get_token(cid, secret)
        searcher = lambda q: search(token, q, args.per_item)  # noqa: E731

    listings, unmatched, errors = [], 0, []
    rejected = []
    seen = set()

    for n, (item, q) in enumerate(queries, start=1):
        if n > 1:
            time.sleep(DELAY_SECONDS)
        try:
            payload = searcher(q)
        except EbayError as e:
            errors.append("%s: %s" % (q, e))
            if len(errors) >= 3:
                print("stopping after 3 consecutive failures", file=sys.stderr)
                break
            continue

        summaries = payload.get("itemSummaries") or []
        print("  %-52s %d result(s)" % (q[:52], len(summaries)))

        for s in summaries:
            # Free-text searches still have to resolve to a known item; a listing
            # we cannot identify is not attached to anything.
            target = item
            if target is None or target.get("id") is None:
                target, how, _ = matcher.resolve(None, s.get("title"), args.fuzzy)
                if target is None:
                    unmatched += 1
                    continue
            else:
                # We asked eBay about this item; that is not the same as eBay
                # having answered about this item.
                ok, why = title_confirms(target, s.get("title"), args.loose)
                if not ok:
                    rejected.append((why, s.get("title") or ""))
                    continue
            rec = normalise_listing(s, target)
            if rec is None:
                continue
            if rec["id"] in seen:
                continue
            seen.add(rec["id"])
            listings.append(rec)

    print("\nfetched %d active listing(s) across %d quer%s"
          % (len(listings), len(queries), "y" if len(queries) == 1 else "ies"))
    if unmatched:
        print("  %d listing(s) could not be matched to a catalogued item" % unmatched)
    if rejected:
        by_reason = {}
        for why, title in rejected:
            by_reason.setdefault(why.split(" missing ")[0], []).append(title)
        print("  %d result(s) rejected as not being the item searched for:" % len(rejected))
        for why in sorted(by_reason, key=lambda k: -len(by_reason[k])):
            titles = by_reason[why]
            print("    %-34s %d  e.g. %s" % (why[:34], len(titles), titles[0][:44]))
        print("    (--loose drops the branding requirement)")
    for e in errors:
        print("  error: %s" % e, file=sys.stderr)

    if args.dry:
        for rec in listings[:10]:
            print("    %-9s %-44s %s" % ("$%.2f" % rec["ask_price"],
                                         rec["title"][:44], rec["item_id"]))
        print("\ndry run - nothing written")
        return 0

    if not listings:
        print("nothing to write")
        return 0

    payload = OrderedDict([
        ("fetched_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())),
        ("source", "eBay Browse API (active listings only)"),
        ("warning", "Asking prices. Never sold data. These do not affect any valuation."),
        ("listings", listings),
    ])
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")
    print("wrote %s" % OUT)

    if args.images:
        n, path = attach_images(listings, data)
        print("attached %d listing photo(s) to items that had none" % n)
        if n:
            print("  -> %s" % path)
            print("  note: eBay image URLs expire when the listing ends. Replace them "
                  "with your own photographs when you can.")

    print("now run: npm run build")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--client-id")
    ap.add_argument("--client-secret")
    ap.add_argument("--limit", type=int, default=20,
                    help="how many catalogue items to search for (default 20)")
    ap.add_argument("--per-item", type=int, default=20,
                    help="max listings per item (default 20)")
    ap.add_argument("--item", help="fetch for one item id only")
    ap.add_argument("--query", help="free-text search instead of walking the catalogue")
    ap.add_argument("--priced-only", action="store_true",
                    help="only items that already have sold comps, to measure the spread")
    ap.add_argument("--fuzzy", action="store_true")
    ap.add_argument("--images", action="store_true",
                    help="also attach listing photos to items that have none. Opt-in: "
                         "eBay images vanish when the listing ends, so they are a "
                         "stopgap until you photograph your own stock.")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--print-queries", action="store_true",
                    help="show the search strings and exit - no API call, no credentials")
    ap.add_argument("--with-year", action="store_true",
                    help="add the release year to each query (narrows hard - eBay ANDs it)")
    ap.add_argument("--loose", action="store_true",
                    help="accept results whose title omits Build-A-Bear branding")
    args = ap.parse_args()
    try:
        return run(args)
    except EbayError as e:
        print("error: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
