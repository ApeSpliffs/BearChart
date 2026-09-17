#!/usr/bin/env python3
"""
Bulk-attach photos to items.

    python3 tools/attach_images.py images.csv        # apply
    python3 tools/attach_images.py images.csv --dry  # preview only

The CSV needs a header row and these columns (credit and source optional):

    item_id,image_url,image_credit,image_source
    classic-brown-teddy,/images/classic-brown-teddy.jpg,Jay's Retro Exchange,

`item_id` is the slug shown in the URL of an item page. Run `--list` to dump the
slugs of every item that still has no photo.

Assignments are written into tools/image_overrides.json, which build_data.py reads
when it regenerates data.json - so re-running the build never loses them.

Use your own photographs, or images you hold the rights to. Official Build-A-Bear
product photography is copyrighted; this script refuses buildabear.com URLs.
"""

import csv
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERRIDES = os.path.join(ROOT, "tools", "image_overrides.json")
BLOCKED = re.compile(r"(^|\.)buildabear\.com", re.I)


def load_data():
    with open(os.path.join(ROOT, "data.json")) as f:
        return json.load(f)


def load_overrides():
    if not os.path.exists(OVERRIDES):
        return {}
    with open(OVERRIDES) as f:
        return json.load(f)


def save_overrides(d):
    with open(OVERRIDES, "w") as f:
        json.dump(d, f, indent=2, sort_keys=True)
        f.write("\n")


def list_missing():
    data = load_data()
    overrides = load_overrides()
    missing = [i for i in data["items"]
               if not (i.get("image_url") or overrides.get(i["id"], {}).get("image_url"))]
    print("item_id,canonical_name,image_url,image_credit,image_source")
    for i in missing:
        print("%s,%s,,," % (i["id"], i["canonical_name"].replace(",", " ")))
    print("\n# %d of %d items have no photo" % (len(missing), len(data["items"])),
          file=sys.stderr)


def apply(path, dry):
    data = load_data()
    known = {i["id"] for i in data["items"]}
    overrides = load_overrides()

    added, skipped, errors = 0, 0, []

    with open(path, newline="") as f:
        for n, row in enumerate(csv.DictReader(f), start=2):
            item_id = (row.get("item_id") or "").strip()
            url = (row.get("image_url") or "").strip()
            if not item_id or not url:
                skipped += 1
                continue
            if item_id not in known:
                errors.append("line %d: unknown item_id %r" % (n, item_id))
                continue
            if BLOCKED.search(url):
                errors.append("line %d: %s is official Build-A-Bear imagery - use a photo "
                              "you have the right to use" % (n, item_id))
                continue
            overrides[item_id] = {
                "image_url": url,
                "image_credit": (row.get("image_credit") or "").strip() or None,
                "image_source": (row.get("image_source") or "").strip() or None,
            }
            added += 1

    for e in errors:
        print("error: " + e, file=sys.stderr)

    if dry:
        print("dry run: %d photo(s) would be attached, %d row(s) skipped, %d error(s)"
              % (added, skipped, len(errors)))
        return 1 if errors else 0

    if errors:
        print("refusing to write - fix the errors above first", file=sys.stderr)
        return 1

    save_overrides(overrides)
    print("attached %d photo(s); %d row(s) skipped" % (added, skipped))
    print("wrote %s" % OVERRIDES)
    print("now run: npm run build")
    return 0


def main():
    args = [a for a in sys.argv[1:]]
    if "--list" in args:
        list_missing()
        return 0
    dry = "--dry" in args
    paths = [a for a in args if not a.startswith("-")]
    if not paths:
        print(__doc__)
        return 2
    return apply(paths[0], dry)


if __name__ == "__main__":
    sys.exit(main())
