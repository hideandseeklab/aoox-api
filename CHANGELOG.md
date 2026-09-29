# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions below 1.0.0 may include breaking changes in a minor release.

## [Unreleased]

### Added

- `instance_update_state` gets two new columns, `apply_started_at`/`apply_from_version`, so
  `GET /instance/update` and a new lightweight `GET /instance/update/progress` (no registry calls —
  see below) can report `applying: boolean` for the "Terapkan update" flow on the dashboard: set by
  `apply()` (the version this process was on when the restart was triggered), cleared the next time
  either endpoint runs on a process that's either on a different `currentVersion` than recorded, or
  is simply a newer OS process than `applyStartedAt` (`Date.now() - process.uptime() * 1000`, a few
  seconds of tolerance for clock precision) — a `docker compose up` recreate always starts a fresh
  process even when a `:latest` tag gets republished under the same `package.json` version (a hotfix,
  or a local `docker-compose.build.yml` build), which the version-only comparison alone could never
  detect, leaving the dashboard stuck on "applying" until its own timeout despite the update having
  actually worked. Survives both a browser reload and the API's own restart, since it's DB state
  rather than anything in-memory.
- `GET /instance/update/progress` (owner): a second, cheap poll target for the same "is the update
  done yet" question `GET /instance/update` already answers, but without `GET /instance/update`'s two
  Docker Hub digest lookups — needed because the web dashboard now polls every few seconds for up to
  several minutes while an update applies, and hitting the registry that often was unnecessary load
  for a question ("has this process's version changed") that never needed a registry call in the
  first place.

### Fixed

- The "Terapkan update" button's UX bug reported by a user upgrading a real VPS from alpha.2 to
  alpha.3: clicking it briefly showed a red "Tidak dapat terhubung ke server" error (expected — the
  `api`/`web` containers were mid-restart) and then just sat there on the old version number forever
  with no indication anything was happening, even though the update itself had actually succeeded.
  The fix is entirely on the web side (see its changelog) — the API changes above exist to give the
  dashboard something durable and cheap to poll while it waits out the restart.

## [0.1.0-alpha.3] - 2026-09-28

### Added

- Interactive **Console** for applications (`docker exec -it` into the app's container from the
  dashboard, namespace `/console`): `DockerEngineClient.execTty()` creates a TTY exec and hijacks
  `POST /exec/{id}/start` (`Connection: Upgrade`/`Upgrade: tcp`, docs.docker.com/reference/api/engine/
  "Hijacking") to get the raw duplex socket instead of a buffered response — no 8-byte frame header to
  strip in TTY mode, so stdout/stderr flow as plain bytes exactly like a real terminal. Works
  unmodified for apps on a remote server: the hijack just rides whatever transport `DockerEngineClient`
  already had (`{socketPath}` locally, the SSH `docker system dial-stdio` agent remotely — both are
  plain `Duplex`es to Node's `http.request`). Shell: `sh -c 'command -v bash >/dev/null 2>&1 && exec
  bash || exec sh'` (bash if present, else sh); a distroless/scratch container with no shell at all
  hijacks fine and streams the daemon's own `OCI runtime exec failed: ... executable file not found`
  error as normal terminal output before exiting non-zero — verified against `registry.k8s.io/pause`
  (a real always-running, shell-less image) rather than translating a synthetic message, since that's
  exactly what a real `docker exec -it` CLI shows too.
  Access: `POST /applications/:id/console-ticket` (`create-console-ticket/`, throttle 20/menit) resolves
  and **binds** a specific already-running container into a 60s single-use JWT ticket (`scope:
  'console'`) — never derived from the socket handshake, same pattern as the terminal ticket's
  `serverId`. Container mode → `aoox-app-<appName>` via `RemoteDockerService.forServer(app.serverId)`;
  swarm service mode → `SwarmDeployService.taskContainers(app)` (tasks on this node only), default =
  newest, or an explicit `containerId` validated against that list. This route is **not** in
  `request-context.ts`'s `READ_ONLY_POSTS`, so — unlike `log-ticket` — it counts as a write: a project
  `viewer` gets 403 and a `readOnly` API token gets 403, both for free from the existing
  `ProjectAccessService`/`JwtAuthGuard` machinery, with no new access-control code. Every ticket
  request is an ordinary non-GET request reaching the handler, so it's captured by the existing audit
  log interceptor automatically (`POST /applications/:id/console-ticket`, actor + status). `ConsoleGateway`
  mirrors `TerminalGateway`'s ticket-consumption/origin-check pattern; event protocol (`input`/`resize`/
  `output`/`exit`/`error`) is identical to the host terminal's. Verified for real: bash and sh-only
  (alpine) containers both hijack and echo correctly with the right shell picked, `resize` doesn't
  throw, a stopped container is rejected before hijacking with a clear message, exit codes come back
  correctly via `GET /exec/{id}/json` after the socket closes — and the full ticket→gateway→exec chain
  end-to-end through the real HTTP + WebSocket stack (not just the Docker client in isolation),
  including viewer 403, read-only-token 403, developer 200, wrong-origin rejection, and ticket-reuse
  rejection, each against a real signed-in account. Not independently tested in this session: a real
  remote SSH server or a real Swarm cluster (both simulated/verified for other Docker Engine API calls
  elsewhere in the codebase; the hijack mechanism itself is transport-agnostic by construction, but
  recommend a real-VPS/real-swarm smoke test before fully trusting either path).
