import { SEED_BY_STARS } from "../core/constants.js";
import { bandOf } from "../core/stars.js";
import type { Db, Player, PlayerId } from "../core/types.js";

/**
 * Adding and editing players.
 *
 * The names arrive pasted out of a booking sheet or a group chat, so parsing
 * has to survive numbering, reserve labels, blank lines and phone numbers
 * rather than assume a clean list.
 */

export interface ParsedRoster {
  /** Names that would be added, in the order they appeared. */
  additions: string[];
  /** Pasted names already in the pool, so the paste can be re-run safely. */
  duplicates: string[];
  /** Lines thrown away, kept so a swallowed name is visible rather than silent. */
  ignored: string[];
}

/** "12." / "1)" / "Reserve 3:" / "- " at the start of a field. */
const LEADING_MARKER = /^\s*(?:reserve\s*\d*|place)?\s*[-–•*]?\s*\d{0,3}\s*[.)\]:-]?\s*/i;
const PHONE_LIKE = /^\+?[\d\s()-]{7,}$/;
const MONEY_LIKE = /\b(?:pln|eur|usd|zł)\b|\d+[,.]\d{2}/i;

/** Columns and values the booking sheet carries that are never a person. */
const NOT_A_NAME =
  /^(?:place|player|players|pay\s*by|price(?:\s+for\s+the\s+game)?|total|date|reserve\s*\d*|multisport|cash|blik|cash\s*\/\s*blik|rent(?:\s*\/\s*game)?)$/i;

const normalise = (name: string): string => name.replace(/\s+/g, " ").trim();
const compare = (name: string): string => normalise(name).toLocaleLowerCase();

const URL_LIKE = /https?:\/\/|www\.|\.(?:com|pl|org|net)\b/i;

/**
 * A person's name is short and has few words. Section titles, dates and
 * sentences are the false positives that matter when the whole booking sheet
 * gets pasted in rather than just the name column, and word count kills all of
 * them without special-casing month names.
 */
const TOO_WORDY = (field: string): boolean => field.split(" ").length > 3 || field.length > 40;

/**
 * Addresses and labels: `ul. Kamienna 17`, `PNH link:`, `Sunday 1 Nov 2026`.
 * No player in this pool has a digit or a trailing colon in their name, and a
 * name that did would be a nickname worth typing by hand.
 */
const LABEL_OR_ADDRESS = (field: string): boolean =>
  field.endsWith(":") ||
  // A stray quote means this is a fragment of a CSV-quoted cell, not a name.
  field.includes('"') ||
  field.split(" ").some((word) => /^\d+$/.test(word));

const isJunk = (field: string): boolean =>
  field.length === 0 ||
  NOT_A_NAME.test(field) ||
  MONEY_LIKE.test(field) ||
  PHONE_LIKE.test(field) ||
  URL_LIKE.test(field) ||
  TOO_WORDY(field) ||
  LABEL_OR_ADDRESS(field) ||
  /^\d+$/.test(field) ||
  !/\p{L}/u.test(field) ||
  field.length < 2;

/**
 * Parse a pasted block into names worth adding.
 *
 * Two shapes have to work, because both are what the organizer actually has:
 *
 * - **A plain list**, one name per line, or comma-separated on one line.
 * - **Rows copied out of the booking sheet**, which carry a place number, a
 *   payment method and a price alongside the name.
 *
 * The rule that separates them: if any field on the line is recognisably *not*
 * a person — a price, a payment method, a column header — the line is tabular,
 * so only the first name-like field is taken and the rest are dropped. If no
 * field is junk, every field is a name, which is what makes `Vadim, Marek,
 * Cheba` work without also inventing a player called `Pay by`.
 *
 * Anything discarded is reported in `ignored` rather than silently dropped, so
 * a swallowed name is visible.
 */
