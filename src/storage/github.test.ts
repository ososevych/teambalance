import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAvatarCache, getFile, loadAvatars, loadDocument, putFile, saveDocument, StorageError } from "./github.js";
import type { Db } from "../core/types.js";

const TOKEN = "github_pat_example";

/** Minimal localStorage, because the avatar cache uses it and this is node. */
const makeLocalStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
};

const base64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const jsonResponse = (status: number, body: unknown): Response =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("localStorage", makeLocalStorage());
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("encoding", () => {
  it("survives a round trip through non-ASCII player names", async () => {
    // The pool is Ukrainian; a latin1 shortcut would corrupt every name.
    const db: Db = {
      schemaVersion: 1,
      players: [{ id: "kateryna", name: "Катерина Ш.", active: true, seedRating: 1500 }],
      sessions: [],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: { sha: "new" } }));

    const outcome = await saveDocument(TOKEN, db, "old", "test");
    expect(outcome.ok).toBe(true);

    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { content: string };
    const binary = atob(sent.content);
    const decoded = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    expect(JSON.parse(decoded)).toEqual(db);
    expect(decoded).toContain("Катерина Ш.");
  });

  it("reads GitHub's line-wrapped base64", async () => {
    const payload = base64('{"schemaVersion":1,"players":[],"sessions":[]}');
    const wrapped = `${payload.slice(0, 10)}\n${payload.slice(10)}\n`;
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: wrapped, sha: "abc" }));

    const loaded = await loadDocument(TOKEN);
    expect(loaded.db.schemaVersion).toBe(1);
    expect(loaded.sha).toBe("abc");
  });
});

describe("loading", () => {
  it("treats a missing document as a first run, not a failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    const loaded = await loadDocument(TOKEN);
    expect(loaded).toEqual({ db: { schemaVersion: 1, players: [], sessions: [] }, sha: null });
  });

  it("treats an empty document as a first run too", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: base64("  \n"), sha: "abc" }));
    const loaded = await loadDocument(TOKEN);
    expect(loaded.db.players).toEqual([]);
    expect(loaded.sha).toBe("abc");
  });

  it("explains a rejected token rather than reporting a number", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    await expect(loadDocument(TOKEN)).rejects.toThrow(/expired or been revoked/);
  });

  it("explains a token missing write access", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, {}));
    await expect(loadDocument(TOKEN)).rejects.toThrow(/missing Contents write access/);
  });

  it("explains a hand-edited document that no longer parses", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: base64("{ oops"), sha: "abc" }));
    await expect(loadDocument(TOKEN)).rejects.toThrow(/not valid JSON/);
  });

  it("refuses data written by a newer schema instead of silently misreading it", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { content: base64('{"schemaVersion":2,"players":[],"sessions":[]}'), sha: "abc" }),
    );
    await expect(loadDocument(TOKEN)).rejects.toThrow(/newer version/);
  });

  it("reports an unreachable network as such", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    await expect(getFile(TOKEN, "db.json")).rejects.toBeInstanceOf(StorageError);
  });
});

describe("the sha precondition", () => {
  it("omits the sha when creating the document", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { content: { sha: "created" } }));
    await putFile({ token: TOKEN, path: "db.json", text: "{}", sha: null, message: "create" });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.sha).toBeUndefined();
    expect(body.message).toBe("create");
  });

  it("sends the sha when updating, so a stale write cannot clobber", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: { sha: "next" } }));
    await putFile({ token: TOKEN, path: "db.json", text: "{}", sha: "current", message: "update" });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.sha).toBe("current");
  });
});

describe("conflicts", () => {
  const theirDoc = { content: base64('{"schemaVersion":1,"players":[{"id":"x","name":"X","active":true,"seedRating":1500}],"sessions":[]}'), sha: "theirs" };

  it("reports a 409 as a conflict and hands back the fresher document", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(409, {}))
      .mockResolvedValueOnce(jsonResponse(200, theirDoc));

    const outcome = await putFile({ token: TOKEN, path: "db.json", text: "{}", sha: "stale", message: "m" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.kind !== "conflict") throw new Error("expected a conflict");
    expect(outcome.message).toMatch(/Nothing was saved/);
    expect(outcome.theirs.sha).toBe("theirs");
    expect(outcome.theirs.db.players).toHaveLength(1);
  });

  it("treats a 422 as the same situation, since a stale sha can surface either way", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(422, {}))
      .mockResolvedValueOnce(jsonResponse(200, theirDoc));

    const outcome = await putFile({ token: TOKEN, path: "db.json", text: "{}", sha: "stale", message: "m" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.kind).toBe("conflict");
  });
});

describe("write failures are never silent", () => {
  it("returns a person-shaped message when the network dies mid-write", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    const outcome = await putFile({ token: TOKEN, path: "db.json", text: "{}", sha: "s", message: "m" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.message).toMatch(/^Nothing was saved/);
  });

  it("says nothing was saved for any other error status", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
    const outcome = await putFile({ token: TOKEN, path: "db.json", text: "{}", sha: "s", message: "m" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.kind !== "failed") throw new Error("expected a plain failure");
    expect(outcome.message).toMatch(/^Nothing was saved/);
    expect(outcome.status).toBe(500);
  });
});

describe("avatars", () => {
  it("is fetched from its own document, never the main one", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: base64('{"x":"data:image/jpeg;base64,AAA"}'), sha: "a" }));
    const avatars = await loadAvatars(TOKEN);
    expect(avatars.x).toMatch(/^data:image\/jpeg/);
    expect(fetchMock.mock.calls[0]![0]).toContain("avatars.json");
  });

  it("is cached, so photos are not refetched on every load", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: base64('{"x":"data:image/jpeg;base64,AAA"}'), sha: "a" }));
    await loadAvatars(TOKEN);
    const callsAfterFirst = fetchMock.mock.calls.length;

    const second = await loadAvatars(TOKEN);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    expect(second.x).toBeDefined();

    clearAvatarCache();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: base64("{}"), sha: "b" }));
    await loadAvatars(TOKEN);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("degrades to no photos rather than breaking the evening", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    expect(await loadAvatars(TOKEN)).toEqual({});

    vi.stubGlobal("localStorage", makeLocalStorage());
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: base64("{ broken"), sha: "a" }));
    expect(await loadAvatars(TOKEN)).toEqual({});
  });
});