- New notification event **Application error** (`on_app_error`, off by default for every channel —
  log-based detection is prone to false positives; migration `AppErrorDetection` adds the column plus
  `applications.ignore_error_logs`): `app-error-watcher.service.ts` polls each running
  application's container log every minute (`GET /containers/{id}/logs?since=`, not a permanent
  `follow` stream) for lines matching common error shapes (tracebacks, panics, unhandled rejections,
  `FooError:`/`[ERROR]`/`level=error` markers, structured JSON `level`/`severity`), and sends one
  notification per app per check with up to 3 example snippets and a link to the app. Cooldown 15
  minutes per app, except a never-seen-before error shape always gets through. Env values that look
  like secrets (key contains PASSWORD/SECRET/TOKEN/KEY) and resolved database passwords are redacted
  from the snippets. New per-application switch **Ignore error logs** (`ignoreErrorLogs`, Pengaturan
  tab) opts an app out entirely, for apps whose normal output just looks like errors.
- Managed database: new engine **Valkey** (`valkey/valkey`, drop-in Redis replacement — same
  `--requirepass`/AOF setup, `redis-cli`/`redis://` compatible, verified the image ships both
  `valkey-cli` and a `redis-cli` symlink) and three **PostgreSQL variants** —
  `ManagedDatabase.variant` (`pgvector` | `postgis` | `timescaledb` | null; migration
  `DatabaseVariantAndValkey`): same `engine: 'postgres'`, same wire protocol/env/URL/backup
  (`pg_dump`/`pg_dumpall`), just a different image (`pgvector/pgvector:pg16`,
  `postgis/postgis:16-3.4`, `timescale/timescaledb:latest-pg16` — tags verified against Docker Hub)
  with the extension activated automatically (`CREATE EXTENSION IF NOT EXISTS`) once the container
  accepts connections (`ManagedDatabaseService.activateVariantExtension`, non-fatal on failure).
  `engines.ts` gained `imageNameFor()`/`defaultTagFor()` (variant-aware image/tag resolution, used by
  provisioning, backups, and the data browser's one-off helper containers) and
  `POSTGRES_VARIANTS`/`PostgresVariant`. Every `engine === 'redis'` special case in the data browser
  and schemas service now also covers `'valkey'` (`Record<DatabaseEngine, ...>` types caught every
  spot at compile time). Tested for real against Docker: pgvector (extension + vector column +
  backup/restore), PostGIS and TimescaleDB (extension activation is a no-op — both images already
  self-activate on first start — plus a hypertable smoke test), and Valkey (full backup → wipe →
  restore cycle using the existing Redis AOF-manifest recipe, unmodified). Web: create-database
  dialog gets an engine option for Valkey and a "Varian" picker for PostgreSQL (pgvector/PostGIS/
  TimescaleDB, each with a one-line description and its own default tag placeholder).
- Managed database: new engine **MongoDB** (`mongo:7`, root user via `MONGO_INITDB_ROOT_*`, kept as
  its own `engine: 'mongodb'` rather than folded into the Postgres variant model — different wire
  protocol/backup tooling entirely). Since Mongo creates databases lazily (no `CREATE DATABASE`),
  `ManagedDatabaseService.initMongoDatabase()` waits for `mongod` to accept connections then writes
  one placeholder document (`_aoox_init` collection) so the primary database shows up in `schemas/`
  immediately, mirroring the `activateVariantExtension` pattern (non-fatal on failure, credentials
  passed via `Env` not interpolated into the script). `SchemasService` gained a real `mongodb` branch
  (`mongoDatabaseNames`/`mongoCreateDatabase`/`mongoDropDatabase` on `DatabaseQueryService`, backed by
  `db.adminCommand({listDatabases:1,...})`/`insertOne`/`dropDatabase`) — unlike Redis/Valkey, Mongo
  does support named databases. `BACKUP_RECIPES.mongodb` uses `mongodump`/`mongorestore --archive
  --gzip` (self-contained gzip, no `gzipped()` wrapper needed); `dumpAll`/`restoreAll` excludes
  `admin`/`local`/`config` via `--nsExclude` so a full-server restore never overwrites the root user's
  own credentials. Data browser: `listTables`/`tableRows`/`exportTableCsv` work against collections
  (`mongoFind()` + new `mongoDocsToRows()` pure renderer — union of keys across the batch, `_id`
  pinned first); `columns()`/`updateRow()`/`deleteRow()`/SQL export/import all reject with a clear
  400 (schemaless, no fixed columns yet). Query box supports `<collection>.find({...})` only
  (read-only for this first pass) via `buildMongoFindScript()` — the filter is parsed as strict JSON
  and re-serialized before being embedded in the generated `mongosh --eval` script, which is what
  stops a filter like `{}); db.dropDatabase(); ({` from escaping the `.find(...)` call and running as
  arbitrary mongosh JS (verified: the real API rejects it with 400, database left untouched). Every
  `mongosh` result is wrapped centrally in `EJSON.stringify(..., {relaxed: true})` inside the new
  `mongo()` helper — mongosh's default REPL output for a plain value is shell-inspect format
  (`[ 'a', 'b' ]`), not JSON, which would otherwise make `listTables`/`mongoDatabaseNames`/
  `mongoCreateDatabase`/`mongoDropDatabase` fail to parse their own output (caught before release via
  a real Docker run, not just the unit tests). Web: engine option "MongoDB" in the create-database
  dialog (no Variant field, since Mongo has no variants); data browser UI gets a third `isMongo` mode
  alongside SQL/Redis — collection list ("Koleksi"), rows grid, sorting, and CSV export all work;
  Structure tab, create-table dialog, row edit/delete, and SQL export/import are hidden (not
  supported yet). Tested for real end-to-end through the actual HTTP API (not just standalone Docker
  commands): provision → tables → schemas (create/list/drop) → rows → query (including the injection
  attempt, rejected) → backup → restore → cleanup, plus a plain-Postgres regression check after the
  change (still works unmodified) and a visual pass through the create-database dialog and data
  browser in a real browser.
- **Resource usage per project**: `GET /projects/:id/resource-usage` (CPU%/memory/network, live only,
  for the project detail page) and a new `resourceUsage` field on every item of `GET /projects` (list
  page cards) — both read the existing 15-second `MonitoringService` sampler, no new Docker calls per
  request. `ProjectResourceUsageService.containerProjectMap()` groups the containers the sampler
  already tracks by the project that owns them: application/database containers carry an `aoox.project`
  label directly (no DB round-trip), compose stacks don't (`compose-runner.service.ts`'s override only
  stamps `aoox.component`/`aoox.compose`) so those — and "bare" stacks with no override at all,
  recognised the same way `MonitoringService.sampleAll()` does via `com.docker.compose.project` —
  are resolved with one `compose_apps` lookup by id/slug, batched across every project in a single
  call (not per card). `buildProjectUsage()` (`project-resource-usage.util.ts`, pure, unit-tested)
  reuses `aggregateMetrics()` (already used for swarm tasks/compose services) to sum a project's
  containers into one series, then converts the summed cumulative network counters into a bytes/sec
  rate from consecutive sampler ticks (a raw cumulative sum across containers with different start
  times is meaningless) — a container leaving the sum mid-window clamps the rate to zero instead of
  reporting negative. Live only, no stored history (`24h`/`7d`/`30d` ranges): see AGENTS.md for why
  storage usage specifically stays out of this endpoint.
