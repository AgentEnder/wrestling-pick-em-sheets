# Shared Context

Background context for working on the open high-priority GitHub issues. These docs describe shared concepts (data model, routes, scoring, etc.) that multiple issues touch. Each issue has its own doc in `.ai/issues/` with the issue body and issue-specific details.

## Index

- [architecture.md](./architecture.md) — tech stack, directory layout, key conventions
- [data-model.md](./data-model.md) — database tables, generated types, important TypeScript types
- [cards.md](./cards.md) — card creation, editor, library, print sheet, bonus question types
- [live-games.md](./live-games.md) — live game lifecycle, routes, state slice, player/host/display surfaces
- [scoring.md](./scoring.md) — scoring engine, leaderboard derivation, snapshots
- [auth-and-ownership.md](./auth-and-ownership.md) — Clerk auth, host/owner checks, guest sessions

## Open high-priority issues

| # | Title | Domain |
|---|---|---|
| 14 | fix: align bonus question boxes or justify-right | Cards / print |
| 16 | feat: archive cards to hide from continue editing without deleting | Cards |
| 19 | fix: threshold questions shouldn't show grading options | Cards / editor |
| 21 | feat: FAB / bottom button to save + submit picks for live game | Live games |
| 22 | feat: end game screen breakdown of own score | Live games / scoring |
| 23 | Ability to delete live games | Live games |
