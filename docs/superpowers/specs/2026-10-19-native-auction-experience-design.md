# Native Auction Experience Design

**Status:** Confirmed

## Goal

Improve the native WeChat mini-program auction flow so bidders can identify the exact player card, see useful live bid history without losing access to the bid controls, and search immutable confirmed sale records for their current leagues. Player catalog cards and details become authenticated content.

## Confirmed Product Rules

- Every auction lot must reference one concrete active, published player card. Administrators cannot prepare a batch containing a lot without a card.
- The auction room shows that card's artwork, player name, overall rating, position, and card type. Tapping the identity area opens the existing player-card detail page.
- Decorative star characters are removed from auction money displays and feedback copy. Amounts use plain tabular numerals with a small `资金` label where context needs it.
- Quick bids are the current minimum valid price and minimum valid price plus `10`, `50`, or `100`.
- The live effective-bid panel sits above the bid controls. It has a bounded internal vertical scroll area and shows only valid bids, newest first, including team number, team name, bidder display name, amount, and submission time.
- Bid controls remain reachable in a bottom safe-area action dock and are never covered by the history panel.
- Database arbitration is authoritative. Concurrent equal bids are serialized; the first qualifying bid is valid, while the later bid is rejected against the recomputed minimum. Retried requests with the same idempotency key create no duplicate row. Rejected attempts remain available for server-side audit but never appear in the public valid-bid feed.
- User-visible auction history contains only administrator-confirmed final sales: reviewed lots whose decision is `CONFIRM` or `ADJUST`. Pending review, no-bid, void, and cancelled results are excluded.
- A confirmed sale stores immutable snapshots of team number, team name, bidder display name, player/card identity, final price, and confirmation time. Later profile or team edits do not rewrite history.
- Auction history is scoped to leagues in which the signed-in user owns an active team. It supports paginated keyword search over player name, team number, team name, and bidder display name, sorted newest confirmation first.
- Player catalog cards and player-card details are visible only after login. The mini-program redirects unauthenticated users to login and returns them to the intended catalog/detail page; the API also requires authentication.

## Architecture

Extend the existing auction contracts rather than creating a parallel auction subsystem. Enrich lot snapshots at configuration time with the selected card's presentation fields, enrich public valid bids from the bid's team and user relations, and snapshot the final winner identity on `PlayerAuctionReview` when an administrator confirms or adjusts a result. A new authenticated `GET /me/player-auction-sales` endpoint reads only immutable confirmed sale snapshots.

The mini-program reuses the existing player-card detail route and artwork component. The auction room becomes three functional regions: player identity and countdown, bounded live bid activity, and a safe-area bid dock. A new auction-sales page provides search and pagination and is linked from the existing player-auctions page.

## UI Structure

### Auction room

1. Header: league, batch name, and share action.
2. Player identity hero: artwork, name, overall, position, card type, current price, minimum valid price, and countdown. The entire card is tappable.
3. Effective bid activity: newest valid bids first in a fixed-height `scroll-view`; each row shows `team number · team name · bidder`, local time, and amount.
4. Bid dock: amount input, minimum-price shortcut, `+10`, `+50`, `+100`, feedback, and one primary submit button padded for the device safe area.
5. Queue sections remain below the primary auction interaction and do not interfere with bidding.

### Confirmed sales

The player-auctions page exposes a `成交纪录` entry. The sales page has a single search field covering player, team number, team name, and bidder name. Each row contains artwork, player summary, winner identity, final amount, and confirmed time. Tapping a result opens its player-card detail.

### Logged-out catalog

The player catalog never starts card or pack requests without an access token. It shows a focused login state and preserves the desired return path. Direct player-card detail links follow the same rule. API guards prevent unauthenticated catalog reads even if the client UI is bypassed.

## Failure Handling

- A draft lot without a valid card is rejected during lot replacement and cannot be prepared.
- Historical legacy lots missing presentation fields may fall back to the current referenced card for display, but newly confirmed sales always write complete snapshots.
- If two equal bids arrive concurrently, exactly one can be `VALID`; the loser receives the newly required minimum price.
- If polling refreshes the auction room, the draft amount and bid-history scroll remain stable while the active lot and deadline epoch are unchanged.
- If artwork fails, the existing initials fallback is shown without blocking bidding or history browsing.

## Verification

- Contract tests pin card-required lot input, public bidder identity, room presentation, and sale search/response schemas.
- API tests pin required-card validation, immutable review snapshots, league scoping, confirmed-only history, all search fields, pagination, idempotent replay, and concurrent equal-bid arbitration.
- Mini-program tests pin login redirects, no unauthenticated catalog request, player detail navigation, star-free money copy, quick-bid values, bounded bid history, safe-area bid controls, and searchable sales rendering.
- Focused suites run first; workspace typecheck, tests, and builds run before completion.
