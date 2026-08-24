"""Convert raster glyph images (handwritten or AI-generated letters) into a
real installable TTF font using OpenCV contour tracing + fontTools.

Pipeline per glyph:
  1. Load image, convert to grayscale.
  2. Binarize with Otsu threshold (ink = dark pixels on light background).
  3. Find contours with hierarchy (cv2.RETR_CCOMP) so holes (e.g. the counter
     of an "o" or "a") are detected separately from outer strokes.
  4. Simplify each contour with approxPolyDP to keep point counts sane.
  5. Rescale contour points from image pixel space (y-down) into font units
     (y-up, UPM em square), aligned to a shared baseline/x-height so all
     glyphs sit consistently in a line of text.
  6. Feed contours into a fontTools TTGlyphPen to build a glyf-table glyph
     with straight line segments (sufficiently smooth at typical letter
     sizes; no quadratic fitting needed for MVP).
  7. Assemble a full font with FontBuilder: cmap, glyf, hmtx, name tables.
"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass

import cv2
import numpy as np
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from PIL import Image

UPM = 1000  # units per em
ASCENT = 800
DESCENT = -200
# Target visual height (in font units) that a glyph's ink bounding box is
# scaled to. Lowercase letters without ascenders/descenders are shorter than
# capital/ascender letters; we scale everything by ink height relative to a
# shared cap-height reference so proportions stay believable across a mixed
# set generated from independent images.
CAP_HEIGHT = 700
BASELINE = 0
PADDING_RATIO = 0.08  # left/right side-bearing as a fraction of glyph width


@dataclass
class GlyphContours:
    char: str
    contours: list[list[tuple[float, float]]]  # each in font units, y-up
    advance_width: int


def _binarize(img: Image.Image) -> np.ndarray:
    """Return a binary mask (255 = ink) from a PIL image."""
    arr = np.array(img.convert("L"))
    # Otsu picks a global threshold automatically; works well for photos of
    # dark ink on lighter paper as well as clean AI-generated glyph images.
    _, mask = cv2.threshold(arr, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # Light denoise to drop stray pixels from JPEG/photo artifacts.
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    return mask


def _extract_polygons(mask: np.ndarray) -> tuple[list[np.ndarray], np.ndarray]:
    """Return simplified contour polygons plus their hierarchy array."""
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    polys = []
    for c in contours:
        if cv2.contourArea(c) < 4:
            polys.append(None)
            continue
        peri = cv2.arcLength(c, True)
        eps = max(0.4, 0.0035 * peri)
        approx = cv2.approxPolyDP(c, eps, True)
        polys.append(approx.reshape(-1, 2))
    return polys, hierarchy


def image_to_font_contours(image_bytes: bytes, char: str) -> GlyphContours | None:
    """Convert a single-glyph raster image into font-space contours.

    Returns None if no ink was detected (blank/failed glyph).
    """
    img = Image.open(io.BytesIO(image_bytes))
    mask = _binarize(img)
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return None

    polys, hierarchy = _extract_polygons(mask)
    if hierarchy is None:
        return None
    hierarchy = hierarchy[0]  # shape (N, 4): next, prev, first_child, parent

    x0, x1 = xs.min(), xs.max()
    y0, y1 = ys.min(), ys.max()
    ink_w = max(1, x1 - x0)
    ink_h = max(1, y1 - y0)

    # Scale so the glyph's ink height maps to CAP_HEIGHT, preserving aspect
    # ratio. Center horizontally within its own advance box later.
    scale = CAP_HEIGHT / ink_h

    contours: list[list[tuple[float, float]]] = []
    for idx, poly in enumerate(polys):
        if poly is None or len(poly) < 3:
            continue
        is_hole = hierarchy[idx][3] != -1  # has a parent -> it's a hole
        pts = []
        for px, py in poly:
            fx = (px - x0) * scale
            fy = (y1 - py) * scale  # flip y: image y-down -> font y-up
            pts.append((fx, fy))
        # Enforce winding: outer contours positive signed area, holes
        # negative, matching the non-zero fill rule.
        area = _signed_area(pts)
        if is_hole and area > 0:
            pts.reverse()
        elif not is_hole and area < 0:
            pts.reverse()
        contours.append(pts)

    if not contours:
        return None

    glyph_width = ink_w * scale
    pad = glyph_width * PADDING_RATIO
    advance_width = int(round(glyph_width + 2 * pad))
    contours = [[(x + pad, y) for x, y in c] for c in contours]

    return GlyphContours(char=char, contours=contours, advance_width=advance_width)


def _signed_area(pts: list[tuple[float, float]]) -> float:
    area = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    return area / 2.0


def build_ttf(glyphs: list[GlyphContours], font_name: str, out_path: str) -> str:
    """Assemble a TTF font from per-character contours and write it to disk."""
    glyph_order = [".notdef", "space"] + [g.char for g in glyphs]
    # de-dupe while preserving order in case of odd duplicate chars
    seen = set()
    ordered = []
    for g in glyph_order:
        if g not in seen:
            ordered.append(g)
            seen.add(g)
    glyph_order = ordered

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)

    char_map = {ord(g.char): g.char for g in glyphs}
    char_map[32] = "space"  # ensure literal spaces render as blank, not .notdef
    fb.setupCharacterMap(char_map)

    glyf_table = {}
    metrics = {}

    # .notdef: simple empty box
    pen = TTGlyphPen(None)
    box = 500
    pen.moveTo((50, 0))
    pen.lineTo((box - 50, 0))
    pen.lineTo((box - 50, CAP_HEIGHT))
    pen.lineTo((50, CAP_HEIGHT))
    pen.closePath()
    glyf_table[".notdef"] = pen.glyph()
    metrics[".notdef"] = (box, 0)

    space_width = int(UPM * 0.28)
    pen = TTGlyphPen(None)
    glyf_table["space"] = pen.glyph()
    metrics["space"] = (space_width, 0)

    for g in glyphs:
        pen = TTGlyphPen(None)
        for contour in g.contours:
            pts = [(round(x), round(y)) for x, y in contour]
            pen.moveTo(pts[0])
            for p in pts[1:]:
                pen.lineTo(p)
            pen.closePath()
        glyf_table[g.char] = pen.glyph()
        lsb = 0
        metrics[g.char] = (max(1, g.advance_width), lsb)

    fb.setupGlyf(glyf_table)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupOS2(sTypoAscender=ASCENT, sTypoDescender=DESCENT, usWinAscent=ASCENT, usWinDescent=-DESCENT)
    fb.setupNameTable({
        "familyName": font_name,
        "styleName": "Regular",
        "uniqueFontIdentifier": f"{font_name}-Regular",
        "fullName": f"{font_name} Regular",
        "psName": font_name.replace(" ", "") + "-Regular",
        "version": "Version 1.0",
    })
    fb.setupPost()

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    fb.save(out_path)
    return out_path
