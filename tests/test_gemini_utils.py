import os
import unittest
from unittest.mock import patch

import gemini_utils


class GeminiConfigurationTests(unittest.TestCase):
    def test_standard_key_needs_no_custom_base_url(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}, clear=True):
            self.assertEqual(gemini_utils._client_options(), {"api_key": "test-key"})

    def test_legacy_workshop_configuration_remains_supported(self):
        environment = {
            "GEMINI_WORKSHOP_API_KEY": "legacy-test-key",
            "GEMINI_WORKSHOP_BASE_URL": "https://example.test/gemini",
        }
        with patch.dict(os.environ, environment, clear=True):
            self.assertEqual(
                gemini_utils._client_options(),
                {
                    "api_key": "legacy-test-key",
                    "http_options": {
                        "api_version": "v1alpha",
                        "base_url": environment["GEMINI_WORKSHOP_BASE_URL"],
                    },
                },
            )

    def test_missing_key_has_actionable_error(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "GEMINI_API_KEY"):
                gemini_utils._client_options()


if __name__ == "__main__":
    unittest.main()
