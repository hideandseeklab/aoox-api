# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions below 1.0.0 may include breaking changes in a minor release.

## [Unreleased]

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

[Unreleased]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.2...HEAD
[0.1.0-alpha.2]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.0...v0.1.0-alpha.1
[0.1.0-alpha.0]: https://github.com/hideandseeklab/aoox-api/releases/tag/v0.1.0-alpha.0
