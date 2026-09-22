# Platform Foundation and Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-shaped vertical slice: a pnpm monorepo, NestJS API, MySQL persistence, WeChat login/session handling, scoped authorization primitives, and a runnable WeChat mini-program for player profiles and game accounts.

**Architecture:** Use a modular monolith deployed as one CloudBase container. The mini-program calls versioned REST endpoints; every write passes through the API. Shared Zod contracts define request and response shapes, Prisma 7 owns the MySQL schema, and authentication uses WeChat code exchange plus rotating opaque refresh sessions.

**Tech Stack:** Node.js 24 LTS, pnpm 11, TypeScript, NestJS 12, Prisma ORM 7 with MySQL, Zod, Jest/Supertest, native WeChat mini-program TypeScript, Docker Compose, CloudBase Run.

**Spec:** `docs/superpowers/specs/2026-09-21-efootball-management-product-design.md`

## Global Constraints

- Use Node.js 24 LTS; the machine's Node.js 25 runtime is EOL and must not be the project runtime.
- Use pnpm `11.23.0` and commit `pnpm-lock.yaml`.
- Keep one modular NestJS API; do not create microservices.
- Use MySQL-compatible schema and migrations for local and CloudBase environments.
- All business writes go through the API; the mini-program must not write core tables directly.
- Use UUID string identifiers at every public API boundary.
- Store timestamps in UTC and serialize them as ISO-8601 strings.
- Never log WeChat session keys, access tokens, refresh tokens, or database credentials.
- Preserve unrelated workspace files and the approved product spec.
- Use test-first implementation and commit after every task.

## Scope Decomposition

The approved product spec contains multiple independently shippable subsystems. Implement them through separate plans in this order:

1. Foundation and identity — this plan.
2. Player-card catalog and salary version management.
3. Teams, rosters, and two-layer salary-cap validation.
4. Organizer organizations, competitions, rules, and registrations.
5. Scheduling, matches, result versions, standings, and advancement.
6. Appeals, penalties, notifications, audit tooling, and production hardening.

This plan ends with a user who can sign in from the mini-program, edit a player profile, and manage game accounts against a tested MySQL-backed API.

## Planned File Structure

```text
.
├── .editorconfig
├── .env.example
├── .gitignore
├── .nvmrc
├── compose.yaml
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── apps
│   ├── api
│   │   ├── Dockerfile
│   │   ├── jest.config.ts
│   │   ├── package.json
│   │   ├── prisma
│   │   │   ├── migrations
│   │   │   ├── schema.prisma
│   │   │   └── seed.ts
│   │   ├── src
│   │   │   ├── app.module.ts
│   │   │   ├── main.ts
│   │   │   ├── common
│   │   │   │   ├── errors/http-error.filter.ts
│   │   │   │   ├── validation/zod-validation.pipe.ts
│   │   │   │   └── auth/{current-user.decorator.ts,jwt-auth.guard.ts,roles.decorator.ts,scope.guard.ts}
│   │   │   ├── config/{configuration.ts,env.schema.ts}
│   │   │   ├── database/{database.module.ts,prisma.service.ts}
│   │   │   ├── health/{health.controller.ts,health.module.ts}
│   │   │   ├── auth/{auth.controller.ts,auth.module.ts,auth.service.ts,token.service.ts,wechat.gateway.ts,wechat-http.gateway.ts}
│   │   │   ├── authorization/{authorization.module.ts,authorization.service.ts}
│   │   │   └── users/{users.controller.ts,users.module.ts,users.service.ts,game-accounts.controller.ts,game-accounts.service.ts}
│   │   └── test/{app.e2e-spec.ts,auth.e2e-spec.ts,users.e2e-spec.ts,test-app.ts}
│   └── miniprogram
│       ├── app.json
│       ├── app.ts
│       ├── app.wxss
│       ├── package.json
│       ├── project.config.json
│       ├── sitemap.json
│       ├── tsconfig.json
│       ├── components/loading-state/*
│       ├── pages/login/*
│       ├── pages/profile/*
│       ├── pages/game-account-edit/*
│       └── services/{api.ts,auth.ts,session.ts}
└── packages
    └── contracts
        ├── package.json
        ├── tsconfig.json
        └── src/{index.ts,common.ts,auth.ts,user.ts,game-account.ts}
```

## Review Focus

