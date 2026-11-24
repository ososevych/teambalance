/**
 * Every constant in the rating rule and the balancer, fixed by #6 and #8.
 *
 * Sourced vs judgement is recorded in #6's resolution comment. The only number
 * here with real money riding on it is H: it rests on the organizer's estimate
 * that a side of five beats an equal six about 40–45% of the time, and research
 * (#3) found no prior art to check it against. H = 60 implies 41.4%.
 */

/** Elo divisor. */
export const D = 400;

/** K-factor at zero sets played, and once settled. */
export const K_PROV = 60;
export const K_SETTLED = 24;

/** Sets played before K reaches K_SETTLED. Ramps smoothly: no boundary cliff. */
export const N_PROV = 12;

/** Margin reference: a set won by this margin scores a multiplier of exactly 1. */
export const D_REF = 8;

export const M_MIN = 0.5;
export const M_MAX = 1.5;

/** Effective-strength cost per missing court player, capped at two missing. */
export const H = 60;
export const H_MAX_MISSING = 2;

/** Largest rating move one set can make for one player. Exists so that the
 *  worst single move stays at half a star band's width. */
export const DELTA_CAP = 50;

/** Lower bounds of star bands 2..5. Band 1 is everything below the first. */
export const STAR_THRESHOLDS = [1275, 1425, 1575, 1725] as const;

/** Rating must clear a threshold by this much to promote, or fall this far
 *  below to qualify for demotion. */
export const HYSTERESIS = 25;

/** Consecutive closed sessions a player must qualify for demotion before the
 *  band actually drops. 1 = they keep the star through one further evaluation. */
export const DEMOTION_LAG = 1;

/** Seed rating per hand-assigned star, at the centre of each band (#9). These
 *  average to 1500, so a symmetric assignment lands the pool there by itself. */
export const SEED_BY_STARS = [1200, 1350, 1500, 1650, 1800] as const;

/** Balancer: weight on the rank-pairing term relative to the mean difference. */
export const RANK_WEIGHT = 0.5;

/** Balancer: splits within this many points of the best cost are treated as
 *  equally fair, and the variety tiebreak chooses among them. Deliberately
 *  smaller than one set's typical rating movement. */
export const TOLERANCE = 15;

/** Balancer: how many past sessions the repeat-teammate penalty looks back,
 *  and the weight per session by recency (most recent first). */
export const REPEAT_WEIGHTS = [3, 2, 1] as const;

/** Rebalance: players who must change side versus the current lineup. Two is
 *  one pair swapped — the smallest change that is a real change. */
export const MIN_HAMMING = 2;
