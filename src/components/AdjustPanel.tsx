"use client";

import { useState } from "react";
import type { LookSettings } from "@/lib/look";
import { IconMove, IconReset } from "./icons";
import { Segmented, Slider, cx } from "./ui";

type Tab = "fit" | "colour" | "fabric";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number, unit = "") => `${v > 0 ? "+" : ""}${Math.round(v)}${unit}`;

export default function AdjustPanel({
  look,
  onChange,
  onCommit,
  onReset,
  moveMode,
  onMoveMode,
  isSolid,
}: {
  look: LookSettings;
  onChange: (patch: Partial<LookSettings>) => void;
  onCommit: () => void;
  onReset: () => void;
  moveMode: boolean;
  onMoveMode: (v: boolean) => void;
  isSolid: boolean;
}) {
  const [tab, setTab] = useState<Tab>("fit");
  const orientation = ((Math.round(look.rotation) % 180) + 180) % 180;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Segmented<Tab>
          label="Adjustment group"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "fit", label: "Pattern" },
            { value: "colour", label: "Colour" },
            { value: "fabric", label: "Fabric" },
          ]}
        />
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.75rem] font-medium text-ink-soft hover:bg-sand"
        >
          <IconReset size={14} /> Reset
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-1">
        {tab === "fit" && (
          <>
            <Slider
              label="Scale"
              value={look.scale}
              min={0.25}
              max={3}
              disabled={isSolid}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(v) => onChange({ scale: v })}
              onCommit={onCommit}
            />
            <Slider
              label="Rotation"
              value={look.rotation}
              min={-90}
              max={90}
              step={1}
              disabled={isSolid}
              format={(v) => signed(v, "°")}
              onChange={(v) => onChange({ rotation: v })}
              onCommit={onCommit}
            />
            <div className={cx("flex items-center justify-between gap-2 sm:col-span-2 md:col-span-1", isSolid && "opacity-40")}>
              <span className="text-[0.8125rem] text-ink-soft">Orientation</span>
              <Segmented<string>
                label="Orientation"
                size="sm"
                value={orientation === 0 ? "v" : orientation === 90 ? "h" : orientation === 45 ? "d" : "custom"}
                onChange={(v) => {
                  if (isSolid) return;
                  onChange({ rotation: v === "v" ? 0 : v === "h" ? 90 : 45 });
                  onCommit();
                }}
                options={[
                  { value: "v", label: "Vertical" },
                  { value: "h", label: "Horizontal" },
                  { value: "d", label: "Bias" },
                ]}
              />
            </div>
            <Slider
              label="Position — across"
              value={look.offsetX}
              min={-0.5}
              max={0.5}
              disabled={isSolid}
              format={(v) => signed(v * 100, "%")}
              onChange={(v) => onChange({ offsetX: v })}
              onCommit={onCommit}
            />
            <Slider
              label="Position — down"
              value={look.offsetY}
              min={-0.5}
              max={0.5}
              disabled={isSolid}
              format={(v) => signed(v * 100, "%")}
              onChange={(v) => onChange({ offsetY: v })}
              onCommit={onCommit}
            />
            <button
              type="button"
              disabled={isSolid}
              aria-pressed={moveMode}
              onClick={() => onMoveMode(!moveMode)}
              className={cx(
                "inline-flex h-10 items-center justify-center gap-2 rounded-full border text-[0.8125rem] font-medium transition-colors disabled:opacity-40 sm:col-span-2 md:col-span-1",
                moveMode ? "border-ink bg-ink text-paper" : "border-line-strong text-ink hover:border-ink",
              )}
            >
              <IconMove size={16} /> {moveMode ? "Drag on photo to move — tap to finish" : "Drag pattern on photo"}
            </button>
          </>
        )}
        {tab === "colour" && (
          <>
            <Slider label="Hue" value={look.hue} min={-180} max={180} step={1} format={(v) => signed(v, "°")} onChange={(v) => onChange({ hue: v })} onCommit={onCommit} />
            <Slider label="Saturation" value={look.saturation} min={0} max={2} format={pct} onChange={(v) => onChange({ saturation: v })} onCommit={onCommit} />
            <Slider
              label="Brightness"
              value={look.brightness}
              min={-1}
              max={1}
              format={(v) => signed(v * 100, "%")}
              onChange={(v) => onChange({ brightness: v })}
              onCommit={onCommit}
            />
          </>
        )}
        {tab === "fabric" && (
          <>
            <Slider label="Pattern strength" value={look.intensity} min={0} max={1} format={pct} onChange={(v) => onChange({ intensity: v })} onCommit={onCommit} />
            <Slider label="Folds & shadows" value={look.shading} min={0} max={1} format={pct} onChange={(v) => onChange({ shading: v })} onCommit={onCommit} />
            <Slider
              label="Fabric detail"
              value={look.detail}
              min={0}
              max={1}
              format={pct}
              onChange={(v) => onChange({ detail: v })}
              onCommit={onCommit}
            />
            <Slider
              label="Follow contours"
              value={look.warp}
              min={0}
              max={1}
              disabled={isSolid}
              format={pct}
              onChange={(v) => onChange({ warp: v })}
              onCommit={onCommit}
            />
            <p className="text-[0.75rem] leading-snug text-muted sm:col-span-2 md:col-span-1">
              If his original shirt had a print that shows through, lower Fabric detail.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
