# Individual Competition Loop Design

**Date:** 2026-09-25
**Status:** Approved design, pending implementation plan
**Product scope:** V0.1 internal prototype

**中文版本：** [2026-09-25-individual-competition-loop-design.zh-CN.md](./2026-09-25-individual-competition-loop-design.zh-CN.md)

## 1. Goal

Deliver a locally testable personal competition loop:

```text
create competition → open registration → player registration → review
→ generate and publish round-robin schedule → submit and confirm scores
→ publish versioned standings → complete competition
```

The first release implements individual competitions and one round-robin stage. Its domain boundaries must allow team participants, salary-cap rosters, elimination stages, disputes, and OCR-assisted evidence to be added without replacing the scheduling, match, result, or standings core.

## 2. Scope

### 2.1 Included

- Draft, publish, and lifecycle management for individual competitions.
- Public competition list and detail.
- Platform and server-region eligibility.
- Registration with one of the player's own game accounts.
- Registration review and conversion into an admitted competition participant.
- Deterministic single round-robin schedule generation, preview, and publication.
- Player score submission, opponent confirmation or rejection, and manager result entry.
- Immutable match-result versions with one current official version.
- Versioned standings calculated only from official results.
- Mini-program flows for players and scoped competition managers.
- Local demo data and an end-to-end acceptance path with four participants and six matches.

### 2.2 Deferred

- Team creation, team registration, membership, and team rosters.
- Salary versions, salary-cap rules, season rosters, and match lineups.
- Elimination and combined formats, advancement, and seeding.
- Disputes, referee workbench, and penalties.
- Evidence file storage, image OCR, and automatic score extraction.
- WeChat subscription messages.
- Organizer organizations and a separate web administration application.

The schema may contain enum values and nullable extension fields for deferred capabilities, but deferred workflows must not be partially exposed.

## 3. Roles and permissions

### 3.1 Player

A signed-in player can browse public competitions, register with an owned game account, withdraw while registration is open, view their matches, submit scores, confirm or reject an opponent's proposal, and view standings.

### 3.2 Competition manager

A competition manager can edit a scoped competition, transition its lifecycle, review registrations, generate and publish its schedule, enter an official result, and complete or cancel the competition. A user who creates a competition receives the `EVENT_MANAGER` role in that competition's scope.

### 3.3 Platform administrator

A platform administrator can create and manage every competition. Existing scoped authorization remains authoritative: a manager binding for one competition does not grant access to another.

Required permissions are seeded idempotently and assigned to the appropriate fixed roles:

- `competition.create`
- `competition.manage`
- `competition.registration.review`
- `competition.schedule.manage`
- `competition.result.manage`

Public reads require no authentication. Registration and result actions require an active user and use resource-scoped authorization or participant ownership checks.

## 4. Domain model

### 4.1 Competition

`Competition` stores name, description, platform, server region, participant type, format, lifecycle status, registration window, planned competition window, participant limit, creator, optimistic concurrency version, and timestamps.

Initial values:

- participant type: `INDIVIDUAL`; reserve `TEAM`.
- format: `ROUND_ROBIN`; reserve `DOUBLE_ROUND_ROBIN`, `SINGLE_ELIMINATION`, and `GROUP_KNOCKOUT`.
- lifecycle: `DRAFT`, `REGISTRATION_OPEN`, `REGISTRATION_CLOSED`, `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, or `CANCELLED`.

Platform, server region, participant type, and format become immutable when registration opens. The competition stores all timestamps in UTC.

### 4.2 Competition rule version

`CompetitionRuleVersion` stores a monotonically increasing rule version, scoring values, ordered tie-break definitions, and creation metadata. Opening registration binds the active rule version. Starting the competition locks it; later edits create a new version and may not silently change an active competition.

The initial defaults are three points for a win, one for a draw, and zero for a loss. Supported initial tie-breaks are total points, head-to-head points, head-to-head goal difference, total goal difference, total goals, and wins.

### 4.3 Registration

`CompetitionRegistration` is an application, not a scheduled participant. It records competition, applicant user, owned game account, accepted rule version, current status, review metadata, withdrawal metadata, optimistic version, and timestamps. `CompetitionRegistrationStatusHistory` appends every submission, review, withdrawal, and resubmission transition with actor, reason, and time.

Statuses are `PENDING`, `APPROVED`, `REJECTED`, and `WITHDRAWN`. A unique constraint on competition and applicant keeps one durable application record; a rejected or withdrawn application may be resubmitted while registration remains open, with a new history entry and accepted rule version. Registration is accepted only during `REGISTRATION_OPEN`, within its time window and participant limit, and when the game account platform and server region match the competition.

### 4.4 Competition participant

`CompetitionParticipant` is the stable identity consumed by schedule, match, and standings code. It records competition, participant type, source registration, admission sequence, display-name snapshot, individual user ID for this release, and future nullable team reference storage.

Matches and standings never reference a user or team directly. Future team registration will create the same participant entity with type `TEAM`; salary-cap rosters will attach to the participant.

### 4.5 Stage and match

`CompetitionStage` isolates format-specific scheduling. The first release creates one `ROUND_ROBIN` stage, while future stages can be group or elimination stages.

`CompetitionMatch` stores stage, round number, deterministic match number, home and away participant IDs, planned time, lifecycle status, current official result-version ID, optimistic version, and timestamps. Status values are `SCHEDULED`, `AWAITING_RESULT`, `PENDING_CONFIRMATION`, `CONFIRMED`, and `ADMIN_DECIDED`.

Unique constraints prevent duplicate match numbers and duplicate pairings inside the same stage. Published schedules cannot be silently regenerated.

### 4.6 Result versions

`MatchResultVersion` stores match, version number, home score, away score, submitter, submission side, status, optional rejection or manager reason, future evidence metadata, and timestamps. Status values are `PROPOSED`, `REJECTED`, `OFFICIAL`, and `SUPERSEDED`.

Submitting a result always creates a version. An opponent may confirm or reject a proposal but may not confirm their own proposal. Confirmation makes that version official and supersedes the prior official version in one transaction. A manager may create an official version directly but must provide a reason when replacing an existing official result. Official history is never physically deleted or overwritten.

### 4.7 Standings snapshots

`StandingsSnapshot` represents one complete recalculation and stores competition, monotonically increasing version, triggering result version, rule version, generation time, and rows.

`StandingsRow` records participant, played, wins, draws, losses, goals for, goals against, goal difference, base points, adjustment points reserved for future penalties, total points, rank, tie state, and all tie-break values required to reproduce the ordering.

Every official-result change regenerates standings from the complete official result set. Repeated processing produces the same rows and never adds points twice.

## 5. State machines

### 5.1 Competition

```text
DRAFT → REGISTRATION_OPEN → REGISTRATION_CLOSED
      → SCHEDULED → IN_PROGRESS → COMPLETED
                 ↘ CANCELLED
```

Cancellation is permitted before completion and retains registrations, schedules, results, and audit history. A competition cannot start without a published schedule. It cannot complete while a match lacks an official result unless a manager uses a future cancellation/forfeit workflow; that exception is not exposed in this release.

### 5.2 Registration

```text
PENDING → APPROVED
        → REJECTED ─┐
        → WITHDRAWN ┴→ PENDING (resubmit while open)
```

Approval creates exactly one participant in the same transaction. Approved registrations cannot be withdrawn after registration closes.

### 5.3 Match result

```text
SCHEDULED → AWAITING_RESULT → PENDING_CONFIRMATION
          → CONFIRMED
          → ADMIN_DECIDED
