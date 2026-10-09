#!/usr/bin/env python3
"""
Generate one real HTML page per catalogued item, plus a sitemap.

    python3 tools/build_pages.py                     # write item/*.html
    python3 tools/build_pages.py --base-url https://bearchart.example
    npm run pages

WHY THIS EXISTS
    Every item used to live at item.html?id=<slug> and be drawn by JavaScript
    after the page loaded. To a search engine that is ONE page - the catalogue
    of 2,042 bears was, as far as Google was concerned, a single empty
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
    something is for sale at that price; BearChart sells nothing and these are
    estimates from past sales. Rich snippets are not worth a false statement.
"""

import argparse
import html
import json
import os
import re
import shutil
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "item")

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
    'family=Fraunces:opsz,wght,SOFT,WONK@9..144,400..900,0..100,0..1'
    '&family=Nunito+Sans:wght@400..800&display=swap">'
)

# config.js and observability.js come first so an error in any later script
# can be reported (observability.js is inert without a DSN).
# sanitize.js (URL/CSV/escape helpers) must precede auth.js and common.js.
SCRIPTS = ["config.js", "observability.js", "sanitize.js", "data.js", "engine.js", "icons.js",
           "auth.js", "entitlements.js", "submissions.js", "common.js", "item.js"]

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
            "BearChart publishes no value for it - identification, release year "
            "and line details only." % name)


def title_for(item, val):
    year = " (%s)" % item["release_year"] if item.get("release_year") else ""
    if val and val.get("has_value"):
        return "%s%s value - %s | BearChart" % (
            item["canonical_name"], year, money(val["fair_market"]))
    return "%s%s - Build-A-Bear value guide | BearChart" % (item["canonical_name"], year)


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
        ("Line", item.get("variant")),
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
            '<h2>No sold data yet</h2>'
            '<p>BearChart has no recorded sold transactions for the '
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


def shop_promo(business, val):
    """The operator's own shop, in the static markup.

    Same rule as the live page: only where the item has no sold data, so a
    reader never gets a shop pitch and a "sell yours to us" offer on one page.
    Labelled as the shop behind the guide, because an unlabelled advert from
    the person publishing the valuations is how a price guide loses its reader.
    """
    if not (business.get("enabled") and business.get("shop_url")):
        return ""
    if val and val.get("has_value"):
        return ""
    return (
        '<aside class="promo">'
        '<p class="promo-eyebrow">%s</p>'
        '<h3 class="promo-title">%s</h3>'
        '<p class="promo-blurb">%s</p>'
        '<p class="promo-act"><a class="btn btn-primary" href="%s" '
        'target="_blank" rel="noopener">%s</a></p>'
        '<p class="promo-note">%s</p>'
        '</aside>'
        % (e(business.get("shop_eyebrow") or business.get("name")),
           e(business.get("shop_headline") or business.get("name")),
           e(business.get("shop_blurb") or ""),
           e(business["shop_url"]),
           e(business.get("shop_cta") or "Visit the shop"),
           e(business.get("shop_disclosure") or "")))


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
<link rel="apple-touch-icon" href="../icons/apple-touch-icon.png">
<link rel="icon" href="../favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="../icons/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="BearChart">
<meta property="og:type" content="article">
<meta property="og:title" content="%(title)s">
<meta property="og:description" content="%(desc)s">
<meta property="og:site_name" content="BearChart">
%(social)s
%(fonts)s
<link rel="stylesheet" href="../styles.css">
<script type="application/ld+json">
%(jsonld)s
</script>
</head>
<body>

<header class="masthead" id="masthead"></header>
<div class="disclaimer-bar" id="disclaimer-bar"></div>

<main>
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
        "social": ('<meta property="og:image" content="%s/icons/og-image.png">\n'
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
        "promo": shop_promo(business or {}, val),
        "scripts": "\n".join('<script src="../%s"></script>' % s for s in SCRIPTS),
    }


def valuations(data):
    """Ask the real engine, through node, so the pages cannot drift from it."""
    import subprocess
    script = """
      global.window = global;
      require('%s/data.js'); require('%s/engine.js');
      const D = global.BEARCHART_DATA, E = global.BearChartEngine;
      const byItem = {};
      for (const s of D.sales) (byItem[s.item_id] = byItem[s.item_id] || []).push(s);
      const out = {};
      for (const i of D.items) out[i.id] = E.valuate(i, byItem[i.id] || [], D.config);
      process.stdout.write(JSON.stringify(out));
    """ % (ROOT, ROOT)
    res = subprocess.run(["node", "-e", script], capture_output=True, text=True)
    if res.returncode != 0:
        raise SystemExit("could not run the valuation engine:\n" + res.stderr)
    return json.loads(res.stdout)


def write_sitemap(data, base_url):
    if not base_url:
        return None
    base = base_url.rstrip("/")
    today = date.today().isoformat()
    urls = ["%s/%s" % (base, p) for p in TOP_LEVEL]
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
    # path and renders it from the cached catalogue. One file, and all 2,042
    # items work offline - precaching them all would be 8MB.
    offline = page_html(
        {"id": "_offline", "canonical_name": "Loading…", "aliases": [],
         "category": None, "species": None, "release_year": None},
        None, [], "", data["meta"]["disclaimer"], data.get("business") or {})
    offline = offline.replace("<title>", '<meta name="robots" content="noindex">\n<title>', 1)
    with open(os.path.join(OUT_DIR, "_offline.html"), "w") as f:
        f.write(offline)
    print("wrote item/_offline.html  (offline stand-in for any item)")

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
