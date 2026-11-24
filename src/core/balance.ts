import {
  MIN_HAMMING,
  RANK_WEIGHT,
  REPEAT_WEIGHTS,
  TOLERANCE,
} from "./constants.js";
import { effectiveStrength, mean, missingPlayers, onCourt } from "./rating.js";
import type { Lineup, PlayerId, Session, Standings } from "./types.js";

export interface Candidate {
  sideA: PlayerId[];
  sideB: PlayerId[];
  /** Mean difference plus the weighted rank-pairing term. Lower is fairer. */
  balanceCost: number;
  /** Weighted count of pairs who were already teammates recently. */
  repeatPenalty: number;
}

export interface Pin {
  kind: "together" | "apart";
  a: PlayerId;
  b: PlayerId;
}

export interface GenerateArgs {
  attendees: PlayerId[];
  standings: Standings;
  playersOnCourt: number;
  /** Closed sessions, oldest first. Only the last few are consulted. */
  pastSessions?: Session[];
  /** Pins are hard filters. Specified in #8; no v1 UI (#9). */
  pins?: Pin[];
  /** Set when rebalancing: the split to differ from. */
  currentLineup?: Pick<Lineup, "sideA"> | undefined;
}

export interface GenerateResult {
  /** Equally-fair splits, best first by (repeatPenalty, balanceCost). */
  shortlist: Candidate[];
  /** Pins dropped to produce any candidate at all. Empty in the normal case. */
  relaxedPins: Pin[];
}

const ratingOf = (standings: Standings, id: PlayerId): number => {
  const s = standings.get(id);
  if (!s) throw new Error(`balance: unknown player "${id}"`);
  return s.rating;
};

/**
 * Rank-pairing difference: sort both sides descending and compare best against
 * best, second against second.
 *
 * This is the term that separates "equal averages" from "even match". Six
 * average players and the-two-best-plus-four-weakest score identically on the
 * mean and very differently here, and in volleyball the second is the worse
 * match because a dominant hitter decides whole rotations.
 *
 * For uneven sides the surplus player is excluded from this comparison only —
 * they still count in full towards the mean, because they rotate and therefore
 * play, but only six are ever on court.
 */
export function rankGap(a: number[], b: number[]): number {
  const sa = [...a].sort((x, y) => y - x);
  const sb = [...b].sort((x, y) => y - x);
  const k = Math.min(sa.length, sb.length);
  let total = 0;
  for (let i = 0; i < k; i += 1) total += Math.abs((sa[i] as number) - (sb[i] as number));
  return total / k;
}

export function balanceCost(
  sideA: PlayerId[],
  sideB: PlayerId[],
  standings: Standings,
  playersOnCourt: number,
): number {
  const ra = sideA.map((id) => ratingOf(standings, id));
  const rb = sideB.map((id) => ratingOf(standings, id));
  const aOnCourt = onCourt(sideA.length, playersOnCourt);
  const bOnCourt = onCourt(sideB.length, playersOnCourt);
  const sa = effectiveStrength(mean(ra), missingPlayers(aOnCourt, bOnCourt));
  const sb = effectiveStrength(mean(rb), missingPlayers(bOnCourt, aOnCourt));
  return Math.abs(sa - sb) + RANK_WEIGHT * rankGap(ra, rb);
}

const pairKey = (x: PlayerId, y: PlayerId): string => (x < y ? `${x}|${y}` : `${y}|${x}`);

/**
 * Weighted map of pairs who have recently been teammates.
 *
 * A pair counts once per session however many sets they played together, so a
 * long lineup does not dominate the penalty.
 */
export function recentTeammates(pastSessions: Session[]): Map<string, number> {
  const weights = new Map<string, number>();
  const recent = pastSessions.slice(-REPEAT_WEIGHTS.length).reverse();
  recent.forEach((session, index) => {
    const weight = REPEAT_WEIGHTS[index] ?? 0;
    const seen = new Set<string>();
    for (const set of session.sets) {
      for (const side of [set.sideA.players, set.sideB.players]) {
        for (let i = 0; i < side.length; i += 1) {
          for (let j = i + 1; j < side.length; j += 1) {
            seen.add(pairKey(side[i] as PlayerId, side[j] as PlayerId));
          }
        }
      }
    }
    for (const key of seen) weights.set(key, (weights.get(key) ?? 0) + weight);
  });
  return weights;
}

const repeatPenaltyOf = (side: PlayerId[], weights: Map<string, number>): number => {
  let total = 0;
  for (let i = 0; i < side.length; i += 1) {
    for (let j = i + 1; j < side.length; j += 1) {
      total += weights.get(pairKey(side[i] as PlayerId, side[j] as PlayerId)) ?? 0;
    }
  }
  return total;
};

