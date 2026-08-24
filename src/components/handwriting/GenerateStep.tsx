import type {
  BuildFontResponse,
  Charset,
  GalleryGlyph,
  GenerateMissingResponse,
  RegenerateGlyphResponse,
} from "@/types";
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { apiRequest } from "@/lib/api";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { CHARSET_CHARS, CHARSET_TOTAL } from "./charset";

const GENERATION_BATCH_SIZE = 12;

interface GenerateStepProps {
  sessionId: string;
  charset: Charset;
  gallery: GalleryGlyph[];
  onGalleryChange: (g: GalleryGlyph[]) => void;
  onFontBuilt: (res: BuildFontResponse) => void;
}

export function GenerateStep({
  sessionId,
  charset,
  gallery,
  onGalleryChange,
  onFontBuilt,
}: GenerateStepProps) {
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ done: 0, total: 0 });
  const [errors, setErrors] = useState<{ char: string; error: string }[]>([]);
  const [regeneratingChar, setRegeneratingChar] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const target = CHARSET_CHARS[charset];
  const total = CHARSET_TOTAL[charset];
  const haveChars = new Set(gallery.map((g) => g.char));
  const captured = target.filter((c) => haveChars.has(c)).length;
  const missingCount = total - captured;

  const handleGenerateMissing = async () => {
    setGenerating(true);
    setErrors([]);
    const missing = target.filter((char) => !haveChars.has(char));
    setGenerationProgress({ done: 0, total: missing.length });
    try {
      let currentGallery = gallery;
      for (let offset = 0; offset < missing.length; offset += GENERATION_BATCH_SIZE) {
        const batch = missing.slice(offset, offset + GENERATION_BATCH_SIZE);
        const data = await apiRequest<GenerateMissingResponse>(
          "/api/handwriting/generate-missing",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sessionId,
              existing_chars: currentGallery.map((g) => g.char),
              requested_chars: batch,
              charset,
            }),
          },
          120_000,
        );
        const byChar = new Map(currentGallery.map((g) => [g.char, g]));
        for (const glyph of data.generated) {
          byChar.set(glyph.char, { ...glyph, source: "generated" as const });
        }
        currentGallery = Array.from(byChar.values());
        onGalleryChange(currentGallery);
        if (data.errors.length) setErrors((previous) => [...previous, ...data.errors]);
        setGenerationProgress({
          done: Math.min(offset + batch.length, missing.length),
          total: missing.length,
        });
      }
    } catch (e) {
      setErrors([
        {
          char: "",
          error: e instanceof Error ? e.message : "Generation failed.",
        },
      ]);
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = useCallback(
    async (char: string) => {
      setRegeneratingChar(char);
      try {
        const existingChars = gallery
          .filter((g) => g.char !== char)
          .map((g) => g.char);
        const data = await apiRequest<RegenerateGlyphResponse>("/api/handwriting/regenerate-glyph", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            char,
            existing_chars: existingChars,
          }),
        }, 90_000);
        onGalleryChange(
          gallery.map((g) =>
            g.char === data.char
              ? { ...g, image: data.image, source: "generated" }
              : g,
          ),
        );
      } catch (e) {
        setErrors([
          {
            char,
            error: e instanceof Error ? e.message : "Regenerate failed.",
          },
        ]);
      } finally {
        setRegeneratingChar(null);
      }
    },
    [gallery, sessionId, onGalleryChange],
  );

  const handleBuild = async () => {
    setBuilding(true);
    setBuildError(null);
    try {
      const chars = gallery.map((g) => g.char);
      const data = await apiRequest<BuildFontResponse>("/api/handwriting/build-font", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          font_name: "My Handwriting",
          chars,
        }),
      });
      onFontBuilt(data);
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : "Build failed.");
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          Generate missing glyphs
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ve cropped your confirmed glyphs. Generate the rest of the
          charset in your handwriting style with AI.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Progress value={(captured / total) * 100} className="flex-1" />
        <span className="shrink-0 text-sm font-medium text-muted-foreground">
          {captured} / {total} glyphs
        </span>
      </div>

      {/* Glyph gallery */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Glyph gallery</CardTitle>
        </CardHeader>
        <CardContent>
          {gallery.length === 0 ? (
            <p className="text-sm text-muted-foreground">No glyphs yet.</p>
          ) : (
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
              {gallery.map((g) => (
                <div
                  key={g.char}
                  className={[
                    "group relative flex flex-col items-center gap-1 rounded-md border p-1",
                    g.source === "generated"
                      ? "border-primary/50 bg-primary/5"
                      : "border-border bg-card",
                  ].join(" ")}
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-sm bg-muted">
                    <img
                      src={g.image}
                      alt={`Glyph ${g.char}`}
                      className="h-full w-full object-contain"
                    />
                    {g.source === "generated" && (
                      <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Sparkles className="h-2.5 w-2.5" />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRegenerate(g.char)}
                      disabled={regeneratingChar === g.char}
                      className="absolute bottom-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-foreground opacity-0 transition-opacity hover:bg-background group-hover:opacity-100 disabled:opacity-100"
                      aria-label={`Regenerate ${g.char}`}
                    >
                      {regeneratingChar === g.char ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                  <span className="text-xs font-medium text-foreground">
                    {g.char}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Errors alert */}
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Some glyphs had issues</AlertTitle>
          <AlertDescription className="space-y-0.5">
            {errors.map((e, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span>
                  {e.char ? (
                    <span className="font-mono font-semibold">{e.char}: </span>
                  ) : null}
                  {e.error}
                </span>
                <button
                  type="button"
                  onClick={() => setErrors((prev) => prev.filter((_, j) => j !== i))}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* Generate missing */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          {missingCount > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                {missingCount} glyph{missingCount === 1 ? "" : "s"} still missing
                from the {charset} charset.
              </p>
              <Button
                onClick={handleGenerateMissing}
                disabled={generating || gallery.length === 0}
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {generating
                  ? `Generating ${generationProgress.done} of ${generationProgress.total}…`
                  : "Generate missing letters with AI"}
              </Button>
              {generating && (
                <p className="text-xs text-muted-foreground">
                  Each sheet creates up to 12 letters together for a more
                  consistent style. Finished sheets are saved immediately.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm font-medium text-foreground">
              All charset glyphs captured! 🎉
            </p>
          )}
        </CardContent>
      </Card>

      {/* Build font */}
      <div className="flex flex-col items-start gap-2 border-t border-border pt-4">
        <Button onClick={handleBuild} disabled={building || gallery.length === 0} size="lg">
          {building ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Build Font
        </Button>
        {building && (
          <p className="text-xs text-muted-foreground">Building your font…</p>
        )}
        {buildError && (
          <p className="text-sm text-destructive">{buildError}</p>
        )}
      </div>
    </div>
  );
}