export function parseRoster(text: string, existing: Player[]): ParsedRoster {
  const known = new Set(existing.map((p) => compare(p.name)));
  const seen = new Set<string>();
  const result: ParsedRoster = { additions: [], duplicates: [], ignored: [] };

  const take = (candidate: string): void => {
    const key = compare(candidate);
    if (known.has(key)) {
      if (!result.duplicates.includes(candidate)) result.duplicates.push(candidate);
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    result.additions.push(candidate);
  };

  for (const rawLine of text.split(/[\r\n]+/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    // Tabs come from a spreadsheet copy, commas from a CSV paste.
    const fields = line.split(/\t|,/).map((field) => normalise(field.replace(LEADING_MARKER, "")));
    const names = fields.filter((field) => !isJunk(field));
    const tabular = fields.some((field) => field.length > 0 && isJunk(field)) || fields.length > 3;

    if (names.length === 0) {
      result.ignored.push(line);
      continue;
    }

    if (tabular) {
      take(names[0] as string);
      for (const dropped of names.slice(1)) result.ignored.push(dropped);
    } else {
      for (const name of names) take(name);
    }
  }

  return result;
}

/** A stable, readable id. Collisions get a numeric suffix. */
export function idFor(name: string, taken: Set<PlayerId>): PlayerId {
  const base =
    normalise(name)
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "") || "player";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${String(n)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export const seedForStars = (stars: number): number =>
  SEED_BY_STARS[Math.min(SEED_BY_STARS.length, Math.max(1, stars)) - 1] as number;

/** The starting stars a player was seeded at. */
export const seedStarsOf = (player: Player): number => bandOf(player.seedRating);

export const addPlayers =
  (names: string[], stars: number) =>
  (draft: Db): void => {
    const taken = new Set(draft.players.map((p) => p.id));
    for (const name of names) {
      const id = idFor(name, taken);
      taken.add(id);
      draft.players.push({ id, name: normalise(name), active: true, seedRating: seedForStars(stars) });
    }
  };

export const renamePlayer =
  (id: PlayerId, name: string) =>
  (draft: Db): void => {
    const player = draft.players.find((p) => p.id === id);
    if (!player) throw new Error(`unknown player "${id}"`);
    player.name = normalise(name);
  };

/**
 * Change a player's STARTING stars.
 *
 * The seed is an input to replay, so changing it re-settles the whole history
 * from that point (ADR 0002). That is the intended behaviour — it is how a bad
 * initial guess gets corrected — but it does move a player's current rating,
 * which is why the UI calls this "starting level" rather than "level".
 */
export const setSeedStars =
  (id: PlayerId, stars: number) =>
  (draft: Db): void => {
    const player = draft.players.find((p) => p.id === id);
    if (!player) throw new Error(`unknown player "${id}"`);
    player.seedRating = seedForStars(stars);
  };

export const setPlayerActive =
  (id: PlayerId, active: boolean) =>
  (draft: Db): void => {
    const player = draft.players.find((p) => p.id === id);
    if (!player) throw new Error(`unknown player "${id}"`);
    player.active = active;
  };

/** How many recorded sets reference this player. Zero means safe to delete. */
export const setsPlayedBy = (db: Db, id: PlayerId): number =>
  db.sessions.reduce(
    (total, session) =>
      total +
      session.sets.filter((set) => set.sideA.players.includes(id) || set.sideB.players.includes(id)).length,
    0,
  );

/**
 * Remove a player entirely — only allowed before they have played.
 *
 * Once a set references them, deletion would make replay throw on its own
 * data, so a departed player is deactivated instead (GLOSSARY: Player).
 */
export const removePlayer =
  (id: PlayerId) =>
  (draft: Db): void => {
    if (setsPlayedBy(draft, id) > 0) {
      throw new Error("This player has played sets. Mark them inactive instead of deleting them.");
    }
    draft.players = draft.players.filter((p) => p.id !== id);
    for (const session of draft.sessions) {
      session.attendees = session.attendees.filter((playerId) => playerId !== id);
    }
  };
