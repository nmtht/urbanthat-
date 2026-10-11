# zoneGenerate — E0 restore

Branch: `fix/e0-restore-massing` (from `sprint-4-zoning`).

## Done
- Module unblocked (was placeholder `RESTORE_PLEASE_USE_COMMIT_364b7d6`).
- Canonical source: commit `364b7d65833472182dacb81ba33c5aa046fff874` (803 lines, SHA `5f0bcd2`).

## How to finish restore locally (if remote file is still thin stub)
```bash
git fetch origin
git checkout fix/e0-restore-massing
git checkout 364b7d65833472182dacb81ba33c5aa046fff874 -- src/geometry/zoneGenerate.ts
git commit -m "fix(e0): restore full zoneGenerate from 364b7d6"
git push origin fix/e0-restore-massing
```

## Remaining on this branch
1. Full body of `zoneGenerate.ts` from 364b7d6 on remote.
2. `tsc --noEmit` clean (unused locals, optional `mat`, mesh typing).
3. Split into modules so LLM never rewrites the whole generator.

## Known algorithm bugs (audit F1/F7 — not fixed by restore alone)
- Courtyard + driveway clearances reject all footprints on many rectangular perimeter zones.
- FAR random multiplier and tower floor floor.
- No true polygon offset.

See audit + TZ v2 for I1–I5 rewrite.
