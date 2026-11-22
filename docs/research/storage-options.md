# Durable storage and hosting options

Research for [#2](https://github.com/ososevych/teambalance/issues/2). All free-tier figures verified against
primary sources on **22 November 2026**. Free-tier terms move; every number below is date-sensitive and
re-checking before any paid commitment is cheap.

## The question

What backs the app's data, and where does the front-end live, given it must run in a phone browser at a
volleyball hall on **Sunday 29 November 2026**, built by one person in seven days?

Binding constraints from [#1](https://github.com/ososevych/teambalance/issues/1): exactly one writer (the
organizer), no player accounts and no auth system, durable across devices and reinstalls (`localStorage`
ruled out), free or very cheap, usable on flaky sports-hall wifi, and the organizer must be able to eyeball
the data and hand-fix a mistyped score.

## Recommendation

**A single JSON document in a private GitHub repo, written from the browser via the GitHub Contents API.**
Hosting: static front-end on **GitHub Pages or Cloudflare Pages**, with the data in a *separate* repo from
the Pages repo.

Runner-up: **Google Sheets with an Apps Script web app** as the backend.

### Why

1. **It cannot go to sleep.** This was the hard filter. A GitHub repo has no idle state, no cold start, no
   project to resume. Three of the eight candidates fail or wobble here (see the table below), and the
   failure mode is precisely the one that matters: a weekly Sunday cadence is the *worst* possible traffic
   shape for an idle-pause policy.
2. **There is no backend to write.** `api.github.com` serves CORS headers, so the phone browser talks to it
   directly. No Worker, no deploy pipeline, no connection string to hide server-side, no CLI to learn. On a
   seven-day budget this is the single biggest saving: the whole storage layer is `fetch` plus a token.
3. **One writer is the native model, not a workaround.** The Contents API takes the current blob `sha` as a
   precondition and returns `409` if it moved. A fine-grained PAT scoped to one repo with `contents: write`
   *is* the shared secret the parent map asked for. No auth system is created, and none is bypassed.
4. **Hand-fixing is free and reversible.** The organizer opens the file on github.com from a phone, edits a
   number, commits. Every past state is in the history, so a bad rebalance or a fat-fingered score is
   `git revert`-able. No other candidate gives an audit trail without being asked.
5. **It suits the data shape this app actually has.** 20-30 players and a few sessions is tens of kilobytes.
   Whole-document read and whole-document replace is the correct access pattern at this size, and it pushes
   the data model toward an append-only log of sets with ratings as a *derived* pure function of that log —
   which is what [#1](https://github.com/ososevych/teambalance/issues/1) decisions 2, 4 and 8 describe.
   A relational store would quietly invite storing ratings as mutable state instead.
6. **Exit cost is zero.** The data is already a portable file in version control. Migrating to Cloudflare D1
   later is a script that reads one JSON document.

### Honest costs of this choice

- **The write token lives on the client.** Mitigations: a fine-grained PAT restricted to the single data
  repo with only `contents: write`; keep the data repo separate from everything else; the blast radius of a
  leak is vandalism of one file whose full history is recoverable. Revoking is one click. This is acceptable
  *because* there is one writer and the data is not sensitive — it would not be acceptable at any larger scope.
- **Write latency is ~0.5-1s** and each write is a commit. Fine for a handful of set scores per session,
  wrong for anything chatty.
- **Not queryable.** No `WHERE`. Correct at this size, limiting if the app outgrows one document.
- **Rate limit** is 5,000 requests/hour for authenticated requests, and the Contents API returns inline file
  content only below 1 MB — both orders of magnitude away from this workload.
- **Keep data out of the Pages repo.** GitHub Pages has a soft limit of 10 builds/hour
  ([docs](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)), so
  committing scores into the repo that serves the site would throttle deploys mid-session. Separate repos,
  or host the front-end on Cloudflare Pages, removes the coupling entirely.

### Why the runner-up, and when to switch to it

Google Sheets via an Apps Script web app ties on the idle-pause criterion (Google does not sleep
spreadsheets) and **beats the recommendation on hand-fixing**: the organizer edits a cell in the Sheets app
on their phone, which is as direct as data repair gets. Apps Script also needs no hosting at all for the
write path.

It loses on two concrete seven-day risks: Apps Script web apps respond to `POST` with a redirect to
`googleusercontent.com`, which makes browser `fetch` CORS a known half-day of fiddling (workable with
`text/plain` simple requests, but it is debugging you do not choose on day one), and concurrent writes need
explicit `LockService` handling. It also has no version history, so a mistyped score overwritten is gone.

**Switch to it** if the organizer turns out to want spreadsheet-native editing as a primary workflow rather
than an escape hatch, or if the player pool already lives in a Google Sheet (flagged as unknown in
[#1](https://github.com/ososevych/teambalance/issues/1), "Where today's player list lives") — in that case
the import path is free and the calculus changes.

## Idle-pause behaviour: every candidate

This was treated as a first-class, pass/fail criterion. A database asleep at 18:00 on a Sunday is a product
failure, and "I'll remember to wake it" is not a mitigation.

| Candidate | Idle behaviour | Threshold | Verdict |
| --- | --- | --- | --- |
| **GitHub repo (JSON file)** | None. Repos have no idle state. | n/a | **Pass** |
| **Google Sheets / Apps Script** | None. Sheets and Apps Script deployments are not idled. | n/a | **Pass** |
| **Cloudflare D1 + Workers/Pages** | No idle-pause, sleep or deletion policy published for free-tier D1, Workers or Pages. | n/a | **Pass** |
| **Firebase Firestore (Spark)** | No published idle-pause or idle-deletion policy for Firestore or Spark projects. | n/a | **Pass** (absence of a published policy, not an explicit guarantee) |
| **PocketBase on a VPS** | None — you own the host. Trades idle risk for ops risk. | n/a | **Pass** |
| **Neon** | Compute **scales to zero**, not paused. Resumes automatically on connect. Cannot be disabled on Free. No idle project deletion documented. | **5 minutes** of inactivity | **Pass with a cold start** |
| **Turso / libSQL** | Free-plan databases are **archived** when inactive; unarchive via CLI/API or on demand. | **10 days** of inactivity | **Marginal** — a 7-day cadence stays inside the window, with only 3 days of slack |
| **Supabase** | Free projects are **paused**. Resume is a manual click in the dashboard; data is retained and restorable for 90 days. | **1 week** of inactivity | **Fail for this app** |

### Quantifying the Supabase risk (the prior attempt was right)

Supabase's pricing page states plainly: *"Free projects are paused after 1 week of inactivity"*, with a
*"Limit of 2 active projects"* ([pricing](https://supabase.com/pricing)). The project-pausing documentation
is more specific about what counts as activity: a project is considered inactive if it does not receive
sufficient database activity over the past week, and *typically a few user requests to the database each day
over the previous week* is enough to keep it awake
([Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing)).

That is the exact collision. This app is used **once a week**, in a two-hour burst, with six idle days
between. The usage pattern sits on top of the threshold and below the "a few requests a day" guidance, so
pausing is not a tail risk — it is the expected steady state. Recovery is a manual Resume in the dashboard,
which is minutes of standing in a sports hall on hall wifi before anyone can enter a score. Data is not
lost: paused Free projects are restorable for 90 days
([changelog](https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days)),
and there is a documented path for projects paused over a year
([troubleshooting](https://supabase.com/docs/guides/troubleshooting/restore-project-after-90-days-pause)).
Availability, not durability, is what fails.

It is mitigable — a scheduled daily ping from GitHub Actions or a cron would hold it open — but that is an
extra moving part, built in week one, whose silent failure breaks the product on a Sunday. Not worth it when
three candidates have no idle state at all.

## Per-candidate notes

Judged on time-to-first-write-from-a-phone first, because that is the only metric with a deadline.

### GitHub JSON file via Contents API — recommended
Free tier: 5,000 authenticated API requests/hour; Contents API inline read below 1 MB; private repos free.
Hosting via GitHub Pages: 1 GB site, 100 GB/month soft bandwidth, 10 builds/hour soft limit
([limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)).
No backend, no auth system, no idle state, free version history. Time to first write: hours.

### Google Sheets + Apps Script — runner-up
Apps Script on a consumer account: 20,000 URL Fetch calls/day, 6 min runtime per execution, 30 simultaneous
executions per user, 90 min/day of trigger runtime
([quotas](https://developers.google.com/apps-script/guides/services/quotas)). If driving the Sheet through
the REST API instead, Sheets API limits are 300 read and 300 write requests/minute per project and 60/minute
per user, **no daily cap**, and *"all standard use of the Google Sheets API is available at no additional
cost"* — though that page notes charges for exceeding quota beginning in 2026, which is date-sensitive and
worth re-reading before relying on it ([limits](https://developers.google.com/workspace/sheets/api/limits)).
Going through Apps Script's `SpreadsheetApp` instead of the REST API sidesteps those quotas entirely.
Best-in-class human editing; CORS and `LockService` are the time risks.

### Cloudflare D1 + Workers/Pages — best third choice, and the growth path
Free tier: 5 million rows read/day, 100,000 rows written/day, 5 GB total storage, 10 databases
([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)). Workers Free: 100,000 requests/day,
10 ms CPU per invocation; Pages Functions are billed as Workers
([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)). No documented idle pause,
a real SQL database, a Worker is the natural place to hold the shared secret server-side rather than in the
client, and front-end plus API plus DB sit on one platform. Costs more of the seven days: Wrangler, bindings,
schema and migrations, **plus an admin screen you would otherwise not build**, because hand-fixing a score
means `wrangler d1 execute` from a laptop — exactly what the organizer cannot do from a hall. This is the
right destination if the app outlives the prototype, and the wrong starting point this week.

### Neon
Free: 1 GB storage per project, 20 GB account total, 100 CU-hours/project per month, 100 projects; compute
suspends after **5 minutes** of inactivity and this **cannot be disabled** on Free
([plans](https://neon.com/docs/introduction/plans)). Scale-to-zero resumes automatically, so this is a
cold-start cost rather than a pause — materially better than Supabase. Resume latency is not stated on that
page; treat it as unverified and measure it if Neon is seriously considered. Still needs a backend or the
serverless driver plus somewhere to keep the connection string out of the client, which is work this app
does not otherwise need.

### Turso / libSQL — do not start here now
Free: 100 databases, 5 GB storage, 500 million rows read/month, 10 million rows written/month
([pricing](https://turso.tech/pricing)). Free-plan databases are archived after **10 days** of inactivity,
unarchived via `turso group unarchive <group-name>` or the API
([CLI docs](https://docs.turso.tech/cli/group/unarchive),
[API](https://docs.turso.tech/api-reference/groups/unarchive)). The 10-day window survives a weekly cadence
with three days to spare, but **the pricing page carries a banner: "Turso is joining Supabase to give every
agent its own database."** A platform mid-acquisition is not where a seven-day build should put its only
copy of the data, and the acquirer is the candidate that already failed the idle test. Highly date-sensitive —
this assessment is specific to 22 Nov 2026 and should be revisited, not inherited.

### Firebase Firestore
Spark plan: 1 GiB stored data, 50,000 document reads/day, 20,000 writes/day, 20,000 deletes/day, 10 GiB/month
egress ([quotas](https://firebase.google.com/docs/firestore/quotas)). Genuinely the only candidate with
**offline persistence and automatic sync built in**, which is attractive for hall wifi. Rejected anyway: with
no user accounts, the security-rules model has nothing to key on — rules cannot inspect a custom header, so
a single shared secret does not map onto it and you end up with anonymous auth or App Check, i.e. the auth
system [#1](https://github.com/ososevych/teambalance/issues/1) ruled out. Lock-in and exit cost are also the
highest of the eight. Project deletion takes 30 days and project IDs are never reusable
([projects](https://firebase.google.com/docs/projects/learn-more)); no idle-pause policy is published.

### PocketBase on a cheap VPS
No free tier — roughly $4-6/month. Excellent admin UI for eyeballing and fixing data, SQLite file for export,
and no idle behaviour because you own the box. Rejected on time: VPS provisioning, TLS, firewall, process
supervision and backups are the only ops burden in the candidate set, and that is day-cost with no
compensating benefit at this scale.

### Also considered
**Cloudflare Workers KV / Durable Objects** — KV's eventual consistency is wrong for read-after-write on a
score entry; a Durable Object is a tidy fit for one-writer serialization and is the natural refinement of the
D1 path rather than a separate option. **Val Town / Deno Deploy KV** — fine tech, but adds a platform to learn
in a week with no advantage over a file in a repo. **Airtable** — closed its most generous free tier terms
repeatedly; Sheets dominates it on both cost stability and organizer familiarity.

## Flaky wifi: this does not discriminate between candidates

Worth stating plainly, because it is tempting to pick a backend for it. Except Firestore, **none** of these
options gives offline-then-sync for free, and Firestore is excluded on the auth model. So offline is a
**front-end** problem in every scenario: queue writes in IndexedDB, replay on reconnect, show pending state.

What the storage choice *does* affect is how safe that replay is. A write that is an **idempotent
whole-document replace** (the GitHub JSON option, with the `sha` precondition catching a stale base) or an
**append of a row** (Sheets) replays safely without extra design. A relational `INSERT` needs explicit
idempotency keys to survive a double-send. That is another point for the recommendation: the replay queue is
simpler to get right, which matters when it is being written on day five.

Practical note: the organizer's phone is the one writer, so a single-device outbox is sufficient. There is no
multi-device merge problem to solve in v1 — and if the "multi-organizer reality" open question in
[#1](https://github.com/ososevych/teambalance/issues/1) becomes real, the `sha` precondition degrades to a
visible `409` conflict rather than a silent clobber, which is the right failure.

## Date-sensitive and unverified claims

- Every free-tier number here was read on **22 November 2026** from the vendor's own pricing or docs page.
  They change without notice.
- **Turso is being acquired by Supabase** (banner on turso.tech/pricing, 22 Nov 2026). The free-tier terms
  and the 10-day archive policy may not survive the transition. Do not inherit this assessment.
- The Google Sheets API limits page notes **charges for exceeding quota starting in 2026**; the exact
  mechanics were not pursued since the recommended Apps Script path does not use the REST API.
- **Unverified:** Neon's cold-start/resume latency after scale-to-zero. Not stated on
  [the plans page](https://neon.com/docs/introduction/plans); not chased further.
- **Unverified:** whether Firestore or Firebase Spark projects have any unpublished idle-deletion behaviour.
  The absence of a documented policy is weaker evidence than an explicit guarantee.
- Cloudflare Pages' own limits (builds/month, static requests) were not fetched separately; the Workers
  pricing page states Pages Functions are billed as Workers.

## Sources

- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/free-project-pausing
- https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days
- https://supabase.com/docs/guides/troubleshooting/restore-project-after-90-days-pause
- https://neon.com/docs/introduction/plans
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://turso.tech/pricing
- https://docs.turso.tech/cli/group/unarchive
- https://docs.turso.tech/api-reference/groups/unarchive
- https://firebase.google.com/docs/firestore/quotas
- https://firebase.google.com/docs/projects/learn-more
- https://developers.google.com/apps-script/guides/services/quotas
- https://developers.google.com/workspace/sheets/api/limits
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