- Replaying the same refresh token must revoke that session family and return `401 AUTH_SESSION_REUSED`; Task 6 pins this behavior.
- A user changing a game account must never access another user's record, even with a valid UUID; Task 8 tests ownership enforcement.
- Two concurrent requests setting different default game accounts must leave exactly one default account; Task 8 tests the transaction.
- A duplicate `(platform, serverRegion, gameUid)` binding must return a stable `409 GAME_ACCOUNT_ALREADY_BOUND`; Task 8 tests the conflict.
- A disabled user must be rejected by both access-token and refresh-token paths; Tasks 6 and 8 test both paths.

---

### Task 1: Initialize the Repository and Workspace

**Files:**
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `.nvmrc`
- Create: `.env.example`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `compose.yaml`

**Interfaces:**
- Consumes: Node.js 24 LTS and pnpm 11.23.0.
- Produces: workspace commands `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm dev:db`, and a MySQL service at `127.0.0.1:3307`.

- [ ] **Step 1: Initialize Git and write the workspace manifest**

Run:

```bash
git init
pnpm init
```

Replace the root `package.json` with:

```json
{
  "name": "efootball-management",
  "private": true,
  "packageManager": "pnpm@11.23.0",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "test:e2e": "pnpm --filter @efm/api test:e2e",
    "dev:db": "docker compose up -d mysql",
    "dev:db:stop": "docker compose down"
  }
}
```

- [ ] **Step 2: Add workspace and TypeScript configuration**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

Create `.nvmrc` containing `24` and `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 3: Add local MySQL and environment template**

Create `compose.yaml`:

```yaml
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: efootball_management
      MYSQL_USER: efm
      MYSQL_PASSWORD: efm_local
      MYSQL_ROOT_PASSWORD: root_local
    ports:
      - "3307:3306"
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-proot_local"]
      interval: 2s
      timeout: 2s
      retries: 30
    volumes:
      - efm_mysql:/var/lib/mysql
volumes:
  efm_mysql:
```

Create `.env.example`:

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=mysql://efm:efm_local@127.0.0.1:3307/efootball_management
JWT_ACCESS_SECRET=replace-with-at-least-32-characters
REFRESH_TOKEN_PEPPER=replace-with-at-least-32-characters
WECHAT_APP_ID=replace-with-wechat-app-id
WECHAT_APP_SECRET=replace-with-wechat-app-secret
WECHAT_GATEWAY_MODE=fake
```

- [ ] **Step 4: Add ignore and editor rules**

Create `.gitignore` with `node_modules/`, `.env`, `dist/`, `coverage/`, `.DS_Store`, `apps/miniprogram/miniprogram_npm/`, and local MySQL artifacts. Create `.editorconfig` with UTF-8, LF, final newline, two-space indentation, and trailing whitespace removal.

- [ ] **Step 5: Verify the database starts**

Run:

```bash
pnpm dev:db
docker compose ps
```

Expected: `mysql` reports `healthy` on port `3307`.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .editorconfig .nvmrc .env.example package.json pnpm-workspace.yaml tsconfig.base.json compose.yaml
git commit -m "chore: initialize efootball management workspace"
```

---

### Task 2: Build the API Shell and Health Contract

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/tsconfig.build.json`
- Create: `apps/api/jest.config.ts`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/config/configuration.ts`
- Create: `apps/api/src/config/env.schema.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/health.module.ts`
- Create: `apps/api/src/common/errors/http-error.filter.ts`
- Create: `apps/api/test/app.e2e-spec.ts`
- Create: `apps/api/test/test-app.ts`

**Interfaces:**
- Consumes: root workspace scripts and environment variables from Task 1.
- Produces: `GET /v1/health -> { status: "ok", timestamp: string }` and error envelope `{ error: { code, message, requestId } }`.

- [ ] **Step 1: Write the failing health end-to-end test**

Create `apps/api/test/app.e2e-spec.ts`:

```ts
import request from 'supertest';
import { createTestApp } from './test-app.js';

