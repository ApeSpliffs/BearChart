#!/usr/bin/env python3
"""
Scheduled polling for new eBay listings.

    python3 tools/poll_engine.py --plan          # what it would poll, and why
    python3 tools/poll_engine.py --once          # run one cycle
    python3 tools/poll_engine.py --watch add lucky-kitty
    python3 tools/poll_engine.py --watch list

WHY THIS IS NOT ONE POLL PER USER
=================================
A production Browse key allows roughly 5,000 calls a day. Polling one query every
60 seconds costs 1,440 of them, so the whole platform affords about THREE
continuously-polled queries - not three per user, three in total. A design that
polls each user's saved search dies at the fourth subscriber.

So this polls the CATALOGUE, not the users. Alerts are canonicalised into a small
shared pool of queries; results are matched back to items locally and fanned out.
One person watching the Pumpkin Glow Bear and a thousand people watching it cost
exactly the same quota.

HEAT
====
Quota goes where a deal can actually be detected:

  hot    60s     explicitly watched - you asked to be told
  warm   15m     has sold comps, so an underpriced listing is computable
  cold   daily   everything else; catalogued but unpriceable

PACING
======
Spend is metered by a token bucket rather than a daily counter. A counter lets the
scheduler burn the whole allowance by six in the evening, which is exactly when
listings from other timezones start landing. The bucket refills continuously, so
there is always something left for the small hours.
"""

import argparse
import json
import math
import os
import sys
import time
from collections import OrderedDict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import env_file  # noqa: E402

env_file.load()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, "tools", "poll_state.json")
WATCHLIST = os.path.join(ROOT, "tools", "watchlist.json")
LISTINGS = os.path.join(ROOT, "tools", "active_listings.json")

HEAT_INTERVALS = {"hot": 60, "warm": 1800, "cold": 86400}
HEAT_RANK = {"hot": 0, "warm": 1, "cold": 2}

DEFAULTS = {
    "daily_quota": 5000,
    # Burst capacity. Enough to cover a restart or a short outage without
    # letting the scheduler empty the day's allowance in one go.
    "burst": 60,
    "per_item_results": 20,
}


# ---------------------------------------------------------------------------
# Quota
# ---------------------------------------------------------------------------

class TokenBucket:
    """Continuous-refill budget.

    A daily counter permits spending the entire allowance before dinner. This
    refills at quota/86400 per second, so the scheduler is paced by construction
    and the overnight window is never starved.
    """

    def __init__(self, daily_quota, burst, tokens=None, last=None):
        self.rate = float(daily_quota) / 86400.0
        self.burst = float(burst)
        self.tokens = float(burst if tokens is None else tokens)
        self.last = float(time.time() if last is None else last)

    def _refill(self, now):
        elapsed = max(0.0, now - self.last)
        self.tokens = min(self.burst, self.tokens + elapsed * self.rate)
        self.last = now

    def available(self, now=None):
        self._refill(time.time() if now is None else now)
        return self.tokens

    def take(self, n=1, now=None):
        self._refill(time.time() if now is None else now)
        if self.tokens >= n:
            self.tokens -= n
            return True
        return False

    def to_dict(self):
        return {"tokens": self.tokens, "last": self.last}


# ---------------------------------------------------------------------------
# Query pool
# ---------------------------------------------------------------------------

def assign_heat(item, watched, has_comps):
    """Where the quota is worth spending.

    Cold is not neglect: an item with no sold comps cannot be judged underpriced,
    because nothing is known about what it is worth. Polling it hourly would burn
    budget to produce listings nothing can be said about.
    """
    if item["id"] in watched:
        return "hot"
    if has_comps:
        return "warm"
    return "cold"


