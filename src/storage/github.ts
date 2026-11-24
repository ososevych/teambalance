import { DATA_REPO, TOKEN_STORAGE_KEY } from "../config.js";
import type { Db } from "../core/types.js";

/**
 * Minimal read path against the GitHub Contents API, enough for #11.
 *
 * The full layer — writes with the blob-sha precondition, 409 handling, and
 * unmistakable failure surfacing — is #12. Nothing here writes.
 */

export const EMPTY_DB: Db = { schemaVersion: 1, players: [], sessions: [] };

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
  /** The blob sha, which #12 will pass back as the write precondition. */
  sha: string | null;
}

const contentsUrl = (path: string): string =>
  `https://api.github.com/repos/${DATA_REPO.owner}/${DATA_REPO.repo}/contents/${path}?ref=${DATA_REPO.branch}`;

/** Decode GitHub's base64 (which arrives with newlines) as UTF-8. */
const decodeBase64 = (content: string): string => {
  const binary = atob(content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export async function loadDocument(token: string): Promise<LoadedDocument> {
  const response = await fetch(contentsUrl(DATA_REPO.path), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (response.status === 401) {
    throw new StorageError("That token was rejected. Check it has not expired or been revoked.", 401);
  }
  if (response.status === 403) {
    throw new StorageError("That token is missing Contents write access to the data repo.", 403);
  }
  if (response.status === 404) {
    // No document yet is a legitimate first-run state, not a failure.
    return { db: EMPTY_DB, sha: null };
  }
  if (!response.ok) {
    throw new StorageError(`GitHub returned ${response.status} loading the data.`, response.status);
  }

  const payload = (await response.json()) as { content: string; sha: string };
  const text = decodeBase64(payload.content).trim();
  const db = text.length === 0 ? EMPTY_DB : (JSON.parse(text) as Db);

  if (db.schemaVersion !== 1) {
    throw new StorageError(`This data was written by a newer version (schema ${String(db.schemaVersion)}).`);
  }

  return { db, sha: payload.sha };
}
