import { describe, expect, it } from "vitest";
import { bandOf, evaluateBand } from "./stars.js";
import { SEED_BY_STARS, STAR_THRESHOLDS } from "./constants.js";

describe("star bands", () => {
  it("puts every seed rating in the band it was assigned", () => {
    // The whole point of seeding at band centres (#9): what you assign is what
    // the player is shown.
    SEED_BY_STARS.forEach((seed, index) => {
      expect(bandOf(seed)).toBe(index + 1);
    });
  });

  it("places ratings on the published thresholds", () => {
    expect(bandOf(1274)).toBe(1);
    expect(bandOf(1275)).toBe(2);
    expect(bandOf(1424)).toBe(2);
    expect(bandOf(1425)).toBe(3);
    expect(bandOf(1724)).toBe(4);
    expect(bandOf(1725)).toBe(5);
  });
});

describe("hysteresis", () => {
  it("requires clearing the next threshold by 25 to promote", () => {
    // 1575 is the 4-star floor, so 1599 is in band 4 naively but must not promote.
    expect(bandOf(1599)).toBe(4);
    expect(evaluateBand(1599, { stars: 3, demotionPending: 0 }).stars).toBe(3);
    expect(evaluateBand(1600, { stars: 3, demotionPending: 0 }).stars).toBe(4);
  });

  it("requires falling 25 below the band floor to even qualify for demotion", () => {
    // 1425 is the 3-star floor. 1401 is naively band 2 but must not demote.
    expect(bandOf(1401)).toBe(2);
    expect(evaluateBand(1401, { stars: 3, demotionPending: 0 })).toEqual({ stars: 3, demotionPending: 0 });
  });

  it("promotes across more than one band in a single evaluation", () => {
    expect(evaluateBand(1760, { stars: 3, demotionPending: 0 }).stars).toBe(5);
  });

  it("never demotes more than one band in a single evaluation", () => {
    const first = evaluateBand(1100, { stars: 5, demotionPending: 1 });
    expect(first.stars).toBe(4);
  });
});

describe("the demotion lag", () => {
  // This is the behaviour that makes stars underivable from a final rating,
  // and the reason replay must evaluate every session boundary in order.
  it("keeps the star through the first qualifying evaluation", () => {
    expect(evaluateBand(1395, { stars: 3, demotionPending: 0 })).toEqual({ stars: 3, demotionPending: 1 });
  });

  it("drops the star on the second consecutive qualifying evaluation", () => {
    expect(evaluateBand(1395, { stars: 3, demotionPending: 1 })).toEqual({ stars: 2, demotionPending: 0 });
  });

  it("resets the pending demotion when the player recovers", () => {
    // Dipped last session, back above the line this session: star survives and
    // the counter is cleared, so a later dip starts the lag again from zero.
    expect(evaluateBand(1450, { stars: 3, demotionPending: 1 })).toEqual({ stars: 3, demotionPending: 0 });
  });

  it("does not demote below one star", () => {
    expect(evaluateBand(900, { stars: 1, demotionPending: 1 })).toEqual({ stars: 1, demotionPending: 0 });
  });

  it("clears a pending demotion on promotion", () => {
    expect(evaluateBand(1600, { stars: 3, demotionPending: 1 })).toEqual({ stars: 4, demotionPending: 0 });
  });
});

describe("band width versus the worst single move", () => {
  it("keeps every band at least twice the largest possible one-set move", () => {
    // The anti-flicker rule from #6: width >= 2 x DELTA_CAP (50).
    for (let i = 1; i < STAR_THRESHOLDS.length; i += 1) {
      const width = (STAR_THRESHOLDS[i] as number) - (STAR_THRESHOLDS[i - 1] as number);
      expect(width).toBeGreaterThanOrEqual(100);
    }
  });
});
