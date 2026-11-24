import { describe, expect, it } from "vitest";
import {
  effectiveStrength,
  expectedScore,
  kFactor,
  marginMultiplier,
  missingPlayers,
  onCourt,
  ratingDelta,
} from "./rating.js";
import { H } from "./constants.js";

/** The seven scenarios tabulated in #6's resolution, as executable assertions. */
describe("the rating rule's sanity scenarios", () => {
  const settled = 12; // K = 24
  const brandNew = 0; // K = 60

  const delta = (args: {
    setsPlayedBefore: number;
    pointsFor: number;
    pointsAgainst: number;
    ownStrength: number;
    otherStrength: number;
  }) =>
    ratingDelta({
      setsPlayedBefore: args.setsPlayedBefore,
      marginMultiplier: marginMultiplier(args.pointsFor - args.pointsAgainst),
      actualScore: args.pointsFor > args.pointsAgainst ? 1 : 0,
      expectedScore: expectedScore(args.ownStrength, args.otherStrength),
    });

  it("barely moves on a 25-23 between even sides", () => {
    expect(
      delta({ setsPlayedBefore: settled, pointsFor: 25, pointsAgainst: 23, ownStrength: 1500, otherStrength: 1500 }),
    ).toBeCloseTo(6.0, 2);
  });

  it("moves 12 on the reference 25-17 between even sides", () => {
    expect(
      delta({ setsPlayedBefore: settled, pointsFor: 25, pointsAgainst: 17, ownStrength: 1500, otherStrength: 1500 }),
    ).toBeCloseTo(12.0, 2);
  });

  it("moves 2.6x more for a blowout than a nail-biter", () => {
    const blowout = delta({ setsPlayedBefore: settled, pointsFor: 25, pointsAgainst: 8, ownStrength: 1500, otherStrength: 1500 });
    const nailBiter = delta({ setsPlayedBefore: settled, pointsFor: 25, pointsAgainst: 23, ownStrength: 1500, otherStrength: 1500 });
    expect(blowout).toBeCloseTo(15.79, 2);
    expect(blowout / nailBiter).toBeCloseTo(2.63, 2);
  });

  it("pays little for an expected blowout", () => {
    expect(
      delta({ setsPlayedBefore: settled, pointsFor: 25, pointsAgainst: 8, ownStrength: 1600, otherStrength: 1400 }),
    ).toBeCloseTo(7.585, 3);
  });

  it("rewards a short-handed side for winning and punishes it less for losing", () => {
    // Five against six at equal mean rating: 1500 - H versus 1500.
    const short = effectiveStrength(1500, 1);
    const full = effectiveStrength(1500, 0);
    const win = delta({ setsPlayedBefore: settled, pointsFor: 25, pointsAgainst: 20, ownStrength: short, otherStrength: full });
    const loss = delta({ setsPlayedBefore: settled, pointsFor: 20, pointsAgainst: 25, ownStrength: short, otherStrength: full });

    expect(win).toBeCloseTo(11.46, 2);
    expect(loss).toBeCloseTo(-8.11, 2);
    expect(win).toBeGreaterThan(Math.abs(loss));
  });

  it("moves a brand-new player 2.5x faster than settled teammates", () => {
    const fresh = delta({ setsPlayedBefore: brandNew, pointsFor: 25, pointsAgainst: 17, ownStrength: 1500, otherStrength: 1500 });
    const veteran = delta({ setsPlayedBefore: settled, pointsFor: 25, pointsAgainst: 17, ownStrength: 1500, otherStrength: 1500 });
    expect(fresh).toBeCloseTo(30.0, 2);
    expect(veteran).toBeCloseTo(12.0, 2);
  });
});

describe("the short-handed sign", () => {
  it("subtracts strength from the side that is a player down", () => {
    // The research's written formula added it, which would have made a
    // five-a-side the favourite. This test exists to stop that regressing.
    expect(effectiveStrength(1500, 1)).toBe(1500 - H);
    expect(effectiveStrength(1500, 0)).toBe(1500);
  });

  it("expects an equal-rated short side to win about 41%, matching the organizer's 40-45%", () => {
    const short = effectiveStrength(1500, 1);
    const full = effectiveStrength(1500, 0);
    expect(expectedScore(short, full)).toBeCloseTo(0.4145, 4);
    expect(expectedScore(short, full)).toBeGreaterThan(0.4);
    expect(expectedScore(short, full)).toBeLessThan(0.45);
  });

  it("caps the adjustment at two missing players", () => {
    expect(effectiveStrength(1500, 2)).toBe(1500 - 2 * H);
    expect(effectiveStrength(1500, 5)).toBe(1500 - 2 * H);
  });
});

describe("on-court counting", () => {
  it("applies no handicap in 6v7, because the seventh rotates rather than sits", () => {
    const seven = onCourt(7, 6);
    const six = onCourt(6, 6);
    expect(seven).toBe(6);
    expect(six).toBe(6);
    expect(missingPlayers(seven, six)).toBe(0);
    expect(missingPlayers(six, seven)).toBe(0);
  });

  it("applies the handicap in 6v5", () => {
    const five = onCourt(5, 6);
    const six = onCourt(6, 6);
    expect(five).toBe(5);
    expect(missingPlayers(five, six)).toBe(1);
    expect(missingPlayers(six, five)).toBe(0);
  });

  it("applies no handicap in 5v5, where both sides are equally short", () => {
    expect(missingPlayers(onCourt(5, 6), onCourt(5, 6))).toBe(0);
  });
});

describe("the margin multiplier", () => {
  it("saturates within a volleyball set's real range without hitting a clamp edge", () => {
    expect(marginMultiplier(2)).toBeCloseTo(0.5, 4); // the floor, exactly
    expect(marginMultiplier(8)).toBeCloseTo(1.0, 4); // the reference
    expect(marginMultiplier(25)).toBeCloseTo(1.483, 3); // inside the ceiling
  });

  it("ignores the sign of the differential", () => {
    expect(marginMultiplier(-17)).toBe(marginMultiplier(17));
  });
});

describe("the K ramp", () => {
  it("runs smoothly from 60 to 24 with no cliff at the boundary", () => {
    expect(kFactor(0)).toBe(60);
    expect(kFactor(6)).toBe(42);
    expect(kFactor(11)).toBeCloseTo(27, 5);
    expect(kFactor(12)).toBe(24);
    expect(kFactor(100)).toBe(24);
  });
});

describe("the delta cap", () => {
  it("holds the worst single move to a third of a star band", () => {
    // A brand-new player in a 25-0 upset: 60 * 1.483 * 1 = 89 before clamping.
    const uncapped = kFactor(0) * marginMultiplier(25) * 1;
    expect(uncapped).toBeGreaterThan(50);
    expect(
      ratingDelta({ setsPlayedBefore: 0, marginMultiplier: marginMultiplier(25), actualScore: 1, expectedScore: 0 }),
    ).toBe(50);
  });
});
