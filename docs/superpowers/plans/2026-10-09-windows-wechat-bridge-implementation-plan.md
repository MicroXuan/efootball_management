# Windows WeChat Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small, auditable Windows process that reliably reads authorized WeChat 4.x group/private commands, forwards them to the EFM API, and serially sends and verifies API outbox messages.

**Architecture:** A Python package separates durable local delivery state, signed API transport, and a replaceable `WechatTransport`. The production adapter uses pinned `wechatauto-replica` receive primitives and conservative GUI sending; tests run cross-platform against a fake adapter, while real sending stays disabled until a target-machine acceptance gate passes.

**Tech Stack:** Python 3.12, SQLite, `httpx`, `pydantic`, Python `hmac`/`hashlib`, `pytest`, Windows 10/11, WeChat 4.1.15.13, `wechatauto-replica==1.2.5.1` on Windows.

**Spec:** `docs/superpowers/specs/2026-10-09-wechat-group-bot-auction-design.zh-CN.md`

**Prerequisite:** Complete the API endpoints from `docs/superpowers/plans/2026-10-09-wechat-group-bot-foundation-implementation-plan.md`. Auction behavior may be added before or after this plan because the Bridge transports commands generically.

## Global Constraints

- The Bridge runs only on Windows 10/11 with Python 3.12 and an interactive, unlocked desktop session.
- Production is pinned to WeChat 4.1.15.13 and `wechatauto-replica==1.2.5.1` until an explicit compatibility test approves another version.
- The Bridge never decides auction validity, deadline, winner, or schedule content.
- Only enabled group IDs returned by the API and private messages matching `^绑定\s+\d{6}$` may leave the computer.
- No unrelated message body, contact list, OpenID, database key, device token, screenshot, or chat database is logged or uploaded.
- Receive delivery is at-least-once with a durable local acknowledgement watermark; API uniqueness supplies exactly-once business effects.
- Sends are strictly serial. The Bridge confirms target title before input and confirms the sent message from the local database before reporting `SENT`.
- A failed or uncertain send is never blindly repeated after Enter; ambiguous outcomes are reported for server-side reconciliation.
- Real sending is off by default and cannot be enabled until the local doctor and dry-run acceptance checks pass.

## Review Focus

- A crash after the API commits an inbound batch but before local acknowledgement must resend the same IDs, not skip later messages; pinned in Task 2 spool tests.
- A renamed group must fail title confirmation instead of sending to a fuzzy search result; pinned in Task 5 sender tests.
- A message authored by the robot itself must never re-enter the command pipeline; pinned in Task 4 receiver tests.
- Closing an RDP window or locking Windows must make health fail and sending stop without consuming the outbox task; pinned in Task 6 runtime tests.
- An Enter operation followed by a network failure must reconcile by local read-back before deciding whether to retry; pinned in Task 5 ambiguous-send tests.

---

### Task 1: Package skeleton, configuration, and protocol models

**Files:**
- Create: `apps/wechat-bridge/pyproject.toml`
- Create: `apps/wechat-bridge/src/efm_wechat_bridge/__init__.py`
- Create: `apps/wechat-bridge/src/efm_wechat_bridge/config.py`
- Create: `apps/wechat-bridge/src/efm_wechat_bridge/models.py`
- Create: `apps/wechat-bridge/config.example.toml`
- Create: `apps/wechat-bridge/tests/test_config.py`
- Create: `apps/wechat-bridge/tests/test_models.py`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Foundation Bridge request/response JSON contracts.
- Produces: `BridgeSettings`, `InboundEvent`, `ObservedGroup`, `OutboxTask`, `SendAck`, and validated local configuration.

- [ ] **Step 1: Write failing configuration/model tests**

Assert required HTTPS API URL in production, opaque device ID, token loaded from `EFM_WECHAT_BRIDGE_TOKEN` rather than TOML, default send-disabled, bounded poll/batch settings, exact text size limits, timezone-aware datetimes, and rejection of unknown outbox kinds.

- [ ] **Step 2: Run tests and verify failure**

Run from `apps/wechat-bridge`: `python -m pytest tests/test_config.py tests/test_models.py -q`

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Create package and typed configuration**

Pin cross-platform dependencies and define the Windows-only extra containing `wechatauto-replica==1.2.5.1`. Keep live-library imports outside package module import time so CI can run on macOS/Linux.

