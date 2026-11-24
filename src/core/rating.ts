import {
  D,
  DELTA_CAP,
  D_REF,
  H,
  H_MAX_MISSING,
  K_PROV,
  K_SETTLED,
  M_MAX,
  M_MIN,
  N_PROV,
} from "./constants.js";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * How many players are actually on court for a side.
 *
 * Derived, never stored. This one expression handles both real cases without a
 * branch: a side of seven has six on court (the seventh rotates), and a side of
 * five has five.
 */
export const onCourt = (sideSize: number, playersOnCourt: number): number =>
  Math.min(playersOnCourt, sideSize);

/** How many court players this side is short of the other side. */
export const missingPlayers = (ownOnCourt: number, otherOnCourt: number): number =>
  Math.max(0, Math.min(6, otherOnCourt) - Math.min(6, ownOnCourt));

/**
 * Effective strength of a side.
 *
 * NOTE THE SIGN: being short-handed SUBTRACTS strength. The research's written
 * formula added it, which would have made a five-a-side the favourite (#6).
 * The same constant drives the balancer, where a short side needs a mean that
 * much higher to make an even match. One constant, one meaning, two uses.
 */
export const effectiveStrength = (meanRating: number, missing: number): number =>
  meanRating - H * Math.min(missing, H_MAX_MISSING);

export const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Expected score for the side with `ownStrength`. */
export const expectedScore = (ownStrength: number, otherStrength: number): number =>
  1 / (1 + Math.pow(10, (otherStrength - ownStrength) / D));

/**
 * Margin multiplier from a set's point differential.
 *
 * Saturates by construction over a volleyball set's real range: a differential
 * of 2 lands exactly on the floor of 0.5, and 25 gives 1.483, inside the
 * ceiling. So no clamp discontinuity ever occurs in practice.
 */
export const marginMultiplier = (pointDifferential: number): number =>
  clamp(Math.log(1 + Math.abs(pointDifferential)) / Math.log(1 + D_REF), M_MIN, M_MAX);

/** A smooth ramp from K_PROV to K_SETTLED over N_PROV sets. No cliff. */
export const kFactor = (setsPlayedBefore: number): number =>
  K_SETTLED + (K_PROV - K_SETTLED) * Math.max(0, (N_PROV - setsPlayedBefore) / N_PROV);

/** The per-player rating change for one set. */
export const ratingDelta = (args: {
  setsPlayedBefore: number;
  marginMultiplier: number;
  /** 1 if this player's side won the set, 0 if it lost. */
  actualScore: 0 | 1;
  expectedScore: number;
}): number =>
  clamp(
    kFactor(args.setsPlayedBefore) * args.marginMultiplier * (args.actualScore - args.expectedScore),
    -DELTA_CAP,
    DELTA_CAP,
  );
