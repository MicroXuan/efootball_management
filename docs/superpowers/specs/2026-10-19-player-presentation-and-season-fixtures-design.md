# Player Presentation and Season Fixtures Design

## Goal

Align player presentation with PESDATA, make player-market portraits as reliable as the player catalog, remove participant-managed score workflows, and replace the league workspace's next-match emphasis with a searchable season-wide fixture list.

## Confirmed Product Decisions

- Position suitability colors follow PESDATA's imported `PositionHot` values rather than inferred position ratings.
- Ability values use PESDATA's visible color bands.
- Participants cannot submit, confirm, reject, upload evidence for, or dispute scores. Administrators are the only actors who can record or correct official scores.
- Historical score proposals, disputes, evidence metadata, events, and audit records remain stored.
- League-specific todo presentation is removed from the league page. The global action center remains available from the profile area for non-score business.
- The league workspace no longer identifies a next opponent. It links to all published fixtures for the selected season.
- The fixture page searches the whole season, not only the signed-in team's matches.
- Player-market portraits reuse the catalog's successful direct HTTPS image behavior. No image proxy or cloud-storage mirror is introduced.

## 1. PESDATA Player Presentation

### Position suitability

The imported PESDATA `PositionHot` array is the source of truth for position color. Its index order is:

`GK, CB, LB, RB, DMF, CMF, LMF, RMF, AMF, LWF, RWF, SS, CF`.

Each position continues to display its calculated or imported rating, but its background tone comes only from `PositionHot`:

- `3`: strong suitability, solid PESDATA green `#07c160` with dark text.
- `2`: partial suitability, translucent/light PESDATA green based on `rgba(7, 193, 96, 0.40)`.
- `1` or missing: neutral dark surface.

The primary card position retains a clear outline but does not override the suitability background. Imported arrays may contain numeric strings with whitespace and must be normalized safely. Invalid or short arrays fall back to neutral cells without hiding ratings.

### Ability colors

Every numeric ability row receives a tone based on the displayed value after any applied automatic-build delta:

- below `70`: red, `#ff0000`;
- `70` through `79`: yellow, `#ffe600`;
- `80` through `89`: green, `#22ff00`;
- `90` and above: cyan, `#00efff`.

The value and progress fill share the tone. Labels and tracks remain visually quiet so the color bands carry the distinction. Values above 100 remain capped only for bar width; their number is not altered.

## 2. Player-Market Portrait Reliability

### Root causes

The market currently has two independent failure modes:

1. Fixed-ability cards imported before zero-level cards were recognized as final builds have no `PlayerCardAutoBuild`. Because `FootballPlayerBestCard` requires an auto-build relation, those players never received a persisted best-card selection.
2. Market portraits pass HTTPS artwork through `wx.downloadFile`, while the working player catalog renders the same HTTPS URL directly. This creates an unnecessary trial-version failure boundary.

### Data repair and query defense

A one-time, idempotent repair creates a final-card auto-build for active, published zero-level cards that lack one, then recalculates the persisted best-card selection for affected players. The repair must not overwrite an existing valid selection with a weaker card.

Market queries also retain a defensive fallback: when the persisted best-card relation is absent, select the highest valid active published card using the same ranking inputs as normal best-card selection. This keeps the market usable before or during repair and protects against future incomplete imports.

Owned players continue to present their owned current card's rating and position. The query must not silently substitute another card's gameplay data.

### Rendering

External HTTPS player artwork is rendered directly, matching the player-card component used by the catalog. Cloud file IDs may still use the cloud download API, and non-HTTPS/local sources retain the appropriate resolver. An image error produces the existing initial-based fallback.

Deployment documentation records `https://img.pesdata.net` under the WeChat mini-program's `downloadFile` legal domains for remaining download-based consumers, but market portrait correctness does not depend on a second manual download step.

## 3. Administrator-Only Official Scores

### Participant surface and API

Remove participant score mutations and navigation:

- score submission;
- score confirmation and rejection;
- timeout dispute creation;
- participant evidence attachment and retrieval;
- the interactive match-result page and score-action deep links;
- match-result tasks from the action center.

Removing UI controls alone is insufficient. Participant mutation routes are removed from the registered API surface so an old client cannot continue writing scores.

