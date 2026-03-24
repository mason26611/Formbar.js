# Formbar.js → TypeScript Conversion Plan

## Problem Statement
Convert the entire Formbar.js codebase (218 JS files — 166 production + 52 tests) from JavaScript (CommonJS) to TypeScript with strict mode. This includes replacing `module-alias` with native `tsconfig` path mappings, defining proper interfaces/types for all data models, and setting up `ts-node`/`tsc` tooling.

## Approach
Phased bottom-up conversion: start with foundational layers (types, config, errors) and work up to dependent layers (services, controllers, sockets). Each phase converts files, ensures the project compiles, and tests pass before moving on.

---

## Phase 0: Project Setup & Tooling
- Install TypeScript, ts-node, @types/* packages
- Create `tsconfig.json` (strict mode, path aliases, CommonJS output)
- Update `package.json` scripts (dev → ts-node/nodemon, build → tsc, start → node dist/)
- Convert `jest.config.js` → `jest.config.ts` with ts-jest
- Remove `module-alias` dependency and `require("module-alias/register")` calls
- Remove `jsconfig.json` (superseded by tsconfig)
- Update `.prettierrc` to include `*.ts` files
- Update `.gitignore` with `dist/` output directory

## Phase 1: Type Definitions & Interfaces
- Create `types/` directory with shared interfaces:
  - `types/database.ts` — All 24 DB table row interfaces (User, Classroom, ClassUser, CustomPoll, etc.)
  - `types/api.ts` — Express request/response extensions (authenticated req, paginated response)
  - `types/socket.ts` — Socket.IO event maps (client→server, server→client)
  - `types/config.ts` — Config/settings shape
  - `types/stores.ts` — Store state shapes (ClassState, SocketState, PollState)
  - `types/index.ts` — Re-export barrel

## Phase 2: Core Modules (modules/)
Convert 14 files — these are the foundation everything depends on:
- `modules/config.ts`
- `modules/crypto.ts`
- `modules/database.ts` — Add generic typed wrappers: `dbGet<T>()`, `dbGetAll<T>()`, `dbRun()`
- `modules/error-wrapper.ts`
- `modules/google-oauth.ts`
- `modules/logger.ts`
- `modules/mail.ts`
- `modules/permissions.ts`
- `modules/pin-validation.ts`
- `modules/roles.ts`
- `modules/scope-resolver.ts`
- `modules/socket-error-handler.ts`
- `modules/util.ts`
- `modules/web-server.ts`

## Phase 3: Error Classes (errors/)
Convert 7 files — straightforward class hierarchy:
- `errors/app-error.ts` (base)
- `errors/auth-error.ts`
- `errors/conflict-error.ts`
- `errors/forbidden-error.ts`
- `errors/not-found-error.ts`
- `errors/rate-limit-error.ts`
- `errors/validation-error.ts`

## Phase 4: Stores (stores/)
Convert 5 files — in-memory state stores:
- `stores/api-key-cache-store.ts`
- `stores/class-code-cache-store.ts`
- `stores/class-state-store.ts`
- `stores/poll-runtime-store.ts`
- `stores/socket-state-store.ts`

## Phase 5: Middleware (middleware/)
Convert 6 files — Express middleware:
- `middleware/authentication.ts`
- `middleware/error-handler.ts`
- `middleware/parse-json.ts`
- `middleware/permission-check.ts`
- `middleware/rate-limiter.ts`
- `middleware/request-logger.ts`

## Phase 6: Services (services/)
Convert 16 files — business logic layer:
- `services/app-service.ts`
- `services/auth-service.ts`
- `services/bootstrap-service.ts`
- `services/class-service.ts`
- `services/classroom-service.ts`
- `services/digipog-service.ts`
- `services/inventory-service.ts`
- `services/ip-service.ts`
- `services/log-service.ts`
- `services/manager-service.ts`
- `services/notification-service.ts`
- `services/poll-service.ts`
- `services/room-service.ts`
- `services/socket-updates-service.ts`
- `services/student-service.ts`
- `services/user-service.ts`

## Phase 7: Database Layer (database/)
Convert 25 files — init, migrations, utilities:
- `database/init.ts`
- `database/migrate.ts`
- `database/modules/crypto.ts`
- `database/migrations/JSMigrations/*.ts` (23 migration files)

## Phase 8: Socket Handlers (sockets/)
Convert 20 files — Socket.IO event handlers:
- `sockets/init.ts`
- `sockets/user.ts`, `sockets/updates.ts`, `sockets/class.ts`, `sockets/break.ts`, `sockets/help.ts`, `sockets/digipogs.ts`, `sockets/tags.ts`, `sockets/backwards-compat.ts`
- `sockets/middleware/` (5 files: api.ts, authentication.ts, inactivity.ts, permission-check.ts, rate-limiter.ts)
- `sockets/polls/` (6 files: poll-creation.ts, poll-response.ts, poll-removal.ts, update-poll.ts, save-poll.ts, share-poll.ts)

## Phase 9: API Controllers (api/)
Convert 77 controller files — Express route handlers organized by domain:
- `api/v1/controllers/config.ts`, `certs.ts`, `logs.ts`, `ip.ts`, `api-permission-check.ts`, `controller-template.ts`
- `api/v1/controllers/auth/` (4 files)
- `api/v1/controllers/user/` (multiple subdirectories, ~20 files)
- `api/v1/controllers/class/` (multiple subdirectories, ~20 files)
- `api/v1/controllers/room/` (~8 files)
- `api/v1/controllers/oauth/` (3 files)
- `api/v1/controllers/digipogs/` (2 files)
- `api/v1/controllers/pools/` (5 files)
- `api/v1/controllers/notifications/` (3 files)
- `api/v1/controllers/manager/` (1 file)
- `api/v1/controllers/apps/` (1 file)

## Phase 10: Entry Point
Convert root entry point:
- `app.ts` (replace `app.js`)

## Phase 11: Tests
Convert 52 test files to TypeScript:
- `jest.setup.ts` (replace `jest.setup.js`)
- `api/v1/controllers/tests/*.spec.ts` (19 files)
- `services/tests/*.spec.ts` (15 files)
- `sockets/tests/*.spec.ts` (12 files)
- `modules/tests/*.spec.ts` (6 files)
- `modules/test-helpers/db.ts`

## Phase 12: Cleanup & Verification
- Delete all original `.js` files (replaced by `.ts`)
- Run `tsc --noEmit` to verify full compilation
- Run `npm test` to verify all tests pass
- Run `npm run dev` to verify app starts correctly
- Update README.md references from JS to TS
- Final `npm run build` to produce `dist/` output

---

## Key Decisions
- **Module system**: Keep CommonJS output (`"module": "commonjs"` in tsconfig) for Node.js compatibility
- **Path aliases**: Native tsconfig `paths` + `tsconfig-paths` for runtime resolution (replaces `module-alias`)
- **Test runner**: `ts-jest` transformer for Jest
- **Strict mode**: `strict: true` in tsconfig (noImplicitAny, strictNullChecks, etc.)
- **Database typing**: Generic wrappers `dbGet<T>()` with row type parameters
- **Express extensions**: Augment `express.Request` with `user`, `logger`, `logEvent`, etc.
- **Socket.IO**: Typed event maps for `Server<ClientToServerEvents, ServerToClientEvents>`

## Notes
- The `Formbar.ts-client/` directory is a separate project and will NOT be converted
- Database migration files (.ts) will still be run via ts-node
- The `express-async-errors` package works with TypeScript as-is
- Swagger JSDoc annotations in controllers will be preserved as-is in comments