def build_query_pool(items, watched, sales_by_item, config=None):
    """Collapse the catalogue into the smallest set of queries that covers it.

    Watched items get their own specific query, because precision matters when
    somebody is waiting on an answer. Everything else is grouped - by franchise
    where there is one, by category otherwise - and matched back to individual
    items locally. That turns 642 items into a few dozen queries.
    """
    cfg = dict(DEFAULTS, **(config or {}))
    pool = OrderedDict()

    def add(key, text, heat, item_ids, kind):
        if key in pool:
            entry = pool[key]
            entry["item_ids"] = sorted(set(entry["item_ids"]) | set(item_ids))
            if HEAT_RANK[heat] < HEAT_RANK[entry["heat"]]:
                entry["heat"] = heat
                entry["interval"] = HEAT_INTERVALS[heat]
            return
        pool[key] = {
            "key": key,
            "query": text,
            "heat": heat,
            "interval": HEAT_INTERVALS[heat],
            "kind": kind,
            "item_ids": sorted(set(item_ids)),
            "cost": 1,
        }

    grouped = {}
    for item in items:
        has_comps = bool(sales_by_item.get(item["id"]))
        heat = assign_heat(item, watched, has_comps)

        if heat == "hot":
            name = item["canonical_name"].split(" (")[0]
            add("item:" + item["id"], "build-a-bear " + name, "hot",
                [item["id"]], "item")
            continue

        bucket = item.get("franchise") or item.get("category") or "Other"
        grouped.setdefault((bucket, heat), []).append(item["id"])

    for (bucket, heat), ids in grouped.items():
        add("group:" + bucket.lower().replace(" ", "-") + ":" + heat,
            "build-a-bear " + bucket, heat, ids, "group")

    return list(pool.values())


def due(pool, now, state):
    """Queries whose interval has elapsed, most overdue first within heat."""
    out = []
    for q in pool:
        last = state.get("last_polled", {}).get(q["key"], 0)
        overdue = now - last - q["interval"]
        if overdue >= 0:
            out.append((q, overdue))
    out.sort(key=lambda pair: (HEAT_RANK[pair[0]["heat"]], -pair[1]))
    return [q for q, _ in out]


def plan_cycle(pool, bucket, now, state):
    """What this cycle can afford, in priority order.

    Returns (to_poll, skipped). Skipping is reported rather than hidden: a
    scheduler that silently drops the cold tier every cycle looks identical to
    one that is working.
    """
    to_poll, skipped = [], []
    available = bucket.available(now)
    spent = 0
    for q in due(pool, now, state):
        if spent + q["cost"] <= available:
            to_poll.append(q)
            spent += q["cost"]
        else:
            skipped.append(q)
    return to_poll, skipped


# ---------------------------------------------------------------------------
# Listing memory
# ---------------------------------------------------------------------------

def record_listings(seen, listings, now):
    """Track what we have already seen, so a relist is not a fresh discovery.

    Sellers end and relist constantly. Without this, the same bear is announced
    as a new find every few days, which is how an alert channel gets muted.
    """
    fresh, changed = [], []
    for l in listings:
        lid = str(l.get("listing_id") or l.get("id") or "")
        if not lid:
            continue
        price = l.get("ask_price")
        prev = seen.get(lid)
        if prev is None:
            seen[lid] = {"first_seen": now, "price": price, "changes": 0,
                         "item_id": l.get("item_id")}
            fresh.append(l)
        elif price is not None and prev.get("price") != price:
            prev["changes"] = prev.get("changes", 0) + 1
            prev["price"] = price
            prev["last_change"] = now
            changed.append(l)
    return fresh, changed


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

def load_json(path, fallback):
    if not os.path.exists(path):
        return fallback
    try:
        with open(path) as f:
            return json.load(f)
    except ValueError:
        return fallback


def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def load_watchlist(data=None):
    """Watched item ids, each resolved through data.json's redirects so an id
    merged into another item keeps being watched under its survivor."""
    watched = load_json(WATCHLIST, [])
    redirects = (data or {}).get("redirects") or {}
    out = []
    for wid in watched:
        wid = resolve_id(wid, redirects)
        if wid not in out:
            out.append(wid)
    return out


def resolve_id(item_id, redirects):
    seen = 0
    while item_id in redirects and seen < 10:
        item_id = redirects[item_id]
        seen += 1
    return item_id


