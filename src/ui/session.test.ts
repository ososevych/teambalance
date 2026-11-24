import { describe, expect, it } from "vitest";
import {
  appendLineup,
  closeSession,
  currentLineupOf,
  deleteLastSet,
  openSessionOf,
  recordSet,
  reopenLastSession,
  replaceCurrentLineup,
  setAttendance,
  setsForLineup,
  startSession,
} from "./session.js";
import { replay } from "../core/replay.js";
import type { Db } from "../core/types.js";

const ELEVEN = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"];

const emptyDb = (): Db => ({
  schemaVersion: 1,
  players: ELEVEN.map((id) => ({ id, name: id.toUpperCase(), active: true, seedRating: 1500 })),
  sessions: [],
});

const started = (): Db => {
  const db = emptyDb();
  startSession(ELEVEN, { sideA: ["a", "b", "c", "d", "e", "f"], sideB: ["g", "h", "i", "j", "k"] })(db);
  return db;
};

describe("starting a session", () => {
  it("creates the session and its first lineup in one change", () => {
    const db = started();
    const session = openSessionOf(db);
    expect(session).toBeDefined();
    expect(session!.attendees).toHaveLength(11);
    expect(session!.lineups).toHaveLength(1);
    expect(session!.sets).toHaveLength(0);
    expect(session!.closedAt).toBeNull();
    expect(session!.playersOnCourt).toBe(6);
  });

  it("leaves no open session once closed", () => {
    const db = started();
    closeSession()(db);
    expect(openSessionOf(db)).toBeUndefined();
  });

  it("can reopen the last session after an accidental end", () => {
    const db = started();
    closeSession()(db);
    reopenLastSession()(db);
    expect(openSessionOf(db)).toBeDefined();
  });
});

describe("lineups", () => {
  it("replaces the current rosters when trying another split", () => {
    const db = started();
    replaceCurrentLineup(["g", "h", "i", "j", "k", "a"], ["b", "c", "d", "e", "f"])(db);
    const session = openSessionOf(db)!;
    expect(session.lineups).toHaveLength(1);
    expect(currentLineupOf(session)!.sideA).toContain("g");
  });

  it("appends a new lineup on rebalance, keeping the previous one", () => {
    const db = started();
    recordSet(25, 20)(db);
    appendLineup(["a", "b", "c", "g", "h", "i"], ["d", "e", "f", "j", "k"], "swapped D and G")(db);

    const session = openSessionOf(db)!;
    expect(session.lineups).toHaveLength(2);
    expect(currentLineupOf(session)!.seq).toBe(2);
    // The first lineup keeps its set.
    expect(setsForLineup(session, 1)).toHaveLength(1);
    expect(setsForLineup(session, 2)).toHaveLength(0);
  });

  it("groups each set under the lineup that played it", () => {
    const db = started();
    recordSet(25, 20)(db);
    recordSet(25, 18)(db);
    appendLineup(["a", "b", "c", "g", "h", "i"], ["d", "e", "f", "j", "k"], "rebalanced")(db);
    recordSet(21, 25)(db);

    const session = openSessionOf(db)!;
    expect(setsForLineup(session, 1)).toHaveLength(2);
    expect(setsForLineup(session, 2)).toHaveLength(1);
  });
});

describe("recording a set", () => {
  it("snapshots the rosters, so editing the lineup later cannot re-rate it", () => {
    // The property #7 relies on: replay reads the set, never the lineup.
    const db = started();
    recordSet(25, 20)(db);
    const before = replay(db).get("a")!.rating;

    replaceCurrentLineup(["g", "h", "i", "j", "k", "a"], ["b", "c", "d", "e", "f"])(db);
    const after = replay(db).get("a")!.rating;

    expect(after).toBe(before);
    expect(openSessionOf(db)!.sets[0]!.sideA.players).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("credits all seven of a rotating side", () => {
    const db = emptyDb();
    db.players.push({ id: "l", name: "L", active: true, seedRating: 1500 });
    startSession([...ELEVEN, "l"], { sideA: ["a", "b", "c", "d", "e", "f"], sideB: ["g", "h", "i", "j", "k", "l"] })(db);
    appendLineup(["a", "b", "c", "d", "e", "f", "g"], ["h", "i", "j", "k", "l"], "uneven")(db);
    recordSet(25, 22)(db);

    const standings = replay(db);
    expect(standings.get("g")!.setsPlayed).toBe(1);
  });

  it("undoes the last set", () => {
    const db = started();
    recordSet(25, 20)(db);
    recordSet(25, 18)(db);
    deleteLastSet()(db);

    const session = openSessionOf(db)!;
    expect(session.sets).toHaveLength(1);
    expect(session.sets[0]!.sideA.points).toBe(25);
    expect(session.sets[0]!.sideB.points).toBe(20);
  });
});

describe("attendance mid-session", () => {
  it("adds a late arrival without duplicating them", () => {
    const db = emptyDb();
    startSession(["a", "b", "c", "d"], { sideA: ["a", "b"], sideB: ["c", "d"] })(db);
    setAttendance("e", true)(db);
    setAttendance("e", true)(db);
    expect(openSessionOf(db)!.attendees.filter((id) => id === "e")).toHaveLength(1);
  });

  it("removes someone who left", () => {
    const db = started();
    setAttendance("k", false)(db);
    expect(openSessionOf(db)!.attendees).not.toContain("k");
  });

  it("does not retroactively remove them from sets they played", () => {
    const db = started();
    recordSet(25, 20)(db);
    setAttendance("k", false)(db);
    // They played; their rating move stands.
    expect(replay(db).get("k")!.setsPlayed).toBe(1);
  });
});

describe("closing", () => {
  it("is what makes stars evaluate", () => {
    const db = started();
    for (let i = 0; i < 4; i += 1) recordSet(25, 8)(db);

    const whileOpen = replay(db);
    closeSession()(db);
    const afterClose = replay(db);

    // Ratings moved either way; the band only re-evaluates at the boundary.
    expect(afterClose.get("a")!.rating).toBe(whileOpen.get("a")!.rating);
    expect(afterClose.get("a")!.stars).toBeGreaterThanOrEqual(whileOpen.get("a")!.stars);
  });

  it("refuses to mutate when there is no open session", () => {
    const db = emptyDb();
    expect(() => recordSet(25, 20)(db)).toThrow(/no open session/);
    expect(() => closeSession()(db)).toThrow(/no open session/);
  });
});
