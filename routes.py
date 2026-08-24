import base64
import io
import os

from fastapi import FastAPI, APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel

import gemini_utils
import session_store
from font_builder import GlyphContours, build_ttf, image_to_font_contours

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


def create_app(static_dir: str) -> FastAPI:
    api = APIRouter()

    @api.get("/health")
    def health():
        return {"ok": True}

    @api.post("/handwriting/analyze")
    async def analyze_handwriting(file: UploadFile = File(...)):
        raw = await file.read()
        try:
            img = Image.open(io.BytesIO(raw))
            img = img.convert("RGB")
        except Exception:
            raise HTTPException(400, "Could not read image file")

        session_id = session_store.new_session()
        img.save(session_store.original_path(session_id), format="PNG")

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        try:
            result = gemini_utils.analyze_handwriting(buf.getvalue(), "image/png")
        except Exception as e:
            raise HTTPException(502, f"Handwriting analysis failed: {e}")

        return {
            "session_id": session_id,
            "width": img.width,
            "height": img.height,
            "style": result["style"],
            "glyphs": result["glyphs"],
        }

    class GlyphBox(BaseModel):
        char: str
        bbox: list[float]

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
            crop.save(session_store.glyph_path(body.session_id, g.char), format="PNG")
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

    @api.post("/handwriting/generate-missing")
    async def generate_missing(body: GenerateMissingRequest):
        if not session_store.session_exists(body.session_id):
            raise HTTPException(404, "Unknown session")
        target = CHARSETS.get(body.charset, CHARSETS["lowercase"])
        existing = set(body.existing_chars)
        missing = [c for c in target if c not in existing]

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

        generated = []
        errors = []
        for ch in missing:
            try:
                img_bytes = gemini_utils.generate_missing_glyph(ch, style, ref_bytes)
            except Exception as e:
                errors.append({"char": ch, "error": str(e)})
                continue
            if not img_bytes:
                errors.append({"char": ch, "error": "no image returned"})
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
        img_bytes = gemini_utils.generate_missing_glyph(
            body.char, "consistent with the reference handwriting samples provided", ref_bytes
        )
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
            gc = image_to_font_contours(data, ch)
            if gc is None:
                skipped.append(ch)
                continue
            glyphs.append(gc)

        if not glyphs:
            raise HTTPException(400, "No usable glyphs to build a font from")

        safe_name = "".join(c for c in body.font_name if c.isalnum() or c in " -_") or "MyHandwriting"
        out_path = session_store.font_path(body.session_id)
        try:
            build_ttf(glyphs, safe_name, out_path)
        except Exception as e:
            raise HTTPException(500, f"Font build failed: {e}")

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