describe('health', () => {
  it('returns a versioned health response', async () => {
    const app = await createTestApp();
    await request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('ok');
        expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
      });
    await app.close();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @efm/api test:e2e -- app.e2e-spec.ts`  
Expected: FAIL because the API workspace and `createTestApp` do not exist.

- [ ] **Step 3: Install and configure NestJS 12**

Create `apps/api/package.json` with scripts for `start:dev`, `build`, `lint`, `typecheck`, `test`, and `test:e2e`. Add NestJS 12, `@nestjs/config`, `zod`, `reflect-metadata`, `rxjs`, Jest, Supertest, TypeScript, ESLint, and their type packages. Use `pnpm --filter @efm/api add ...` so exact resolved versions enter the lockfile.

- [ ] **Step 4: Implement the app factory and health endpoint**

Create `health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return { status: 'ok' as const, timestamp: new Date().toISOString() };
  }
}
```

In both production and test factories, set the global prefix to `v1`, enable shutdown hooks, validate environment input with Zod, and install a global exception filter that never returns stack traces.

- [ ] **Step 5: Run API checks**

Run:

```bash
pnpm --filter @efm/api typecheck
pnpm --filter @efm/api test:e2e -- app.e2e-spec.ts
```

Expected: typecheck succeeds and one health test passes.

- [ ] **Step 6: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): add NestJS health service"
```

---

### Task 3: Create Shared API Contracts and Zod Validation

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/common.ts`
- Create: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/src/user.ts`
- Create: `packages/contracts/src/game-account.ts`
- Create: `packages/contracts/src/contracts.spec.ts`
- Create: `apps/api/src/common/validation/zod-validation.pipe.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: TypeScript base configuration.
- Produces: `WechatLoginRequestSchema`, `RefreshRequestSchema`, `UpdateProfileRequestSchema`, `GameAccountInputSchema`, inferred request types, and `ApiErrorSchema`.

- [ ] **Step 1: Write failing contract tests**

Create tests asserting that an empty WeChat code, unsupported platform, over-64-character gamer tag, and invalid UUID fail, while valid payloads parse and trim whitespace.

```ts
expect(() => WechatLoginRequestSchema.parse({ code: ' ' })).toThrow();
expect(GameAccountInputSchema.parse({
  platform: 'MOBILE', serverRegion: 'international', gamerTag: '  Player 1  '
}).gamerTag).toBe('Player 1');
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @efm/contracts test`  
Expected: FAIL because schemas are not defined.

- [ ] **Step 3: Implement contracts**

Define:

```ts
export const GamePlatformSchema = z.enum(['MOBILE', 'PLAYSTATION', 'XBOX', 'STEAM']);
export const WechatLoginRequestSchema = z.object({ code: z.string().trim().min(1).max(128) });
export const RefreshRequestSchema = z.object({ refreshToken: z.string().min(32).max(512) });
export const UpdateProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(32),
  avatarUrl: z.string().url().max(2048).nullable(),
  region: z.string().trim().max(64).nullable()
});
export const GameAccountInputSchema = z.object({
  platform: GamePlatformSchema,
  serverRegion: z.string().trim().min(1).max(32),
  gamerTag: z.string().trim().min(1).max(64),
  gameUid: z.string().trim().min(1).max(64).nullable().optional(),
  isDefault: z.boolean().default(false)
});
```

Export response types for auth tokens, current user, and game accounts. The access-token response includes `accessToken`, `expiresInSeconds`, `refreshToken`, and `refreshExpiresInSeconds`.

- [ ] **Step 4: Implement `ZodValidationPipe`**

The pipe accepts a `ZodType`, returns parsed data, and throws `BadRequestException` with stable code `VALIDATION_FAILED` plus field paths. Do not return raw Zod internals.

- [ ] **Step 5: Run contract and API checks**

Run:

```bash
pnpm --filter @efm/contracts test
pnpm --filter @efm/contracts typecheck
pnpm --filter @efm/api typecheck
```

Expected: all checks pass.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts apps/api pnpm-lock.yaml
git commit -m "feat: add shared API contracts"
```

---

### Task 4: Add MySQL Persistence and Identity Schema

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/seed.ts`
- Create: `apps/api/src/database/prisma.service.ts`
- Create: `apps/api/src/database/database.module.ts`
- Create: `apps/api/src/database/prisma.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `DATABASE_URL`.
- Produces: Prisma models `User`, `GameAccount`, `RefreshSession`, `Role`, `Permission`, `RolePermission`, and `UserRoleBinding`; injectable `PrismaService`.

- [ ] **Step 1: Write the failing database smoke test**

Test that `PrismaService` connects and can create then delete a user using a unique test `wechatOpenId`.

- [ ] **Step 2: Run the database test and verify failure**

