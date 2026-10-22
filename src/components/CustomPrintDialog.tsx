"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadImageFile, releaseImage, ImageLoadError, type LoadedImage } from "@/lib/image";
import { makeCustomTile } from "@/lib/patterns";
import { IconClose, IconUpload } from "./icons";
import { Button, Switch } from "./ui";

export default function CustomPrintDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (tile: HTMLCanvasElement, name: string) => void }) {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [seamless, setSeamless] = useState(true);
  const [baseColor, setBaseColor] = useState("#f4f1ea");
  const previewRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => releaseImage(image), [image]);

  const tile = useMemo(
    () => (image ? makeCustomTile(image.img, image.width, image.height, { removeBackground, baseColor, seamless }) : null),
    [image, removeBackground, baseColor, seamless],
  );

  useEffect(() => {
    if (!tile) return;
    const t = tile;
    const c = previewRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) {
      // Preview 2×2 repeats so seams are visible.
      ctx.clearRect(0, 0, c.width, c.height);
      for (const [x, y] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        ctx.drawImage(t, (x * c.width) / 2, (y * c.height) / 2, c.width / 2, c.height / 2);
      }
    }
  }, [tile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setImage(await loadImageFile(file));
    } catch (e) {
      setError(e instanceof ImageLoadError ? e.message : "This image couldn't be opened.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 backdrop-blur-[2px] md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add your own print"
        className="rise w-full max-w-md rounded-t-[28px] border border-line bg-paper p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="tag text-muted">Your prints</p>
            <h2 className="mt-1 font-display text-2xl">Add a fabric or print</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-sand">
            <IconClose />
          </button>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="checker relative mt-4 block aspect-square w-full overflow-hidden rounded-2xl border border-line"
        >
          <canvas ref={previewRef} width={512} height={512} className={image ? "h-full w-full" : "hidden"} />
          {!image && (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-paper/80 text-[0.875rem] text-ink-soft">
              <IconUpload />
              Choose an image of the fabric
            </span>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif"
          className="hidden"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {error && (
          <p role="alert" className="mt-2 text-[0.8125rem] text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.875rem] font-medium">Seamless repeat</p>
              <p className="text-[0.75rem] text-muted">Mirrors the image so edges join invisibly.</p>
            </div>
            <Switch label="Seamless repeat" checked={seamless} onChange={setSeamless} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.875rem] font-medium">Remove plain background</p>
              <p className="text-[0.75rem] text-muted">For a motif on plain paper or cloth.</p>
            </div>
            <Switch label="Remove plain background" checked={removeBackground} onChange={setRemoveBackground} />
          </div>
          {removeBackground && (
            <label className="flex items-center justify-between gap-3">
              <span className="text-[0.875rem]">Fabric colour behind motif</span>
              <input type="color" value={baseColor} onChange={(e) => setBaseColor(e.target.value)} className="h-9 w-14 cursor-pointer rounded-lg border border-line bg-paper" />
            </label>
          )}
        </div>

        <Button
          className="mt-5 w-full"
          disabled={!tile}
          onClick={() => {
            if (tile && image) onAdd(tile, image.name.replace(/\.[^.]+$/, "").slice(0, 18) || "My print");
          }}
        >
          Try it on
        </Button>
      </div>
    </div>
  );
}
