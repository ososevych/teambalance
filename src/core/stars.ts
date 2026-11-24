import { DEMOTION_LAG, HYSTERESIS, STAR_THRESHOLDS } from "./constants.js";

export const MIN_STARS = 1;
export const MAX_STARS = STAR_THRESHOLDS.length + 1;

/** The band a rating falls in, ignoring hysteresis and the demotion lag. */
export const bandOf = (rating: number): number =>
  MIN_STARS + STAR_THRESHOLDS.filter((t) => rating >= t).length;

/** The lower bound of a band. Band 1 has none. */
const lowerBoundOf = (stars: number): number =>
  stars <= MIN_STARS ? Number.NEGATIVE_INFINITY : (STAR_THRESHOLDS[stars - 2] as number);

export interface BandState {
  stars: number;
  demotionPending: number;
}

/**
 * Evaluate one player's band at a session boundary.
 *
 * This is deliberately STATEFUL, and that is the whole point: `demotionPending`
 * carries across session boundaries, so a band cannot be derived from a final
 * rating alone. Computing stars from the end rating produces a different and
 * wrong answer for anyone who dipped and recovered — the trap flagged in #7
 * and ADR 0002.
 *
 * Promotion can jump more than one band in a single evaluation; demotion only
 * ever steps down one, which is gentler and cannot happen twice in a row
 * without two further qualifying sessions.
 */
export function evaluateBand(rating: number, state: BandState): BandState {
  let { stars } = state;

  // Promotion: must clear the next threshold by the hysteresis margin.
  let promoted = false;
  while (stars < MAX_STARS && rating >= lowerBoundOf(stars + 1) + HYSTERESIS) {
    stars += 1;
    promoted = true;
  }
  if (promoted) return { stars, demotionPending: 0 };

  // Demotion: must fall below this band's own floor by the hysteresis margin,
  // and must have done so at DEMOTION_LAG + 1 consecutive evaluations.
  const qualifies = stars > MIN_STARS && rating <= lowerBoundOf(stars) - HYSTERESIS;
  if (!qualifies) return { stars, demotionPending: 0 };

  const pending = state.demotionPending + 1;
  if (pending > DEMOTION_LAG) return { stars: stars - 1, demotionPending: 0 };
  return { stars, demotionPending: pending };
}

/** Display helper. Players see this and never a number. */
export const starString = (stars: number): string =>
  "★".repeat(stars) + "☆".repeat(MAX_STARS - stars);
