import type { AnalyzeResponse } from "@/types";
import { Loader2, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/api";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

interface UploadStepProps {
  onAnalyzed: (file: File, objectUrl: string, data: AnalyzeResponse) => void;
}

export function UploadStep({ onAnalyzed }: UploadStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      if (!ACCEPTED_TYPES.has(file.type)) {
        setError("Choose a PNG, JPG, or WebP image.");
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setError("That image is larger than 12 MB. Resize it and try again.");
        return;
      }
      setError(null);
      setLoading(true);
      const objectUrl = URL.createObjectURL(file);
      const formData = new FormData();
      formData.append("file", file);
      try {
        const data = await apiRequest<AnalyzeResponse>("/api/handwriting/analyze", {
          method: "POST",
          body: formData,
        }, 60_000);
        onAnalyzed(file, objectUrl, data);
      } catch (e) {
        URL.revokeObjectURL(objectUrl);
        setError(e instanceof Error ? e.message : "Analysis failed.");
      } finally {
        setLoading(false);
      }
    },
    [onAnalyzed],
  );

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Upload className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Handwriting → Font AI</CardTitle>
          <CardDescription>
            Upload a photo of your handwriting or a font sample sheet. Our AI
            will detect individual glyphs so you can build a custom font.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              handleFile(e.dataTransfer.files?.[0]);
            }}
            className={[
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-accent/50",
            ].join(" ")}
          >
            {loading ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm font-medium text-foreground">
                  Analyzing handwriting…
                </p>
                <p className="text-xs text-muted-foreground">
                  This can take 5–15 seconds.
                </p>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Click to upload or drag & drop
                  </p>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG, or WebP · up to 12 MB
                  </p>
                </div>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          {error && (
            <p className="mt-3 text-center text-sm text-destructive">{error}</p>
          )}
          <div className="mt-4 flex justify-center">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={loading}
            >
              <Upload className="h-4 w-4" />
              Choose image
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