Run: `pnpm --filter @efm/api test -- prisma.service.spec.ts`  
Expected: FAIL because Prisma client and schema do not exist.

- [ ] **Step 3: Install Prisma 7 for MySQL**

Run:

```bash
pnpm --filter @efm/api add @prisma/client@7
pnpm --filter @efm/api add -D prisma@7 tsx
```

Keep Prisma on major 7 because the approved database is MySQL.

- [ ] **Step 4: Define the identity schema**

Use `provider = "mysql"`. Define enums for `UserStatus`, `GamePlatform`, `VerificationStatus`, `ScopeType`, and models with UUID string IDs. Required constraints:

```prisma
model User {
  id               String       @id @default(uuid()) @db.Char(36)
  wechatOpenId     String       @unique @map("wechat_open_id") @db.VarChar(128)
  wechatUnionId    String?      @unique @map("wechat_union_id") @db.VarChar(128)
  displayName      String       @map("display_name") @db.VarChar(32)
  avatarUrl        String?      @map("avatar_url") @db.VarChar(2048)
  region           String?      @db.VarChar(64)
  status           UserStatus   @default(ACTIVE)
  agreementVersion String?      @map("agreement_version") @db.VarChar(32)
  privacyConsentAt DateTime?    @map("privacy_consent_at")
  createdAt        DateTime     @default(now()) @map("created_at")
  updatedAt        DateTime     @updatedAt @map("updated_at")
  gameAccounts     GameAccount[]
  refreshSessions  RefreshSession[]
  roleBindings     UserRoleBinding[]
  @@map("users")
}
```

Add a nullable unique compound constraint for populated game identity fields and an index on `GameAccount.userId`. `RefreshSession` stores only `tokenHash`, `familyId`, expiry, revocation, replacement token ID, IP, and user agent.

- [ ] **Step 5: Create and apply the migration**

Run:

```bash
cp .env.example .env
pnpm dev:db
pnpm --filter @efm/api exec prisma migrate dev --name identity_foundation
pnpm --filter @efm/api exec prisma generate
```

Expected: migration succeeds against local MySQL.

- [ ] **Step 6: Implement Prisma lifecycle and rerun tests**

`PrismaService` extends `PrismaClient`, connects during module initialization, and disconnects during shutdown. Run database test, API end-to-end test, and typecheck; all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma apps/api/src/database apps/api/src/app.module.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): add identity persistence schema"
```

---

### Task 5: Implement WeChat Exchange and Token Services

**Files:**
- Create: `apps/api/src/auth/wechat.gateway.ts`
- Create: `apps/api/src/auth/wechat-http.gateway.ts`
- Create: `apps/api/src/auth/fake-wechat.gateway.ts`
- Create: `apps/api/src/auth/token.service.ts`
- Create: `apps/api/src/auth/token.service.spec.ts`
- Create: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/config/env.schema.ts`

**Interfaces:**
- Consumes: WeChat login code, `JWT_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER`, and Prisma.
- Produces: `WechatGateway.exchangeCode(code) -> { openId, unionId? }`; `TokenService.issuePair(user, context)`; `TokenService.rotate(refreshToken, context)`; `TokenService.revoke(refreshToken)`.

- [ ] **Step 1: Write failing token tests**

Tests must assert:

- access token contains `sub`, `status`, and a 15-minute expiry;
- refresh token is random and only its HMAC-SHA256 hash is stored;
- rotation revokes the old session and creates a replacement in the same family;
- replaying the old token revokes the active family and throws `AUTH_SESSION_REUSED`;
- expired and disabled-user sessions fail.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @efm/api test -- token.service.spec.ts`  
Expected: FAIL because token services do not exist.

- [ ] **Step 3: Implement WeChat gateways**

Define the interface:

```ts
export const WECHAT_GATEWAY = Symbol('WECHAT_GATEWAY');
export interface WechatGateway {
  exchangeCode(code: string): Promise<{ openId: string; unionId?: string }>;
}
```

The HTTP gateway calls the official `jscode2session` endpoint with a five-second timeout, maps WeChat failures to `WECHAT_CODE_INVALID` or `WECHAT_SERVICE_UNAVAILABLE`, and never logs response secrets. The fake gateway is enabled only when `WECHAT_GATEWAY_MODE=fake` and maps code `test-code-<name>` to `test-openid-<name>`.

- [ ] **Step 4: Implement token issuance and rotation**

Use `@nestjs/jwt` for 15-minute access JWTs. Generate refresh tokens with `randomBytes(48).toString('base64url')`, hash with HMAC-SHA256 plus the configured pepper, expire after 30 days, and rotate on every use. Put session-family replay handling in one transaction.

- [ ] **Step 5: Run tests**

Run token unit tests and API typecheck. Expected: all pass, including replay detection.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth apps/api/src/config apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): add WeChat and rotating token services"
```

