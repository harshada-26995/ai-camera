"use client";

/**
 * Zoom/pan surface for a fixed-size image. One finger draws (in "draw" mode)
 * or pans; two fingers always pinch-zoom and pan; the mouse wheel zooms.
 * Children render at content size, scaled to fit.
 */
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";

export interface ViewportHandle {
  zoomIn(): void;
  zoomOut(): void;
  reset(): void;
}

export type DrawPhase = "start" | "move" | "end" | "cancel";

export interface DrawEvent {
  phase: DrawPhase;
  x: number;
  y: number;
  /** Screen pixels per content pixel at the current zoom. */
  screenScale: number;
}

interface View {
  z: number;
  tx: number;
  ty: number;
}

const MAX_ZOOM = 8;

export default function Viewport({
  width,
  height,
  mode,
  onDraw,
  onHover,
  onZoomChange,
  children,
  overlay,
  ref,
  className,
}: {
  width: number;
  height: number;
  mode: "pan" | "draw";
  onDraw?: (e: DrawEvent) => void;
  onHover?: (p: { x: number; y: number; screenScale: number } | null) => void;
  onZoomChange?: (z: number) => void;
  children: ReactNode;
  overlay?: ReactNode;
  ref?: Ref<ViewportHandle>;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ z: 1, tx: 0, ty: 0 });
  // Source of truth for gesture math; `view` mirrors it for rendering.
  const viewRef = useRef(view);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "draw" }
    | { kind: "pan"; startX: number; startY: number; view: View }
    | { kind: "pinch"; dist: number; midX: number; midY: number; view: View }
    | null
  >(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Measure before first paint so input works immediately; the observer handles later resizes.
    const r = el.getBoundingClientRect();
    setBox({ w: r.width, h: r.height });
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setBox({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = box.w && box.h ? Math.min(box.w / width, box.h / height) : 0;
  const fw = width * fit;
  const fh = height * fit;
  const left = (box.w - fw) / 2;
  const top = (box.h - fh) / 2;

  const clamp = useCallback(
    (v: View): View => {
      const z = Math.min(Math.max(v.z, 1), MAX_ZOOM);
      const zw = fw * z;
      const zh = fh * z;
      const tx = zw <= box.w ? (box.w - zw) / 2 - left : Math.min(Math.max(v.tx, box.w - zw - left), -left);
      const ty = zh <= box.h ? (box.h - zh) / 2 - top : Math.min(Math.max(v.ty, box.h - zh - top), -top);
      return { z, tx, ty };
    },
    [box.w, box.h, fw, fh, left, top],
  );

  const apply = useCallback(
    (v: View) => {
      const next = clamp(v);
      viewRef.current = next;
      setView(next);
      onZoomChange?.(next.z);
    },
    [clamp, onZoomChange],
  );

  /** Zoom keeping the container point (px, py) fixed. */
  const zoomAt = useCallback(
    (factor: number, px: number, py: number, base: View = viewRef.current) => {
      const z = Math.min(Math.max(base.z * factor, 1), MAX_ZOOM);
      const ux = (px - left - base.tx) / base.z;
      const uy = (py - top - base.ty) / base.z;
      apply({ z, tx: px - left - z * ux, ty: py - top - z * uy });
    },
    [apply, left, top],
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomAt(1.5, box.w / 2, box.h / 2),
      zoomOut: () => zoomAt(1 / 1.5, box.w / 2, box.h / 2),
      reset: () => apply({ z: 1, tx: 0, ty: 0 }),
    }),
    [zoomAt, apply, box.w, box.h],
  );

  // Re-clamp when the layout changes (rotation, panel resize).
  useEffect(() => {
    apply(viewRef.current);
  }, [apply]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const toContent = (clientX: number, clientY: number) => {
    const r = containerRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    if (!r || !fit) return { x: 0, y: 0, screenScale: 1 };
    const ux = (clientX - r.left - left - v.tx) / v.z;
    const uy = (clientY - r.top - top - v.ty) / v.z;
    return { x: ux / fit, y: uy / fit, screenScale: fit * v.z };
  };

  const local = (e: React.PointerEvent) => {
    const r = containerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.button !== 0 && e.pointerType === "mouse") || !fit) return;
    containerRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      if (gesture.current?.kind === "draw") {
        const p = toContent(e.clientX, e.clientY);
        onDraw?.({ phase: "cancel", ...p });
      }
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = {
        kind: "pinch",
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        view: viewRef.current,
      };
    } else if (pts.length === 1) {
      if (mode === "draw" && onDraw) {
        gesture.current = { kind: "draw" };
        onDraw({ phase: "start", ...toContent(e.clientX, e.clientY) });
      } else {
        const p = pts[0] as { x: number; y: number };
        gesture.current = { kind: "pan", startX: p.x, startY: p.y, view: viewRef.current };
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) {
      if (mode === "draw" && e.pointerType === "mouse") onHover?.(toContent(e.clientX, e.clientY));
      return;
    }
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "draw") {
      const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
      for (const ce of events.length ? events : [e.nativeEvent]) onDraw?.({ phase: "move", ...toContent(ce.clientX, ce.clientY) });
      if (e.pointerType === "mouse") onHover?.(toContent(e.clientX, e.clientY));
    } else if (g.kind === "pan") {
      const p = local(e);
      apply({ z: g.view.z, tx: g.view.tx + p.x - g.startX, ty: g.view.ty + p.y - g.startY });
    } else {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const z = Math.min(Math.max((g.view.z * dist) / g.dist, 1), MAX_ZOOM);
      const ux = (g.midX - left - g.view.tx) / g.view.z;
      const uy = (g.midY - top - g.view.ty) / g.view.z;
      apply({ z, tx: midX - left - z * ux, ty: midY - top - z * uy });
    }
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === "draw") {
      onDraw?.({ phase: e.type === "pointercancel" ? "cancel" : "end", ...toContent(e.clientX, e.clientY) });
      gesture.current = null;
    } else if (pointers.current.size === 1 && g?.kind === "pinch") {
      // Continue as a pan with the remaining finger (never resume drawing mid-gesture).
      const p = [...pointers.current.values()][0] as { x: number; y: number };
      gesture.current = { kind: "pan", startX: p.x, startY: p.y, view: viewRef.current };
    } else if (pointers.current.size === 0) {
      gesture.current = null;
    }
  };

  return (
    <div
      ref={containerRef}
      className={"relative h-full w-full touch-none select-none overflow-hidden " + (className ?? "")}
      style={{ cursor: mode === "draw" ? "none" : view.z > 1 ? "grab" : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerLeave={() => onHover?.(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Always mounted so children's refs exist on their first effect; hidden until measured. */}
      <div
        className="absolute origin-top-left"
        style={{
          left,
          top,
          width: fw,
          height: fh,
          visibility: fit > 0 ? "visible" : "hidden",
          transform: `translate3d(${view.tx}px, ${view.ty}px, 0) scale(${view.z})`,
        }}
      >
        {children}
        {overlay}
      </div>
    </div>
  );
}
