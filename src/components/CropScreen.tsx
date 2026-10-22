"use client";

import { useEffect, useRef, useState } from "react";
import { ASPECTS, DEFAULT_CROP, clampPan, coverScale, cropAngle, frameAspect, type AspectId, type CropState } from "@/lib/crop";
import type { LoadedImage } from "@/lib/image";
import { IconBack, IconReset, IconRotateLeft, IconRotateRight } from "./icons";
import { Button, IconButton, Slider, TopBar, cx } from "./ui";

const MAX_ZOOM = 5;

export default function CropScreen({
  image,
  initial,
  onBack,
  onDone,
}: {
  image: LoadedImage;
  initial: CropState;
  onBack: () => void;
  onDone: (crop: CropState) => void;
}) {
  const [crop, setCrop] = useState<CropState>(initial);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [interacting, setInteracting] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ crop: CropState; x: number; y: number; dist: number } | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = frameAspect(image.width, image.height, crop);
  const fw = Math.max(1, Math.min(box.w, box.h * aspect));
  const fh = fw / aspect;
  const theta = cropAngle(crop);
  const scale = crop.zoom * coverScale(image.width, image.height, fw, fh, theta);

  /** Normalises zoom/pan so the frame is always fully covered by the photo. */
  const constrain = (c: CropState): CropState => {
    const a = frameAspect(image.width, image.height, c);
    const w = Math.max(1, Math.min(box.w, box.h * a));
    const h = w / a;
    const t = cropAngle(c);
    const zoom = Math.min(Math.max(c.zoom, 1), MAX_ZOOM);
    const s = zoom * coverScale(image.width, image.height, w, h, t);
    const p = clampPan(c.panX * w, c.panY * w, image.width, image.height, w, h, t, s);
    return { ...c, zoom, panX: p.x / w, panY: p.y / w };
  };

  const update = (patch: Partial<CropState>) => setCrop((c) => constrain({ ...c, ...patch }));

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCrop((c) => constrain({ ...c, zoom: c.zoom * Math.exp(-e.deltaY * 0.0015) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const startGesture = () => {
    const pts = [...pointers.current.values()];
    const [a, b] = pts;
    if (!a) {
      gesture.current = null;
      return;
    }
    const mid = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
    gesture.current = { crop, x: mid.x, y: mid.y, dist: b ? Math.hypot(a.x - b.x, a.y - b.y) || 1 : 0 };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    stageRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setInteracting(true);
    startGesture();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const [a, b] = [...pointers.current.values()];
    if (!a) return;
    const mid = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
    const zoom = b && g.dist ? (g.crop.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist : g.crop.zoom;
    setCrop(
      constrain({ ...g.crop, zoom, panX: g.crop.panX + (mid.x - g.x) / fw, panY: g.crop.panY + (mid.y - g.y) / fw }),
    );
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setInteracting(false);
    startGesture();
  };

  const rotate = (dir: 1 | -1) => update({ quarter: (crop.quarter + dir + 4) % 4, panX: 0, panY: 0 });

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        step={1}
        left={
          <IconButton label="Back" onClick={onBack}>
            <IconBack />
          </IconButton>
        }
        right={
          <Button className="h-10 px-5" onClick={() => onDone(crop)}>
            Continue
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-0 flex-1 p-5 md:p-10">
          <div
            ref={stageRef}
            className="relative flex h-full w-full touch-none select-none items-center justify-center"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            style={{ cursor: interacting ? "grabbing" : "grab" }}
          >
            {box.w > 0 && (
              <div className="relative overflow-hidden rounded-[18px] bg-sand shadow-[0_20px_60px_-30px_rgba(40,30,20,0.45)]" style={{ width: fw, height: fh }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL, transformed live */}
                <img
                  src={image.url}
                  alt="Photo being framed"
                  draggable={false}
                  className="pointer-events-none absolute max-w-none"
                  style={{
                    left: fw / 2 - image.width / 2,
                    top: fh / 2 - image.height / 2,
                    width: image.width,
                    height: image.height,
                    transform: `translate(${crop.panX * fw}px, ${crop.panY * fw}px) rotate(${theta}rad) scale(${scale})`,
                  }}
                />
                <div
                  className={cx("pointer-events-none absolute inset-0 transition-opacity duration-300", interacting ? "opacity-100" : "opacity-0")}
                  aria-hidden="true"
                >
                  {[1, 2].map((i) => (
                    <div key={`v${i}`} className="absolute inset-y-0 w-px bg-white/60" style={{ left: `${(i * 100) / 3}%` }} />
                  ))}
                  {[1, 2].map((i) => (
                    <div key={`h${i}`} className="absolute inset-x-0 h-px bg-white/60" style={{ top: `${(i * 100) / 3}%` }} />
                  ))}
                </div>
                <div className="pointer-events-none absolute inset-0 rounded-[18px] ring-1 ring-black/10 ring-inset" />
              </div>
            )}
          </div>
        </div>

        <aside className="shrink-0 border-t border-line bg-paper/70 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 md:w-[360px] md:border-l md:border-t-0 md:px-7 md:pt-8">
          <h2 className="hidden font-display text-2xl md:block">Frame the photo</h2>
          <p className="mb-5 hidden text-[0.875rem] text-muted md:block">Drag to reposition, pinch or scroll to zoom. Keep his whole shirt in view.</p>
          <p className="tag mb-2 text-muted">Shape</p>
          <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {ASPECTS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => update({ aspect: a.id as AspectId, panX: 0, panY: 0 })}
                className={cx(
                  "h-9 shrink-0 rounded-full border px-4 text-[0.8125rem] font-medium transition-colors",
                  crop.aspect === a.id ? "border-ink bg-ink text-paper" : "border-line text-ink-soft hover:border-ink",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3">
            <Slider label="Zoom" value={crop.zoom} min={1} max={MAX_ZOOM} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => update({ zoom: v })} />
            <Slider
              label="Straighten"
              value={crop.straighten}
              min={-15}
              max={15}
              step={0.1}
              format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}°`}
              onChange={(v) => update({ straighten: v })}
            />
          </div>
          <div className="mt-3 flex items-center gap-1">
            <IconButton label="Rotate left" showLabel onClick={() => rotate(-1)}>
              <IconRotateLeft size={18} />
            </IconButton>
            <IconButton label="Rotate right" showLabel onClick={() => rotate(1)}>
              <IconRotateRight size={18} />
            </IconButton>
            <div className="flex-1" />
            <IconButton label="Reset" showLabel onClick={() => setCrop(DEFAULT_CROP)}>
              <IconReset size={18} />
            </IconButton>
          </div>
        </aside>
      </div>
    </div>
  );
}
