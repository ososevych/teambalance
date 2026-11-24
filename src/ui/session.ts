import type { Db, Lineup, PlayerId, Session, SetRecord } from "../core/types.js";

/**
 * Reading and changing a session, kept apart from rendering so the rules are
 * testable without a DOM.
 *
 * Every mutator here is written to be handed to `Store.commit`, which applies
 * it to a clone and only keeps it once GitHub has accepted the write.
 */

export const PLAYERS_ON_COURT = 6;

/** The open session, if there is one. Closing a session is explicit (#5). */
export const openSessionOf = (db: Db): Session | undefined =>
  db.sessions.find((session) => session.closedAt === null);

export const currentLineupOf = (session: Session): Lineup | undefined =>
  session.lineups[session.lineups.length - 1];

export const setsForLineup = (session: Session, seq: number): SetRecord[] =>
  session.sets.filter((set) => set.lineupSeq === seq);

const sessionLabel = (date: Date): string =>
  date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });

/**
 * Start a session and its first lineup in ONE write.
 *
 * Attendance is chosen locally first and committed here, rather than writing on
 * every tap: twenty-five toggles would be twenty-five round trips while people
 * are still arriving (#5 made attendance a one-time step).
 */
export const startSession =
  (attendees: PlayerId[], first: { sideA: PlayerId[]; sideB: PlayerId[] }) =>
  (draft: Db): void => {
    const now = new Date();
    draft.sessions.push({
      id: now.toISOString(),
      label: sessionLabel(now),
      playersOnCourt: PLAYERS_ON_COURT,
      attendees: [...attendees],
      lineups: [{ seq: 1, sideA: first.sideA, sideB: first.sideB, note: "initial split" }],
      sets: [],
      closedAt: null,
    });
  };

const requireOpen = (draft: Db): Session => {
  const session = openSessionOf(draft);
  if (!session) throw new Error("no open session");
  return session;
};

/** Replace the current lineup's rosters. Used by "try another split", which is
 *  only offered before the lineup has played anything (#5). */
export const replaceCurrentLineup =
  (sideA: PlayerId[], sideB: PlayerId[]) =>
  (draft: Db): void => {
    const session = requireOpen(draft);
    const lineup = currentLineupOf(session);
    if (!lineup) throw new Error("no lineup to replace");
    lineup.sideA = sideA;
    lineup.sideB = sideB;
  };

/** Append the next lineup. The previous one keeps its sets. */
export const appendLineup =
  (sideA: PlayerId[], sideB: PlayerId[], note: string) =>
  (draft: Db): void => {
    const session = requireOpen(draft);
    session.lineups.push({ seq: session.lineups.length + 1, sideA, sideB, note });
  };

/**
 * Record a set, snapshotting both rosters.
 *
 * The snapshot is what makes editing a lineup afterwards unable to re-rate a
 * set that was already played (#7).
 */
export const recordSet =
  (pointsA: number, pointsB: number) =>
  (draft: Db): void => {
    const session = requireOpen(draft);
    const lineup = currentLineupOf(session);
    if (!lineup) throw new Error("no lineup to record against");
    session.sets.push({
      lineupSeq: lineup.seq,
      sideA: { players: [...lineup.sideA], points: pointsA },
      sideB: { players: [...lineup.sideB], points: pointsB },
    });
  };

/** Add or remove an attendee mid-session: a late arrival, or someone leaving. */
export const setAttendance =
  (player: PlayerId, present: boolean) =>
  (draft: Db): void => {
    const session = requireOpen(draft);
    if (present) {
      if (!session.attendees.includes(player)) session.attendees.push(player);
    } else {
      session.attendees = session.attendees.filter((id) => id !== player);
    }
  };

/** Close the session. This is the boundary at which star bands evaluate (#6). */
export const closeSession =
  () =>
  (draft: Db): void => {
    requireOpen(draft).closedAt = new Date().toISOString();
  };

/** Reopen the most recently closed session, for a mistaken "end session". */
export const reopenLastSession =
  () =>
  (draft: Db): void => {
    const last = draft.sessions[draft.sessions.length - 1];
    if (!last) throw new Error("no session to reopen");
    last.closedAt = null;
  };

export const deleteLastSet =
  () =>
  (draft: Db): void => {
    requireOpen(draft).sets.pop();
  };
