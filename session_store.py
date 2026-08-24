"""Simple filesystem-backed session storage for in-progress font projects.

Each session gets its own directory under /tmp/handwriting_sessions/<id>/
holding the original upload, per-character glyph crops/generations, and the
final built font. This is intentionally simple (no DB) since sessions are
short-lived, single-user editing flows.
"""

from __future__ import annotations

import os
import uuid

BASE_DIR = "/tmp/handwriting_sessions"


def new_session() -> str:
    session_id = uuid.uuid4().hex
    os.makedirs(session_dir(session_id), exist_ok=True)
    os.makedirs(glyphs_dir(session_id), exist_ok=True)
    return session_id


def session_dir(session_id: str) -> str:
    safe = "".join(c for c in session_id if c.isalnum())
    return os.path.join(BASE_DIR, safe)


def glyphs_dir(session_id: str) -> str:
    return os.path.join(session_dir(session_id), "glyphs")


def original_path(session_id: str) -> str:
    return os.path.join(session_dir(session_id), "original.png")


def glyph_path(session_id: str, char: str) -> str:
    # Encode char as its ordinal to keep filenames safe (case-sensitive fs
    # issues: 'A' vs 'a' collide on some filesystems otherwise).
    return os.path.join(glyphs_dir(session_id), f"{ord(char)}.png")


def font_path(session_id: str) -> str:
    return os.path.join(session_dir(session_id), "font.ttf")


def session_exists(session_id: str) -> bool:
    return os.path.isdir(session_dir(session_id))
