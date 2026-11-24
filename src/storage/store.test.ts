import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "./store.js";
import type { Db } from "../core/types.js";

const TOKEN = "github_pat_example";

const base64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const jsonResponse = (status: number, body: unknown): Response =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

const dbWith = (names: string[]): Db => ({
  schemaVersion: 1,
  players: names.map((name) => ({ id: name.toLowerCase(), name, active: true, seedRating: 1500 })),
  sessions: [],
});

const docResponse = (db: Db, sha: string) => jsonResponse(200, { content: base64(JSON.stringify(db)), sha });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Store", () => {
  it("reports a first run when no document exists", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    const store = await Store.open(TOKEN);
    expect(store.isFirstRun).toBe(true);
    expect(store.snapshot().players).toEqual([]);
  });

  it("derives standings from the document rather than reading them", async () => {
    fetchMock.mockResolvedValueOnce(docResponse(dbWith(["Andrii"]), "sha1"));
    const store = await Store.open(TOKEN);
    expect(store.standings().get("andrii")).toMatchObject({ rating: 1500, stars: 3, setsPlayed: 0 });
  });

  it("applies a change only once GitHub has accepted it", async () => {
    fetchMock
      .mockResolvedValueOnce(docResponse(dbWith(["Andrii"]), "sha1"))
      .mockResolvedValueOnce(jsonResponse(200, { content: { sha: "sha2" } }));

    const store = await Store.open(TOKEN);
    const outcome = await store.commit((draft) => {
      draft.players.push({ id: "vika", name: "Vika", active: true, seedRating: 1650 });
    }, "add Vika");

    expect(outcome.ok).toBe(true);
    expect(store.snapshot().players.map((p) => p.id)).toEqual(["andrii", "vika"]);
    // The next write must carry the sha GitHub just returned.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: { sha: "sha3" } }));
    await store.commit(() => undefined, "noop");
    const body = JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string) as { sha: string };
    expect(body.sha).toBe("sha2");
  });

  it("leaves local state untouched when the write fails", async () => {
    fetchMock
      .mockResolvedValueOnce(docResponse(dbWith(["Andrii"]), "sha1"))
      .mockResolvedValueOnce(jsonResponse(500, {}));

    const store = await Store.open(TOKEN);
    const outcome = await store.commit((draft) => {
      draft.players.push({ id: "vika", name: "Vika", active: true, seedRating: 1650 });
    }, "add Vika");

    expect(outcome.ok).toBe(false);
    // The screen must not show a player who was never stored.
    expect(store.snapshot().players.map((p) => p.id)).toEqual(["andrii"]);
  });

  it("adopts the other side's document on a conflict, discarding the local change", async () => {
    const theirs = dbWith(["Andrii", "Dmytro"]);
    fetchMock
      .mockResolvedValueOnce(docResponse(dbWith(["Andrii"]), "sha1"))
      .mockResolvedValueOnce(jsonResponse(409, {}))
      .mockResolvedValueOnce(docResponse(theirs, "theirs"));

    const store = await Store.open(TOKEN);
    const outcome = await store.commit((draft) => {
      draft.players.push({ id: "vika", name: "Vika", active: true, seedRating: 1650 });
    }, "add Vika");

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.kind !== "conflict") throw new Error("expected a conflict");
    expect(store.snapshot().players.map((p) => p.id)).toEqual(["andrii", "dmytro"]);
  });

  it("does not mutate the live document when the mutation throws", async () => {
    fetchMock.mockResolvedValueOnce(docResponse(dbWith(["Andrii"]), "sha1"));
    const store = await Store.open(TOKEN);

    await expect(
      store.commit(() => {
        throw new Error("boom");
      }, "bad"),
    ).rejects.toThrow("boom");
    expect(store.snapshot().players.map((p) => p.id)).toEqual(["andrii"]);
  });
});
