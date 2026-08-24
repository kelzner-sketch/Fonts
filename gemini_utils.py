"""Gemini-backed handwriting analysis and glyph generation helpers."""

from __future__ import annotations

import base64
import json
import os
import re

from google import genai
from google.genai import types
from PIL import Image
import io

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(
            api_key=os.environ.get("GEMINI_WORKSHOP_API_KEY"),
            http_options={
                "api_version": "v1alpha",
                "base_url": os.environ.get("GEMINI_WORKSHOP_BASE_URL"),
            },
        )
    return _client


ANALYZE_PROMPT = """You are analyzing a photo of handwritten (or printed font sample) text.
Identify every distinct, clearly legible individual character you can find (letters a-z, A-Z, and digits 0-9 only — ignore punctuation and ignore illegible/overlapping characters).

For each character, give its tight bounding box in normalized coordinates where (0,0) is the top-left of the image and (1,1) is the bottom-right, as [x_min, y_min, x_max, y_max].

If the same character appears multiple times, pick the single clearest, most isolated instance only.

Also describe the handwriting style briefly (slant, stroke weight, roundness vs angularity, casual vs formal) in one or two sentences, useful for later generating matching letters.

Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{
  "style": "one or two sentence style description",
  "glyphs": [
    {"char": "a", "bbox": [0.12, 0.34, 0.20, 0.50]},
    ...
  ]
}
"""


def analyze_handwriting(image_bytes: bytes, mime_type: str = "image/png") -> dict:
    client = _get_client()
    image_part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=[ANALYZE_PROMPT, image_part],
    )
    text = response.text or "{}"
    text = _strip_fences(text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        data = json.loads(match.group(0)) if match else {"style": "", "glyphs": []}
    data.setdefault("style", "")
    data.setdefault("glyphs", [])
    # Keep only single-character, alphanumeric entries with valid bboxes.
    cleaned = []
    for g in data["glyphs"]:
        ch = str(g.get("char", ""))[:1]
        bbox = g.get("bbox")
        if ch.isalnum() and ch.isascii() and isinstance(bbox, list) and len(bbox) == 4:
            cleaned.append({"char": ch, "bbox": bbox})
    data["glyphs"] = cleaned
    return data


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"```$", "", text)
    return text.strip()


GENERATE_PROMPT_TEMPLATE = """These reference images each show a single handwritten character in one person's handwriting.
Handwriting style notes: {style}

Generate ONE new image containing a single handwritten character: "{char}"
Requirements:
- Match the same pen/ink style, stroke thickness, slant, and letter proportions as the reference images.
- The character must be {case_hint}.
- Plain white (or transparent) background, no lines, no other text, no borders.
- Center the character in the frame with generous margin around it.
- Output only the character glyph, nothing else.
"""


def generate_missing_glyph(char: str, style: str, reference_images: list[bytes]) -> bytes | None:
    client = _get_client()
    case_hint = "uppercase" if char.isupper() else ("a digit" if char.isdigit() else "lowercase")
    prompt = GENERATE_PROMPT_TEMPLATE.format(style=style or "natural handwriting", char=char, case_hint=case_hint)
    contents: list = [prompt]
    for ref in reference_images[:6]:
        try:
            contents.append(Image.open(io.BytesIO(ref)))
        except Exception:
            continue
    response = client.models.generate_content(
        model="gemini-2.5-flash-image",
        contents=contents,
        config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
    )
    for part in response.parts or []:
        if part.inline_data is not None:
            data = part.inline_data.data
            if isinstance(data, str):
                data = base64.b64decode(data)
            return data
    return None
