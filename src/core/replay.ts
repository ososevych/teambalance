import type { Db, PlayerId, Session, SetRecord, Standings } from "./types.js";
import {
  effectiveStrength,
  expectedScore,
  marginMultiplier,
  mean,
  missingPlayers,
  onCourt,
  ratingDelta,
} from "./rating.js";
import { bandOf, evaluateBand } from "./stars.js";

/**
 * Replay the whole set log to derive every rating, counter and star band.
 *
 * The log is the source of truth and nothing here is stored (ADR 0002): a
 * corrected score re-settles the history, and H can be recalibrated with the
 * past re-rating itself. A season is a few hundred sets, so cost is irrelevant.
 *
 * Order matters and comes from position in the arrays, never from timestamps.
 */
export function replay(db: Db): Standings {
  const standings: Standings = new Map(
    db.players.map((p) => [
      p.id,
      {
        rating: p.seedRating,
        setsPlayed: 0,
        stars: bandOf(p.seedRating),
        demotionPending: 0,
      },
    ]),
  );

  for (const session of db.sessions) {
    for (const set of session.sets) {
      applySet(standings, session, set);
    }
    // Closing a session is what evaluates bands. An open session has not
    // reached its boundary, so its sets count towards ratings but not stars.
    if (session.closedAt !== null) {
      evaluateSession(standings, session);
    }
  }

  return standings;
}

function get(standings: Standings, id: PlayerId) {
  const s = standings.get(id);
  if (!s) throw new Error(`replay: set references unknown player "${id}"`);
  return s;
}

function applySet(standings: Standings, session: Session, set: SetRecord): void {
  const a = set.sideA;
  const b = set.sideB;
  const aOnCourt = onCourt(a.players.length, session.playersOnCourt);
  const bOnCourt = onCourt(b.players.length, session.playersOnCourt);

  const aStrength = effectiveStrength(
    mean(a.players.map((id) => get(standings, id).rating)),
    missingPlayers(aOnCourt, bOnCourt),
  );
  const bStrength = effectiveStrength(
    mean(b.players.map((id) => get(standings, id).rating)),
    missingPlayers(bOnCourt, aOnCourt),
  );

  const m = marginMultiplier(a.points - b.points);
  const expectedA = expectedScore(aStrength, bStrength);

  // Read every rating before writing any, so players on the same side are all
  // rated against the same pre-set state.
  const sides = [
    { players: a.players, actual: (a.points > b.points ? 1 : 0) as 0 | 1, expected: expectedA },
    { players: b.players, actual: (b.points > a.points ? 1 : 0) as 0 | 1, expected: 1 - expectedA },
  ];

  const deltas = new Map<PlayerId, number>();
  for (const side of sides) {
    for (const id of side.players) {
      const st = get(standings, id);
      deltas.set(
        id,
        ratingDelta({
          setsPlayedBefore: st.setsPlayed,
          marginMultiplier: m,
          actualScore: side.actual,
          expectedScore: side.expected,
        }),
      );
    }
  }

  for (const [id, delta] of deltas) {
    const st = get(standings, id);
    st.rating = Math.round(st.rating + delta);
    st.setsPlayed += 1;
  }
}

/**
 * Evaluate bands for the players who actually played in this session.
 *
 * Sitting out is not a reason to lose a star: a player mid-demotion who skips
 * three weeks keeps their band until they next play. This also keeps the
 * promise that nothing happens to you on an evening you were not there.
 */
function evaluateSession(standings: Standings, session: Session): void {
  const played = new Set<PlayerId>();
  for (const set of session.sets) {
    for (const id of [...set.sideA.players, ...set.sideB.players]) played.add(id);
  }
  for (const id of played) {
    const st = get(standings, id);
    const next = evaluateBand(st.rating, { stars: st.stars, demotionPending: st.demotionPending });
    st.stars = next.stars;
    st.demotionPending = next.demotionPending;
  }
}