/**
 * Every distinct way to split the attendees into two sides.
 *
 * The larger side takes the extra player when the count is odd — they rotate.
 * For an odd count the two sides differ in size, so each partition appears
 * exactly once. For an even count it would appear twice with the labels
 * swapped, so the first attendee is pinned to side A to deduplicate.
 */
export function enumerateSplits(attendees: PlayerId[]): Array<{ sideA: PlayerId[]; sideB: PlayerId[] }> {
  const n = attendees.length;
  const sizeA = Math.ceil(n / 2);
  const even = n % 2 === 0;
  const out: Array<{ sideA: PlayerId[]; sideB: PlayerId[] }> = [];
  const picked: PlayerId[] = [];

  const recurse = (index: number): void => {
    if (picked.length === sizeA) {
      const sideA = [...picked];
      out.push({ sideA, sideB: attendees.filter((id) => !sideA.includes(id)) });
      return;
    }
    if (index >= n) return;
    const remaining = n - index;
    if (remaining < sizeA - picked.length) return;

    picked.push(attendees[index] as PlayerId);
    recurse(index + 1);
    picked.pop();

    // Skipping attendee 0 is only legal when the sides differ in size.
    if (!(even && index === 0)) recurse(index + 1);
  };

  recurse(0);
  return out;
}

const hamming = (sideA: PlayerId[], otherA: PlayerId[], attendees: PlayerId[]): number =>
  attendees.filter((id) => sideA.includes(id) !== otherA.includes(id)).length;

const satisfiesPins = (sideA: PlayerId[], pins: Pin[]): boolean =>
  pins.every((pin) => {
    const sameSide = sideA.includes(pin.a) === sideA.includes(pin.b);
    return pin.kind === "together" ? sameSide : !sameSide;
  });

/**
 * Generate the shortlist of equally-fair splits.
 *
 * Balance is the primary objective; variety is a TOLERANCE BAND rather than a
 * weighted term, so it can never trade away real balance. Everything within
 * TOLERANCE of the best cost is treated as equivalent — that margin is smaller
 * than a single set's typical rating movement, so it is beneath the resolution
 * of the ratings themselves — and the fewest-repeat-teammates option wins.
 *
 * Fully deterministic: same inputs always give the same answer, so a split can
 * always be explained.
 */
export function generateSplits(args: GenerateArgs): GenerateResult {
  const { attendees, standings, playersOnCourt } = args;
  if (attendees.length < 2) return { shortlist: [], relaxedPins: [] };

  const all = enumerateSplits(attendees);
  const minHamming = args.currentLineup ? MIN_HAMMING : 0;

  // Pins are hard filters. If they leave nothing, relax rather than refuse:
  // apart-pins first (the weaker intent), then together-pins. Nobody standing
  // in a sports hall wants to debug a constraint solver.
  const relaxedPins: Pin[] = [];
  let pins = [...(args.pins ?? [])];
  let legal: typeof all = [];

  for (;;) {
    legal = all.filter((split) => {
      if (!satisfiesPins(split.sideA, pins)) return false;
      if (minHamming > 0 && args.currentLineup) {
        return hamming(split.sideA, args.currentLineup.sideA, attendees) >= minHamming;
      }
      return true;
    });
    if (legal.length > 0 || pins.length === 0) break;
    const nextIndex = pins.findIndex((p) => p.kind === "apart");
    const dropIndex = nextIndex === -1 ? 0 : nextIndex;
    relaxedPins.push(pins[dropIndex] as Pin);
    pins = pins.filter((_, i) => i !== dropIndex);
  }

  if (legal.length === 0) return { shortlist: [], relaxedPins };

  const scored = legal
    .map((split) => ({
      ...split,
      balanceCost: balanceCost(split.sideA, split.sideB, standings, playersOnCourt),
    }))
    .sort((p, q) => p.balanceCost - q.balanceCost);

  const best = (scored[0] as { balanceCost: number }).balanceCost;
  const weights = recentTeammates(args.pastSessions ?? []);

  const shortlist: Candidate[] = scored
    .filter((s) => s.balanceCost <= best + TOLERANCE)
    .map((s) => ({
      ...s,
      repeatPenalty: repeatPenaltyOf(s.sideA, weights) + repeatPenaltyOf(s.sideB, weights),
    }))
    .sort((p, q) => p.repeatPenalty - q.repeatPenalty || p.balanceCost - q.balanceCost);

  return { shortlist, relaxedPins };
}

/** Players whose side changed between two splits. */
export const movedPlayers = (
  from: Pick<Lineup, "sideA">,
  to: Pick<Candidate, "sideA">,
  attendees: PlayerId[],
): PlayerId[] => attendees.filter((id) => from.sideA.includes(id) !== to.sideA.includes(id));