---

### Task 6: Expose Authentication Endpoints

**Files:**
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/test/auth.e2e-spec.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: shared auth schemas, `WechatGateway`, `TokenService`, Prisma.
- Produces: `POST /v1/auth/wechat`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`.

- [ ] **Step 1: Write failing authentication end-to-end tests**

Cover first login creates one user, repeated login reuses the user, refresh rotates tokens, logout revokes the refresh token, reused refresh fails with `401 AUTH_SESSION_REUSED`, and a disabled user cannot log in or refresh.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @efm/api test:e2e -- auth.e2e-spec.ts`  
Expected: endpoints return 404.

- [ ] **Step 3: Implement authentication service**

`loginWithWechat` exchanges code, upserts by `wechatOpenId`, rejects non-active users, and issues tokens. New users receive display name `实况玩家` without attempting to read unauthorized WeChat profile data.

- [ ] **Step 4: Implement controller and stable errors**

Validate request bodies through `ZodValidationPipe`. Return HTTP 200 for login/refresh/logout success; return stable error codes under the global error envelope. Logout is idempotent.

- [ ] **Step 5: Run authentication and regression tests**

Run auth E2E, health E2E, unit tests, and typecheck. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth apps/api/src/app.module.ts apps/api/test/auth.e2e-spec.ts
git commit -m "feat(api): expose WeChat authentication endpoints"
```

---

### Task 7: Add Access Authentication and Scoped Authorization Primitives

**Files:**
- Create: `apps/api/src/common/auth/current-user.decorator.ts`
- Create: `apps/api/src/common/auth/jwt-auth.guard.ts`
- Create: `apps/api/src/common/auth/roles.decorator.ts`
- Create: `apps/api/src/common/auth/scope.guard.ts`
- Create: `apps/api/src/authorization/authorization.service.ts`
- Create: `apps/api/src/authorization/authorization.module.ts`
- Create: `apps/api/src/authorization/authorization.service.spec.ts`

**Interfaces:**
- Consumes: access JWT and persisted role bindings.
- Produces: `CurrentUser`, `RequirePermission(permission, scopeParam?)`, `AuthorizationService.can(userId, permission, scope)`.

- [ ] **Step 1: Write failing authorization tests**

Cover platform-wide permission, matching team scope, mismatched competition scope, expired binding, and disabled user.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @efm/api test -- authorization.service.spec.ts`  
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement access-token guard**

Verify JWT signature and expiry, load the user, reject disabled users, and attach:

```ts
export type CurrentUser = { id: string; status: 'ACTIVE' };
```

Return `401 AUTH_REQUIRED`, `AUTH_TOKEN_EXPIRED`, or `ACCOUNT_DISABLED` as appropriate.

- [ ] **Step 4: Implement scoped authorization**

`AuthorizationService.can` checks active role bindings, role-permission membership, `PLATFORM` scope, or an exact `(scopeType, scopeId)` match. Denials return `403 FORBIDDEN` without revealing whether the target resource exists.

- [ ] **Step 5: Run tests and commit**

Run authorization tests and typecheck; then:

```bash
git add apps/api/src/common/auth apps/api/src/authorization
git commit -m "feat(api): add scoped authorization primitives"
```

---

### Task 8: Implement Profile and Game Account APIs

**Files:**
- Create: `apps/api/src/users/users.module.ts`
- Create: `apps/api/src/users/users.service.ts`
- Create: `apps/api/src/users/users.controller.ts`
- Create: `apps/api/src/users/game-accounts.service.ts`
- Create: `apps/api/src/users/game-accounts.controller.ts`
- Create: `apps/api/src/users/game-account-usage.port.ts`
- Create: `apps/api/test/users.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: authenticated `CurrentUser`, profile and game-account schemas, Prisma, and `GameAccountUsagePort.hasActiveReferences(accountId)`.
- Produces: `GET/PATCH /v1/me`; `GET/POST /v1/me/game-accounts`; `PATCH/DELETE /v1/me/game-accounts/:id`.

- [ ] **Step 1: Write failing profile and account E2E tests**

Cover profile read/update, invalid URL, account create/list/update/delete, ownership isolation, duplicate identity conflict, exactly one default account after concurrent changes, and refusal to delete when a test `GameAccountUsagePort` reports an active reference.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @efm/api test:e2e -- users.e2e-spec.ts`  
Expected: endpoints return 404.

