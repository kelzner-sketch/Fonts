"""Split an ordered AI-generated glyph atlas into individual raster glyphs."""

from __future__ import annotations

import io
import math

from PIL import Image


def split_glyph_sheet(
    image_bytes: bytes,
    chars: list[str],
    columns: int = 4,
) -> tuple[dict[str, bytes], list[str]]:
    """Crop a fixed-grid specimen sheet and reject cells without useful ink."""
    if not chars:
        return {}, []

    with Image.open(io.BytesIO(image_bytes)) as source:
        sheet = source.convert("RGB")

    rows = math.ceil(len(chars) / columns)
    cell_width = sheet.width / columns
    cell_height = sheet.height / rows
    glyphs: dict[str, bytes] = {}
    rejected: list[str] = []

    for index, char in enumerate(chars):
        column = index % columns
        row = index // columns
        # Inset removes any grid guides while retaining generous glyph margins.
        inset_x = max(2, round(cell_width * 0.045))
        inset_y = max(2, round(cell_height * 0.045))
        bounds = (
            round(column * cell_width) + inset_x,
            round(row * cell_height) + inset_y,
            round((column + 1) * cell_width) - inset_x,
            round((row + 1) * cell_height) - inset_y,
        )
        cell = sheet.crop(bounds)
        histogram = cell.convert("L").histogram()
        ink_pixels = sum(histogram[:210])
        ink_ratio = ink_pixels / (cell.width * cell.height)
        if ink_ratio < 0.002 or ink_ratio > 0.55:
            rejected.append(char)
            continue

        cell.thumbnail((512, 512), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        cell.save(output, format="PNG", optimize=True)
        glyphs[char] = output.getvalue()

    return glyphs, rejected