Season fixture cards are read-only. A match without an administrator-recorded official result is "未开始"; a match with an official result is "已结束".

### Administrator surface

Keep the existing administrator schedule score editor as the only score mutation surface. Administrators can enter or correct both scores with a required reason and existing version-conflict protection.

Remove the administrator "赛果争议" navigation item, route, and interactive adjudication page. Internal dispute-closing behavior remains available to the administrator score command so recording an official result can safely resolve legacy active disputes. Historical records and audit events are not deleted.

Background deadline processing and participant-facing dispute reminders are disabled because no new participant proposals or disputes can be created.

## 4. League Workspace

The selected-season workspace removes:

- the "当前联赛待办" card;
- next-opponent name, round, and planned-time presentation;
- the league-specific action-center navigation method used only by that card.

The global profile action center remains. Transaction and auction badges embedded in their relevant modules may remain because they are contextual module signals rather than a league todo panel.

The right-hand competition metric becomes a stable "全部赛程" entry with explanatory copy such as "按队伍和状态查找比赛". It never predicts which opponent the user should contact next.

The workspace response no longer computes or exposes `nextMatch`, removing an unused query and contract field.

## 5. Season-Wide Fixture List

### API contract

Add an authenticated, league-and-season-scoped fixture-list query for approved participants. The service verifies that the season belongs to the requested league and that the caller owns an active approved season entry.

The query accepts:

- optional normalized team keyword;
- status `ALL`, `UPCOMING`, or `FINISHED`;
- cursor and bounded page size.

It returns matches from every published competition stage in the season. Team search matches current/snapshotted team display names and team number text. It must not search private identifiers.

Status is derived from the official result, not from planned time:

- `UPCOMING`: no official result;
- `FINISHED`: official result exists.

Ordering is deterministic: unfinished matches first, then round, match number, and stable ID; finished-only queries use the same round-based order. Cursor construction includes every ordering field needed to prevent duplicates or omissions.

### Mini-program page

The existing schedule route becomes "全部赛程" and consumes the new season-wide contract. It includes:

- season picker;
- team search input with an explicit search action;
- status chips or selector for 全部、未开始、已结束;
- read-only fixture cards showing competition/group, round, both team identities, official score when present, and status;
- pagination/load-more behavior and filter-specific empty states.

Cards do not navigate to the removed participant score page. Changing season or filters clears the previous cursor and results before loading the new query.

## 6. Error Handling and Compatibility

- Invalid or stale fixture cursors return the existing structured validation error and leave the current UI results intact with a retry affordance.
- An archived opposing team remains visible using its schedule snapshot and archived label.
- Missing team crests and player images use existing visual fallbacks.
- Existing clients calling removed participant score routes receive `404`; administrator score routes are unchanged.
- Historical result/dispute rows remain compatible with administrator score correction and audit presentation.
- Existing unrelated uncommitted workspace changes must be preserved and excluded from feature commits unless they are directly required by this design.

## 7. Verification Strategy

Use test-driven implementation with focused red/green cycles and a final full-suite run.

Required coverage:

- `PositionHot` index mapping, whitespace normalization, dark/light/neutral colors, missing values, and primary outline independence.
- Ability boundary values `69`, `70`, `79`, `80`, `89`, and `90`, including post-build values and bars over 100.
- Zero-level final-build repair idempotency, best-card backfill, and fallback selection without replacing owned-card gameplay data.
- Player-market HTTPS artwork follows the catalog rendering path and falls back only after a real load error or absent URL.
- Participant score routes are absent; administrator score record/correction still works and closes a legacy active dispute safely.
- Action center emits no match-result actions; league page contains neither todo card nor next-match content.
- Season fixture authorization, league/season isolation, team keyword search, all three statuses, deterministic pagination, archived teams, and empty states.
- Mini-program template tests prove cards are read-only and filters reset/reload correctly.

## Out of Scope

- Deleting historical result, evidence, dispute, or audit tables and records.
- Migrating PESDATA images into project-owned storage.
- Redesigning the global action center or unrelated league modules.
- Changing administrator fixture generation and publication workflows.
- Automatically assigning planned match times or determining a user's "next" opponent.