- [ ] **Step 3: Implement profile service and controller**

`GET /me` returns the current user and game-account completeness. `PATCH /me` updates only `displayName`, `avatarUrl`, and `region`, using parsed values from shared contracts.

- [ ] **Step 4: Implement game-account transactions**

Define the future-facing usage boundary:

```ts
export const GAME_ACCOUNT_USAGE_PORT = Symbol('GAME_ACCOUNT_USAGE_PORT');
export interface GameAccountUsagePort {
  hasActiveReferences(accountId: string): Promise<boolean>;
}
```

Creating or setting an account as default runs a transaction that first locks the owning user row, then clears other defaults and sets the selected account:

```ts
await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
await tx.gameAccount.updateMany({ where: { userId }, data: { isDefault: false } });
const selected = await tx.gameAccount.updateMany({
  where: { id: accountId, userId },
  data: { isDefault: true }
});
if (selected.count !== 1) throw new GameAccountNotFoundError();
```

Every read/update/delete query includes `userId`; return `404 GAME_ACCOUNT_NOT_FOUND` for another user's UUID. Map the unique identity constraint to `409 GAME_ACCOUNT_ALREADY_BOUND`. Before delete, call the usage port; its initial implementation returns `false`, and the registrations subsystem will replace it with a database-backed adapter without changing this service contract.

- [ ] **Step 5: Run the concurrency and ownership tests**

Run user E2E tests repeatedly:

```bash
pnpm --filter @efm/api test:e2e -- users.e2e-spec.ts --runInBand
pnpm --filter @efm/api test:e2e -- users.e2e-spec.ts --runInBand
```

Expected: both runs pass and exactly one default account remains.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/users apps/api/src/app.module.ts apps/api/test/users.e2e-spec.ts
git commit -m "feat(api): add player profile and game account APIs"
```

---

### Task 9: Build the Mini-Program Authentication Shell

**Files:**
- Create: `apps/miniprogram/package.json`
- Create: `apps/miniprogram/project.config.json`
- Create: `apps/miniprogram/sitemap.json`
- Create: `apps/miniprogram/tsconfig.json`
- Create: `apps/miniprogram/app.ts`
- Create: `apps/miniprogram/app.json`
- Create: `apps/miniprogram/app.wxss`
- Create: `apps/miniprogram/services/session.ts`
- Create: `apps/miniprogram/services/api.ts`
- Create: `apps/miniprogram/services/auth.ts`
- Create: `apps/miniprogram/services/session.spec.ts`
- Create: `apps/miniprogram/pages/login/{index.ts,index.wxml,index.wxss,index.json}`

**Interfaces:**
- Consumes: auth REST endpoints and shared response types.
- Produces: `session.getAccessToken()`, `session.setTokens()`, `api.request()`, automatic single-flight refresh, and login navigation.

- [ ] **Step 1: Write failing session tests**

Mock `wx.getStorageSync`, `wx.setStorageSync`, `wx.request`, and `wx.login`. Verify token persistence, one refresh request for concurrent 401 responses, one retry after refresh, and logout on failed refresh.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @efm/miniprogram test -- session.spec.ts`  
Expected: FAIL because services do not exist.

- [ ] **Step 3: Configure the native mini-program**

Use TypeScript and npm package building. Set pages to login, profile, and game-account edit. Put the API base URL in compile-time environment configuration; do not embed secrets.

- [ ] **Step 4: Implement session and API clients**

Store access and refresh tokens under versioned keys. `api.request` adds `Authorization: Bearer`, converts the API error envelope into a typed `ApiError`, refreshes once on `AUTH_TOKEN_EXPIRED`, and prevents refresh storms with a shared promise.

- [ ] **Step 5: Implement login page**

On user action, call `wx.login`, send the code to `/v1/auth/wechat`, persist tokens, and redirect to profile. Show actionable error copy and never print login codes or tokens.

