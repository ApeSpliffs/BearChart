#!/usr/bin/env python3
"""
Pull the Build-A-Bear Wiki's article index and category tags into tools/research/.

    python3 tools/fetch_wiki.py

Then: python3 tools/build_wiki_catalogue.py && npm run build

HOW THIS READS THE WIKI
    Through the MediaWiki API, in bulk: five requests for all ~2,000 article
    titles, and one request per fifty articles for their category tags. That is
    about forty-five requests for the entire site, against a crawl that would be
    two thousand page fetches. It identifies itself, and it pauses between calls.

    The wiki is CC BY-SA 4.0 and BearChart credits it in SOURCES. What comes
    back is names and category tags - facts about what exists - and nothing
    that could be mistaken for a price.
"""

import json
import os
import time
import urllib.parse
import urllib.request

API = "https://buildabearwiki.info/w/api.php"
UA = "BearChart-catalogue-research/1.0 (Build-A-Bear collector price guide)"
DELAY = 0.4

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESEARCH = os.path.join(ROOT, "tools", "research")


def api(**params):
    params.setdefault("format", "json")
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params),
                                 headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def all_pages():
    """Every article title in the main namespace, redirects excluded."""
    titles, cont = [], None
    while True:
        kw = dict(action="query", list="allpages", aplimit="500",
                  apnamespace="0", apfilterredir="nonredirects")
        if cont:
            kw["apcontinue"] = cont
        d = api(**kw)
        titles += [p["title"] for p in d["query"]["allpages"]]
        cont = (d.get("continue") or {}).get("apcontinue")
        if not cont:
            return titles
        time.sleep(DELAY)


def all_categories():
    d = api(action="query", list="allcategories", aclimit="500", acprop="size")
    return [(c["*"], c.get("pages", 0)) for c in d["query"]["allcategories"]]


def page_categories(titles):
    """Category tags per article - the only classification signal we use."""
    out = {}
    for i in range(0, len(titles), 50):
        batch, cont = titles[i:i + 50], {}
        while True:
            kw = dict(action="query", prop="categories", cllimit="500",
                      titles="|".join(batch))
            kw.update(cont)
            d = api(**kw)
            for p in d["query"]["pages"].values():
                out.setdefault(p["title"], []).extend(
                    c["title"].replace("Category:", "") for c in (p.get("categories") or []))
            cont = d.get("continue") or {}
            if not cont:
                break
        time.sleep(DELAY)
    return out


def write(name, payload):
    path = os.path.join(RESEARCH, name)
    with open(path, "w") as f:
        json.dump(payload, f, indent=1, sort_keys=True)
        f.write("\n")
    print("  wrote %s" % path)


def main():
    os.makedirs(RESEARCH, exist_ok=True)
    print("fetching article index…")
    titles = all_pages()
    write("wiki_pages.json", titles)
    print("fetching category list…")
    write("wiki_cats.json", all_categories())
    print("fetching category tags for %d articles…" % len(titles))
    write("wiki_page_cats.json", page_categories(titles))
    print("\n%d articles indexed. Next: python3 tools/build_wiki_catalogue.py" % len(titles))


if __name__ == "__main__":
    main()
