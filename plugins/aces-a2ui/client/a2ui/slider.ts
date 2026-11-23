/**
 * Pure slider math for the hand-rolled Slider widget — plugins cannot ship
 * native modules, so there is no @react-native-community/slider here. Mirrors
 * web_core's Slider: `steps` is the number of steps across the range (the HTML
 * input's step size is (max-min)/steps) and the value is a number, not an
 * integer.
 */

/** Track fraction (0–1) for `value` clamped into [min, max]; 0 for a flat range. */
export function sliderFraction(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  const clamped = Math.min(Math.max(value, min), max);
  return (clamped - min) / (max - min);
}

/** Clamps `value` into [min, max], snapping to the step grid when `steps` is set. */
export function snapSliderValue(value: number, min: number, max: number, steps?: number): number {
  const clamped = Math.min(Math.max(value, min), max);
  if (steps === undefined || !Number.isFinite(steps) || steps <= 0 || max <= min) return clamped;
  const stepSize = (max - min) / steps;
  return Math.min(max, Math.max(min, min + Math.round((clamped - min) / stepSize) * stepSize));
}
