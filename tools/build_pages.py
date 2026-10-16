#!/usr/bin/env python3
"""
Generate one real HTML page per catalogued item, plus a sitemap.

    python3 tools/build_pages.py                     # write item/*.html
    python3 tools/build_pages.py --base-url https://bearchart.example
    npm run pages

WHY THIS EXISTS
    Every item used to live at item.html?id=<slug> and be drawn by JavaScript
    after the page loaded. To a search engine that is ONE page - the whole
    catalogue was, as far as Google was concerned, a single empty
    document. People searching "1997 build a bear brown teddy value" were
    typing the exact question this site answers and could not find it.

    So each item gets a file of its own, with its facts already in the HTML:
    title, description, headings, the valuation and the comps behind it. The
    interactive page still takes over once item.js runs; this is what is there
    before it does, and what a crawler sees.

WHAT IT WILL NOT DO
    It will not publish a price for an item with no sold data, in the page, the
    meta description or the structured data. An unpriced item says so. The
    whole argument of this site is that it does not guess, and a meta
    description is still a claim - arguably the most-read claim on the page.

    The structured data carries no "offers" either. schema.org offers mean
    something is for sale at that price; Plush Price Guide sells nothing and these are
    estimates from past sales. Rich snippets are not worth a false statement.
"""

import argparse
import html
import json
import os
import re
import shutil
from datetime import date
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "item")

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
    'family=Fraunces:opsz,wght,SOFT,WONK@9..144,400..900,0..100,0..1'
    '&family=Nunito+Sans:wght@400..800&display=swap">'
)

# The one script order every page uses. config.js and observability.js come
# first so an error in any later script can be reported (observability.js is
# inert without a DSN); site-config.js is the data manifest bc-data.js reads;
# sanitize.js (URL/CSV/escape helpers) must precede auth.js and common.js.
SCRIPTS = ["config.js", "observability.js", "site-config.js", "sanitize.js", "bc-data.js",
           "engine.js", "icons.js", "auth.js", "entitlements.js", "submissions.js",
           "common.js", "item.js"]

# Pages that are not items but still belong in the sitemap.
TOP_LEVEL = ["index.html", "deals.html", "checklists.html", "collection.html",
             "about.html", "plans.html", "showcase.html",
             "privacy.html", "terms.html"]


def e(text):
    return html.escape(str(text if text is not None else ""), quote=True)


def money(n):
    """Same precision rule the site itself uses.

    Cents below $100, whole dollars above it: quoting "$204.49" for a bear
    whose comps range over forty dollars is false precision, and the pages have
    to agree with what common.js prints or the two will be caught disagreeing.
    """
    if n is None:
        return None
    if n < 100:
        return "$%s" % format(round(float(n), 2), ",.2f")
    return "$%s" % format(int(round(float(n))), ",")


def describe(item, val):
    """The meta description - a claim, so it says only what we can support."""
    bits = [item["canonical_name"]]
    if item.get("release_year"):
        bits.append("(%s)" % item["release_year"])
    name = " ".join(bits)

    if val and val.get("has_value"):
        return ("%s Build-A-Bear resale value: %s, from %d recorded %s. "
                "%s confidence. Independent price guide built on completed sales, "
                "never asking prices."
                % (name, money(val["fair_market"]), val["comparable_count"],
                   "sale" if val["comparable_count"] == 1 else "sales",
                   val["confidence"].title()))
    return ("%s Build-A-Bear collector reference. No sold data recorded yet, so "
            "Plush Price Guide publishes no value for it - identification, release year "
            "and line details only." % name)


def title_for(item, val):
    """"{name} value - Plush Price Guide (independent)", the item.js title
    too. The year stays: it is how collectors tell two bears of one name apart."""
    year = " (%s)" % item["release_year"] if item.get("release_year") else ""
    return "%s%s value \u2014 Plush Price Guide (independent)" % (item["canonical_name"], year)


