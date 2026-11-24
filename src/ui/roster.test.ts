import { describe, expect, it } from "vitest";
import {
  addPlayers,
  idFor,
  parseRoster,
  removePlayer,
  renamePlayer,
  seedForStars,
  seedStarsOf,
  setPlayerActive,
  setSeedStars,
  setsPlayedBy,
} from "./roster.js";
import { replay } from "../core/replay.js";
import { recordSet, startSession } from "./session.js";
import type { Db, Player } from "../core/types.js";

const player = (id: string, name: string, seedRating = 1500): Player => ({
  id,
  name,
  active: true,
  seedRating,
});

describe("parsing a pasted roster", () => {
  it("takes a plain list of names", () => {
    const result = parseRoster("Maria Sz.\nVadim\nCheba", []);
    expect(result.additions).toEqual(["Maria Sz.", "Vadim", "Cheba"]);
    expect(result.ignored).toEqual([]);
  });

  it("strips the numbering a booking sheet or chat paste carries", () => {
    const result = parseRoster("1. Maria Sz.\n2) Vadim\n- Cheba\n12 Marek", []);
    expect(result.additions).toEqual(["Maria Sz.", "Vadim", "Cheba", "Marek"]);
  });

  it("strips reserve labels", () => {
    const result = parseRoster("Reserve 1 Yulia\nReserve 2: Sergey", []);
    expect(result.additions).toEqual(["Yulia", "Sergey"]);
  });

  it("throws away money and phone numbers rather than adding them as players", () => {
    // The real sheet's price table would otherwise produce a player called "29,17 PLN".
    const result = parseRoster("Maria Sz.\n29,17 PLN\n10,00 PLN\n+48 123 456 789\n350", []);
    expect(result.additions).toEqual(["Maria Sz."]);
    expect(result.ignored).toContain("29,17 PLN");
    expect(result.ignored).toContain("+48 123 456 789");
  });

  it("reports what it ignored instead of dropping it silently", () => {
    const result = parseRoster("Vadim\n???\n7", []);
    expect(result.additions).toEqual(["Vadim"]);
    expect(result.ignored).toHaveLength(2);
  });

  it("collapses stray whitespace, which the sheet has plenty of", () => {
    const result = parseRoster("  Cheba  \nAleksandr   S.", []);
    expect(result.additions).toEqual(["Cheba", "Aleksandr S."]);
  });

  it("deduplicates within the paste, ignoring case", () => {
    const result = parseRoster("Vadim\nvadim\nVADIM", []);
    expect(result.additions).toEqual(["Vadim"]);
  });

  it("separates names already in the pool, so the same paste can be re-run", () => {
    const result = parseRoster("Vadim\nMarek", [player("vadim", "Vadim")]);
    expect(result.additions).toEqual(["Marek"]);
    expect(result.duplicates).toEqual(["Vadim"]);
  });

  it("splits a comma-separated paste but keeps abbreviated surnames intact", () => {
    expect(parseRoster("Vadim, Marek, Cheba", []).additions).toEqual(["Vadim", "Marek", "Cheba"]);
    // A single name containing a full stop must not be split on it.
    expect(parseRoster("Maria Sz.", []).additions).toEqual(["Maria Sz."]);
  });

  it("ignores the furniture that comes with a whole-sheet paste", () => {
    // Pasting the entire booking sheet, not just the name column, is the
    // likely accident. Section titles, dates, URLs and warnings must not
    // become players.
    const pasted = [
      "SUNDAY VOLLEYBALL · 11:00-13:00 · Some Hall, Some Street 17",
      "https://maps.app.goo.gl/abcdef",
      "⚠ If you want to use MultiSport you must also register",
      "Sunday 1 Nov 2026",
      "Nameless One",
    ].join("\n");
    const result = parseRoster(pasted, []);
    expect(result.additions).toEqual(["Nameless One"]);
    expect(result.ignored.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps names of up to three words", () => {
    expect(parseRoster("Anna Maria Sz.\nVadim", []).additions).toEqual(["Anna Maria Sz.", "Vadim"]);
  });

  it("handles the real sheet's shape end to end", () => {
    const pasted = [
      "Place,Player,Pay by,Price for the game",
      "1,Maria Sz.,MultiSport,10,00 PLN",
      "2,Aleksandr S.,MultiSport,10,00 PLN",
      "Reserve 1,Yulia,Cash/BLIK,",
    ].join("\n");
    const result = parseRoster(pasted, []);
    expect(result.additions).toContain("Maria Sz.");
    expect(result.additions).toContain("Aleksandr S.");
    expect(result.additions).toContain("Yulia");
    expect(result.additions.some((n) => n.includes("PLN"))).toBe(false);
  });
});

describe("ids", () => {
  it("slugifies a name", () => {
    expect(idFor("Maria Sz.", new Set())).toBe("maria-sz");
    expect(idFor("Aleksandr S.", new Set())).toBe("aleksandr-s");
  });

  it("suffixes a collision rather than merging two people", () => {
    const taken = new Set(["vadim"]);
    expect(idFor("Vadim", taken)).toBe("vadim-2");
  });

  it("survives a name with no latin characters", () => {
    expect(idFor("Катерина", new Set())).toBe("катерина");
  });
});

describe("seeding", () => {
  it("maps stars to the centre of their band, so what you assign is what shows", () => {
    for (let stars = 1; stars <= 5; stars += 1) {
      const seed = seedForStars(stars);
      expect(seedStarsOf(player("x", "X", seed))).toBe(stars);
    }
  });

  it("adds pasted players at the chosen starting stars", () => {
    const db: Db = { schemaVersion: 1, players: [], sessions: [] };
    addPlayers(["Maria Sz.", "Vadim"], 4)(db);
    expect(db.players).toHaveLength(2);
    expect(db.players.every((p) => p.seedRating === 1650)).toBe(true);
    expect(db.players.every((p) => p.active)).toBe(true);
  });
});

describe("editing", () => {
  const withHistory = (): Db => {
    const db: Db = {
      schemaVersion: 1,
      players: ["a", "b", "c", "d"].map((id) => player(id, id.toUpperCase())),
      sessions: [],
    };
    startSession(["a", "b", "c", "d"], { sideA: ["a", "b"], sideB: ["c", "d"] })(db);
    recordSet(25, 20)(db);
    return db;
  };

  it("renames without touching history", () => {
    const db = withHistory();
    const before = replay(db).get("a")!.rating;
    renamePlayer("a", "  Aleksandr   S. ")(db);
    expect(db.players.find((p) => p.id === "a")!.name).toBe("Aleksandr S.");
    expect(replay(db).get("a")!.rating).toBe(before);
  });

  it("re-settles the whole history when a starting level is corrected", () => {
    // This is the point of the seed being an input rather than a stored rating.
    const db = withHistory();
    const before = replay(db).get("a")!.rating;
    setSeedStars("a", 5)(db);
    const after = replay(db).get("a")!.rating;
    expect(after).toBeGreaterThan(before);
    expect(seedStarsOf(db.players.find((p) => p.id === "a")!)).toBe(5);
  });

  it("deactivates a player without losing their results", () => {
    const db = withHistory();
    setPlayerActive("a", false)(db);
    expect(db.players.find((p) => p.id === "a")!.active).toBe(false);
    expect(replay(db).get("a")!.setsPlayed).toBe(1);
  });

  it("refuses to edit a player who does not exist", () => {
    const db = withHistory();
    expect(() => renamePlayer("ghost", "Nope")(db)).toThrow(/unknown player/);
    expect(() => setSeedStars("ghost", 3)(db)).toThrow(/unknown player/);
  });
});

describe("removing", () => {
  it("deletes a player who has never played, and drops them from attendee lists", () => {
    const db: Db = { schemaVersion: 1, players: [], sessions: [] };
    addPlayers(["Maria Sz.", "Vadim", "Cheba", "Marek"], 3)(db);
    startSession(["maria-sz", "vadim", "cheba", "marek"], { sideA: ["maria-sz", "vadim"], sideB: ["cheba", "marek"] })(db);

    removePlayer("marek")(db);
    expect(db.players.map((p) => p.id)).not.toContain("marek");
    expect(db.sessions[0]!.attendees).not.toContain("marek");
  });

  it("refuses to delete a player with recorded sets, and says what to do instead", () => {
    // Deleting them would make replay throw on its own data.
    const db: Db = { schemaVersion: 1, players: [], sessions: [] };
    addPlayers(["Maria Sz.", "Vadim", "Cheba", "Marek"], 3)(db);
    startSession(["maria-sz", "vadim", "cheba", "marek"], { sideA: ["maria-sz", "vadim"], sideB: ["cheba", "marek"] })(db);
    recordSet(25, 20)(db);

    expect(setsPlayedBy(db, "maria-sz")).toBe(1);
    expect(() => removePlayer("maria-sz")(db)).toThrow(/Mark them inactive/);
    expect(db.players.map((p) => p.id)).toContain("maria-sz");
    expect(() => replay(db)).not.toThrow();
  });
});
