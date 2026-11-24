import { describe, expect, it } from "vitest";
import { balanceCost, enumerateSplits, generateSplits, movedPlayers, rankGap, recentTeammates } from "./balance.js";
import { bandOf } from "./stars.js";
import type { PlayerId, Session, Standings } from "./types.js";

const standingsOf = (ratings: Record<string, number>): Standings =>
  new Map(
    Object.entries(ratings).map(([id, rating]) => [
      id,
      { rating, setsPlayed: 20, stars: bandOf(rating), demotionPending: 0 },
    ]),
  );

/** A fixed eleven-player pool: odd, so every split is 6v5. */
const ELEVEN = {
  andrii: 1664,
  dmytro: 1642,
  bohdan: 1611,
  maksym: 1598,
  oleksii: 1588,
  taras: 1555,
  sergii: 1536,
  pavlo: 1524,
  kateryna: 1501,
  vika: 1489,
  ivan: 1472,
};
const ELEVEN_IDS = Object.keys(ELEVEN);

describe("enumeration", () => {
  it("counts every distinct split of twelve players exactly once", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    // C(12,6) = 924, halved because labelling the sides A and B is arbitrary.
    expect(enumerateSplits(ids)).toHaveLength(462);
  });

  it("counts every distinct split of eleven players exactly once", () => {
    // Sides differ in size, so each partition appears once already: C(11,6).
    expect(enumerateSplits(ELEVEN_IDS)).toHaveLength(462);
  });

  it("never produces the same split twice with the labels swapped", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const keys = enumerateSplits(ids).map((s) => [...s.sideA].sort().join(","));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives the extra player to the larger side, which rotates", () => {
    for (const split of enumerateSplits(ELEVEN_IDS)) {
      expect(split.sideA).toHaveLength(6);
      expect(split.sideB).toHaveLength(5);
    }
  });

  it("stays small enough to enumerate exhaustively at the real worst case", () => {
    const ids = Array.from({ length: 14 }, (_, i) => `p${i}`);
    expect(enumerateSplits(ids)).toHaveLength(1716);
  });
});

describe("the rank-pairing term", () => {
  it("separates two splits that are identical on the mean", () => {
    // Both sides average 1500. One is six average players; the other holds the
    // two best and the two worst. The means cannot tell them apart.
    const flat = rankGap([1500, 1500, 1500], [1500, 1500, 1500]);
    const stacked = rankGap([1800, 1500, 1200], [1500, 1500, 1500]);
    expect(flat).toBe(0);
    expect(stacked).toBeGreaterThan(0);
  });

  it("ignores the surplus player on an uneven side", () => {
    // Six versus five: only the top five of each are compared.
    expect(rankGap([1600, 1500, 1400, 1300, 1200, 1100], [1600, 1500, 1400, 1300, 1200])).toBe(0);
  });
});

describe("the short-handed side in the objective", () => {
  it("prices a five-a-side as weaker at equal mean rating", () => {
    const s = standingsOf({ a: 1500, b: 1500, c: 1500, d: 1500, e: 1500, f: 1500, g: 1500, h: 1500, i: 1500, j: 1500, k: 1500 });
    const sixVsFive = balanceCost(["a", "b", "c", "d", "e", "f"], ["g", "h", "i", "j", "k"], s, 6);
    // All ratings equal, so the only cost is the handicap: 60 points.
    expect(sixVsFive).toBeCloseTo(60, 5);
  });

  it("chooses a split where the five are stronger on paper", () => {
    const { shortlist } = generateSplits({
      attendees: ELEVEN_IDS,
      standings: standingsOf(ELEVEN),
      playersOnCourt: 6,
    });
    const best = shortlist[0]!;
    const meanOf = (side: PlayerId[]) =>
      side.reduce((t, id) => t + (ELEVEN as Record<string, number>)[id]!, 0) / side.length;

    const six = best.sideA.length === 6 ? best.sideA : best.sideB;
    const five = best.sideA.length === 5 ? best.sideA : best.sideB;
    expect(meanOf(five)).toBeGreaterThan(meanOf(six));
  });
});

describe("generateSplits", () => {
  const args = { attendees: ELEVEN_IDS, standings: standingsOf(ELEVEN), playersOnCourt: 6 };

  it("is deterministic", () => {
    const a = generateSplits(args);
    const b = generateSplits(args);
    expect(a.shortlist[0]).toEqual(b.shortlist[0]);
    expect(a.shortlist.map((c) => c.balanceCost)).toEqual(b.shortlist.map((c) => c.balanceCost));
  });

  it("places every attendee on exactly one side", () => {
    for (const candidate of generateSplits(args).shortlist) {
      const all = [...candidate.sideA, ...candidate.sideB].sort();
      expect(all).toEqual([...ELEVEN_IDS].sort());
    }
  });

  it("keeps the whole shortlist within the tolerance band of the best cost", () => {
    const { shortlist } = generateSplits(args);
    const best = shortlist[0]!.balanceCost;
    expect(shortlist.length).toBeGreaterThan(1);
    for (const candidate of shortlist) {
      expect(candidate.balanceCost).toBeLessThanOrEqual(Math.min(...shortlist.map((c) => c.balanceCost)) + 15);
      expect(candidate.balanceCost).toBeGreaterThanOrEqual(0);
    }
    expect(best).toBeLessThanOrEqual(Math.min(...shortlist.map((c) => c.balanceCost)) + 15);
  });
});

