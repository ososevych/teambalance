import { loadDocument, saveDocument, type LoadedDocument, type SaveOutcome } from "./github.js";
import { replay } from "../core/replay.js";
import type { Db, Standings } from "../core/types.js";

/**
 * Holds the loaded document and the blob sha that every write needs.
 *
 * `commit` applies the change to a copy first and only swaps it in once GitHub
 * has accepted it. So a failed write leaves the in-memory state exactly as it
 * was, and the screen cannot drift away from what is actually stored — which
 * is the failure mode that matters when there is no offline queue.
 */
export class Store {
  private constructor(
    private readonly token: string,
    private db: Db,
    private sha: string | null,
  ) {}

  static async open(token: string): Promise<Store> {
    const loaded: LoadedDocument = await loadDocument(token);
    return new Store(token, loaded.db, loaded.sha);
  }

  /** The current document. Treat as read-only; change it through `commit`. */
  snapshot(): Db {
    return this.db;
  }

  /** Whether a document exists yet in the repo. */
  get isFirstRun(): boolean {
    return this.sha === null;
  }

  /** Every rating, counter and star band, derived (ADR 0002). */
  standings(): Standings {
    return replay(this.db);
  }

  /**
   * Apply a change and persist it.
   *
   * On conflict the local state is left untouched and the caller is handed the
   * fresher document, so it can re-apply rather than guess.
   */
  async commit(mutate: (draft: Db) => void, message: string): Promise<SaveOutcome> {
    const draft = structuredClone(this.db);
    mutate(draft);

    const outcome = await saveDocument(this.token, draft, this.sha, message);
    if (outcome.ok) {
      this.db = draft;
      this.sha = outcome.sha;
    } else if (outcome.kind === "conflict") {
      this.db = outcome.theirs.db;
      this.sha = outcome.theirs.sha;
    }
    return outcome;
  }

  /** Discard local state and re-read. */
  async reload(): Promise<void> {
    const loaded = await loadDocument(this.token);
    this.db = loaded.db;
    this.sha = loaded.sha;
  }

  /** Deliberately corrupt the sha. Used only by the write-path self-check. */
  forceStaleShaForTesting(): void {
    this.sha = "0000000000000000000000000000000000000000";
  }
}