- [ ] **Step 4: Add example config and ignores**

Document API URL, device ID, state directory, poll interval, WeChat expected version, send toggle, and safe limits. Ignore the real TOML, `.env`, SQLite/WAL files, keys, screenshots, decrypted databases, and diagnostic output.

- [ ] **Step 5: Run unit checks**

Run: `python -m pytest -q && python -m compileall -q src`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/wechat-bridge .gitignore
git commit -m "feat(bridge): scaffold Windows WeChat Bridge"
```

### Task 2: Durable SQLite spool and watermarks

**Files:**
- Create: `apps/wechat-bridge/src/efm_wechat_bridge/spool.py`
- Create: `apps/wechat-bridge/tests/test_spool.py`

**Interfaces:**
- Consumes: Task 1 `InboundEvent`, outbox task IDs, and send acknowledgements.
- Produces: `BridgeSpool.append_inbound`, `pending_inbound`, `ack_inbound`, `remember_outbox`, `complete_outbox`, `watermark`, and `health_snapshot`.

- [ ] **Step 1: Write failing spool tests**

Cover WAL mode, schema bootstrap, append idempotency, stable order by WeChat sort key/message ID, batch limit, acknowledgement only after API success, crash between API commit and ack causing redelivery, outbox task dedupe, ambiguous send state, bounded completed retention, and concurrent reader/writer safety.

- [ ] **Step 2: Run tests and verify failure**

Run: `python -m pytest tests/test_spool.py -q`

Expected: FAIL because `BridgeSpool` does not exist.

- [ ] **Step 3: Implement `BridgeSpool`**

Use Python `sqlite3`, explicit transactions, WAL, foreign keys, and UTC ISO timestamps. Never persist the Bridge token, WeChat database keys, screenshots, or unrelated message content.

- [ ] **Step 4: Run spool tests**

Run: `python -m pytest tests/test_spool.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/wechat-bridge/src/efm_wechat_bridge/spool.py apps/wechat-bridge/tests/test_spool.py
git commit -m "feat(bridge): persist delivery state and watermarks"
```

### Task 3: Signed EFM API client

**Files:**
- Create: `apps/wechat-bridge/src/efm_wechat_bridge/api_client.py`
- Create: `apps/wechat-bridge/tests/test_api_client.py`

**Interfaces:**
- Consumes: Task 1 settings/models and Foundation endpoints.
- Produces: `EfmBridgeClient.heartbeat`, `upload_messages`, `claim_outbox`, and `ack_outbox` using exact request-signature headers.

- [ ] **Step 1: Write failing client tests**

Use `httpx.MockTransport` to assert `Authorization: Bridge <token>`, device header, UTC timestamp, unique nonce, and lowercase hex HMAC-SHA256 over `METHOD\nPATH\nTIMESTAMP\nNONCE`. Cover timeout, 401 terminal authentication error, 409 replay with fresh-nonce retry, 429/5xx bounded backoff, malformed JSON, and no token leakage in exceptions.

- [ ] **Step 2: Run tests and verify failure**

Run: `python -m pytest tests/test_api_client.py -q`

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement `EfmBridgeClient`**

Use one `httpx.Client`, explicit connect/read/total timeouts, TLS verification always enabled outside tests, bounded exponential backoff with jitter, and structured error codes without response bodies that might contain sensitive data.

- [ ] **Step 4: Run API-client tests**

Run: `python -m pytest tests/test_api_client.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/wechat-bridge/src/efm_wechat_bridge/api_client.py apps/wechat-bridge/tests/test_api_client.py
git commit -m "feat(bridge): add signed EFM API client"
```

### Task 4: Replaceable transport and WeChat database receiver

**Files:**
- Create: `apps/wechat-bridge/src/efm_wechat_bridge/transport.py`
- Create: `apps/wechat-bridge/src/efm_wechat_bridge/fake_transport.py`
- Create: `apps/wechat-bridge/src/efm_wechat_bridge/wechatauto_receiver.py`
- Create: `apps/wechat-bridge/tests/test_transport_contract.py`
- Create: `apps/wechat-bridge/tests/test_receiver.py`

**Interfaces:**
- Consumes: Task 1 models, Task 2 spool, and on Windows `wechatauto-replica` DB/listener APIs.
- Produces: `WechatTransport.health()`, `observed_groups()`, `poll(after_watermark)`, `send(task)`, and `WechatautoReceiver.normalize(raw) -> InboundEvent | None`.

- [ ] **Step 1: Write failing transport contract tests**

Define a reusable suite that requires stable health fields, deterministic observed-group IDs, ordered polling, no self-authored messages, strict filtering, and send result states `SENT | FAILED | AMBIGUOUS`.

- [ ] **Step 2: Write failing receiver normalization tests**

Use captured, anonymized fixture dictionaries—not real chat data—to cover group text with resolved `sender_username`, private binding command, ordinary private text ignored, disabled group ignored, robot-authored message ignored, non-text ignored, oversized text ignored, malformed sender ID, duplicate shard rows, and stable `server_id`/sort-key conversion.

- [ ] **Step 3: Run tests and verify failure**

Run: `python -m pytest tests/test_transport_contract.py tests/test_receiver.py -q`

Expected: FAIL because transport/receiver modules do not exist.

- [ ] **Step 4: Implement transport protocol and fake**

Keep the interface free of `wechatauto` types. The fake transport must drive all runtime tests and allow injected health, inbound events, send failures, and read-back outcomes.

- [ ] **Step 5: Implement `WechatautoReceiver`**

Lazy-import the pinned library only on Windows. Read local databases incrementally, resolve real group-member wxid, map WeChat `server_id` to message ID, filter before spooling, and report database-key/version problems as health errors without logging keys or paths containing account IDs.

- [ ] **Step 6: Run receiver and full tests**

Run: `python -m pytest -q`

Expected: PASS on non-Windows using fixtures/fake; Windows-only smoke tests remain explicitly marked.

- [ ] **Step 7: Commit**

```bash
git add apps/wechat-bridge/src/efm_wechat_bridge apps/wechat-bridge/tests
git commit -m "feat(bridge): read and filter WeChat database messages"
```

### Task 5: Conservative GUI sender and read-back reconciliation

**Files:**
- Create: `apps/wechat-bridge/src/efm_wechat_bridge/wechat_gui_sender.py`
- Create: `apps/wechat-bridge/src/efm_wechat_bridge/windows_session.py`
- Create: `apps/wechat-bridge/tests/test_sender.py`
- Create: `apps/wechat-bridge/tests/test_windows_session.py`
- Modify: `apps/wechat-bridge/src/efm_wechat_bridge/transport.py`

**Interfaces:**
- Consumes: an `OutboxTask`, expected stable conversation ID/name, current interactive-session health, and receiver database read-back.
- Produces: `WechatGuiSender.send(task) -> SendResult` with `SENT`, `FAILED`, or `AMBIGUOUS` and optional read-back message ID.

- [ ] **Step 1: Write failing session/sender tests**

Cover locked/no interactive desktop, WeChat not foregroundable, exact stable-ID lookup failure, renamed/title mismatch, clipboard restore, serialized sends, dry-run, input failure before Enter, failure after Enter, successful read-back, ambiguous network/API failure reconciled by read-back, and no second Enter for ambiguous outcomes.

- [ ] **Step 2: Run tests and verify failure**

Run: `python -m pytest tests/test_sender.py tests/test_windows_session.py -q`

Expected: FAIL because sender/session modules do not exist.

- [ ] **Step 3: Implement session guards**

Detect an interactive unlocked session, visible WeChat main window, expected executable/version, and foreground ownership. Return typed failure codes; never attempt input when any guard is uncertain.

- [ ] **Step 4: Implement GUI sender**

Use a process-wide send lock. Search/open by the known conversation, confirm the current title, paste exact text, press Enter once, then poll the local database for an outgoing message matching conversation, content, and a bounded send-time window. Preserve and restore clipboard content where Windows APIs permit.

- [ ] **Step 5: Run sender tests**

Run: `python -m pytest tests/test_sender.py tests/test_windows_session.py -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/wechat-bridge/src/efm_wechat_bridge apps/wechat-bridge/tests
git commit -m "feat(bridge): send and verify WeChat messages safely"
```

### Task 6: Runtime orchestration, health, and fail-closed behavior

**Files:**
- Create: `apps/wechat-bridge/src/efm_wechat_bridge/runtime.py`
- Create: `apps/wechat-bridge/src/efm_wechat_bridge/cli.py`
- Create: `apps/wechat-bridge/tests/test_runtime.py`
- Modify: `apps/wechat-bridge/pyproject.toml`

**Interfaces:**
- Consumes: spool, API client, `WechatTransport`, settings, and OS signals.
- Produces: `efm-wechat-bridge doctor`, `run --dry-send`, `run --enable-send`, and a supervised polling loop.

- [ ] **Step 1: Write failing runtime tests**

Cover startup doctor failure, heartbeat group inventory, poll→spool→upload→ack ordering, API outage buffering, outbox claim only when health/send gates pass, strict serial send, `AMBIGUOUS` acknowledgement, RDP/lock transition stopping sends without consuming tasks, bounded graceful shutdown, and sanitized structured logs.

- [ ] **Step 2: Run tests and verify failure**

Run: `python -m pytest tests/test_runtime.py -q`

Expected: FAIL because runtime/CLI do not exist.

- [ ] **Step 3: Implement runtime loops**

Use separate supervised receive/upload, heartbeat, and send loops sharing the spool and a stop event. A loop crash sets unhealthy state and stops sends; it must not spin-restart without bounded backoff.

- [ ] **Step 4: Implement doctor and explicit send gate**

`doctor` checks OS, Python, WeChat process/version/login, database access, sender prerequisites, API authentication, device status, state-directory permissions, and group inventory. `--enable-send` additionally requires `send_enabled=true` in local config and a fresh successful doctor record.

- [ ] **Step 5: Run all cross-platform tests**

Run: `python -m pytest -q && python -m compileall -q src`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/wechat-bridge
git commit -m "feat(bridge): run supervised receive and send loops"
```

