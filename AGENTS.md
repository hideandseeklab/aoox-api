# aoox-api

## Language

- Write everything in this repository in English: AGENTS.md, README, CONTRIBUTING, CHANGELOG, code comments and commit messages. Existing Indonesian text is being translated gradually; do not add new Indonesian text.

NestJS 11 backend for aoox (self-hosted PaaS).

## Folder structure

- All modules live in `src/modules/<module-name>/`.
- Controllers, services, and DTOs that belong to one flow are kept together in a subdirectory under the module, named after the flow. Example:

  ```
  src/modules/project/
  ├── project.module.ts
  ├── create-project/
  │   ├── create-project.controller.ts
  │   ├── create-project.service.ts
  │   └── create-project.dto.ts
  └── list-projects/
      ├── list-projects.controller.ts
      ├── list-projects.service.ts
      └── list-projects.dto.ts
  ```

## Commands

- `npm run start:dev` — dev server (watch)
- `npm run build` — build to `dist/`
- `npm run lint` — eslint --fix
- `npm test` / `npm run test:e2e`

## Git

- Do not commit or push unless explicitly instructed by the user.

## Database

- PostgreSQL 16 via `docker-compose.yml` (`npm run db:up` / `db:down`), database `aoox`.
- Configuration from `.env` (see `.env.example`), loaded by `@nestjs/config`.
- ORM: TypeORM (`src/modules/database/`). `synchronize` is always `false` — schema changes go through migrations:
  - `npm run migration:generate -- src/modules/database/migrations/<Name>`
  - `npm run migration:run` / `npm run migration:revert`
  - **`migration:generate` shows unrelated drift on purpose.** Several foreign keys and indexes exist only in hand-written migrations, not as entity decorators: FKs without a TypeORM relation so that modules do not import each other (e.g. `applications.secret_connection_id`, `domains.dns_connection_id`, `mounts.compose_app_id`, `proxy_dns_bindings.*`, `registries.storage_destination_id`), partial or expression unique indexes that decorators cannot express (e.g. `UQ_proxy_dns_bindings_host` on `((1)) WHERE server_id IS NULL`), and named constraints whose decorator names differ (inbox, query history, compose deployments, database companions). A generated migration therefore contains DROP/CREATE lines for them: delete those lines and keep only the change you made. Verify a new migration with `typeorm schema:log` against a freshly migrated database.
- Entities are written as `*.entity.ts` inside each module (`src/modules/<module>/`), and are loaded automatically (`autoLoadEntities`).

## Auth

- `src/modules/auth/` — JWT (Bearer) via `@nestjs/jwt` + `passport-jwt`. Flow: `sign-in/`.
  Non-flow artifacts (`jwt.strategy.ts`, `jwt-auth.guard.ts`, `current-user.decorator.ts`) live at the module root.
- `src/modules/user/` — entity `User` (`users`), `UserService` for cross-flow queries.
- Onboarding: `setup-status/` (`GET /auth/setup-status`) and `setup/` (`POST /auth/setup`, only while the `users` table is empty, SERIALIZABLE transaction) create the first owner.
  `me/` (`GET /auth/me`) is used by the web app to verify the session **and** carries `version` (the running API version from `package.json`, `me/app-version.ts`, read once) for all roles —
  the web sidebar shows it below the logo with no extra call (the dashboard layout already calls `/auth/me`); `GET /instance/update` remains owner-only.
  `GET /` (public, `app.controller.ts`) answers `{description: 'aoox api', version}` from the same `appVersion()`, so opening the API address in a browser shows what is running.
- `AdminBootstrapService` (user module): if `ADMIN_EMAIL`+`ADMIN_PASSWORD` are set and no user exists yet, create an owner at boot. Idempotent — it never overwrites existing users.
  Dev: `.env` contains `admin@gmail.com` / `admin` for this (there is no seed migration anymore).
- Password hashing via `src/modules/user/password.util.ts` (bcryptjs).
- **`JwtStrategy.validate` reloads the user from the DB on every request** (role & existence): changing a role or deleting a user takes effect on the next request, not when the 7-day token expires.
  The 60-second terminal ticket still carries `role` from its payload.
- **Members & invitations**: `src/modules/invitation/` — entity `Invitation` (`invitations`: email, role, `token_hash` SHA-256 unique, `invited_by_id`, `expires_at` 7 days, `accepted_at`).
  `create-invitation` (owner/admin; only an owner may invite an owner; replaces the pending invitation for the same email; the token is returned only once +
  `acceptUrl` = `${WEB_ORIGIN}/invite/<token>`), `list/revoke-invitation`, **public** `GET /invitations/by-token/:token` (preview) and `POST /invitations/accept`
  (throttle 10/minute; email+role come from the invitation, the form only asks for name+password; claiming `accepted_at` happens in a transaction → one link, one account; replies with `SignInResponseDto`).
  `src/modules/user/`: `list-users` (owner/admin), `update-user-role` & `delete-user` (owner only; cannot act on yourself, `assertNotLastOwner`,
  `assertOwnsNoProjects` because `projects.owner_id` cascades). No emails are sent — the link is copied from Settings. Per-project membership: see the Project section.
- **API token** (`src/modules/api-token/`, entity `ApiToken` in `api_tokens`: `token_hash` SHA-256 unique `select:false`, `prefix` 10 chars for display, `expires_at`, `last_used_at`,
  `read_only`, `project_ids` jsonb):
  token `aoox_` + 40 alphanumeric characters, plaintext returned only once by `POST /api-tokens`; acts as its owner user (same role, read from the DB on every request).
  `JwtAuthGuard` now accepts both: a bearer that `looksLikeApiToken` → `ApiTokenService.resolve` (hash lookup, expiry check, `lastUsedAt` written at most 1×/minute) → `req.user`
  `{sub,email,role,tokenId}`; otherwise it falls through to passport-jwt. Wrong/expired token → 401. The module is `@Global()` because the guard is instantiated in every module. Flow `create/list/delete-api-token`
  (`/api-tokens`, owned by the user themselves). **Scope per token** (migration `ApiTokenScope`): `readOnly` → every state-changing request is rejected with 403 (uses the same `isWriteRequest()` as viewer, so websocket tickets are still allowed);
  `projectIds` → the token only sees those projects **and** is rejected on all `@Roles`-decorated routes (manage registries, servers, proxy, swarm,
  notifications, maintenance, audit log, members — platform settings). What stays open to scoped tokens are platform routes **without** `@Roles`, all of them read-only GETs
  (`list-registries`, `list-repositories`, `list-tags`, `self-hosted-status`, `proxy-status`, `list-destinations`) — intended for all members; `POST /users/me/password`
  is also without `@Roles` but already rejects API-token actors. Terminal tickets (`POST /terminal/tickets`) = write → read-only token gets 403 (tested). Both are decided **only in `JwtAuthGuard`**, which puts a `TokenScope` into the request context (`setTokenScope`;
  sessions get `FULL_SCOPE`, so an empty scope only means "not an HTTP request" = background work, not a wiring bug); `ProjectAccessService.roleFor`/
  `accessibleProjectIds` **intersect** it with the user's access — a scope never expands access, including for platform owner/admin. `POST`/`DELETE /api-tokens` reject actors
  using an API token (`user.tokenId` → 403) so a token cannot mint unlimited tokens; the requested `projectIds` are validated via `accessibleProjectIds` of the creator.
  Tested E2E (full/read-only/scoped tokens): deploy 202/403/409, log-ticket 201 for all three, `GET /databases/:id` on another project 200/200/404, `/proxy` `/swarm` `/audit-logs` 403 for
  the scoped token. Not yet: per-resource scopes (e.g. deploy only), organization-owned tokens.
- **Audit log** (`src/modules/audit-log/`, `@Global()`; entity `AuditLog` in `audit_logs`: actor snapshot `actor_id`/`actor_email`, `via` session|token|webhook|anonymous, `token_id`,
  `action` = route template (`POST /applications/:id/deploy`), `path`, `params`, `body` (redacted: keys containing password/secret/token/key/content/env → `[redacted]`, strings truncated to 200,
  total ≤ 4 KB; `redact.ts` is pure & unit-tested), `status`, `ip`). Written by `AuditLogInterceptor` (`APP_INTERCEPTOR`) for all non-GET requests that reach a handler, with the final status
  (2xx or HttpException code); guards that reject (401/403) are not logged. `POST /auth/sign-in` & `/2fa` are logged by `SignInService` itself (success 200 / failure 401, IP).
  Inserts are fire-and-forget (`save` — TypeORM's `insert` rejects the jsonb type). Retention 90 days (`@Cron` 03:17). `GET /audit-logs?limit&before&actorId&action` owner/admin (cursor `before`).
- **Password**: `POST /users/me/password` (`change-password/`, requires the old password, session only — not API tokens) and `POST /users/:id/password` (`set-user-password/`, owner for non-owners, reset without email — handed over directly). Minimum 8 characters (dev `admin`/`admin` only via bootstrap env).
- **2FA TOTP** (`src/modules/auth/two-factor/`): `totp.ts` = our own implementation of RFC 4226/6238 (SHA-1, 6 digits, 30 s, ±1 step, base32, `otpauth://`) with RFC test vectors —
  **not otplib** (v13 depends on the ESM-only `@scure/base`, which breaks Jest — same pattern as Nest v12). `qrcode` (CJS) for the QR data URL. User columns: `totp_secret_encrypted`
  (AES with `ENCRYPTION_KEY`, `select:false`), `totp_enabled`, `totp_backup_hashes` (SHA-256 of 10 backup codes, removed when used). Flow `POST /auth/2fa/setup` (new secret + QR, not active yet),
  `/enable {code}` (returns the backup codes once), `/disable {password}`; owner `POST /users/:id/2fa/disable` for a locked-out non-owner. All only from a password session.
  Two-step sign-in: `POST /auth/sign-in` → `{requiresTwoFactor, challengeToken}` (5-minute JWT with `scope: '2fa'`) → `POST /auth/sign-in/2fa {challengeToken, code}` (TOTP or backup code).
  **`JwtStrategy.validate` rejects JWTs carrying a `scope`** (challenge, terminal/logs tickets) as a session — previously a challenge token passed as a full Bearer. API tokens skip 2FA (separate secret).
- **Swagger/OpenAPI**: `@nestjs/swagger@11` (v12 is ESM-only like other Nest packages) in `main.ts` → `/docs` (UI) and `/docs-json`; DTO/entity schemas are picked up by the **CLI plugin** `@nestjs/swagger`
  in `nest-cli.json` (`introspectComments`, suffixes `.dto.ts` & `.entity.ts`) — no manual `@ApiProperty`. Jest does not use the plugin (only `nest build` does), so schemas are complete only in the build.
  The `@ApiTags/@ApiBearerAuth/@ApiOperation` decorators are so far used only in api-token; other endpoints appear without descriptions.
- Global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`) — every body must go through a class-validator DTO.
- Rate limiting: global `@nestjs/throttler` (300/minute) via `APP_GUARD`; `sign-in` & `setup` 10/minute, `terminal/tickets` 20/minute (`@Throttle`).
- Nest packages must stay on the v11 line (`@nestjs/jwt@11`, `@nestjs/config@4`, `@nestjs/passport@11`, `@nestjs/typeorm@11`, `@nestjs/websockets@11`) —
  v12 releases are ESM-only and break Jest.

## Project

- `src/modules/project/` — entity `Project` (`projects`, FK `owner_id` → `users`, cascade delete) and **`ProjectMember`** (`project_members`: `project_id`+`user_id` unique, cascade on
  both, `role` `admin|developer|viewer`). **Per-project access** goes through one place, `ProjectAccessService` (exported by ProjectModule): platform owner/admin → all projects (as admin);
  the creator (`owner_id`) → that project as admin; otherwise only projects that have a `project_members` row. A project the caller may not see returns **404** (not 403, so the id does not leak).
  `ProjectService.findOwnedOrFail` and 6 other `findOwnedOrFail` (application, compose, managed DB, database backup, volume backup, job — jobs through their app/DB/compose owner)
  call `access.assertAccess(ownerId, project)`; `list-projects` uses `access.whereAccessible`, `project-summary` uses `accessibleProjectIds` (`$1::boolean OR p.id = ANY($2)`).
  What **deliberately** skips the check: logs/terminal gateways (their tickets already passed `findOwnedOrFail`), webhooks (token = auth), all background work (schedulers/watchers/runners use repositories
  directly — do not redirect them to this check, or they will stop running on schedule), and platform resources (registry, servers, proxy, notifications, swarm…) guarded by `RolesGuard`. Guard rejections are not written to the audit log
  (404 probing for members is not recorded). The spec `project-access.service.spec.ts` runs through all 7 helpers: members can see, outsiders get 404 — it fails if an 8th resource is forgotten.
  The `ProjectMembers` migration **backfills** every `member` user into every project as `developer` (the upgrade changes nothing until an admin removes someone).
  **Role levels**: `admin` = manage members + delete project (`assertAdmin` → 403); `developer` = all other actions; `viewer` = **read only** — enforced centrally in `assertAccess`
  via `src/modules/auth/request-context.ts`: a global middleware puts the request's `{method, path}` into `AsyncLocalStorage` (`req.originalUrl`, because `req.path` is relative to the middleware mount point),
  `isWriteRequest()` (pure, unit-tested) treats GET/HEAD/OPTIONS and POST `…/log-ticket` (websocket ticket = read) as reads, everything else as writes → viewer 403.
  Background work has no store, so it is never restricted. A deliberate consequence: `POST /databases/:id/query` is rejected for viewers even for SELECT (the endpoint can write for owner/admin).
  `get-application`/`get-database` return `projectRole` so the web can hide actions. Tested: viewer GET app/db/log 200, log-ticket 201, deploy/patch/delete/backup/query 403,
  managing members 403; developer may change the project but member management and project deletion 403. Member flows: `list-members` (`GET /projects/:id/members` → `{myRole, members[]}` including implicit members), `add-member` (`POST`, by **email** of an existing account;
  platform owner/admin and the creator are rejected with 400 because they are already implicit), `update-member` (`PATCH /:userId`), `remove-member`. Deleting a user cascades their membership rows.
- `project-summary/` (`GET /projects/summary`, registered **before** `get-project` so it is not captured by `:id`): `{total, active, inactive}` — active = has ≥1 application/
  managed database/compose app in status `running` (the status column observed by aoox, one SQL query with `count(*) FILTER`), no Docker calls; filtered by access.
- `list-projects/` returns `ProjectListItemDto` = project + `instances[]` (`{kind: application|database|compose, id, name, status, engine, deploying}`; one `UNION ALL` query over the three tables with `project_id = ANY($1)`, raw SQL like summary because ProjectModule cannot import other modules — they import it)
  for the overview cards. **`deploying`**: a "deploying" badge without Docker calls — application = `EXISTS` in `deployments` with an active status
  (`queued`/`building`/`pushing`/`starting`, a per-row subquery inside the same `UNION ALL`, still one round trip); database = `status = 'creating'`;
  compose = `status = 'deploying'` (the stack already has this status itself; it is normalized into one uniform boolean across kinds so the web does not need per-kind logic). Web: `project-card.tsx` shows an amber badge + `ProjectsAutoRefresh` (client component, `router.refresh()` every 4 seconds) that is active only while any `deploying` instance is on the `/projects` page and stops by itself once the last badge disappears.
- Flows: `create-project/`, `list-projects/`, `get-project/`, `update-project/`, `delete-project/` — all `@UseGuards(JwtAuthGuard)`,
  the owner is taken from `@CurrentUser()`, never from the body.
- Time columns use `timestamptz` (migration `UseTimestamptz`); use the same type for new entities.

## Terminal (web shell)

- `src/modules/terminal/` — `terminal.gateway.ts`: Socket.IO gateway on namespace `/terminal` (`@nestjs/websockets` +
  `@nestjs/platform-socket.io`, following https://docs.nestjs.com/websockets/gateways), one `TerminalSession` per socket. Flow `create-ticket/` (`POST /terminal/tickets`).
- The shell backend is chosen by `terminal-backend.service.ts`: **`ssh.session.ts`** (`ssh2` library, to the host) when `TERMINAL_SSH_HOST` is set,
  otherwise **`local-pty.session.ts`** (`node-pty`: PowerShell on Windows / `$SHELL` on Unix). In Docker it always uses SSH so the terminal enters the host, not the container.
- `src/modules/ssh/` — shared SSH primitives: `ssh.session.ts` (`SshSession.open(target, size)`, `ssh2` library) and `ssh-key.service.ts` (automatic **platform key**:
  ed25519 via `ssh2.utils.generateKeyPairSync`, stored in `TERMINAL_SSH_KEY_DIR`, default `./secrets` — in the dist compose `/run/secrets/aoox`, read-write bind mount, git-ignored;
  helpers `authorizeCommand`, `describeKeyError`, `isAuthFailure`). `SshModule` is imported by the terminal and server modules.
- SSH credentials to the host (priority order): `TERMINAL_SSH_PRIVATE_KEY`/`_FILE` → `TERMINAL_SSH_PASSWORD` → platform key.
  The API cannot write the host's `authorized_keys`, so the user runs one command once on the host. The command + public key are shown in
  `GET /terminal/status` (`terminal-status/`, owner/admin) and sent by the gateway as an `error` event when SSH authentication fails (`isAuthFailure`);
  if the key directory is not writable (uid 1000) → `SshKeyPermissionError` + a `chown` hint. Credential problems never fail boot — they only surface per connection/status.
- **`TERMINAL_SSH_USER` empty → `root`** (`DEFAULT_TERMINAL_SSH_USER` in `terminal-backend.service.ts`): `install.sh`/`aoox install` writes `TERMINAL_SSH_USER=root` only for NEW installations, while `aoox update`/"Apply update" only replaces the image and never touches `.env.dist` — older installations lack that line, and the terminal used to throw `TERMINAL_SSH_USER is not set` even when `TERMINAL_SSH_HOST` was set. The SSH-to-host backend now uses `root` (the installer default; the installer itself needs root).
  NEW installations via `aoox install` now write the user running `sudo` (`SUDO_USER`) instead of `root` (see AGENTS of aoox-cli) — cloud images (Ubuntu/Tencent)
  usually refuse root SSH login and root has no `authorized_keys`, so "SSH authentication failed for root@host.docker.internal" appeared for the `ubuntu` user;
  the API default above stays `root` for older installations that lack the line.
  **Auth-failure hint**: `authorizeAdvice(username, where)` (`ssh/ssh-key.service.ts`) — the sentence "run as <user>" (not with sudo) and, only when user = `root`,
  a note about `PermitRootLogin`: set User in Infrastructure → Environment (or the server settings for a remote server), then run the command as that user. Used in two places: the text of the gateway's
  `error` event (second argument; the event shape and the third `hint` argument **do not change**) and the new `authorizeNote` field in `GET /terminal/status` (additive; `null` when there is no authorize command).
  `authorizeCommand` remains exactly one line as before (the web copies it as-is — do not put `#` comments in it, the rest of the line would become a shell comment).
  `TerminalBackendService.authHint()` now also returns `username`.
  **Automatic key authorization** (`authorize-terminal/`, `POST /terminal/authorize`, `@Roles('owner')`, throttle 5/minute, no body; POST ⇒ viewer 403, logged in the audit log automatically):
  writes the **platform public key** (`SshKeyService.load().publicKey`) to `~/.ssh/authorized_keys` of user `TERMINAL_SSH_USER` on the Docker host, replacing the manual `echo '<key>' >> …`.
  200 `{ok:true, user, alreadyAuthorized, verified, message}`; `verified` = after writing, `SshSession.probe` (log in, then close, no shell, 8 s) succeeded — failure does not fail the endpoint (`verified:false` + reason; auth rejected → "sshd may use a different AuthorizedKeysFile, SELinux, key login disabled"). 400 when: not the SSH backend, explicit credentials (key/password env),
  `TERMINAL_SSH_HOST` is not the Docker host (`host.docker.internal`/`localhost`/`127.0.0.1`/`::1`/`172.17.0.1`, `isLocalSshHost`), invalid user name, user not in the host's passwd, invalid home (`isValidHome`: absolute, not `/`, no `..`/spaces/control characters), `.ssh`/`authorized_keys` is a symlink; 502 when the helper container fails. `GET /terminal/status` + `canAutoAuthorize` (true only when `autoAuthorizeBlocker()` is null) so the web shows the button only when it can work. **Mechanism**: two one-shot `busybox:stable` containers (`DockerService.runOnceWithOutput`, `NetworkMode: none`,
  label `aoox.component=build`, always removed): (1) the host's `/etc/passwd` is mounted **read-only** and `awk` reads `uid:gid:home` — the user name only comes through the env `AOOX_USER` + `ENVIRON[]`;
  (2) the home is mounted read-write via the long-form `HostConfig.Mounts` (not `Binds`: a `bind` mount **fails** when the host path does not exist, whereas `Binds` silently creates a root-owned directory — tested) and the script `WRITE_SCRIPT` (`terminal-authorize.ts`) receives `KEY`/`OWNER_UID`/`OWNER_GID` via env: `mkdir -p`, `chmod 700 .ssh`, `chmod 600 authorized_keys`, `grep -qxF` (exit 10 = already present →
  `alreadyAuthorized`), adds a newline when needed, `chown uid:gid` on `.ssh` and the file (**not recursive**, deviating from "chown -R" in the early design because the helper runs as root and must not follow links from inside the user's home), refuses symlinks (exit 3). Engine log output gets a timestamp prefix → `parseAccountOutput` matches the tail of the line.
  **Security**: this access is equivalent to what the API already has through the Docker socket; owner only; only the public key is written (never a password or private key); the audit log records it. **Limits**:
  non-standard `AuthorizedKeysFile`, SELinux, non-standard home/NFS, `sshd` that disables key login, remote servers (still manual), and local PTY mode. Tested for real in Docker: the write script on a volume with a fake `/etc/passwd` (`.ssh` absent; present with another key and no trailing newline; same key = no duplicate; loose permissions fixed; symlink refused), passwd lookup and refusal of a non-existent home mount through the real `DockerService`. **Not tested yet**: a Linux host with a real sshd (the `verified` path is unit-test only).
  **Only** for the env backend — remote servers keep using their own `Server.username`. `GET /terminal/status` no longer has that error and returns the effective `username` +
  `usernameSource: 'env' | 'default'` (null in local mode) so the web can tell "explicitly set" apart from "default". The Socket.IO `error` event now has an optional second argument
  `hint` (`'environment'` = failed to open the host shell, `'servers'` = remote server; `undefined` for local PTY and ticket/origin errors) — computed by `TerminalGateway.configHint()`
  and mirrored in the web (`terminal.protocol.ts`), used by `terminal-view.tsx` to show a link to Infrastructure → Environment / Remote servers (Environment is owner-only,
  so admins see the page name, not a link).
- **Remote servers** (`src/modules/server/`, entity `Server` in `servers`: host/port/username, `private_key_encrypted` nullable `select:false` — null = use the platform key):
  flows `create/list/delete-server`, `test-server` (open+close a shell; on auth failure → `authorizeCommand` when using the platform key), `platform-ssh-key/` (`GET /servers/ssh-key`).
  All `@Roles('owner','admin')`. `ServerService.resolve(id)` → `SshTarget` (+`usesPlatformKey`).
  Terminal to a remote server: the client sends `serverId` in the body of `POST /terminal/tickets`; the service verifies the server exists and **binds it to the ticket payload** —
  the gateway reads only `payload.serverId`, and `handshake.auth.serverId` is ignored. `TerminalBackendService.open(size, serverId?)`; `authHint(serverId?)` for auth-failure messages.
- **Deploying to a remote server**: `Application.serverId` (FK `servers`, `ON DELETE RESTRICT` → deleting a server that still has apps = 409). Transport = the way `docker -H ssh://` works:
  `ssh-docker.agent.ts` (docker module) = an `http.Agent` that per request runs **`docker system dial-stdio`** on the server through one `ssh2` session (lazy, reconnects) —
  it only needs the docker CLI on the server, not port forwarding (sshd hardened with `AllowTcpForwarding no` still works; streamlocal forwarding fails there). The ssh2 channel gets no-op `setNoDelay/setKeepAlive/setTimeout/ref/unref` so Node's HTTP client accepts it; **it must go through the Agent** — `createConnection` in request options with `agent:false` is ignored by Node
  (the request goes to localhost:80). `DockerEngineClient` accepts `{socketPath}` or `{agent,label}`; `engine.target` is used for logs.
  `DockerHandle` (docker.service.ts) = helpers (`findContainerByName`, `ensureNetwork/Image`, `runOnce*`) on top of one engine; `DockerService` = the local handle.
  `RemoteDockerService.forServer(serverId|null)` (server module, one session cached per server, `forget(id)`) is used by the runner, get/stop/start/delete, logs, logs gateway, metrics,
  and the nixpacks builder (`build(input, onLine, docker)`). On remote servers: the build runs on the server's daemon, **no push** to a registry (the local registry is unreachable from there; the
  imageRef is `aoox/<project>/<app>:<tag>`, rollback uses images still present on the server), **no Traefik labels** (the proxy exists only on the host — use the host port),
  container-down metrics & notifications **are monitored** (see "Remote server monitoring" below); the disk watcher, certificate watcher, and disk retention remain local. `test-server` also checks Docker through the tunnel (`dockerVersion`/`dockerError`).
- **Per-server proxy**: `ProxyService` now works on any `DockerHandle` with explicit `ProxySettings` (`statusOn/provisionOn/removeOn`; `status/provision/remove` =
  the local handle + `localSettings` from env). `Server` has `proxy_http_port`/`proxy_https_port`/`acme_email`/`acme_staging` (`proxySettingsOf(server)`); flow `server-proxy/`
  (`GET/POST/DELETE /servers/:id/proxy`, POST saves the settings and then **replaces** the existing proxy container). The runner's `replaceContainer` no longer drops domains for remote apps:
  the Traefik labels are built with that server's proxy settings (`labelsFor(..., settings)`), so the Domain tab and DNS check work on remote servers. The proxy container name is the same (`aoox-proxy`)
  on every daemon — do not point a "server" at the same daemon as the host (my test used an sshd+docker-cli container with the host socket: the host proxy was replaced too; re-provisioned).
