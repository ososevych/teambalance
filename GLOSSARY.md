# teambalance

Balancing recreational indoor volleyball teams by a hidden per-player rating, and updating that rating from recorded set results.

## Language

### The people

**Player**:
Someone known to the system, identified by a stable id and carrying an editable display name. Never deleted — a player who stops attending is deactivated, because their past sets must keep replaying.
_Avoid_: user, member, account

**Pool**:
Every player known to the system, active or not. Currently 19 people, drawn from the registration sheet.
_Avoid_: roster, squad, team list

**Attendee**:
A player marked as present for a particular session. Typically 10–14 of the pool.
_Avoid_: participant, signup

**Credited player**:
A player recorded on one side of a set, whose rating moves as a result of it. In a side of seven, all seven are credited: the seventh rotates in rather than sitting out.

**Organizer**:
The single person who operates the app. There is exactly one writer and there are no player accounts.
_Avoid_: admin, owner

### The play

**Session**:
One booked slot of play — in practice a Sunday 11:00–13:00 court booking. Carries its attendees, its lineups and its sets.
_Avoid_: event, game night, evening, meetup

**Registration**:
The organizer's booking sheet, where players sign up for a slot and are listed as places 1–12 plus reserves. It owns who is *expected*; the app owns who actually turned up. Payment and MultiSport status live there and are deliberately not modelled here.
_Avoid_: signup sheet, attendance list

**Lineup**:
A generated team assignment — the *plan*. A session has a sequence of them, because a rebalance appends the next one rather than editing the current one.
_Avoid_: split, teams, draft

**Set**:
One scored game to 25, win by two. The rated event: the unit a rating reacts to. A set snapshots its own rosters and point totals — the *record*, which may legitimately differ from the lineup that planned it.
_Avoid_: game, match, round

**Rebalance**:
Ending the current lineup mid-session and generating the next one from the players' current ratings. Must move at least two players.
_Avoid_: reshuffle, re-draft, swap

**Short-handed**:
Playing with fewer than the session's on-court count, as a side of five against six. Costs the side effective strength in both the rating expectation and the balancer.
_Avoid_: a man down, undermanned

### The numbers

**Rating**:
A player's hidden numeric strength, starting at 1500. Never shown to players. Derived by replaying the set log, never stored.
_Avoid_: Elo, score, level, points

**Star band**:
The coarse 1–5 display a player is actually shown, derived from their rating at session boundaries. Everyone starts at three stars.
_Avoid_: level, tier, rank, grade

**Provisional**:
A player with fewer than twelve sets played, whose rating moves faster because it is still converging from the uniform starting value.
_Avoid_: unranked, new, calibrating

**Pin**:
A manual constraint on the balancer: two players forced onto the same side, or forced apart. The organizer's escape hatch for what the ratings cannot see.
_Avoid_: lock, constraint, override
