/**
 * Where the data lives.
 *
 * Deliberately a SEPARATE repo from this one: GitHub Pages soft-limits builds
 * to 10/hour, so committing scores into the site's own repo would throttle
 * deploys mid-session (ADR 0001).
 *
 * None of this is secret. The write credential is pasted by the organizer at
 * runtime and kept in localStorage — never in this bundle (#10).
 */
export const DATA_REPO = {
  owner: "ososevych",
  repo: "teambalance-data",
  /** The single document holding players and sessions. */
  path: "db.json",
  /** Avatars, kept separate so they are never part of a write (#9). */
  avatarsPath: "avatars.json",
  branch: "main",
} as const;

export const TOKEN_STORAGE_KEY = "teambalance.token";
export const AVATAR_CACHE_KEY = "teambalance.avatars";
