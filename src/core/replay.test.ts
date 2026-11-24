import { describe, expect, it } from "vitest";
import { replay } from "./replay.js";
import { bandOf } from "./stars.js";
import type { Db, Session, SetRecord } from "./types.js";

/** 1v1 sessions keep the arithmetic short while exercising the whole pipeline. */
const duel = (a: number, b: number): SetRecord => ({
  lineupSeq: 1,
  sideA: { players: ["x"], points: a },
  sideB: { players: ["y"], points: b },
});

const session = (id: string, sets: SetRecord[], closed: boolean): Session => ({
  id,
  label: id,
  playersOnCourt: 2,
  attendees: ["x", "y"],
  lineups: [{ seq: 1, sideA: ["x"], sideB: ["y"] }],
  sets,
  closedAt: closed ? `${id}T21:00:00Z` : null,
});

const db = (sessions: Session[]): Db => ({
  schemaVersion: 1,
  players: [
    { id: "x", name: "X", active: true, seedRating: 1500 },
    { id: "y", name: "Y", active: true, seedRating: 1500 },
  ],
  sessions,
});

const standing = (d: Db, id: string) => {
  const s = replay(d).get(id);
  if (!s) throw new Error("missing");
  return s;
};

describe("replay", () => {
  it("starts every player at their seeded rating, not a shared constant", () => {
    const seeded: Db = {
      schemaVersion: 1,
      players: [
        { id: "x", name: "X", active: true, seedRating: 1800 },
        { id: "y", name: "Y", active: true, seedRating: 1200 },
      ],
      sessions: [],
    };
    expect(standing(seeded, "x")).toMatchObject({ rating: 1800, stars: 5, setsPlayed: 0 });
    expect(standing(seeded, "y")).toMatchObject({ rating: 1200, stars: 1, setsPlayed: 0 });
  });

  it("counts every credited player, including a rotating seventh", () => {
    const seven: Db = {
      schemaVersion: 1,
      players: Array.from({ length: 13 }, (_, i) => ({
        id: `p${i}`,
        name: `P${i}`,
        active: true,
        seedRating: 1500,
      })),
      sessions: [
        {
          id: "s",
          label: "s",
          playersOnCourt: 6,
          attendees: Array.from({ length: 13 }, (_, i) => `p${i}`),
          lineups: [],
          sets: [
            {
              lineupSeq: 1,
              sideA: { players: ["p0", "p1", "p2", "p3", "p4", "p5", "p6"], points: 25 },
              sideB: { players: ["p7", "p8", "p9", "p10", "p11", "p12"], points: 20 },
            },
          ],
          closedAt: null,
        },
      ],
    };
    const result = replay(seven);
    // All seven on the larger side are rated, and all move identically — six
    // are on court at all times, so no handicap applies in either direction.
    const sideA = ["p0", "p1", "p2", "p3", "p4", "p5", "p6"].map((id) => result.get(id)!);
    expect(sideA.every((s) => s.setsPlayed === 1)).toBe(true);
    expect(new Set(sideA.map((s) => s.rating)).size).toBe(1);
    expect(sideA[0]!.rating).toBeGreaterThan(1500);
  });

  it("rates the sets of an open session but does not evaluate its stars", () => {
    // An open session has not reached its boundary.
    const open = db([session("2026-11-29", [duel(10, 25), duel(10, 25), duel(10, 25), duel(10, 25)], false)]);
    const x = standing(open, "x");
    expect(x.rating).toBeLessThan(1425);
    expect(x.stars).toBe(3);
    expect(x.demotionPending).toBe(0);
  });
});

describe("the demotion lag through a full replay", () => {
  // The trap from #7 and ADR 0002: stars cannot be derived from a final rating.
  const mildLoss = session("2026-11-15", [duel(23, 25)], true);
  const collapse = session("2026-11-22", [duel(10, 25), duel(10, 25), duel(10, 25), duel(10, 25)], true);

  it("keeps the star when a player first drops below the threshold", () => {
    const x = standing(db([mildLoss, collapse]), "x");

    expect(x.rating).toBeLessThanOrEqual(1400); // qualifies for demotion
    expect(bandOf(x.rating)).toBe(2); // what the naive calculation would say
    expect(x.stars).toBe(3); // what the lag actually produces
    expect(x.demotionPending).toBe(1);
  });

  it("drops the star only once the player qualifies at a second session", () => {
    const again = session("2026-11-29", [duel(20, 25)], true);
    const x = standing(db([mildLoss, collapse, again]), "x");

    expect(x.stars).toBe(2);
    expect(x.demotionPending).toBe(0);
  });

  it("keeps the star when the player recovers instead", () => {
    // Same history, but the third session goes well enough to clear the line.
    const recovery = session("2026-11-29", [duel(25, 10), duel(25, 15)], true);
    const x = standing(db([mildLoss, collapse, recovery]), "x");

    expect(x.rating).toBeGreaterThan(1400);
    expect(x.stars).toBe(3);
    expect(x.demotionPending).toBe(0);
  });
});

describe("corrections", () => {
  it("re-settles the whole history when a score is fixed", () => {
    const wrong = db([session("2026-11-22", [duel(25, 10)], true)]);
    const fixed = db([session("2026-11-22", [duel(10, 25)], true)]);
    expect(standing(wrong, "x").rating).toBeGreaterThan(1500);
    expect(standing(fixed, "x").rating).toBeLessThan(1500);
  });

  it("is deterministic", () => {
    const d = db([session("2026-11-22", [duel(25, 20), duel(18, 25)], true)]);
    expect(replay(d).get("x")).toEqual(replay(d).get("x"));
  });

  it("rejects a set referencing an unknown player", () => {
    const broken = db([session("2026-11-22", [{ lineupSeq: 1, sideA: { players: ["ghost"], points: 25 }, sideB: { players: ["y"], points: 10 } }], true)]);
    expect(() => replay(broken)).toThrow(/unknown player "ghost"/);
  });
});
