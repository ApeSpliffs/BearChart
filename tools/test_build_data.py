#!/usr/bin/env python3
"""
Build safety: a build that lost the imported sales must refuse to publish.

    python3 tools/test_build_data.py

tools/imported_sales.json holds almost every comp and stays tracked in git
(owner decision). These tests pin the guard that stops a build without it
from silently overwriting data.json with a fraction of the evidence.
"""

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))


class ShrinkGuard(unittest.TestCase):

    def test_trips_below_98_percent(self):
        import build_data as B
        B.guard_shrink(1000, 980)          # exactly 98%: allowed
        with self.assertRaises(SystemExit):
            B.guard_shrink(1000, 970)      # 97%
        B.guard_shrink(1000, 970, allow=True)

    def test_allow_shrink_flag_parses(self):
        import build_data as B
        self.assertTrue(B.parse_args(["--allow-shrink"]).allow_shrink)
        self.assertFalse(B.parse_args([]).allow_shrink)

    def test_imported_sales_are_tracked(self):
        out = subprocess.run(["git", "ls-files", "--error-unmatch", "tools/imported_sales.json"],
                             cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, "tools/imported_sales.json must stay in git")
        with open(os.path.join(ROOT, ".gitignore")) as f:
            self.assertNotIn("imported_sales.json", f.read())

    def test_a_build_without_imported_sales_refuses_to_write(self):
        # CI-style: a checkout whose imported_sales.json is gone. The build must
        # stop before touching data.json.
        tmp = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(tmp, "tools"))
            shutil.copy(os.path.join(ROOT, "data.json"), os.path.join(tmp, "data.json"))
            before = os.path.getmtime(os.path.join(tmp, "data.json"))
            res = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build_data.py"),
                                  "--root", tmp, "--as-of", "2026-10-09"],
                                 capture_output=True, text=True)
            self.assertNotEqual(res.returncode, 0, res.stdout + res.stderr)
            self.assertIn("refusing to write", res.stderr + res.stdout)
            self.assertEqual(os.path.getmtime(os.path.join(tmp, "data.json")), before)
            self.assertFalse(os.path.exists(os.path.join(tmp, "data.js")))
        finally:
            shutil.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
