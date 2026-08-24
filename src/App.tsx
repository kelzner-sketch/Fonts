import type {
  AnalyzeResponse,
  BuildFontResponse,
  Charset,
  GalleryGlyph,
  WizardStep,
} from "./types";
import { Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { GenerateStep } from "@/components/handwriting/GenerateStep";
import { PreviewStep } from "@/components/handwriting/PreviewStep";
import { ReviewStep } from "@/components/handwriting/ReviewStep";
import { UploadStep } from "@/components/handwriting/UploadStep";

const STEPS: { id: WizardStep; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "review", label: "Review" },
  { id: "generate", label: "Generate" },
  { id: "preview", label: "Preview" },
];

function App() {
  const [step, setStep] = useState<WizardStep>("upload");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [style, setStyle] = useState<string>("");
  const [detectedGlyphs, setDetectedGlyphs] = useState<
    AnalyzeResponse["glyphs"]
  >([]);
  const [charset, setCharset] = useState<Charset>("lowercase");
  const [gallery, setGallery] = useState<GalleryGlyph[]>([]);
  const [fontResult, setFontResult] = useState<BuildFontResponse | null>(null);

  // cleanup object URL on unmount / replace
  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const handleAnalyzed = useCallback(
    (_f: File, url: string, data: AnalyzeResponse) => {
      setImageUrl(url);
      setSessionId(data.session_id);
      setStyle(data.style);
      setDetectedGlyphs(data.glyphs);
      setGallery([]);
      setFontResult(null);
      setStep("review");
    },
    [],
  );

  const handleConfirmed = useCallback(
    (glyphs: GalleryGlyph[]) => {
      setGallery(glyphs);
      setFontResult(null);
      setStep("generate");
    },
    [],
  );

  const handleFontBuilt = useCallback((res: BuildFontResponse) => {
    setFontResult(res);
    setStep("preview");
  }, []);

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="min-h-screen bg-background">
      {/* Stepper header */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <h1 className="text-base font-semibold text-foreground">
            Handwriting → Font AI
          </h1>
          <nav className="flex items-center gap-1">
            {STEPS.map((s, i) => {
              const done = i < stepIndex;
              const active = i === stepIndex;
              return (
                <div key={s.id} className="flex items-center">
                  <div
                    className={[
                      "flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : done
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                    ].join(" ")}
                  >
                    {done ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : active ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    <span>{s.label}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="mx-1 h-px w-4 bg-border sm:w-6" />
                  )}
                </div>
              );
            })}
          </nav>
        </div>
      </header>

      <main>
        {step === "upload" && <UploadStep onAnalyzed={handleAnalyzed} />}

        {step === "review" && imageUrl && sessionId && (
          <ReviewStep
            imageUrl={imageUrl}
            sessionId={sessionId}
            style={style}
            initialGlyphs={detectedGlyphs}
            charset={charset}
            onCharsetChange={setCharset}
            onConfirmed={handleConfirmed}
          />
        )}

        {step === "generate" && sessionId && (
          <GenerateStep
            sessionId={sessionId}
            charset={charset}
            gallery={gallery}
            onGalleryChange={setGallery}
            onFontBuilt={handleFontBuilt}
          />
        )}

        {step === "preview" && sessionId && (
          <PreviewStep
            sessionId={sessionId}
            galleryChars={gallery.map((g) => g.char)}
            initialFontName="My Handwriting"
            onFontBuilt={handleFontBuilt}
            fontResult={fontResult}
          />
        )}
      </main>

      {/* Back navigation */}
      {step !== "upload" && (
        <div className="mx-auto max-w-4xl px-4 pb-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (step === "review") setStep("upload");
              else if (step === "generate") setStep("review");
              else if (step === "preview") setStep("generate");
            }}
          >
            ← Back
          </Button>
        </div>
      )}
    </div>
  );
}

export default App;