- [ ] **Step 6: Run tests and commit**

Run mini-program tests and typecheck; then:

```bash
git add apps/miniprogram pnpm-lock.yaml
git commit -m "feat(miniprogram): add WeChat login shell"
```

---

### Task 10: Add Profile and Game Account Screens

**Files:**
- Create: `apps/miniprogram/components/loading-state/{index.ts,index.wxml,index.wxss,index.json}`
- Create: `apps/miniprogram/pages/profile/{index.ts,index.wxml,index.wxss,index.json}`
- Create: `apps/miniprogram/pages/game-account-edit/{index.ts,index.wxml,index.wxss,index.json}`
- Create: `apps/miniprogram/pages/profile/profile.viewmodel.ts`
- Create: `apps/miniprogram/pages/profile/profile.viewmodel.spec.ts`
- Modify: `apps/miniprogram/app.json`

**Interfaces:**
- Consumes: `GET/PATCH /v1/me` and game-account endpoints.
- Produces: a usable profile screen, account list, add/edit/default/delete actions, and empty/loading/error states.

- [ ] **Step 1: Write failing view-model tests**

Cover empty accounts, default account first, platform labels, disabled save until required fields are valid, API conflict copy, and delete confirmation copy.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @efm/miniprogram test -- profile.viewmodel.spec.ts`  
Expected: FAIL because the view model does not exist.

- [ ] **Step 3: Implement profile page**

Display avatar, name, region, profile completeness, and game accounts. Support pull-to-refresh and explicit loading, empty, error, and loaded states. Editing profile calls `PATCH /v1/me` and updates local state only after success.

- [ ] **Step 4: Implement game account editor**

Fields: platform, server region, gamer tag, optional UID, and default toggle. Submit create or update based on route parameters. Deletion requires confirmation and maps API codes to user-facing Chinese copy.

- [ ] **Step 5: Run mini-program checks**

Run unit tests and TypeScript compilation. Open the project in WeChat DevTools, use the fake gateway in local development, log in, edit a profile, create two accounts, switch the default, and delete the non-default account.

- [ ] **Step 6: Commit**

```bash
git add apps/miniprogram
git commit -m "feat(miniprogram): add profile and game account management"
```

---

### Task 11: Containerize, Document, and Verify the Vertical Slice

**Files:**
- Create: `apps/api/Dockerfile`
- Create: `docs/development/local-development.md`
- Create: `docs/deployment/cloudbase.md`
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: completed API, mini-program, database migration, and environment schema.
- Produces: reproducible local setup, production API image, and a verified release gate.

- [ ] **Step 1: Write the production container**

Use a multi-stage Node.js 24 Alpine image. Install with `pnpm install --frozen-lockfile`, generate Prisma client, build only contracts and API, copy production dependencies and migration files, run as a non-root user, and expose port 3000.

- [ ] **Step 2: Add local and CloudBase runbooks**

Document exact commands for Node selection, dependency installation, MySQL startup, migrations, tests, API startup, mini-program import, CloudBase environment variables, image deployment, health verification, and rollback to a prior container version.

- [ ] **Step 3: Run the full verification suite**

Run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
docker build -f apps/api/Dockerfile -t efm-api:local .
```

Expected: every command exits zero and the image builds.

- [ ] **Step 4: Run a container smoke test**

Start the image with local environment variables, call `GET /v1/health`, perform fake WeChat login, call `GET /v1/me`, and stop the container. Expected: health returns 200, login returns tokens, and profile returns the created user.

- [ ] **Step 5: Review security-sensitive output**

Search logs and repository files for the local secret values and token-shaped strings. Expected: `.env` is ignored, secrets are absent from committed files, and auth logs contain only request IDs and stable error codes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/Dockerfile docs/development docs/deployment package.json .env.example
git commit -m "chore: add deployment and verification workflow"
```

## Completion Criteria

- A clean clone can install, migrate, test, build, and run using documented commands.
- The API exposes health, WeChat login, refresh, logout, profile, and game-account endpoints.
- Refresh sessions rotate and detect replay.
- Disabled users are denied across login, refresh, and protected endpoints.
- Ownership and unique game-account constraints are enforced by API and database.
- The mini-program can log in, edit a profile, and manage multiple game accounts.
- The API builds into a non-root CloudBase-compatible container.
- Unit, end-to-end, typecheck, lint, build, and container smoke checks pass.