- **Volume backups on remote servers**: `VolumeBackupService` uses `remote.forServer(app.serverId)` for the tar/restore/download/delete helpers; `BackupDestinationService.upload/download/remove`
  and `BackupFilesService.localFiles/annotate/ensureLocal` accept an optional `DockerHandle` (rclone & busybox run on the app's daemon; the `aoox_backups` volume exists per daemon).
  The `serverId` gate in the service/scheduler/controller was removed. Tested via a simulated SSH server: proxy provisioning + domain routing, backup → restore → download.
- Events: client → `input(string)`, `resize({cols,rows})`; server → `output`, `exit`, `error`. Defined in `terminal.protocol.ts` (mirrored in the web).
- Auth: browsers cannot send an Authorization header during the handshake, so the client exchanges the session for a **60-second JWT ticket**
  (`scope: terminal`) and sends it in `socket.handshake.auth` together with `cols/rows`. The gateway also rejects an `Origin` other than `WEB_ORIGIN`.
- The shell is killed when the socket disconnects. `main.ts` enables CORS for `WEB_ORIGIN` because browser clients connect directly.
- Only the `owner`/`admin` roles (`TERMINAL_ROLES`): checked when creating the ticket (403) and again in the gateway from the `role` in the ticket payload. Single-use tickets (`jti`, in-memory).
- This is equivalent to a remote shell on the host — only for trusted dev/self-hosted environments. The SSH host key is not verified yet.

## Container console

- Unlike the Terminal (a shell on the **host** over SSH): the Console (`src/modules/application/console.gateway.ts`, namespace `/console`) is `docker exec -it` into
  **the application's own container**, through the Docker Engine API — not SSH at all. `DockerEngineClient.execTty()` (`docker-engine.client.ts`): `POST /containers/{id}/exec`
  with `Tty: true`, then `POST /exec/{id}/start` is **hijacked** (`Connection: Upgrade`/`Upgrade: tcp`, per docs.docker.com/reference/api/engine/ "Hijacking") through the private method
  `hijack()`, which listens for Node `http.request`'s `'upgrade'` event to take the raw duplex socket — TTY mode has no 8-byte frame header like plain `exec`/`execWithCode`,
  so stdout/stderr are already plain bytes. **Automatically transport-agnostic**: `hijack()` uses the same `this.connection` as the whole client (a local socket or
  `SshDockerAgent`/`docker system dial-stdio` for remote servers) — there is no separate code for apps on remote servers, because `http.request` treats the `'upgrade'` event
  exactly the same whatever the transport. `resizeExec()` = `POST /exec/{id}/resize?h=&w=`; `execExitCode()` = `GET /exec/{id}/json` after the socket `close`, for `ExitCode`.
- Shell: `sh -c 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'` (`SHELL_DETECT_CMD` in `console.gateway.ts`) — try bash first (more comfortable), fall back to sh (almost always present).
  **Tested for real**: `debian:bookworm-slim` (bash) and `alpine` (sh only) both picked the right shell; `registry.k8s.io/pause:3.9` (a scratch image with no shell at all, but it keeps running forever — a stand-in for "distroless" that can be `docker run` without a command) hijacks **successfully**, then the daemon itself streams the message `OCI runtime exec failed: ... executable file not found` as normal terminal output before exiting with code 127 — **not** a translated `error` event;
  this is intentionally left as is, because that is exactly how the real `docker exec -it` CLI shows it. `describeExecError()` remains as a safety net for the case where the daemon refuses **before** the hijack (container stopped → "is not running" message, tested for real with a stopped container).
- **Ticket** (`create-console-ticket/`, `POST /applications/:id/console-ticket`, throttle 20/minute): unlike `log-ticket`, this ticket **binds the already-resolved container id** into the payload (`ConsoleTicketPayload.containerId`) — not just the `applicationId` — so the socket handshake can never choose its own container, the same pattern as `serverId` in the terminal ticket. Mode `container` → `RemoteDockerService.forServer(app.serverId).findContainerByName(containerNameFor(app))`, must be `State ===
  'running'` or 400. Mode `service` (swarm) → `SwarmDeployService.taskContainers(app)` (tasks **on this node only**, see the Docker Swarm section); without `containerId` in the body → the latest
  task (index 0, already sorted by `taskContainers()`); with `containerId` → it must be in the current task list, otherwise 400.
  **Access control comes for free from existing infrastructure, with no new code**: this route is **deliberately not** added to `READ_ONLY_POSTS` in `request-context.ts` (which only contains `/log-ticket`) — so `isWriteRequest()` treats it as a write, and `ProjectAccessService.assertAccess()` (called via `ApplicationService.findOwnedOrFail`)
  automatically rejects `viewer` with 403; `JwtAuthGuard` automatically rejects `readOnly` API tokens with 403 too (exactly the same mechanism as other write endpoints).
  Developer/admin/owner pass. Because the request reaches the handler (it is not rejected by a guard), **the audit log records it automatically** through the existing `AuditLogInterceptor`
  (`action: "POST /applications/:id/console-ticket"`, status 200/403, actor, no extra code) — tested for real: the viewer 403 is recorded; the readOnly token 403 is **not** recorded
  (rejected in the guard, consistent with the rule "rejections by guards are not logged" in the Auth → API token section).
- `ConsoleGateway` copies the `TerminalGateway` pattern exactly: in-memory `usedTickets` Map (single-use tickets), an `Origin` ≠ `WEB_ORIGIN` check → reject, the same protocol events
  (`input`/`resize`/`output`/`exit`/`error`). `console.protocol.ts` (mirrored in the web at `features/console/console.protocol.ts`). The exec is `destroy()`ed when the Socket.IO socket disconnects (`handleDisconnect`); a dying container or an exec that ends sends `exit` with the code from `execExitCode()` and then disconnects the socket.
- **Tested end-to-end over real HTTP + WebSocket** (not just `DockerEngineClient` alone): real sign-in → create a ticket via `POST .../console-ticket` →
  connect `socket.io-client` to `/console` with that ticket → send `input`, receive `output` (the real shell echo) → `resize` → `exit 0` → `exit` event with code 0. Also: wrong origin rejected, a ticket used twice rejected on the second attempt, readOnly API token 403, project `viewer` 403, `developer` 200 — all against real accounts and tickets,
  not mocks.
- **Not independently tested in this session**: real remote servers (SSH) and a real Swarm cluster for this specific feature — the hijack mechanism itself is transport-agnostic by construction (the same `this.connection` used by the build/push/exec paths that **have** been tested over SSH in other parts of this AGENTS file), but the full combination
  "console to a swarm task on a remote server" has not been tried end-to-end on a real VPS/cluster — a manual smoke test is recommended before production.

## Principles

- Always follow the official documentation of the framework/library (NestJS, TypeORM, etc.) when choosing packages and code patterns.

## Docker / distribution

- `Dockerfile` (multi-stage, `node:24-bookworm-slim` — not alpine, because `node-pty` needs glibc and the terminal needs bash).
  The image runs as the `node` user; `DB_MIGRATIONS_RUN=true` → TypeORM runs migrations at boot (`migrationsRun`).
- All containers created by the API (registry, proxy, apps) get the label `com.docker.compose.project=aoox` (`composeLabels()` in `docker.service.ts`),
  and both compose files use `name: aoox`, so Docker Desktop shows them as one group. The dev Postgres volume is pinned to the old name `aoox-api_postgres_data`.
- `docker-compose.yml` = Postgres for development only. `docker-compose.dist.yml` = the distribution stack (postgres + api + web, images `hideandseeklab/aoox-api`/`aoox-web` from Docker Hub; `-f docker-compose.build.yml` to build locally from `../aoox-web`);
  configured through `.env.dist` (example: `.env.dist.example`). `POSTGRES_PASSWORD` and `JWT_SECRET` are required, with no defaults.
- Cold-start test: `docker compose -p x -f docker-compose.dist.yml --env-file .env.dist down -v && ... up -d --build`, then open `/setup`.
- **`docker-compose.dist.yml` and `docker-compose.domain.yml` have bundled copies in `../aoox-cli/assets/install/`**,
  used by `aoox install` to bootstrap new VPSes (bundled, not `curl` from GitHub at install time — the compose version always matches the installed CLI version, with no extra network hop).
  **If either of these files changes, copy it again there** (without that, `aoox install` installs a stale stack) — also recorded in
  `assets/install/README.md` on the CLI side, and `install-env.ts` there has a test that fails if a new `${VAR}` in compose has not been written to its `.env.dist`.

## Tests & CI

- `npm test` — unit specs (Jest) for the important invariants: `setup` only when empty, bootstrap is idempotent, the gateway rejects wrong/member-role/reused tickets, throttle 429.
  New specs go next to the file they test (`*.spec.ts`), with mocked repositories/DataSource — no Postgres needed.
- GitHub CI: `.github/workflows/ci.yml` runs lint/build/test on every pull request and on pushes to main; `docker-publish.yml` publishes images to Docker Hub on version tags (the old GitLab CI config was removed after the repo moved to GitHub).
  `docker-compose.dist.yml` uses the Docker Hub images (`API_IMAGE`/`WEB_IMAGE` to pin versions, see `.env.dist.example`); `docker-compose.build.yml` for local builds.

## Docker & Registry

- `src/modules/docker/docker-engine.client.ts` — our **own** client for the Docker Engine HTTP API (`http.request` with `socketPath`, API version pinned to `v1.44`,
  exec stream demultiplexing). No third-party library (the user does not want dockerode). `docker.service.ts` wraps it (`DOCKER_SOCKET`; default `/var/run/docker.sock`, Windows `//./pipe/docker_engine`).
  Add new endpoints to the client following the official spec (https://docs.docker.com/reference/api/engine/).
  In the dist compose the socket is mounted and `group_add: DOCKER_GID` is set because the container runs as `node`.
- **Log rotation**: `docker/log-config.ts` `logConfig(env)` (pure, unit-tested) → `HostConfig.LogConfig` `json-file` `max-size`/`max-file` from `CONTAINER_LOG_MAX_SIZE` (default `10m`,
  `off` = Docker default with no limit) / `CONTAINER_LOG_MAX_FILE` (3), available as `DockerService.logConfig` and applied to all long-running containers: apps & previews
  (`replaceContainer`), managed DBs (`provision`), proxy, registry — also on remote servers (policy from the panel). It takes effect when a container is **recreated** (deploy/apply config/re-provision);
  existing containers stay unlimited until then. One-shot helpers do not get it (short-lived). The compose stack is not reached (`logging:` in the compose file or the daemon's `log-opts`).
  `docker-compose.dist.yml` uses the same `x-logging` anchor for postgres/api/web.
- `src/modules/registry/` — entity `Registry` (`self-hosted` | `external`, password AES-256-GCM with `ENCRYPTION_KEY`, `select: false`).
  `self-hosted-registry.service.ts` runs `registry:3` (htpasswd bcrypt via a one-shot container, volumes `aoox_registry_{data,auth}`,
  `REGISTRY_STORAGE_DELETE_ENABLED=true`). `registry-client.ts` = OCI Distribution API v2 (catalog, tags, manifest digest, delete).
- Flows: `create-registry/`, `list-registries/`, `delete-registry/`, `test-registry/`, `provision-self-hosted/`, `remove-self-hosted/`,
  `self-hosted-status/`, `list-repositories/`, `list-tags/`, `delete-tag/`, `garbage-collect/`, `set-registry-domain/`. Management = `@Roles('owner','admin')` (`RolesGuard`), provisioning/GC = owner.
- **Custom domain for the local registry** (`set-registry-domain/`, `PATCH /registries/:id/domain`, `@Roles('owner','admin')`, only for `type: 'self-hosted'`): the registry used to be completely unconnected to Traefik (only a host port, plain HTTP; TLS/`insecure-registries` was entirely the operator's responsibility). It can now be recreated with the label
  `ProxyService.buildLabels('aoox-registry', 5000, [{host, https:true}], ...)` (used directly as a static method, same pattern as `panel-domain.util.ts`) and joined to the `aoox` network (`APP_NETWORK`) — this requires the proxy to already be `running` **and** `acmeEmail` to be set (400 otherwise, because without ACME Traefik's default certificate is not trusted by `docker push`).
  `SelfHostedRegistryService.createContainer()` (private, used by `provision()` and `setDomain()`) now always does `ensureNetwork(APP_NETWORK)` + `NetworkMode: APP_NETWORK` — the host port is still published, so IP:port access is not lost. Setting a domain → `registry.domain` + `registry.url` (so a bare domain without a port, standard HTTPS) are updated in the DB; removing the domain (`domain: null`) → recreate without the label, `url` goes back to `SelfHostedRegistryService.publicUrl`. The data and auth (htpasswd) volumes are untouched on recreate,
  so the credentials stay the same. `apiBaseUrl()` (the API's own calls to the registry) is unchanged — it still goes through `REGISTRY_INTERNAL_URL`, never through the public domain. CLI:
  `aoox registry domain --set <host>` / `--clear` (finds the `self-hosted` registry automatically, no id needed). Dashboard: a "Custom domain" field on the Local registry card.
  Intended side effect: `SwarmStatus.registry.reachableFromNodes` (the check is a regex on `registry.url` not being `localhost`) becomes `true` automatically once a domain is active, without changing `swarm.service.ts` at all.
- **Optional S3 storage for the local registry** (`Registry.storageDestinationId`, FK `backup_destinations` `SET NULL`, set only at provisioning — it cannot be changed without deleting and re-provisioning): the default stays local disk (volume `aoox_registry_data`) as before; if `POST /registries/self-hosted` gets a `destinationId`, the same `BackupDestination` credentials used by database/volume backups are reused (`BackupDestinationService.resolve()`), and the `registry:3` image's storage driver is set to S3 through
  `registry-s3-env.ts` (`registryS3Env()`, pure & unit-tested — `REGISTRY_STORAGE=s3` + `REGISTRY_STORAGE_S3_{ACCESSKEY,SECRETKEY,REGION,BUCKET,SECURE,FORCEPATHSTYLE}`,
  `REGIONENDPOINT` only when there is a custom endpoint/MinIO, `ROOTDIRECTORY` from `prefix`). The data volume (`aoox_registry_data`) is **not created or mounted at all** when S3 is used —
  only the auth volume (htpasswd) stays local, because authentication is not "registry data". `createContainer()` (used by `provision()` **and** `setDomain()`) takes `destination: DestinationConfig | null` in both places so a domain change does not "forget" the chosen S3 backend — `SetRegistryDomainService` re-resolves
  `registry.storageDestinationId` before recreating. Dashboard: a "Local" vs S3 destination choice in the confirmation dialog before the Provision button (it cannot be changed from the UI afterwards).
  Not yet: migrating data from local to S3 (or the reverse) for a registry that has already been provisioned.
- Routes with a slash in the repo name use an Express 5 wildcard (`*repository`) that arrives as an array → converted to a string with `@Transform` in the DTO.
- Deleting a tag = deleting the manifest (other tags with the same digest disappear too); disk space comes back after GC.
- **Delete an image completely** (`delete-repository/`, `DELETE /registries/:id/repositories/*repository?force=`, `@Roles('owner','admin')` — same as `delete-tag`, because in effect this is "delete-tag many times" plus folder cleanup, not the heavy registry-wide GC that is owner-only): a user on a VPS found that after all tags of a repo were deleted **and** GC was run, a repo such as `dummy/hello` still appeared in `_catalog` with "0 tags" — the cause: `registry:3` builds `_catalog` from the folder names `docker/registry/v2/repositories/<repo>/` in storage, and **neither the Distribution API nor garbage-collect ever deletes that folder itself**, only the unused blobs/manifests inside it. The Distribution API also has no "delete repo" endpoint. The flow: (1) `listTagNames` + `getTag` per tag to collect the unique digests (different tags can share a digest, as in `delete-tag`) → `deleteManifest` per digest; (2) delete the folder — locally through a one-shot busybox helper (`SelfHostedRegistryService.removeRepositoryData()`, a `Cmd` array
  `['rm','-rf', path]`, **no shell** so the repo name never goes through shell interpolation), or on S3 through `BackupDestinationService.purgeDir()` (rclone `purge` on
  `<ROOTDIRECTORY>/docker/registry/v2/repositories/<repo>`, a new method — previously there was only `remove()` for a single file); (3) `garbageCollect(false)` automatically; (4) `restartRegistry()`
  (a new method on `DockerEngineClient`, `POST /containers/{id}/restart`). The repo name is validated twice: the same `@Matches` as `delete-tag` in the DTO, **and** again in
  `assertValidRepositoryName()` (`repository-name.ts`, unit-tested) right before it is used to build the path/`Cmd` — it rejects `..`, absolute paths, and anything outside the OCI component shape,
  as a deliberately separate second layer from the DTO validation.
  **Blob descriptor cache pitfall**: `registry:3` by default (with no env at all; never disabled in `createContainer()`) enables `storage.cache.blobdescriptor: inmemory`
  — after GC deletes blobs, that in-memory cache still believes they exist, so the next `docker push` of the same layer sees "blob already exists" and **does not** upload it again, even though the blob is gone from disk; the new manifest then points to a missing blob and `docker pull` fails. The chosen fix is to **restart the container** after GC (the in-memory cache disappears with the new process) rather than disabling the cache — safer and it does not change registry behavior outside this delete-image moment. Tested for real
  with a real `registry:3`: push 2 repos (one with 2 tags sharing a digest, plus another repo sharing the same blob through `--mount`), delete one repo → it disappears from `_catalog`, the other repo is intact, GC reports the blobs that are truly unused (3 blobs) while blobs still used by the other repo are untouched (0 blobs) — then build a new image whose blobs are **actually** GC'd, delete its repo, **push** exactly the same content again and **pull** it back: fully successful (proving the cache pitfall above is real and that the restart fixes it).
  Also tested: a 0-tag repo, exactly the user's scenario (delete the tags, then delete the repo, it disappears from the catalog), an external registry rejected with 400, a `readOnly` API token 403.
  **Usage warning**: before deleting (unless `?force=true`), `usage()` looks for `Application.currentImage`/`imageRef` matching the pattern `%/<repo>:%` and replies 409 with
  the list (also available on its own through `GET .../repositories/*repository/usage` for a preview in the web before confirming) — tested for real with an application of `sourceType: 'image'`
  whose `imageRef` points to the repo to delete: 409 without `force`, 200 with `force=true`. **Not tested yet**: S3 (there is no MinIO in this test environment; the `purgeDir()` code
  reuses `rcloneEnv()`/the `rclone` pattern already tested for real elsewhere for upload/download/delete — only the `purge` command is new).
- **Pitfall found while working on the features above**: `RegistryService.apiBaseUrl()` used `config.get('REGISTRY_INTERNAL_URL') ?? fallback` — `.env`'s
  `REGISTRY_INTERNAL_URL=` (empty, not removed) is an empty string, not `undefined`, so `??` does **not** fall back, and `RegistryClient` was created with an empty `baseUrl`,
  making **every** call through `RegistryClient` (`list-repositories`, `list-tags`, `delete-tag`, `test-registry`, and the delete-image feature above) fail with a 500 `Invalid URL` —
  exactly the same pattern as the `DOCKER_SOCKET` pitfall already documented (the Docker & Registry section, Engine API client). Found through a real dev-server check in this session
  (not unit tests — mocks never read the real `.env`), fixed by changing `??` to `||` in `apiBaseUrl()`.
- **Credentials for external clients** (`get-registry-credentials/`, `GET /registries/:id/credentials`, `@Roles('owner','admin')` — same as `delete-registry`): returns `{url, username, password}` with the password **decrypted**, the same pattern as `database-credentials` (separated from `GET /registries` so the list never carries secrets). Used by `aoox deploy` in the CLI (`../aoox-cli`) to `docker login` before `docker push` — the `url` here is taken AS-IS from the `registries.url` column (for a self-hosted registry = `SelfHostedRegistryService.publicUrl`, which already honors `REGISTRY_PUBLIC_HOST`), not the `apiBaseUrl()` the API uses to call the registry itself (that one may be `REGISTRY_INTERNAL_URL`, which is unreachable from outside the API container).
## Application & Deploy

- `src/modules/application/` — entity `Application` (under `Project`, unique `app_name` slug → container name `aoox-app-<appName>`,
  source: `git_url`+`git_branch`+`dockerfile_path`, `container_port`, `host_port` nullable, `env` text `KEY=VALUE`) and `Deployment`
  (`status` queued→building→pushing→starting→success|failed, `image_ref`, `logs` text, `error_message`, `finished_at`).
- Ownership goes through the project: `ApplicationService.findOwnedOrFail(id, ownerId)` joins `project.ownerId`.
- Flow: `create/list/get/update/delete-application`, `deploy-application` (202, rejects with 409 if a deployment is still active),
  `list-deployments` (without logs), `get-deployment` (with logs, polled by the web), `stop/start-application`, `application-logs` (container logs).
  `list-applications` (`GET /applications?projectId=`) returns the apps + `domains: [{host, https}]` (one `IN (...)` query for the whole list, not per app) so the
  project detail page cards can link to running apps; compose (`serviceDomains`/`servicePorts`) and database (`hostPort`) already exist in each list row.
- **Host port collision check** when `create`/`update-application` sets `hostPort` (also `create-database` and companions — databases always run on the host daemon, so they are checked against `DockerService`; `update-database` has no
  `hostPort`; **project import** has its own table check that only looks at apps/databases/stacks and drops colliding ports with a warning — it does not see companions or running containers):
  `HostPortService` (`src/modules/host-port/`, only imports the entities
  `Application`/`ManagedDatabase`/`ComposeApp`/`DatabaseCompanion` directly — not their modules — so it can be used by `ApplicationModule`, `ComposeModule`, `ManagedDatabaseModule` and companions without a cycle,
  because `ComposeModule` already imports `ApplicationModule`). The logic is the same as `ComposeService.assertHostPortsFree()` (see the Compose section): other `applications.host_port`,
  `managed_databases.host_port`, compose `service_ports`, and ports bound by containers on the daemon. Apps on a remote server (`Application.serverId`) check
  containers via `RemoteDockerService.forServer(serverId)`, not the local daemon — the table check stays global. On `update`, the app's own containers (`aoox-app-<appName>`,
  the `-next` blue/green one, or swarm tasks labeled `aoox.application`) and the app's own row are excluded; the check only runs if `hostPort` or `serverId` changes.
  Previously, an app created without a domain **and** without a host port could be assigned an already-used port and would silently fail when its container was created — now it returns 400 up front.
- **Changing the host port of a running app takes effect immediately** (`update-application.service.ts`): the port only lives in the container's `HostConfig.PortBindings`, so previously a PATCH only saved
  the DB row and the new port only opened after the next deploy/rollback. Now, when `hostPort` changes (null→number, number→number, number→null) + `currentImage` + `status==='running'` →
  `runner.applyRuntimeConfig` (container mode: synchronous, recreate from `currentImage`, no build; with a host port there is **no blue/green** because two containers cannot bind the same port
  → brief downtime; remote servers go through `RemoteDockerService.forServer` inside `replaceContainer`) or `queueRuntimeConfig` (service mode — rolling update). **A `stopped` app is not started**:
  it is only saved, and `start-application` compares the stopped container's `HostConfig.PortBindings[<containerPort>/tcp]` with `app.hostPort` (`publishedPort()`) — if different →
  run `assertFree` and then `applyRuntimeConfig` (recreate + start) instead of `startContainer` (a stopped container still carries its old port). Service mode scaled to 0 does not have this path yet
  (applies on the next deploy/config). **Active deployment → 409** (instead of "let the deployment read it"): the runner holds a copy of the `Application` entity from when it was queued, so it would
  create the container with the old port **and** the `repo.save(app)` at the end would write the old port back, silently discarding the user's change (TypeORM diffs against the DB). **Apply failure**:
  `replaceContainer` removes the old container *before* creating the new one (same port), so if create/start fails (the port was grabbed by another process after `assertFree`) no container is left;
  `applyHostPort()` then restores the old `hostPort` in the DB **and** recreates the container with the old port, and replies 409 "…the previous port was restored" (if the restore also fails →
  status `error` + "redeploy" message). Tested for real with `nginx:alpine` (image source): adding/changing/removing a port applies without a new deployment, a collision with another container gives 400 and the container
  stays intact, stopped stays stopped and start uses the new port, active deployment gives 409. **Not yet tested for real**: the restore path on failure (Docker Desktop does not reject the bind even when Windows holds the
  port or the port is excluded — unit tests only), remote servers, swarm.
- `deployment-runner.service.ts` runs **detached** from the request: `POST /build?remote=<git>#<branch>` (the daemon clones by itself — no git/tar needed in the API)
  → `POST /images/{name}/push` with `X-Registry-Auth` (base64url **with padding**, like Go) to the local registry
  → remove the old container → create+start the new container (label `aoox.application`). Image ref: `<registry.url>/<project-slug>/<appName>:<12 char id of deployment>`.
  Always ends as `success`/`failed`; a failed build/push does not touch the running container and does not change the app's `status`.
  **PATCH during a running deploy**: the runner holds a copy of `Application` from when it was queued (a build can take minutes), and `repo.save(app)` diffs that stale copy against the row
  → silently reverts whatever the PATCH changed in between. Therefore the runner **never** `save`s the whole entity: `persistOutcome()` only writes its own columns via
  `repo.update(id, …)` — `status` + `currentImage` (success/rollback/config, and `status` on failure after the container was replaced) and, for image sources, the `imageDigest`/`imageCheckedAt` baseline
  (guarded by `WHERE image_ref = <the one that was pulled>` so it does not overwrite a digest that a PATCH of `imageRef` reset). Other background writers (`ImageUpdateWatcherService`, webhook/secret) already
  use `update`. Other fields (name, env, domains, limits, healthcheck, previews, …) changed during a deploy **survive**, but the deployment's container was built from the values at queue time —
  they apply on the next deploy. 409 is still only for `hostPort` and secret source (a stale copy would create the container with the old port/secret, and `applyHostPort` would race).
  The other direction: `UpdateApplicationService` re-reads `status/currentImage/imageDigest/imageCheckedAt` right before `save` (`refreshRunnerColumns`) so that a deploy that finishes in the
  middle of a request is not cancelled. `stop/start-application` still `save` the whole entity (a very narrow window, not changed yet).
- Realtime logs: `logs.gateway.ts` (Socket.IO namespace `/logs`, 60-second ticket from `create-log-ticket/` = `POST /applications/:id/log-ticket`, scope `logs`, bound to one app).
  Client events `subscribe:deployment(id)` / `subscribe:container(tail)` / `unsubscribe`; server `deployment:log` (`snapshot: true` = full text, otherwise append),
  `deployment:status`, `container:log`, `container:end`. The runner emits chunks through `DeploymentEventsService` (in-process EventEmitter + live text per deployment
  for synchronous snapshots without duplication); the DB is still flushed about every ~1 second as storage. Container logs via `followContainerLogs` (`GET /containers/{id}/logs?follow=1`, `StreamDemuxer`).
  Only one API instance — if scaled out, replace the emitter with Redis pub/sub.
  Besides per-deployment subscriptions, each socket also `join()`s the room `app:<applicationId>` at handshake (in `handleConnection`, from the ticket's `applicationId`) — used by the
  `deployment:created` event (below) that must reach **all** sockets connected to that app, not just the ones subscribed to one particular deployment.
- **Source of a deployment trigger** (`Deployment.trigger`: `manual`|`webhook`|`auto-update`, separate from `kind`, which selects the build/rollback/config path — `rollback`/`config`
  are always `trigger: 'manual'`, and `triggeredBy` tells them apart from a normal manual deploy) + `commitSha`/`commitMessage` (cut to the first line, 200 chars) +
  `triggeredBy` (the actor's email for manual/rollback/config — from `@CurrentUser()`, the same for sessions and API tokens; the pusher's name for webhooks). Filled in at the point
  the row is created: `DeployApplicationService.queue(app, kind, info?)` (manual & auto-update via `execute()`/`ImageUpdateWatcherService`, default trigger from `kind`),
  `WebhookDeployService` (from `parsePushCommit()` — GitHub `after`/`head_commit.message`/`pusher.name`, GitLab `checkout_sha`/last `commits[].message`/`user_name`),
  `RollbackApplicationService`, `DeploymentRunnerService.queueRuntimeConfig()`. The first line of the deployment log also mentions it (`triggerSummary()`, pure & unit-tested,
  e.g. `==> Triggered by webhook (a1b2c3d "fix x" by octocat)`) via `DeploymentLog.note()` (like `step()` but without changing the status) — token/password redaction still applies
  because it goes through the same `append()`. Exposed in `list-deployments`/`get-deployment` (new fields added to the explicit `select` of `list-deployments`; `get-deployment`
  already returns the full row).
- **`deployment:created`** (new event of `LogsServerEvents`, emitted by `DeploymentEventsService.emitCreated()`/`onCreated()`): `DeploymentRunnerService.start()` is the
  single point called by **all** deployment-creation paths (build/webhook/auto-update via `queue()`, rollback/config via `start()` directly) —
  it emits once per row, so no duplication is needed in each caller. `LogsGateway` forwards it to the room `app:<applicationId>` (`server.to(room).emit(...)`,
  `@WebSocketServer()`), not to a single subscribed socket — so an open tab learns about a new deploy (webhook, auto-update, another user) without a manual refresh.
  Payload `{id, trigger, commitSha, commitMessage, triggeredBy}`.
- **Health check & zero-downtime** (`Application.healthcheckPath`, e.g. `/health`; `healthcheck.ts`): the container is created with a Docker `HEALTHCHECK` (`CMD-SHELL` that tries
  `wget` → `curl` → `node -e fetch` → `python3` against `127.0.0.1:<containerPort><path>`, interval 3 s, 30 retries; exit 127 = none of them exist → the error message says so).
  `replaceContainer` waits for `State.Health.Status === 'healthy'` (`waitHealthy`, polls every `healthPollMs`) before the deployment counts as successful. For an app routed through a
  domain **without a host port** (and not a preview), **blue/green** is used: the new container is named `<name>-next` with the same Traefik labels — Traefik's docker provider
  ignores containers that are not yet `healthy`, then load-balances across both — once healthy, wait `proxySettleMs` (3 s, so Traefik has time to add the server), remove the old one,
  `renameContainer` `-next` → the real name (tested: 80/80 requests 200 during the swap). On failure/timeout → `-next` is removed, the old container keeps serving, and the deployment is `failed`.
  With a host port (two containers cannot bind the same port) or for previews: a plain replace, the health check still decides success/failure. A leftover `-next` from a crashed deploy is removed first.
  Intentional side effect: a container that later becomes `unhealthy` is dropped by Traefik (404) — that is the point of the health check.
- Rollback: `rollback-application/` (`POST /applications/:id/rollback {deploymentId}`) creates a Deployment `kind: 'rollback'` that uses the old `imageRef`
  (`ensureImage` → `replaceContainer`), with no build/push. Only a `success` target is allowed.
- `Application.ignoreErrorLogs` (default `false`, set via `update-application`): skips the app in `app-error-watcher.service.ts` (see the
  Notifications section → "App errors from logs") — for apps whose normal output is noisy and looks like errors. Exported/imported via `project-transfer`.
- Environment: `Project.env` (shared) + `Application.env`, both text `KEY=VALUE`; merged by `env-resolver.service.ts` **when the container is created**
  (`replaceContainer`, not at build time — so a new/rotated DB password is used by the next deploy without a rebuild); the app wins on the same key.
  Values may reference `${{project.KEY}}` and `${{database.<slug>.url|host|port|username|password|database}}` — the database is looked up **only in the same project**
  (slugs are global, so without this filter an app could read another project's password). Unknown reference → `EnvReferenceError`: 400 during `update-application`
  (validated there), or a `failed` deployment if it only goes wrong during deploy. Resolved DB passwords are registered with `DeploymentLog.redact`.
  `Application.buildArgs` (`KEY=VALUE`) → `buildargs` JSON in `POST /build` — literal, no references, because it is stored in the pushed image.
- **Nixpacks** (`Application.buildType` `dockerfile`|`nixpacks`, `nixpacks-builder.service.ts`): a repo without a Dockerfile. No binary on the host/API image:
  (1) a helper image `aoox-nixpacks:<version>` (debian + git + nixpacks CLI from the GitHub release, `HELPER_DOCKERFILE`) is built once via `POST /build`
  with a single-file tar context (`tarSingleFile`, minimal ustar); (2) a one-shot helper container runs `git clone --depth 1` (the credentialed URL never leaves the
  helper; `GIT_TERMINAL_PROMPT=0`) and then `nixpacks build /src --out /src --no-cache --env K=V` — it only writes `.nixpacks/Dockerfile`, no docker; the whole
  source is `tar`red → `readFileFromContainer` (archive API) → (3) `buildFromTar` (`POST /build` with body `application/x-tar`, `dockerfile=.nixpacks/Dockerfile`, classic builder).
  `--no-cache` is **required**: nixpacks' cache mounts are BuildKit syntax (`RUN --mount`), and `POST /build?version=2` needs a BuildKit gRPC session that our hand-written client does not have
  (tested: without the flag the build hangs). Consequences: no dependency cache between builds, the first build is slow (base `ghcr.io/railwayapp/nixpacks:ubuntu-*`
  ~350 MB + `nix-env`), the tar context is held in memory (source tree only, `.git` removed). `buildArgs` → nixpacks `--env` (e.g. `NIXPACKS_NODE_VERSION`) and Docker `buildargs`.
  The nixpacks version is pinned in `NIXPACKS_VERSION`; bumping it = a new helper image automatically. `aoox.component=build` for the helper (ignored by monitoring/container-down because it is neither an app nor a DB).
- **Mounts** (`mount.entity.ts`, table `mounts`, unique per `application_id`+`container_path`): `volume` (Docker volume `aoox_app_<appName>_<name>`, data survives between deploys),
  `bind` (host path — **owner/admin only**, `BIND_MOUNT_ROLES`, because it is equivalent to filesystem access on the host), `file` (contents in the `content` column, always read-only). `mounts.ts`:
  `bindsFor()` (pure, unit-tested) → `HostConfig.Binds`; `prepareMounts()` creates the volume and writes all `file`s into the volume `aoox_app_<appName>_files` via a
  busybox helper that is **not run** (`putArchive` into a stopped container), then the files are bound from `inspectVolume().Mountpoint` — API v1.44 has no volume subpath,
  so the same trick as the compose runner is used. The flow `add/list/update/delete-mount` (`/applications/:id/mounts[/:mountId]`, `?purge=true` deletes the volume) all
  call `applyRuntimeConfig` (recreate the container without a build). Preview PRs do **not** get mounts (do not share prod volumes with arbitrary branches).
  Blue/green: two containers briefly use the same volume — an accepted consequence.
  **Database mounts**: `Mount.databaseId` (nullable; unique per `database_id`+`container_path`), the `mounts.ts` helpers accept a `MountOwner` (`{appName}` → `aoox_app_…`,
  `{slug}` → `aoox_db_…`). `ManagedDatabaseService.provision()` adds `bindsFor()` from the DB mounts (the `Mount` repo is also `forFeature`d in the DB module — the ApplicationModule cannot be imported there, cycle). The flow lives in `src/modules/database-mount/` (`/databases/:id/mounts[...]`, uses `mountFields()` from the app's add-mount) — every change re-runs `provision()`
  (brief restart; data is in the volume; a `stopped` DB is stopped again).
  **Compose mounts** (`Mount.composeAppId` + `Mount.service` — one stack = N services, so a mount must know which service; unique per `compose_app_id`+`service`+`container_path`;
  FK to `compose_apps` through a plain SQL migration, **not** a TypeORM relation, because ComposeModule already imports ApplicationModule — the reverse relation would be a cycle).
  `MountOwner` (`mounts.ts`) has three directions: `{appName}` → `aoox_app_…`, `{slug,engine}` → `aoox_db_…` (told apart from compose by the `engine` column, which only `ManagedDatabase` has — `ComposeApp` also has `.slug` but no `engine`, so they cannot be confused without importing entities, which would create a cycle), `{slug}` → `aoox_compose_…_<service>_…`
  (the volume name **includes the service**, so two services may have mounts with the same name without colliding). Flow `src/modules/compose-mount/` (`/compose-apps/:id/mounts[...]`,
  `AddComposeMountDto extends AddMountDto` requires `service`) — it calls **nothing** synchronously (unlike app/db): compose is not a single container that can be patched,
  so a new mount only applies on the next deploy, like `serviceDomains`/`serviceResources`.
  It is rendered into the override (`renderOverride` in `compose-runner.service.ts`) as long-form `volumes:` (`{type,source,target,read_only}` — **not** the short `a:b:ro` string,
  because daemon-side paths can contain characters that clash with the `:` separator), plus top-level `external: true` declarations for named volumes (already created by
  `prepareMounts()`, so compose must not try to create them again) — that top-level declaration key **also includes the service** (`<service>_<name>`), not just the mount name,
  so two services with identically named mounts do not overwrite each other's `external` entries. `file` mounts use the same trick as app/db (bind from `inspectVolume().Mountpoint`
  of the files volume) but the subpath is `<service>/<name>` inside the same files volume (one `_files` volume for the whole stack).
  **Pitfall found**: `docker compose up -d` is idempotent based on the diff of the **YAML configuration**, not on file contents — changing the `content` of a `file` mount does not change the override
  (the bind path is the same), so compose sees no change and does **not** recreate the container; a running container stays bound to the old inode (per-file bind mounts, not per-directory) and never sees the new contents until restarted. Therefore a deploy adds `--force-recreate` to `up` **only** when the stack has a `file`
  mount (volume/bind mounts do not have this problem — the declared path itself changes, so compose detects it automatically). Tested for real: edit the contents of a
  mount file and redeploy without this flag → the old contents are still served; with the flag → "Recreated" in the log and the new contents are visible. `renderOverride` is also tested: a volume mount with no
  domain/port at all (the old early-return only checked domains/ports; mounts and resources are now checked too — otherwise a stack with only a mount would never get an override).
- **Static sites** (`Application.buildType = 'static'`, `static-site-builder.service.ts`): `renderStaticDockerfile()` (pure, unit-tested) = an optional `node:22-alpine` stage
  (`staticBuildCommand`, null = files already exist) → `nginx:1.27-alpine` copies `staticOutputDir` (`dist`/`build`/`out`/`.`) into `/usr/share/nginx/html`; `renderNginxConf(spa)` =
  gzip, 7-day cache for assets, `try_files … /index.html` when `staticSpa`. The pipeline is the nixpacks path without the planner: the helper `aoox-nixpacks` clones, the Dockerfile & nginx.conf
  are passed through env (`printf` into `.aoox/`), tar → `buildFromTar` (`dockerfile=.aoox/Dockerfile`, classic builder — no cache mounts). Container port = 80.
  Tested: a plain HTML repo, and a build stage + SPA fallback. Non-SPA mode serves the repo's own `404.html` for unknown paths (`error_page 404`; without that file = nginx's default 404 page). Re-tested via the new create page + a real deploy: `/` & `/about.html` 200, unknown path 404 with the custom page. Not yet: pnpm/yarn workspaces need an explicit build command (no automatic detection).
- **Image source** (`Application.sourceType = 'image'`, `image_ref`, `image_registry_id` FK registries SET NULL; `git_url` nullable): the runner skips build/push —
  `pullSourceImage()` always does `pullImage(ref, auth?)` (moving tags get updated; `X-Registry-Auth` from external registry credentials for private images, the password is redacted from logs)
  and then `replaceContainer`. No local registry needed. Pull failure → `failed` deployment, the old container keeps running. Rollback still uses the old deployment's `imageRef`; the webhook for image apps
  ignores the branch check (CI can call it after `docker push`); preview PRs do not apply. DTO: `gitUrl` is required only when `sourceType !== 'image'` (`ValidateIf`),
  `imageRef` is required when `image`. Web: a **Source** select in the form (git/image), image field + registry credentials.
  **Pitfall found** (`create-application.dto.ts` **and** `update-application.dto.ts` — both affected, found separately a day apart because the same form is used for create and update): fields belonging to a source/build method that is not in use (e.g. `imageRef` for a git app, or `dockerfilePath` for a `buildType` other than
  `dockerfile`) are sent by the web as `""`, not `undefined`/`null` — the Image/Git/Dockerfile/Static sections of the React form are mounted conditionally per `sourceType`/`buildType`,
  so irrelevant fields disappear from `FormData` and the action turns them into empty strings. `@IsOptional()` **only** skips `null`/`undefined`, not
  `""`, so `@Matches(...)` still runs and rejects the empty string with its regex message (e.g. `dockerfilePath must match /^[\w./-]{1,200}$/ regular expression`) —
  a user could not create/save Settings at all for a build method whose own fields they had not touched. String fields with similar patterns (`imageRef`,
  `gitUrl`, `gitBranch`, `dockerfilePath`, `staticOutputDir`, `staticBuildCommand`, `healthcheckPath`, `previewDomain`) need an extra `@ValidateIf((_, v) => v !== '')` (on top of `v !== null` for the nullable ones) so that `""` is skipped like `null`/`undefined`, in **both** DTOs; nullable UUID fields (`gitCredentialId`,
  `imageRegistryId`, `swarmNodeId`, `serverId`) are safe because `application.schema.ts` in the web already transforms `""` → `null` before sending, so the existing `ValidateIf(v !== null)`
  there is enough — only string fields validated by `@Matches`/regex without a similar transform are at risk. The create service also once stored `gitUrl`/
  `staticBuildCommand` as `""` instead of `null` (the `?.trim() ?? null` pattern does not catch `""`, unlike the `?.trim() || null` used by other fields) — made consistent.
  Also audited: `compose-app.dto.ts`/`create-compose-app.dto.ts` (similar pattern) and `add-mount.dto.ts`: **not** affected — the compose form uses a separate zod schema per
  `source` (git vs template) that removes irrelevant fields entirely (instead of sending `""`), and the mount dialog builds the request body as a JS object with
  conditional spreads, so it never sends fields for a section that was not rendered.
- **Automatic image updates** (`Application.autoUpdate`, `autoUpdateIntervalMinutes` 5–1440 default 60, `imageDigest`, `imageCheckedAt`; only for `sourceType='image'`):
  `image-reference.ts` `parseImageRef()` (pure, unit-tested; Docker Hub → `registry-1.docker.io` + `library/`), `registry/remote-digest.ts` `fetchRemoteDigest()` =
  `HEAD /v2/<repo>/manifests/<tag>` with Accept for manifest list/OCI index (the same digest as `docker pull`/`buildx imagetools`), token flow for Docker Hub/GHCR
  (401 + `WWW-Authenticate: Bearer` → realm+service+scope, `parseBearerChallenge` unit-tested) or Basic (self-hosted registry; base URL & credentials from `Registry` when `imageRegistryId` is set).
  `ImageDigestService.remoteDigest(app)` is used by the **runner after a pull** (baseline = the registry digest, not the local `RepoDigests` — a difference in representation can cause a redeploy loop) and by
  `ImageUpdateWatcherService` (`@Cron` every minute: image app + `autoUpdate` + `running` whose interval has elapsed → `check(app, true)`: sets the baseline if none, `changed` →
  `DeployApplicationService.queue(app, 'auto-update')` (new `DeploymentKind`; Conflict = another deployment is active, skipped); a registry failure still stamps `imageCheckedAt`).
  `POST /applications/:id/check-image {deploy?}` (`check-image-update/`, throttle 30/min) = manual check. Changing `imageRef` in an update → `imageDigest` is set to null. A `@sha256:` reference never changes.
  Tested: Docker Hub, GHCR, a local registry (with/without credentials), deploy via manual check and via cron. Web: switch + interval in the form (image section), a "Check image update" button in the deploy panel, a ⟳ icon in the history.
- **Railpack** (`Application.buildType = 'railpack'`, `railpack-builder.service.ts`): Railway's third builder. Unlike nixpacks, its plan is **not a Dockerfile** but JSON for
  BuildKit, so it cannot go through the client's own `POST /build` → it runs entirely inside a helper: the image `aoox-railpack:<RAILPACK_VERSION>` (`docker:29-cli` + git + the railpack binary,
  built once via `POST /build` + `tarSingleFile` like the nixpacks helper), which clones the repo and runs `railpack build /src --name <imageRef> --cache-key <projectId>/<appName> --progress plain --env K=V`
  (`railpackScript()` pure & unit-tested) with the host daemon socket mounted and `BUILDKIT_HOST=docker-container://aoox-buildkit`. The helper's logs are streamed (`followContainerLogs`) into the deployment.
  **Cache persists across deploys** — that is the main reason: BuildKit runs as a long-lived container `aoox-buildkit` (`moby/buildkit:<BUILDKIT_VERSION>`, privileged,
  `restart: unless-stopped`, volume `aoox_buildkit`, label `aoox.component=build` so monitoring & container-down notifications ignore it), started automatically on the first build
  (`ensureBuildkit`). Tested for real: cold build 284 s, second build 54 s, redeploy via the API 8.3 s (all layers `CACHED`) — full deployment 43 s including push & start.
  The resulting image is loaded into the daemon and then follows the same push/replaceContainer path. **Host only** (`serverId` + railpack → a clear error; BuildKit per server is out of scope).
  Runtime: the railpack image listens on `$PORT` (Railway convention, default 80) → the runner adds `PORT=<containerPort>` to the container env unless the app sets it itself.
  The BuildKit cache is not visible to the daemon's `POST /build/prune`, so `MaintenanceService.cleanup()` calls `railpack.pruneCache(BUILDKIT_CACHE_KEEP_GB × 1 GB, default 10)`
  (`buildctl prune --keep-storage` via exec) and reports it as `buildkitCache` in `CleanupReport` (shown in the Disk card). Note: the "no dependency cache" limitation in the nixpacks paragraph
  applies only to nixpacks/static, not to railpack.
- **Root directory / monorepo** (`Application.rootDirectory` nullable + `watchRootOnly` bool, migration `ApplicationRootDirectory`; `root-directory.ts`): builds a **subfolder** of the repo for
  ALL git build types, including PR previews (which go through the same `buildImage`). Null/empty = repo root (old behavior). **Mechanism per path**: Dockerfile →
  `POST /build?remote=<git>#<branch>:<dir>` (`gitContextRef()`; Engine API git context + subdirectory syntax — the build context = `<dir>`, so `dockerfilePath` is relative to it; `:` is safe
  because git forbids it in branch names); nixpacks/railpack/static → the helper still `git clone`s to `/src` and builds from `$APP` = `/src/<dir>` (`appDirPrologue()`: nixpacks `build "$APP" --out "$APP"`
  and `tar -C "$APP"`, railpack `build "$APP"`, static writes `.aoox/` in `$APP`, tars `$APP`, so `staticOutputDir` is relative to that folder with no special code). **Path safety**:
  `isValidRootDirectory()` (segments `[A-Za-z0-9._-]` separated by `/`, no leading/trailing `/`, no dot-only segments or `.git`, max 200) is applied **twice** — the create & update DTO validators
  (`IsRootDirectoryConstraint`, plus `@ValidateIf(v !== '')` for `""` from the web) and again with `assertValidRootDirectory()` right before use (`gitContextRef`, `rootDirectoryEnv`). The value is **never**
  interpolated into a shell script: it is passed as the env `AOOX_ROOT` to the helper, and the shell prologue only references `"$AOOX_ROOT"`; the prologue also rejects (exit 3) a folder that does not exist **and** a symlink that resolves outside `/src` (`pwd -P`). The service stores `null`, not `""` (`normalizeRootDirectory`). A missing folder → a `failed` deployment with `Root directory "x" was not found in the
  repository`: helper exit 3 → `rootDirectoryError`, and for the Dockerfile path the daemon's `stat <tmp>/<dir>: no such file or directory` error is translated to the same message; the old container is untouched (the build fails before the replace). The `Building …` log line mentions `(root directory: apps/web)`. **Limitation**: files outside the folder are not in the build context (a Dockerfile in `apps/web` cannot `COPY ../packages/x`). **Webhook** (`watchRootOnly`, default false): `pushTouchesRoot()` (pure, unit-tested) reads `commits[].added/modified/removed` (GitHub & GitLab) and replies `ignored`
  (`no changes under <dir>`) only when every commit is proven to be outside the folder; **fail-open** (deploy) when there is no root, no/empty `commits`, a commit without a file list (GitHub merge commits), ≥ 20 commits
  (payload limit), `total_commits_count` greater than what was loaded (GitLab), `forced`, or `created`. PR/preview events are not filtered. Project export/import carries both fields (optional in old files; an invalid value on import → `null` + warning). Tested for real (local git daemon, repo `apps/web`+`apps/site`+`services/api`): Dockerfile with root `apps/web` and a relative `dockerfilePath`, static with root `apps/site` (SPA on/off, relative output), wrong root (Dockerfile & static) fails clearly while the old container keeps running, empty root = old behavior, dangerous paths 400 (create & update), symlink escape rejected, webhook ignored/queued, PR preview builds from the subfolder. **Not yet fully tested**: nixpacks and railpack (TLS-intercepting antivirus blocks downloads inside the container) — only script/env assembly (unit tests); example in `dummy-apps/monorepo-sample`.
- Prerequisite for deploys from git: the local registry is already provisioned. Not yet: other buildpacks, a dedicated "image updated" notification (uses the regular deployment notifications).

## External secret source (Infisical)

- `src/modules/secret-source/` — aoox is only an **API client** of the user's own Infisical (Cloud or self-hosted); it is **not** an Infisical template (the user rejected that). Entity `SecretConnection`
  (`secret_connections`: `name` unique, `provider` `infisical`, `url` nullable = `https://app.infisical.com`, `client_id`, `client_secret_encrypted` `select:false`, AES via `secret.util` + `ENCRYPTION_KEY`).
  Flow: `POST /secret-connections` (owner/admin; url must be http(s) without credentials/query, duplicate name 409), `GET` (all members, DTO without secret — for the dropdown), `DELETE /:id` (owner/admin; FK
  `applications.secret_connection_id` `ON DELETE SET NULL`, SQL migration `SecretSource`, no TypeORM relation so this module does not import application), `POST /:id/test` (Universal Auth login only,
  throttle 20/min, `{ok, message}`). `SecretSourceModule` is imported by `ApplicationModule` and `ProjectTransferModule`, never the other way around.
- **Client** (`infisical.client.ts`, `fetch` + `AbortSignal.timeout(10 s)`, no SDK): `POST /api/v1/auth/universal-auth/login {clientId, clientSecret}` → `accessToken`; then
  `GET /api/v4/secrets?projectId&environment&secretPath&recursive=false&includeImports=true&expandSecretReferences=true` (Bearer). Verified against the official documentation (infisical.com/docs/api-reference).
  If v4 answers **404**, `GET /api/v3/secrets/raw?workspaceId&…&include_imports=true` is tried (older self-hosted installations) — this v3 endpoint is **not** verified against documentation (the page
  does not exist), only from prior knowledge; a 404 on both = a real error. Result: key → value (imports first, the folder's own secrets win; `secretValueHidden` is skipped). Errors = `SecretSourceError`
  with a short message from the HTTP status + Infisical's `message` field (cut to 160), timeout `no answer within 10s`, `could not reach the server (ECONNREFUSED)` — it **never** contains the client secret,
  token, credentialed URL, or secret value. The login token only lives within a single `fetchSecrets` call; **there is no cache across calls** (every resolve = a new login + list).
- **Application** (columns `secret_connection_id`, `secret_project_id`, `secret_environment`, `secret_path` default `/`, `secret_sync` default false): `PUT /applications/:id/secret-source
  {connectionId|null, projectId, environment, path, sync}` (developer+: PUT = write, viewer 403 via `assertAccess`; **409 while a deployment is active** because the runner keeps a copy of the entity and
  would overwrite changes, same as host port). `connectionId` `null`/`""` = detach the source: other fields are accepted but ignored (the web sends them), stored as `null`/`'/'`/`false`. Validation
  (`secret-selection.ts`): `projectId` `[A-Za-z0-9_-]{1,100}`, `environment` `[A-Za-z0-9_-]{1,64}`, `path` `/` or `/seg/seg` (`[A-Za-z0-9._-]`, no `..`, no trailing `/`), empty `path` → `/`.
  `POST /applications/:id/secret-source/preview` → `{keys: string[]}` **names only**, sorted (POST ⇒ viewer 403, throttle 20/min, uses the saved configuration; source errors → 400 with a short message).
  `get-application` adds `secretSource: {connectionId, connectionName, projectId, environment, path, sync} | null`.
- **Resolver** (`EnvResolverService.resolve(app, {secretSource?, lenient?})`): priority **project env < Infisical secrets (only when `secretSync`) < app env**; `${{secret.KEY}}` is supported in both the project env and the app env.
  New secrets are fetched when `secretSync` is on or a reference exists; keys that are not valid env names (`[A-Za-z_][A-Za-z0-9_]*`) are skipped; **values from the source are literal** (`${{…}}` inside them is not expanded).
  Unknown key → `EnvReferenceError` (400 during `update-application` env validation, or a `failed` deployment). A fetch failure while creating a container (deploy, `applyRuntimeConfig`, rollback,
  `run` job) → a `failed` deployment with a short message; the env is resolved **before** the old container is touched, so the old container keeps running (tested for real). Validation on saving env uses `lenient`: an unreachable source is not an error and `secret.*` references are not checked (a flaky source must not block editing). All fetched values (≥ 6 characters, so that ordinary log text is not broken) go into `secrets`
  → `DeploymentLog.redact`, the `app-error-watcher` redaction (if the source cannot be read at notification time, the sample log is **not sent**), and the output of `run` jobs. Env values visible in `docker inspect` of a container are of course visible to anyone with access to the Docker host — same as the database password.
- **PR previews do not inherit the source** (`replaceContainer` calls the resolver with `secretSource: !override`): PR branches are arbitrary code, the same rule as mounts. An app env that uses `${{secret.KEY}}` makes its preview fail with the message "not available in pull-request previews" (not a silent empty value). Compose stacks have no source (a `secret.*` reference = a clear error).
- Project export/import: `applications[].secretSource {connection (NAME), projectId, environment, path, sync}`, **without credentials**; on import the name is matched; a missing connection or an invalid location → empty source + warning.
- **Not yet tested against a real Infisical** (the user will test it): everything was tested against a local fake server that checks the exact paths/parameters from the documentation (login 401, v4 200, folder 404,
  server down) and unit tests with a fake `fetch`. Not verified: the behavior of `imports` (priority between imports), the v3 fallback path, `viewSecretValue`/`secretValueHidden` for identities without value-read permission,
  organizations with many sub-organizations (`organizationSlug` is not sent), and self-hosted TLS with a private CA (Node's fetch uses the default trust store).

## Git credential & Webhook

- `src/modules/git-credential/` — entity `GitCredential` (`github`|`gitlab`|`generic`, `token_encrypted` `select: false`, encrypted with `src/modules/docker/secret.util.ts`
  using `ENCRYPTION_KEY` — the same util the registry uses). Flow `create/list/delete-git-credential` (owner/admin). Deleting → `applications.git_credential_id` SET NULL.
- Private repos: `Application.gitCredentialId`; the runner builds `https://user:token@host/repo` (`GitCredentialService.authenticateUrl`) only as a local variable
  for `POST /build?remote=` (the daemon forwards the userinfo — verified; the daemon also does not show it in error messages). `DeploymentLog.redact(token)` masks the
  token (raw & URL-encoded) in logs and `errorMessage`. The DTO rejects a `gitUrl` that contains `@`.
- Webhook: `Application.webhookToken` (32 random bytes, `select: false`, unique) → `POST /webhooks/:token` (`webhook-deploy/`, **without JwtAuthGuard**, throttle 30/min,
  `timingSafeEqual`). A push to `refs/heads/<gitBranch>` → `DeployApplicationService.queue(app, 'build', {trigger:'webhook', ...})`, commit & pusher from `parsePushCommit()`
  (`webhook-deploy.service.ts`, pure & unit-tested: GitHub `after`/`head_commit.message`/`pusher.name`, GitLab `checkout_sha`/last commit in `commits[]`/`user_name`
  — see the Application & Deploy section on `Deployment.trigger`); another branch / non-push event / deleted branch → 200 `ignored`;
  a deployment already running → 200 `busy` (not queued). `get-webhook/` (URL from `PUBLIC_API_URL`) and `regenerate-webhook/`. Deliveries from real providers are not yet tested (localhost only).
  **Pitfall found**: `PUBLIC_API_URL` is read by the **`api` container itself** (`ConfigService.get`, here and in `compose-webhook.service.ts` +
  `panel-domain.service.ts` for `applied.publicApiUrl`) — not only used by `web` for the terminal socket as its name suggests. `docker-compose.dist.yml`
  now passes this var to **both** services (`api` and `web`); previously only `web` declared it, so the API always fell back to
  `http://localhost:3001` even when the API domain was set through panel-domain (which writes `PUBLIC_API_URL` to `.env.dist` but that is useless if the api service
  does not read it) — the webhook URL on the dashboard and the "Currently applied" status in the panel's Domain card showed the wrong `localhost`. General rule: when adding a new `config.get<...>('X')` in the API code, also check whether `X` must be added to the **api** service's `environment:` block (not just web) in
  `docker-compose.dist.yml` — see the Docker/distribution section about copying to `aoox-cli/assets/install/`.
- **Webhook secret** (`Application.webhookSecretEncrypted`, nullable `select:false`, AES via `secret.util` like other secrets — the URL token stays plaintext because it is the lookup key; `webhook-secret/`: `PUT /applications/:id/webhook/secret` creates/rotates, `DELETE` disables; its value is included in `get-webhook`
  so it can be copied to the provider). When set, `webhook-deploy` requires proof: GitHub `X-Hub-Signature-256` = `sha256=HMAC-SHA256(secret, raw body)` or GitLab `X-Gitlab-Token` = the secret
  (`webhook-signature.ts` `verifyWebhookSignature`, `timingSafeEqual`) → otherwise **401** (deliberately not 200 like irrelevant events: the GitHub docs define 401 for a wrong signature, and the throttle limits brute force). It needs **`rawBody: true`** in `NestFactory.create` + `@Req() RawBodyRequest` (NestJS "Raw body" docs),
  because the HMAC is computed over the exact bytes, not the parsed JSON. Without a secret = the old behavior (URL token only).
- Verifying incoming request IPs (GitHub, optional): see the "Incoming webhooks (additional security)" section below — outgoing HMAC webhooks (notifications) already exist, see the Notifications section.

## Preview deployments (pull requests)

- Entity `PreviewDeployment` (`preview_deployments`, unique per `application_id`+`pr_number`; PR head branch, sha, host, status building→running|failed, logs).
  Not a `Deployment`: one PR = its own container `aoox-app-<appName>-pr<N>` + Traefik router `<appName>-pr<N>` + host `<appName>-pr<N>.<previewDomain>`
  (`Application.previewDomain` or the env `PREVIEW_DOMAIN`; needs a wildcard DNS record; a per-host ACME certificate on first access; remote servers = no host).
- **Opt-in** `Application.previewsEnabled` (default false — PR branches are arbitrary code); PRs from **forks are always ignored**; at most `PREVIEW_MAX` (5) open previews per app.
- `preview.service.ts`: `upsert(app, pr)` (create/refresh the row, then build detached), `destroy`, `hostFor`; it builds via `DeploymentRunnerService.buildTargets` +
  **`buildImage(app, branch, {tag, suffix:'-preview', log})`** (split out of `run()` so that deployments & previews share build/push/redaction/nixpacks/remote server) and
  `replaceContainer(app, imageRef, log, override)` (its own name/router/hosts/labels, no host port). `PreviewLog` = a row-based `BuildLog`. After the build and after start it checks the row still exists
  (if the PR was closed during the build, the container is not left behind). A TypeORM `remove()` clears the entity's `id` — save the id before destroying if it needs to be returned.
- Webhook (`webhook-deploy.service.ts`, `parsePullRequest`): GitHub `X-GitHub-Event: pull_request` (`opened|synchronize|reopened` → upsert, `closed` → destroy; fork = `head.repo.full_name
  ≠ base.repo.full_name`) and GitLab `merge_request` (`open|update|reopen` / `close|merge`, `source_project_id ≠ target_project_id`). Replies 200 `result: preview|preview-closed|ignored`.
  Endpoints: `GET /applications/:id/previews`, `DELETE /previews/:id`. Deliveries from real providers are not yet tested (simulated with curl).
- **Deleting an app** (`DeleteApplicationService`) calls `PreviewService.destroyAll(app)` before the app's container/row is deleted: each preview is destroyed on the app's daemon (`forServer(app.serverId)`, including remote servers) via `destroy()`; if one preview fails it is only logged as a warning and the app deletion continues. FK cascade alone is not enough because it only deletes rows, not containers. A build still running sees its row disappear (checks `exists` after the build & after start) and then removes its own container.

## Proxy & Domain

- `src/modules/proxy/` — `proxy.service.ts` runs **Traefik v3** (`aoox-proxy`, bridge network `aoox`, volume `aoox_proxy_acme`)
  with the docker provider (`exposedbydefault=false`), entrypoints `web`/`websecure`, and the ACME resolver `le` (HTTP-01) when `PROXY_ACME_EMAIL` is set.
  Flow: `proxy-status/`, `provision-proxy/`, `remove-proxy/` (owner). Host ports: `PROXY_HTTP_PORT`/`PROXY_HTTPS_PORT` (dev: 8088/8443 because 80 is in use).
- Entity `Domain` (`domains`, `host` unique, `https`) in the application module; flow `add-domain/`, `list-domains/`, `delete-domain/`. `add-domain/` now mirrors
  `PanelDomainService`: before `applyRuntimeConfig` (Traefik labels are useless without something listening), it checks `ProxyService.statusOn()` on the right daemon (local, or
  `RemoteDockerService.forServer(app.serverId)` + `proxySettingsOf(server)` for apps on remote servers) and calls `provisionOn()` automatically if not `running` —
  a proxy that is already running is left alone. The response `AddDomainResult { domain, proxyAutoProvisioned }` (no longer a plain `Domain`) so the web can show the same
  warning as panel-domain (DNS/firewall/wait for ACME) when adding the first domain for an app. Without `PROXY_ACME_EMAIL` on the host/server,
  the proxy still runs but without ACME — a requested `https` domain only gets a certificate once `acmeEmail` is set (via panel-domain for the host,
  or the server settings for remote servers).
- Traefik labels are built by `proxy.labelsFor(appName, port, domains)` (instance method; uses `httpsPort` + whether ACME is present) → `ProxyService.buildLabels(..., {httpsPort, acme})` (static, unit-tested)
  and applied in `replaceContainer`; all app containers join the `aoox` network (`HostConfig.NetworkMode`).
  Routers per app: `<name>` (web, non-https host), `<name>-secure` (websecure + certresolver `le`), and **`<name>-redirect`** (web, https host → 301 to https via the middleware
  `redirectscheme`, `port` = `PROXY_HTTPS_PORT`) — the redirect is only created when ACME is active, so without `PROXY_ACME_EMAIL` (dev) https hosts remain reachable over http, instead of
  being redirected to Traefik's self-signed certificate. Changing a domain → `DeploymentRunnerService.applyRuntimeConfig(app)` (recreate the container with `currentImage`, no build);
  the old container only gets the new labels after a redeploy/domain change.
- Domains for the panel itself, two paths: (1) **manual** — the `docker-compose.domain.yml` override (`-f docker-compose.dist.yml -f docker-compose.domain.yml`) applies the same labels to the
  `web`/`api` services (`WEB_DOMAIN`/`API_DOMAIN` required, needs `PROXY_ACME_EMAIL`; `WEB_ORIGIN`/`PUBLIC_API_URL` must be switched to https); (2) **from the dashboard** —
  `src/modules/panel-domain/` (`GET`/`PATCH /instance/domain`, owner only): `PanelDomainSettings` (single row `panel_domain_settings`) stores `webHost`/`apiHost`/`acmeEmail`;
  `PATCH` is throttled 5/min, needs the env `INSTALL_DIR` (absolute path of the `docker-compose.dist.yml` folder on the host — no default yet, must be set manually in `.env.dist`), then
  `apply()` is scheduled with `setTimeout` for 1.5 seconds (so the HTTP response can be sent before this container itself is recreated): first, if `ProxyService.status()`
  says the proxy is not `running`, it is **provisioned automatically** (`ProxyService.provisionOn` with the `acmeEmail` from the just-saved settings) — without this the Traefik labels were applied but nothing listened on ports 80/443, and the domain showed "unable to connect" with no clear error (found through a real VPS test). A proxy that is **already** `running` is not touched
  (not recreated each time a domain is saved, so ACME state and other apps' routing are not disrupted). Then a `docker:29-cli` helper (same pattern as
  `compose-runner`) bind-mounts the host's `INSTALL_DIR` directly (not a volume) at the same path inside the helper, and `putArchive` writes `docker-compose.override.yml` (a **different** name from the manual `docker-compose.domain.yml`).
  **Pitfall found**: Compose only auto-includes `docker-compose.override.yml` when the main file is named exactly `docker-compose.yml` (the default lookup without `-f`) — once `-f docker-compose.dist.yml` is given explicitly (as here), the override is **not** loaded unless it is also given explicitly; this wrong assumption caused the Traefik labels to be written to disk but never actually applied to the container. So the script always uses `-f docker-compose.dist.yml -f
  docker-compose.override.yml` (this path writes that file itself first, so it always exists) — `instance-update` (below) first checks that the file exists before referencing it, because there the file may never have been written. Then a `sed`/`grep` script upserts `WEB_DOMAIN`/`API_DOMAIN`/`PROXY_ACME_EMAIL`/`WEB_ORIGIN`/`PUBLIC_API_URL`/`COOKIE_SECURE`
  in `.env.dist` before `docker compose up -d`.
  The Traefik labels from `renderPanelOverride()` (`panel-domain.util.ts`, pure & unit-tested) reuse `ProxyService.buildLabels` directly for the `aoox-web`/`aoox-api` routers
  (ports 3000/3001) — not a separate YAML template like the manual path. `docker-compose.dist.yml` declares the network `aoox` (explicit `name:`) and puts `web`/`api`
  on it in addition to `default`, so Traefik can reach them. Ports 3000/3001 remain published for access via IP in both paths. `aoox-cli`: `aoox domain set --web --api
  [--acme-email]` calls the same endpoint (requires `aoox login` first). Not yet: DNS validation before applying (unlike app domains, which have `check-domain-dns`), and automatic rollback
  if `docker compose up` fails after the domain is changed (the old container has already been replaced by its arguments, not blue/green like apps).
- **DNS check** (`check-domain-dns/`, `GET /applications/:id/domains/:domainId/dns`, throttle 30/min, not stored): `dns.promises` resolve4/6 (+CNAME for display)
  compared with the expected IP: an app on a remote server → `Server.host` (a literal IP or resolved), otherwise the `PUBLIC_IP` env, or auto-detection via `https://api.ipify.org`
  (cached 10 minutes; failure → status `unknown`, not an error). Status `ok|mismatch|unresolved|unknown` (`evaluate()` pure, unit-tested) + `message`. It does not block `add-domain` —
  DNS may be configured later.
  **Periodic check** (`dns-watcher.service.ts`, application module — not the notification module, because it needs the `Domain` repo + `CheckDomainDnsService`, and `ApplicationModule`
  already imports `NotificationModule`, so the other direction would be a cycle): every 15 minutes it re-runs the same `execute()` for **every** registered domain (https or not — a wrong DNS breaks routing whatever the protocol, not just ACME) and sends a `dnsIssue` notification (toggle `on_dns_issue`, default on) if `mismatch`/`unresolved` persists for **two** consecutive checks (`badSince` Map, same pattern as `service-health-watcher.service.ts`; it dampens transient DNS wobble seen from this host), then at most 1×/day/domain
  while it stays broken (`notified` Map, same cooldown as `certificate-watcher`). `unknown` (no comparison IP) never sends. A domain that becomes healthy again or is deleted resets/drops its entry
  (cleaned on every tick against the list of existing domains, so memory does not leak). Tested for real: `one.one.one.one` (publicly resolves to
  1.1.1.1, deliberately not this host's IP) → two manual ticks sent the `dns.issue` webhook exactly once with `status:"mismatch"`; the first tick sent nothing. It catches the cause earlier than `certificate-watcher` (which only learns after Traefik fails ACME), and also applies to http-only domains that never touch ACME.

## Custom SSL certificates

- `src/modules/certificate/` — TLS certificates uploaded by the operator (a company CA, a purchased wildcard, a Cloudflare Origin CA, networks without access to Let's Encrypt) for **application domains**.
  Without this, TLS only comes from ACME. Entity `CustomCertificate` (`custom_certificates`: `name` unique, `certificate_pem` = the bundle normalized with the leaf first and then the chain (public), `private_key_encrypted`
  `select:false` AES via `secret.util` + `ENCRYPTION_KEY`, `common_name`, `domains` jsonb, `issuer`, `not_before`/`not_after`, `fingerprint` SHA-256 in openssl style). Platform-level: one certificate
  (e.g. a wildcard) may be used by many domains. `Domain.certificate_id` nullable, FK **ON DELETE RESTRICT** (hand-written migration `CustomCertificates`, additive). `CertificateModule` only reads the
  `Domain` entity and is imported by `ApplicationModule`, never the other way around.
- **Validation** (`certificate-material.ts` `parseCertificateMaterial`, pure, time passed as a parameter, unit-tested with openssl fixtures in `certificate.fixtures.ts`): `node:crypto` only
  (`X509Certificate`, `createPrivateKey`, `checkPrivateKey`). PEM only (DER/PFX → 400 with guidance), max 64 KB per field and 10 certificates per bundle, every block must be a valid X.509; the key must be an **unencrypted** PEM
  (header `ENCRYPTED PRIVATE KEY`/`Proc-Type: 4,ENCRYPTED` → 400 with the openssl command to strip the passphrase); the key must match the **first** certificate (the message mentions the order if the chain was placed first);
  not expired (not-yet-valid is allowed). Text around the PEM blocks is discarded; the key is stored as PKCS#8. `domains` = DNS SANs, or the CN **only when there is no DNS SAN** (modern clients and Go ignore the CN when SANs exist, so following the original "SAN + CN" design would allow hosts that browsers reject — a deliberate deviation); with no names at all → 400.
  `domain-matches.ts` `domainMatches(host, names)` (pure): a wildcard only as `*.example.com` = exactly one label (`a.example.com` yes, `a.b.example.com` and the apex no), no wildcard in the TLD or anywhere other than the leftmost label.
- **API** (`/certificates`; the key is never returned by any endpoint, and the DTO has no PEM either): `POST` {name, certificate, privateKey} → 201 `CertificateDto {id, name, commonName, domains, issuer,
  notBefore, notAfter, fingerprint, usedBy, createdAt}` (400 for PEM/key/expired, 409 for a duplicate name including races via the unique index), `GET` (all members, for the Domain tab dropdown) and `GET /:id`,
  `PUT /:id` {certificate, privateKey} (replace the contents at renewal, name stays; **every domain using it must still be covered**, otherwise 400 naming the host; then sync to every daemon that uses it;
  sync failure = 502 "saved but not yet written to the proxy, save again"), `DELETE /:id` → 204 or 409 naming the count and hosts. POST/PUT/DELETE `@Roles('owner','admin')`. Audit log:
  the `privateKey` key is already redacted by the `privatekey` regex, and the public PEM is cut to 200 characters (tested).
  Domains: `GET/POST /applications/:id/domains` and the add-domain result now use `DomainDto` (`certificateId`, `certificateName` added; `AddDomainResult {domain, proxyAutoProvisioned}` unchanged);
  `POST` accepts `certificateId?` (`""`/null = automatic; only with `https: true`; must cover the host → 400, validated **before** anything is saved); new `PATCH /applications/:id/domains/:domainId`
  {certificateId: uuid|null} (the key must be present; null = back to ACME) = developer+ (PATCH = write, viewer 403 via `assertAccess`), calls `applyRuntimeConfig` like add-domain.
- **Traefik**: `ProxyService.provisionOn` now always adds `--providers.file.directory=/etc/traefik/dynamic --providers.file.watch=true` and a named volume **`aoox_proxy_certs`** (`certs-config.ts`;
  survives proxy recreates like the ACME volume; registered in `orphan-volumes.ts` as a fixed volume so it is not reported as orphaned). Labels (`buildLabels`, domain `{host, https, customCert?}`): an https host
  with a custom certificate gets a router `<name>-secure-custom` (websecure, `tls=true`, **no certresolver** — it is never requested from ACME) and is **always** redirected http→https via the router
  `<name>-redirect` even when ACME is off (that host is certainly https); a host without a custom certificate: exactly the old behavior. The runner maps `Domain.certificateId` → `customCert` (`replaceContainer`).
  An expired certificate does **not** fall back to ACME: Traefik keeps serving the existing files.
- **Per-daemon sync** (`certificate-sync.service.ts` `sync(handle, settings, serverId)` / `syncServer(serverId)` / `syncForCertificate(id)`): the certificate set = the distinct `certificate_id`s of application domains
  on that daemon (`server_id IS NULL` = host, or `RemoteDockerService.forServer(serverId)` for a remote server). It writes to the volume via a busybox helper that is not run + `putArchive` (the `mounts.ts` pattern):
  `<id>-<first 8 hex chars of the fingerprint>.crt` 0644, `.key` **0600** (`certFileNames(id, fingerprint)`; the name comes only from the row's uuid + hex, **unique per content**: replacing a certificate creates a new file pair next to the old one,
  so Traefik — which reloads on every write — never pairs a new `.crt` with an old `.key`; previously the names were fixed `<id>.crt/.key` and Traefik's log briefly said "private key does not match public key"),
  `tarFiles` now accepts an optional mode (verified with a real `tar`), and **`certs.yml` last** (`renderCertsYml`, pure) so that
  Traefik never sees a config that points to a file that does not exist yet; then a one-shot helper deletes the `*.crt`/`*.key` that are no longer used **after a 5-second pause** (only if there are stale ones; so Traefik has time to
  read the new `certs.yml` before old files disappear; the keep list and the pause are set via env, not interpolated; failure = warning).
  A sync failure in add-domain → the new domain row is deleted + 502; in PATCH → the old assignment is restored + 502 (do not leave a `-secure-custom` router pointing at a missing file; Traefik would
  serve its self-signed default certificate). Restoring an instance (DB snapshot) does **not** re-sync the certificate volume; re-save the certificate (PUT) if the volume is gone.
  One sync at a time per daemon (promise queue). Called after: add-domain with a certificate, PATCH of a domain (assign/unassign), PUT of a certificate, deleting a domain (best effort), deleting an app (best effort), and **moving servers**
  (`PATCH /applications/:id` that changes `serverId`, only if the app has domains with a `certificateId`): `UpdateApplicationService.moveCertificates` calls `syncServer(newServer)` (null = host) **first**, then
  `syncServer(oldServer)` so files no longer used on the source daemon get swept — both through the same per-daemon queue, with no new write path. A failed sync to the DESTINATION does not cancel the move (consistent with
  a move that does not recreate the container): a warning in the log and an additive field `certificateSyncError: string` on the PATCH response **only on failure** (the message suggests re-saving the domains/certificate; the source sweep is still attempted);
  a failed sync from the SOURCE is only a warning. With no `serverId` change or no certificate-bearing domains there are no sync calls. A sync to the destination daemon may trigger `upgradeToCustomCerts` (an old proxy without the file provider
  is recreated once, behavior of existing certificates) — no separate approval on this path. Unit-tested (destination→source order, host↔remote, remote↔remote, no certificates, no change, destination/source failures,
  alongside `droppedMiddlewares`); **not yet tested for real** (no remote server available).
  **Provisioning the proxy does not call sync**: the volume persists across provisions and sync writes to the volume even when the proxy does not exist yet, so a proxy provisioned later loads it straight away (a deviation from
  "called when the proxy is provisioned": `ProxyModule` must not import `CertificateModule`, cycle). The plaintext key only exists in the volume (0600) and the encrypted column.
- **Old proxies**: `ProxyStatus.customCerts` (`GET /proxy`, `GET /servers/:id/proxy`) = the container has the file provider **and** the volume (`ProxyService.supportsCustomCerts`, from `inspectContainer`).
  When a sync finds certificates in use but the **running** proxy does not support them, `upgradeToCustomCerts` recreates it **once** with the settings it is currently running with (`settingsOf`: ports and the
  ACME email/staging are read back from the container's Cmd/PortBindings, **not** the env — panel-domain may have provisioned with a different email), the ACME volume is reused so Let's Encrypt certificates and other routes stay intact; a downtime of a few seconds; reported in the log (`SyncResult.proxyRecreated`) and **not** through the add-domain response (its contract is unchanged). A stopped proxy or one that does not exist is not touched
  (add-domain/PATCH provision a non-running one as usual). Changing the contents of a certificate recreates neither the proxy nor the app containers (Traefik watches the directory).
- **Expiry** (`certificate-expiry-watcher.service.ts` in `CertificateModule`, `@Cron('7 */6 * * *')`): certificates **in use by ≥1 domain** with ≤ 14 days left or already expired → a `certificateFailure` notification
  (the existing toggle `on_certificate_failure`) with the name, domains, dates, and renewal-upload instructions; at most 1×/24 hours per certificate **and** state (`expiring` → `expired`
  notifies again straight away); unused certificates are not warned about (too noisy). In-memory cooldown (an API restart may repeat one warning). No automatic fallback to ACME.
- Project export/import does **not** carry certificates or their assignments (imported domains use ACME).
- **Tested**: unit (validation/bundle/encrypted key/mismatch/expiry, `domainMatches`, renderer, labels, sync with fake local and remote handles, old proxy, watcher + cooldown, 409 on delete, viewer/PATCH access, audit redaction, DTO `""`/null). **Not yet tested for real** (Docker was down while working on it): migrations on a real Postgres, Traefik actually serving the certificate (SNI, wildcard, issuer),
  Traefik with an empty dynamic directory at start, reloading when a file is replaced in the volume, recreating an old proxy, remote servers over SSH. Do a smoke test with a self-signed certificate before release.

## Maintenance mode (per application)

- Flag and text are on `applications` (`maintenance_enabled` default false, `maintenance_message` nullable, migration `ApplicationMaintenanceMode1790396000000`).
  `PUT /applications/:id/maintenance {enabled, message?}` (`set-maintenance/`, in the application module; developer and up through the normal write rule, viewer 403)
  answers `{enabled, message, effectiveMessage}`. `get-application` returns both columns. The message is plain text: control characters removed, newlines kept, trimmed, max 280 characters (`MAINTENANCE_MESSAGE_MAX`); empty means the default text. The page escapes it (`escapeHtml`), never raw HTML.
- **Routing, not labels.** The application container is never touched. `MaintenanceModeService` (`src/modules/maintenance-mode/`, module imported by ApplicationModule, reads only the Application and Domain entities) writes a Traefik **file-provider** config into the proxy volume `aoox_proxy_certs` (`aoox-maint-<appId>.yml`): one router per host class with `priority: 1000000` (above the docker routers, whose default priority is the rule length), service `aoox-maintenance@file`, and a headers middleware that sets `X-Aoox-App: <appId>`. Host classes mirror `buildLabels`: plain and https-without-ACME hosts on `web`; https with ACME on `websecure` with `certResolver le`; custom-certificate hosts on `websecure` with `tls: {}`. No `web` router is added for https hosts, so the docker `-redirect` router still sends http to https. Operator middlewares stay in front of the page (grouped per list, as in `buildLabels`). Why not label rewriting: it would recreate the container on every toggle (downtime, blue/green or rolling deploy), and the page would vanish whenever the container is stopped or unhealthy (Traefik drops those routers).
- **Shared page server.** `aoox-maintenance` (`nginx:1.27-alpine`, `aoox.component=maintenance`, aoox network, `unless-stopped`, log rotation) is created on first use and kept running. Its nginx config (`renderMaintenanceNginxConf`) answers every request with 503 and `Retry-After: 300`, and serves `/pages/<X-Aoox-App>.html` from the volume `aoox_maintenance` (fallback `default.html`). The header is set by the app's Traefik middleware and overrides client values. Pages are written through a busybox helper (the mounts and proxy-config pattern). `aoox-maintenance.yml` (the one `loadBalancer` for `http://aoox-maintenance:80`) is rewritten on every sync. No other sweep touches these names: the certificate sweep matches `*.crt`/`*.key`, proxy-config only `user-*.yml`.
- **When it is written.** `MaintenanceModeService.refresh(appId)` is a no-op when the flag is off. It runs after PUT (switch on; switch off calls `deactivate`, which removes the application's yml and page; a failed write rolls the flag back and answers 502), after `add-domain`, `update-domain` (certificate or middleware change), `delete-domain`, and `deactivate` on application deletion (best effort). Deploys need no sync: the file router outranks the labels a deploy writes, so the page stays while the app is redeployed. A new flow that changes an application's hosts must call `refresh`, or the routers go stale. Moving an application to another server while maintenance is on answers 409 (switch it off first).
- **Proxy support.** An older running proxy without the file provider is recreated once through `upgradeToCustomCerts` (the certificate rule). A stopped or missing proxy only gets the files, which load when it starts.
- **Limits, deliberate.** Remote-server applications answer 400 (that daemon's proxy and volume are not wired; untested). PR previews keep serving (they are not domains of the app). Direct `host:port` access bypasses the page (noted in the UI). The page text is English (end-user text, product rule). `Retry-After` is a fixed 300 seconds. Instance restore does not rewrite the files (same as certificates). Project export/import does not carry the flag, so importing a project never puts it into maintenance. The `aoox-maintenance` container and its shared yml stay after the last application leaves maintenance (cheap; a page is only routed while its file exists).
- **Tests.** `maintenance-mode.spec.ts` (escaping, normalization, nginx config, every host class and middleware grouping of `appDynamicConfig`) and `set-maintenance.dto.spec.ts`. Existing domain, delete and update specs take the new dependency as a stub. Tested for real on Docker Desktop against the dev Traefik with an nginx:alpine app: `maint.test` over http and `tls.test` over https with an uploaded certificate. Results: 503 with `Retry-After` and escaped text for GET, POST and HEAD; a spoofed `X-Aoox-App` is ignored; a redeploy while on keeps the page; a domain added while on is covered; the custom certificate is served on the page (same fingerprint); http still redirects to https; switching off restores 200 and removes the files; viewer PUT 403; too-long message 400; server move 409; app deletion removes the files. Not tested: ACME hosts (the dev proxy has no resolver), remote servers, swarm-mode applications.

## Dynamic Traefik configuration (dashboard editor)

- `src/modules/proxy-config/` — **dynamic** Traefik configuration files (file provider) written by the operator, per proxy (host or remote server). Entity `ProxyConfigFile`
  (`proxy_config_files`: `name` slug `[a-z0-9-]{1,40}` unique per `server_id` (two partial unique indexes; `server_id` null = host, FK `servers` ON DELETE CASCADE), `content` YAML, `enabled`,
  timestamptz; migration `ProxyConfigFiles`). **The DB is the source of truth**: the volume can be rewritten at any time (`POST /proxy/config/sync`) — restoring an instance recovers the rows but does **not**
  write the volume (same as certificates), so the web has a "Re-apply" button. `ProxyConfigModule` only reads the `Domain` entity (middleware references) and is imported by
  `ApplicationModule`, never the other way around; static controllers (`presets`, `sync`, `status`) are registered **before** the `:id` ones.
- **Writing** (`proxy-config-sync.service.ts`): to the volume `aoox_proxy_certs` (mounted at `/etc/traefik/dynamic` in the proxy, `/dynamic` in the helper) via busybox + `putArchive` — the
  `CertificateSyncService` pattern, with its own one-sync-at-a-time per-daemon queue (the two modules write different files to the same volume, so they do not need to share a queue). File names are **always**
  `user-<name>.yml` (`userFileName`), so the `*.crt`/`*.key` sweep and the rewrite of `certs.yml` owned by the certificate module never touch them, and this sync **never**
  writes `certs.yml`/crt/key; the sweep only matches `user-*.yml` that are not in the keep list (no 5-second pause like certificates — the files reference each other via `name@file`,
  not paths, so there is no ordering risk). A disabled file = removed from the volume but kept in the DB. An old proxy without the file provider is recreated **once**
  (`ProxyService.upgradeToCustomCerts`, same as certificates) and therefore the API asks for approval: `409 {code: 'proxy-restart-required'}` unless `acceptProxyRestart: true`
  (in the create/update body, or the sync query); `GET /proxy/config/status` → `{proxy, fileProvider, needsRecreate}` so the web asks before saving; the sync response carries a `notice` when this happens.
- **Validation** (`proxy-config-schema.ts`, pure): `js-yaml` `load` (a **direct dependency**, v4 CJS + `@types/js-yaml` dev — previously only transitive via eslint/nest-cli; do not replace it with an ESM-only package, which breaks Jest), max 64 KB (bytes), only the top-level key `http` with `middlewares|routers|services|serversTransports`; `tls`/`tcp`/`udp` are rejected with a reason,
  other keys are rejected; element names `[a-z0-9-]{1,63}`; names must be unique per proxy across all active files (400). Structural validation only — each middleware's options are validated by Traefik itself.
- **Verification & recovery**: after a write (and with the proxy `running`), wait `verifyWaitMs` 4 s, read the `aoox-proxy` log with `containerLogsSince`, and `errorsAbout()` (`traefik-log.ts`, pure) picks the error lines that mention the file's name **or** an element `name@file` from that file (errors of other files are not blamed; ANSI colors/timestamps are stripped, repeats are folded). If there is an error →
  the DB row is restored (delete the new row / restore the old content), re-sync without verification, and reply 400 with the Traefik quote. An unreachable daemon → also restored + 502. A stopped/missing proxy
  → only a `warning` (the file is saved). Real Traefik error formats (tested): `ERR Error occurred during watcher callback error="collecting file configs: /etc/traefik/dynamic/user-x.yml: field
  not found, node: opsi"` (unknown option/wrong type), `ERR error="middleware \"x@file\" does not exist" routerName=r@file`, `ERR error="error while parsing rule …"`.
  **Limit**: a wrong value that Traefik does not log at INFO level (e.g. a service URL `://nope`) gets through; a valid config can still override routing for other domains — which is why writing is owner-only.
- **API** (`@Roles('owner','admin')` read, `@Roles('owner')` write, throttle 20/min): `GET /proxy/config?serverId=` (no content; `usedByDomains`), `GET /proxy/config/:id`, `POST` `{name, content,
  enabled?, serverId?, acceptProxyRestart?}`, `PUT /:id` `{content?, enabled?, acceptProxyRestart?}`, `DELETE /:id`, `POST /proxy/config/sync`, `GET /proxy/config/presets`, `POST
  /proxy/config/presets/:preset {params}` (only builds the YAML, does not save; owner). Audit log: the `content` and `password` keys are redacted. Basic-auth hashes are stored in the YAML as
  `user:$2y$…` (bcryptjs `$2b$` is rewritten to `$2y$`, same algorithm; tested for real with Traefik: 401 without/with wrong credentials, 200 with the right ones).
- **Presets** (`proxy-config-presets.ts`, pure + bcrypt): `basic-auth`, `security-headers`, `rate-limit`, `ip-allowlist`, `redirect-www`; they only build YAML (the result is a normal file that can be edited).
  `redirect-www` uses `redirectRegex` without look-ahead (RE2) — it must only be attached to hosts that are redirected.
- **Per-domain middlewares** (`Domain.middlewares` jsonb `string[]` default `[]`, migration `DomainMiddlewares`): `PATCH /applications/:id/domains/:domainId` now accepts `certificateId?` **and/or**
  `middlewares?` (at least one, 400 if empty; developer+, viewer 403 via the write rule; `applyRuntimeConfig`). A `name@file` name (`MIDDLEWARE_REF`, `proxy/middleware-ref.ts`) must exist in an **active** file on the proxy that serves the app (`ProxyConfigService.assertMiddlewaresExist(app.serverId, …)` → 400). `GET /applications/:id/domain-middlewares` (all project members) → `[{ref, file}]`.
  Disabling/deleting/rewriting a file so that a middleware used by a domain on that proxy disappears = **409** naming the domain (and the middleware name); this strictness is deliberate, not a warning.
  `ProxyService.buildLabels`: `RoutedDomain.middlewares`; **one router per distinct middleware list** (Traefik attaches middlewares per router, and one router serves many hosts) — the group without middlewares keeps the exact old router names (domain labels without middlewares do not change, tested identically), other groups use `-m<sha1 8 hex of the list>` (stable, does not depend on other domains), for the
  `-secure`, `-secure-custom`, and plain http routers (hosts served over http; without ACME, https hosts are served on both and both carry the middlewares). The `-redirect` router does **not** carry
  middlewares (it only redirects; its `-https@docker` middleware stays). Entries that are not `name@file` are dropped before becoming a label value (no injection). **Moving servers**: a `PATCH /applications/:id`
  that changes `serverId` (host↔remote, remote↔remote) calls `UpdateApplicationService.pruneDomainMiddlewares()` right after the app is saved and **before** any path that recomputes labels:
  each domain only keeps the middlewares whose NAMES are defined in an **active** file on the destination proxy (`ProxyConfigService.availableMiddlewares(app.serverId)`, null = host), the rest are dropped,
  a log warning per domain, and the PATCH response (the `Application` entity) gets an additive field `droppedMiddlewares: [{domain, names[]}]` **only when something was dropped** (other response shapes are unchanged).
  With no `serverId` change or no domains with middlewares there is no query to the proxy. Moving servers does not move the dynamic config files, but **custom certificates are handled** (see the Custom SSL certificates section: `UpdateApplicationService.moveCertificates`, right after `pruneDomainMiddlewares`,
  using the same domain list — one query). Project export/import carries neither the files
  nor the domain middlewares (import still succeeds if the source file contains that field — it is ignored, tested).
- **Not yet / out of scope**: Traefik **static** configuration (log levels, access log, trusted IPs — needs a proxy recreate), a visual middleware editor, TCP/UDP, validation of per-middleware options on the aoox side.
  **Tested for real** (the developer's own Traefik, only via `user-test-*` files): files loaded/rejected/recovered, disabled→404, basic auth, headers, per-domain middlewares (header, basic auth, both in sequence), 409/400; UI. **Not yet tested**: real remote servers (SSH), Swarm, HTTPS domains with a custom certificate + middlewares (only label unit tests), an old proxy being recreated.

## Notifications

- `src/modules/notification/` — entity `Notification` (`notifications`: `type` `telegram`|`slack`|`discord`|`webhook`|`email`, `config_encrypted` JSON AES via `ENCRYPTION_KEY`,
  `select:false`; toggles `on_deployment_success`/`on_deployment_failure`/`on_backup_failure`/`on_container_down`). Platform-wide, `@Roles('owner','admin')`.
  Flow: `create/list/delete-notification`, `test-notification` (`POST /notifications/:id/test` sends a sample message). The DTO never contains the token/URL/SMTP password — only `targetHint`.
- `notification-sender.ts` — `requestFor(config, message)` (pure, unit-tested) → payload per platform (Telegram `sendMessage` HTML, Slack attachments, Discord embeds, flat webhook JSON);
  `sendNotification` uses the global `fetch` + `AbortSignal.timeout(10s)`. Email goes through **nodemailer** (`sendEmail`, SMTP per channel: host/port/secure/user/password/from/to — not env),
  `emailContent()` = subject/text/html. Generic webhook = SSRF by design; owner/admin already have a host shell, so this is not an escalation.
  `broadcast(event, message)` filters channels through `EVENT_TOGGLE` (event → toggle column).
- Other events: **backup failure** — `DatabaseBackupService.backup()` calls `broadcast('backupFailure')` (manual & scheduled) fire-and-forget; **job failure/timeout** — `jobFailure` (`on_job_failure`).
  **Container down** — `docker-events.service.ts` (docker module) keeps one `GET /events` stream (`type=container`, `event=die`, `label=aoox.component` —
  only the **key**: multiple `label` values in one Docker filter are ANDed, not ORed) with reconnect backoff + `OnApplicationShutdown`;
  `container-down-notifier.service.ts` (application module) waits `GRACE_MS` 5 seconds and then decides: the container no longer exists (replaced by deploy / deleted), the app/db row is `stopped`
  (the stop flow writes the status *after* stopping → hence the grace), or it is running again with exit code 0 (clean restart) = ignored; otherwise it sends, at most 1×/container/10 minutes (`COOLDOWN_MS`).
- **Watchers** (`src/modules/notification/watchers/`, cron in `NotificationModule`, which now imports `ScheduleModule`+`DockerModule`): `disk-watcher.service.ts` — daily at 07:00,
  busybox `df -Pk` with `/var/lib/docker` bind-mounted `:ro` (`docker system df` does not report free space; on Docker Desktop what is measured is the VM disk) → `parseDf()` (pure) → above
  `DISK_ALERT_PERCENT` (default 90) sends `diskLow` at most 1×/24 hours. `certificate-watcher.service.ts` — every 10 minutes reads 400 lines of the `aoox-proxy` log, `parseAcmeFailures()`
  (pure; Traefik console & JSON formats, ANSI stripped) → `certificateFailure` per domain at most 1×/24 hours. Toggle columns `on_disk_low`, `on_certificate_failure`.
  **Domain DNS** — `dnsIssue`/`on_dns_issue`: see `dns-watcher.service.ts` in the Proxy & Domain → DNS check section (not here, because it needs the `Domain` repo).
- **Signed outgoing webhooks**: the webhook config has an optional `secret`; `webhookHeaders()` (pure, unit-tested) adds `X-Aoox-Event`, `X-Aoox-Delivery`
  (= `body.id`, a UUID per delivery) and `X-Aoox-Signature: sha256=HMAC-SHA256(secret, raw body)` — computed over the exact bytes sent (`raw` in `sendNotification`), GitHub scheme.
  The webhook body now always contains `id` and `timestamp`.
- Sending from the application module: `deployment-notifier.service.ts` subscribes to `DeploymentEventsService.onStatus` (emitted **synchronously** from inside the runner → the listener only schedules work,
  and never throws), only for `success`/`failed`, then **re-reads the Deployment row** (the error has already been redacted by `DeploymentLog`) and calls `NotificationService.broadcast(event, message)`;
  failures per channel are only logged. Link to `${WEB_ORIGIN}/applications/<id>` when `WEB_ORIGIN` is set. `ApplicationModule` imports `NotificationModule` (not the other way around).
- **Deployment started** (`on_deployment_started`, **default `false`** — unlike the other toggles which default to `true`, because this event can happen often via webhook/
  auto-update and existing channels may not want to hear about every one): `deployment-notifier.service.ts` also subscribes to `DeploymentEventsService.onCreated`
  (`emitCreated`, added to `DeploymentRunnerService.start()` — the single choke point called for **every** deployment creation path: build/webhook/
  auto-update/rollback/config, so `deployment:created` is always emitted exactly once per deployment regardless of trigger). The handler re-reads the row and **skips**
  `kind: 'config'` (a deployment without a build — it only re-applies the swarm mode/replicas/limits on the same image; not a "new deploy" worth waiting for, and it can
  happen often for routine adjustments — sending for these would be noisier than useful). The message: app name, project, and the **Trigger** field from
  `triggerSummary()` in `trigger-summary.ts` (the pure helper already used by the first line of the deployment log — short commit + commit message + sender for webhooks,
  "Triggered by auto-update" for auto-update, "Triggered manually" otherwise), `level: 'info'`.
- **App errors from logs** (`on_app_error`, **default `false`** for all channels — detecting errors from log text is error-prone, so it is strictly opt-in, unlike the older toggles which default to `true`): `app-error-watcher.service.ts` (application module, `@Cron` every minute, same pattern as `dns-watcher.service.ts`) scans the logs of each
  `running` app with `Application.ignoreErrorLogs = false` (a per-app switch, default `false`, for apps whose normal output is noisy and looks like errors).
  **Not** a permanent `follow` stream per container — `DockerEngineClient.containerLogsSince(id, sinceUnixSeconds)` (`GET /containers/{id}/logs?since=`) is called
  on every tick with an in-memory cursor per container id (per container, not per app, because `service` mode has many task containers); a container seen for the first time
  is only baselined (cursor = now) without scanning old logs, so that a freshly deployed/restarted app does not immediately trigger notifications from its own historical logs.
  Apps on a remote server → `RemoteDockerService.forServer(app.serverId)`; `service` mode → `SwarmDeployService.taskContainers(app)` (always the local daemon, since swarm is host-only).
  **Compose stacks and PR previews are out of scope** (see their own sections).
  The pure detector `log-error-detector.ts` `detectLogErrors()` (heavily unit-tested): start-of-event patterns `Traceback (most recent call last)`, `^panic:`,
  `Unhandled(Promise)?Rejection`, `\w*(Error|Exception)\b[:\s]` (requires the capitalized "Error"/"Exception" exactly, so lowercase "retrying after error: x" does not trigger),
  `level[=:]"?(error|fatal)"?`, `\bFATAL\b`, `\[ERROR\]`, or a JSON line whose `level`/`severity` field is `error`/`fatal` (string) or
  `50`/`60` (number, pino levels) — checked first against an explicit list of **false positives** (`0 errors`, `errors: 0`, `no error`, `error_count=0`, case-insensitive)
  so they do not trigger. Continuation lines (indented, `at …`, `File "…`) are merged into the same event, capped at 20 lines total; the first non-indented line
  ends the merge (this sometimes makes the summary line of a Python exception — which is not indented — appear as a separate event from its Traceback;
  deliberate, still better than not detecting it at all). The fingerprint = the first line, normalized (`normalizeFingerprint()`: UUIDs/hex/timestamps/
  durations/plain numbers → placeholders) so that the same kind of error (different request ids) is not treated as a new error over and over.
  Send **one notification per app per tick** (not per line): the number of errors, at most 3 examples (distinct fingerprints, truncated to 300 characters), a link
  `${WEB_ORIGIN}/applications/<id>`, `level: 'failure'` (there is no `'warning'` level in `NotificationMessage`). **Cooldown** of 15 minutes per app — **except** when there is a
  fingerprint never seen since boot for that app (`seenFingerprints` in-memory per app id), which is always sent so that a new error is not held back by the cooldown of an old one. The in-memory maps (`cursorSeconds` per container, `seenFingerprints`/`lastNotified` per app) are cleaned up on each tick for
  containers/apps that are no longer active — an app that disappears and then reappears is treated as new (re-baselined, not continuing the old cooldown).
  **Redaction**: raw env values whose key contains `PASSWORD`/`SECRET`/`TOKEN`/`KEY`, plus the database passwords resolved by `EnvResolverService.resolve()`
  (the same set registered with `DeploymentLog.redact` during deployment) — both are replaced with `***` in the example text before sending; a broken `${{...}}` reference
  only causes the redaction of that database to be skipped (it does not fail the notification). `EVENT_TOGGLE`/`CreateNotificationDto`/`notification.entity.ts` add
  `onAppError` following the pattern of `onDeploymentStarted`.
- **New toggles must exist at ALL points** (lesson from `onDnsIssue`/`onServerDown`/`onHttpDown`): the `on_*` entity column, `NotificationEvent` + `EVENT_TOGGLE` (exported), `NotificationDto`/`toDto()`,
  `CreateNotificationDto`, `CreateNotificationService.execute()` (`repo.create`), the web entity, the zod schema + `formData` in `notification.actions.ts`, `EVENT_LABEL` in `notifications-card.tsx`, and the docs.
  `notification-toggles.spec.ts` reads the `on_*` columns from TypeORM metadata and checks that each toggle exists in the validation DTO, in `EVENT_TOGGLE`, and is actually stored and returned by `create` — a toggle that is only added to the entity fails there. `serverDown` (`on_server_down`) and `httpDown` (`on_http_down`) and `resourceAlert` (`on_resource_alert`) default to **`true`**: both are opt-in per server/application, so they are not noisy for those who do not use them.

## Compose (docker-compose stacks)

- `src/modules/compose/` — entity `ComposeApp` (`compose_apps`, under `Project`; `slug` unique, `git_url`/`git_branch`/`git_credential_id`, `compose_path`, `env`,
  `status` idle→deploying→running|stopped|error, `logs` = output of the last action, `deployed_at`). It does not use `Application`/`Deployment`: one stack = N containers,
  so `containerNameFor`, ports, domains, rollback, and deployment history do not apply. Flow `create/list/get/update/delete-compose-app`, `deploy/stop/start-compose-app` (202 + poll `GET /compose-apps/:id`,
  which also returns the stack's containers via the `com.docker.compose.project` label, plus `projectRole` so the web hides actions from viewers).
- Compose is **not in the Engine API** (it is a client-side tool). `compose-runner.service.ts` runs `docker compose` in a one-shot helper container `docker:29-cli`
  (docker CLI + compose plugin + git) with the **host daemon socket** (`DockerService.hostDockerSocket` = `PROXY_DOCKER_SOCKET`, also used by Traefik) and a checkout volume
  `aoox_compose_<slug>`. That volume is mounted **at its own mountpoint path** (`inspectVolume().Mountpoint`, `/var/lib/docker/volumes/<name>/_data`) so that relative paths resolved by compose inside the helper (bind mount `./nginx.conf`, build context) also exist on the daemon side — with a plain `/work` mount, bind mounts fail (`not a directory`).
  Without `--project-directory`: relative paths are computed from the folder of the compose file. `build:` is fully supported (the CLI uses BuildKit — the opposite of the nixpacks limitation).
- Deploy: `git clone --depth 1` (credentials only in the helper; tokens & DB passwords are redacted from the log), `.aoox.env` (the output of `EnvResolverService`, with project/database references as for apps)
  uploaded via `PUT /containers/{id}/archive` before start and used with `--env-file` → source for `${VAR}` interpolation (it is not automatically injected into the containers). Then `config --quiet` + `up -d --build --remove-orphans`.
  The compose project name is `aoox-<slug>` (its own group in Docker Desktop, **not** `aoox` — the `com.docker.compose.project` label is set by the CLI and cannot be both).
  Helper output is streamed (`followContainerLogs`) into the `logs` column about every ~1 second. Deploy failure → `deploymentFailure` notification. `delete` = `down --volumes --remove-orphans` + delete the checkout volume, synchronously.
- **Source** `ComposeApp.source`: `git` (clone the repo) or `template` (`compose_content` in the DB, `git_url` null, `compose_path` always `docker-compose.yml` because `tarFiles` is flat);
  the runner uploads the compose file to WORK and then `mv`s it into the newly created SRC — no git. `composeContent` can be edited via `PATCH` (only for `template`).
- **Stack domains** (`service_domains` jsonb: `{service, port, host, https}`): during deploy the runner writes the override **`docker-compose.aoox.yml`** (JSON = valid YAML; `renderOverride`,
  pure & unit-tested) next to the compose file, containing the Traefik labels from `ProxyService.labelsFor` (router `<slug>-<service>-<port>`) + the `aoox` **and `default`** networks
  (declaring `networks:` on a service removes the implicit default network — without `default`, the services of the stack cannot find each other), then `-f compose -f override`.
  Stop/start/down use the override that exists in the volume (`[ -f ... ] && OVERRIDE=`), not the row, so that they match the running stack. Without domains/ports there is no override
  (the old override disappears because deploy always does `rm -rf SRC` first, so stop/start do not use a configuration that has been removed — tested: the port is released).
- **Host ports** (`service_ports` jsonb `{service, port, hostPort}`, `ServicePortDto`): access by IP without a domain/proxy. `renderOverride(domains, ports, …)` adds
  `ports: ["<hostPort>:<port>"]` to the service (without `networks` if there are only ports); compose **appends** the override `ports` to the `ports` of the compose file (tested with `config`), so existing bindings in the file remain.
  `ComposeService.assertHostPortsFree()` (used by `update-compose-app` & `create-from-template`) rejects with 400 before deploy: duplicates within the list, then delegates to
  `HostPortService` (`src/modules/host-port/`, see the Application & Deploy section) for `applications.host_port`, `managed_databases.host_port`, the `service_ports` of other stacks, and the ports currently bound by **any** container on the local daemon (`listContainers({status:['running']})`, `ContainerSummary.Ports[].PublicPort`; the containers of the stack's own compose project are excluded because they are recreated; IPv4/IPv6 entries are deduplicated) — without this, `up` fails *after* the old containers have been recreated, and the service goes down. The check runs at save time, not deploy time — a port taken by another process in between still fails in `up`.
  `create-from-template` accepts `servicePorts`
  (validated against `template.services`, as with domains). Project export/import carries `servicePorts` (optional in old files; `freeHostPort` now also scans the `service_ports` of other stacks; ports already in use are skipped + a warning).
- **History** (`compose-deployment.entity.ts`, table `compose_deployments`: FK cascade to the stack, `action` deploy|stop|start|down, `trigger` manual|webhook, `status` running→success|failed,
  `logs`, `error_message`, `commit_sha`, `started_at`/`finished_at`): every run of the helper = one row. There is no image/rollback like application `Deployment` — one stack = N containers,
  so what is stored is the **action** history. Runner: `queue(app, action, options)` creates the row first (the caller gets the id to poll) and then calls `start()`; live logs are written **only** to the row
  (`ComposeApp.logs` is filled once at the end, so that a chatty build does not duplicate writes), and `get-compose-app` returns the log of a row still `running` + `deploymentId`.
  After each run, `prune` keeps the `COMPOSE_RUN_KEEP` (20) most recent rows. Flow `list-compose-deployments` (`GET /compose-apps/:id/deployments`, without logs) and `get-compose-deployment`
  (`GET /compose-deployments/:id`, with logs; access through the project of its stack).
- **Webhook** (`ComposeApp.webhookToken` unique `select:false` + `webhookSecretEncrypted`, migration `ComposeHistoryAndWebhook` backfills a token for existing stacks): public
  `POST /webhooks/compose/:token` (`webhook-deploy-compose/`, no JwtAuthGuard, throttle 30/minute, `timingSafeEqual`) — the same contract as applications and reusing
  `webhook-signature.ts` (GitHub `X-Hub-Signature-256` / GitLab `X-Gitlab-Token` → wrong = **401**). A push to `refs/heads/<gitBranch>` → `runner.queue(..., {trigger:'webhook', commitSha})`;
  other branches / non-push events / **template stacks** (the compose file is in the DB, there is no repo) → 200 `ignored`; a run already in progress → 200 `busy` (not queued). Flow `compose-webhook/`
  (`GET /compose-apps/:id/webhook`, `POST …/webhook/regenerate`, `PUT/DELETE …/webhook/secret`) returns `{url, token, branch, secret, supported}`.
- **Metrics & container down**: stack containers still have no `aoox.component` label (that label belongs to the compose CLI), so both recognize a stack by the **compose project name**
  `aoox-<slug>` (`COMPOSE_PROJECT_PREFIX`; the dist stack itself is named `aoox` without a hyphen, so it is not included). `MonitoringService.sampleAll` performs **two** listContainers
  (multiple `label` values in one filter are ANDed) and adds the compose containers that do not yet have `aoox.component`; `GET /compose-apps/:id/metrics` (`compose-metrics/`) reads the sampler cache
  per service + total. `DockerEventsService` now keeps **two** `GET /events` streams (one per label) with separate backoffs; events from the compose stream whose
  container also has `aoox.component` are discarded (our containers carry both labels via `composeLabels()`). `compose-down-notifier.service.ts` (in the compose module — ComposeModule already imports
  ApplicationModule, the other direction would be circular) sends `containerDown` "Stack service went down: <stack> (<service>)"; it is **silent** while `runner.isActive(app.id)` (a deploy recreates all
  containers and `up -d --build` can take minutes, a 5-second grace period is not enough), when the row is not `running`, when the container no longer exists, or on a clean restart (exit 0). Cooldown 10 minutes/container.
  Tested for real (a 2-service stack from a local git daemon): manual deploy + via signed webhook (wrong signature 401, other branch ignored, second push busy), **zero** notifications during
  deploy, `docker kill` of one service → **exactly one** notification, killing an application container still gives one notification (not a duplicate from the second stream).
- Limitations: domains/Traefik = `traefik.*` labels in the compose file itself + joining the external `aoox` network. A compose file from a repo may request `privileged`/host mounts — owner/admin already have a host shell, so this is not an escalation.
- **Metric retention for stacks** (`renderOverride` in `compose-runner.service.ts`): every service whose override already touches it for another reason (domain, port, mount,
  or resource limit) is also stamped with `aoox.component: compose` + `aoox.compose: <stack id>` — enough for `MetricRetentionService.ownersByContainer()` (which purely reads container labels, with no DB query) to recognize those containers and sum them into one rollup row per stack, **without** MonitoringModule needing to import ComposeModule (this shortcut
  avoids the MonitoringModule → ComposeModule → ApplicationModule → MonitoringModule cycle that was previously the reason this feature was "not yet" available). **Deliberate limitation**:
  `renderOverride` only ever knows the service names from the four lists that come from the DB (`serviceDomains`/`servicePorts`/mounts/`serviceResources`) — never from the compose file
  itself (which only exists inside the helper container during deploy, not on the API side) — so a service that has none of the four (e.g. a plain internal database service without mounts) never gets the label and stays live-only (1h) as before; a stack whose services are all "bare" is the same. `GET /compose-apps/:id/metrics?range=`
  (`compose-metrics.controller.ts`, local DTO `ComposeMetricsQueryDto` — not importing the application one, so that no cross-module dependency is added) now has the same contract
  as applications/databases: `1h` stays live per service (`services[]` + `total`) plus a combined `history` via `aggregateMetrics()`, the same one used by swarm tasks; `24h`/`7d`/`30d` read
  `MetricRetentionService.history('compose', ...)` — `services[]` is empty (no per-service history is stored, only the stack total) but `history`/`total` are filled.
  The `service` names in mounts and `serviceResources` (as well as the existing `serviceDomains`/`servicePorts`) are **not validated** against the services that actually exist in the compose file
  (unlike `create-from-template`, which checks against `template.services`) — a mistyped service name produces an override that targets a non-existent service; `docker compose config`
  accepts it without complaint, and the mount/limit silently never applies, rather than raising an error.

## Monitoring

- `src/modules/monitoring/` — `monitoring.service.ts` samples all running containers labeled `aoox.component` every 15 seconds (`SAMPLE_INTERVAL_MS`)
  and keeps in-memory history of 240 points/container (~1 hour; lost on restart, single instance). Each sample = **two** `GET /containers/{id}/stats?stream=false`
  calls 1 second apart, because in that mode the daemon fills `precpu_stats` with the same snapshot (CPU % is always 0 from a single call). The formula is in `container-metrics.ts`
  (`computeMetrics`, pure & unit-tested): CPU % = Δtotal/Δsystem × online_cpus × 100; memory = `usage − inactive_file` (cgroup v2) / `− cache` (v1), as `docker stats` does;
  `memoryLimitBytes` = host RAM when the container has no limit. Per-container disk I/O is not available on Docker Desktop (`io_service_bytes_recursive` is empty) → not shown.
- Endpoints: `GET /applications/:id/metrics` (`application-metrics/`) & `GET /databases/:id/metrics` (`database-metrics/`) only read the sampler cache (`{current, history}`,
  `current: null` when there is no sample yet / after a stop); `GET /monitoring/host` (`host-overview/`, owner/admin) = `GET /info` + `GET /system/df` — the visible disk is only
  Docker usage (images/volumes/containers/build cache), not the host filesystem.
- **Metric retention** (`metric-sample.entity.ts` `metric_samples`: `owner_kind` application|database + `owner_id` + `resolution` minute|hour + `at`, unique; cpu/mem/limit/net + `containers`):
  `metric-retention.service.ts` — `@Cron('* * * * *')` takes the 15-second points that have **not yet been written** per container (cursor `written`), groups them per owner via the labels
  `aoox.application`/`.database` (swarm tasks of one app are summed), then `averageBucket()` (pure, unit-tested: averages over **time**, keeps the sum across containers —
  divided by the number of points *per container*) → one `minute` row (upsert, so duplicate ticks do not duplicate). `@Cron('2 * * * *')` averages the just-finished hour into an `hour` row
  (AVG cpu/mem, MAX limit/net/containers). `@Cron('7 3 * * *')` prunes: minute rows older than 48 hours, hour rows older than `METRICS_RETENTION_DAYS` (default 30).
  Metric endpoints accept `?range=1h|24h|7d|30d` (`MetricsQueryDto`, used by apps & databases): `1h` = the in-memory sampler as before (15 s), `24h` = minute rows, `7d`/`30d` = hour rows;
  the response includes `range`. Deleting an application → `retention.forget('application', id)` (this table has no FK so history is not removed when other containers/rows are cleaned up).
  History now survives API restarts. Tested: minute rows appear every minute for an app and 3 DBs, `?range=24h` returns minute rows, hour rollup/prune through the application context
  (10/20/30 → 20). Compose stack metrics now also take part in retention (see the Compose → "Metric retention for stacks" section) for services that have a domain/port/mount/resource limit.
  Not yet: retention of host metrics (live 5 minutes only).
- **Live host** (`host-metrics.service.ts` + `host-live/` → `GET /monitoring/host/live`, owner/admin, throttle 120/minute): in-process sampler every **2 seconds** from Node `os`
  (`os.cpus()` delta idle/total = CPU % across all cores, `os.totalmem()-freemem()` = RAM, `loadavg()[0]`; inside a Docker container `/proc/stat` & `/proc/meminfo` belong to the host,
  so the numbers are the host's, with no Docker call per tick), 150 points (5 minutes) of in-memory history. `host-metrics.ts` is pure & unit-tested. The response also carries `managed`
  (`MonitoringService.managedTotals()` — the CPU%/RAM sum of aoox containers from the 15-second sampler) and `cpus`. **Storage** = `fs.statfsSync(STORAGE_PATH ?? '/')`
  (`readDisk`; in a container `/` = overlayfs, which reports the host disk behind `/var/lib/docker`; Windows dev = the cwd drive; on failure → 0). Polled by the web every 2 seconds; no Socket.IO.
- **Resource limits**: `Application` & `ManagedDatabase` have `cpu_millicores` and `memory_mb` (nullable = no limit). `docker/resource-limits.ts` `resourceLimits()` (pure, unit-tested)
  → `HostConfig.NanoCpus` + `Memory` + `MemorySwap` (= `Memory`, so a hard limit with no swap), used when creating containers (runner `replaceContainer`, DB `provision`) and by
  `DockerEngineClient.updateContainer` (`POST /containers/{id}/update`) to apply **immediately without restart** from `update-application` / `PATCH /databases/:id` (`update-database/`).
  Docker note: an update with value 0 = "unchanged", so **removing** a limit (`limitsRemoved()`) forces a recreate — apps via `applyRuntimeConfig`, DBs via a re-`provision`
  (brief restart; data stays in the volume). The `memoryLimitBytes` metric follows the limit automatically. Previews inherit their app's limits via `replaceContainer` (not a gap — already handled).
  **Compose limits**: `ComposeApp.serviceResources` (jsonb `[{service, cpuMillicores, memoryMb}]` — per service, not one number for the whole stack, just like
  `serviceDomains`/`servicePorts`) is rendered into the override as `deploy.resources.limits.{cpus,memory}` (`cpus` as a decimal string of cores, `memory` as a `<N>M` string). **Honored by a plain
  `docker compose up` without swarm** since Compose v2 — verified directly against the runner's own image (`docker:29-cli`): a container with `deploy.resources.limits.memory: 64M`
  shows `HostConfig.Memory` 67108864 in `docker inspect`, not 0. There is no direct update path like `POST /containers/{id}/update` for apps/DBs — compose always redeploys from the override, so changing a limit = applies on the next deploy.
- **Resource usage per project** (`src/modules/project/project-resource-usage/`, inside `ProjectModule` — this module imports `DockerModule`+`MonitoringModule` directly,
  not the other way around, so there is no cycle): `GET /projects/:id/resource-usage` (detail page, live only) and a new `resourceUsage` field on each item of `GET /projects`
  (overview cards, `ProjectResourceUsageSummary | null`) — both show CPU%/memory/network only, **without** storage (deliberately skipped: `docker system df -v` per volume
  is too heavy to call live per card/per project, unlike `MaintenanceService.usage()`, which is synchronous and called once per Settings page, not polled).
  Data source = the existing in-memory cache of `MonitoringService` (15-second sampler) — **no new Docker call per request**. `ProjectResourceUsageService.containerProjectMap()`
  groups the sampled containers by project: application/database containers carry the `aoox.project` label directly (set by `deployment-runner.service.ts`/
  `managed-database.service.ts` on create), so no DB query is needed; compose stacks do **not** have a project label (the `compose-runner.service.ts` override only sets
  `aoox.component`/`aoox.compose`) — and "bare" stacks without any override at all (no domain/port/mount/limit, recognized via `com.docker.compose.project` like
  `MonitoringService.sampleAll()`) — both are resolved with **one** `compose_apps` query (id/slug → project_id) for **all** projects at once (not N+1 per project/per card).
  `buildProjectUsage()` (`project-resource-usage.util.ts`, pure & unit-tested) reuses `aggregateMetrics()` (the same pattern as summing swarm tasks / compose services) to add up all containers of a project into one series, then converts the summed cumulative network counters into **rates** of bytes/second from two consecutive sampler ticks —
  cumulative numbers across containers that started at different times mean nothing unless converted to a rate; containers that drop out of the
  sum in the middle (redeploy/stop) are clamped to 0, not reported as negative. **Live only, no stored history** (`24h`/`7d`/`30d` like the other metric endpoints) —
  adding per-project retention is separate work (it needs a new rollup schema, not just reading the cache) and has not been requested yet.

## Remote server monitoring

- **Sampler** (`MonitoringService`, monitoring module — now imports `ServerModule`): in addition to the local 15-second sweep, every **30 seconds** (`REMOTE_SAMPLE_INTERVAL_MS`; two `stats`
  per container over SSH is too heavy for 15 seconds) `sampleRemote()` reads the `servers` list and **starts one cycle per server without waiting for the others**: `listContainers`
  (`aoox.component`, running) via `RemoteDockerService.forServer(id)` (a cached SSH session — no new connection per tick), then `sampleContainer` with a parallelism of 3 per server.
  A cycle is capped at `REMOTE_CYCLE_TIMEOUT_MS` 25 seconds (`server/with-timeout.ts`) and cycles **do not pile up** (`remoteRunning`), so one slow or dead server only holds back its own cycle;
  the local sweep is untouched (tested for real: `docker pause` on a remote server → the local database metrics keep increasing every 15 seconds). Results are stored in a **separate** map
  (`remoteHistory` + `remoteInfo` = label & serverId per container): the local sweep removes all ids it did not see, and `managedTotals()`/the live host must not sum containers of other machines.
  Docker container ids are random 256-bit values, so they do not collide between daemons. `metricsFor`/`sampledContainers` read both, so the application metrics endpoint
  (`findContainerByName` on the remote daemon + `metricsFor`) and retention work without changes on the consumer side. `remoteContainers()` gives the labels captured by the sampler to
  `MetricRetentionService.ownersByContainer()` (owner from `aoox.application/.database/.compose`) and `ProjectResourceUsageService.containerProjectMap()` (`aoox.project`) — both
  **without any SSH call of their own**, so the project resource cards and the 24h/7d/30d history include remote applications. Failure to reach a server → its readings are cleared (stale numbers are worse
  than nothing); missing containers are dropped; a deleted server is dropped on the next tick (`forgetServer`).
- **`die` events** (`server/remote-events.service.ts`, exported by `ServerModule`): one `GET /events` stream (`type=container`, `event=die`, `label=aoox.component`) per server through the same tunnel,
  reconnects with its own backoff (1 s → 60 s, back to 1 s if it stayed alive for more than 30 s), `reconcile()` every 30 seconds follows the `servers` table (starts for new servers, stops for deleted ones), and **restarts immediately** when `RemoteDockerService.forget(id)` is called (`onForget` — credentials changed / test-server). A `generation` counter makes callbacks of replaced streams ignored, so there are never duplicate connections. `ContainerDownNotifierService` also subscribes (`handle(event, serverId)`): the same rules (5-second grace, 10-minute cooldown per container,
  skipped when the container was already replaced by a deploy / row `stopped` / exit 0), but re-checked through that server's daemon; an application that now lives on another server or a deleted server is
  ignored; databases are never remote; the message names the server (`Application went down: X on server NAME`, field `Server`, `data.server`). A server that is itself down cannot be re-checked —
  that is the job of the health check below.
- **Server health** (`server/server-health.service.ts`, `@Cron` every minute): parallel probe per server (`listContainers` through the tunnel, timeout 12 s) — the answer proves that the server,
  SSH, and Docker are alive, and its count = "monitored containers". The result is written to the `servers` row (`health_status` unknown|up|down, `health_checked_at`, `health_changed_at` = since when,
  `health_error`, `monitored_containers`; migration `ServerHealthAndMonitorToggles`) and **that is what the web reads** (`ServerDto.health`, without calling the server when the page opens).
  `down` requires **2 consecutive failures** (`DOWN_AFTER_FAILURES`); a `serverDown` notification (toggle `on_server_down`, **default `true`**: only relevant to those who add servers) is sent once,
  reminded at most 1×/hour while still down, and **one recovery message** ("Server reachable again", level `success`, `Down for`) goes through the same event & toggle (distinguished by level and
  `data.event` `server.down`/`server.recovered`; the simplest option and consistent with `dnsIssue`). The first successful check only marks `up` (nothing is announced). In-memory state
  (`failures`, `lastDownNotice`) is cleaned up for servers that no longer exist; **an API restart while a server is already down** does not resend (the status is read from the DB, the next reminder is 1 hour later).
- **Deliberate limits**: `disk-watcher`, `certificate-watcher`, the disk retention/`disk` card, and DNS stay local-host only; compose/database/jobs stay host only. Time to detect a dead server ≈ 2 minutes
  (checked every minute, two failures). The `die` stream and the sampler for a new server start at most 30 seconds after the server is added.
- Tested for real with an isolated simulated server (`docker:dind` + sshd, image via `docker save | load`): CPU metric ~99% moves for an application on the remote server (live + 24h rollup) and appears in the project resource usage; container stopped → exactly one "on server …" notification; `docker pause` of the server → down after two checks + one notification, unpause → one recovery notification; an unreachable server (blackhole IP) does not hold up the others; deleting a server stops its stream.

## Application HTTP monitor

- `src/modules/http-monitor/` — **optional** HTTP checks per application (a container that is alive but returning 5xx/stuck is not caught by `container-down`). Entity `HttpMonitor` (`http_monitors`, one per
  application, FK cascade): `enabled`, `path` (default `/`), `interval_minutes` 1–60 (5), `timeout_seconds` 1–30 (10), `expected_codes` (`200-399`; a list of codes/ranges), `failure_threshold` 1–10 (2),
  `use_internal`, **plus live state** (`status` unknown|up|down, `consecutive_failures`, `status_since`, `last_*`, `last_alert_at`) — the state lives in that row so that **an API restart does not forget an ongoing outage and does not announce a healthy app as down** (tested for real: restart in the middle of an outage → no new alert, recovery is still sent). `HttpCheck` (`http_checks`, results only:
  time, ok, code, latency, error ≤ 200 chars — **the response body is never stored**) and `HttpIncident` (`http_incidents`: starts at the **first** failed check in a streak, ends when healthy; an open row
  = outage in progress). Migration `HttpMonitors` (+ column `on_http_down`).
- **SSRF — only paths that come from the user**. The host is **never** taken from the request (DTO `forbidNonWhitelisted`: `host`/`url` = 400): `resolveTarget()` derives it from the application itself —
  the first domain (public URL through the proxy, the proxy port is used when it is not 80/443; `useInternal` skips this), then an app on a remote server → `Server.host:hostPort`, a local app inside Docker
  (`/.dockerenv`, container mode) → `http://aoox-app-<appName>:<containerPort>` on the `aoox` network, otherwise `127.0.0.1:hostPort`; with none of these → "no reachable address" (a configuration problem:
  shown in the UI, **never** alerted). `validateMonitorPath()` (`http-probe.ts`, pure, heavily unit-tested): a single leading `/` (not `//` or an absolute URL), ≤ 200 characters, no control characters/spaces/`\`/`#`, no
  `..` segments (including percent-encoded ones); then the final URL is checked to have the same `origin` as the base. `probe()`: `fetch` with `redirect: 'manual'` and a hard timeout (`AbortSignal.timeout`), at most 3 redirects
  and **only to the same hostname + port** (`sameService`; redirects to another host/port are not followed — the 3xx itself is evaluated; tested: `Location: http://169.254.169.254/…` → 302 recorded in 18 ms, not followed),
  the body is read up to 64 KB and then discarded, errors are shortened (`ECONNREFUSED`, `timeout after 5s`). What is tested is **from the panel machine**: this does not prove reachability from the public internet,
  and with a public domain it can hit hairpin NAT — the UI shows the target used along with that note.
- **Scheduler**: `@Cron('* * * * *')` `tick()` selects only monitors that are **due** (`isDue`, slack 10 s; the tick time is used as `lastCheckedAt` so that the 1-minute interval does not drift), instead of
  one timer per app; a pool of `CHECK_CONCURRENCY` 5; `inFlight` prevents overlap; a tick that has not finished is not stacked. Only `running` apps are checked; stopped/error apps are **not treated as down**
  (state is reset to `unknown` and open incidents are closed without a recovery message). **Deploys**: skipped while there is an active deployment (`queued/building/pushing/starting`) and for `POST_DEPLOY_GRACE_MS` 60 s after the deployment finishes; a failure streak that crosses a deploy is reset (a `down` outage is left as is). Retention `@Cron('17 * * * *')`: results older than 7 days and more than 10,080 rows per monitor (1/minute/week) are deleted,
  incidents beyond 50 per monitor are trimmed.
- **State & alerts** (`monitor-state.ts` `nextState`, pure): `down` after `failure_threshold` consecutive failures, healthy resets immediately; `unknown→up` is silent. Event `httpDown` (toggle `on_http_down`,
  **default `true`** — the monitor itself is opt-in per application): one `http.down` message when the threshold is reached, a reminder at most 1×/6 hours while still down (`last_alert_at` is persisted), one
  `http.recovered` message (level `success`, `Down for`) when healthy — same event & toggle (the simplest option, consistent with `serverDown`). The message only contains the app name, project, target (URL without credentials),
  a short code/error, and a link to the application.
- **Statistics** (`view()`): uptime over 24 hours/7 days = healthy checks / total from `http_checks`; average and p95 latency from **healthy** checks over 24 hours; `series` for 24 hours in ≤ 120 buckets (average latency + number of failures
  per bucket) for the sparkline; the last 10 incidents with their durations.
- **API** (`/applications/:id/monitor`): `GET` (config, target, status, statistics, series, incidents; all members), `PUT` (developer+, viewer 403 via the project write check), `POST …/check` (throttle
  10/minute, "check now": requires a saved config and a `running` app; the result is recorded and can alert). Project export/import carries the **config** (`httpMonitor`, without state/history; optional in old files;
  import validates each value like a request and falls back to defaults with a warning). Deleting an application → FK cascade removes the monitor, results, and incidents.
- Not yet: a public status page (needs a privacy decision; proposal: opt-in per project, unguessable token, only name + status), targets based on swarm services without a domain/host port, a monitor status badge on
  application cards on the project page, testing from multiple locations.

## Resource threshold alerts

- `src/modules/resource-alert/` — optional CPU / memory rules per application **and** managed database. Entity `ResourceAlertRule` (`resource_alert_rules`, migration `ResourceAlerts`): one row per owner+metric (`application_id` or `database_id`, exactly one, FK cascade, CHECK + two partial unique indexes), `metric` cpu|memory, `enabled` (default false), `threshold_percent` (90), `duration_minutes` (5), plus live state (`status` ok|pending|alerting, `status_since`, `last_value`, `last_evaluated_at`, `last_alert_at`). Config and state share the row so an API restart neither re-alerts nor forgets a breach (the HTTP monitor idea). No row = defaults, disabled.
- **Data source**: the stored `metric_samples` **minute** rows (MetricRetentionService rollup), not the in-memory sampler and no Docker calls: the rollup already maps containers to owners (swarm tasks summed, remote servers via the sampler's labels), so applications, databases and remote-server applications are treated the same. Watcher `@Cron('30 * * * * *')` (after the `:00` rollup), one rules query + one samples query + two deployment queries per tick. Values: CPU = `cpuPercent` as charted (percent of one core, may exceed 100; not normalized to `cpuMillicores`), memory = `memoryBytes / memoryLimitBytes` (the limit is host RAM when none is set; threshold capped at 100).
- Pure logic in `alert-evaluation.ts` (unit-tested): `evaluateBreach` needs the last `durationMinutes` minute rows, **all** above the threshold (one missing minute is tolerated for windows of 3+; a null CPU, too few rows or a stale newest row never count as breaching — a gap is never an alert; rows before the last finished deployment are ignored), and `nextAlertState`: ok → pending (silent) → alerting (one `alert`), reminder every `REMINDER_MS` (6 h) while it persists, `recovered` once when the value no longer breaches (a pending streak drops silently). So the alert arrives on the evaluation after the window is first fully breached (about duration + 1 minute); the real test showed exactly one alert, none after an API restart, one recovered.
- **Skips**: owner not `running` → state reset silently (no recovered); application with an active deployment → an `alerting` rule is left alone, `pending` is reset. Changing a rule (enabled/threshold/duration) resets its state silently.
- **API**: `GET`/`PUT /applications/:id/alerts` and `/databases/:id/alerts` (`resource-alerts.controller.ts`; access through `findOwnedOrFail`, PUT = write so viewers get 403, audit-logged automatically). `PUT {cpu?: {enabled?, thresholdPercent?, durationMinutes?}, memory?: {...}}`, thresholds 1–1000 (memory ≤ 100 → 400), duration 1–120 minutes; the view returns `{cpu, memory, limits}` with each rule's `state`. Notification event `resourceAlert` / toggle `on_resource_alert` (default true): see the Notifications and inbox sections for the `params` contract.
- Project export/import: `applications[].resourceAlerts` and `databases[].resourceAlerts` (`{cpu, memory}` config only; optional in old files; `importConfig` falls back to defaults with a warning on out-of-range values).
- **Not done**: a disk alert for named volumes (sizes only come from `system/df`, which is too heavy to call per tick); compose stacks have no rules.

## Managed database

- `src/modules/managed-database/` — entity `ManagedDatabase` (under `Project`; engine `postgres`|`mysql`|`mariadb`|`redis`|`valkey`|`mongodb`, `variant`
  (only for `postgres`: `pgvector`|`postgis`|`timescaledb`|null), `image_tag`, `db_slug` unique, `password_encrypted` `select: false`, optional `host_port`,
  status `creating`→`running`|`stopped`|`error`).
- `engines.ts` = a recipe per engine following the official Docker Hub image env (`POSTGRES_*`, `MYSQL_*`, `MARIADB_*`, redis/valkey `--requirepass`), port, data path, and URL format.
  **Valkey** = drop-in Redis (Linux Foundation fork): the recipe is identical to redis (`valkey-server --requirepass ... --appendonly yes`, url `redis://`) — its image has been verified to contain **both** the `valkey-cli` **and** `redis-cli` binaries (symlink), so all code that shells out to `redis-cli` (backup, data browser) works without modification; only each `if (engine === 'redis')` needs to be extended to `|| engine === 'valkey'` (all in `data-browser/database-query.service.ts`
  and `schemas.service.ts`; this is deliberately done with literal checks per location rather than a central helper, so that the `Record<DatabaseEngine, ...>` in `engines.ts`/`backup-recipes.ts`
  still forces compiler exhaustiveness when another engine is added later). **PostgreSQL variants** (`POSTGRES_VARIANTS` in `engines.ts`, type `PostgresVariant`):
  protocol/env/URL/backup (`pg_dump`/`pg_dumpall`) are exactly the same as plain postgres — only `imageNameFor(engine, variant)`/`defaultTagFor(engine, variant)`
  differ (used in `managed-database.service.ts` provision, `database-backup.service.ts`, and the data browser `spawn()`, all three of which previously hardcoded `ENGINES[engine].image` directly). Docker Hub tags verified for real: `pgvector/pgvector:pg16`, `postgis/postgis:16-3.4`, `timescale/timescaledb:latest-pg16`.
  Extensions are enabled once via `ManagedDatabaseService.activateVariantExtension()` (`CREATE EXTENSION IF NOT EXISTS ...`, in a one-shot helper container
  with a `pg_isready` loop first — `provision()` itself does not wait for Postgres to be ready, it only waits for the container to start) after the container starts; failure is only logged as a
  warning and does not fail provisioning (the database can still be used without the extension). **Tested for real**: pgvector (extension + `vector` column + insert +
  full `pg_dump`/`psql` restore, data back after a wipe), PostGIS & TimescaleDB (their official images already enable the extension at init —
  the `CREATE EXTENSION IF NOT EXISTS` call here is an idempotent no-op with a NOTICE, not an error; TimescaleDB was also tested with `create_hypertable()` + insert + select),
  Valkey (full cycle of `redis-cli --rdb` backup → wipe volume → restore through the same AOF manifest as Redis → data back). Changing the engine/variant after
  creation is **not supported** from the dashboard (delete + recreate, optionally restoring a backup into the new one).
  **MongoDB** is deliberately its own `engine: 'mongodb'` (not a variant) — its protocol/backup tooling is entirely different from SQL. Mongo creates databases **lazily** (no `CREATE DATABASE` — a new database "exists" once it has content), so `ManagedDatabaseService.initMongoDatabase()` (called in `provision()` after start, same pattern as `activateVariantExtension`: one-shot helper container, a `mongosh --eval "db.adminCommand('ping')"` loop waiting for the server to be ready, credentials passed via `Env` rather than interpolated into the script) writes one placeholder document to the `_aoox_init` collection so the main database shows up in `schemas/` right away without waiting for the first write from an application; failure is only logged as a warning. `SchemasService.engineOf()` has a real `'mongodb'` branch (instead of being rejected like redis/valkey) — `mongoDatabaseNames`/`mongoCreateDatabase`/`mongoDropDatabase` (`DatabaseQueryService`) use `db.adminCommand({listDatabases:1,...})`/
  `insertOne`/`dropDatabase`. `BACKUP_RECIPES.mongodb` uses `mongodump`/`mongorestore --archive --gzip` (mongodump's built-in gzip, no `gzipped()` wrapper);
  `restoreAll` rejects `admin`/`local`/`config` via `--nsExclude` so that a full-server restore never overwrites the root user's credentials. Tested for real: provision
  → placeholder init → `mongoFind` → backup → wipe (`dropDatabase`) → restore → data back, all through the real HTTP API (not just manual `docker exec`).
- `managed-database.service.ts`: container `aoox-db-<slug>` on the `aoox` network + volume `aoox_db_<slug>`, compose labels; provisioning is **detached**
  (`provisionInBackground`, the image pull can take a while) → status `running`/`error`. `connection()` gives the internal URL (host = container name) and the external one (when a host port is published).
- Flow: `create-database` (202), `list-databases?projectId`, `get-database` (+ container state), `database-credentials` (password & URL — separate so that lists do not carry secrets),
  `delete-database?purge=`, `start/stop-database`. Applications use a DB by copying its internal URL into their env (there is no automatic injection yet).
- **Data browser** (`data-browser/`, stage 1 "simple phpMyAdmin"): `GET /databases/:id/tables`, `GET /databases/:id/tables/:table/rows?schema&limit&offset&orderBy&dir`,
  `POST /databases/:id/query {sql}` (throttle 60/minute). `database-query.service.ts` runs `psql --csv -P null='\N'` / `mysql --batch` / `redis-cli --json`
  in a one-shot container of the engine image (the backup pattern: no DB driver in the API, credentials via env); stdout/stderr are written to a file and read through the archive API
  (the container log adds timestamps and breaks multi-line CSV), and the container is killed after 30 s. Parsers in `query-output.ts` (`parsePsqlCsv` RFC 4180 — NULL = unquoted `\N`,
  `parseMysqlBatch` — NULL = the word `NULL`; both pure & unit-tested). Guard `query-guard.ts`: a single statement (`;` outside quotes → 400), table/column identifiers validated
  + quoted, a SELECT without LIMIT is wrapped in `LIMIT 501` (`MAX_ROWS` 500 + a `truncated` flag), engine timeout 15 s (`PGOPTIONS -c statement_timeout` / `max_execution_time` /
  MariaDB `max_statement_time`). **Write access**: members are read-only — a non-read statement is rejected with 403 *and* the engine session is made read-only (`default_transaction_read_only=on` /
  `SET SESSION TRANSACTION READ ONLY`; tested: a `WITH … DELETE` from a member fails in the engine); owner/admin may write (INSERT/UPDATE/DELETE/DDL) — the psql command tag (`UPDATE 3`,
  `CREATE TABLE`) is returned as `message`. Redis: `tables` = keys from `SCAN 0 COUNT 500`, `rows` = the contents of a key per type (GET/HGETALL/LRANGE/SMEMBERS/ZRANGE),
  `query` = one command (`tokenize` respects quotes; whitelist `REDIS_READ_COMMANDS` for members; an `error:"…"` from redis-cli → 400). The `mariadb` image only has the `mariadb` CLI
  (no `mysql` alias) — `sql()` picks the CLI per engine.
- **Data browser for MongoDB**: `mongo()` (private helper) runs `mongosh --eval` in a one-shot container and wraps **every** expression in
  `EJSON.stringify((expr), {relaxed: true})` centrally before eval — mongosh's default output for non-string values is shell-inspect format
  (`[ 'a', 'b' ]`), not JSON, so without this wrapping `JSON.parse` on the API side fails for `listTables`/`mongoDatabaseNames`/`mongoCreateDatabase`/
  `mongoDropDatabase` (found by a real Docker run, not by unit tests — `mongoFind` happened to pass because it already wrapped its own output before
  this change). `listTables` = `db.getCollectionNames()`, `tableRows`/`exportTableCsv` go through `mongoFind()` + `mongoDocsToRows()` (pure & unit-tested:
  union of keys across the whole batch in first-seen order, `_id` pinned first, non-string values `JSON.stringify`'d). `columns()`/`updateRow()`/`deleteRow()`/SQL export
  & import all reject with 400 (schemaless, not supported). The query box only accepts `<collection>.find({...})` (`buildMongoFindScript()`, pure & unit-tested):
  the filter is strictly `JSON.parse`d and then `JSON.stringify`'d again before being pasted into the generated `mongosh` script — this is what stops a filter like
  `{}); db.dropDatabase(); ({` from passing as a `.find(...)` call and running as arbitrary mongosh JS (only valid JSON literals can pass `JSON.parse`,
  so what reaches the shell is always inert data). Extended-JSON operators (`{"$oid":"..."}`) are not translated specially in filters (so they only match a field literally named `$oid`, not an error). **Not yet**: insert/update/delete/aggregate through the query box (read-only for now), a Structure tab/create collection/edit-delete row
  in the web (the backend rejects with 400, and the web never calls it for this engine).
- **Data browser stage 2** (table structure, edit/delete rows, CSV export, query history): `GET /databases/:id/tables/:table/columns` → `ColumnInfoDto[]` (name/dataType/nullable/
  defaultValue/isPrimaryKey) from `information_schema.columns` (Postgres: PK via `EXISTS` on `table_constraints`+`key_column_usage`; MySQL/MariaDB: `column_key = 'PRI'`),
  used by the **Structure** tab in the web and as the source of truth for edit validation — **not** `assertIdentifier`, which rejects spaces/non-ASCII (columns like `"first name"` are valid in Postgres); column names in `set`/`where` are validated against this real column list.
  `PATCH`/`DELETE /databases/:id/tables/:table/rows` (owner/admin, body `{where, set?, db?, schema?}`): `query-guard.ts` `assertRowTarget(columns, where, set)` requires `where` to be **exactly** the primary key — not a subset (could hit many rows) or a superset (a hidden stale filter) — and rejects a `set` that touches the PK column itself or unknown columns;
  a table without a PK → 400 "edit with SQL". Statements are built via `sqlLiteral()` (manual quote+escape — the values come from a validated JSON body, not from user SQL) and
  run through the same `this.sql()` as the query box. **Exactly-one-row guarantee**: Postgres reads it from the command tag (`UPDATE 1`/`DELETE 1`); mysql/mariadb (the batch CLI does not print a status) get an extra `SELECT ROW_COUNT()` in the same script (one CLI session) — `affected !== 1` → 400. MySQL also adds `LIMIT 1` as a second layer.
  Tested for real on Postgres **and** MariaDB (the `ROW_COUNT()` path): composite PK (update/delete exactly 1 row), table without PK (400, not updating the whole table), column named
  `"first name"` (edit succeeds, not a 500), `where` subset/superset of the PK (400), changing a PK column (400), a `where` PK that does not exist (0 rows → 400, not a fake success),
  viewer PATCH/DELETE (403 from `@Roles`). Note: `columns()` for MySQL/MariaDB uses `table_schema = DATABASE()` and ignores `opts.schema` (MySQL has no schema inside a database like Postgres does, same as `listTables`) — this is not reachable through the web because `TableInfo.schema` is always null for that engine, but if called manually
  with a `schema` for MySQL, `columns()` and `tableRef()` (which respects `schema`) could see different objects.
  `GET /databases/:id/tables/:table/rows/export` → CSV (`toCsv()` RFC 4180, `MAX_EXPORT_ROWS` 5000 separate from the query `MAX_ROWS` 500; an `X-Aoox-Truncated` header when cut off),
  proxied by the web through `/api/databases/[id]/tables/[table]/rows/export` (cookie → Bearer) like the SQL export.
  **Query history** (`src/modules/managed-database/query-history/`, entity `QueryHistoryEntry` in `query_history`: FK cascade to database & user, `sql` stored verbatim —
  **with no redaction**, unlike the audit log which has a fixed list of key names to redact; free-form SQL is therefore recorded verbatim and truncated to 4 KB; this is an intentional property, not a gap, because only the owner of the row can see it): written fire-and-forget from `DataBrowserController.query()` (on success *and* failure, so that the history of "what I just ran" is complete) after `runQuery()`, and never fails the query response. `QUERY_HISTORY_KEEP` 50 rows per (database, user), pruned on each write like `compose-runner`'s `prune()`. Flow `GET`/`DELETE /databases/:id/query-history` — **per user**, without `@Roles` (members see their own history, the same as the query box),
  unlike `/audit-logs`, which is platform-wide owner/admin.
- **Multiple databases per server** (`schemas/`): `GET /databases/:id/schemas` (all members) → `[{name, isPrimary}]` (`pg_database` non-template / `SHOW DATABASES`, minus
  `SYSTEM_SCHEMAS`), `POST` (owner/admin; Postgres `CREATE DATABASE … OWNER <user>` — the provisioning user is a superuser; MySQL/MariaDB `CREATE DATABASE` + `GRANT ALL … TO 'user'@'%'`
  so that the connection URL only needs the db name changed; MongoDB needs no separate grant — `mongoCreateDatabase` just writes one placeholder document, the root user already has access to all databases), `DELETE /:name` (owner/admin; primary & system databases rejected; Postgres `WITH (FORCE)`; MongoDB `db.dropDatabase()`). Redis/Valkey → 400 (numbered DBs, not names).
  The data browser accepts `?db=` / `{db}` (`DatabaseSelectDto`) → `DatabaseQueryService.sql(db, stmt, {database})` overrides `DB_NAME` in the helper env (the last entry wins).
  App env: `${{database.<slug>.url:<name>}}` / `.database:<name>` → URL/name of another database on the same server (`REFERENCE` has a `:name` group; cache per `slug:name`).
  Backup: `ManagedDatabase.backupAllDatabases` (PATCH `backup-schedule`) → `DatabaseBackup.scope` `all` (file `*.all.<ext>`): Postgres `pg_dumpall --clean --if-exists`, restored into the `postgres` db without `ON_ERROR_STOP` (DROP DATABASE fails while an app is connected — the objects are then replaced in place); MySQL/MariaDB `mysqldump --databases <non-system> --add-drop-database`
  (not `--all-databases`, so that the `mysql` grant tables are not included), restored without a db name; MongoDB `mongodump` without `--db` (the whole server), then `mongorestore --nsExclude`
  `admin`/`local`/`config` so that the root user is not overwritten. Tested end-to-end on Postgres & MariaDB (drop db → restore → data back), and manually for MongoDB
  (`admin.system.users` stays intact after restore-all).
- **SQL export/import** (data-browser): `GET /databases/:id/export?db=` streams plain `pg_dump --no-owner --no-privileges --clean --if-exists` / `mysqldump`/`mariadb-dump`
  (no gzip, no backup row) as `<slug>[-db].sql` — `DatabaseQueryService.spawn()` (create + seed `/in` via `putArchive` + start + wait, a 30-minute timeout for the transfer) and then `streamFileFromContainer('/out/stdout')`. `POST /databases/:id/import?db=` (owner/admin, throttle 10/minute, multipart `file` via `FileInterceptor` —
  the `@types/multer` dev dependency per the Nest docs; max `IMPORT_MAX_BYTES` 64 MB because the file is tarred in memory) → `psql -v ON_ERROR_STOP=1 -f` / `mysql <`; a failure at the first erroring statement → 400 with the engine's message, and the statements before it remain applied (CLI behavior; no wrapping transaction). The web proxies the export through
  `/api/databases/[id]/export` (cookie → Bearer) and the import through a multipart server action (`importSqlAction`). Redis/Valkey and MongoDB have no SQL to
  export/import — both are rejected with 400 (`dumpScript()`/`importSql()`; use backup/restore instead).

## Database companion admin

- `src/modules/database-companion/` — one web-admin container per managed database (the UI of Adminer/phpMyAdmin/pgAdmin/Mongo Express/Redis Commander/DbGate), installed with one click. Entity
  `DatabaseCompanion` (`database_companions`: `database_id` **unique** + FK cascade, `tool`, `status` creating|running|stopped|error, `error_message`, `host` unique nullable, `https`, `host_port`,
  `password_encrypted` nullable `select:false` AES via `secret.util`+`ENCRYPTION_KEY`); migration `DatabaseCompanions` (hand-written). Flow: `get-companion` (`GET /databases/:id/companion` → `null` or
  `{id,tool,status,errorMessage,host,https,hostPort,url,username,createdAt}`), `companion-options` (`GET .../companion/options` → `{tools:[{id,label,description,usesDatabaseLogin}]}` filtered by engine),
  `create-companion` (`POST`, 202, throttle 10/minute, body `{tool, host?, https?, hostPort?}`), `companion-credentials` (`GET .../companion/credentials` → `{username,password}`, throttle 30/minute),
  `delete-companion` (`DELETE`, 204). The audit-log redaction already covers the `password`/`secret` keys (the POST body does not carry secrets anyway).
- **Catalog** `companion-tools.ts` (pure, unit-tested): image + tag **pinned**, web port, supported engines, `usesDatabaseLogin`, and `build(ctx)` → `{env, cmd, files}`. Tags verified to exist in the registry
  (`docker manifest inspect`): `adminer:5.4.2` (8080; mysql/mariadb/postgres), `phpmyadmin:5.2.3` (80; mysql/mariadb), `dpage/pgadmin4:9.18.0` (80; postgres + variants), `mongo-express:1.0.2-20-alpine3.19`
  (8081; mongodb), `ghcr.io/joeferner/redis-commander:0.9.1` (8081; redis/valkey — Docker Hub only has a 2021 `latest`, versioned tags are only on GHCR), `dbgate/dbgate:7.3.1-alpine` (3000; all engines).
  The env interfaces were read from each tool's official docs/source (not guessed): Adminer `ADMINER_DEFAULT_SERVER` (only pre-fills the server field; the Postgres driver is selected through the URL `?pgsql=<host>` — the Adminer+Postgres `url` includes that query),
  phpMyAdmin `PMA_HOST`/`PMA_PORT` (`PMA_ARBITRARY` stays off: the login form cannot be pointed at another host), pgAdmin `PGADMIN_DEFAULT_EMAIL`/`PASSWORD` + `servers.json` `putArchive`d to `/pgadmin4` before start (no DB password because `servers.json` has no such field → pgAdmin asks for it on connect; **server mode stays enabled** — do not set `PGADMIN_CONFIG_SERVER_MODE=False`,
  which disables login; email `admin@example.com` because pgAdmin rejects special-use domains such as `.local`), Mongo Express `ME_CONFIG_MONGODB_URL`/`ME_CONFIG_BASICAUTH*`/secret cookie+session
  derived from the password (`VCAP_APP_HOST=0.0.0.0`), Redis Commander `REDIS_HOST/PORT/PASSWORD` + `HTTP_USER/HTTP_PASSWORD`, DbGate `CONNECTIONS`/`LABEL_/ENGINE_/SERVER_/PORT_/USER_/PASSWORD_/DATABASE_<id>`
  (mongo: `URL_<id>`; mariadb uses the mysql plugin) + `LOGIN`/`PASSWORD` (`SHELL_CONNECTION`/`SHELL_SCRIPTING` default off, untouched).
- **Auth, never without a login**: adminer/phpmyadmin use the database's own login (the user takes the credentials from the database page; no password is generated, `username`/`password` null);
  other tools get a random 24-character alphanumeric password stored encrypted, with `username` = `admin` (pgAdmin: `admin@example.com`). `build()` throws if a tool that needs a generated login is called without a password.
  Accepted consequence: DbGate/Mongo Express/Redis Commander already hold the database password in the container env, so anyone who knows their login has full database access — which is why **`credentials` rejects `viewer` (403)** (unlike `database-credentials`, which is still open to viewers; checked via `ProjectAccessService.roleFor`), while installing/removing = POST/DELETE, so viewers are already 403 through the request-context rule.
  Project access goes through `ManagedDatabaseService.findOwnedOrFail` (outsiders get 404). Adminer can still be pointed at another host on the `aoox` network if the user has its credentials
  (only the server field is pre-filled, it is not locked) — documented, not blocked.
- **Access**: at least one of `host` (a domain; Traefik labels via `ProxyService.labelsFor(dbadmin-<slug>, port, …)`; the local proxy is provisioned automatically if it is not yet `running` — the same rule as
  `add-domain`, ACME is not required; the host is checked for uniqueness against `domains` **and** other companions → 409) or `hostPort` (`HostPortService.assertFree` → 400; `database_companions` is now also checked by
  `HostPortService`, so the app/compose/companion/**create-database** flows reject a port used by a companion; `create-database` used to skip this check, and a conflicting port only failed when the container was created, leaving the database
  in `status: error` "port is already allocated"). Without either → 400. **Using `host` AND `hostPort` together is allowed** (a decision, consistent with regular applications): `url` uses the domain, and the host port remains published (tested). The DB must be `running` (409), one companion per database (409). Mismatched tool/engine → 400.
- **`url`**: domain → `http(s)://<host>[:proxyPort]/`; host port → `http://<PUBLIC_IP or REGISTRY_PUBLIC_HOST>:<port>/`, **`null`** when the server address is not configured (empty/`localhost`) — the web then builds it from
  `window.location.hostname` + `hostPort` (and in that case the Adminer+Postgres query is lost; the user picks the PostgreSQL driver manually).
- **Container**: `aoox-dbadmin-<db_slug>` (`companion-names.ts`), `aoox` network, `restart unless-stopped`, `logConfig`, **host only**. **No volume** (pgAdmin/DbGate use temporary state; the configuration comes from env/`servers.json` on every creation) → `orphan-volumes` is unaffected and unchanged. **No `aoox-swarm` overlay**: the database is always on the `aoox` bridge too, so the companion reaches it by name
  without `connectIfActive`; the Traefik docker provider reads its labels from `aoox`. Provisioning is detached like the database's `provisionInBackground`: POST replies 202 `creating`, then `running|error` (the error message is in `errorMessage`).
- **Label decision** (`companionLabels()`): `aoox.component=companion` + `aoox.companion=<databaseId>` + `aoox.project` + `composeLabels('dbadmin-<slug>')`. It does **not** carry `aoox.database`/`aoox.application`/`aoox.compose` (tested):
  `MetricRetentionService.ownersByContainer` only recognizes those three, so companion metrics do not enter the database history (no double counting); `MonitoringService` still samples it live for 1 hour because the
  `aoox.component` label is present; `project-resource-usage` adds it to the project through `aoox.project` (it does use that project's resources); `ContainerDownNotifier` only reports application/database components → a dead companion is **silent** (no false notification; its status is visible in GET). Labels never contain the password.
- **Status follows reality**: `GET` matches the `running|stopped|error` row with the container (`findContainerByName`): missing → `error` ("no longer exists"), stopped → `stopped`, running → `running`;
  daemon unreachable → the previous status is kept. There is no watcher. **Stopping the database does not touch the companion** (it keeps running and just cannot connect until the database is started again; there is no re-provisioning on start).
- **Delete**: `DELETE .../companion` removes the container and then the row. `ManagedDatabaseService.remove()` removes the companion container **by name** (try/catch, warning only — it must not block deleting the DB) before
  the database container; the row is removed via FK cascade. `DatabaseCompanionModule` does not import `ManagedDatabaseModule` (cycle), hence the name-based lookup. Deleting a **project** follows the old behavior (cascades rows only;
  database/app containers are not removed on that path) — the companion is the same.
- Project export/import does **not** carry companions. Unit-tested (catalog, service, host-port) **and** smoke-tested for real on Docker Desktop (host-port mode, real API; one DB per engine, removed afterwards):
  - adminer+MariaDB and adminer+PostgreSQL: login with the real DB credentials succeeds; the URL `?pgsql=<host>` really selects the PostgreSQL driver (without the query, the default driver is "MySQL / MariaDB").
  - phpmyadmin+MySQL 8: DB login succeeds; the form has no server field and a manually sent `pma_servername` is ignored (the host stays `PMA_HOST`).
  - pgadmin+PostgreSQL: login with `admin@example.com` + the generated password (tested in the browser) succeeds, the server from `servers.json` appears in the tree and **asks for the DB password** on connect; once entered, it connects.
    Logging in with `curl` is impractical (React form + CSRF) — test in a browser.
  - mongo-express+MongoDB: **real HTTP Basic** (401 without/with wrong credentials, 200 with), database list shown; `VCAP_APP_HOST=0.0.0.0` makes it listen on all interfaces.
  - redis-commander+Redis: **not HTTP Basic** — `HTTP_USER`/`HTTP_PASSWORD` enable a sign-in form (`POST /signin` JSON → bearer JWT); the HTML shell at `/` stays 200 without login,
    but the entire `/apiv2/*` returns 401 without a token, so the data is unreadable; after sign-in the keys appear. Do not test for "401 without credentials" on `/`.
  - dbgate+PostgreSQL: the login form (`LOGIN`/`PASSWORD`) guards the UI, the `db` connection is already set up and connected (PostgreSQL 16). Note: on first opening the connection the UI briefly showed
    "Invalid database connection, driver not found" (a race while the client-side plugins load); after a reload the status was "Connected". There is an anonymous analytics dialog on first login (DbGate default).
  - All: containers on the `aoox` network only, labels exactly `aoox.component=companion`/`aoox.companion`/`aoox.project`/`com.docker.compose.*` (no `aoox.database`/`aoox.application`), `restart unless-stopped`;
    `GET .../companion` reconciles (stop → `stopped`, start again → `running`, `docker rm` → `error` "no longer exists"); viewer 403 for credentials/POST/DELETE; one per DB → 409; DB stopped → 409;
    no host/hostPort → 400; mismatched tool/engine → 400; hostPort = the DB's port → 400; DELETE companion and DELETE database both remove its container (the `database_companions` row cascades);
    `GET /projects/:id/resource-usage` counts the companion container (`containers` increases); the database's `metric_samples` stay at `containers = 1` (no double counting);
    a companion killed with `docker kill` produces **no** notification (positive control: `docker kill` of the database container → one `container.down` notification).
  - **Not tested for real**: domain mode (needs a proxy), Valkey/Mongo in DbGate, MongoDB without `VCAP_APP_HOST`, Redis Commander on Valkey.

## Database backup

- `src/modules/database-backup/` — entity `DatabaseBackup` (`database_backups`, FK cascade to `managed_databases`; `filename` = `<slug>/<ISO stamp>.<ext>`,
  status `running`→`success`|`failed`, `trigger` `manual`|`scheduled`, `size_bytes`). `ManagedDatabase` has `backup_cron` (null = disabled) & `backup_keep` (default 7).
- All dumps live in **one volume** `aoox_backups`, mounted at `/backups` into a one-shot container from the engine's own image (`backup-recipes.ts`:
  `pg_dump | gzip`, `mysqldump`/`mariadb-dump` as root, `redis-cli --rdb`, `mongodump --archive --gzip`). Credentials are passed only via env
  (`DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME BACKUP_FILE`), not in `Cmd`.
- SQL restore = `online` (streamed into `psql`/`mysql`). MongoDB is also `online` (`mongorestore --archive --gzip --drop`, no need to stop the container). Redis/Valkey =
  `offline-volume`: the container is stopped, the data volume is mounted at `/data`, the snapshot is installed as a
  **multi-part AOF base file** + manifest (Redis 7 with `appendonly yes` ignores `dump.rdb`), then the container is started again (`finally`).
- Downloading/deleting files goes through a `busybox:stable` helper (`GET /containers/{id}/archive` → `SingleFileUntar` in the Docker client; `DockerService.runOnceWithOutput` for exit code + output).
- Scheduling: `backup-scheduler.service.ts` (`@nestjs/schedule@6` + `SchedulerRegistry`/`CronJob` from `cron`). A job per DB is registered at boot, and `reschedule(db)` runs when the schedule changes.
  After a scheduled backup, `prune(db)` deletes the oldest **scheduled** backups beyond `backupKeep` (manual backups are never pruned). Cron is validated with `isValidCron` → 400.
- Flow: `create-backup` (`POST /databases/:id/backups`, 201, synchronous), `list-backups`, `restore-backup` (`POST /backups/:id/restore`), `download-backup` (stream, `Content-Disposition`),
  `delete-backup` (row + file), `update-backup-schedule` (`PATCH /databases/:id/backup-schedule`). The web app proxies downloads via `/api/backups/:id/download` (session cookie → Bearer).
- SQL dump recipes use a temporary file and then gzip (`gzipped()` in `backup-recipes.ts`): `dump | gzip` reports gzip's exit code, so a failed dump produced a "successful" 20-byte backup;
  `pipefail` is not available in dash, so the dump's status is propagated manually. A failed backup → `backupFailure` notification.
- **S3 destination** (`src/modules/backup-destination/`, entity `BackupDestination` in `backup_destinations`: nullable endpoint = AWS, region, bucket, prefix, `access_key_id`,
  `secret_access_key_encrypted` `select:false`, `force_path_style` default true). Flow `create/delete/test-destination` (owner/admin), `list-destinations` (all members — DTO without secrets,
  used by the select on the DB page). Transfers run through a one-shot **`rclone/rclone:1`** container (files never pass through the API process): remote configuration purely via env
  `RCLONE_CONFIG_S3_*` (`rcloneEnv()`, pure & unit-tested; `provider=Other` when an endpoint is set, `AWS` when not; `NO_CHECK_BUCKET=true` — the bucket must already exist), backup volume
  mounted `:ro`, on the `aoox` network (self-hosted MinIO can be reached by container name). `upload` = `copyto`, `remove` = `deletefile` (never throws — prune must not get stuck),
  `test` = `lsjson --max-depth 1` (multi-line JSON output, parsed from the first `[` line).
  `ManagedDatabase.backupDestinationId` (FK SET NULL; set via `PATCH /databases/:id/backup-schedule` `backupDestinationId`) → every backup (manual & scheduled) is uploaded after the local dump succeeds;
  `DatabaseBackup.destinationId` + `remoteKey` (`<prefix>/<slug>/<stamp>.<ext>`). A failed upload = backup `failed` + notification (the local file remains for download) —
  the destination is attached so a copy exists elsewhere. Deleting/pruning a backup also deletes the remote object. Volume constants are in `backups-volume.ts` (used by both modules).
- **Application volume backup** (`src/modules/volume-backup/`, entity `VolumeBackup` in `volume_backups`: FK to app & mount cascade, `volume`, `filename` `<appName>/<mount>/<stamp>.tar.gz`,
  status/trigger/size/destination/remoteKey as for DB backups). `Application` has `backup_cron`/`backup_keep`/`backup_destination_id` (the schedule applies to **all** `volume` mounts,
  pruning per mount). Backup = one-shot busybox with the volume mounted `:ro` + `tar czf` into `aoox_backups`; restore = stop container → `rm -rf ./* ./.[!.]* ./..?*` → `tar xzf` →
  start again (`finally`). Download/delete/S3 upload use the same mechanism as DB backups. Only apps on the **local server** (400 for `serverId`). Flow `create-volume-backup`
  (`POST /applications/:id/mounts/:mountId/backups`, synchronous), `list-volume-backups`, `restore/download/delete-volume-backup` (`/volume-backups/:id`), `update-volume-backup-schedule`
  (`PATCH /applications/:id/backup-schedule`, same DTO as DB). Web: `volume-backups.tsx` under the Mount tab + proxy `/api/volume-backups/:id/download`.
- **Restore from S3** (`backup-files.service.ts`, exported by `DatabaseBackupModule`, also used by volume-backup): `localFiles()` = a single busybox `find` on the backup volume →
  `annotate(rows)` adds `local: boolean` to `GET .../backups` and `.../volume-backups`; `ensureLocal(backup)` is called before restore/download — if the local file is gone
  (pruned by retention, new disk) and a `remoteKey` exists, `BackupDestinationService.download()` (`rclone copyto` remote → volume) pulls it back; without a copy → 400 (restore) / 404 (download).
  The web marks it as "S3 only". Not yet: separate retention on S3, bind-mount backups, importing backups whose rows no longer exist in the DB (completely new server).

## Template (one-click)

- `src/modules/template/` — a **static catalog in TypeScript** (`templates/*.ts`, `Template` in `template.types.ts`: id, version, `variables` `{key,label,default,generate,required,hint}`,
  `services` `{service,port,label}` that may be given a domain, `compose`). It is not fetched from a URL at runtime (offline, and cannot be replaced by someone else's YAML); no nest-cli `assets` needed.
  Contents (15): wordpress, ghost, n8n, uptime-kuma, minio, gitea, **vaultwarden** (1.37.3), **umami** (`ghcr.io/umami-software/umami:postgresql-v2.20.2` + postgres), **grafana** (13.0.2, SQLite),
  **metabase** (v0.63.18.5 + postgres), **directus** (12.4.1 + postgres; variables named `KEY`/`SECRET` are indeed Directus env names), **mattermost** (`mattermost-team-edition:11.11.1` + postgres) and
  **nextcloud** (`32.0.15-apache` + postgres + redis `--requirepass` + a `cron` service with `entrypoint: /cron.sh`; `PROTOCOL` defaults to https for `OVERWRITEPROTOCOL`, http only for local testing).
  **odoo** (`odoo:19.0-20260926` Community + postgres; a dated tag because `19.0` shifts every night; configuration via an inline compose `configs` entry -> `/etc/odoo/odoo.conf`
  because the master password (`admin_passwd`) can only be set through a config file, not CLI/env; `proxy_mode`, `workers = 0`, `list_db = True` so the first database can be created via the web;
  the `MASTER_PASSWORD` variable is generated; healthcheck `/web/health`; hardening `/web/database/manager` afterwards = edit compose: `list_db = False` + `dbfilter`; wizard `POST /web/database/create`
  Odoo 19 requires the `phone` field). Tested: the generated master password is accepted, a wrong one is rejected, admin login works, data survives recreate.
  **excalidraw** (`excalidraw/excalidraw`, port 80, no DB/volume/variables; only the nginx **static client** — live collaboration needs a separate `excalidraw-room` server, not yet present, stage 2).
  Docker Hub has **no version tags** for this image (only the rolling `latest` + outdated 2021 `sha-*`), so it is pinned to the manifest-list digest: `latest@sha256:f7ee194a…` (the explicit tag spec passes
  because the regex accepts `:<digest>`; Docker uses the digest). Bump the digest manually to update. No healthcheck was added: the upstream Dockerfile already has a `HEALTHCHECK` with wget (nginx alpine).
  **Tested for real**: `POST /compose-apps/from-template` with host ports in `servicePorts` → deploy succeeded, HTTP 200 (`<title>Excalidraw Whiteboard`), the container uses the pinned digest reference,
  the image's built-in `HEALTHCHECK` (`wget -q -O /dev/null http://localhost`) reaches `healthy`, deleting the stack cleans up the container/network (no volumes).
  New template conventions: a specific image version tag (the spec ensures every image has an explicit tag), DB uses a `pg_isready` `healthcheck` + `depends_on: condition: service_healthy`, named volumes,
  simple-icons logo. Everything was tested for real via `POST /compose-apps/from-template` behind a local proxy (health/status endpoints answer 200; Directus login; Grafana/Umami data survived container recreate;
  Nextcloud uses pgsql+Redis). Note: Directus `/server/health` returns 403 without a token — use `/server/ping`. `GET /templates` (all members).
- `template.service.ts`: `renderEnv(template, values)` (user value → default → `generateValue` for `generate`; an empty `required` → `TemplateVariableError` → 400),
  `generateValue` is **alphanumeric only** (it goes into `.aoox.env`, the compose interpolation source `$`, and through `EnvResolverService` `${{`), `referencedVariables`.
  The `template.service.spec.ts` spec guards the catalog: unique ids, every service exists in compose, `${VAR}` in compose == `variables`, keys PASSWORD/SECRET/KEY are always `generate`.
- Flow in the compose module: `create-from-template/` (`POST /compose-apps/from-template` `{projectId, templateId, name?, variables?, serviceDomains?}`, 202) → row `source: 'template'`
  + `templateId` + `composeContent` copied + env from `renderEnv` + domains (validated against `template.services`), then `runner.start(app,'deploy')`. The regular git create DTO is not used (`gitUrl` regex).
- Web: `/templates` (`templates-catalog.tsx` + `deploy-template-dialog.tsx`: project, name, host per service + HTTPS, variable fields); the compose page shows `compose-domains.tsx`
  and `ComposeForm source="template"` (compose textarea, no git fields). Not yet: templates from a repo/custom URL, template versioning/upgrades, offline icons.

## Scheduled jobs

- `src/modules/job/` — entity `Job` (`jobs`, under `Application`: `name`, `cron` nullable = manual only, `command` run with `sh -c`, `target` `container`|`run`, `enabled`,
  `timeout_seconds` default 600, `last_run_at`/`last_status`) and `JobRun` (`job_runs`: status `running`→`success`|`failed`|`timeout`, `trigger` manual|scheduled, `exit_code`,
  `output` truncated to 64 KB; `JOB_RUN_KEEP` keeps the last 50 runs per job).
- `job-runner.service.ts`: `container` = `DockerEngineClient.execWithCode` (exec + `GET /exec/{id}/json` for `ExitCode`) in the running app container; `run` = a one-shot container
  from `currentImage` with resolved env, mounts, resource limits, label `aoox.component=job` (ignored by monitoring/container-down), removed after completion (stopped on timeout).
  **Timeout** is enforced inside the container via `timeout` when available (`shellCommand`, the command is passed as `$0` so quotes are free); the API only gives up waiting after
  `timeout+30 s` (an exec cannot be killed from outside). Pitfall found: `timeout` **must not be the last command** of the `sh -c` script — ash/dash tail-exec, so `timeout` becomes
  PID 1 in the one-shot container and the signal never reaches the child (the command runs to completion); therefore the script ends with `; exit $?`. Busybox `timeout` returns 143 (not 124) →
  `isTimeoutExit(code, elapsed, limit)` = code 124/137/143 **and** duration ≥ limit. Failure/timeout → `jobFailure` notification.
- `job-scheduler.service.ts`: one `CronJob` per active job with a `cron` (`reschedule`/`unschedule`, re-registered at boot); a tick is skipped if the job is still running (`isActive`, no queuing).
- Flow: `create-job`/`list-jobs` (`/applications/:id/jobs`), `update-job`/`delete-job`/`run-job` (202, 409 if still running)/`list-job-runs` (last 20) under `/jobs/:id`. Invalid cron → 400.
- Web: **Jobs** tab (`application-jobs.tsx`): job rows (active toggle, Run, delete; run history is polled every 2 seconds while anything is `running`, then `router.refresh()` so the header updates too) + new job form.
  `src/features/job/`.
- **Job owner** = an application **or** a database **or** a compose stack (`application_id`/`database_id`/`compose_app_id` nullable, exactly one filled; `service` for compose).
  `JobRunnerService.resolve(job)` → `JobContext` (`findContainer` + `runSpec`): app = app container / `currentImage` + env + mounts; database = container `aoox-db-<slug>`
  / engine image + env `DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME` (same as the backup recipe — inside the DB container the image's official env is available, e.g. `$POSTGRES_USER`);
  compose = container labeled `com.docker.compose.project`+`service` / that container's image & env (`inspect`, `Config.Env` added to the client type). `JobService.build(owner, dto, service)`
  is used by `create-job` (`/applications/:id/jobs`), `create-database-job` (`/databases/:id/jobs`), and `create-compose-job` (`/compose-apps/:id/jobs`; `CreateComposeJobDto` requires
  `service` — do not use `declare` in the child DTO: its validation decorators are not registered). `ComposeModule` now exports `ComposeService`.
  Not yet: history beyond 20 in the UI, output streaming.

## Docker manager (Infrastructure > Docker)

- `src/modules/docker-manager/` — view and perform basic actions on any daemon: the host (`serverId` empty) or a remote server (`?serverId=<uuid>` → `RemoteDockerService.forServer`,
  `DockerTargetService.handle`; unknown uuid → 404, not a malformed uuid → 400). Not Portainer: no exec/shell, no compose editor, no manual build/pull. Flow in its own folder:
  `list-containers`, `container-logs`, `container-action` (start/stop/restart), `remove-container`, `list-images`, `remove-image` (+ prune dangling), `list-volumes`, `list-networks`.
  One Engine call per tab (`listContainers all` + `listImages`/`listNetworks`/`system/df`); "used by" is computed from **one** `listContainers` (`ImageID`, `Mounts`,
  `NetworkSettings.Networks`), not N+1. Client: `listImages`, `listNetworks`, `ContainerSummary` extended with `ImageID/Created/Mounts/NetworkSettings`, `HostConfig.Mounts`.
- **Routes** (all under `@Controller('docker')`): `GET /docker/containers`, `GET /docker/containers/:id/logs?tail` (1–500, default 200, truncated to 500 lines/200 KB; a single fetch, not a stream),
  `POST /docker/containers/:id/start|stop|restart` (204), `DELETE /docker/containers/:id?force=` (204; without force on a running container = 409 from the daemon), `GET /docker/images`,
  `POST /docker/images/prune` (dangling only), `DELETE /docker/images/:id` (204), `GET /docker/volumes`, `GET /docker/networks`. **Roles**: read + logs `@Roles('owner','admin')`, all writes
  `@Roles('owner')` (scoped API tokens are rejected automatically by `@Roles`; readOnly tokens get 403 for writes; members get 403 for everything; tested for real). Writes are throttled at 30/min, volumes at 20/min
  (`/system/df` is heavy). Each write route has Indonesian text in `aoox-web/.../audit-log.format.ts` (6 keys, 1:1).
- **Guards (the core of the feature, `managed.ts` pure + `DockerTargetService.resolveUnmanaged`)**: every container write first `inspect`s and decides based on **what the daemon reports**
  (full id, name, labels), not on the string sent — name and id get the same verdict. `classifyContainer` treats it as aoox-owned (→ **403**, message points to the resource page):
  the API's own hostname (`os.hostname()` = the container's short id; host daemon only; must be 12–64 hex), labels `aoox.application/.database/.compose/.companion`, `aoox.component=*`
  (proxy, registry, build, job, backup…), compose project `aoox` (panel postgres/api/web — **after** the component check, so `aoox-proxy`, which also carries project `aoox`, is read as "proxy"),
  project `aoox-<slug>` (user stacks), and names prefixed with `aoox-`/`aoox_` even without labels. Container references are validated (`isSafeContainerRef`: 64 hex or a valid Docker name) before being sent to the
  daemon, image ids (`isSafeImageId`) too; nothing is interpolated into a shell command (only URL-encoded Engine API paths). List responses use an explicit DTO — no raw `Config.Env`/labels.
  Reading container logs is allowed for aoox containers too (reading does no harm); actions are not.
- **Images**: removal only when **no container (running or stopped)** was created from that image (409 naming the container) and it is not an aoox image (`isAooxImage`: `aoox-*` helpers,
  `aoox/<project>/<app>`, `hideandseeklab/aoox-*` → 409 "clean up via Docker Disk"); the id is matched against the daemon's list and must match exactly one. **Second protection layer** (`image-protection.ts` pure + `ImageProtectionService`, 3 queries per list/removal,
  not per image; `protectedReason` is included in the list DTO so the web can hide the button): **409** when the image is referenced by the DB as (a) `Application.currentImage`, a stored `Deployment.imageRef` (rollback uses it; old rows cleaned by `MaintenanceService` no longer protect automatically) or a `PreviewDeployment.imageRef` in `building`/`running` status, scoped to apps on that daemon
  (`Application.serverId` = the selected server, or `IS NULL` for the host), or (b) — **host only** — its repository begins with the local registry host (`REGISTRY_PUBLIC_HOST:REGISTRY_PORT`,
  default `localhost:5000`, plus the `url`/`domain` of `registries` rows of type `self-hosted`): "belongs to the aoox registry, remove it via Registry". Ref matching uses `parseImageRef` (canonical:
  `docker.io/library/nginx` = `nginx` = `nginx:latest`, a host with a port is not confused with a tag, `@sha256` is matched against `RepoDigests`, full/short id against `Id`) — unit-tested, including
  `localhost:5000` ≠ `localhost:5001`. Remote servers do not use the registry rule (their contents are just pulled copies) but are still protected when matching that server's DB rows.
  Prune removes only dangling images of **all** users of that daemon, not limited to aoox — the web mentions this in the confirmation dialog along with the estimated count/size from the loaded list.
  **Not yet** (stage 2, deliberately not done): removing non-aoox volumes/networks. **Not yet tested for real**: remote servers via SSH, and the own-API-hostname path in a real API container.
- **Volumes**: size from `system/df` (`-1` → `null`), `managed` flag (`isAooxVolume`), `orphan` uses `MaintenanceService.orphanVolumeNames(df)` (now public; `MaintenanceModule` exports
  `MaintenanceService`) — **host only**; remote servers always report `orphan:false` because the panel DB only knows host volumes. Networks: built-in (`bridge/host/none/ingress/docker_gwbridge`), `managed`
  (`aoox`, `aoox-swarm`, project `aoox*`). Volumes and networks are read-only at this stage.
- **Tested for real** (own API and web in an isolated DB, local Docker): decoy containers labeled aoox (component, project `aoox`, `aoox.application`, name `aoox-…`) rejected with 403 for stop/restart/start/remove/force-remove
  by **both** name and id, StartedAt unchanged; then the real `aoox-proxy`/`aoox-registry`/`aoox_db` were rejected with 403 for the same five actions and left untouched; regular containers: logs, stop, start (304 treated as success),
  restart, removal without force 409 / with force 204, removing a stopped one, a missing container 404; image in use 409, unused 204, odd id 404; volumes/networks listed; admin read 200 write 403, member 403, readOnly token read 200 write 403,
  scoped token 403, audit log records each action (including 403/404/409). **Not yet tested for real**: remote servers via SSH (same code, `forServer`), dangling prune on this host (the user has dangling images here;
  unit tests only), the own-hostname path in a real API container (unit tests only; on the dev host the hostname is not a container id).

## Disk maintenance

- `src/modules/maintenance/` — `MaintenanceService.usage()` (`GET /maintenance/disk`, owner/admin: summarized `GET /system/df` + `reclaimableBytes` = dangling images + non-shared build cache,
  `prunableDeployments`, the last cleanup report **in memory**) and `cleanup()` (`POST /maintenance/cleanup {registryGc?}`, owner, synchronous, 409 if already running;
  also `@Cron('30 4 * * *')` unless `MAINTENANCE_NIGHTLY=false`). Order: per application, delete successful deployments beyond `Application.deploymentKeep` (default 10; **never**
  `currentImage`, and images still referenced by kept rows — rollback reuses the ref — are not deleted; the `imageRef` of old rows is nulled, the log stays) → `DELETE /images/{ref}` +
  delete the tag in the local registry (`getTag` + `deleteManifest`) → delete failed/queued rows older than 30 days → `POST /images/prune` (dangling) + `POST /build/prune` → registry GC (`SelfHostedRegistryService`,
  now exported). The Docker client gained `removeImage`, `pruneImages`, `pruneBuildCache`. Tested for real: 17.7 GB freed, app containers untouched. Web: `disk-card.tsx` in Settings
  (usage bar, Clean up button for owners, registry GC toggle) and the **Deployment history** field in the application form. Not yet: monitoring history retention, apps on remote servers
  (old images are removed on that server's daemon, but there is no registry there).
- **Orphan volumes** (`orphan-volumes.ts`, pure & unit-tested — no Docker calls): `expectedVolumes()` recomputes, from DB rows, every volume name that should still exist
  (reusing the same name generators as the runner: `volumeNameFor`/`filesVolumeFor` from `mounts.ts`, `volumeNameForDb`, `composeVolumeFor`, plus five fixed singletons such as `aoox_buildkit`/`aoox_backups`), then compares them with `GET /system/df` of the **local** daemon. `isCandidateVolume()` is **deliberately strict** — only volumes prefixed `aoox_app_`/`aoox_db_`/`aoox_compose_` or one of those five singletons are ever considered "aoox-owned"; other `aoox_` volumes
  (e.g. `aoox_postgres_data` — the name `docker-compose.dist.yml` produces for the panel's **own** Postgres, because that stack is given `name: aoox`)
  are never considered at all, let alone reported. `MaintenanceService.usage()` shows the list of names as a preview (`orphanVolumes`); `cleanup()` only actually deletes them via `DELETE /volumes/{name}` when called with `pruneVolumes: true` — **default `false`**, including in the nightly cron (unlike `registryGc`, which defaults to `true`),
  because volumes may hold data with no backup elsewhere, whereas images/build cache can always be rebuilt. Local daemon only — volumes on remote servers
  are never touched. Tested for real against the dev DB: found 4 real orphan volumes (mounts that were deleted but whose shared `_files` volume was not removed, old apps/compose stacks from earlier experiments) **and** correctly ignored a deliberately planted `aoox_postgres_data` decoy — that is the one guarantee that must never regress.
  Web: `disk-card.tsx` shows the list + a "Also remove orphan volumes" toggle (shown only when there are some).

## Inbound webhooks (extra security)

- `webhook-ip-allowlist.ts` (application module, reused by compose like `webhook-signature.ts`): an **optional** second layer, `WEBHOOK_VERIFY_GITHUB_IP=true` (default off) —
  when enabled, requests identified as coming from GitHub (`X-GitHub-Event`/`X-Hub-Signature-256` headers) for an app that already has a webhook secret must also come from one of GitHub's official IP ranges
  (`GET https://api.github.com/meta`, field `hooks`, cached for 1 hour; fetch failure → **fail-open**, so a GitHub outage never becomes a deploy outage). `ipInCidr()`
  is pure & unit-tested (IPv4 **and** IPv6, including normalizing the IPv4-mapped address `::ffff:a.b.c.d` that appears in `req.ip` on Docker's dual-stack sockets). **Deliberately GitHub-only and
  off by default**: GitLab does not publish stable webhook IP ranges (self-hosted GitLab can be anywhere), and GitHub *Enterprise Server* (self-hosted) also sends
  `X-GitHub-Event` but from the customer's own network, not github.com's ranges — enabling this flag there would reject every genuine delivery. Tested for real against the live `api.github.com/meta`
  (not a mock): a validly signed delivery from `127.0.0.1` was rejected with 401 (`::ffff:127.0.0.1` is outside the ranges), while a GitLab delivery with the same token from the same address
  still passed (the IP is never checked for GitLab). Applies to both application and compose webhooks.

## Project export/import

- Domains are exported only as `{host, https}`: **dynamic Traefik config files** (per proxy) and **`Domain.middlewares`** are not included; imported domains have no middlewares, and an import does not fail if the source file carries a `middlewares` field (it is ignored, with a test).
- `src/modules/project-transfer/` — its own format (`project-export.types.ts`: `format: 'aoox-project'`, `version: 1`). No ids: references to platform objects
  (registry, git credential, backup destination, server) are carried **by name** and matched on import; anything not found → null column + `warnings`, not an error.
  Contents: project (name/description/env), applications (source, build, env/buildArgs, domains, mounts, jobs, backup schedule, limits, previews), databases (engine/tag/name/user, mounts, jobs,
  `password` only with `includeSecrets`), compose (source/template/composeContent/git, serviceDomains, jobs). Not exported: webhook tokens/secrets (regenerated), deployment/backup history, status.
- `export-project/` `GET /projects/:id/export?includeSecrets=` (`includeSecrets` → owner only, 403), `import-project/` `POST /projects/import {file, name?}` (throttle 10/min; `file` `@IsObject`,
  its shape is checked by `validateShape` → 400 for a wrong format/version). `ProjectImportService.import()`: the new project belongs to the importer; `appName`/`slug` are reused if free, otherwise re-slugified (re-import on the same instance); `hostPort` values already used by another app/DB and existing domains are skipped with a warning; bind mounts are for owner/admin only (add-mount rules);
  jobs go through `JobService.build` (bad cron → job skipped), then `JobSchedulerService.reschedule`; DBs are created as `creating` + `provisionInBackground` (password from the file or a new one) after their mounts
  exist, then `BackupSchedulerService.reschedule`; apps get `VolumeBackupSchedulerService.reschedule`. All three schedulers are now exported by their modules. Responds with `ImportReport {projectId, created{...}, warnings[]}`.
  Spec `project-import.service.spec.ts` (in-memory repos). Not yet: selective import/merge into an existing project, including data (backups), exporting an entire instance.

## Instance backup (panel database)

- `src/modules/instance-backup/` — a snapshot of the panel DB **without pg_dump** (the API does not have its binary, and the panel's Postgres may be outside the `aoox` network): `database-snapshot.ts`
  `tableOrder(entityMetadatas)` (Kahn's algorithm over FKs, pure & unit-tested; cycle → error) → each table `SELECT row_to_json(t)` → one JSON `{format:'aoox-instance', version:1,
  migrations[], tables[]}` gzipped → written to the `aoox_backups` volume at `_instance/<stamp>.json.gz` via a stopped busybox + `putArchive` (`tarFiles` now accepts a Buffer).
  Entity `InstanceBackup` (`instance_backups`: filename, status success|failed, trigger, size, `row_count`, `schema_version` = latest migration, destination/remoteKey) — the row is written **after**
  the dump finishes so a snapshot never contains itself as "running"; `InstanceBackupSettings` (`instance_backup_settings`, one `default` row: cron, keep, destinationId).
- Restore (`json_populate_recordset(NULL::"t", $1)` per 500 rows in one transaction; DELETE in reverse order, then INSERT in FK order): the `migrations` lists must be **exactly equal** (400 if different —
  restore only works between identical versions), the `migrations` table is not touched, the `instance_backups` rows for this server are merged back (`ON CONFLICT DO NOTHING`, read as `row_to_json`
  because keys must be column names). Afterwards: `reloadAll()` on `JobSchedulerService`/`BackupSchedulerService`/`VolumeBackupSchedulerService` (remove their own cron entries, re-register from the DB),
  `RemoteDockerService.forgetAll()`, and a decryption probe of one encrypted value → a warning "ENCRYPTION_KEY differs" if it fails; a JWT_SECRET warning is always included. The containers are not touched.
- Flow (all `@Roles('owner')`): `POST /instance/backups` (synchronous, 201), `GET /instance/backups` (+`local` via `BackupFilesService.annotate`), `POST /instance/backups/:id/restore`
  (`ensureLocal` → pull from S3 if needed), `POST /instance/restore` (multipart `file`, `SNAPSHOT_MAX_BYTES` 256 MB — the new-server path), `GET .../download`, `DELETE`,
  `GET/PATCH /instance/backup-settings` (+`InstanceBackupSchedulerService.reschedule`; scheduled → `prune(keep)` applies only to scheduled ones). Failure → `backupFailure` notification.
  Web: `instance-backup-card.tsx` in Settings → Infrastructure (owner), download proxy `/api/instance-backups/[id]/download`, restore from a file via a multipart server action.
  Not yet: selective per-table restore, including registry mount/volume backups, cross-version restore (run migrations after restore).

## Instance update (aoox itself)

- `src/modules/instance-update/` — check and apply updates for the panel's own `aoox-api`/`aoox-web` images (not the apps users deploy — those are already covered by the separate
  `ImageDigestService`/`ImageUpdateWatcherService`). Previously it could only be done manually (`docker compose pull && up -d` over SSH, documented in the install docs).
- **Digest comparison, not version/tag**: `remoteDigestFor()` reuses `parseImageRef` (application module) + `fetchRemoteDigest` (registry module, `HEAD /v2/.../manifests/<tag>`)
  already used by `ImageDigestService` for app image auto-update — **always Docker Hub** (`hideandseeklab/aoox-api`/`aoox-web` are public, no credentials), with the tag taken from env
  `API_IMAGE`/`WEB_IMAGE` (default `:latest`, same as `docker-compose.dist.yml`). **Deliberately does not compare local `docker inspect`/`RepoDigests` with the registry digest** —
  the same lesson as app auto-update ("different representations can cause a redeploy loop"): the baseline is **always** stored from the same `fetchRemoteDigest()` used for the next check,
  never mixed with values from another source. `InstanceUpdateState` (table `instance_update_state`, single `default` row): `apiDigest`/`webDigest`/`checkedAt`.
  **First check** (baseline `null`) cannot tell whether the running version is already outdated — it only stores the current digest as the baseline and reports `updateAvailable: false`
  (`currentDigest: null` in the response, distinguishing it from "up to date" in the UI); this limitation is stated honestly rather than pretending to know.
- **Apply** (`POST /instance/update/apply`, owner, throttle 3/min, 202): exactly the same pattern as `panel-domain` — requires `INSTALL_DIR`, stores the new digest as the baseline,
  then `setTimeout` 1.5 seconds so the HTTP response can be sent before the `web`/`api` containers are recreated. A `docker:29-cli` helper (bind-mounts the host `INSTALL_DIR` directly + the
  docker socket; `runComposeHelper()` in `docker/compose-apply.util.ts`, shared with `panel-domain` and `instance-env`) runs `docker compose $FILES --env-file .env.dist
  pull` then `up -d`. **Pitfall that slipped through**: it was previously assumed that `-f docker-compose.dist.yml` alone was enough because the "override is included automatically" — wrong; Compose only auto-includes `docker-compose.override.yml` when the main file is named exactly `docker-compose.yml` (the default lookup without `-f`), not when `-f docker-compose.dist.yml` is given
  explicitly (found via a real VPS test: the panel domain disappeared again after `aoox update`). `COMPOSE_FILES_SCRIPT` (same util) builds `$FILES` with
  `[ -f docker-compose.override.yml ] && FILES="$FILES -f docker-compose.override.yml"` — the file may not exist at all (the panel domain has never been set). It does not touch
  a manual `docker-compose.domain.yml` (it needs its own explicit `-f`, outside the scope of this feature).
- `GET /instance/update` (owner) also returns `currentVersion` (read from `package.json` in `process.cwd()` — the runner image copies `package.json` to `/app/`, see the Dockerfile)
  for display, not for update comparison logic (the alpha channel does not necessarily increase linearly per tag; the digest remains the source of truth).
- CLI: `aoox update` (check) / `aoox update --apply` (apply). Web: `instance-update-card.tsx` in Settings → Infrastructure (owner), a "Check for update" button (server action, not just the initial render) and "Apply update" button (disabled if `INSTALL_DIR` is empty or there is no update).
  Not yet: notifications (email/webhook) when an update is available — the version signal below is only for the sidebar badge / Update page — and automatic rollback if `docker compose up` fails after the pull.
- **"Newer version available" signal for the sidebar** (`instance-version.service.ts`, `semver.ts`, `registry/remote-tags.ts`): the digest signal above is not enough — a `null` baseline on the first check cannot tell whether the running version is outdated, and it only runs when the owner presses the button. So there is a second source that is **version-based**: `fetchRemoteTags()` (`GET /v2/hideandseeklab/aoox-api/tags/list?n=1000`, same Bearer flow as `fetchRemoteDigest`) → `newestVersion(tags, currentVersion)` (pure semver.org 2.0.0: `alpha.9 < alpha.10`, stable > pre-release with the same core; non-semver tags such as
  `latest` are ignored; **stable installs are never offered a pre-release**, pre-release installs are offered anything newer) → stored in the `latest_version`/`latest_checked_at` columns
  (`instance_update_state`, migration `InstanceUpdateLatestVersion`, additive). Triggered by `@Cron('17 */6 * * *')` (+ random jitter up to 5 minutes) and once ~20–60 seconds after boot
  (`OnApplicationBootstrap`, `setTimeout(...).unref()`), **never** per request; network/registry failure = `debug` only, the old cache is kept, `latest_checked_at` is only set on success
  (installs without internet access keep working normally, without a badge). `check()` (`GET /instance/update`, "Check for update" button) also calls `refresh()` and returns a `version` block, so the page and sidebar
  always agree. **`updateAvailable` is derived at read time** (the cached version is newer than this process's `appVersion()`), not stored: the badge disappears immediately once the new container starts.
  **Pinned-tag installs**: `docker-compose.dist.yml` now passes `API_IMAGE`/`WEB_IMAGE` (defaults identical to the `image:` lines) to the api container, but **existing installs** only get them via `aoox reinstall` (`aoox update`/"Apply update" does not rewrite compose) — until then the env is empty; `tracked()` uses `API_IMAGE` when set,
  otherwise the container's own `Config.Image` (`inspectContainer(os.hostname())`, once per process) → `latest` (badge allowed), `pinned` (version/channel/digest tag — `pull` will not move it,
  so **no badge**; the Update page only informs about the latest version), or `unknown` (daemon unreachable / not a container — **no badge**, deliberately rather than misleading).
  `GET /auth/me` adds `updateAvailable: {version, applying}` **for `owner` only** (`MeService`, read from the cache without a registry call; any error → the field is omitted, so `/auth/me` never breaks because of it; other roles do not even trigger the cache read). `applying` is capped at 10 minutes since `applyStartedAt` so a failed apply does not lock the "Updating…" text forever.
  Env `INSTANCE_UPDATE_REGISTRY_URL` overrides the registry base URL (mirror/testing). Tested for real with a fake registry + a separate Postgres: higher version → owner gets the field, admin/member do not; same/older → gone;
  `alpha.10` > `alpha.9`; registry 500 → no error log, cache kept. **Not yet tested for real**: `pinned` tags against a real Docker container (unit tests only).
- **Optional variables passed by compose to api**: `API_IMAGE`, `WEB_IMAGE` (default = `image:`; do not let them differ — a CLI test guards this), `WEBHOOK_VERIFY_GITHUB_IP`
  and `PREVIEW_DOMAIN` (`${VAR:-}` = empty = off/unset; their readers use `=== 'true'` and `?.trim() ||`, so an empty string is safe — unlike the `??` pitfall). None of the four is written into a new `.env.dist` by `aoox install`/`reinstall` (no meaningful default) — only commented examples in `.env.dist.example`.
- **Important limitation**: `apply()` only does `docker compose pull && up -d` — it **never** rewrites `docker-compose.dist.yml` in the host's `INSTALL_DIR`. So fixes/new features that need new lines in the compose file itself (new `environment:` vars, new services, etc. — e.g. `PUBLIC_API_URL`, which is now also passed to the `api` service, see the Git credential & Webhook section) **do not reach** existing installs via `aoox update` / "Apply update" — the new image runs with the **old** compose file on the host,
  so the new environment is never applied until the host compose file is edited manually. Manual step: add the missing line to the right service in
  `/opt/aoox/docker-compose.dist.yml` (or another `INSTALL_DIR`), then `docker compose -f docker-compose.dist.yml -f docker-compose.override.yml --env-file .env.dist up -d`
  (`-f docker-compose.override.yml` only if that file exists — it is created by panel-domain/instance-env, see the Proxy & Domain section). An idea not yet implemented: `apply()`
  could also rewrite `docker-compose.dist.yml` from the copy bundled in the `api` image itself (the image already carries the new version of that file for other purposes) before
  `up -d`, so compose updates are applied automatically — not done yet, because it needs care: it could overwrite manual operator changes to that file (e.g. a local `docker-compose.build.yml`
  override, or lines the operator added on purpose).
- **Fixing old installs**: `aoox reinstall` in `../aoox-cli` closes the gap above — it rewrites `docker-compose.dist.yml` (+ `docker-compose.domain.yml` if present) from the CLI's bundled copy,
  **merges** `.env.dist` (values/order/comments kept, only missing keys with safe defaults are added, e.g. `TERMINAL_SSH_USER=root`; secrets are never regenerated,
  and it stops if `POSTGRES_PASSWORD`/`JWT_SECRET`/`ENCRYPTION_KEY` is missing), backs up to `<dir>/backups/<time>/`, then `pull` + `up -d --force-recreate` with the same `-f` list as the running stack (from the `com.docker.compose.project.config_files` label of the api container). `docker-compose.override.yml` (owned by panel-domain/instance-env) is not touched. Recommended — **not** `aoox install --force` (new secrets) — for installs that are behind on compose/env. Because the default keys are derived from `buildEnvFile` + the `${VAR}` references in the bundled compose,
  any new compose/env changes here must still be copied to `aoox-cli/assets/install/` (see the Docker / distribution section).

## Instance environment (part of `.env.dist`, from the dashboard)

- `src/modules/instance-env/` — a **whitelisted** subset of env vars the owner can change from the dashboard without SSH: `TERMINAL_SSH_HOST/PORT/USER/PASSWORD`, `PUBLIC_IP`,
  `REGISTRY_PUBLIC_HOST`. Same pattern as `panel-domain`/`instance-update` (requires `INSTALL_DIR`, a `docker:29-cli` helper via `runComposeHelper()`,
  `setTimeout` 1.5 seconds because changing these env vars recreates the `api` container — the only service that declares these vars in `docker-compose.dist.yml`).
  **Deliberately a whitelist, not a free-form editor**: adding a field here without also adding it to the `environment:` of the `api` service in `docker-compose.dist.yml` will never take effect (Compose only forwards vars that are declared there, even if `.env.dist` has other lines) — do not create new fields without checking that first.
  Vars such as `JWT_SECRET`/`ENCRYPTION_KEY`/`POSTGRES_PASSWORD` are **never** on this whitelist (changing them through a regular form is risky: it invalidates all sessions,
  breaks decryption of stored credentials, etc. — they must remain manual, done with full awareness).
- `GET /instance/env` (owner) returns the currently active values (`ConfigService.get()`, same as `panel-domain.status()` reads `WEB_ORIGIN`) — not the content of `.env.dist`
  which has not been applied yet. `terminalSshPassword` is **never** returned (only `terminalSshPasswordSet: boolean`), the same pattern as the notification/webhook DTOs, which never carry secrets on list/status endpoints.
- `GET /instance/env` also returns `terminalSshUserDefault` (`root`, from the same constant as the terminal backend): `terminalSshUser` remains the **raw value** (null when empty)
  so the form does not save a `root` the user never typed; the web shows `root (default)` as a placeholder + note while empty.
- `PATCH /instance/env` (owner, throttle 5/min, 202): each field is independent — omitted fields are left alone, and an empty string **removes** the value (back to the `${VAR:-default}` default
  in compose, e.g. `REGISTRY_PUBLIC_HOST=` empty → back to `localhost`). Only the keys actually sent are upserted into `.env.dist`
  (`envUpsertLine()`), so saving only the "SSH Terminal" section does not touch `PUBLIC_IP`/`REGISTRY_PUBLIC_HOST`. Web: `instance-env-card.tsx` in Settings → Infrastructure
  → **Environment** (owner), two sections (SSH Terminal, Network) with separate save buttons so you do not have to fill in everything at once.
  Not yet: whitelisting other frequently requested vars (e.g. `METRICS_RETENTION_DAYS`, `DISK_ALERT_PERCENT` — not present in `docker-compose.dist.yml` at all yet, so they must be added to compose before they can join this whitelist),
  validating that `TERMINAL_SSH_HOST` is actually reachable before saving.
- `docker/compose-apply.util.ts` (used by `panel-domain`, `instance-update`, `instance-env`): `envUpsertLine()` (pure, unit-tested) and `runComposeHelper()`
  (creates a `docker:29-cli` container, binds `installDir` + the docker socket, optionally writes files via `putArchive`, starts, waits, removes) — previously copied by hand in two
  places (and nearly a third time for this feature), now a single source of truth for the pattern "edit `.env.dist`/compose, then `docker compose up` from inside its own container".

## Docker Swarm (stages 1–2: single node, apps as services)

- `src/modules/swarm/` — `SwarmService` on top of the Engine API (`GET /swarm`, `POST /swarm/init|leave`, `GET/POST/DELETE /nodes`, client: `inspectSwarm/initSwarm/leaveSwarm/listNodes/
  inspectNode/updateNode/removeNode`, services: `createService/inspectService/updateService(version!)/removeService/listTasks/serviceLogs/followServiceLogs`, `connectNetwork`,
  `createOverlayNetwork`; types `SwarmNode/ServiceSpec/ServiceInspect/SwarmTask`). Flow (`/swarm`): `swarm-status` (owner/admin; join token owner only), `init-swarm` (owner; if the daemon is in `error` — expired certificate — run `leave --force` first), `leave-swarm` (409 while any app with `deployMode='service'` remains), `update-node` (drain/active, promote), `remove-node`.
  The module imports only the `Application` **entity** (not ApplicationModule — the runner imports SwarmModule, the other direction would be a cycle) + ProxyModule.
- **Network**: services cannot join the `aoox` bridge → an attachable overlay **`aoox-swarm`** (`SWARM_NETWORK` in proxy.service) is created at init; running proxy and managed DB containers are `connect`ed to it (`ensureNetwork`, also called on every service deploy) so Traefik can reach tasks and apps can reach DBs by name; proxies and managed DBs created afterwards are connected at provision time (`SwarmService.connectIfActive`, no-op without a swarm; ManagedDatabaseModule imports SwarmModule). Tested: a service task opens `${{database.<slug>.url}}` via the container name. `leave` removes its own overlay (a swarm-scoped network disappears with the swarm) and re-provisions the proxy without the swarm flag.
- **Traefik**: v3 has a separate provider — `provisionOn` adds `--providers.swarm=true|exposedbydefault=false|network=aoox-swarm|refreshSeconds=3` when the daemon is a manager
  (the swarm provider **polls**, rather than using events; the 15 s default kept old tasks routed briefly → 3 s). Init/leave swarm re-provisions the proxy if it is installed. Traefik labels are read from the **service** (`Labels`), while `aoox.*`/compose labels come from the **task container** (`ContainerSpec.Labels`) for monitoring/events — `serviceSpecFor` sets both.
- **Apps as services** (`Application.deployMode` `container`|`service`, `replicas` 1–20; create/update DTO, host only — `serverId` + service = 400; swarm disabled = 400):
  `service-spec.ts` `serviceSpecFor()` (pure, unit-tested): env/healthcheck/mounts (`mountFromBind` from `bindsFor` strings)/limits (`Resources.Limits`)/network/LogDriver/
  `EndpointSpec.Ports` `PublishMode: host` for `hostPort`/`UpdateConfig` `Parallelism 1, FailureAction rollback, Order start-first` (stop-first when a host port is set). The runner's
  `replaceContainer` branches: service → `SwarmDeployService.deploy(app, spec, auth, log)` (removes legacy `<name>`/`-next` containers, creates or `update?version=`, `waitConverged`
  = polls `UpdateStatus` (`completed`/`rollback_*`/`paused`) + tasks `running`/failed ≥3; if create fails the service is removed); container → the old service is removed first.
  Updates always bump `TaskTemplate.ForceUpdate` (an identical spec — same tag re-pulled — still rolls the tasks, just as container mode always recreates) and "our" update is recognized from an `UpdateStatus.StartedAt` that **differs** from before the call, not by comparing daemon and API clocks (tested: 3 identical deploys in a row succeed in ±15 s).
  Replicas > 1 with a `volume` mount = all tasks use the same volume on this node (a steady state, not only during a swap).
  `X-Registry-Auth` (`registryAuthFor`) for the local registry / private registry images. Changing mode/replicas in `update-application` → `applyRuntimeConfig` (redeploys the last image).
- Other paths: get-application `service` (`SwarmDeployService.status`: desired/running/tasks) + `container` derived from tasks; stop/start = `scale(0)`/`scale(replicas)`;
  delete = `removeService`; logs & gateway = `serviceLogs`/`followServiceLogs` (all tasks); metrics & job exec = the latest running task (`taskContainers`); restore of a volume backup = scale to 0 / back; `container-down-notifier`: swarm tasks are reported only when `running < desired` ("task crashed (1/2 replicas)"); rolling updates do not trigger it. Tested: 2 replicas via Traefik,
  rolling update 119/120 requests 200, stop/start, job exec, killing a task → replaced + notification, switching modes back and forth, deletion.
- **Stage 3 (multi-node)**: `Application.swarmNodeId` (nullable; create/update DTO `@Matches` a node id) → `Placement.Constraints` `node.id==…` (`serviceSpecFor.constraints`);
  an app **with mounts** is always pinned to the host node (`placementFor`: volume/file mounts exist only on this daemon); changing the node → `applyRuntimeConfig`. `ServiceStatus.tasks[]` carries
  `nodeId`/`node` (hostname from `listNodes`)/`local`; `taskContainers()` only returns tasks **on this node** (`SwarmService.localNodeId`) because the Engine API has no cross-node exec/stats —
  a `target: container` job on an app whose tasks are all on other nodes → a clear error (use `run` or pin to the host), metrics `null`; service logs still span nodes.
  `SwarmStatus.registry` `{url, reachableFromNodes}`: a `localhost:` registry URL cannot be pulled by other nodes → the web card shows a warning (set `REGISTRY_PUBLIC_HOST` + `insecure-registries`/TLS,
  re-provision the registry); public images are unaffected. Tested with a `docker:27-dind` worker that joined the Docker Desktop swarm: tasks scheduled on the worker (pinned) / on the host (mounts),
  logs across nodes, the exec message. **Cannot be tested here yet**: VXLAN overlay traffic between the Docker Desktop VM and the dind (control plane works, data plane times out in both directions — an environment limitation,
  needs a real second machine); on a real machine Traefik → tasks on other nodes uses the same path as single-node. Not yet: combined metrics across tasks, DB/compose/preview as services,
  `docker stack deploy`, constraints other than `node.id`.
- **Service observability**: metrics for an app service = **sum of all local tasks** (`aggregateMetrics()` in `container-metrics.ts`, pure & unit-tested: `current` = the sum of the latest samples,
  `history` bucketed per 15 s sampler tick; the `tasks` response = the number of tasks summed). `service-health-watcher.service.ts` (`@Cron('*/2 * * * *')`): an app service that is `running` with
  `running < desired` on **two consecutive ticks** → a `containerDown` notification "Service short of replicas" (+ pending tasks and their error), 30-minute cooldown — complementing container-down-notifier,
  which is blind to tasks that never start (unschedulable, image cannot be pulled). Changes to an app service's mode/replicas/node/limits = **`kind: 'config'` deployment**
  (`DeploymentRunnerService.queueRuntimeConfig`, rollback path without a build; 409 if another deployment exists) — not synchronous, because a rolling update can take minutes. A start-first update whose new task never runs (impossible constraint, missing image) never fails by itself → `waitConverged` times out → `engine.rollbackService(id, version, spec)`
  (`?rollback=previous`, the body must be a valid spec even though it is ignored; an empty body = socket hang up) → the daemon restores `PreviousSpec`; `statusAfterFailure` keeps `status: 'running'`
  while the old tasks still serve. Tested: a bogus node → deployment `failed`, service `rollback_completed`, app still 2/2 running; `docker service update --replicas 3` + an impossible constraint → the short-replicas notification. Rolling back to an older deployment is already covered by the normal rollback flow (updating the service with the old image).
- **Node labels & constraints**: `PATCH /swarm/nodes/:id {labels}` replaces the node's full label set (key `[A-Za-z0-9_.-]`, value `[A-Za-z0-9_.:/-]`; shown in `SwarmNodeInfo.labels`).
  `Application.swarmConstraint` (regex `SWARM_CONSTRAINT`: `node.(id|hostname|role|platform.os|arch|labels.<k>)(==|!=)<v>`) is combined with `swarmNodeId`/host pinning in `placementFor`
  (all constraints must be satisfied). **Rolling update parameters** per app: `updateParallelism` (1–20), `updateDelaySeconds` (0–600), `updateOrder` `auto|start-first|stop-first`
  (`serviceSpecFor.update`; start-first is **not honored** when a host port is set). Changing either in update-application = a `config` deployment. Web: the "Additional constraint" field,
  "Rolling update" (tasks per batch + delay) and "Order" in the form when in service mode; inline label editor per node on the Swarm card (owner).

## Deploy stepper, notification inbox, onboarding

- **Deploy step timing**: `deployments.step_times` jsonb (`{building?, pushing?, starting?}` = ISO time when each step was **first** reached; `deployment-steps.ts` `recordStep`, pure).
  Written in `DeploymentLog.setStatus` (runner) and persisted via the existing `flush`; `queued` = `createdAt`, completion = `finishedAt`. Failure midway → only the steps reached are present. `starting` is announced twice (health check) → the first one wins. Image pulls use the `building` status. `list-deployments` (explicit select) and
  `get-deployment` return `stepTimes` (null on old rows); the `deployment:status` event carries an optional `at` (`/logs` socket).
- **Inbox** (`src/modules/inbox/`): every event that goes through `NotificationService.broadcast` is first recorded in `inbox_events` (`InboxService.record`, never throws) **before**
  channels are chosen — independent of toggles/channels, with the same text as the channel message (already redacted). The project is derived from `data.applicationId|composeAppId|databaseId`
  (`inbox-target.ts`); events without a project (disk, server, certificates…) are platform-level, visible to owner/admin only. Reads (`InboxFeedService`: `GET /inbox?limit&before` + `unread`, `POST /inbox/read`)
  are filtered by `ProjectAccessService.accessibleProjectIds`; read status is per user via `users.inbox_read_at` (default `now()` at migration time → no old backlog). Retention 30 days + 1000
  rows (`@Cron('40 3 * * *')`). **Module cycle**: `InboxModule` (storage, entity only) is imported by `NotificationModule`; the reader (`InboxFeedModule`, needs `ProjectModule`) is registered in `AppModule`.
- **Onboarding** (`src/modules/onboarding/`): `GET /onboarding` (owner only; other roles get `visible:false` without a query); the registry/proxy/panelDomain (optional)/project/workload steps are computed from
  real state with `exists`/`count` checks; the proxy comes from `ProxyService.status()`, cached for 30 seconds (Docker down = step left open). `POST /onboarding/dismiss` (`@Roles('owner')`, audit log) stores
  `users.onboarding_dismissed_at`. It disappears by itself once all required steps are complete. Migration `InboxAndOnboarding` (tables + two users columns).
  **`params`** (`inbox_events.params` jsonb nullable, migration `InboxEventParams`; `NotificationMessage.params`, inbox-only — never sent to channels): the structured facts behind the English `title`/`summary`,
  so the web can compose sentences in the active language. A flat shape (`InboxParams`: string/number/boolean/null; `inboxParams()` in `inbox-target.ts` drops anything else, truncates strings to 500 characters,
  max 20 keys), with a special `variant` key for events that have several meanings. Contract per event (the web mirrors it in `features/inbox/inbox.describe.ts` — change both together):
  `deploymentStarted` {kind deployment|rollback, application, project, trigger, commitSha, commitMessage, triggeredBy}; `deploymentSuccess`/`deploymentFailure` {kind, application, project, durationSeconds, error};
  `deploymentFailure` `compose` {stack, source, error}; `backupFailure` `database` {database, engine, trigger, error} / `volume` {application, volume, trigger, error} / `instance` {trigger, error};
  `jobFailure` {job, status}; `containerDown` `application` {application, project, restarting, exitCode, server} / `task` {application, project, running, desired} / `database` {database, restarting, exitCode} /
  `stack` {stack, service, restarting, exitCode} / `replicas` {application, project, running, desired}; `diskLow` {usedPercent, usedBytes, totalBytes, availableBytes, thresholdPercent};
  `certificateFailure` `expired`|`expiring` {certificate, domains, notAfter} / `acme` {domain, reason}; `dnsIssue` {domain, application, project, status, since}; `appError` {application, project, count};
  `serverDown` `down` {server, reminder, error} / `recovered` {server, downSeconds}; `httpDown` `down` {application, project, target, reminder, error, statusCode, failedChecks} / `recovered` {application, project, downSeconds}; `resourceAlert` `alert` {kind application|database, name, project, metric cpu|memory, value, threshold, durationMinutes, reminder} / `recovered` {kind, name, project, metric, threshold, breachSeconds} (`data` carries `applicationId` or `databaseId` so the inbox finds the project).
  **Do not** put secrets, log excerpts, or command output into it (job: no output; appError: the count only); the only free text is the system's own error message (≤ 500 characters). New events or new variants in the API still show on the web (falling back to the English `title`/`summary`) until the web adds their sentences. Old rows (`params` null) also display as they are. Tested for real on Postgres: successful/failed deploys and a dying container fill `params` correctly; the additive migration works on an empty DB.

## DNS provider (Cloudflare) and DNS-01 certificates

- `src/modules/dns-provider/` — DNS provider accounts, **Cloudflare only for now**. Entity `DnsProviderConnection` (`dns_provider_connections`: `name` unique, `provider`, `api_token_encrypted` `select:false` AES via `secret.util` + `ENCRYPTION_KEY`, optional `account_id`), entity `ProxyDnsBinding` (`proxy_dns_bindings`: which connection answers DNS-01 for a proxy, `server_id` null = the aoox host, partial unique indexes like the dynamic config files). Flows `create/list/delete-dns-connection` (`/dns-connections`; create/delete/test owner/admin, list = every member, names only), `test-dns-connection` (`POST /:id/test`, throttle 20/min: token verify + the zones it can see, never echoes the token). Delete is a 409 while a domain or a proxy binding uses it (FK RESTRICT behind it), because aoox could no longer clean up the records it created. The module imports no feature module (it only reads the `Domain` entity), so application, proxy and proxy-dns import it. Migration `DnsProviders` (additive).
- `cloudflare.client.ts`: plain `fetch` + `AbortSignal.timeout(10s)`, no SDK. Paths follow developers.cloudflare.com/api: `GET /user/tokens/verify` (or `/accounts/:id/tokens/verify` when an account ID is set: account-owned tokens), `GET /zones?name=`, `GET/POST /zones/:id/dns_records`, `PATCH`/`DELETE /zones/:id/dns_records/:rid` (create sends `ttl: 1` = automatic and the comment "Managed by aoox"). Errors are `DnsProviderError` with a short text (`Cloudflare answered 403: <first API message>`, `Could not reach Cloudflare (ECONNREFUSED)`), never the token or the URL. **`CLOUDFLARE_API_URL`** (read with `?.trim() ||`, empty = default) overrides the base URL for tests against a fake server; it is deliberately **not** passed in `docker-compose.dist.yml`. Zone choice (`zone-match.ts`, pure): exact-name lookups of the host suffixes longest first (`a.b.example.com`, `b.example.com`, `example.com`, never a bare TLD), so a token scoped to one sub-zone works and the longest zone wins.
- **Records for application domains** (`dns-records.ts` `syncHostRecord`/`removeManagedRecords`, pure given a client, unit-tested; `application/domain-dns.service.ts` stores the outcome). Domain columns: `dns_connection_id` (FK RESTRICT), `dns_proxied` (default **false**: Traefik must see the real host and answer certificate challenges; the web explains it), `dns_records` jsonb (`{zoneId, recordId, type, name, content}` of the records aoox created: **the only ones it ever deletes, by id, without listing anything**), `dns_status` `ok|warning|error`, `dns_message`. Target IP = `CheckDomainDnsService.expectedIp(app)` (now public; remote server host, `PUBLIC_IP`, or auto-detected); an IPv6 value makes an AAAA instead of an A (there is no separate IPv6 env). Rules: an owned record that drifted is patched in place; a record with other content is **not** touched unless `dnsOverwrite` (then it is updated and adopted); an identical foreign record is left as it is and not tracked (never deleted later); a CNAME on the name blocks creation; no zone or a provider error is a warning. **DNS never fails the request**: `add-domain` returns an additive `dnsWarning` (null when fine), and the domain carries `dnsStatus`/`dnsMessage`. The sync runs before `applyRuntimeConfig` so the first certificate request finds the name. Cleanup (best effort, failures only logged): delete-domain, delete-application (not the project cascade, which removes rows only: the records stay), detaching a connection through PATCH. `PATCH .../domains/:domainId` accepts `dnsConnectionId` (null/"" detaches), `dnsProxied`, `dnsOverwrite`, `certMode`; `POST .../domains/:domainId/dns/sync {overwrite?}` retries (developer and up, viewers get 403 through the write rule); `GET /applications/:id/dns-options` returns `{proxyDnsEnabled}` for every project member. Not done: compose stack domains and database companion hosts (they keep manual DNS), a DNS check against Cloudflare itself, a record for the preview wildcard (create `*.preview` yourself).
- **ACME DNS-01** (`ProxyService`): when `proxy_dns_bindings` has a row for a proxy **and** the proxy has an ACME email, `provisionOn` adds the resolver `le-dns` (`--certificatesresolvers.le-dns.acme.{email,storage=/letsencrypt/acme-dns.json,dnschallenge.provider=cloudflare[,caserver]}`, its own storage file because two resolvers must not share one acme.json) and the container env `CF_DNS_API_TOKEN` (the lego variable; the token needs Zone:Zone:Read and Zone:DNS:Edit). The token is therefore visible to `docker inspect` on that machine, like other secrets handed to containers; the web says so. `ProxySettings` gained optional `serverId` (null/undefined = host; `proxySettingsOf(server)` and `localSettings` set it, `settingsOf` keeps it from the fallback) to find the binding, and `dnsChallenge` (set by callers that built labels for a proxy that really has the resolver). **The container is the truth, not the DB**: `ProxyStatus.dnsChallenge` and `ProxyService.dnsChallengeActive(docker)` read the running container command, because a router that names a missing resolver is dropped by Traefik. Labels (`buildLabels` option `dnsResolver`, `RoutedDomain.dns`): without `dnsResolver` the output is byte-identical to before (unit-tested, including domains that ask for DNS-01); with it, an https host that asks goes on its own router `<name>-secure-dns[-<hash of the wildcard base>][-m<hash>]` with `tls.certresolver=le-dns` and, for a wildcard, `tls.domains[0].main=<base>` + `sans=*.<base>`; the http redirect router still covers it; custom-certificate hosts are never routed through DNS-01. Verified against a real Traefik v3 (a throwaway container with the same flags: the routers parse, `tls.domains` show in the API, both resolvers initialise; only the ACME issuance itself could not be tried).
- `Domain.cert_mode` (`http` default | `dns` per host | `dns-wildcard` for the parent domain `host.split('.').slice(1)`, `cert-mode.ts` `assertCertMode`/`dnsRouting`): needs https, no uploaded certificate and a DNS-01 binding on the application proxy (400 otherwise); the runner asks the container (`dnsChallengeActive`) only when a host wants DNS-01 and otherwise falls back to HTTP-01 with a warning. `Application.preview_wildcard_cert` makes previews use `{dns: {main: <preview domain>}}` (one `*.<preview domain>` certificate; needs a wildcard DNS record the operator creates). Maintenance mode routers mirror it (`appDynamicConfig` option `dns`: `certResolver: 'le-dns'` + `domains`). Imports keep a DNS-01 mode only when the destination proxy has the binding, else HTTP-01 + a warning; `previewWildcardCert` is not imported.
- `src/modules/proxy-dns/` — flows `GET /proxy/dns?serverId=` (owner/admin: connection, `proxy` state, `active`, `acmeEmail`, `needsRecreate`, `usedBy`), `PUT /proxy/dns {connectionId, serverId?, acceptProxyRestart?}` and `DELETE /proxy/dns?serverId=&acceptProxyRestart=` (owner, throttle 10/min). It follows the `proxy-restart-required` pattern: a **running** proxy is only recreated after `acceptProxyRestart: true`, otherwise 409 `{code: 'proxy-restart-required'}`; a stopped or missing proxy just saves the binding. A recreate failure restores the previous binding (502). Enabling needs the proxy ACME email (400 otherwise). Disabling is a 409 naming the domains/apps still using DNS-01 (deliberately strict, like middlewares). The module imports ProxyModule, ServerModule and DnsProviderModule and is registered in `AppModule`; `ProxyModule` imports `DnsProviderModule` (not the reverse).
- **Export/import**: `domains[].certMode` and `domains[].dns {connection (NAME), proxied}`, never a token or a record id; a missing connection is a warning + unmanaged DNS; an import creates no record (use the sync button).
- **Tested**: unit (client with a fake `fetch`, zone matching, record rules including delete-only-own, labels unchanged without a provider and with `le-dns` + wildcard, provisioning flags and env, DTOs, redaction of `apiToken`, import by name, maintenance routers) and for real over HTTP against a local fake Cloudflare (exact paths and the Bearer header checked; 65 assertions: create/overwrite/identical/CNAME/no-zone/longest zone/proxied flag/detach/delete-only-own/export/import/audit log/member 403), plus the web in headless Chrome. **Not tested**: a real Cloudflare account, real DNS-01 issuance, recreating a real proxy with DNS-01 (the enable path is unit-tested; the test only used the 409 and a binding inserted by SQL), remote servers over SSH, swarm.
