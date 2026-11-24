import { DATA_REPO } from "../config.js";
import { getFile, putFile } from "./github.js";

/**
 * Proves the write path from the actual phone, before the session flow exists.
 *
 * It writes to `diagnostics.json`, not `db.json`: demonstrating that writing
 * works should not leave a diagnostic marker in the real data. Same code path,
 * different file.
 */

export interface CheckResult {
  ok: boolean;
  headline: string;
  detail: string;
}

const STALE_SHA = "0000000000000000000000000000000000000000";

/** Write, then read back, and confirm what came back is what went in. */
export async function runWriteCheck(token: string): Promise<CheckResult> {
  const stamp = new Date().toISOString();
  const existing = await getFile(token, DATA_REPO.diagnosticsPath).catch(() => null);

  const outcome = await putFile({
    token,
    path: DATA_REPO.diagnosticsPath,
    text: `${JSON.stringify({ lastWriteCheck: stamp }, null, 2)}\n`,
    sha: existing?.sha ?? null,
    message: `Write check ${stamp}`,
  });

  if (!outcome.ok) {
    return { ok: false, headline: "Write failed", detail: outcome.message };
  }

  const readBack = await getFile(token, DATA_REPO.diagnosticsPath).catch(() => null);
  if (readBack === null) {
    return { ok: false, headline: "Write reported success but read back nothing", detail: "Do not trust this setup." };
  }

  const parsed = JSON.parse(readBack.text) as { lastWriteCheck?: string };
  if (parsed.lastWriteCheck !== stamp) {
    return {
      ok: false,
      headline: "Read back the wrong content",
      detail: `Expected ${stamp}, got ${String(parsed.lastWriteCheck)}.`,
    };
  }

  return {
    ok: true,
    headline: "Write and read back both work",
    detail: `Stored and confirmed ${stamp}. Reload this page and it will still be there.`,
  };
}

/**
 * Deliberately writes with a stale sha.
 *
 * A pass here means GitHub rejected the write and the app said so. That
 * rejection is what makes the single-writer model safe, so it is worth being
 * able to see it happen rather than trusting that it would.
 */
export async function runConflictCheck(token: string): Promise<CheckResult> {
  const outcome = await putFile({
    token,
    path: DATA_REPO.diagnosticsPath,
    text: `${JSON.stringify({ shouldNeverBeStored: true }, null, 2)}\n`,
    sha: STALE_SHA,
    message: "Conflict check — this commit should never exist",
  });

  if (outcome.ok) {
    return {
      ok: false,
      headline: "A stale write was accepted",
      detail: "GitHub should have rejected this. Writes could silently overwrite each other.",
    };
  }
  if (outcome.kind !== "conflict") {
    return { ok: false, headline: "Rejected, but not as a conflict", detail: outcome.message };
  }
  return {
    ok: true,
    headline: "Stale write correctly refused",
    detail: `${outcome.message} Nothing was overwritten, and you were told.`,
  };
}
