import io
import unittest

from PIL import Image, ImageDraw

from glyph_sheet import split_glyph_sheet


class GlyphSheetTests(unittest.TestCase):
    def test_splits_ordered_grid_and_rejects_blank_cell(self):
        sheet = Image.new("RGB", (400, 200), "white")
        draw = ImageDraw.Draw(sheet)
        draw.rectangle((35, 25, 65, 75), fill="black")
        draw.rectangle((135, 25, 165, 75), fill="black")
        draw.rectangle((235, 25, 265, 75), fill="black")
        # Fourth cell intentionally blank.
        buffer = io.BytesIO()
        sheet.save(buffer, format="PNG")

        glyphs, rejected = split_glyph_sheet(
            buffer.getvalue(), ["a", "b", "c", "d"], columns=4
        )

        self.assertEqual(set(glyphs), {"a", "b", "c"})
        self.assertEqual(rejected, ["d"])
        for image_bytes in glyphs.values():
            with Image.open(io.BytesIO(image_bytes)) as glyph:
                self.assertEqual(glyph.format, "PNG")


if __name__ == "__main__":
    unittest.main()
