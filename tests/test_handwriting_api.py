import io
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

import session_store
from routes import MAX_ANALYSIS_DIMENSION, MAX_GENERATION_BATCH, create_app


def image_bytes(size=(200, 100), image_format="PNG"):
    image = Image.new("RGB", size, "white")
    buffer = io.BytesIO()
    image.save(buffer, format=image_format)
    return buffer.getvalue()


class HandwritingApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_base_dir = session_store.BASE_DIR
        session_store.BASE_DIR = self.temp_dir.name
        self.client = TestClient(create_app("/directory/that/does/not/exist"))

    def tearDown(self):
        session_store.BASE_DIR = self.original_base_dir
        self.temp_dir.cleanup()

    @patch("routes.gemini_utils.analyze_handwriting")
    def test_analyze_resizes_large_image_and_returns_clean_session(self, analyze):
        analyze.return_value = {"style": "rounded", "glyphs": []}
        response = self.client.post(
            "/api/handwriting/analyze",
            files={"file": ("sample.png", image_bytes((3000, 1500)), "image/png")},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["width"], MAX_ANALYSIS_DIMENSION)
        self.assertEqual(payload["height"], MAX_ANALYSIS_DIMENSION // 2)
        self.assertTrue(session_store.session_exists(payload["session_id"]))

    def test_analyze_rejects_non_image_content(self):
        response = self.client.post(
            "/api/handwriting/analyze",
            files={"file": ("notes.txt", b"not an image", "text/plain")},
        )
        self.assertEqual(response.status_code, 415)

    def test_generate_rejects_oversized_batch_before_provider_call(self):
        session_id = session_store.new_session()
        Image.new("RGB", (20, 20), "white").save(
            session_store.glyph_path(session_id, "a"), format="PNG"
        )
        requested = list("bcdefghijklmn")[: MAX_GENERATION_BATCH + 1]

        with patch("routes.gemini_utils.generate_missing_glyph") as generate:
            response = self.client.post(
                "/api/handwriting/generate-missing",
                json={
                    "session_id": session_id,
                    "existing_chars": ["a"],
                    "charset": "lowercase",
                    "requested_chars": requested,
                },
            )

        self.assertEqual(response.status_code, 400)
        generate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
