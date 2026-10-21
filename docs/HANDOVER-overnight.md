# Overnight handover (21–22 October 2026)

Status of the overnight run on the open plan items. If this session stopped
before finishing, this file says where everything is.

## How the work is organised

Lanes run in parallel, each on its own branch, pushed to `origin` as
checkpoints (WIP commits allowed; squashed to one commit when the lane
finishes). The coordinator merges finished lanes into `staging` one by one,
each as a single commit, after typecheck, lint, unit, integration and browser
checks pass on the merged result.

| Lane | Branch | Contents |
| --- | --- | --- |
| A | `lane/a` | Mail transport + outbox (U7a), password links (U7c), invitations incl. emailed temporary passwords (U7b = P4), CSV member import (U4), email change (U3), mail events + "created by" (U6), transactional membership audit (P7) |
| B | `lane/b` | Per-workspace AI (P6): encrypted connection versions, typed job inputs, persisted taxonomy-sync job, job ceilings; M09 leftovers; lease release on shutdown; Taxomind cancel on archive (P7) |
| C1 | `lane/c1` | M06 part 1: TanStack Query foundation, nuqs queue filters, Radix pickers (queue), labelling page split, workspace switcher, axe checks |
| D | `lane/d` | Progress backend D0–D2 (benchmark, activity events, grouped queries) and M07 (pg_trgm, grouped team queries) |
| E | `lane/e` | M08 (pino logs, request IDs, OpenTelemetry, read-only filesystem), restore check (P7), browser journeys for taxonomy admin and bulk labelling |

Planned after these merge: C2 (taxonomy admin split, AI jobs / taxonomy admin /
badge on Query, team and audit filters on nuqs, team pickers), D3/D4 (dashboard
UI on top of C), the `prisma`-singleton lint boundary, a `console.*` → logger
sweep, and a final documentation pass.

## Not code (the maintainer's)

Staging and production setup, the live reverse-proxy check, backup targets
(RPO/RTO), audit retention period, making the e2e check required on `main`.
Taxomind side: deduplicate by `batchId`, a taxonomy delete action, verify
namespace isolation (release gate for enabling AI).

## Resuming if the run stopped

1. `git fetch origin` and look at `lane/*` branches: the last commit body of
   each says what is done, in progress and next.
2. `staging` only contains lanes that were finished and verified.
3. Merge a finished lane: `git cherry-pick <lane commit>` onto `staging`, run
   the checks in AGENTS.md, push.
