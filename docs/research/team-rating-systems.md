# Research: how rec-sport systems rate team play from individual ratings

Resolves [#3](https://github.com/ososevych/teambalance/issues/3). Map: [#1](https://github.com/ososevych/teambalance/issues/1).

**Every number below is tagged.** `[SOURCED]` = stated by the system that owns it or by a published rule. `[JUDGEMENT]` = my engineering judgement, no source; ticket #6 owns the final value. `[UNVERIFIED]` = claimed by a secondary source, not confirmed against the operator.

**Sourcing note.** Playtomic's own web hosts (`playtomic.com`, `playerhelp.playtomic.com`) returned HTTP 403 to the research fetcher. The first-party help-centre content below was instead retrieved from the help centre's public JSON API, which serves the same articles:
`https://playerhelp.playtomic.com/api/v2/help_center/en-gb/articles/43310980754193.json` ("How the Playtomic level system works", edited 2026-10-20) and `.../19831827459345.json` ("The Playtomic Levels: ups & downs", edited 2026-06-09). Quotes marked *(Playtomic, first-party)* are verbatim from those article bodies. The blog page `https://playtomic.com/blog/padel-levels` could not be read (403) and was not retried.

---

## 1. Playtomic's padel level system

### What Playtomic itself says

**Scale.** "The **Playtomic levels range from 0 to 7**." `[SOURCED]` *(Playtomic, first-party)*. The level description chart is served as an image, so the per-level wording was not machine-readable.

**Step size.** Multiple secondary write-ups state the level moves "in steps of 0.25" between 0.0 and 7.0. **No first-party statement of a 0.25 step was found** in either help article. `[UNVERIFIED]` — flag for ticket #6; do not treat the quarter-point step as an operator fact.

**Initialisation — not uniform.** "When you first join Playtomic, we need to understand your skill level... you'll complete a brief level assessment with questions about your playing experience and abilities. This initial assessment can only be completed once and gives you your **starting level**." `[SOURCED]`. There are two other entry paths: a professional **leveling session** at a certified club, and the player may **manually lower** their own level through the app ("Lower your level manually – You can adjust your level downward through the app"). Downward only. `[SOURCED]`

**Reliability is modelled, and it dominates.** "**This is the most important factor affecting your level changes**. Reliability indicates how confident the system is about your current level." `[SOURCED]` And: "Lower reliability = larger level changes... Higher reliability = smaller level changes." `[SOURCED]`

The only hard reliability number Playtomic publishes: "if you complete a leveling session at one of our certified clubs, your reliability is **automatically set to medium (50%)**." `[SOURCED]` So 50% is the operator's own label for *medium*. Reliability "is set automatically by the system — neither you nor Playtomic Customer Care can adjust it manually," and rises only by playing competitive matches. `[SOURCED]`

Secondary sources add that new accounts sit at ~50% reliability, that ~85% counts as "validated", that levels settle after 15–20 rated matches, and that a single early result can swing a level by half a point or more. **None of that is in the first-party articles.** `[UNVERIFIED]` (secondary: padelradar.io, simplepadel.com, playformore.app).

**How much one match moves it.** Playtomic publishes **no magnitude at all** — no K, no cap, no per-match maximum. It states only the direction and the relative ordering: "Winning against higher-level players will increase your level more significantly. Conversely, losing to lower-level players will decrease your level more notably." `[SOURCED]` Any specific "one match moves you X" figure in circulation is reconstruction.

**Team rating from individuals — this is the key quote.** "After each **competitive match**, our algorithm considers the **level and reliability of all players** involved. It **calculates the average level per team**, compares the expected outcome with the actual result, and adjusts each player's level accordingly." `[SOURCED]`

So the organizer's reference system is: **mean of players per side, expected-vs-actual on that mean, Elo-shaped.** That is direct first-party support for the mean-of-players approach in section 2.

**Not the same delta to every player.** "You may notice that your level changes differently than your partner's after the same match. This is normal... Each player has a different reliability score / The algorithm considers each player's current level relative to opponents / Players with lower reliability will see larger level swings." `[SOURCED]`

**Margin of victory: Playtomic appears NOT to use it.** The published factor list is exactly four items — match result, opponent levels, partner level, your reliability `[SOURCED]`. Score margin is absent. The only role the score plays is a **validity gate**: "For a set to count toward level changes, it must meet these conditions: One player/team must have more points than the other; At least one player/team must have scored 6 or 7 points; If neither has scored 7 points, there must be a 2-point difference (e.g., 6-4 is valid, 6-5 is not); If either has scored 7 points, a 1-point difference is acceptable (e.g., 7-6 is valid)." `[SOURCED]` That is a well-formed-padel-set check, not a margin term. *Caveat: absence from a help page is not proof of absence from the algorithm — but the operator's own description of its factors does not include margin.*

**Ties move ratings.** "Even in tied matches, levels will change. The team with the higher **combined** level will lose points, while the team with the lower level will gain points. This helps balance the system over time." `[SOURCED]` Note "combined" here vs "average" elsewhere — with fixed 2v2 padel the two are the same up to a constant, so nothing can be inferred about mean-vs-sum from this.

**Shown vs stored.** **No first-party statement found.** `[UNVERIFIED]` What is certain is that Playtomic stores *more state than it shows as the level*: a reliability percentage exists alongside it. Whether the level itself is stored at finer precision than displayed is undocumented.

**Other matches that don't count:** casual (friendly) matches never affect level; results rejected by a player don't count; a match where **nobody on one team had a level** doesn't count (in private/Open matches one levelled player per team suffices); and levels are never applied retroactively to a match you joined before having a level. `[SOURCED]`

### What this means for us

Four deliberate divergences from the reference point, each already settled by map decisions:

| Playtomic | This app | Why |
| --- | --- | --- |
| Questionnaire-seeded start, per player | Uniform cold start, everyone equal | Map decision 6 — current practice is random splits, so uniform is no worse |
| Reliability % as the dominant modifier | Games-played counter driving K | Map decision 4 — no Glicko/TrueSkill in v1; provisional K is the cheap surrogate |
| Different delta per player (reliability differs) | Same delta per side, except provisional players move further | Partial recovery of the same effect |
| No margin term | Margin is **required** | Map "settled while charting" item 2 — 25–23 must move less than 25–10 |

Competitors (Matchi, Tenup, Padel Manager, OpenPadel) were **not** reached inside budget. `[UNVERIFIED — not investigated]` Given Playtomic is the organizer's actual reference point and it publishes the mean-of-team statement we needed, this is a low-value gap.

---

## 2. Team Elo from individual ratings

**The standard approach** is to take each side's rating as the **mean** of its players' ratings, compute one expected score, and apply the resulting delta to every player on the side. This is what Playtomic does ("average level per team", above, `[SOURCED]`) and what public team-Elo implementations do — e.g. point-based and margin-based team Elo projects compute "pre-match strength... using the average Elo of participating players" `[SOURCED]` (secondary summary of several open implementations).

**Mean vs sum.** For this app the question answers itself: sides are **unequal in size** (6v5, 6v7). A sum makes a 7-player side mechanically "stronger" than a 6-player side of identical players, which is nonsense — the extra player does not add court presence, only rotation. **Use the mean.** `[JUDGEMENT, forced by the domain]` Map decision 7 already compares average rating per side for balancing, so using the mean in the rating update keeps balancing and rating on the same statistic — worth preserving deliberately, since a mismatch there would let the balancer aim at a target the rating system doesn't reward.

**Failure modes of mean + same-delta:**

1. **The carried strong player.** A high-rated player on a weak side has a low team expectation; when the side loses they shed rating they didn't individually deserve to shed, and the weak teammates shed the same amount. Individual contribution is unidentifiable from the team result alone — "there is no real team-based rating system that is able to evaluate individual player performance" remains the honest summary `[SOURCED — secondary]`. In fixed-team games this compounds into the "Elo hell" complaint (en.wikipedia.org/wiki/Elo_hell).
2. **Why it is much weaker here.** The app **re-splits the same pool every session and 2–3 times per evening** (map: rebalance is a first-class action). Teammate assignment is therefore close to exchangeable across a player's history, so the carried/carrying bias averages out over sessions rather than accumulating. This is the single biggest reason mean + same-delta is defensible for this app and not for a MOBA ladder. `[JUDGEMENT]`
3. **Mean hides variance.** A side of {5★, 1★} and a side of {3★, 3★} have the same mean but different real strength — in volleyball the weak player is targeted by the opponent's serve, so the high-variance side is usually *weaker* than its mean. This is a **balancer** concern (ticket for team generation), not a rating-formula concern: it argues for penalising within-side spread when generating lineups, not for changing the update rule. `[JUDGEMENT]`
4. **Zero-sum breaks when K differs.** If a provisional player (high K) plays against settled players (low K), the deltas on the two sides no longer cancel and the pool mean drifts. Since star bands are thresholds on absolute ratings, drift silently re-bands everyone. See the normalisation rule in section 8. `[JUDGEMENT]`

**Alternatives considered and rejected for v1:**

- **Düring et al., "An Elo-type rating model for players and teams of variable strength"** (arXiv 2109.15046; Phil. Trans. R. Soc. A 380:20210155) — the principled treatment of exactly this problem: rating players from team results where team strength varies. `[SOURCED — paper exists and is on point]`; the kinetic/Boltzmann machinery is far past v1's budget. This is the right citation if the simple rule visibly misbehaves.
- **Whole-history / maximum-likelihood fits.** The `oadam/volley-elo` project fits volleyball ratings by maximising the log-likelihood over *all* observed point totals at once, treating each point as a mini-match, with time down-weighting `[SOURCED]`. Statistically better, but it is a batch re-fit — it cannot produce the "rating moved during the evening" behaviour the mid-session rebalance depends on.
- **Per-player weights** (weight the star player's rating higher in the mean). Volleyball rotates all six through every position and every player serves, so equal weighting is more defensible here than in sports with a ball-dominant role. `[JUDGEMENT]`
- **Glicko / TrueSkill** — excluded by map decision 4.

---

## 3. Margin of victory

**The FiveThirtyEight shape** is the standard reference. As widely reproduced:

```
MOV multiplier = ln(|PD| + 1) * ( 2.2 / ((ELO_winner - ELO_loser) * 0.001 + 2.2) )
```

`[SOURCED — secondary]` The formula is reproduced consistently across independent reconstructions (Chief Delphi, metricgate.com, Neil Paine's NHL methodology, model284, datafield.dev), but FiveThirtyEight's own methodology page was **not** fetched — the site has been shut down and first-party retrieval was out of budget. `[UNVERIFIED against 538 itself]`

Two separate ideas are bundled in there, and they should be judged separately:

1. **The `ln(|PD| + 1)` term.** The log is there to give **diminishing returns** on large margins: "a 40-point win won't count much differently than a 30-point win." `[SOURCED — secondary]` This is the part we want.
2. **The autocorrelation correction** `2.2 / (Δelo*0.001 + 2.2)`. Strong teams win more often *and* by more, so an uncorrected MOV term inflates them without bound; the correction shrinks the multiplier when the favourite wins. `[SOURCED — secondary]`

**What stays stable for a volleyball set (PD 2 to 25).** The requirement is a multiplier that is bounded, monotone, finite at PD=2, and saturating by PD≈20. A raw-linear term in PD fails: a 25–3 set would carry 11× the weight of a 25–23 set and a single blowout would dominate a player's history. A log term is bounded in practice over this range.

Proposed normalised form — divide by the log at a *reference* margin so the multiplier is ~1 for a typical set rather than ~2.2:

```
M(d) = ln(1 + d) / ln(1 + d_ref),  d = point differential,  d_ref = 8
M clamped to [0.5, 1.5]
```

`[JUDGEMENT — shape sourced from 538, normalisation and d_ref mine]`

| Set score | d | M(d) |
| --- | --- | --- |
| 25–23 | 2 | 0.50 |
| 25–20 | 5 | 0.82 |
| 25–17 | 8 | 1.00 |
| 25–15 | 10 | 1.09 |
| 25–10 | 15 | 1.26 |
| 25–5 | 20 | 1.39 |
| 25–0 | 25 | 1.48 |

This satisfies the map's requirement (25–23 moves half as much as 25–10), saturates, never reaches zero (a 2-point win is still a win and still moves the rating), and is bounded above by 1.5 — so the worst-case single-set delta is bounded, which is what makes the K and band-width arithmetic in sections 5 and 6 hold. Extra-long sets (28–26, deuce past 25) are handled unchanged since only `d` is read, not the winner's score.

**On the autocorrelation term:** recommend **omitting it in v1** `[JUDGEMENT]`. In a closed 20–30 player pool where every player's rating is only ever used *relative to the others in that pool*, and where sides are re-drawn constantly, systematic favourite inflation has much less room to run than in a fixed-team league. It also costs explainability, and the organizer has to be able to defend the number. Keep it on the shelf: if strong players visibly run away, add exactly the 538 term above before inventing anything.

---

## 4. Short-handed play (5 v 6)

**There is no prior art for rating a side playing a man down.** The budgeted search found no rating system, paper, or league rule covering it. Treat this as unsourced territory. `[UNVERIFIED — nothing found]`

The closest usable analogue is **Go handicapping**, where the handicap is expressed as a **rating offset**: one handicap stone is worth roughly one rank, the rating difference is adjusted by the handicap *before* computing the win probability, and the update then proceeds normally off the adjusted expectation `[SOURCED — secondary, Online Go forum/support]`. Age of Empires 2 players similarly reason about a resource handicap in Elo-points-equivalent terms (a +5% handicap estimated at ~100 Elo) `[SOURCED — secondary, community estimate]`.

**That is the right mechanism for us:** a short-handed side gets a **bonus added to its effective team rating** used in the expected-score calculation. Not a post-hoc tweak to the delta — doing it in the expectation means a short-handed side that wins anyway is correctly treated as having beaten the odds, and a short-handed side that loses narrowly is barely punished, both for free.

```
R_eff(side) = mean(ratings of players on that side) + H * (n_opponent_on_court - n_own_on_court)   [only when positive]
H = 150 points per missing court player, capped at 300 total
```

`[JUDGEMENT — magnitude entirely mine]` H = 150 means that between otherwise identical players, the full side is expected to win a 6v5 set about 70% of the time. That felt like the honest read of "playing a man down is harder" for indoor volleyball, where a missing player means a permanent hole in both the block and the back-court cover.

**H must be calibrated, not trusted.** Log `n_own`, `n_opp` and the result on every set. After ~10 short-handed sets, compare the actual short-handed win rate against the predicted one and move H. This is the single least-sourced constant in the proposal and it should be the first one revisited. `[JUDGEMENT]`

**6 v 7 gets no adjustment.** `[JUDGEMENT]` The map specifies the 7th player rotates in and counts as playing. Volleyball still puts six on court, so a 7-player side has **no numbers advantage** — it has fresh legs (slight plus) and less court time per player. The mean already captures the squad's strength. So: a 7-player side's rating is the mean over all seven, every one of the seven takes the delta, and H applies only to a side that is actually short **on court**, i.e. fielding fewer than 6.

---

## 5. K-factor and provisional players

**FIDE, primary source** (`handbook.fide.com/chapter/B022022`, Rating Regulations §8.3.3) `[SOURCED — primary]`:

- "K = 40 for a player new to the rating list until they have completed events with at least 30 games."
- "K = 20 as long as a player's rating remains under 2400."
- "K = 10 once a player's published rating has reached 2400 and remains at that level subsequently, even if the rating drops below 2400."
- "K = 40 for all players until the end of the year of their 18th birthday, as long as their rating remains under 2300."
- Per-period cap: "If the number of games (n) for a player on any list for a rating period multiplied by K exceeds 700, then K shall be the largest whole number such that K x n does not exceed 700."
- First published rating comes off 5 games against rated opponents (§7.1.4).

Two things to steal: the **2:1 provisional-to-settled ratio** (40 vs 20), and the **per-period cap** — FIDE explicitly bounds how far a rating can travel in one rating period. That is precisely our risk: a player can play 6–10 rated sets in a single evening.

**USCF** instead uses a continuous K that decays with experience, roughly `K = 800 / (effective games played + games in event)`, with provisional status through ~25–26 games `[SOURCED — secondary, not verified against the USCF rating book]`. The useful idea is the **smooth decay** rather than a cliff.

**Behaviour at the boundary.** FIDE's hard cliff at 30 games means a player's volatility halves overnight — harmless for chess, visible and arbitrary here where ratings get discussed in the hall. Use a **ramp**:

```
K(n) = K_settled + (K_prov - K_settled) * max(0, (N_prov - n) / N_prov)

K_prov    = 60      first rated set
K_settled = 24      from the 12th rated set on
N_prov    = 12      rated sets (≈ 2 sessions)
n         = player's games-played counter (rated sets, not sessions)
```

`[JUDGEMENT — values mine; 2.5:1 ratio and the taper are inspired by FIDE/USCF respectively]`

So K runs 60 → 57 → 54 → ... → 24, hitting the settled value on set 12. No cliff, no boundary artefact, and the games-played counter the map already requires (decision 4) is the only state needed.

**Per-session travel cap** (the FIDE §8.3.3 idea, adapted) `[JUDGEMENT]`:

- Single-set hard cap: `|Δ| ≤ 50` points. Prevents one mis-entered score from wrecking a rating.
- With K_settled = 24 and M ≤ 1.5, the natural worst case is `24 × 1.5 × 1.0 = 36` points, so the cap only ever bites on provisional players — which is the intent.

---

## 6. Banding a continuous rating into 1–5 stars

**The sourced mechanism is hysteresis: different thresholds for entering and leaving a band** — a dead-band at each edge, so a value sitting on a boundary cannot flip back and forth. The pattern recurs identically in control engineering (dwell time / anti-chattering in switched systems) and in software tiering: promote at *floor + margin*, demote at *floor*, so a value at the boundary cannot flap. `[SOURCED — secondary, multiple independent implementations]`

**The game-industry mechanism is demotion lag.** League of Legends grants a **Demotion Protection Shield** on promotion into a tier; for Bronze through Diamond it holds the player at 0 LP for **10 games** instead of demoting them. `[SOURCED — wiki.leagueoflegends.com/en-us/Rank]` Intent: a newly promoted player must fail repeatedly, not once, to fall back.

**Proposed bands** (everyone starts at 1500 = 3 stars, per map decision 10):

| Stars | Rating |
| --- | --- |
| ★ | below 1350 |
| ★★ | 1350 – 1449 |
| ★★★ | 1450 – 1549 ← everyone starts here |
| ★★★★ | 1550 – 1649 |
| ★★★★★ | 1650 and above |

`[JUDGEMENT]` Band width 100 points. The width is not arbitrary — it is set by a constraint worth writing into ticket #6:

> **band width ≥ 2 × worst-case single-set delta**

With the worst-case settled delta at 36 points, 100 is comfortably over. This guarantees no settled player can ever cross a band on one set, which is the structural half of anti-flicker; hysteresis handles the rest.

**Anti-flicker rule** `[JUDGEMENT, mechanism sourced]`, three parts:

1. **Stars are recomputed only at the end of a session.** Ratings update within the session (the map requires it for mid-evening rebalancing), but the star a player *sees* is frozen for the evening. This alone removes the worst flicker, since intra-session swings are the largest.
2. **Hysteresis of 25 points (quarter-band).** Gain a star at `T`; lose it only at `T - 25`. Concretely: go up to 4★ at 1550, drop back to 3★ only at 1525. The band a player is in is part of their stored state, not a pure function of the rating.
3. **Demotion lag of one session.** A player who ends a session below their demotion threshold keeps the star for one more session; a second consecutive session below it demotes them. Promotion is immediate — people tolerate a slow loss far better than a jumpy one.

Combined, a player needs to drop 25 points past the boundary and stay there across two sessions to lose a star. Flicker is gone without making the band meaningless.

**Pool drift and the band thresholds.** Because provisional players carry a higher K, per-set deltas do not exactly cancel and the pool mean wanders (section 2, failure mode 4). Absolute thresholds then slowly re-band everyone. Two fixes `[JUDGEMENT]`:

- **(a) Recommended for v1:** after each session, add a uniform constant to every rating in the pool so the pool mean returns to exactly 1500. Cheap, order-preserving, no effect on any relative comparison or on balancing. Apply it *before* recomputing stars.
- **(b) Alternative:** define the star thresholds as offsets from the live pool mean (±50, ±150) rather than as absolute numbers. Equivalent in effect, but it makes a player's star depend on other people's results, which is harder to explain in the hall. Prefer (a).

---

## 7. Volleyball-specific prior art

Thin, and all of it rates **teams**, not players. Nothing found that derives individual volleyball ratings from team results in a rec-league setting. `[SOURCED — what exists; the gap itself is unverified-negative]`

- **`oadam/volley-elo`** (GitHub) — FFVB volleyball Elo via maximum-likelihood estimation; treats **each point as a mini-match** and fits all point totals simultaneously by convex optimisation, with older matches down-weighted. The per-point framing is the most interesting idea here: it is the principled version of "margin should matter", and our log-MOV multiplier is the cheap approximation of it.
- **`tjbreshears/VBelo`** (GitHub) — Elo for US men's collegiate volleyball. Notably, points data is present in the dataset but **not used** in the rating calculation — i.e. a real volleyball Elo that ignores margin entirely.
- **PAVE (Point-Adjusted Volleyball Efficiency)** — ridge-regularised least squares on **point differential**, so a 3–0 outweighs a five-set win. Confirms that point differential, not sets won, is the signal volleyball analysts reach for.
- **`volleyballrankings.com/methodology`** and GLVC conference seeding — margin-in-every-set components (one weights margin at ~40%, adjusted for opponent and venue).
- Academic: a 2026 pre-print on pre-match prediction of professional volleyball benchmarks ML models against an **Elo baseline**, i.e. Elo is the accepted baseline for volleyball outcome prediction.

**Takeaway:** using the **set** as the rated event with a **point-differential** margin term is consistent with how volleyball is rated elsewhere. Nobody published the individual-player version, so sections 3–6 are necessarily construction rather than citation.

---

## 8. Proposed formula (the deliverable)

All constants collected for ticket #6 to pin down.

### Constants

| Constant | Value | Status |
| --- | --- | --- |
| `R_START` starting rating | **1500** | `[JUDGEMENT]` — conventional Elo origin; pairs with D=400 so published K-factor intuition transfers |
| `D` logistic divisor | **400** | `[SOURCED]` — standard Elo/FIDE scale |
| `K_PROV` provisional K | **60** | `[JUDGEMENT]` — ~2.5× settled, cf. FIDE's 2:1 |
| `K_SETTLED` settled K | **24** | `[JUDGEMENT]` |
| `N_PROV` provisional ramp length | **12** rated sets | `[JUDGEMENT]` — ≈2 sessions |
| `D_REF` MOV reference margin | **8** points | `[JUDGEMENT]` — a 25–17 set is the "normal" set, multiplier 1.0 |
| `M_MIN`, `M_MAX` MOV clamp | **0.5**, **1.5** | `[JUDGEMENT]` |
| `H` short-handed offset | **150** points per missing court player, total cap **300** | `[JUDGEMENT]` — least-sourced constant; calibrate first |
| `DELTA_CAP` per-set cap | **50** points | `[JUDGEMENT]` — cf. FIDE's K×n ≤ 700 period cap |
| Star thresholds | **1350 / 1450 / 1550 / 1650** | `[JUDGEMENT]` — 100-point bands |
| `HYST` hysteresis | **25** points | `[JUDGEMENT]` — quarter band |
| `DEMOTION_LAG` | **1** session | `[JUDGEMENT]` — mechanism from LoL's 10-game shield `[SOURCED]` |

### The update, per rated set

```
1. Effective side ratings (mean of players, plus short-handed offset)
     Rbar(S)  = mean( r_p  for p in players credited with the set on side S )
     short(S) = max(0, min(6, n_on_court(other)) - min(6, n_on_court(S)))
     Reff(S)  = Rbar(S) + H * min(short(S), 2)

2. Expected score for side A
     E_A = 1 / (1 + 10^((Reff(B) - Reff(A)) / 400))

3. Margin multiplier from the point differential d = |pointsA - pointsB|
     M = clamp( ln(1 + d) / ln(1 + 8), 0.5, 1.5 )

4. Per-player K from their games-played counter n_p
     K(n_p) = 24 + 36 * max(0, (12 - n_p) / 12)

5. Per-player delta  (S_A = 1 if A won, else 0)
     for p on side A:  dr_p = clamp( K(n_p) * M * (S_A - E_A), -50, +50 )
     for p on side B:  dr_p = clamp( K(n_p) * M * ((1 - S_A) - (1 - E_A)), -50, +50 )

6. Apply:  r_p += dr_p ;  n_p += 1
     Every player credited with the set takes the delta, including the 7th who rotates in.
     Same sign and (for equal n_p) same magnitude for everyone on a side.

7. End of session:  re-centre the pool mean to 1500, then recompute stars with
     hysteresis (25) and a one-session demotion lag.
```

No ties are possible — a volleyball set is win-by-2 — so no tie branch is needed. (Playtomic does handle ties, by moving the stronger side down; noted for completeness only.)

### Worked sanity checks `[JUDGEMENT]`

Two settled, equally-rated sides (all at 1500, n ≥ 12, 6v6): E = 0.5, K = 24.

- **25–23 win:** M = 0.50 → winners **+6.0**, losers **−6.0**.
- **25–17 win:** M = 1.00 → **±12.0**.
- **25–10 win:** M = 1.26 → **±15.1**.

The map's requirement holds: 25–23 moves 40% of what 25–10 moves. A full evening of 8 sets swept by one side at typical margins moves ~96 points — roughly one star band, which feels about right for "a very lopsided evening" and is small enough that no single set re-bands anybody.

**Short-handed check.** 6 players at 1500 vs 5 players at 1500: Reff = 1500 vs 1650, so the short side is expected to win E = 0.30. If the short side wins 25–20 (M = 0.82): short-side players **+13.8** each, full side **−13.8**. If the short side loses 25–20: short side **−5.9**, full side **+5.9**. Losing narrowly while a man down costs little; winning while a man down pays well. That is the intended behaviour and it falls out of putting H in the expectation rather than in the delta.

**Provisional check.** A brand-new player (n = 0, K = 60) on the winning side of a 25–10 set with even effective ratings: **+37.8**, versus **+15.1** for their settled teammates. They converge in about 12 sets, i.e. two evenings.

### What ticket #6 should expect to tune first

1. **`H` = 150** — pure guess, directly observable. Calibrate against the realised 6v5 win rate.
2. **`K_SETTLED` = 24** — controls whether mid-evening rebalancing has anything to work with. If ratings feel inert within a session, raise it; if a single bad set is upsetting people, lower it.
3. **`D_REF` = 8** — sets what counts as a "normal" set. If this pool's sets typically finish 25–20, use 5 and everything rescales.
4. **Star thresholds** — fine once the pool's actual rating spread is known. If after a month the whole pool sits inside 1450–1550, the bands are too wide and nobody ever moves; the constraint to preserve is `band width ≥ 2 × worst-case single-set delta` (currently 72).

---

## Open / unverified, carried forward

- Playtomic's **0.25 step size** — widely repeated, no first-party confirmation. `[UNVERIFIED]`
- Playtomic's **shown-vs-stored** precision — no first-party statement found. `[UNVERIFIED]`
- Playtomic's **reliability numbers** beyond "medium = 50%" (the ~50% new-account, ~85% validated, 15–20 match settling figures) — secondary only. `[UNVERIFIED]`
- Playtomic's **per-match magnitude** — unpublished. Nothing in circulation is operator-stated.
- **FiveThirtyEight's MOV formula** — not fetched from 538 itself (site shut down); consistent across independent reconstructions. `[UNVERIFIED against first party]`
- **USCF's `800/(games)` provisional K** — secondary; not checked against the USCF rating book. `[UNVERIFIED]`
- **Matchi / Tenup / Padel Manager / OpenPadel** — not investigated, out of budget. Low value given Playtomic published what was needed.
- Playtomic's **level description chart** (what 3.0 vs 4.0 means in words) is served as an image and was not read.
- **No prior art exists for short-handed rating.** `H` is construction, not citation.

## Sources

**Primary (operator / rule-maker):**
- Playtomic help centre, "How the Playtomic level system works" — https://playerhelp.playtomic.com/hc/en-gb/articles/43310980754193-How-the-Playtomic-level-system-works (read via the help centre's public JSON API; the HTML page 403s)
- Playtomic help centre, "The Playtomic Levels: ups & downs" — https://playerhelp.playtomic.com/hc/en-gb/articles/19831827459345-The-Playtomic-Levels-ups-downs (same)
- FIDE Rating Regulations §7.1.4, §8.3.3 — https://handbook.fide.com/chapter/B022022
- League of Legends wiki, Rank (Demotion Protection Shield) — https://wiki.leagueoflegends.com/en-us/Rank

**Source code / published implementations:**
- https://github.com/oadam/volley-elo
- https://github.com/tjbreshears/VBelo
- https://volleyballrankings.com/methodology

**Academic:**
- Düring et al., "An Elo-type rating model for players and teams of variable strength" — https://arxiv.org/pdf/2109.15046 (Phil. Trans. R. Soc. A 380:20210155)
- https://en.wikipedia.org/wiki/Elo_rating_system, https://en.wikipedia.org/wiki/Elo_hell

**Secondary / reconstruction (flagged as such above):**
- FiveThirtyEight MOV formula as reproduced at https://www.chiefdelphi.com/t/how-does-the-fivethirtyeight-elo-formula-work/166517, https://metricgate.com/docs/sports-elo-rating-margin-victory/, https://neilpaine.substack.com/p/how-my-nhl-elo-ratings-and-forecast
- Playtomic level write-ups: https://simplepadel.com/padel-levels-and-ratings/, https://padelradar.io/en/blog/playtomic-level-verstehen, https://www.playformore.app/en/guides/padel-levels-explained
- Go / AoE2 handicap-as-rating-offset: https://forums.online-go.com/t/ogs-elo-and-handicap/26493, https://aozone.net/threads/unequal-elo-earnings-in-teamgames.172242/

**Not reached:** https://playtomic.com/blog/padel-levels (403, not retried).