- **Delete image** (`DELETE /registries/:id/repositories/*repository?force=`, self-hosted registry
  only): removes an entire repository — every tag's manifest, the repository's own folder in storage,
  then an automatic garbage-collect pass and a registry restart — found by the user on a VPS after
  deleting every tag of a repo and running garbage collect: the repo still showed up in the catalog
  with "0 tag" forever, because `registry:3` builds its catalog from folder names on disk and neither
  the Distribution API nor GC ever deletes a repository's own folder, only unreferenced blobs/manifests
  inside it. `GET /registries/:id/repositories/*repository/usage` previews which applications'
  `currentImage`/`imageRef` look like they came from the repo; deleting without `?force=true` 409s with
  that same list (rollback or a config-only redeploy to that image would fail after deletion). Local
  storage is cleaned via a one-off busybox helper (`Cmd` array, no shell); S3-backed registries get a
  new `BackupDestinationService.purgeDir()` (`rclone purge`). The registry container is restarted after
  GC because `registry:3`'s default in-memory blob-descriptor cache would otherwise still believe a
  just-deleted blob exists, making a later `docker push` of the same layer skip re-uploading it and
  leaving a manifest that points at nothing — verified for real: pushed two repos sharing a blob,
  deleted one, confirmed the other survived and disk actually shrank after GC, then rebuilt and pushed
  the exact same content and confirmed it both re-uploads and pulls correctly. Also verified: the exact
  reported 0-tag scenario, an external registry rejected with 400, and a read-only API token rejected
  with 403.

