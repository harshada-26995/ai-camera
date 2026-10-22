"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  variant = "primary",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[0.9375rem] font-medium transition-[background,color,border,opacity] duration-200 disabled:opacity-40",
        variant === "primary" && "bg-ink text-paper hover:bg-ink-soft",
        variant === "secondary" && "border border-line-strong bg-paper text-ink hover:border-ink",
        variant === "ghost" && "text-ink hover:bg-sand",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  showLabel,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; showLabel?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-ink transition-colors duration-150 disabled:opacity-30",
        active ? "bg-ink text-paper" : "hover:bg-sand",
        className,
      )}
      {...rest}
    >
      {children}
      {showLabel && <span className="text-[0.8125rem] font-medium">{label}</span>}
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  format,
  onChange,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  onCommit?: () => void;
  disabled?: boolean;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className={cx("block", disabled && "opacity-40")}>
      <span className="flex items-baseline justify-between">
        <span className="text-[0.8125rem] text-ink-soft">{label}</span>
        <span className="font-mono text-[0.75rem] tabular-nums text-muted">{format ? format(value) : value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ["--fill" as string]: `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onTouchEnd={onCommit}
        onBlur={onCommit}
      />
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  label,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-line bg-paper p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-full font-medium transition-colors duration-150",
            size === "sm" ? "h-8 px-3 text-[0.75rem]" : "h-9 px-4 text-[0.8125rem]",
            o.value === value ? "bg-ink text-paper" : "text-ink-soft hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-200",
        checked ? "border-ink bg-ink" : "border-line-strong bg-sand",
      )}
    >
      <span
        className={cx(
          "inline-block h-5 w-5 rounded-full bg-paper shadow transition-transform duration-200",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const STEPS = ["Photo", "Frame", "Shirt", "Studio"] as const;

export function StepMark({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-3" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className={cx("tag flex items-center gap-1.5", i === current ? "text-ink" : "text-muted/70")} aria-current={i === current ? "step" : undefined}>
          <span className="font-display text-[0.8rem] normal-case tracking-normal">{String(i + 1).padStart(2, "0")}</span>
          <span className="hidden sm:inline">{s}</span>
        </li>
      ))}
    </ol>
  );
}

export function TopBar({ left, right, step }: { left?: ReactNode; right?: ReactNode; step: number }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-3 pt-[env(safe-area-inset-top)] sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-1">{left}</div>
      <div className="flex shrink-0 flex-col items-center leading-none">
        <span className="font-display text-[1.35rem] italic tracking-tight">Drape</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        <div className="mr-2 hidden md:block">
          <StepMark current={step} />
        </div>
        {right}
      </div>
    </header>
  );
}
