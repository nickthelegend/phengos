/**
 * Audio-first finding. Each light hums from where it is. Pitch encodes height
 * (low at the floor, high at the ceiling, on a pentatonic scale so many hums
 * stay calm together) and the pulse speeds up as you aim closer.
 */
/** G major pentatonic from G3 to G5. */
export const HUM_SCALE_HZ = [196.0, 220.0, 246.94, 293.66, 329.63, 392.0, 440.0, 493.88, 587.33, 659.25, 783.99];

export function humPitch(heightNorm: number): number {
  const h = Math.min(1, Math.max(0, heightNorm));
  const i = Math.round(h * (HUM_SCALE_HZ.length - 1));
  return HUM_SCALE_HZ[i]!;
}

export const PULSE_SLOW_HZ = 0.8;
export const PULSE_FAST_HZ = 6;

/**
 * Pulse rate from the angle between where you aim and the light: slow beyond
 * 60 degrees, fast within 3 degrees, smooth in between.
 */
export function humPulseHz(aimAngleDeg: number): number {
  const a = Math.min(60, Math.max(3, aimAngleDeg));
  const t = 1 - (a - 3) / 57;
  return PULSE_SLOW_HZ + (PULSE_FAST_HZ - PULSE_SLOW_HZ) * t * t;
}