### Fixed

- `RegistryService.apiBaseUrl()` used `config.get('REGISTRY_INTERNAL_URL') ?? fallback` — `.env`'s
  `REGISTRY_INTERNAL_URL=` (left blank, not removed) is an empty string, not `undefined`, so `??` never
  fell back and every `RegistryClient` call (list repositories/tags, delete tag, test registry, and the
  new delete-image above) failed with a 500 `Invalid URL` against a self-hosted registry — the same
  pitfall already known for `DOCKER_SOCKET`. Found running the delete-image feature above against a
  real dev server (a mocked unit test never reads the real `.env`); fixed by switching to `||`.
- `POST /applications` rejected creating an application with `dockerfilePath must match
  /^[\w./-]{1,200}$/ regular expression` for `buildType: 'nixpacks'`/`'railpack'` — same root cause as
  the `update-application.dto.ts` fix, this time in `create-application.dto.ts`: the web form only
  mounts the Dockerfile-path field for `buildType: 'dockerfile'`, so creating an app with any other
  build type submits `dockerfilePath: ""` (found testing Nixpacks against a real VPS). Applied the
  same `@ValidateIf((_, v) => v !== '')` fix to every affected field in the create DTO
  (`dockerfilePath`, `gitBranch`, `staticOutputDir`, `staticBuildCommand`, `healthcheckPath`,
  `previewDomain`); `gitUrl`/`imageRef` were already correctly gated on `sourceType` and needed no
  change. Also fixed `create-application.service.ts` normalizing `gitUrl: dto.gitUrl?.trim() ?? null`
  (only defaults on `null`/`undefined`, not `""`) to `|| null` like every other nullable field, and
  `staticBuildCommand` to trim + default to `null` instead of storing `""` verbatim — both could leave
  an application with `""` in a nullable column instead of `null`. Audited `compose-app.dto.ts` /
  `create-compose-app.dto.ts` and `add-mount.dto.ts` for the same shape: not affected — the compose
  form uses a completely different zod schema per `source` (git vs template) that omits irrelevant
  fields entirely rather than sending them as `""`, and the mount dialog builds its request body as a
  plain JS object with conditional spreads, so neither ever sends an empty string for a field its own
  form section didn't render.
- `POST /notifications` had no way to set `onDnsIssue` — the entity/event-broadcast side of the "DNS
  domain bermasalah" toggle (`on_dns_issue`, `dns-watcher.service.ts`) has existed since that feature
  shipped, but `CreateNotificationDto` never declared the field and `CreateNotificationService`
  hardcoded every other toggle's default without it, so a new channel's DNS toggle was silently stuck
  at the column default (`true`) no matter what the create form sent. Found auditing every `on_*`
  column against its DTO/web/docs coverage for an unrelated web task. Added `onDnsIssue?: boolean` to
  the DTO and `onDnsIssue: dto.onDnsIssue ?? true` to the service, matching every other toggle's
  pattern.

## [0.1.0-alpha.2] - 2026-09-27

### Added

- Setting a custom panel domain now automatically provisions the Traefik proxy first if it isn't
  already running, instead of silently applying Traefik labels to `web`/`api` with nothing listening
  on ports 80/443. A proxy that's already running is left untouched (its ACME settings aren't
  overwritten just because the panel domain was saved again).
