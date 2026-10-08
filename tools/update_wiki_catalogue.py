#!/usr/bin/env python3
"""
Weekly: add newly released bears from The Build-A-Bear Wiki.

python3 tools/update_wiki_catalogue.py

Runs tools/fetch_wiki.py and tools/build_wiki_catalogue.py, then MERGES the
result into tools/catalogue_wiki.json instead of replacing it:

  * A bear that is new on the wiki is added.
  * A bear already in the catalogue is left exactly as it is.
  * Nothing is ever removed. A wiki page that is renamed or deleted must not
    make a bear disappear from the guide, along with its sold comps and every
    collection that lists it.

New arrivals are recorded with the date they were first seen in
recent_bears.js, which the admin page reads as its "Recently added" list.
Anything wrong can be listed by name in tools/catalogue_exclude.json and it
will never be added (or will be dropped from the guide on the next build).

Like the original import this is identification only: no price, value or
rarity is read from the wiki. New bears show "No sold data yet" until real
sales are recorded.

If the wiki cannot be reached, the existing catalogue is kept untouched and
the script exits 0, so a wiki outage never blocks the daily refresh.
"""

import datetime
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CATALOGUE = os.path.join(HERE, "catalogue_wiki.json")
EXCLUDE = os.path.join(HERE, "catalogue_exclude.json")
RECENT = os.path.join(ROOT, "recent_bears.js")
KEEP_DAYS = 90

sys.path.insert(0, HERE)


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def load_recent():
    try:
        with open(RECENT) as f:
            text = f.read()
        return json.loads(text[text.index("["):text.rindex("]") + 1])
    except (OSError, ValueError):
        return []


def write_recent(rows):
    with open(RECENT, "w") as f:
        f.write("/* Bears added to the catalogue from The Build-A-Bear Wiki, newest first.\n"
                "   Written by tools/update_wiki_catalogue.py; read by the admin page. */\n")
        f.write("window.BEARCHART_NEW = ")
        json.dump(rows, f, indent=1)
        f.write(";\n")


def main():
    today = datetime.date.today().isoformat()
    old = load_json(CATALOGUE, None)
    if not old or "items" not in old:
        print("no existing catalogue_wiki.json - run tools/build_wiki_catalogue.py first")
        return 0
    exclude = {str(n).strip().lower() for n in load_json(EXCLUDE, [])}
    backup = CATALOGUE + ".bak"
    shutil.copyfile(CATALOGUE, backup)

    try:
        import fetch_wiki
        import build_wiki_catalogue
        fetch_wiki.main()
        build_wiki_catalogue.main()
        fresh = load_json(CATALOGUE, None)
        if not fresh or not fresh.get("items"):
            raise RuntimeError("the wiki returned no catalogue entries")
    except Exception as e:  # network, wiki outage, wiki format change
        shutil.copyfile(backup, CATALOGUE)
        os.remove(backup)
        print("wiki update skipped, catalogue kept as it was: %s" % e)
        return 0

    have = {e["canonical_name"].strip().lower() for e in old["items"]}
    added = [e for e in fresh["items"]
             if e["canonical_name"].strip().lower() not in have
             and e["canonical_name"].strip().lower() not in exclude]

    merged = old["items"] + added
    merged = [e for e in merged if e["canonical_name"].strip().lower() not in exclude]
    merged.sort(key=lambda e: e["canonical_name"].lower())
    old["items"] = merged
    old["retrieved"] = today
    with open(CATALOGUE, "w") as f:
        json.dump(old, f, indent=1, sort_keys=False)
        f.write("\n")
    os.remove(backup)

    cutoff = (datetime.date.today() - datetime.timedelta(days=KEEP_DAYS)).isoformat()
    recent = [r for r in load_recent() if r.get("added_on", "") >= cutoff
              and r.get("name", "").strip().lower() not in exclude]
    for e in added:
        recent.insert(0, {"name": e["canonical_name"], "year": e.get("year"),
                          "species": e.get("species"), "added_on": today})
    write_recent(recent)

    print("%d new bear%s added from the wiki%s" % (
        len(added), "" if len(added) == 1 else "s",
        (": " + ", ".join(e["canonical_name"] for e in added[:20])) if added else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
