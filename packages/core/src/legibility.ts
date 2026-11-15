/**
 * Text size in the headset. Every spatial panel has a fixed scale and viewing
 * distance; uikit lays text out in panel pixels (1 px = 0.01 units, times the
 * panel scale, in metres). The rule we hold ourselves to:
 *
 *   cap height ≥ 0.018 m per metre of viewing distance (about 1.03° of view)
 *
 * at the 100% text setting, for every line of text, so labels are readable from
 * the seat and in a 1080p film frame without zooming. The text-size setting
 * (up to 200%) only makes it bigger.
 */

/** uikit's default: one layout pixel is 0.01 units before the panel's own scale. */
export const UIKIT_PIXEL = 0.01;
/** Lexend and PT Mono both have a cap height of 700/1000 em. */
export const CAP_RATIO = 0.7;
/** Minimum cap height, in metres, per metre of viewing distance. */
export const MIN_CAP_PER_METRE = 0.018;

export interface PanelLayout {
  /** Panel scale (metres per 0.01 layout units). */
  scale: number;
  /** Viewing distance from the head, metres. */
  dist: number;
  /** Height relative to the head, metres (negative = below the eyes). */
  height: number;
}

/** Where each panel sits. The app places panels from these numbers. */
export const PANELS = {
  /** Count, way to play, captions, transcript: follows the head, low in the view. */
  hud: { scale: 0.1, dist: 0.85, height: -0.27 },
  /** Hint and Pause, at the bottom of the view. */
  tabs: { scale: 0.1, dist: 0.75, height: -0.42 },
  /** Start and round cards, world-locked in front of you. */
  card: { scale: 0.12, dist: 1.1, height: 0.14 },
  /** The pause menu with every setting. */
  menu: { scale: 0.11, dist: 0.85, height: -0.08 },
} as const satisfies Record<string, PanelLayout>;

export type PanelName = keyof typeof PANELS;

/** Cap height in metres per metre of viewing distance for a font size in layout px. */
export function capPerMetre(fontPx: number, panel: PanelLayout, textScale = 1): number {
  const em = fontPx * UIKIT_PIXEL * panel.scale * textScale;
  return (em * CAP_RATIO) / panel.dist;
}

/** The smallest font size (layout px) that meets the rule on this panel. */
export function minFontPx(panel: PanelLayout): number {
  return Math.ceil((MIN_CAP_PER_METRE * panel.dist) / (UIKIT_PIXEL * panel.scale * CAP_RATIO));
}

/** Angular width in degrees of something `metres` wide seen from `dist`. */
export function angularDeg(metres: number, dist: number): number {
  return (2 * Math.atan2(metres / 2, dist) * 180) / Math.PI;
}
