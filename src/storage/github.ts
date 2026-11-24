import { AVATAR_CACHE_KEY, DATA_REPO, TOKEN_STORAGE_KEY } from "../config.js";
import type { Db } from "../core/types.js";

/**
 * The read/write layer against the GitHub Contents API (ADR 0001).
 *
 * Two properties matter more than anything else here:
 *
 * 1. **Writes carry the blob sha as a precondition.** A stale sha means
 *    something else wrote since we read, and GitHub rejects us rather than
 *    letting us clobber it. That rejection is the whole reason the
 *    single-writer model is safe, so it is modelled explicitly as a conflict
 *    outcome rather than lumped in with "failed".
 *
 * 2. **A failure is never silent.** There is no offline queue (#7, #10), so an
 *    app that looks like it saved when it did not is the one unacceptable
 *    behaviour. Every write returns a discriminated outcome the caller has to
 *    narrow before it can reach the sha — ignoring the failure does not
 *    typecheck.
 */

export const EMPTY_DB: Db = { schemaVersion: 1, players: [], sessions: [] };

export type Avatars = Record<string, string>;

export const getToken = (): string | null => localStorage.getItem(TOKEN_STORAGE_KEY);
export const setToken = (token: string): void => localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
export const clearToken = (): void => localStorage.removeItem(TOKEN_STORAGE_KEY);

export class StorageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export interface LoadedDocument {
  db: Db;
  /** Null when the document does not exist yet — a legitimate first run. */
  sha: string | null;
}

/**
 * The result of a write. `ok: false` carries a message already phrased for a
 * person holding a phone, and a conflict carries the fresher state so the
 * caller can merge rather than guess.
 */
export type SaveOutcome =
  | { ok: true; sha: string }
  | { ok: false; kind: "conflict"; message: string; theirs: LoadedDocument }
  | { ok: false; kind: "failed"; message: string; status?: number };

const apiUrl = (path: string, withRef: boolean): string => {
  const base = `https://api.github.com/repos/${DATA_REPO.owner}/${DATA_REPO.repo}/contents/${path}`;
  return withRef ? `${base}?ref=${DATA_REPO.branch}` : base;
};

const headers = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

/** GitHub's base64 arrives wrapped; both directions must be UTF-8 safe,
 *  because the player names are not ASCII. */
const decodeBase64 = (content: string): string => {
  const binary = atob(content.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
};

const encodeBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const describeStatus = (status: number): string | null => {
  if (status === 401) return "That token was rejected. Check it has not expired or been revoked.";
  if (status === 403) return "That token is missing Contents write access to the data repo.";
  return null;
};

/** Fetch one file. Null means it does not exist, which is not an error. */
export async function getFile(
  token: string,
  path: string,
): Promise<{ text: string; sha: string } | null> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path, true), { headers: headers(token) });
  } catch {
    throw new StorageError("Could not reach GitHub. Check the connection and try again.");
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new StorageError(
      describeStatus(response.status) ?? `GitHub returned ${String(response.status)} loading ${path}.`,
      response.status,
    );
  }

  const payload = (await response.json()) as { content: string; sha: string };
  return { text: decodeBase64(payload.content), sha: payload.sha };
}

/** Write one file, whole-document replace, with the sha as precondition. */
export async function putFile(args: {
  token: string;
  path: string;
  text: string;
  /** Null creates the file; a value updates it and must be current. */
  sha: string | null;
  message: string;
}): Promise<SaveOutcome> {
  const body: Record<string, string> = {
    message: args.message,
    content: encodeBase64(args.text),
    branch: DATA_REPO.branch,
  };
  if (args.sha !== null) body.sha = args.sha;

  let response: Response;
  try {
    response = await fetch(apiUrl(args.path, false), {
      method: "PUT",
      headers: { ...headers(args.token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, kind: "failed", message: "Nothing was saved — GitHub could not be reached." };
  }

  // 409 is the documented conflict. 422 covers a sha that is absent or stale
  // on an existing file, which is the same situation wearing a different code.
  if (response.status === 409 || response.status === 422) {
    const theirs = await loadDocumentFrom(args.token, args.path).catch(() => null);
    return {
      ok: false,
      kind: "conflict",
      message: "Nothing was saved — this data changed somewhere else since it was loaded.",
      theirs: theirs ?? { db: EMPTY_DB, sha: null },
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      kind: "failed",
      message: describeStatus(response.status) ?? `Nothing was saved — GitHub returned ${String(response.status)}.`,
      status: response.status,
    };
  }

  const payload = (await response.json()) as { content: { sha: string } };
  return { ok: true, sha: payload.content.sha };
}

const parseDb = (text: string): Db => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return EMPTY_DB;

  let parsed: Db;
  try {
    parsed = JSON.parse(trimmed) as Db;
  } catch {
    throw new StorageError("The data document is not valid JSON. It may have been hand-edited badly.");
  }
  if (parsed.schemaVersion !== 1) {
    throw new StorageError(
      `This data was written by a newer version of the app (schema ${String(parsed.schemaVersion)}).`,
    );
  }
  return parsed;
};

async function loadDocumentFrom(token: string, path: string): Promise<LoadedDocument> {
  const file = await getFile(token, path);
  if (file === null) return { db: EMPTY_DB, sha: null };
  return { db: parseDb(file.text), sha: file.sha };
}

export const loadDocument = (token: string): Promise<LoadedDocument> =>
  loadDocumentFrom(token, DATA_REPO.path);

export const saveDocument = (token: string, db: Db, sha: string | null, message: string): Promise<SaveOutcome> =>
  putFile({ token, path: DATA_REPO.path, text: `${JSON.stringify(db, null, 2)}\n`, sha, message });

/**
 * Avatars live in their own document and are fetched once per load, then
 * cached (#9).
 *
 * Keeping them out of the main document is not tidiness: storage is
 * whole-document replace, so embedded photos would be re-uploaded on every
 * single set saved.
 */
export async function loadAvatars(token: string): Promise<Avatars> {
  const cached = localStorage.getItem(AVATAR_CACHE_KEY);
  if (cached !== null) {
    try {
      return JSON.parse(cached) as Avatars;
    } catch {
      localStorage.removeItem(AVATAR_CACHE_KEY);
    }
  }

  const file = await getFile(token, DATA_REPO.avatarsPath).catch(() => null);
  if (file === null) return {};

  let avatars: Avatars;
  try {
    avatars = JSON.parse(file.text.trim() || "{}") as Avatars;
  } catch {
    return {};
  }
  localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(avatars));
  return avatars;
}

export const clearAvatarCache = (): void => localStorage.removeItem(AVATAR_CACHE_KEY);
