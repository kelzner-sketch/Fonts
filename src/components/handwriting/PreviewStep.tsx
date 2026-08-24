import type { BuildFontResponse } from "@/types";
import { Download, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface PreviewStepProps {
  sessionId: string;
  galleryChars: string[];
  initialFontName: string;
  onFontBuilt: (res: BuildFontResponse) => void;
  fontResult: BuildFontResponse | null;
}

const PREVIEW_DEFAULT =
  "The quick brown fox jumps over the lazy dog 0123456789";

const FONT_FAMILY = "HandwritingFontAI";

export function PreviewStep({
  sessionId,
  galleryChars,
  initialFontName,
  onFontBuilt,
  fontResult,
}: PreviewStepProps) {
  const [fontName, setFontName] = useState(initialFontName);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState(PREVIEW_DEFAULT);
  const [fontReady, setFontReady] = useState(false);

  // Register the font once we have a font_url
  useEffect(() => {
    if (!fontResult?.font_url) {
      setFontReady(false);
      return;
    }
    let cancelled = false;
    const url = fontResult.font_url;
    const face = new FontFace(FONT_FAMILY, `url(${url})`, {
      display: "swap",
    });
    face
      .load()
      .then(() => {
        if (cancelled) return;
        document.fonts.add(face);
        setFontReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        // fallback: inject a style tag as backup
        const id = "hw-font-face";
        let el = document.getElementById(id);
        if (!el) {
          el = document.createElement("style");
          el.id = id;
          document.head.appendChild(el);
        }
        el.textContent = `@font-face { font-family: '${FONT_FAMILY}'; src: url('${url}') format('truetype'); }`;
        setFontReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fontResult?.font_url]);

  const handleBuild = async () => {
    setBuilding(true);
    setError(null);
    try {
      const res = await fetch("/api/handwriting/build-font", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          font_name: fontName || "My Handwriting",
          chars: galleryChars,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `Build failed (${res.status})`);
      }
      const data = (await res.json()) as BuildFontResponse;
      onFontBuilt(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Build failed.");
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          Build &amp; preview your font
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Name your font, build it, then type anything to see it in your
          handwriting.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Font settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="font-name">Font name</Label>
              <Input
                id="font-name"
                value={fontName}
                onChange={(e) => setFontName(e.target.value)}
                placeholder="My Handwriting"
              />
            </div>
            <Button
              onClick={handleBuild}
              disabled={building || galleryChars.length === 0}
              size="lg"
            >
              {building ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Build Font
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {fontResult && (
            <p className="text-sm text-muted-foreground">
              Built with {fontResult.glyph_count} glyph
              {fontResult.glyph_count === 1 ? "" : "s"}.
            </p>
          )}
        </CardContent>
      </Card>

      {fontResult?.skipped && fontResult.skipped.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Some characters could not be processed:{" "}
          <span className="font-mono">
            {fontResult.skipped.join(", ")}
          </span>
        </p>
      )}

      {fontResult?.font_url && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Live preview</CardTitle>
            <Button asChild variant="secondary" size="sm">
              <a
                href={fontResult.font_url}
                download="handwriting-font.ttf"
              >
                <Download className="h-4 w-4" />
                Download Font (.ttf)
              </a>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              rows={4}
              style={{
                fontFamily: fontReady ? `'${FONT_FAMILY}', sans-serif` : undefined,
                fontSize: "48px",
                lineHeight: 1.3,
              }}
              placeholder="Type to preview your font…"
            />
            <p className="text-xs text-muted-foreground">
              Only characters included in the built font will render in your
              handwriting; others fall back to the system font.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