- `GET`/`PATCH /instance/env` (owner only): a whitelisted subset of the panel's own `.env.dist` —
  `TERMINAL_SSH_HOST/PORT/USER/PASSWORD`, `PUBLIC_IP`, `REGISTRY_PUBLIC_HOST` — editable from the
  dashboard instead of SSH, same apply pattern as panel-domain/instance-update (recreates the `api`
  container). Secrets like `JWT_SECRET`/`ENCRYPTION_KEY`/`POSTGRES_PASSWORD` are deliberately not
  in this whitelist.
- `docker/compose-apply.util.ts`: shared `envUpsertLine()` and `runComposeHelper()`, extracted out of
  panel-domain and instance-update (which had copy-pasted the same `docker:29-cli` helper-container
  logic) now that a third feature (instance-env) needed it too.
- Host-port collision check on application create/update (`POST/PATCH /applications`): rejects a
  `hostPort` already used by another application, a managed database, a compose stack, or bound by
  any running container on the target daemon — the same check `ComposeService.assertHostPortsFree`
  already ran for stacks, now shared via `HostPortService` (`src/modules/host-port/`, entity-only
  imports to avoid the ApplicationModule/ComposeModule cycle). For an app on a remote server the
  container check runs against that server's daemon (`RemoteDockerService.forServer`); the
  platform-table checks stay global. Lets the web "Akses" step surface a clean 400 instead
  of a deploy that silently never becomes reachable.
- `POST /applications/:id/domains` now auto-provisions the reverse proxy on the app's own daemon
  (host, or its remote server via `RemoteDockerService`) if it isn't already running, mirroring
  the same fix already shipped for the panel's own domain — previously the Traefik labels were
  applied fine but nothing was listening on 80/443 if the proxy had never been started. Response
  shape changed from a bare `Domain` to `{ domain, proxyAutoProvisioned }` so the dashboard can
  show the same DNS/firewall/ACME-wait warning as the panel domain card. A proxy that's already
  running is left untouched.
- Deployments now record who/what actually triggered them: `Deployment.trigger` (`manual` |
  `webhook` | `auto-update`, separate from `kind` which picks the build/rollback/config code path)
  plus `commitSha`/`commitMessage` (from the webhook's push payload — GitHub and GitLab both
  supported) and `triggeredBy` (the actor's email for manual/rollback/config, the push's pusher name
  for a webhook). A webhook-triggered deploy was previously indistinguishable from clicking Deploy —
  found after testing a real GitHub webhook redeploy with no indication anywhere that it had
  happened. Surfaced in `list-deployments`/`get-deployment`, and as the first line of the deployment
  log itself (e.g. `==> Triggered by webhook (a1b2c3d "fix x" by octocat)`).
- New Socket.IO event `deployment:created` on the `/logs` namespace, broadcast to every socket
  ticketed for an application (not just one already subscribed to a specific deployment) the moment
  any new deployment is queued — lets an open application page notice a webhook/auto-update/another
  user's deploy immediately instead of only after a manual refresh.
- `list-projects` (`GET /projects`) instances now carry a `deploying` flag — an active deployment
  (`queued`/`building`/`pushing`/`starting`) for applications, `status === 'creating'` for databases,
  `status === 'deploying'` for compose stacks — computed in the same single `UNION ALL` query, no
  extra Docker call. Lets the project overview cards show a live "deploying…" badge (e.g. for a
  webhook-triggered redeploy) without opening the application.
- New notification event **Deploy dimulai** (`on_deployment_started`, off by default unlike the other
  toggles — deploys can happen often via webhook/auto-update): fires once per deployment from the same
  `deployment:created` choke point as the realtime event above, skipping `kind: 'config'` deployments
  (a runtime-only mode/replica/limit re-apply, not a real new deploy). Message includes the trigger
  (manual/webhook/auto-update, plus commit + pusher for a webhook push).

### Fixed

- Panel domain apply and instance update (`docker compose ... up -d`) explicitly listed only
  `-f docker-compose.dist.yml`, so Compose never merged `docker-compose.override.yml` — Compose only
  auto-includes an override file when the base file is named exactly `docker-compose.yml`, not when
  `-f` names it explicitly. This meant setting a custom panel domain silently never applied Traefik
  labels to the `web`/`api` containers (found testing on a real VPS: DNS, proxy, and firewall were
  all fine, but the container had zero Traefik labels). Both flows now list the override file
  explicitly (`instance-update` checks it exists first, since it may never have been written).
