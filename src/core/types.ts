export type PlayerId = string;

/**
 * A player is never deleted — a departed player is deactivated, because their
 * past sets must keep replaying (GLOSSARY.md, ADR 0002).
 *
 * `seedRating` is an INPUT, not a derived value: cold start is seeded by hand
 * (#9), so replay starts each player here rather than at a shared constant.
 */
export interface Player {
  id: PlayerId;
  name: string;
  active: boolean;
  seedRating: number;
}

/** A lineup is the PLAN. A set's roster is the RECORD. They may differ. (#7) */
export interface Lineup {
  seq: number;
  sideA: PlayerId[];
  sideB: PlayerId[];
  note?: string;
}

export interface SetSide {
  /** Everyone credited with the set. In a side of seven, all seven: the
   *  seventh rotates in rather than sitting out, so they are rated. (#6) */
  players: PlayerId[];
  points: number;
}

/** The rated event. Snapshots its own rosters so that editing a lineup
 *  afterwards can never retroactively re-rate a played set. (#7) */
export interface SetRecord {
  lineupSeq: number;
  sideA: SetSide;
  sideB: SetSide;
}

export interface Session {
  id: string;
  label: string;
  /** 6 for indoor 6v6. Stored per session so a different format stays possible
   *  without a logic change (#4's cheap insurance). */
  playersOnCourt: number;
  attendees: PlayerId[];
  lineups: Lineup[];
  sets: SetRecord[];
  /** Closing the session is what evaluates star bands (#6, amended on #5).
   *  Without this, replay cannot tell which boundaries have been evaluated. */
  closedAt: string | null;
}

export interface Db {
  schemaVersion: 1;
  players: Player[];
  sessions: Session[];
}

export interface Standing {
  rating: number;
  setsPlayed: number;
  /** The coarse 1–5 band, and the only thing a player is ever shown. */
  stars: number;
  /** Consecutive closed sessions at which this player has qualified for
   *  demotion. The band drops on the second. (#6) */
  demotionPending: number;
}

export type Standings = Map<PlayerId, Standing>;
