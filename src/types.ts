export type ApiStatus = "checking" | "connected" | "error";

export interface HealthResponse {
  ok: boolean;
}

/* ── Handwriting → Font types ── */

export type WizardStep = "upload" | "review" | "generate" | "preview";

export type Charset = "lowercase" | "letters" | "alphanumeric";

/** bbox normalized 0..1: [x0, y0, x1, y1] (top-left, bottom-right) */
export type Bbox = [number, number, number, number];

export interface DetectedGlyph {
  char: string;
  bbox: Bbox;
}

export interface AnalyzeResponse {
  session_id: string;
  width: number;
  height: number;
  style: string;
  glyphs: DetectedGlyph[];
}

export interface ConfirmedGlyph {
  char: string;
  image: string; // data:image/png;base64,...
}

export interface ConfirmGlyphsResponse {
  glyphs: ConfirmedGlyph[];
}

export interface GeneratedGlyph {
  char: string;
  image: string;
}

export interface GenerateMissingResponse {
  generated: GeneratedGlyph[];
  errors: { char: string; error: string }[];
}

export interface RegenerateGlyphResponse {
  char: string;
  image: string;
}

export interface BuildFontResponse {
  font_url: string;
  glyph_count: number;
  skipped: string[];
}

/** A glyph in the gallery, with provenance (confirmed from upload vs AI-generated). */
export interface GalleryGlyph {
  char: string;
  image: string;
  source: "confirmed" | "generated";
}