### Task 7: Windows installation and real-machine acceptance gate

**Files:**
- Create: `apps/wechat-bridge/scripts/install.ps1`
- Create: `apps/wechat-bridge/scripts/run.ps1`
- Create: `apps/wechat-bridge/scripts/register-task.ps1`
- Create: `apps/wechat-bridge/scripts/unregister-task.ps1`
- Create: `apps/wechat-bridge/tests/test_powershell_scripts.py`
- Create: `docs/deployment/windows-wechat-bridge.zh-CN.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: completed Bridge package and Foundation device provisioning.
- Produces: reproducible Windows setup, interactive Task Scheduler startup, rollback, and signed acceptance evidence.

- [ ] **Step 1: Add PowerShell script validation tests or dry-run checks**

The scripts must reject non-Windows, missing Python 3.12, unpinned WeChat version, missing token/config, non-interactive Task Scheduler mode, and paths containing repository secrets. `register-task.ps1` must create an “only when user is logged on” task, never a Session 0 Windows service.

- [ ] **Step 2: Implement installation/run/task scripts**

Create a virtual environment, install the locked Windows extra, run `doctor`, default to dry-send, and provide reversible task registration. Do not download or install WeChat itself and do not write credentials into task arguments or repository files.

- [ ] **Step 3: Write the deployment and rollback guide**

Document dedicated account, client version pinning, Windows sleep/lock/RDP requirements, device token provisioning, group observation/binding, dry-run, send enablement, logs, circuit breaker, rotation, uninstall, local data deletion, and emergency stop.

- [ ] **Step 4: Run repository-side verification**

Run: `cd apps/wechat-bridge && python -m pytest -q && python -m compileall -q src && cd ../.. && git diff --check`

Expected: PASS with no diff-check output.

- [ ] **Step 5: Execute the Windows acceptance gate**

On the dedicated Windows machine: run doctor; observe the test group; send a private binding command and group schedule command in dry-send; enable sending; verify exact title and read-back; restart Bridge and confirm no duplicate; disconnect API and confirm buffering; lock the screen and confirm sends stop; reconnect and verify recovery; run a three-lot test auction if the auction plan is complete.

Expected: every checklist item records timestamp, Bridge version, WeChat version, device ID, outcome code, and no sensitive message/token/key data.

- [ ] **Step 6: Run full project verification**

Run: `pnpm verify && (cd apps/wechat-bridge && python -m pytest -q) && git diff --check`

Expected: PASS. If the current host is not Windows, record the Windows acceptance step as pending and keep production sending disabled; do not claim live completion.

- [ ] **Step 7: Commit**

```bash
git add apps/wechat-bridge/scripts docs/deployment README.md
git commit -m "docs(bridge): add Windows deployment and acceptance gate"
```
