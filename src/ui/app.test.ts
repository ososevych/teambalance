/**
 * @vitest-environment jsdom
 *
 * Smoke tests. There is no browser in CI and only one chance to get Sunday
 * right, so these assert that each screen renders at all, that the court shows
 * what it must, and that the two things the design insists on are actually
 * true: no exact rating ever reaches a player-facing list, and shuffle and
 * rebalance are never both on screen.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountApp } from "./app.js";
import { Store } from "../storage/store.js";
import type { Db } from "../core/types.js";

const NAMES = ["Andrii", "Dmytro", "Kateryna", "Marta", "Oleksii", "Sergii", "Taras", "Vika", "Ivan", "Bohdan", "Maksym"];

const dbWithPool = (): Db => ({
  schemaVersion: 1,
  players: NAMES.map((name, index) => ({
    id: name.toLowerCase(),
    name,
    active: true,
    // A spread of seeds, as #9's hand-assignment would produce.
    seedRating: [1200, 1350, 1500, 1650, 1800][index % 5] as number,
  })),
  sessions: [],
});

const base64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const okJson = (body: unknown): Response =>
  ({ status: 200, ok: true, json: async () => body }) as Response;

const openStore = async (db: Db): Promise<Store> => {
  const fetchMock = vi.fn().mockResolvedValue(okJson({ content: base64(JSON.stringify(db)), sha: "sha1" }));
  vi.stubGlobal("fetch", fetchMock);
  const store = await Store.open("token");
  // Every later write succeeds, so flows can be driven through.
  fetchMock.mockResolvedValue(okJson({ content: { sha: "sha2" } }));
  return store;
};

const mount = (store: Store): HTMLElement => {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  mountApp({ root, store, avatars: {}, token: "token", onForgetToken: () => undefined });
  return root;
};

const click = async (root: HTMLElement, label: string): Promise<void> => {
  const match = [...root.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label));
  if (!match) throw new Error(`no button matching "${label}" in:\n${root.textContent ?? ""}`);
  match.click();
  // Let the commit promise settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

describe("the idle screen", () => {
  it("says there is no session and offers to start one", async () => {
    const root = mount(await openStore(dbWithPool()));
    expect(root.textContent).toContain("No session running");
    expect(root.textContent).toContain("Start a session");
  });

  it("refuses to start with an empty pool, and says why", async () => {
    const root = mount(await openStore({ schemaVersion: 1, players: [], sessions: [] }));
    expect(root.textContent).toContain("at least four players");
    expect([...root.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Start a session");
  });
});

describe("the whole evening", () => {
  it("runs start, split, set, rebalance and end without falling over", async () => {
    const store = await openStore(dbWithPool());
    const root = mount(store);

    await click(root, "Start a session");
    expect(root.textContent).toContain("Who turned up?");
    expect(root.textContent).toContain("11 here");
    // Eleven is odd, and the screen says what that means rather than hiding it.
    expect(root.textContent).toContain("a player down");

    await click(root, "Make the teams");
    expect(root.textContent).toContain("Gold");
    expect(root.textContent).toContain("Navy");
    expect(root.textContent).toContain("teams 1");

    // Before any set, the escape hatch is a different split - not a rebalance.
    expect(root.textContent).toContain("Try another split");
    expect(root.textContent).not.toContain("Rebalance");

    await click(root, "Save set");
    expect(store.snapshot().sessions[0]!.sets).toHaveLength(1);

    // After a set, the offer flips. Both are never on screen together (#5).
    expect(root.textContent).toContain("Rebalance");
    expect(root.textContent).not.toContain("Try another split");

    await click(root, "Rebalance");
    const session = store.snapshot().sessions[0]!;
    expect(session.lineups).toHaveLength(2);
    // The first lineup keeps its set.
    expect(session.sets.filter((s) => s.lineupSeq === 1)).toHaveLength(1);
    expect(root.textContent).toContain("teams 2");

    await click(root, "End session");
    expect(store.snapshot().sessions[0]!.closedAt).not.toBeNull();
    expect(root.textContent).toContain("That's the evening");
  });

  it("names the players who moved when rebalancing", async () => {
    const store = await openStore(dbWithPool());
    const root = mount(store);
    await click(root, "Start a session");
    await click(root, "Make the teams");
    await click(root, "Save set");
    await click(root, "Rebalance");

    expect(root.textContent).toContain("moved");
    expect(store.snapshot().sessions[0]!.lineups[1]!.note).toMatch(/^swapped /);
  });

  it("refuses a drawn set rather than storing nonsense", async () => {
    const store = await openStore(dbWithPool());
    const root = mount(store);
    await click(root, "Start a session");
    await click(root, "Make the teams");

    // Drive Navy up to 25 so both sides read 25.
    const plus = [...root.querySelectorAll("button")].filter((b) => b.getAttribute("aria-label")?.includes("more point for Navy"));
    for (let i = 0; i < 5; i += 1) plus[0]!.click();
    await click(root, "Save set");

    expect(root.textContent).toContain("cannot be a draw");
    expect(store.snapshot().sessions[0]!.sets).toHaveLength(0);
  });
});

describe("the invariant", () => {
  it("never renders an exact rating anywhere a player could read it", async () => {
    const store = await openStore(dbWithPool());
    const root = mount(store);
    await click(root, "Start a session");
    await click(root, "Make the teams");

    // Seeds are 1200/1350/1500/1650/1800. None of them may appear as text.
    for (const seed of [1200, 1350, 1500, 1650, 1800]) {
      expect(root.textContent).not.toContain(String(seed));
    }
    // Stars are shown instead.
    await click(root, "Pool");
    expect(root.textContent).toContain("★");
  });
});

describe("write failures", () => {
  it("says nothing was saved, and does not pretend the set exists", async () => {
    const store = await openStore(dbWithPool());
    const root = mount(store);
    await click(root, "Start a session");
    await click(root, "Make the teams");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, ok: false, json: async () => ({}) } as Response));
    await click(root, "Save set");

    expect(root.textContent).toContain("Nothing was saved");
    expect(store.snapshot().sessions[0]!.sets).toHaveLength(0);
  });
});

describe("player management", () => {
  const type = (root: HTMLElement, selector: string, value: string): void => {
    const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (!field) throw new Error(`no ${selector}`);
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("offers to add players when the pool is empty, instead of a dead end", async () => {
    const root = mount(await openStore({ schemaVersion: 1, players: [], sessions: [] }));
    expect(root.textContent).toContain("at least four players");
    await click(root, "Add players");
    expect(root.textContent).toContain("Paste names");
  });

  it("previews a paste before anything is written, and ignores the sheet's furniture", async () => {
    const store = await openStore({ schemaVersion: 1, players: [], sessions: [] });
    const root = mount(store);
    await click(root, "Add players");

    type(root, "textarea", "1. Nameless One\n2. Second Person\n29,17 PLN\nhttps://example.com/x");

    expect(root.textContent).toContain("Will add 2");
    expect(root.textContent).toContain("Ignored 2 lines");
    // Still nothing written.
    expect(store.snapshot().players).toHaveLength(0);

    await click(root, "Add 2 players");
    expect(store.snapshot().players.map((p) => p.name)).toEqual(["Nameless One", "Second Person"]);
    // Default starting level is three stars, the middle band.
    expect(store.snapshot().players.every((p) => p.seedRating === 1500)).toBe(true);
  });

  it("flags names already in the pool rather than duplicating them", async () => {
    const store = await openStore(dbWithPool());
    const root = mount(store);
    await click(root, "Manage players");
    await click(root, "Add players");

    type(root, "textarea", "Andrii\nBrand New");
    expect(root.textContent).toContain("Already in the pool");
    await click(root, "Add 1 player");
    expect(store.snapshot().players.filter((p) => p.name === "Andrii")).toHaveLength(1);
  });

  it("corrects a starting level and re-settles the history", async () => {
    const store = await openStore(dbWithPool());
    const root = mount(store);
    await click(root, "Manage players");
    await click(root, "Kateryna");

    expect(root.textContent).toContain("Starting level");
    // Kateryna is seeded at three stars; promote the seed to five.
    const five = [...root.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "5 stars");
    five!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.snapshot().players.find((p) => p.id === "kateryna")!.seedRating).toBe(1800);
  });

  it("renames a player", async () => {
    const store = await openStore(dbWithPool());
    const root = mount(store);
    await click(root, "Manage players");
    await click(root, "Vika");
    type(root, ".card input", "Vika K.");
    await click(root, "Save name");
    expect(store.snapshot().players.find((p) => p.id === "vika")!.name).toBe("Vika K.");
  });

  it("refuses to delete someone who has played, and says what to do instead", async () => {
    const db = dbWithPool();
    const store = await openStore(db);
    const root = mount(store);

    // Play one set so everyone on court has history.
    await click(root, "Start a session");
    await click(root, "Make the teams");
    await click(root, "Save set");
    await click(root, "Pool");
    await click(root, "Manage players");

    const played = store.snapshot().sessions[0]!.sets[0]!.sideA.players[0] as string;
    const name = store.snapshot().players.find((p) => p.id === played)!.name;
    await click(root, name);

    expect(root.textContent).toContain("cannot be deleted");
    expect(root.textContent).toContain("Mark them inactive");
    expect([...root.querySelectorAll("button")].some((b) => b.textContent === "Delete")).toBe(false);
  });

  it("deletes someone who has never played", async () => {
    const store = await openStore(dbWithPool());
    const root = mount(store);
    await click(root, "Manage players");
    await click(root, "Ivan");
    await click(root, "Delete");
    expect(store.snapshot().players.map((p) => p.id)).not.toContain("ivan");
  });
});

describe("throwing away a practice run", () => {
  it("deletes a session and puts every rating back exactly", async () => {
    const store = await openStore(dbWithPool());
    const root = mount(store);

    const before = JSON.stringify([...store.standings().entries()].sort());

    await click(root, "Start a session");
    await click(root, "Make the teams");
    await click(root, "Save set");
    await click(root, "Rebalance");
    await click(root, "Save set");
    await click(root, "End session");
    expect(JSON.stringify([...store.standings().entries()].sort())).not.toBe(before);

    // The summary screen offers to bin it straight away.
    await click(root, "Delete this session");
    expect(root.textContent).toContain("Really delete");
    await click(root, "Really delete");

    expect(store.snapshot().sessions).toHaveLength(0);
    expect(JSON.stringify([...store.standings().entries()].sort())).toBe(before);
  });

  it("asks before deleting, and keeps the session if told to", async () => {
    const store = await openStore(dbWithPool());
    const root = mount(store);
    await click(root, "Start a session");
    await click(root, "Make the teams");
    await click(root, "Save set");
    await click(root, "End session");
    await click(root, "Done");

    await click(root, "Sessions (1)");
    await click(root, "Delete");
    await click(root, "Keep");
    expect(store.snapshot().sessions).toHaveLength(1);
  });

  it("can reopen a session ended by mistake", async () => {
    const store = await openStore(dbWithPool());
    const root = mount(store);
    await click(root, "Start a session");
    await click(root, "Make the teams");
    await click(root, "Save set");
    await click(root, "End session");
    await click(root, "Done");

    await click(root, "Sessions (1)");
    await click(root, "Reopen");
    expect(store.snapshot().sessions[0]!.closedAt).toBeNull();
    // Back on the court, with the set still there.
    expect(root.textContent).toContain("1 set on these teams");
  });
});
