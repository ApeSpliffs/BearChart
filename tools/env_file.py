#!/usr/bin/env python3
"""
Load credentials from a local .env file.

Keeps secrets out of shell history, out of cron lines, and out of anything you
paste to anyone. The file is gitignored and never printed by these tools - they
report whether a key was FOUND, never its value.

Real environment variables always win, so CI can override without editing files.
"""

import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(ROOT, ".env")


def load(path=None):
    """Read .env into os.environ without clobbering what is already set."""
    path = path or ENV_PATH
    if not os.path.exists(path):
        return {}

    loaded = {}
    with open(path) as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            # Tolerate quoted values; people copy them out of dashboards quoted.
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            loaded[key] = value
            os.environ.setdefault(key, value)
    return loaded


def describe(keys):
    """Say which keys are present. Never the values."""
    out = []
    for k in keys:
        v = os.environ.get(k)
        out.append("  %-24s %s" % (k, "set" if v else "MISSING"))
    return "\n".join(out)
