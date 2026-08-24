import base64
import io
import os
import shutil

from fastapi import FastAPI, APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from PIL import ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool

import gemini_utils
import session_store
from font_builder import GlyphContours, build_ttf, image_to_font_contours
from glyph_sheet import split_glyph_sheet

CHARSETS = {
    "lowercase": [chr(c) for c in range(ord("a"), ord("z") + 1)],
    "letters": [chr(c) for c in range(ord("a"), ord("z") + 1)]
    + [chr(c) for c in range(ord("A"), ord("Z") + 1)],
    "alphanumeric": (
        [chr(c) for c in range(ord("a"), ord("z") + 1)]
        + [chr(c) for c in range(ord("A"), ord("Z") + 1)]
        + [str(d) for d in range(10)]
    ),
}

MAX_UPLOAD_BYTES = 12 * 1024 * 1024
MAX_IMAGE_PIXELS = 30_000_000
MAX_ANALYSIS_DIMENSION = 2200
MAX_GENERATION_BATCH = 12


def _open_upload(raw: bytes) -> Image.Image:
    """Decode, orient, and bound an upload before it reaches storage or AI."""
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise HTTPException(413, "Image dimensions are too large (30 megapixels maximum)")
            image = ImageOps.exif_transpose(source).convert("RGB")
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(400, "Could not read this image. Try a PNG, JPG, or WebP file.")

    image.thumbnail((MAX_ANALYSIS_DIMENSION, MAX_ANALYSIS_DIMENSION), Image.Resampling.LANCZOS)
    return image


def _api_error(operation: str, error: Exception) -> HTTPException:
    # Avoid leaking provider keys, URLs, or raw response bodies to the browser.
    status = getattr(error, "status_code", None)
    if status == 429:
        detail = f"{operation} is temporarily busy. Wait a moment and try again."
    else:
        detail = f"{operation} could not be completed. Please try again."
    return HTTPException(502, detail)