describe("variety", () => {
  const pastSession = (sideA: PlayerId[], sideB: PlayerId[]): Session => ({
    id: "past",
    label: "past",
    playersOnCourt: 6,
    attendees: [...sideA, ...sideB],
    lineups: [],
    sets: [{ lineupSeq: 1, sideA: { players: sideA, points: 25 }, sideB: { players: sideB, points: 20 } }],
    closedAt: "past",
  });

  it("counts a pair once per session however many sets they played together", () => {
    const twoSets: Session = {
      ...pastSession(["a", "b"], ["c", "d"]),
      sets: [
        { lineupSeq: 1, sideA: { players: ["a", "b"], points: 25 }, sideB: { players: ["c", "d"], points: 20 } },
        { lineupSeq: 1, sideA: { players: ["a", "b"], points: 25 }, sideB: { players: ["c", "d"], points: 18 } },
      ],
    };
    expect(recentTeammates([twoSets]).get("a|b")).toBe(3);
  });

  it("weights more recent sessions higher", () => {
    const older = pastSession(["a", "b"], ["c", "d"]);
    const newer = pastSession(["a", "c"], ["b", "d"]);
    const weights = recentTeammates([older, newer]);
    expect(weights.get("a|c")).toBe(3); // most recent
    expect(weights.get("a|b")).toBe(2); // one back
  });

  it("breaks ties towards whoever has not just played together", () => {
    // A flat pool: every split costs the same, so variety decides alone.
    const flat = standingsOf(Object.fromEntries(["a", "b", "c", "d"].map((id) => [id, 1500])));
    const { shortlist } = generateSplits({
      attendees: ["a", "b", "c", "d"],
      standings: flat,
      playersOnCourt: 6,
      pastSessions: [pastSession(["a", "b"], ["c", "d"])],
    });
    const best = shortlist[0]!;
    const aWithB = best.sideA.includes("a") === best.sideA.includes("b");
    expect(aWithB).toBe(false);
    expect(best.repeatPenalty).toBe(0);
  });

  it("never lets variety override balance beyond the tolerance band", () => {
    // Make the repeat pairing also the only fair split: balance must win.
    const skewed = standingsOf({ a: 1800, b: 1200, c: 1800, d: 1200 });
    const { shortlist } = generateSplits({
      attendees: ["a", "b", "c", "d"],
      standings: skewed,
      playersOnCourt: 6,
      pastSessions: [pastSession(["a", "b"], ["c", "d"])],
    });
    // The only balanced splits pair a strong with a weak player.
    const best = shortlist[0]!;
    const strongTogether = best.sideA.includes("a") === best.sideA.includes("c");
    expect(strongTogether).toBe(false);
    expect(best.balanceCost).toBeLessThan(15);
  });
});

describe("rebalance", () => {
  it("moves at least two players, so it cannot hand back the same teams", () => {
    const args = { attendees: ELEVEN_IDS, standings: standingsOf(ELEVEN), playersOnCourt: 6 };
    const current = generateSplits(args).shortlist[0]!;
    const next = generateSplits({ ...args, currentLineup: { sideA: current.sideA } }).shortlist[0]!;

    const moved = movedPlayers({ sideA: current.sideA }, next, ELEVEN_IDS);
    expect(moved.length).toBeGreaterThanOrEqual(2);
  });

  it("costs balance when the current teams were already optimal", () => {
    const args = { attendees: ELEVEN_IDS, standings: standingsOf(ELEVEN), playersOnCourt: 6 };
    const current = generateSplits(args).shortlist[0]!;
    const next = generateSplits({ ...args, currentLineup: { sideA: current.sideA } }).shortlist[0]!;
    // Not necessarily worse - an equally fair alternative may exist - but it
    // can never be better, which is what the UI promises to report.
    expect(next.balanceCost).toBeGreaterThanOrEqual(
      Math.min(...generateSplits(args).shortlist.map((c) => c.balanceCost)) - 1e-9,
    );
  });
});

describe("pins", () => {
  const args = { attendees: ELEVEN_IDS, standings: standingsOf(ELEVEN), playersOnCourt: 6 };

  it("honours a together pin as a hard constraint", () => {
    const { shortlist, relaxedPins } = generateSplits({
      ...args,
      pins: [{ kind: "together", a: "andrii", b: "dmytro" }],
    });
    expect(relaxedPins).toEqual([]);
    for (const c of shortlist) {
      expect(c.sideA.includes("andrii")).toBe(c.sideA.includes("dmytro"));
    }
  });

  it("honours an apart pin as a hard constraint", () => {
    const { shortlist } = generateSplits({
      ...args,
      pins: [{ kind: "apart", a: "andrii", b: "dmytro" }],
    });
    for (const c of shortlist) {
      expect(c.sideA.includes("andrii")).not.toBe(c.sideA.includes("dmytro"));
    }
  });

  it("warns and relaxes rather than refusing when pins cannot all hold", () => {
    // A together-chain of seven cannot fit a side of six.
    const impossible = ELEVEN_IDS.slice(0, 7).map((id) => ({ kind: "together" as const, a: ELEVEN_IDS[0]!, b: id }));
    const { shortlist, relaxedPins } = generateSplits({ ...args, pins: impossible });
    expect(shortlist.length).toBeGreaterThan(0);
    expect(relaxedPins.length).toBeGreaterThan(0);
  });

  it("drops apart pins before together pins", () => {
    const impossible = [
      ...ELEVEN_IDS.slice(0, 7).map((id) => ({ kind: "together" as const, a: ELEVEN_IDS[0]!, b: id })),
      { kind: "apart" as const, a: "vika", b: "ivan" },
    ];
    const { relaxedPins } = generateSplits({ ...args, pins: impossible });
    expect(relaxedPins[0]!.kind).toBe("apart");
  });
});
