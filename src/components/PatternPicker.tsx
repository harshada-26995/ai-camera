"use client";

import { memo, useEffect, useRef } from "react";
import { CATEGORIES, CUSTOM_COLOR_ID, drawSwatch, type PatternCategory, type PatternDef } from "@/lib/patterns";
import { IconPlus } from "./icons";
import { cx } from "./ui";

const Swatch = memo(function Swatch({ def }: { def: PatternDef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawSwatch(def, ref.current, 144);
  }, [def]);
  return <canvas ref={ref} className="h-full w-full" style={{ background: def.base }} aria-hidden="true" />;
});

function SwatchButton({
  def,
  selected,
  onSelect,
  children,
}: {
  def: PatternDef;
  selected: boolean;
  onSelect: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-pattern={def.id}
      className="group flex w-[76px] shrink-0 flex-col items-center gap-1.5 md:w-auto"
    >
      <span
        className={cx(
          "relative block aspect-square w-full overflow-hidden rounded-[14px] transition-[box-shadow,transform] duration-200 group-active:scale-95",
          selected ? "shadow-[0_0_0_2px_var(--color-paper),0_0_0_3.5px_var(--color-ink)]" : "shadow-[0_0_0_1px_var(--color-line)] group-hover:shadow-[0_0_0_1px_var(--color-line-strong)]",
        )}
      >
        <Swatch def={def} />
        {/* soft fabric sheen */}
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(140deg,rgba(255,255,255,0.18),transparent_45%,rgba(0,0,0,0.08))]" />
        {children}
      </span>
      <span className={cx("line-clamp-1 w-full text-center text-[0.6875rem] leading-tight", selected ? "font-semibold text-ink" : "text-ink-soft")}>
        {def.name}
      </span>
    </button>
  );
}

export default function PatternPicker({
  patterns,
  customPatterns,
  category,
  onCategory,
  selectedId,
  customColor,
  onSelect,
  onCustomColor,
  onAddPrint,
  onRemovePrint,
}: {
  patterns: PatternDef[];
  customPatterns: PatternDef[];
  category: PatternCategory;
  onCategory: (c: PatternCategory) => void;
  selectedId: string;
  customColor: string;
  onSelect: (id: string) => void;
  onCustomColor: (hex: string, commit: boolean) => void;
  onAddPrint: () => void;
  onRemovePrint: (id: string) => void;
}) {
  const list = category === "custom" ? customPatterns : patterns.filter((p) => p.category === category);
  const colorInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Commit the colour once the native picker closes (`change` fires on close).
    const el = colorInput.current;
    if (!el) return;
    const onChange = () => onCustomColor(el.value, true);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [onCustomColor, category]);

  return (
    <div className="flex flex-col">
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-3 md:mx-0 md:flex-wrap md:px-0" role="tablist" aria-label="Pattern categories">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={category === c.id}
            onClick={() => onCategory(c.id)}
            className={cx(
              "h-8 shrink-0 rounded-full border px-3.5 text-[0.78rem] font-medium transition-colors",
              category === c.id ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink-soft hover:border-line-strong",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 pt-1 md:mx-0 md:grid md:grid-cols-4 md:gap-x-3 md:gap-y-4 md:overflow-visible md:px-0">
        {list.map((def) => (
          <div key={def.id} className="relative">
            <SwatchButton def={def} selected={selectedId === def.id} onSelect={() => onSelect(def.id)} />
            {category === "custom" && (
              <button
                type="button"
                aria-label={`Remove ${def.name}`}
                onClick={() => onRemovePrint(def.id)}
                className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-paper text-[0.75rem] text-muted shadow-sm hover:text-danger"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {category === "solids" && (
          <label className="group flex w-[76px] shrink-0 cursor-pointer flex-col items-center gap-1.5 md:w-auto" data-pattern={CUSTOM_COLOR_ID}>
            <span
              className={cx(
                "relative block aspect-square w-full overflow-hidden rounded-[14px] transition-shadow",
                selectedId === CUSTOM_COLOR_ID ? "shadow-[0_0_0_2px_var(--color-paper),0_0_0_3.5px_var(--color-ink)]" : "shadow-[0_0_0_1px_var(--color-line)]",
              )}
              style={{ background: `conic-gradient(from 200deg, #b8443a, #d9a441, #5d8a5a, #2f6a8f, #5b4a8a, #b8443a)` }}
            >
              <span className="absolute inset-[22%] rounded-full border-2 border-paper" style={{ background: customColor }} />
            </span>
            <span className={cx("text-[0.6875rem]", selectedId === CUSTOM_COLOR_ID ? "font-semibold" : "text-ink-soft")}>Any colour</span>
            <input
              ref={colorInput}
              type="color"
              value={customColor}
              className="sr-only"
              onClick={() => onSelect(CUSTOM_COLOR_ID)}
              onInput={(e) => onCustomColor((e.target as HTMLInputElement).value, false)}
              onChange={() => undefined}
            />
          </label>
        )}
        {category === "custom" && (
          <button type="button" onClick={onAddPrint} className="group flex w-[76px] shrink-0 flex-col items-center gap-1.5 md:w-auto">
            <span className="flex aspect-square w-full items-center justify-center rounded-[14px] border border-dashed border-line-strong bg-paper text-ink-soft transition-colors group-hover:border-ink group-hover:text-ink">
              <IconPlus />
            </span>
            <span className="text-[0.6875rem] text-ink-soft">Add print</span>
          </button>
        )}
        {category === "custom" && list.length === 0 && (
          <p className="self-center pl-1 text-[0.8125rem] leading-snug text-muted md:col-span-3 md:pl-0">
            Upload a photo of any fabric or print to try it on.
          </p>
        )}
      </div>
    </div>
  );
}
