#!/usr/bin/env python3
"""
Tests for the polling scheduler.

    python3 tools/test_poll.py

No network. The scheduler is pure functions over a clock passed in, so the quota
arithmetic - the part that decides whether this works at all - is testable
without an API key.
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import poll_engine as pe  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def item(iid, **kw):
    d = {"id": iid, "canonical_name": kw.get("name", iid.replace("-", " ").title()),
         "franchise": kw.get("franchise"), "category": kw.get("category", "Stuffed Animal")}
    return d


class TokenBucketTests(unittest.TestCase):
    """The budget is metered continuously, not counted daily."""

    def test_starts_full_at_burst(self):
        b = pe.TokenBucket(5000, 60, last=1000.0)
        self.assertEqual(b.available(1000.0), 60)

    def test_refills_at_the_daily_rate(self):
        b = pe.TokenBucket(8640, 100, tokens=0, last=1000.0)
        # 8640/day = 0.1/sec. After 100 seconds, 10 tokens.
        self.assertAlmostEqual(b.available(1100.0), 10.0, places=6)

    def test_never_exceeds_burst(self):
        b = pe.TokenBucket(5000, 60, tokens=0, last=0.0)
        self.assertEqual(b.available(999999.0), 60)

    def test_taking_spends_and_refuses_when_empty(self):
        b = pe.TokenBucket(5000, 10, tokens=3, last=1000.0)
        self.assertTrue(b.take(3, 1000.0))
        self.assertFalse(b.take(1, 1000.0))

    def test_a_daily_counter_would_have_allowed_a_morning_burnout(self):
        # The property that matters: after spending everything, capacity comes
        # back over time rather than at midnight, so the overnight window - when
        # listings from other timezones land - is never starved.
        b = pe.TokenBucket(8640, 10, tokens=10, last=0.0)
        self.assertTrue(b.take(10, 0.0))
        self.assertFalse(b.take(1, 0.0))
        self.assertTrue(b.take(1, 20.0), "capacity should return within seconds")


class HeatTests(unittest.TestCase):
    def test_watched_items_are_hot(self):
        self.assertEqual(pe.assign_heat(item("a"), {"a"}, False), "hot")

    def test_items_with_comps_are_warm(self):
        self.assertEqual(pe.assign_heat(item("a"), set(), True), "warm")

    def test_everything_else_is_cold(self):
        # Not neglect: an item with no comps cannot be judged underpriced,
        # so polling it hourly buys nothing.
        self.assertEqual(pe.assign_heat(item("a"), set(), False), "cold")

    def test_watching_beats_having_comps(self):
        self.assertEqual(pe.assign_heat(item("a"), {"a"}, True), "hot")


class QueryPoolTests(unittest.TestCase):
    def setUp(self):
        self.items = [
            item("a", franchise="Pokemon"), item("b", franchise="Pokemon"),
            item("c", franchise="Sanrio"), item("d", franchise=None),
        ]

    def test_unwatched_items_share_a_query_by_franchise(self):
        pool = pe.build_query_pool(self.items, set(), {"a": [1], "b": [1]})
        pokemon = [q for q in pool if "Pokemon" in q["query"]]
        self.assertEqual(len(pokemon), 1, "two Pokemon items, one query")
        self.assertEqual(sorted(pokemon[0]["item_ids"]), ["a", "b"])

    def test_a_watched_item_gets_its_own_query(self):
        pool = pe.build_query_pool(self.items, {"a"}, {})
        own = [q for q in pool if q["item_ids"] == ["a"]]
        self.assertEqual(len(own), 1)
        self.assertEqual(own[0]["heat"], "hot")
        self.assertEqual(own[0]["kind"], "item")

    def test_every_item_is_covered_by_some_query(self):
        pool = pe.build_query_pool(self.items, {"a"}, {"b": [1]})
        covered = set()
        for q in pool:
            covered.update(q["item_ids"])
        self.assertEqual(covered, {"a", "b", "c", "d"})

    def test_the_real_catalogue_collapses_to_far_fewer_queries(self):
        # The architectural claim: polling the catalogue rather than the users.
        with open(os.path.join(ROOT, "data.json")) as f:
            data = json.load(f)
        sales = {}
        for s in data["sales"]:
            sales.setdefault(s["item_id"], []).append(s)

        pool = pe.build_query_pool(data["items"], set(), sales)
        self.assertLess(len(pool), len(data["items"]) / 5,
                        "642 items must not become 642 queries")

        daily = sum(86400 // q["interval"] for q in pool)
        self.assertLess(daily, pe.DEFAULTS["daily_quota"],
                        "the unwatched baseline must fit inside the quota")

    def test_watching_costs_real_budget(self):
        with open(os.path.join(ROOT, "data.json")) as f:
            data = json.load(f)
        sales = {}
        for s in data["sales"]:
            sales.setdefault(s["item_id"], []).append(s)

        base = pe.build_query_pool(data["items"], set(), sales)
        watched = pe.build_query_pool(data["items"], {data["items"][0]["id"]}, sales)
        cost = lambda p: sum(86400 // q["interval"] for q in p)  # noqa: E731
        # One 60-second query is 1,440 calls - which is why three is the ceiling.
        self.assertGreater(cost(watched) - cost(base), 1000)


class SchedulingTests(unittest.TestCase):
    def setUp(self):
        self.pool = [
            {"key": "hot1", "heat": "hot", "interval": 60, "cost": 1, "item_ids": ["a"]},
            {"key": "warm1", "heat": "warm", "interval": 900, "cost": 1, "item_ids": ["b"]},
            {"key": "cold1", "heat": "cold", "interval": 86400, "cost": 1, "item_ids": ["c"]},
        ]

    def test_nothing_is_due_before_its_interval(self):
        state = {"last_polled": {"hot1": 1000.0, "warm1": 1000.0, "cold1": 1000.0}}
        self.assertEqual(pe.due(self.pool, 1030.0, state), [])

    def test_hot_comes_first_when_several_are_due(self):
        state = {"last_polled": {}}
        order = [q["key"] for q in pe.due(self.pool, 999999.0, state)]
        self.assertEqual(order[0], "hot1")

    def test_the_budget_defers_rather_than_drops(self):
        bucket = pe.TokenBucket(5000, 2, tokens=2, last=1000.0)
        to_poll, skipped = pe.plan_cycle(self.pool, bucket, 999999.0, {"last_polled": {}})
        self.assertEqual(len(to_poll), 2)
        self.assertEqual(len(skipped), 1)
        # Reported, not hidden: a scheduler that silently drops the cold tier
        # every cycle looks identical to one that is working.
        self.assertEqual(skipped[0]["heat"], "cold")

    def test_an_empty_budget_polls_nothing(self):
        # The bucket's clock has to be the same instant as the poll, or it
        # refills on the way in and is no longer empty.
        NOW = 999999.0
        bucket = pe.TokenBucket(5000, 5, tokens=0, last=NOW)
        to_poll, skipped = pe.plan_cycle(self.pool, bucket, NOW, {"last_polled": {}})
        self.assertEqual(to_poll, [], "no budget means nothing is polled")
        self.assertEqual(len(skipped), 3, "and all of it is reported as deferred")

    def test_a_long_interval_is_not_due_early(self):
        # The cold tier waits a day, so an hour in it is simply not due.
        bucket = pe.TokenBucket(5000, 50, tokens=50, last=0.0)
        to_poll, _ = pe.plan_cycle(self.pool, bucket, 3600.0, {"last_polled": {}})
        keys = sorted(q["key"] for q in to_poll)
        self.assertEqual(keys, ["hot1", "warm1"])


class SeenListingTests(unittest.TestCase):
    """A relist is not a discovery."""

    def listing(self, lid, price):
        return {"id": "active-" + lid, "listing_id": lid, "ask_price": price,
                "item_id": "lucky-kitty"}

    def test_a_first_sighting_is_new(self):
        seen = {}
        fresh, changed = pe.record_listings(seen, [self.listing("1", 100)], 1000.0)
        self.assertEqual(len(fresh), 1)
        self.assertEqual(len(changed), 0)

    def test_seeing_it_again_is_not_new(self):
        seen = {}
        pe.record_listings(seen, [self.listing("1", 100)], 1000.0)
        fresh, changed = pe.record_listings(seen, [self.listing("1", 100)], 2000.0)
        self.assertEqual(len(fresh), 0, "the same listing must not re-announce")
        self.assertEqual(len(changed), 0)

    def test_a_price_change_is_reported_without_being_new(self):
        seen = {}
        pe.record_listings(seen, [self.listing("1", 100)], 1000.0)
        fresh, changed = pe.record_listings(seen, [self.listing("1", 80)], 2000.0)
        self.assertEqual(len(fresh), 0)
        self.assertEqual(len(changed), 1)
        self.assertEqual(seen["1"]["changes"], 1)
        self.assertEqual(seen["1"]["price"], 80)

    def test_a_listing_with_no_id_is_skipped_rather_than_guessed(self):
        seen = {}
        fresh, _ = pe.record_listings(seen, [{"ask_price": 10}], 1000.0)
        self.assertEqual(fresh, [])
        self.assertEqual(seen, {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
