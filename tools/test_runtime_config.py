#!/usr/bin/env python3
"""tools/build_runtime_config.py: what each deploy environment gets in config.js."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_runtime_config as rc  # noqa: E402

SUPA = {"BEARCHART_SUPABASE_URL": "https://staging.supabase.co",
        "BEARCHART_SUPABASE_ANON_KEY": "anon"}


class RuntimeConfig(unittest.TestCase):
    def test_environment_falls_back_to_netlify_context_then_development(self):
        self.assertEqual(rc.deploy_env({}), "development")
        self.assertEqual(rc.deploy_env({"CONTEXT": "deploy-preview"}), "preview")
        self.assertEqual(rc.deploy_env({"CONTEXT": "branch-deploy"}), "preview")
        self.assertEqual(rc.deploy_env({"CONTEXT": "production"}), "production")
        self.assertEqual(rc.deploy_env({"CONTEXT": "dev"}), "development")
        self.assertEqual(rc.deploy_env({"BEARCHART_ENV": "production", "CONTEXT": "deploy-preview"}), "production")
        self.assertEqual(rc.deploy_env({"BEARCHART_ENV": "nonsense"}), "development")

    def test_preview_without_supabase_settings_has_accounts_off(self):
        out = rc.build({"CONTEXT": "deploy-preview"})
        self.assertEqual(out["auth"], {"enabled": False})
        self.assertIs(out["posthog_enabled"], False)

    def test_a_netlify_preview_is_a_preview_whatever_bearchart_env_says(self):
        out = rc.build({"CONTEXT": "deploy-preview", "BEARCHART_ENV": "production"})
        self.assertEqual(out["auth"], {"enabled": False})
        self.assertIs(out["posthog_enabled"], False)
        out = rc.build(dict(SUPA, CONTEXT="deploy-preview", BEARCHART_ENV="production"))
        self.assertEqual(out["auth"]["supabase_url"], "https://staging.supabase.co")

    def test_production_without_settings_falls_back_to_data_json(self):
        out = rc.build({"CONTEXT": "production"})
        self.assertNotIn("auth", out)
        self.assertNotIn("posthog_enabled", out)

    def test_supabase_settings_are_used_when_both_are_set(self):
        out = rc.build(dict(SUPA, CONTEXT="deploy-preview"))
        self.assertEqual(out["auth"], {"enabled": True, "supabase_url": "https://staging.supabase.co",
                                       "supabase_anon_key": "anon"})

    def test_half_configured_supabase_fails_the_build(self):
        with self.assertRaises(rc.ConfigError):
            rc.build({"BEARCHART_SUPABASE_URL": "https://x.supabase.co"})
        with self.assertRaises(rc.ConfigError):
            rc.build({"BEARCHART_SUPABASE_URL": "http://x.supabase.co",
                      "BEARCHART_SUPABASE_ANON_KEY": "a", "BEARCHART_ENV": "production"})

    def test_optional_fields(self):
        out = rc.build({"CONTEXT": "deploy-preview", "BEARCHART_POSTHOG_ON_PREVIEW": "1",
                        "BEARCHART_SENTRY_DSN": "https://k@o1.ingest.us.sentry.io/1",
                        "BEARCHART_POSTHOG_KEY": "phc_x", "COMMIT_REF": "abc"})
        self.assertNotIn("posthog_enabled", out)
        self.assertEqual(out["sentry_dsn"], "https://k@o1.ingest.us.sentry.io/1")
        self.assertEqual(out["posthog_key"], "phc_x")
        self.assertEqual(out["release"], "abc")

    def test_values_cannot_break_out_of_the_script(self):
        js = rc.render(rc.build({"BEARCHART_SENTRY_DSN": "</script><script>alert(1)//\";x=1"}))
        self.assertNotIn("<", js.split("\n", 1)[1])
        prefix = "window.BEARCHART_RUNTIME = "
        line = js.splitlines()[1]
        self.assertTrue(line.startswith(prefix) and line.endswith(";"))
        self.assertEqual(json.loads(line[len(prefix):-1])["sentry_dsn"], "</script><script>alert(1)//\";x=1")


if __name__ == "__main__":
    unittest.main()
