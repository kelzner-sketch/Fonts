import io
import os
import tempfile
import unittest

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw

from font_builder import build_ttf, image_to_font_contours


class FontBuilderTests(unittest.TestCase):
    def test_raster_glyph_builds_a_readable_ttf(self):
        image = Image.new("RGB", (120, 160), "white")
        draw = ImageDraw.Draw(image)
        draw.ellipse((20, 30, 100, 130), outline="black", width=12)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")

        glyph = image_to_font_contours(buffer.getvalue(), "o")
        self.assertIsNotNone(glyph)

        with tempfile.TemporaryDirectory() as directory:
            font_path = os.path.join(directory, "test.ttf")
            build_ttf([glyph], "Test Handwriting", font_path)
            font = TTFont(font_path)

        self.assertIn(ord("o"), font.getBestCmap())
        self.assertIn(ord(" "), font.getBestCmap())
        self.assertGreater(font["hmtx"]["o"][0], 0)


if __name__ == "__main__":
    unittest.main()
