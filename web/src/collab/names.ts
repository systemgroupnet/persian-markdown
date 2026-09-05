/**
 * Remote cursor colour (PLAN.md §5.5): "Chrome is 100% grayscale; the *only*
 * colour in the app is remote cursors." That single-purpose budget is why
 * this file exists at all rather than folding into a general theme module.
 *
 * The server assigns each name a hue in `internal/names` (`fnv32(name) % 360`)
 * and puts it on the wire as `UserInfo.hue`; there is nothing to compute
 * server-side here. This module only turns that hue into a colour that reads
 * clearly on both a near-white and a near-black background, since the app
 * never knows which theme a given remote viewer is using.
 *
 * OKLCH keeps lightness perceptually consistent across hues — unlike HSL,
 * where e.g. yellow at L=70% reads far lighter than blue at the same L. A
 * fixed mid lightness with moderate chroma is legible against both themes
 * without needing a separate light/dark variant computed here; callers that
 * do want to shift it for a specific surface (e.g. a lower-alpha selection
 * highlight vs. a solid caret) use `withAlpha`.
 */

const HUE_MODULUS = 360;

function normalizeHue(hue: number): number {
  const h = hue % HUE_MODULUS;
  return h < 0 ? h + HUE_MODULUS : h;
}

/** Solid colour for a peer's caret / name tag, from their assigned hue. */
export function cursorColor(hue: number): string {
  return `oklch(0.7 0.16 ${normalizeHue(hue)})`;
}

/** Lower-opacity variant for a selection highlight, same hue. */
export function selectionColor(hue: number, alpha = 0.25): string {
  return `oklch(0.7 0.16 ${normalizeHue(hue)} / ${alpha})`;
}