def load_state(data=None):
    """Polling state, with item ids from before a merge mapped to the survivor:
    a watched item's schedule ("item:<id>") and the listings already seen keep
    their history instead of starting over."""
    state = load_json(STATE, {"last_polled": {}, "bucket": None, "seen": {}})
    redirects = (data or {}).get("redirects") or {}
    if redirects:
        polled = {}
        for key, at in (state.get("last_polled") or {}).items():
            if key.startswith("item:"):
                key = "item:" + resolve_id(key[5:], redirects)
            polled[key] = max(at, polled.get(key, 0))
        state["last_polled"] = polled
        for entry in (state.get("seen") or {}).values():
            if isinstance(entry, dict) and entry.get("item_id"):
                entry["item_id"] = resolve_id(entry["item_id"], redirects)
    return state


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def load_catalogue():
    with open(os.path.join(ROOT, "data.json")) as f:
        data = json.load(f)
    sales_by_item = {}
    for s in data["sales"]:
        sales_by_item.setdefault(s["item_id"], []).append(s)
    return data, sales_by_item


def cmd_watch(args):
    data, _ = load_catalogue()
    watched = load_watchlist(data)
    known = {i["id"]: i for i in data["items"]}

    action = args.watch[0]
    if action == "list":
        if not watched:
            print("Nothing on the watchlist. Everything is polled on the shared "
                  "group schedule.")
            return 0
        print("%d item(s) polled every %ds:" % (len(watched), HEAT_INTERVALS["hot"]))
        for wid in watched:
            print("  %-40s %s" % (wid, known.get(wid, {}).get("canonical_name", "?")))
        return 0

    if len(args.watch) < 2:
        raise SystemExit("usage: --watch add|remove <item-id>")
    item_id = args.watch[1]

    if action == "add":
        if item_id not in known:
            raise SystemExit("no such item: %s" % item_id)
        if item_id in watched:
            print("already watched")
            return 0
        watched.append(item_id)
        save_json(WATCHLIST, watched)
        # Naming the cost keeps the tradeoff visible: each hot query is a real
        # slice of a small daily budget.
        cost = 86400 // HEAT_INTERVALS["hot"]
        print("watching %s (%s)" % (item_id, known[item_id]["canonical_name"]))
        print("  costs ~%d calls/day of a %d budget; %d item(s) watched"
              % (cost, DEFAULTS["daily_quota"], len(watched)))
        return 0

    if action == "remove":
        if item_id not in watched:
            print("not watched")
            return 0
        watched.remove(item_id)
        save_json(WATCHLIST, watched)
        print("stopped watching %s" % item_id)
        return 0

    raise SystemExit("unknown action: %s" % action)