def json_ld(item, val, url):
    """Structured data. Facts only - no offers, no invented price."""
    node = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": item["canonical_name"],
        "category": item.get("category"),
        "description": describe(item, val),
        "url": url or None,
        # Naming the manufacturer is a fact about the toy, not a claim of any
        # relationship with them. The disclaimer sits on every page.
        "brand": {"@type": "Brand", "name": "Build-A-Bear Workshop"},
    }
    if item.get("aliases"):
        node["alternateName"] = item["aliases"]
    if item.get("release_year"):
        node["releaseDate"] = str(item["release_year"])
    if item.get("image_url"):
        node["image"] = item["image_url"]
    node = {k: v for k, v in node.items() if v}
    # Catalogue names come from a weekly wiki import. Escape the characters that
    # could close the <script> block or open a comment: JSON still parses
    # identically, but "</script>" can no longer appear inside it.
    return (json.dumps(node, indent=1)
            .replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026"))


def facts_list(item):
    rows = [
        ("Release year", item.get("release_year") or "Not recorded"),
        ("Species", item.get("species")),
        ("Category", item.get("category")),
        ("Line", item.get("line")),
        ("Franchise", item.get("franchise")),
    ]
    out = []
    for label, value in rows:
        if value:
            out.append("<dt>%s</dt><dd>%s</dd>" % (e(label), e(value)))
    return "<dl class=\"kv\">%s</dl>" % "".join(out)


def value_block(item, val, sales):
    """The part a crawler reads. Priced items state the figure and its basis."""
    if not (val and val.get("has_value")):
        return (
            '<h2>No sold price on record yet</h2>'
            '<p>Plush Price Guide has no recorded sold transactions for the '
            '%s, so it publishes <strong>no value</strong> for it. '
            'An estimate with nothing behind it is a guess, and a guess printed '
            'next to a dollar sign gets treated as a fact.</p>'
            '<p>If you have bought or sold one, that sale is exactly the '
            'evidence this page is missing.</p>'
            % e(item["canonical_name"]))

    n = val["comparable_count"]
    rows = "".join(
        "<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>" % (
            e(s.get("sale_date") or "Undated"),
            e(money(s.get("sold_price"))),
            e(s.get("condition") or "Unknown"),
            e(s.get("marketplace") or "-"))
        for s in sales[:12])

    return (
        '<h2>Estimated market value</h2>'
        '<p class="lede"><strong>%s</strong> &mdash; from %d recorded %s, '
        'at <strong>%s</strong> confidence.</p>'
        '<p>Range %s to %s. Median sold %s, adjusted to a baseline of Good '
        'condition with no extras. Asking prices are never used.</p>'
        '<h3>Recorded sales</h3>'
        '<div class="table-scroll"><table><thead><tr><th>Date</th><th>Price</th>'
        '<th>Condition</th><th>Marketplace</th></tr></thead><tbody>%s</tbody>'
        '</table></div>'
        % (e(money(val["fair_market"])), n, "sale" if n == 1 else "sales",
           e(val["confidence"].title()),
           e(money(val["range_low"])), e(money(val["range_high"])),
           e(money(val["median_raw"])), rows))


SHOP_REL = "sponsored noopener noreferrer"


def _encode_component(text):
    """JavaScript's encodeURIComponent."""
    return quote(str(text), safe="-_.!~*'()")


def shop_href(business, placement, item_id=None, kind="home", item_name=None, condition=None):
    """The Python twin of common.js BC.shopHref: the same template choice, the
    same UTM parameters in the same order, the same URL. tools/test_pages_seo.py
    holds the two equal. '' when the shop is off or its URL is not https."""
    if not business.get("enabled") or not business.get("shop_url"):
        return ""
    tpl = None
    if kind == "search":
        tpl = business.get("shop_search_url")
    elif kind in ("offer", "quote"):
        tpl = business.get("shop_offer_url")
    raw = ((tpl or business["shop_url"])
           .replace("{q}", _encode_component(item_name or ""))
           .replace("{item}", _encode_component(item_id or ""))
           .replace("{condition}", _encode_component(condition or "")))
    safe = re.compile(r"^https://[^\s\"'<>\\]+$")
    if not safe.match(raw):
        raw = business["shop_url"]
        if not safe.match(raw):
            return ""
    parts = urlsplit(raw)
    params = parse_qsl(parts.query, keep_blank_values=True)

    def put(key, value):
        # URLSearchParams.set: replace the first in place, drop the rest, or append.
        nonlocal params
        out, done = [], False
        for k, v in params:
            if k == key:
                if not done:
                    out.append((k, value))
                    done = True
                continue
            out.append((k, v))
        if not done:
            out.append((key, value))
        params = out

    put("utm_source", "bearchart")
    put("utm_medium", "referral")
    put("utm_campaign", "guide")
    put("utm_content", placement)
    if item_id:
        put("utm_term", item_id)
    return urlunsplit((parts.scheme, parts.netloc, parts.path or "/", urlencode(params),
                       parts.fragment))


def shop_promo(business, val, item_id=None):
    """The operator's own shop, in the static markup.

    Only where the item has no sold data: a priced item gets the store panel
    after its evidence once item.js runs. Labelled as our store, followed by
    the one-line disclosure, rel="sponsored", UTM-tagged like every store link.
    """
    if val and val.get("has_value"):
        return ""
    href = shop_href(business, "item_quote", item_id, kind="quote")
    if not href:
        return ""
    return (
        '<aside class="promo">'
        '<p class="promo-eyebrow">%s</p>'
        '<h2 class="promo-title">%s</h2>'
        '<p class="promo-blurb">%s</p>'
        '<p class="promo-act"><a class="btn btn-primary" href="%s" target="_blank" rel="%s" '
        'data-shop-placement="item_quote" data-shop-kind="quote" data-item="%s">%s'
        '<span class="ext" aria-hidden="true"> &#8599;</span>'
        '<span class="sr-only"> (opens our shop)</span></a></p>'
        '<p class="shop-disclosure fine">%s <a href="../about.html#conflicts">How we keep it '
        'separate</a></p>'
        '</aside>'
        % (e(business.get("shop_eyebrow") or business.get("name")),
           e(business.get("shop_headline") or business.get("name")),
           e(business.get("shop_blurb") or ""),
           e(href), SHOP_REL, e(item_id or ""),
           e("Ask Jay's Retro Exchange for a quote"),
           e(business.get("shop_disclosure_short") or
             "Jay's Retro Exchange is our store. It never changes a value in this guide.")))


def page_html(item, val, sales, base_url, disclaimer, business=None):
    slug = item["id"]
    url = ("%s/item/%s.html" % (base_url.rstrip("/"), slug)) if base_url else ""
    desc = describe(item, val)
    aliases = ""
    if item.get("aliases"):
        aliases = ('<p class="fine">Also listed as %s</p>'
                   % e(", ".join(item["aliases"])))

    return """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%(title)s</title>
<meta name="description" content="%(desc)s">
%(canonical)s<meta name="theme-color" content="#b3131c">
<link rel="manifest" href="../manifest.webmanifest">
<link rel="apple-touch-icon" href="../icons/ppg-apple-touch-icon.png">
<link rel="icon" href="../favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="../icons/ppg-icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Plush Price">
<meta property="og:type" content="article">
<meta property="og:title" content="%(title)s">
<meta property="og:description" content="%(desc)s">
<meta property="og:site_name" content="Plush Price Guide">
%(social)s
%(fonts)s
<script src="../theme.js"></script>
<link rel="stylesheet" href="../styles.css">
<script type="application/ld+json">
%(jsonld)s
</script>
</head>
<body>

<header class="masthead" id="masthead"></header>
<div class="disclaimer-bar" id="disclaimer-bar"></div>

<main id="main" tabindex="-1">
  <p class="fine bc-status" data-bc-status aria-live="polite" hidden></p>
  <div class="wrap" id="item-root">
    <!-- Rendered at build time so this page says something before any
         JavaScript runs. item.js replaces it with the interactive version. -->
    <article class="panel">
      <p class="fine"><a href="../index.html">&larr; Price guide</a></p>
      <h1>%(name)s</h1>
      <p class="fine">%(meta)s</p>
      %(aliases)s
      %(facts)s
      %(value)s
      <p class="fine">%(disclaimer)s</p>
    </article>
    %(promo)s
  </div>
</main>

<footer class="site" id="site-footer"></footer>

%(scripts)s
</body>
</html>
""" % {
        "title": e(title_for(item, val)),
        "desc": e(desc),
        "canonical": ('<link rel="canonical" href="%s">\n' % e(url)) if url else "",
        # The large preview card needs an absolute image address, so it only
        # appears when the site address is known.
        "social": ('<meta property="og:image" content="%s/icons/ppg-og-image.png">\n'
                   '<meta property="og:image:width" content="1200">\n'
                   '<meta property="og:image:height" content="630">\n'
                   '<meta name="twitter:card" content="summary_large_image">'
                   % e(base_url.rstrip("/"))) if base_url else '<meta name="twitter:card" content="summary">',
        "fonts": FONTS,
        "jsonld": json_ld(item, val, url),
        "name": e(item["canonical_name"]),
        "meta": e(" · ".join(str(x) for x in [
            item.get("release_year") or "Year unknown",
            item.get("species"), item.get("category")] if x)),
        "aliases": aliases,
        "facts": facts_list(item),
        "value": value_block(item, val, sales),
        "disclaimer": e(disclaimer),
        "promo": shop_promo(business or {}, val, slug),
        "scripts": "\n".join('<script src="../%s"></script>' % s for s in SCRIPTS),
    }


def valuations(data):
    """Each item's valuation summary, from the catalogue index tools/build_assets.js
    wrote with the real engine (E.summary), so the pages cannot drift from it."""
    path = os.path.join(ROOT, "data", "manifest.json")
    if not os.path.exists(path):
        raise SystemExit("data/manifest.json is missing: run `npm run build:assets` "
                         "(node tools/build_assets.js) before building the pages.")
    with open(path) as f:
        manifest = json.load(f)
    with open(os.path.join(ROOT, manifest["index"])) as f:
        index = json.load(f)
    return {rec["id"]: rec["v"] for rec in index["items"]}


def redirect_stub_html(old_id, new_item, base_url):
    """item/<old>.html for an id merged into another item.

    Works on any static host with no host-specific redirect config: a meta
    refresh, a script (external - the CSP forbids inline script), a canonical
    link and a visible link. noindex keeps the old URL out of search results.
    """
    target = "%s.html" % new_item["id"]
    canonical = ("%s/item/%s" % (base_url.rstrip("/"), target)) if base_url else target
    return """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>%(name)s - Plush Price Guide</title>
<link rel="canonical" href="%(canonical)s">
<meta http-equiv="refresh" content="0; url=%(target)s">
<script src="../redirect.js"></script>
</head>
<body>
<p>This bear now lives at <a href="%(target)s">%(name)s</a>.</p>
<!-- merged: %(old)s -->
</body>
</html>
""" % {"name": e(new_item["canonical_name"]), "canonical": e(canonical),
       "target": e(target), "old": e(old_id)}


def write_redirect_stubs(data, base_url):
    items = {i["id"]: i for i in data["items"]}
    n = 0
    for old, new in sorted((data.get("redirects") or {}).items()):
        if old in items or new not in items:
            continue
        with open(os.path.join(OUT_DIR, "%s.html" % old), "w") as f:
            f.write(redirect_stub_html(old, items[new], base_url))
        n += 1
    return n


def write_sitemap(data, base_url):
    if not base_url:
        return None
    base = base_url.rstrip("/")
    today = date.today().isoformat()
    urls = ["%s/%s" % (base, p) for p in TOP_LEVEL]
    # Items only: redirect stubs for merged ids are noindex and never listed.
    urls += ["%s/item/%s.html" % (base, i["id"]) for i in data["items"]]
    body = "".join(
        "  <url><loc>%s</loc><lastmod>%s</lastmod></url>\n" % (e(u), today)
        for u in urls)
    path = os.path.join(ROOT, "sitemap.xml")
    with open(path, "w") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n'
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                + body + '</urlset>\n')
    return path, len(urls)