- `PATCH /applications/:id` rejected saving an application's settings with `imageRef must be an
  image reference like registry/repo:tag` even when the Image field was never touched — the web
  form only mounts the Image (or Git) fields for the matching source type, so updating a git app
  submits `imageRef: ""` (found testing on a real VPS: setting a Git credential on an existing git
  app failed this way). `UpdateApplicationDto`'s `imageRef`/`gitUrl`/`gitBranch`/`dockerfilePath`/
  `staticOutputDir`/`previewDomain` now accept an empty string via `@ValidateIf` (previously only
  `@IsOptional`, which skips `null`/`undefined` but not `""`); `gitUrl` in the service now normalizes
  an empty string to `null` like the other nullable fields already did.
- Webhook URLs in the dashboard (application and compose) and the "currently configured" line on the
  panel-domain Settings card always showed `http://localhost:3001/...`, even after setting a custom
  API domain — `PUBLIC_API_URL` is read by the API container itself (`get-webhook`, `compose-webhook`,
  `panel-domain`'s status), but `docker-compose.dist.yml` only ever declared it for the `web` service,
  so the API always fell back to `localhost`. Now declared for `api` too (copied to
  `aoox-cli/assets/install/` as well, per the usual rule for that file).

## [0.1.0-alpha.1] - 2026-09-26

### Added

- Custom domain for the panel itself (`GET`/`PATCH /instance/domain`, owner only): applies a
  Traefik-labeled `docker-compose.override.yml` and updates `.env.dist` through a helper container,
  so the dashboard/API can move off `IP:port` onto their own domain without SSH. Requires the new
  `INSTALL_DIR` env var.
- Custom domain for the self-hosted registry (`PATCH /registries/:id/domain`, owner/admin): routes
  it through the built-in proxy with a real Let's Encrypt certificate instead of the manual
  `REGISTRY_PUBLIC_HOST` + `insecure-registries` dance — `docker push`/`login` trust it out of the
  box, including from other Swarm nodes. Requires the proxy already provisioned with
  `PROXY_ACME_EMAIL` set.
- Update check/apply for the panel itself (`GET`/`POST /instance/update/apply`, owner only):
  compares `aoox-api`/`aoox-web` image digests against the registry (same digest-comparison
  approach as application auto-update, never mixed with local `docker inspect` values) and applies
  the update with `docker compose pull && up -d` through a helper container. Requires `INSTALL_DIR`.
- Optional S3 storage for the self-hosted registry (`POST /registries/self-hosted` accepts a
  `destinationId`, reusing the same `BackupDestination` credentials as database/volume backups):
  image data goes straight to the bucket instead of the local `aoox_registry_data` volume. Set once
  at provision time; not changeable afterward without removing and re-provisioning.
- CI (`.github/workflows/ci.yml`): lint + build + unit tests on every pull request and push to
  `main` — previously the only workflow ran on version tags (Docker publish), so a broken PR could
  merge unnoticed.

### Fixed

- API token `prefix` was stored as 11 characters instead of the documented 10 (off-by-one in
  `plaintext.slice(0, TOKEN_PREFIX.length + 6)`), caught by the new CI's first run.

## [0.1.0-alpha.0] - 2026-09-25

### Added

- Initial public alpha release: a self-hosted PaaS backend (NestJS 11 + TypeORM + PostgreSQL).
- Auth: JWT sessions, TOTP two-factor authentication, project members with role-based access
  (owner/admin/developer/viewer), scoped API tokens, and an audit log.
- Applications: deploy from Git (Dockerfile, Nixpacks, Railpack, or static sites) or from an
  existing image, with zero-downtime blue/green rollouts, rollbacks, preview deployments for pull
  requests, scheduled jobs, and signed incoming webhooks.
- Managed databases (PostgreSQL, MySQL, MariaDB, Redis) with a built-in data browser, scheduled
  backups (local + S3-compatible destinations), and restore.
- Docker Compose stacks, one-click templates (WordPress, Ghost, n8n, Uptime Kuma, MinIO, Gitea),
  and Docker Swarm support for multi-node deployments.
- Reverse proxy (Traefik) with automatic HTTPS, a self-hosted Docker registry, remote server
  support over SSH, a web terminal, and outgoing notifications (Telegram, Slack, Discord, e-mail,
  generic webhook).
- Monitoring with metrics history, disk cleanup tooling, and project/instance export-import for
  backup and migration between hosts.

[Unreleased]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.3...HEAD
[0.1.0-alpha.3]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.2...v0.1.0-alpha.3
[0.1.0-alpha.2]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.0...v0.1.0-alpha.1
[0.1.0-alpha.0]: https://github.com/hideandseeklab/aoox-api/releases/tag/v0.1.0-alpha.0