def cmd_plan(args):
    data, sales_by_item = load_catalogue()
    watched = set(load_watchlist(data))
    state = load_state(data)
    now = time.time()

    pool = build_query_pool(data["items"], watched, sales_by_item)
    b = state.get("bucket") or {}
    bucket = TokenBucket(args.quota, DEFAULTS["burst"],
                         b.get("tokens"), b.get("last"))
    to_poll, skipped = plan_cycle(pool, bucket, now, state)

    by_heat = {}
    for q in pool:
        by_heat.setdefault(q["heat"], []).append(q)

    covered = set()
    for q in pool:
        covered.update(q["item_ids"])

    print("catalogue: %d items -> %d queries" % (len(data["items"]), len(pool)))
    for heat in ("hot", "warm", "cold"):
        qs = by_heat.get(heat, [])
        if not qs:
            continue
        per_day = sum(86400 // q["interval"] for q in qs)
        print("  %-5s %3d quer%s  every %-6s  ~%5d calls/day"
              % (heat, len(qs), "y" if len(qs) == 1 else "ies",
                 _human(qs[0]["interval"]), per_day))

    total = sum(86400 // q["interval"] for q in pool)
    print("\ndaily cost: ~%d calls against a %d budget (%d%%)"
          % (total, args.quota, round(100.0 * total / args.quota)))
    if total > args.quota:
        print("  OVER BUDGET. Watch fewer items, or widen the warm interval.")
    print("items covered by at least one query: %d/%d"
          % (len(covered), len(data["items"])))
    print("\nthis cycle: %d due, %d affordable now (%.0f tokens available)"
          % (len(to_poll) + len(skipped), len(to_poll), bucket.available(now)))
    for q in to_poll[:12]:
        print("  %-5s %-46s %d item(s)"
              % (q["heat"], q["query"][:46], len(q["item_ids"])))
    if skipped:
        print("  ... %d deferred to the next cycle (budget)" % len(skipped))
    return 0


def _human(secs):
    if secs < 60:
        return "%ds" % secs
    if secs < 3600:
        return "%dm" % (secs // 60)
    if secs < 86400:
        return "%dh" % (secs // 3600)
    return "%dd" % (secs // 86400)


def cmd_once(args):
    import ebay_active as eb

    cid = os.environ.get("EBAY_CLIENT_ID")
    secret = os.environ.get("EBAY_CLIENT_SECRET")
    if not cid or not secret:
        raise SystemExit(
            "eBay credentials missing.\n\n"
            + env_file.describe(["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"]) +
            "\n\nPut them in .env (see .env.example).\n"
            "--plan works without credentials if you just want the schedule.")

    data, sales_by_item = load_catalogue()
    watched = set(load_watchlist(data))
    state = load_state(data)
    now = time.time()

    pool = build_query_pool(data["items"], watched, sales_by_item)
    b = state.get("bucket") or {}
    bucket = TokenBucket(args.quota, DEFAULTS["burst"], b.get("tokens"), b.get("last"))
    to_poll, skipped = plan_cycle(pool, bucket, now, state)

    if not to_poll:
        print("nothing due, or no budget this cycle "
              "(%.0f tokens)" % bucket.available(now))
        return 0

    token = eb.get_token(cid, secret)
    matcher = eb.Matcher(data["items"])
    existing = load_json(LISTINGS, {"listings": []})
    by_id = {l["id"]: l for l in existing.get("listings", [])}
    seen = state.get("seen", {})

    polled = 0
    for q in to_poll:
        if not bucket.take(q["cost"], now):
            break
        try:
            payload = eb.search(token, q["query"], DEFAULTS["per_item_results"])
        except eb.EbayError as e:
            print("  %-46s FAILED %s" % (q["query"][:46], e))
            continue

        allowed = set(q["item_ids"])
        found = []
        for summary in payload.get("itemSummaries") or []:
            item, how, _ = matcher.resolve(None, summary.get("title"), False)
            # A group query casts wide; only keep what it was meant to cover.
            if not item or item["id"] not in allowed:
                continue
            rec = eb.normalise_listing(summary, item)
            if rec:
                found.append(rec)

        for rec in found:
            by_id[rec["id"]] = rec
        state.setdefault("last_polled", {})[q["key"]] = now
        polled += 1
        print("  %-5s %-46s %2d kept" % (q["heat"], q["query"][:46], len(found)))

    fresh, changed = record_listings(seen, list(by_id.values()), now)
    state["seen"] = seen
    state["bucket"] = bucket.to_dict()
    save_json(STATE, state)

    save_json(LISTINGS, OrderedDict([
        ("fetched_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())),
        ("source", "eBay Browse API (active listings only)"),
        ("warning", "Asking prices. Never sold data. These do not affect any valuation."),
        ("listings", list(by_id.values())),
    ]))

    print("\npolled %d quer%s, %d deferred" % (polled, "y" if polled == 1 else "ies",
                                               len(skipped)))
    print("%d listing(s) held, %d new, %d price change(s)"
          % (len(by_id), len(fresh), len(changed)))
    print("%.0f tokens left" % bucket.available(now))
    print("now run: npm run build")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plan", action="store_true", help="show the schedule and cost")
    ap.add_argument("--once", action="store_true", help="run a single polling cycle")
    ap.add_argument("--watch", nargs="+", metavar="ARG",
                    help="add|remove <item-id>, or list")
    ap.add_argument("--quota", type=int, default=DEFAULTS["daily_quota"],
                    help="your key's daily call allowance")
    args = ap.parse_args()

    if args.watch:
        return cmd_watch(args)
    if args.once:
        return cmd_once(args)
    return cmd_plan(args)


if __name__ == "__main__":
    sys.exit(main())
