# Ratings are derived by replay, never stored

The append-only log of recorded sets is the single source of truth. Every rating, star band and counter is computed by replaying the rating rule over that log on load, and none of them is written back to a player record. A reader who expects to find `player.rating` in the stored document will not find it, and that is deliberate.

The reason is that two things are near-certain in the first month: a score will be typed wrong, and the short-handed handicap constant `H = 60` will turn out to be wrong. `H` rests on one person's estimate that a side of five beats an equal six about 40–45% of the time, and no prior art exists to check it against. Replay means a corrected score re-settles the whole history, and a recalibrated `H` re-rates every past set. Storing mutable ratings would freeze both mistakes permanently, unless every delta were also stored so it could be reversed — which is a worse version of keeping the log.

A season is a few hundred sets, so replay cost is irrelevant.

## Consequences

- **Star bands must be evaluated at each session boundary during replay, in order** — not computed once from the final rating. The one-session demotion lag is stateful: a player who falls below a threshold keeps the star through one further session-end evaluation. Deriving stars from the final rating alone silently produces different, wrong answers. This is the most likely bug in the codebase and is worth a dedicated test.
- Each set snapshots its own credited rosters rather than pointing at a lineup for them, so replay depends on nothing outside the set record and editing a lineup can never retroactively re-rate played sets.
- Lineups are still stored alongside, because a lineup is the *plan* and a set's roster is the *record*; they are allowed to differ, and a generated-but-unplayed split needs to survive a tab reload.
- Deleting a mid-session set legitimately changes the expectations of later sets that evening. That is correct: those sets really were played at different ratings.
