# A private GitHub repo is the database

The app stores all state as a single JSON document in a private GitHub repo, written from the phone browser via the GitHub Contents API, with no backend of our own. It was chosen over Supabase, Neon, Turso, Cloudflare D1 and Firestore on one criterion that outranked every other: **a repo has no idle state.** Sessions happen once a week, and several free database tiers pause or cold-start idle projects — Supabase's free tier pauses after a week of inactivity, which a weekly Sunday session guarantees. A database that needs a manual dashboard click at the start of a session is a product failure regardless of how good it is the rest of the time.

## Consequences

- No backend exists to write. `api.github.com` sends CORS headers, so the storage layer is `fetch` plus a fine-grained PAT, and that token *is* the shared secret — no auth system gets created for what is a single-writer app.
- The Contents API's blob-`sha` precondition makes the single-writer model native: a stale base returns `409` rather than silently clobbering.
- Git history is free undo, and the organizer can hand-fix a mistyped score from github.com on a phone.
- The data repo must be **separate from the Pages repo**. GitHub Pages soft-limits builds to 10/hour, so committing scores into the site's own repo would throttle deploys mid-session.
- Writes take roughly 0.5–1s and there is no `WHERE` clause. Both are acceptable at this scale; neither would be at ten times it.
- Google Sheets plus an Apps Script web app was the runner-up, and is the switch to make if the player list turns out to already live in a spreadsheet.
