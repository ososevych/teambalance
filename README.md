# teambalance

Balance recreational volleyball teams by player rating, record set results, and let ratings
update so the next split is better than the last.

## The problem

A volleyball session has 10–14 players turning up from a pool of 20–30, two teams, often
uneven sides (6v5, 7v6), and two hours of play. Splitting the teams is done by eye, usually
at random, and a lopsided split wastes the evening. Mid-session rebalancing happens when it
becomes obvious one side is far stronger.

## The idea

- **Player profiles** with a hidden Elo-style rating, shown to players only as a coarse star band.
- **Balanced lineup generation** from whoever turned up, with manual pin-together / force-apart overrides.
- **Set-level results** with margin of victory feeding the rating update.
- **Mid-session rebalance** that re-splits the same players at their current ratings.

## Status

Early. Design is being charted as a wayfinder map — see the issue labelled `wayfinder:map`.
