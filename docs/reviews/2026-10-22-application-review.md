# Application review — 22 October 2026

Reviewed the working application and its workflows rather than the last commit.
No planned features were added. The pre-existing staged CI/documentation changes
are included in the same commit as the fixes.

## Corrections

- Single-record saves disable conflicting actions while pending. Failed flags,
  skips and label saves remain visible and retryable. Modified/repeated keyboard
  shortcuts cannot accidentally submit or skip records.
- Taxonomy tabs retain draft selections. Saving the last tab first returns to
  an unfinished taxonomy instead of leaving a partially labeled record. Bulk
  labeling follows the same rule.
- Bulk flags, comments and skips use one scoped transaction rather than separate
  requests per record. A rejected request keeps the panel and selection open.
- The taxonomy browser paginates beyond its first 100 nodes, fetches ancestors
  by exact string code, and reports fetch/path failures instead of treating
  them as an empty taxonomy or constructing a partial path. The read-only
  taxonomy page uses the shared browser. Query bounds are validated, and the
  active-taxonomy list excludes inactive taxonomies.
- Queue selection checks record identities across pages. Select-all affects
  only the visible page and cannot select stale results during a filter change.
  Pagination clamps pages that disappear and uses a unique ordering tie-breaker.
  Label and assignment changes invalidate cached progress reports as well.
- A human label in one taxonomy no longer hides AI suggestions for other
  taxonomies in the queue.
- Assignment checkboxes distinguish partial assignments and let the user fill
  the remaining assignments. Large selection lookups are split into short URLs.
- Nested dialogs handle keyboard focus and Escape only in the topmost dialog.
  Bulk comment and custom page-size controls have accessible names.
- Member creation/import and reporting-time-zone changes recover from network
  failures. Import dialogs stay open while receiving one-time passwords, and
  mail-status polling preserves those passwords in memory.
- Record exports retain declared field/support columns even when all values
  are blank. Password CSV download URLs remain valid long enough to save.
- Comment loading failures have retry controls; comment submission prevents
  duplicate clicks and invalidates queue comment indicators.

## Verification

Passed checks:

- Production build, TypeScript, ESLint and Prettier.
- 141 unit tests across 25 files.
- 195 database integration tests across 18 files; the 33 integration tests
  covering bulk saves, exports and this review were also rerun after the final
  server changes.
- All 52 Chromium browser journeys, including the 12 new review regressions,
  accessibility checks and CSP enforcement. No journeys were skipped.

Validation uses Node 24 and disposable PostgreSQL test databases, including
workspace row-level security through the least-privilege application role.
The regression suites cover out-of-order labeling, drafts, failed/in-flight
writes, nested dialogs, pagination, very large taxonomy ancestry, cross-page
selection, partial assignments, imports and time-zone retries. Existing browser
journeys include axe checks and CSP enforcement.

Manual browser checks included queue rendering, CSV download contents (including
leading-zero codes), and reporting-period reload/back navigation. Test fixes
wait for download completion and hydration, and allow an empty pending queue.
On Windows, browser artifacts use a temporary directory per checkout to avoid
locked download files under Desktop paths.

This review does not exercise a live Taxomind deployment or deliver real email;
the integration tests use stand-in services. It does not replace the release CI
and deployment smoke checks.