def write_robots(base_url):
    # Sign-in and admin pages have nothing for a search engine to show.
    lines = ["User-agent: *", "Allow: /", "Disallow: /admin.html",
             "Disallow: /account.html", ""]
    if base_url:
        lines.append("Sitemap: %s/sitemap.xml" % base_url.rstrip("/"))
        lines.append("")
    path = os.path.join(ROOT, "robots.txt")
    with open(path, "w") as f:
        f.write("\n".join(lines))
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url",
                    help="absolute site root, e.g. https://bearchart.example. "
                         "Needed for canonical links and the sitemap.")
    ap.add_argument("--clean", action="store_true",
                    help="delete item/ first, so pages for removed items go too")
    args = ap.parse_args()

    with open(os.path.join(ROOT, "data.json")) as f:
        data = json.load(f)

    base_url = args.base_url or (data["meta"].get("site_url") or "")

    if args.clean and os.path.isdir(OUT_DIR):
        shutil.rmtree(OUT_DIR)
    os.makedirs(OUT_DIR, exist_ok=True)

    vals = valuations(data)
    sales_by_item = {}
    for s in data["sales"]:
        sales_by_item.setdefault(s["item_id"], []).append(s)
    for v in sales_by_item.values():
        v.sort(key=lambda s: (s.get("sale_date") or "", s.get("sold_price") or 0),
               reverse=True)

    priced = 0
    for item in data["items"]:
        val = vals.get(item["id"])
        if val and val.get("has_value"):
            priced += 1
        page = page_html(item, val, sales_by_item.get(item["id"], []),
                         base_url, data["meta"]["disclaimer"],
                         data.get("business") or {})
        with open(os.path.join(OUT_DIR, "%s.html" % item["id"]), "w") as f:
            f.write(page)

    print("wrote %d item pages to %s/" % (len(data["items"]), os.path.relpath(OUT_DIR, ROOT)))
    print("  %d state a value, %d say they have no sold data"
          % (priced, len(data["items"]) - priced))

    # One shell that stands in for any item page the browser has not cached.
    # The service worker serves this for /item/<anything>.html when offline;
    # the address bar still says which bear, so item.js reads the slug from the
    # path and renders it from the cached catalogue. One file, and every
    # item works offline - precaching them all would be 8MB.
    offline = page_html(
        {"id": "_offline", "canonical_name": "Loading…", "aliases": [],
         "category": None, "species": None, "release_year": None},
        None, [], "", data["meta"]["disclaimer"], data.get("business") or {})
    offline = offline.replace("<title>", '<meta name="robots" content="noindex">\n<title>', 1)
    with open(os.path.join(OUT_DIR, "_offline.html"), "w") as f:
        f.write(offline)
    print("wrote item/_offline.html  (offline stand-in for any item)")

    stubs = write_redirect_stubs(data, base_url)
    if stubs:
        print("wrote %d redirect stub(s) for merged item ids (noindex, not in the sitemap)"
              % stubs)

    robots = write_robots(base_url)
    print("wrote %s" % os.path.relpath(robots, ROOT))

    sm = write_sitemap(data, base_url)
    if sm:
        print("wrote %s  (%d urls)" % (os.path.relpath(sm[0], ROOT), sm[1]))
    else:
        print("\nNo sitemap written: a sitemap needs absolute URLs and no site")
        print("address is set. Pass --base-url https://your-domain, or set")
        print("site_url in tools/build_data.py once you know where this lives.")


if __name__ == "__main__":
    main()
