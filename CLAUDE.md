# teambalance

Recreational volleyball team balancing with a hidden Elo-style player rating. See `README.md`
for the problem and the idea.

## Agent skills

- `docs/agents/issue-tracker.md` — issues live in GitHub Issues, driven with the `gh` CLI;
  includes the wayfinding operations (`wayfinder:map`, child tickets, native blocking).
- `docs/agents/domain.md` — single-context repo: `GLOSSARY.md` at the root, ADRs in `docs/adr/`.

## Working agreements

- The design for the first version is charted as a wayfinder map: the issue labelled
  `wayfinder:map`. Read it before proposing design changes.
- Exact player ratings are never shown to players. Players see a coarse star band only.
  Treat this as a product invariant, not a display preference.
