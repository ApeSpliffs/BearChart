#!/usr/bin/env python3
"""
Re-grade imported sales whose condition the old mapping got wrong.

    python3 tools/reclassify_conditions.py                       # dry run: report only
    python3 tools/reclassify_conditions.py --apply               # Rule A only
    python3 tools/reclassify_conditions.py --apply --include-bare-new   # Rule A + Rule B

The old importer mapped "new without tags" / "NWOT" to Mint (priced like NWT)
and a bare "new" to NWT. tools/domain_vocab.py fixes that going forward; this
fixes the rows already imported. It only touches rows whose notes carry the
listing title ("title: ..."), and only the condition.

  Rule A (applied with --apply): the title says new without tags explicitly
    ("new without tags", "NWOT", "new ... no tags") and the stored condition is
    Mint, NWT or Unknown -> NWOT. A title that ALSO claims tags is left alone.

  Rule B (report only, unless --include-bare-new): stored NWT, the title says
    "new" but shows no tag evidence -> NWOT. The original condition column was
    never stored, so this is an inference from the title; the owner approves it
    (or re-imports from the source CSVs). The report shows what it would do to
    each item's fair market value.

Changed rows get condition_basis "reclassified_v2". Writes only with --apply.
Python 3.9 compatible.
"""

import argparse
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import domain_vocab as V  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMPORTED = os.path.join(ROOT, "tools", "imported_sales.json")

TITLE = re.compile(r"title:\s*(.*)", re.I)
EXPLICIT_NWOT = re.compile(V.CONDITION_PATTERNS[0][0], re.I)
BARE_NEW = re.compile(r"\bnew\b", re.I)
# "Lunar New Year" is not a condition.
NOT_A_CONDITION = re.compile(r"\bnew\s+year", re.I)
RULE_A_FROM = ("Mint", "NWT", "Unknown")


def title_of(sale):
    m = TITLE.search(sale.get("notes") or "")
    return m.group(1) if m else None


def rule_a(sale):
    t = title_of(sale)
    if not t or sale.get("condition") not in RULE_A_FROM:
        return False
    if NOT_A_CONDITION.search(t) or V.TAG_EVIDENCE.search(t):
        return False
    return bool(EXPLICIT_NWOT.search(t))


def rule_b(sale):
    t = title_of(sale)
    if not t or sale.get("condition") != "NWT" or rule_a(sale):
        return False
    if NOT_A_CONDITION.search(t) or V.TAG_EVIDENCE.search(t):
        return False
    return bool(BARE_NEW.search(t))


def fmv_change(changes):
    """Per-item fair market value before and after, from the real engine."""
    ids = sorted({r["item_id"] for r, _ in changes})
    if not ids:
        return {}
    script = r"""
      const fs = require('fs');
      const E = require(process.argv[1] + '/engine.js');
      const D = JSON.parse(fs.readFileSync(process.argv[1] + '/data.json', 'utf8'));
      const change = JSON.parse(fs.readFileSync(0, 'utf8'));
      const out = {};
      for (const id of change.ids) {
        const item = D.items.find((i) => i.id === id);
        if (!item) continue;
        const sales = D.sales.filter((s) => s.item_id === id);
        const after = sales.map((s) => change.to[s.id] ? Object.assign({}, s, {condition: change.to[s.id]}) : s);
        out[id] = [E.valuate(item, sales, D.config).fair_market, E.valuate(item, after, D.config).fair_market];
      }
      process.stdout.write(JSON.stringify(out));
    """
    payload = json.dumps({"ids": ids, "to": {r["id"]: "NWOT" for r, _ in changes}})
    res = subprocess.run(["node", "-e", script, ROOT], input=payload,
                         capture_output=True, text=True)
    if res.returncode != 0:
        raise SystemExit("could not run the valuation engine:\n" + res.stderr)
    return json.loads(res.stdout)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="write tools/imported_sales.json")
    ap.add_argument("--include-bare-new", action="store_true",
                    help="also apply Rule B (owner approval needed)")
    ap.add_argument("--file", default=IMPORTED, help=argparse.SUPPRESS)
    ap.add_argument("--no-fmv", action="store_true", help="skip the engine FMV report")
    args = ap.parse_args(argv)

    with open(args.file) as f:
        rows = json.load(f)

    a = [r for r in rows if rule_a(r)]
    b = [r for r in rows if rule_b(r)]
    print("Rule A (explicit new-without-tags):  %d row(s)" % len(a))
    for cond in RULE_A_FROM:
        n = sum(1 for r in a if r["condition"] == cond)
        if n:
            print("    from %-8s %d" % (cond, n))
    print("Rule B (bare 'new', no tag evidence): %d row(s)  %s"
          % (len(b), "APPLIED" if args.include_bare_new else "report only"))

    if not args.no_fmv:
        report = fmv_change([(r, "B") for r in b])
        moved = sorted(((k, v) for k, v in report.items() if v[0] and v[1]),
                       key=lambda kv: abs(kv[1][1] - kv[1][0]), reverse=True)
        print("\nRule B: fair market value change per item (%d items; largest first)"
              % len(moved))
        for iid, (before, after) in moved[:40]:
            print("    %-50s $%8.2f -> $%8.2f  (%+.1f%%)"
                  % (iid, before, after, (after - before) / before * 100))
        if len(moved) > 40:
            print("    ... and %d more" % (len(moved) - 40))

    change = a + (b if args.include_bare_new else [])
    if not args.apply:
        print("\ndry run - nothing written (--apply writes Rule A)")
        return 0
    for r in change:
        r["condition"] = "NWOT"
        r["condition_basis"] = "reclassified_v2"
    with open(args.file, "w") as f:
        json.dump(rows, f, indent=2)
        f.write("\n")
    print("\nwrote %s: %d row(s) re-graded to NWOT" % (args.file, len(change)))
    print("now run: npm run build && npm test")
    return 0


if __name__ == "__main__":
    sys.exit(main())
