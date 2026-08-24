import type {
  Bbox,
  Charset,
  ConfirmGlyphsResponse,
  DetectedGlyph,
} from "@/types";
import { Check, Loader2, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { apiRequest } from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CHARSET_CHARS, CHARSET_OPTIONS, CHARSET_TOTAL } from "./charset";

interface ReviewStepProps {
  imageUrl: string;
  sessionId: string;
  style: string;
  initialGlyphs: DetectedGlyph[];
  charset: Charset;
  onCharsetChange: (c: Charset) => void;
  onConfirmed: (glyphs: { char: string; image: string; source: "confirmed" }[]) => void;
}

/** A glyph box in the editor. id is local-only for React keys. */
interface GlyphBox {
  id: number;
  char: string;
  bbox: Bbox;
}

let boxIdCounter = 0;
const nextId = () => ++boxIdCounter;

export function ReviewStep({
  imageUrl,
  sessionId,
  style,
  initialGlyphs,
  charset,
  onCharsetChange,
  onConfirmed,
}: ReviewStepProps) {
  const [boxes, setBoxes] = useState<GlyphBox[]>(() =>
    initialGlyphs.map((g) => ({ id: nextId(), char: g.char, bbox: g.bbox })),
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [addingMode, setAddingMode] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imgWrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  // drag-to-draw state
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCur, setDragCur] = useState<{ x: number; y: number } | null>(null);

  const measureImg = useCallback(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) {
      setImgSize({ w: el.clientWidth, h: el.clientHeight });
    }
  }, []);

  useEffect(() => {
    measureImg();
    const onResize = () => measureImg();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measureImg]);

  // progress: how many target-charset chars have a valid single-char box
  const { captured, total } = useMemo(() => {
    const target = new Set(CHARSET_CHARS[charset]);
    const have = new Set(
      boxes
        .filter((b) => b.char.length === 1)
        .map((b) => b.char)
        .filter((c) => target.has(c)),
    );
    return { captured: have.size, total: CHARSET_TOTAL[charset] };
  }, [boxes, charset]);

  const selectedBox = boxes.find((b) => b.id === selectedId) ?? null;

  const updateBoxChar = (id: number, char: string) => {
    setBoxes((prev) =>
      prev.map((b) => (b.id === id ? { ...b, char: char.slice(0, 1) } : b)),
    );
  };

  const deleteBox = (id: number) => {
    setBoxes((prev) => prev.filter((b) => b.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  // Convert client coords (px relative to image) → normalized bbox
  const toNorm = (x0: number, y0: number, x1: number, y1: number): Bbox => {
    const w = imgSize?.w ?? 1;
    const h = imgSize?.h ?? 1;
    const nx0 = Math.max(0, Math.min(x0, x1)) / w;
    const ny0 = Math.max(0, Math.min(y0, y1)) / h;
    const nx1 = Math.min(1, Math.max(x0, x1)) / w;
    const ny1 = Math.min(1, Math.max(y0, y1)) / h;
    return [nx0, ny0, nx1, ny1];
  };

  const getRelCoords = (e: React.MouseEvent) => {
    const el = imgWrapRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(e.clientY - rect.top, rect.height)),
    };
  };

  const onWrapMouseDown = (e: React.MouseEvent) => {
    if (!addingMode) return;
    e.preventDefault();
    const p = getRelCoords(e);
    setDragStart(p);
    setDragCur(p);
  };

  const onWrapMouseMove = (e: React.MouseEvent) => {
    if (!dragStart) return;
    setDragCur(getRelCoords(e));
  };

  const onWrapMouseUp = (e: React.MouseEvent) => {
    if (!addingMode || !dragStart) return;
    const end = getRelCoords(e);
    const dx = Math.abs(end.x - dragStart.x);
    const dy = Math.abs(end.y - dragStart.y);
    if (dx > 4 && dy > 4) {
      const bbox = toNorm(dragStart.x, dragStart.y, end.x, end.y);
      const newBox: GlyphBox = { id: nextId(), char: "", bbox };
      setBoxes((prev) => [...prev, newBox]);
      setSelectedId(newBox.id);
    }
    setDragStart(null);
    setDragCur(null);
    setAddingMode(false);
  };

  const handleConfirm = async () => {
    setConfirming(true);
    setError(null);
    try {
      const payload = boxes
        .filter((b) => b.char.length === 1)
        .map((b) => ({ char: b.char, bbox: b.bbox }));
      if (payload.length === 0) {
        throw new Error("Label at least one glyph before continuing.");
      }
      const data = await apiRequest<ConfirmGlyphsResponse>("/api/handwriting/confirm-glyphs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, glyphs: payload }),
      });
      onConfirmed(
        data.glyphs.map((g) => ({ ...g, source: "confirmed" as const })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirm failed.");
    } finally {
      setConfirming(false);
    }
  };

  // live drag rectangle (px)
  const dragRect =
    dragStart && dragCur
      ? {
          left: Math.min(dragStart.x, dragCur.x),
          top: Math.min(dragStart.y, dragCur.y),
          width: Math.abs(dragCur.x - dragStart.x),
          height: Math.abs(dragCur.y - dragStart.y),
        }
      : null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            Review &amp; edit detected glyphs
          </h2>
          {style && (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Detected style:</span>{" "}
              {style}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="w-44">
            <Select
              value={charset}
              onValueChange={(v) => onCharsetChange(v as Charset)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHARSET_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Progress value={(captured / total) * 100} className="flex-1" />
        <span className="shrink-0 text-sm font-medium text-muted-foreground">
          {captured} / {total} captured
        </span>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Glyph boxes</CardTitle>
          <Button
            variant={addingMode ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setAddingMode((m) => !m);
              setSelectedId(null);
            }}
          >
            <Plus className="h-4 w-4" />
            {addingMode ? "Drawing… (click & drag on image)" : "Add glyph"}
          </Button>
        </CardHeader>
        <CardContent>
          <div
            ref={imgWrapRef}
            onMouseDown={onWrapMouseDown}
            onMouseMove={onWrapMouseMove}
            onMouseUp={onWrapMouseUp}
            onMouseLeave={onWrapMouseUp}
            className={[
              "relative inline-block select-none",
              addingMode ? "cursor-crosshair" : "cursor-default",
            ].join(" ")}
            style={{ lineHeight: 0 }}
          >
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Handwriting sample"
              onLoad={measureImg}
              className="max-h-[60vh] w-auto max-w-full rounded-md"
              draggable={false}
            />
            {/* bbox overlays */}
            {imgSize &&
              boxes.map((b) => {
                const [x0, y0, x1, y1] = b.bbox;
                const left = x0 * imgSize.w;
                const top = y0 * imgSize.h;
                const width = (x1 - x0) * imgSize.w;
                const height = (y1 - y0) * imgSize.h;
                const isSel = b.id === selectedId;
                return (
                  <div
                    key={b.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!addingMode) setSelectedId(b.id);
                    }}
                    className={[
                      "absolute flex cursor-pointer items-start justify-end",
                      "rounded-sm border-2 transition-colors",
                      isSel
                        ? "border-primary bg-primary/20"
                        : "border-primary/70 bg-primary/10 hover:bg-primary/20",
                    ].join(" ")}
                    style={{ left, top, width, height }}
                  >
                    <span className="pointer-events-none absolute left-0 top-0 -translate-y-full rounded-sm bg-primary px-1 text-xs font-medium text-primary-foreground">
                      {b.char || "?"}
                    </span>
                    {isSel && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteBox(b.id);
                        }}
                        className="m-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        aria-label="Delete glyph box"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            {/* live drag rectangle */}
            {dragRect && (
              <div
                className="absolute border-2 border-dashed border-primary bg-primary/20"
                style={{
                  left: dragRect.left,
                  top: dragRect.top,
                  width: dragRect.width,
                  height: dragRect.height,
                }}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* selected box editor */}
      {selectedBox && (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <Label htmlFor="char-edit" className="shrink-0">
              Character
            </Label>
            <Input
              id="char-edit"
              value={selectedBox.char}
              onChange={(e) => updateBoxChar(selectedBox.id, e.target.value)}
              maxLength={1}
              className="w-16 text-center text-lg"
              placeholder="?"
              autoFocus
            />
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteBox(selectedBox.id)}
            >
              <X className="h-4 w-4" />
              Delete
            </Button>
            <div className="ml-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedId(null)}
              >
                <Check className="h-4 w-4" />
                Done
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="flex justify-end">
        <Button onClick={handleConfirm} disabled={confirming || boxes.length === 0}>
          {confirming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Confirm Glyphs
        </Button>
      </div>
    </div>
  );
}