def create_app(static_dir: str) -> FastAPI:
    api = APIRouter()

    @api.get("/health")
    def health():
        return {"ok": True}

    @api.post("/handwriting/analyze")
    async def analyze_handwriting(file: UploadFile = File(...)):
        if file.content_type and not file.content_type.startswith("image/"):
            raise HTTPException(415, "Please upload an image file.")
        raw = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Image is too large (12 MB maximum).")
        if not raw:
            raise HTTPException(400, "The uploaded file is empty.")
        img = await run_in_threadpool(_open_upload, raw)

        session_id = session_store.new_session()
        await run_in_threadpool(img.save, session_store.original_path(session_id), "PNG", optimize=True)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        try:
            result = await run_in_threadpool(
                gemini_utils.analyze_handwriting, buf.getvalue(), "image/png"
            )
        except Exception as error:
            shutil.rmtree(session_store.session_dir(session_id), ignore_errors=True)
            raise _api_error("Handwriting analysis", error)

        return {
            "session_id": session_id,
            "width": img.width,
            "height": img.height,
            "style": result["style"],
            "glyphs": result["glyphs"],
        }

    class GlyphBox(BaseModel):
        char: str
        bbox: list[float] = Field(min_length=4, max_length=4)

        @field_validator("char")
        @classmethod
        def valid_char(cls, value: str) -> str:
            if len(value) != 1 or not value.isascii() or not value.isalnum():
                raise ValueError("char must be one ASCII letter or digit")
            return value

        @field_validator("bbox")
        @classmethod
        def valid_bbox(cls, value: list[float]) -> list[float]:
            if any(not 0 <= coordinate <= 1 for coordinate in value):
                raise ValueError("bbox coordinates must be between 0 and 1")
            if value[2] <= value[0] or value[3] <= value[1]:
                raise ValueError("bbox must have positive width and height")
            return value

    class ConfirmGlyphsRequest(BaseModel):
        session_id: str
        glyphs: list[GlyphBox]

    @api.post("/handwriting/confirm-glyphs")
    async def confirm_glyphs(body: ConfirmGlyphsRequest):
        if not session_store.session_exists(body.session_id):
            raise HTTPException(404, "Unknown session")
        orig_path = session_store.original_path(body.session_id)
        if not os.path.isfile(orig_path):
            raise HTTPException(404, "Original image missing")
        img = Image.open(orig_path).convert("RGB")
        w, h = img.size

        results = []
        for g in body.glyphs:
            if len(g.char) != 1:
                continue
            x0, y0, x1, y1 = g.bbox
            px0, py0, px1, py1 = (
                max(0, int(x0 * w)),
                max(0, int(y0 * h)),
                min(w, int(x1 * w)),
                min(h, int(y1 * h)),
            )
            if px1 <= px0 or py1 <= py0:
                continue
            crop = img.crop((px0, py0, px1, py1))
            crop.thumbnail((512, 512), Image.Resampling.LANCZOS)
            crop.save(session_store.glyph_path(body.session_id, g.char), format="PNG", optimize=True)
            buf = io.BytesIO()
            crop.save(buf, format="PNG")
            results.append(
                {
                    "char": g.char,
                    "image": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
                }
            )
        return {"glyphs": results}

    class GenerateMissingRequest(BaseModel):
        session_id: str
        existing_chars: list[str]
        charset: str = "lowercase"
        requested_chars: list[str] | None = None

    @api.post("/handwriting/generate-missing")
    async def generate_missing(body: GenerateMissingRequest):
        if not session_store.session_exists(body.session_id):
            raise HTTPException(404, "Unknown session")
        if body.charset not in CHARSETS:
            raise HTTPException(400, "Unknown character set")
        target = CHARSETS[body.charset]
        existing = set(body.existing_chars)
        missing = [c for c in target if c not in existing]
        if body.requested_chars is not None:
            requested = set(body.requested_chars)
            missing = [c for c in missing if c in requested]
        if len(missing) > MAX_GENERATION_BATCH:
            raise HTTPException(
                400, f"Generate at most {MAX_GENERATION_BATCH} glyphs per request"
            )

        # gather reference crops already captured for style-matching
        ref_bytes = []
        for c in body.existing_chars:
            p = session_store.glyph_path(body.session_id, c)
            if os.path.isfile(p):
                with open(p, "rb") as f:
                    ref_bytes.append(f.read())
        if not ref_bytes:
            raise HTTPException(400, "Need at least one confirmed glyph to match style against")

        # style description was computed at analyze time; re-derive a short
        # generic note if not passed back by client (kept stateless here)
        style = "consistent with the reference handwriting samples provided"

        if not missing:
            return {"generated": [], "errors": []}

        try:
            sheet_bytes = await run_in_threadpool(
                gemini_utils.generate_glyph_sheet, missing, style, ref_bytes
            )
        except Exception as error:
            raise _api_error("Glyph generation", error)
        if not sheet_bytes:
            raise HTTPException(502, "The generator did not return a specimen sheet. Try again.")

        extracted, rejected = await run_in_threadpool(
            split_glyph_sheet, sheet_bytes, missing
        )
        generated = []
        errors = [
            {"char": char, "error": "The generated cell was blank or unusable; retry it."}
            for char in rejected
        ]
        for ch in missing:
            img_bytes = extracted.get(ch)
            if not img_bytes:
                continue
            with open(session_store.glyph_path(body.session_id, ch), "wb") as f:
                f.write(img_bytes)
            generated.append(
                {
                    "char": ch,
                    "image": "data:image/png;base64," + base64.b64encode(img_bytes).decode(),
                }
            )
        return {"generated": generated, "errors": errors}

    class RegenerateGlyphRequest(BaseModel):
        session_id: str
        char: str
        existing_chars: list[str]

        @field_validator("char")
        @classmethod
        def valid_char(cls, value: str) -> str:
            if len(value) != 1 or not value.isascii() or not value.isalnum():
                raise ValueError("char must be one ASCII letter or digit")
            return value

    @api.post("/handwriting/regenerate-glyph")
    async def regenerate_glyph(body: RegenerateGlyphRequest):
        if not session_store.session_exists(body.session_id):
            raise HTTPException(404, "Unknown session")
        ref_bytes = []
        for c in body.existing_chars:
            p = session_store.glyph_path(body.session_id, c)
            if os.path.isfile(p) and c != body.char:
                with open(p, "rb") as f:
                    ref_bytes.append(f.read())
        if not ref_bytes:
            raise HTTPException(400, "Need reference glyphs to match style against")
        try:
            img_bytes = await run_in_threadpool(
                gemini_utils.generate_missing_glyph,
                body.char,
                "consistent with the reference handwriting samples provided",
                ref_bytes,
            )
        except Exception as error:
            raise _api_error("Glyph generation", error)
        if not img_bytes:
            raise HTTPException(502, "Generation failed")
        with open(session_store.glyph_path(body.session_id, body.char), "wb") as f:
            f.write(img_bytes)
        return {
            "char": body.char,
            "image": "data:image/png;base64," + base64.b64encode(img_bytes).decode(),
        }

    class BuildFontRequest(BaseModel):
        session_id: str
        font_name: str = "MyHandwriting"
        chars: list[str]

    @api.post("/handwriting/build-font")
    async def build_font(body: BuildFontRequest):
        if not session_store.session_exists(body.session_id):
            raise HTTPException(404, "Unknown session")

        glyphs: list[GlyphContours] = []
        skipped = []
        for ch in body.chars:
            p = session_store.glyph_path(body.session_id, ch)
            if not os.path.isfile(p):
                skipped.append(ch)
                continue
            with open(p, "rb") as f:
                data = f.read()
            gc = await run_in_threadpool(image_to_font_contours, data, ch)
            if gc is None:
                skipped.append(ch)
                continue
            glyphs.append(gc)

        if not glyphs:
            raise HTTPException(400, "No usable glyphs to build a font from")

        safe_name = "".join(c for c in body.font_name if c.isalnum() or c in " -_") or "MyHandwriting"
        out_path = session_store.font_path(body.session_id)
        try:
            await run_in_threadpool(build_ttf, glyphs, safe_name, out_path)
        except Exception:
            raise HTTPException(500, "Font build failed. Check the glyphs and try again.")

        return {
            "font_url": f"/api/handwriting/font/{body.session_id}",
            "glyph_count": len(glyphs),
            "skipped": skipped,
        }

    @api.get("/handwriting/font/{session_id}")
    async def get_font(session_id: str):
        path = session_store.font_path(session_id)
        if not os.path.isfile(path):
            raise HTTPException(404, "Font not built yet")
        return FileResponse(path, media_type="font/ttf", filename="handwriting-font.ttf")

    app = FastAPI()
    app.include_router(api, prefix="/api")

    if os.path.isdir(static_dir):
        assets_dir = os.path.join(static_dir, "assets")
        if os.path.isdir(assets_dir):
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{path:path}")
        async def spa_fallback(request: Request, path: str):
            file_path = os.path.join(static_dir, path)
            if path and os.path.isfile(file_path):
                return FileResponse(file_path)
            return FileResponse(
                os.path.join(static_dir, "index.html"),
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                },
            )

    return app