```

Only `CONFIRMED` and `ADMIN_DECIDED` matches contribute to standings.

## 6. Scheduling

Schedule generation uses a pure round-robin circle algorithm over participants ordered by admission sequence and participant ID. For an odd count, a synthetic bye is added; the bye produces no match. For `n` even participants the result contains `n - 1` rounds and `n(n - 1)/2` matches. A participant appears at most once per round, and each unordered pair appears exactly once.

Generation first produces a draft stage and draft matches. Repeating generation before publication replaces only the unpublished draft in one transaction and produces the same pairings for the same participant ordering. Publishing locks the schedule. The initial release does not assign automatic kickoff times; a manager may optionally set a planned time per match.

## 7. Standings

Default scoring is win `3`, draw `1`, loss `0`. Initial ranking compares:

1. total points;
2. head-to-head points among the tied participants;
3. head-to-head goal difference among them;
4. total goal difference;
5. total goals scored;
6. wins.

If participants remain equal, admission sequence provides deterministic display order and rows are marked `tiePending=true`. This preserves a stable API without pretending that a sporting tie has been broken; later fair-play points, drawing lots, or a playoff can resolve it.

All calculations consume the locked rule version and official scores only. The API exposes the snapshot version and the result/rule versions used to create it.

## 8. API

### 8.1 Public

- `GET /v1/competitions`
- `GET /v1/competitions/:id`
- `GET /v1/competitions/:id/matches`
- `GET /v1/competitions/:id/standings`

### 8.2 Authenticated player

- `POST /v1/competitions/:id/registrations`
- `DELETE /v1/competitions/:id/registrations/me`
- `GET /v1/me/competitions`
- `GET /v1/me/matches`
- `POST /v1/matches/:id/results`
- `POST /v1/matches/:id/results/:version/confirm`
- `POST /v1/matches/:id/results/:version/reject`

### 8.3 Competition management

- `POST /v1/admin/competitions`
- `PATCH /v1/admin/competitions/:id`
- lifecycle transition endpoints for opening/closing registration, starting, completing, and cancelling;
- registration review endpoints;
- schedule generate, preview, and publish endpoints;
- manager result entry and correction endpoints.

Every mutation accepts an idempotency key. Version-sensitive mutations also require the expected resource version and return `409` for stale requests.

## 9. Mini-program experience

The bottom navigation becomes:

```text
球员 | 赛事 | 我的
```

Player pages:

- competition list with lifecycle filters;
- competition detail with overview, rules, registration state, schedule, and standings;
- registration sheet for choosing an eligible game account;
- my competitions and my matches;
- score submission, confirmation, rejection, and version-conflict recovery.

Manager pages:

- competition draft editor;
- registration review queue;
- schedule preview and publication;
- manager score entry and correction.

The client distinguishes validation, permission, lifecycle, stale-version, and network failures. It never hides an official-result conflict behind a generic retry.

## 10. Error handling and consistency

- Database constraints and transactions enforce registration uniqueness, participant uniqueness, schedule uniqueness, result version ordering, and standings version ordering.
- Optimistic versions protect competition, registration, and match mutations.
- Idempotency keys prevent duplicate mutations after taps, retries, or network reconnects.
- Authorization denial returns `403` without leaking private resource details; ownership mismatch uses the existing not-found convention where appropriate.
- All public pagination uses deterministic cursor order.
- Error codes are stable contract values and map to actionable Chinese mini-program messages.
- Result and standings operations log identifiers and error codes only; future evidence content and sensitive tokens must never enter logs.

## 11. Testing

### 11.1 Domain tests

- Valid and invalid competition transitions.
- Round-robin properties for two through at least nine participants.
- Odd participant byes, no duplicate pairs, and stable regeneration.
- Win/draw/loss scoring and multi-party head-to-head ties.
- Deterministic unresolved ties.

### 11.2 Service and persistence tests

- Registration eligibility, ownership, uniqueness, deadline, and concurrency.
- Approval creates one participant even after a repeated request.
- Schedule generation and publication are idempotent.
- Result submitter and confirmer rules.
- Stale result confirmation fails without changing the official version.
- Official correction preserves prior versions and regenerates standings once.
- Scoped managers cannot mutate another competition.

### 11.3 API and mini-program tests

- End-to-end four-player competition from creation through standings.
- Public views expose only published competitions and schedules.
- Mini-program view-model tests for loading, empty, validation, conflict, and retry states.
- Existing identity, player catalog, import, and PESDATA sync regression suites remain green.

## 12. Acceptance scenario

The local acceptance fixture creates one individual competition and four test users with matching game accounts. All four register and are approved. Schedule generation creates three rounds and six unique matches. Publishing exposes those matches in the mini-program. Players submit and confirm scores, standings update after every official result, and correcting one official result creates a new version and a new reproducible standings snapshot. Retried requests create no duplicate registration, participant, match, result, or standings row.

## 13. Extension boundaries

- Team registration adds team ownership and roster workflows before creating the existing participant type `TEAM`.
- Salary caps attach versioned season rosters and match lineups to a participant; schedule and standings remain unchanged.
- Elimination support adds scheduling and advancement strategies behind the stage interface; match results remain versioned through the same service.
- Disputes reference result versions and may create a manager correction; they do not overwrite result history.
- Screenshot storage and OCR enrich result proposals and evidence metadata but cannot make an unconfirmed score official.
