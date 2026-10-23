# Player Market List Optimization Plan

**Goal:** Open player application lists without fetching the full history, and let miniapp users reach older applications.

**Architecture:** Keep the existing cursor API and response contract. The admin review page reads one server page at a time and appends only on demand. The miniapp application tabs use the same cursor and append on scroll. Search behavior remains unchanged until a representative query benchmark establishes whether an index or search redesign is needed.

**Scope:** Admin review page, miniapp player market application tabs, their tests, and read-only search plan inspection. No schema changes.

**Constraints:** Run database tests only with an explicit local `test` or `verify` DATABASE_URL. Preserve review eligibility, status filters, and current application history details.

## Tasks

- [x] Add a failing admin test: opening the review page requests one page even when `nextCursor` exists; clicking “加载更多” requests the next cursor, merges records without duplicates, and a filter change resets the list.
- [x] Replace `collectCursorPages` in the review page with page state and an explicit load-more action; keep submission refresh behavior.
- [x] Add a failing miniapp test: public and mine application tabs request the next cursor on reaching the bottom, append without duplicates, and reset on view switch.
- [x] Implement application cursor state and page loading in the miniapp, with a visible footer matching player/news lists.
- [x] Run focused and neighboring regressions, typechecks/builds, inspect local search query plan, and document remaining search/index limits without claiming an unmeasured p95.

## Search evidence

An isolated local `verify` benchmark inserted 50,000 published football-player rows, measured 12 samples per query, then deleted those exact IDs in transactions and verified zero remain. Query-only p95 was 37.2 ms for the unfiltered first page, 33.1 ms for a common keyword, and 16.5 ms for a rare keyword. `EXPLAIN` reports a full scan and filesort for substring search; these are query timings, not HTTP endpoint p95. A search-index migration is deferred until an endpoint-level benchmark or production telemetry shows material latency.
