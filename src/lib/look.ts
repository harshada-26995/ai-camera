/** The user-adjustable try-on "look": which pattern and how it sits on the shirt. */
export interface LookSettings {
  patternId: string;
  /** Custom solid colour (hex) when patternId === "custom-color". */
  customColor: string;
  /** Multiplier on the pattern's natural size. */
  scale: number;
  /** Degrees. */
  rotation: number;
  /** Pattern offset in tile units (-0.5..0.5). */
  offsetX: number;
  offsetY: number;
  /** 0..1 how strongly the new pattern replaces the old shirt. */
  intensity: number;
  /** -1..1 (exposure stops). */
  brightness: number;
  /** 0..2 */
  saturation: number;
  /** Degrees. */
  hue: number;
  /** 0..1 how much of the original folds/shadows show through ("texture blending"). */
  shading: number;
  /** 0..1 fine fabric detail vs. only large folds. */
  detail: number;
  /** 0..1 how much the pattern bends with the folds. */
  warp: number;
}

export const DEFAULT_LOOK: LookSettings = {
  patternId: "solid-navy",
  customColor: "#2f4a6d",
  scale: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  intensity: 1,
  brightness: 0,
  saturation: 1,
  hue: 0,
  shading: 0.85,
  detail: 0.55,
  warp: 0.35,
};

/** Adjustment fields that "Reset pattern" restores (pattern choice is kept). */
export function resetAdjustments(look: LookSettings): LookSettings {
  return { ...DEFAULT_LOOK, patternId: look.patternId, customColor: look.customColor };
}

export function sameLook(a: LookSettings, b: LookSettings): boolean {
  return (Object.keys(a) as (keyof LookSettings)[]).every((k) => a[k] === b[k]);
}
