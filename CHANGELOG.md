# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions below 1.0.0 may include breaking changes in a minor release.

## [Unreleased]

### Added

- **Dangling anonymous volumes are reported.** `GET /maintenance/disk` returns `danglingAnonymousVolumes: {count, bytes}` (volumes with a 64-hex name that no container uses). Report only: Docker gives them no label that names the container, so they cannot be attributed to aoox and are never removed by cleanup or the nightly run.

- **Open ports overview.** `GET /docker/open-ports?serverId=` (owner/admin, read only) lists every port the containers of a daemon publish on the host, merged per port (Docker reports 0.0.0.0 and :: separately), with its owner from aoox labels (application, database, database admin app, stack, proxy, registry, panel, or "not managed") and `exposure` `public` / `loopback` / `address` plus `openToInternet`. One container listing, nothing per row. Published ports bypass ufw, so the provider firewall is what has to close them.
- **Bind address per host port.** Applications, managed databases, database admin apps and compose service ports take `hostPortBind` (`bind` for stack ports): `public` (every interface, as before) or `loopback` (`HostIp` 127.0.0.1, `127.0.0.1:host:container` in the compose override). Defaults for NEW resources: databases and admin apps `loopback`, applications and stacks `public`; existing rows and old export files stay `public` (migration `HostPortBind`, additive). Changing it on a running application recreates the container like a host-port change (and a stopped one is recreated on start); the same port on another address is still refused, as Docker refuses it. Loopback is refused for Swarm services (a service port cannot carry a host IP). The database connection (`externalLoopbackOnly`, host `127.0.0.1`) and the admin app (`loopbackOnly`, url `http://127.0.0.1:<port>/`) say it is reachable from the server itself only (SSH tunnel). Project export/import carries the field (optional in old files).
- **Compose-declared volumes of deleted stacks are listed (report only).** `GET /maintenance/disk` returns `orphanComposeVolumes: [{name, stack}]`: volumes whose Docker labels say `com.docker.compose.project=aoox-<slug>` and carry `com.docker.compose.volume`, whose `<slug>` is no current stack, that no container references (`RefCount` 0) and that do not belong to the panel's own project `aoox`. They are never part of `cleanup`, `pruneVolumes`, the nightly run or any delete endpoint (a hand-run project such as `aoox-dev` looks the same); the web shows a copyable `docker volume rm <name>` hint.

- **Multi-arch images.** The Docker publish workflow now builds `linux/amd64` and `linux/arm64` (QEMU + buildx, GitHub Actions layer cache) and pushes one manifest, so ARM VPSes (Ampere, Graviton) can run the panel from the next release. The published 0.1.0-alpha.12 images are still amd64 only. `node-pty` compiles from source in the existing build stage (python3, make, g++ are installed there); an arm64 build under QEMU was started locally but did not finish within 15 minutes, so the first CI run is the real check.
- **Show and reset the local registry password.** `POST /registries/:id/credentials/reveal` (owner/admin, throttled 20/min) returns the same payload as `GET /registries/:id/credentials` but, being a POST, is written to the audit log (GETs are not; the CLI keeps using the GET). `POST /registries/self-hosted/password` (owner, throttled 5/min) generates a new password, replaces `htpasswd` atomically in the auth volume (the previous file is kept as `htpasswd.bak`), restarts the registry container and stores the new encrypted password; the data volume or S3 storage is never touched, and a failure at any step restores the old file and keeps the old password.
- **`TZ` for schedules.** The api service passes `TZ` (default `UTC`) so job, backup and nightly maintenance crons run in the zone you choose; `GET /auth/me` returns `timeZone` (any role) so the web can show it next to schedule fields. The node image already ships tzdata, and the `cron` package (Luxon) follows the process zone. Documented in `.env.dist.example`. Installs made before this release need `aoox reinstall` for the compose file to pass `TZ`.
- `GET /registries/self-hosted` also returns `publishAddress`, `localOnly` and `externalAddress` (the address other machines use: the registry domain, or `REGISTRY_PUBLIC_HOST` / `PUBLIC_IP` / the detected public IP when the port is exposed). `registries.url` is deliberately unchanged (`localhost:5000` or the domain): it is the image-reference prefix the host daemon pushes to and pulls from, and Docker refuses plain-HTTP registries other than localhost without `insecure-registries`.

### Changed

- **A container that publishes a host port is started with a short retry.** Right after the previous container on that port was removed, Docker Desktop frees the listener asynchronously, so switching a port between all interfaces and 127.0.0.1 could fail once with a bare 500 and trigger the restore path; a 500 on start with a published port is now retried up to three times (0.8 s, 1.5 s, 2.5 s).
- **The local registry's host port is bound to `127.0.0.1` by default** (it used to listen on every interface, exposing a password-protected registry to the internet over plain HTTP). `REGISTRY_PUBLISH_ADDRESS` (default empty = `127.0.0.1`; `0.0.0.0` or an interface IP exposes it) sets the `HostIp` of the binding. A registry with a custom domain is served through Traefik and needs no exposed port. **Migration:** the binding only changes when the `aoox-registry` container is recreated (re-enable the registry, or apply or remove its custom domain); until then an existing registry keeps listening on every interface, and the status endpoint reports what the running container is actually bound to. Pushing to `<ip>:5000` from another machine stops working after the recreate unless `REGISTRY_PUBLISH_ADDRESS=0.0.0.0` is set or a domain is used.
- **The API reaches the registry over the `aoox` network.** `REGISTRY_INTERNAL_URL` in `docker-compose.dist.yml` is now `http://aoox-registry:5000` (a loopback-only host port is not reachable through `host.docker.internal` on Linux). An older compose file that still sets `http://host.docker.internal:5000` is mapped to the same address when the API runs in Docker, so updating the image alone does not break the registry. Outside Docker (dev) the stored address is used as before.
- Docs and comments name the right commands: `aoox update panel` updates the panel (`aoox update` updates the CLI itself).

### Fixed

- **Re-provisioning a database no longer answers a bare 500.** Mount add/update/delete and removing a CPU/memory limit now answer 502 with the real reason (for example "The database did not become ready within 120 seconds"); the PostgreSQL layout 409 is unchanged. When the old container was already replaced, the row goes to `error` with that message (as a failed first start does) instead of staying `running`. A stopped database stays stopped after removing a limit (it was left running). A database mount on the engine data path, inside it or on a parent of it is refused with 400 (existing mounts are untouched).
- **PostgreSQL 18 databases start.** The official image from 18 on declares `VOLUME /var/lib/postgresql` (cluster in `/var/lib/postgresql/18/docker`); the data volume was mounted at the old `.../data`, so the container refused to start. The mount path is now taken from the pulled image (the declared volume that contains `PGDATA`), so 18+ images (including pgvector and PostGIS) work and 16/17 databases are unchanged. A volume that still holds an old-layout cluster is refused with a clear 409 when an 18+ image is provisioned on it, instead of starting an empty cluster beside the data.
- **A secret split over two live log chunks is masked.** Deployment, preview and compose logs hold back the end of a chunk that could be the start of a secret until the next chunk (or the end of the step), so the `/logs` socket and the stored text never show half a secret; output that cannot start a secret is not delayed.
- **Resolved env values no longer leak into job output and build logs.** Redaction used to know only database passwords, secret-source values and flagged set variables. It now masks every resolved env value of 6+ characters that is not a number or a plain word (the application's own env and build args included, expanded references included; a variable set flag still wins, and a secret-looking name masks even a plain word) in deployment and preview logs (live and stored), compose run logs and the stored output of jobs, for exec and run jobs alike (database jobs mask the database password, compose service jobs the service's env). Raw and URL-encoded forms, longest secret first.
- **Databases no longer leak anonymous volumes.** Re-provisioning, deleting and removing an admin app now remove the container's anonymous volumes (MongoDB left one per create, mount change and delete); named data and mount volumes are unaffected.
- **A database that is still starting cannot be deleted.** `DELETE /databases/:id` and `DELETE /projects/:id` answer 409 while a database is `creating`, and an interrupted provision cleans up after itself. A database left `creating` by an API restart becomes `error` at boot (delete it and create it again) instead of staying stuck.
- **Project viewers can no longer read application and stack env or build args.** `GET /applications/:id`, `GET /applications?projectId=`, `GET /compose-apps/:id` and `GET /compose-apps?projectId=` returned the `env` text (and `buildArgs`) in plaintext to anyone who could see the project. For viewers they now return `env: null`, `buildArgs: null` and `envHidden: true`; developers and up are unchanged. `GET /projects/:id/export` (every env and build arg) now needs developer or higher (viewers 403, outsiders 404); `includeSecrets` stays owner-only.
- **A new database is `running` only once its engine answers.** The row used to flip to `running` as soon as the container started, so a mount change or a limit removal in the first seconds recreated the container in the middle of its first-boot init and left Postgres with a half-initialised data directory (no `host all all all` rule in `pg_hba.conf`, never repaired). Provisioning now waits until a one-shot probe can log in with the real credentials (Postgres, MySQL, MariaDB, Redis, Valkey, MongoDB), up to 120 seconds, and ends in `error` with a clear message otherwise. While a database is `creating`, adding, changing or deleting a mount, `PATCH /databases/:id`, start, stop, creating a backup and restoring a backup answer 409 "still starting" (before, a mount was saved but not applied).
- **`DELETE /databases/:id?purge=true` removes the mount volumes too.** It kept the named volumes of the database's `volume` mounts and the shared `aoox_db_<slug>_files` volume of its `file` mounts (a project purge already removed them). The single delete now does the same; without `purge` they stay.
- **Project viewers can no longer read webhook tokens and secrets.** `GET /applications/:id/webhook` and `GET /compose-apps/:id/webhook` returned the URL token and the signing secret to anyone who could see the project, which is enough to trigger deploys. They now answer 403 to viewers (404 to outsiders), the same rule as database credentials (`ProjectAccessService.assertCanExport`); a read-only token follows its owner's project role. Developers and above are unchanged.
- **Project viewers no longer receive the contents of `file` mounts.** `GET /applications/:id/mounts`, `GET /databases/:id/mounts` and `GET /compose-apps/:id/mounts` return `content: null` and `contentHidden: true` for `file` mounts when the caller is a viewer (config files often hold secrets); name, path and the other fields stay. New `ProjectAccessService.canReadSecrets()` (boolean form of the same rule) and `mountView()`.
- **One-shot helper containers no longer leave anonymous volumes behind.** Helpers were removed with `DELETE /containers/{id}?force=true`, which keeps anonymous volumes, so every run of an image with a `VOLUME` instruction (postgres, redis, mongo, mysql, mariadb: data-browser queries, backups, restores, exports, init helpers) left one dangling volume. `DockerEngineClient.removeContainer(id, force, removeVolumes)` takes the new third argument (`v=true`, which per the Engine API removes anonymous volumes only, never named volumes or bind mounts) and every helper call site (runOnce, data browser, backups, restores, compose/panel helpers, mount/certificate/proxy-config/maintenance helpers, builders, job `run` containers) passes it. Long-running containers (applications, databases, proxy, registry, companions, orphan cleanup) are removed as before.

- **Project viewers can no longer read database data or credentials.** `GET /databases/:id/credentials`, the paged rows `GET /databases/:id/tables/:table/rows` and, for Redis/Valkey, the key list `GET /databases/:id/tables` now need developer or higher (`ProjectAccessService.assertCanExport`: 404 for outsiders, 403 for viewers), the same rule as the exports and backup downloads. Table and collection names, column structure, `schemas` and the database detail stay readable. A read-only API token follows its owner's project role, so a viewer's token gets 403 and a developer's read-only token may still read. The 403 message now says viewers cannot read data or credentials.
- **`POST /databases` no longer returns `passwordEncrypted`.** The create response carried the AES ciphertext of the generated password (the column is `select: false` on reads, but a freshly saved entity has it). `POST /applications`, `POST /compose-apps` and `POST /compose-apps/from-template` leaked the generated `webhookToken` the same way. Every other create/update response was audited (registries, git credentials, notifications, backup destinations, secret and DNS connections, certificates, servers, companions, users, variable sets): they already return DTOs or entities without secret columns.
- **Deleting with `purge` removes the backup files too.** `DELETE /projects/:id?purge=true` and `DELETE /databases/:id?purge=true` used to drop the `database_backups` and `volume_backups` rows (FK cascade) but leave the dump and tar files in the shared `aoox_backups` volume and the S3 copies on the destination, unreachable from the UI. They are now removed first, found through the rows (`filename`, `remoteKey`), never by guessing folder names: local files by one busybox helper per 100 files on the daemon that holds them (the application's server for volume backups; empty directories left behind are removed with `rmdir`, which refuses a non-empty one), S3 objects through the destination. Best effort: a failure is logged and never blocks the delete. Without `purge` the files are kept on purpose (they are the safety net); they stay in the `aoox_backups` volume and are no longer listed anywhere. Deleting a single application has no purge option (volumes are kept), so its volume backup files stay as well; a project delete with purge removes them.
- **Project viewers can no longer take a project's data out in bulk.** `GET /databases/:id/export` (SQL dump), `GET /databases/:id/tables/:table/rows/export` (CSV), `GET /backups/:id/download` and `GET /volume-backups/:id/download` answer 403 for viewers (developers and up are unchanged, outsiders still get 404); they used to answer 200 even though `POST /databases/:id/query` was refused. A read-only API token may still export, because an export is a read (a viewer's read-only token is refused like the viewer). Open question: `GET /databases/:id/credentials` and the paged `GET /databases/:id/tables/:table/rows` stay readable for viewers.
- **`GET /instance/update` no longer answers 500 when an image cannot be looked up** (for example `API_IMAGE=aoox-local/aoox-api:test`, `Manifest lookup failed (401)`). Each image reports `remoteDigest: null`, `updateAvailable: false` and a short `error`, and the other image is still compared; `POST /instance/update/apply` refuses with a readable 502 before touching anything.

## [0.1.0-alpha.12] - 2026-10-17

### Added

- **Remove the panel domain.** `DELETE /instance/domain` (owner, 202, throttled like PATCH) clears the saved hosts, turns `restrictPorts` off, deletes `docker-compose.override.yml`, sets `WEB_ORIGIN`/`PUBLIC_API_URL` back to `http://<PUBLIC_IP>:<WEB_PORT>`/`:<API_PORT>` (`localhost`, 3000 and 3001 when unset, as the installer writes them), blanks `WEB_DOMAIN`/`API_DOMAIN`/`COOKIE_SECURE` and recreates `web`/`api` without the override. The ACME email, the proxy and application domains are left alone. Answers `{settings, reopenUrl}`; 400 without `INSTALL_DIR` or when no domain is set.
- **Opt-in "only allow access through the domain" for the panel.** `PATCH /instance/domain` takes `restrictPorts` (default off, omitted keeps the stored value, `false` opens the ports again). When on, the generated `docker-compose.override.yml` replaces the web and api port lists with `127.0.0.1:${WEB_PORT:-3000}:3000` / `127.0.0.1:${API_PORT:-3001}:3001` through the Compose `!override` tag (an override cannot replace a base `ports` list otherwise; needs Compose 2.24.4+ for manual commands, the panel's own helper uses its newer Compose), so everything outside goes through Traefik and the per-IP sign-in limit can no longer be bypassed by calling port 3000 with a forged `X-Forwarded-For`. It needs both the dashboard and the API domain, works on existing installs without `aoox reinstall` and leaves the default file byte-identical. `GET /instance/domain` reports `settings.restrictPorts` and `applied.portsRestricted` (read from the running containers); the PATCH answer carries a `restrictPortsNote` with the SSH recovery steps. New column `panel_domain_settings.restrict_ports` (migration `PanelDomainRestrictPorts`, additive).

### Fixed

- **The local registry no longer pretends to be enabled when only a container exists.** `GET /registries/self-hosted` now returns an additive `state`: `not-installed`, `installed`, `unmanaged-container` (a container named `aoox-registry` exists but aoox has no registry record, e.g. after an instance restore or a database move), `missing-container` (a record without a container) or `docker-unavailable`. `POST /registries/self-hosted` used to fail on that container with a bare 409; it now answers 409 with `code: registry-container-exists` and a clear message, and accepts `replace: true` to remove the old container first (its data volumes are kept so pushed images survive, `purgeVolumes: true` deletes them too; the htpasswd file is rewritten, so the generated password replaces the old one). Adopting the container is deliberately not offered: its S3 or domain configuration cannot be read back safely and the password in `htpasswd` is only a hash.
- **`DELETE /instance/domain` tells the owner the real web port to reopen.** `reopenUrl` was always `http://<PUBLIC_IP>:3000`; the api container never received `WEB_PORT`. `docker-compose.dist.yml` now passes `WEB_PORT` (default 3000) to the api service and the URL uses it (3000 when the variable is missing, as on installs that have not run `aoox reinstall` yet).
- **`PATCH /instance/domain` no longer answers 500 when Docker is down.** It (and the new `DELETE`) now answers 502 "The Docker daemon is not reachable (...)" before anything is saved.
- **The API now sees the real client IP behind Traefik and the web container.** Express `trust proxy` was never set, so `req.ip` was the proxy's address: every anonymous request (including sign-in, throttled per IP) shared one bucket, so one attacker guessing passwords locked every user out, and the audit log and sign-in log recorded the proxy. `main.ts` now sets it from the new `TRUST_PROXY` env (empty = `loopback, linklocal, uniquelocal`: private-network hops only, never a public address, so a client reaching the API port directly from the internet cannot fake `X-Forwarded-For`). Accepts `true`, `false`/`0`, a hop count, or a comma list of IPs/CIDRs/presets; a typo fails at boot. Anyone on the same private network as the API can still set the header. Optional in `docker-compose.dist.yml` (`${TRUST_PROXY:-}`, copied to the CLI installer) and commented in `.env.dist.example`.

### Changed

- **Rate limits are now per user instead of per IP.** People behind the same NAT or reverse proxy shared one quota, so one developer revealing variables could lock an admin out. Requests with a valid session or API token are counted per user (a user's tokens and sessions share one quota); anonymous requests, and invalid or forged credentials, still count per IP. Sign-in, 2FA, setup, invitation and webhook routes always stay per IP, so brute-force protection is unchanged.

## [0.1.0-alpha.11] - 2026-10-15

### Added

- **Per-variable notes in variable sets.** The `#` comment lines directly above a variable (no blank line in between) are its note. Notes are stored in plaintext next to the key names, so `EnvironmentView`, the reveal responses, the version list and version reveal, `LinkView` and `GET /projects/:id/variable-sets` carry `notes` (name to text) without revealing values. Anyone who can see a set, viewers included, can read its notes: do not put secrets in them. Notes are recomputed on every write and kept per version; promote brings the note of a key that is new to the target; project import keeps notes (standalone comments are still dropped). Migration `VariableNotes` adds the columns and fills them from the stored texts, so `ENCRYPTION_KEY` must be set during the upgrade when any environment has variables.
- **Leftover containers in the disk cleanup.** Containers of projects, applications, databases, admin apps and stacks deleted on older versions kept running with their Traefik labels. `GET /maintenance/disk` now has `orphanContainers: [{id, name, kind, image, state, ownerId}]`: local-daemon containers whose owning row no longer exists, decided only from labels aoox writes (`aoox.application`, `aoox.database`, `aoox.companion`, `aoox.compose`, or a bare stack container of `aoox-<slug>` started from its `aoox_compose_<slug>` checkout volume). The panel's own stack, proxy, registry, buildkit, maintenance page server, job/backup/build/query helpers, swarm tasks, remote servers and anything whose owner cannot be determined are never listed. `POST /maintenance/cleanup` accepts `pruneContainers` (default false, also false in the nightly run) and reports `containersRemoved`; new `DELETE /maintenance/orphan-containers/:id` (owner, throttled) removes one after re-checking that it is still an orphan (otherwise 404). Volumes are not touched by either.
- **Warning when a domain is still claimed by another container.** `POST /applications/:id/domains` returns an additive `conflicts: [{containerName, containerId, orphan}]` and `GET /applications/:id/domains` carries `conflicts` per domain (one container listing per request): other serving containers on the app's daemon with a Traefik router `Host(...)` rule for the host (several hosts per rule, quotes and case handled; the app's own container, `-next` and previews do not count). `orphan` is true only on the aoox host for a container the disk cleanup lists. It never blocks; a deploy also adds a warning line to the deployment log.

### Fixed

- **Deleting a project now removes what runs in it.** Before, only the records were deleted, so the containers of its applications, databases and compose stacks kept running and the domains still reached the app. `DELETE /projects/:id` now takes every workload down first (compose stacks, applications with their previews and domain DNS records, databases with their admin app) and then deletes the project; if Docker cannot be reached it stops with a 502 naming the resource and keeps the project so you can retry. New `?purge=true` also deletes the data volumes; by default they are kept (database and application volumes then show up as orphaned in the disk cleanup).
- **Deleting an application no longer leaves containers behind.** A leftover `-next` blue/green container is removed too, and a Docker error (for example an unreachable remote server) now fails the delete with a 502 instead of removing the record and leaving the container running.

### Changed

- The favicon served at `/favicon.ico`, `/favicon.svg` and on the Swagger UI (`/docs`) is now the round mark of aoox.dev, the same as the dashboard.

## [0.1.0-alpha.10] - 2026-10-13

### Breaking changes

Read before upgrading; back up first (Settings → Infrastructure → Instance backup, or `pg_dump`).

- **Project environments are replaced by variable sets.** Migration `VariableSets` converts existing environments (see Changed) and the `/projects/:id/environments` endpoints are gone; use `/variable-sets`. Update the dashboard (`aoox-web`) and the CLI together with the API: the 0.1.0-alpha.9 web and `aoox env` call endpoints that no longer exist (404).
- **`${{project.KEY}}` is now `${{vars.KEY}}`** (migrated in stored env and sets; saving the old form is a 400).
- **Protected environments are instance owner/admin only** (a project admin could reveal and edit them in 0.1.0-alpha.9).
- **API tokens:** the `environments` field is replaced by `variableScopes`; existing values migrate to `*/<name>`.
- **`environmentId` is removed** from application and stack create/update and template deploys (400 `forbidNonWhitelisted`); use `variableSetLinks` / `PUT …/variable-sets`. Applications and stacks have no default environment any more.
- **`ENCRYPTION_KEY` must be set** during the upgrade when any environment has variables (the migration stops with a clear message otherwise).
- After upgrading, review the links of your applications and stacks (links to empty environments are dropped).

### Added

- **Variable sets ("Variables").** Project environments became standalone, platform-level variable sets. A set has a name, an immutable slug and its own environments (`development`, `staging`, `production` (protected) for a new set), each holding encrypted `KEY=VALUE` variables with everything environments had: secret flags, version history (50 kept, baseline, restore), compare, promote, optimistic concurrency (`expectedUpdatedAt`) and strict validation. Instance owners and admins create, rename, share and delete sets and add or remove environments; a set is shared with chosen projects or with all projects. New endpoints: `GET/POST /variable-sets`, `GET/PATCH/DELETE /variable-sets/:id`, `PUT /variable-sets/:id/sharing`, `POST/DELETE /variable-sets/:id/environments[/:envId]`, `POST …/environments/:envId/reveal`, `PUT …/environments/:envId`, `GET …/environments/:envId/versions`, `POST …/versions/:versionId/reveal|restore`, `GET /variable-sets/:id/diff?from=&to=`, `POST …/environments/:toId/promote`, and `GET /projects/:id/variable-sets` for the project page. Deleting a set or an environment, or taking a set away from a project, is refused (409, naming them) while an application or stack still links it.
- **Several variable sets per application or stack, in order.** `GET/PUT /applications/:id/variable-sets` and `GET/PUT /compose-apps/:id/variable-sets` read and replace an ordered list of up to 10 set environments; later entries override earlier ones on the same key, the application's own env always wins, and Infisical secrets keep their place between the sets and the app env. Each link reports which of its keys are overridden by a later link or by the app's own env (`shadowedKeys`, `overriddenByOwnEnv`), computed from variable names only. `GET /applications/:id` and `GET /compose-apps/:id` include the links (`variableSets`), and the create endpoints for applications, stacks and template stacks accept `variableSetLinks`. Changes take effect on the next deploy.
- **API token scopes per set environment.** `POST /api-tokens` accepts `variableScopes` such as `backend/production`, `shared/*` (every environment of a set) or `*/staging` (that environment in every set); such a token can reveal or change only those, and never more than its owner may. Read-only tokens may still reveal (for CI).

### Changed

- **Existing project environments are migrated into variable sets.** Migration `VariableSets` creates, for every project whose environments have variables, one set named after the project (with ` (2)`, … when the name is taken), shared with that project only. The environments with variables keep their names, protection, encrypted values, secret flags and history; empty environments are dropped (a project with only empty environments gets no set). Applications and stacks linked to a migrated environment get one link to it; links to empty environments are dropped. API tokens limited to environment names get the same names in every set (`staging` becomes `*/staging`). The migration needs `ENCRYPTION_KEY` in the environment as soon as any environment has variables (it re-encrypts rewritten texts) and stops with a clear message otherwise. Reverting it restores the previous tables best effort: sets shared with more than one project, or with all projects, are lost.
- **`${{project.KEY}}` is now `${{vars.KEY}}`**, resolved across the linked sets in the same order. The migration rewrites it in application and stack env and in stored set texts and their history; project import rewrites it too. Saving text with `${{project.…}}` is a 400 that names the new form. A set's text may reference a key of another set linked to the same app, so references in set texts are checked against the app's links (when links or the app env are saved, and at deploy) instead of within the same text.
- **Protected environments need an instance owner or admin** to reveal or edit values (in 0.1.0-alpha.9 a project admin could). Developers and project admins still read and edit unprotected environments of sets shared with their projects; viewers never see values. Linking an application or stack to, or away from, a protected environment still needs the project admin role.
- An application or stack created without links has none: there is no default environment any more.
- Project export carries the links of applications and stacks by set and environment name; whole sets (with values) are exported only with `includeSecrets`, limited to sets shared with the project or linked by it. Import links by name, never overwrites an existing set (instance owners and admins importing share an existing set with the new project; others get a warning), and still reads files from 0.1.0-alpha.9 and older (their environments become one set named after the project).

### Removed

- The project environment endpoints under `/projects/:id/environments` (list, create, reveal, update, delete, versions, diff, promote); use the variable set endpoints.
- `environmentId` on application and stack create/update and template deploys, the default-environment rule (production for admins, the first unprotected one for others), `applications.environment_id`, `compose_apps.environment_id`, `api_tokens.environments` (use `variableScopes`) and the unused `projects.env` column.

### Fixed

- The inbox link of the "disk low" event now points to `/infra/docker` (the Docker page holds the disk strip now) instead of the old `/infra/disk` redirect.

## [0.1.0-alpha.9] - 2026-10-13

### Added

- **Environment variable history and restore.** Every change to an environment (dashboard edit, CLI `set`/`unset`/`push`, restore, promote) stores a version in `project_environment_versions`: the full text encrypted like the live one, who (user or token) and when, and a summary of the variable names added, changed and removed (never values). The first change to an environment that already had content also keeps a baseline of the old text, so it can be undone. Saves that only change line endings or trailing blank space store nothing. The newest 50 versions per environment are kept. New endpoints: `GET …/environments/:envId/versions` (any member, no values), `POST …/versions/:versionId/reveal` (same rules as the environment reveal, allowed for read-only tokens) and `POST …/versions/:versionId/restore` (same rule as editing; the old text becomes a new version and is checked against today's rules, 400 if it no longer passes).
- **Compare environments.** `GET /projects/:id/environments/diff?from=&to=` lists the variable names only on one side, in both, and which of those have different values. Values are compared on the server and never returned; "different/same" are only given when the caller may read both environments (otherwise `comparable: false`).
- **Promote variables between environments.** `POST …/environments/:toId/promote {from, keys[], expectedUpdatedAt?}` copies chosen variables (value and secret flag) from one environment into another, keeping the target's comments and order and appending new variables. It needs the right to read the source and to change the target, so a protected environment on either side still needs a project admin. Records a version "From <source>".
- **Secret flags per variable.** Environments keep a `secret_flags` map (variable name to true/false). Secret variables are always masked in deployment logs, job output and notifications whatever their length; `false` means never masked; unmarked variables keep the previous length-based rule. `PUT` accepts `flags` (and `action` for the history); view, list and reveal return `secretKeys` and `plainKeys`; export/import carry both name lists. Migration `EnvironmentHistoryAndSecrets` flags existing variables whose name looks secret (`password`, `secret`, `token`, `key`, `private`, `credential`) automatically; every other variable stays unmarked, so masking behaves exactly as before. The same name rule flags a newly added variable that has no explicit flag.
- **API tokens can be limited to environments.** `POST /api-tokens` accepts `environments` (names such as `development`); a token with it can reveal or change only the variables of those environments (403 for the others, also for creating or deleting an environment outside the list) and never more than its owner's own access. Migration `ApiTokenEnvironments` (additive, `api_tokens.environments` jsonb, null = no restriction). A **read-only** token may still call reveal, so CI can pull variables: the route is now a read (it stays a POST so it is audited), and viewers are refused by the environment service itself, so nothing changes for them.
- **Optimistic concurrency for environment edits.** `POST …/reveal` also returns `updatedAt`, and `PUT /projects/:id/environments/:envId` accepts an optional `expectedUpdatedAt`; when the environment changed since, the answer is 409 and nothing is saved (checked under a row lock). Omitting it keeps the old last-write-wins behaviour. The CLI (`aoox env set/unset`) and the dashboard editor use it.
- **Project environments (stored, encrypted variables).** Every project now has `development`, `staging` and `production` (protected) environments that hold its shared env variables, encrypted at rest (AES-256-GCM with `ENCRYPTION_KEY`, one text per environment plus a plaintext list of variable names). Applications and compose stacks are linked to one (`environmentId`; when none is given, production for project admins and the first unprotected environment for others); `${{project.KEY}}` resolves from the linked environment and the priority is environment < Infisical secrets < the application's own env. New endpoints under `/projects/:id/environments`: `GET` (names, protection, variable names and the apps/stacks using each, never values), `POST` (create, developers and up), `POST /:envId/reveal` and `PUT /:envId` (values; viewers get 403, the protected `production` needs a project admin), `DELETE /:envId` (project admins only; `production` and environments still used by an app or stack are refused with a message naming them). `PATCH` of an application or stack accepts `environmentId` (must be an environment of the same project; a `${{project.KEY}}` missing from the new environment is a 400). The CLI will build on these endpoints later.
- Environment values are masked in deployment logs like database passwords and secret-source values (variables marked secret are always masked; unmarked values shorter than 8 characters and plain single words such as `production` are not, so ordinary log text stays readable). The audit log redacts the `variables` key of environment writes.
- Project export includes the environments (names, protected flag and, with `includeSecrets`, the variables); applications and stacks reference their environment by name. Import creates them and links apps by name; a file from before environments still imports its `project.env` into `production`.
- **Warning when the Container port is not an exposed port.** A deployment (build, pull, rollback, config, PR preview) reads the image's `EXPOSE` ports from the app's daemon and, when the image exposes TCP ports but not the Container port, writes one note to the deployment log (`==> Note: the image exposes 80/tcp but the container port is 3000 ...`). Never fails the deployment; nothing is written when the image exposes nothing. `GET /applications/:id` adds `exposedPorts: number[] | null` (read live, 2 second limit, `null` when unknown).

### Changed

- **Linking to a protected environment needs a project admin.** Creating or updating an application or stack (and deploying a template) with `environmentId` of a protected environment such as `production`, or moving one away from it, is 403 for developers; resending the current environment in an edit is fine. A developer who creates an application or stack **without** `environmentId` now gets `development` (the first unprotected environment) instead of `production`; admins still get `production`. A project with only `production` answers 403 to a developer who omits it. Existing links are untouched, project import is unchanged (the importer is the new project's admin). This closes the path where a developer links an app to `production`, deploys and reads the values from the container console.
- **The project's shared env moved into the `production` environment.** The migration copies `projects.env` (encrypted) into each project's `production` and links every existing application and stack to it, so deploys behave exactly as before. The `projects.env` column is kept but no longer read, written or returned: `GET /projects/:id` no longer has `env` and `PATCH /projects/:id` rejects it (use the environments endpoints). The migration needs `ENCRYPTION_KEY` in the environment when any project has a shared env (it stops with a clear message otherwise).
- **Project export no longer always includes the shared env.** It used to be exported in the clear for everyone; the variables are now part of the environments and only exported with `includeSecrets` (owner only), matching database passwords. Importing such a file leaves the environments empty and says so in the warnings.

### Fixed

- Importing a project that contains a compose stack failed with a 500 (the stack row had no webhook token). Imported stacks now get one.
- **Changing the Container port of a running application now takes effect.** It used to be saved only, so the proxy kept routing to the old port ("Bad Gateway") until the next deploy. A running container is now recreated from its current image like a host port change (a swarm service gets a `config` deployment); a failed apply restores the previous port; 409 while a deployment is in progress.
- **Starting a stopped application after its Container port changed uses the new port.** `start-application` now also compares the Traefik target port in the stopped container's labels (`…loadbalancer.server.port`) with the Container port and recreates the container when they differ, instead of starting the old one that still routes to the old port.

## [0.1.0-alpha.8] - 2026-10-12

### Added

- **Change your own name or email.** `PATCH /users/me` `{name?, email?, currentPassword?}` for any role (session only; API tokens get 403, throttled 10/minute). The name is trimmed (max 100, empty clears it); a new email is normalised to lowercase and needs `currentPassword` (400 when missing, 401 when wrong). It must not belong to another account or to a pending invitation (409). Returns the updated profile; an unchanged email never asks for the password.
- **Owner edits another user's name or email.** `PATCH /users/:id` `{name?, email?}` (owner only, no password; not for owners or yourself, 403) with the same email checks. `currentPassword` is redacted in the audit log like every password key.

### Changed

- `GET /` (opening the API address directly) now answers JSON `{"description": "aoox api", "version": "<running version>"}` instead of the placeholder "Hello World!" text.

## [0.1.0-alpha.7] - 2026-10-12

### Added

- **Cloudflare DNS integration.** New `dns-provider` module: Cloudflare API tokens are registered as DNS connections (`POST/GET/DELETE /dns-connections`, `POST /dns-connections/:id/test` verifies the token through `/user/tokens/verify` (or the account endpoint when an account ID is set) and lists the accessible zones). The token is encrypted with `ENCRYPTION_KEY`, never returned and redacted in the audit log; a connection that a domain or a proxy still uses cannot be deleted (409). Migration `DnsProviders`, additive.
- **DNS records for application domains.** `POST /applications/:id/domains` and `PATCH .../domains/:domainId` accept `dnsConnectionId`, `dnsProxied` and `dnsOverwrite`: aoox creates (or updates) the A record, or AAAA when the expected IP is IPv6, pointing at the same IP the DNS check expects, in the longest-suffix zone of the host. It never fails the request: a missing zone, an existing record with other content (left alone unless `dnsOverwrite`), a CNAME on the name or a provider error comes back as an additive `dnsWarning` and as `dnsStatus`/`dnsMessage` on the domain. Only records aoox created are deleted (on delete-domain, delete-application, or detaching the connection); `POST .../domains/:domainId/dns/sync` retries. `GET /applications/:id/dns-options` tells whether the proxy has DNS-01.
- **Wildcard certificates through ACME DNS-01.** `GET/PUT/DELETE /proxy/dns` (owner for writes, `?serverId=` picks a remote server) binds a DNS connection to a proxy: Traefik gets a second resolver `le-dns` (own `acme-dns.json`, `CF_DNS_API_TOKEN` in the container env) and a running proxy is recreated only after `acceptProxyRestart` (409 `proxy-restart-required` otherwise). Domains get `certMode` `http` (default), `dns` or `dns-wildcard` (`tls.domains[0].main/sans`); applications get `previewWildcardCert` for one `*.<preview domain>` certificate. Without a DNS connection the Traefik labels and the proxy container are unchanged, and a DNS-01 domain on a proxy that lacks the resolver falls back to HTTP-01. Project export/import carries the settings by connection name, never the token. `CLOUDFLARE_API_URL` (test only) points the client at a fake server.

- **Resource threshold alerts.** Optional CPU and memory rules per application and per managed database: `GET`/`PUT /applications/:id/alerts` and `/databases/:id/alerts` (reads for anyone with project access, the PUT is a write so viewers get 403) hold, per metric, `enabled` (off by default), `thresholdPercent` (default 90) and `durationMinutes` (default 5). A watcher (second 30 of every minute) reads the stored per-minute metric rows, so it makes no Docker calls and covers applications on remote servers: CPU is the percent of one core (the number the Monitor tab charts, above 100 on several cores), memory the percent of the container's memory limit (host RAM when none is set, at most 100). A rule alerts once when the value stayed above the threshold for the whole duration, reminds every 6 hours while it persists, and sends one "recovered" message when it drops; stopped owners and applications that are deploying are skipped, and readings from before the last finished deployment do not count. The state is stored in the rule row (`resource_alert_rules`, migration `ResourceAlerts`), so an API restart neither re-alerts nor forgets a breach. New notification event `resourceAlert` with the toggle `on_resource_alert` (on by default, since the rules are opt-in) and structured inbox `params`. Project export/import carries the rule configuration (not the state; optional in older files). Not done: disk alerts for volumes.
- **Maintenance mode per application.** `PUT /applications/:id/maintenance {enabled, message?}` (developer and up; viewers get 403) shows a static "under maintenance" page with HTTP 503 and `Retry-After: 300` on every domain of the application, while the container keeps running. The routing is changed in Traefik through a file-provider configuration (`aoox-maint-<appId>.yml`, one higher-priority router per host, same entrypoints, custom certificates and operator middlewares as the normal routers), so toggling never recreates the container, and deploys keep the page until it is switched off. One shared nginx container (`aoox-maintenance`, created on first use) serves the page; the per-application message is plain text, length-limited and HTML-escaped. Domain add/change/delete and application deletion keep the page in step; moving the application to another server is refused while it is on, and remote-server applications get a 400. The flag and message are on `applications` (`maintenanceEnabled`, `maintenanceMessage`, migration `ApplicationMaintenanceMode`) and in `get-application`. Project export/import does not carry it.
- **Deploy step times.** `deployments.step_times` (jsonb, migration `DeploymentStepTimes`) records when each timed step (`building`, `pushing`, `starting`) was first reached, written by the runner on each status change; `queued` is `createdAt` and the end is `finishedAt`. `GET /applications/:id/deployments` and `GET /deployments/:id` return `stepTimes` (null on old rows), and the `deployment:status` socket event carries an optional `at` timestamp so a live page can time steps.
- **In-app notification inbox.** Every event passed to `NotificationService.broadcast` (deployments, backup and job failures, container/server/HTTP down and recovered, disk, certificate, DNS, app errors) is also stored in `inbox_events`, whatever the channels and toggles are, with the same already-redacted text. Project events are visible only to people who can access that project; platform events (disk, server, certificate) only to owner and admin. `GET /inbox?limit&before` returns the items plus the caller's unread count and `POST /inbox/read` marks everything read (per user, `users.inbox_read_at`; existing users start with nothing unread). Rows are kept 30 days and at most 1000 (nightly prune). Migration `InboxAndOnboarding`.
- **Inbox events carry structured `params`.** Each inbox row now also stores `params` (jsonb, migration `InboxEventParams`, null on older rows): the facts behind the English `title`/`summary` as flat values (names, counts, durations, exit codes, a `variant` where one event means different things such as server down vs recovered or database vs volume backup), so the web can compose the sentence in the user's language. `GET /inbox` returns `params` next to the unchanged English text, which stays as the fallback. `params` never reaches notification channels and never holds secrets, log excerpts or command output (an app-error event carries only the count); free text is limited to the system's own error message, cut to 500 characters.
- **Onboarding checklist.** `GET /onboarding` (owner only; others get `visible: false` without any lookups) computes the getting-started steps from the real state: local registry, reverse proxy running, panel domain (optional), first project and first running application/database/stack. It turns invisible when every required step is done, and `POST /onboarding/dismiss` (owner, audited) hides it for good for that user.

- **Docker manager API** (`/docker/*`, `?serverId=` picks the host or a remote server): lists containers (no env vars in the answer), images
  (with how many containers use each), volumes (sizes from one `system/df`, orphan marker for aoox's own volumes on the host) and networks;
  owner/admin can read them and tail a container's logs (one shot, at most 500 lines). The owner can start, stop, restart and remove
  containers aoox does not own, remove unused images and prune dangling ones. aoox's own containers (panel stack, proxy, registry, builders,
  applications, databases, companions, stacks, anything named `aoox-`/`aoox_`) and this API's own container are refused with 403 before
  the daemon is touched, whether addressed by name or id; used images and aoox helper/panel images are refused with 409, and so are images the database
  still needs (an application's current image, a deployment kept for rollback, an open preview) and anything under aoox's own local registry. Every write is audit-logged.
- `POST /terminal/authorize` (owner only, 5/min, audit-logged) authorizes the terminal's generated SSH key on the Docker host for
  `TERMINAL_SSH_USER` in one click, replacing the manual `echo '<key>' >> ~/.ssh/authorized_keys`. It reads the account from the host's
  passwd file and appends only the public key with two throwaway helper containers (nothing user-controlled in a command string),
  is idempotent, then tests an SSH login and reports `verified`. `GET /terminal/status` gains `canAutoAuthorize`. Remote servers,
  explicit keys/passwords and the local shell stay manual.

- **Traefik dynamic configuration editor** (`/proxy/config`, owner writes, owner/admin read; `?serverId=` picks the aoox host or a remote
  server). Operator-written YAML files (`http` with `middlewares`, `routers`, `services`, `serversTransports`; `tls`/`tcp`/`udp` and unknown
  keys are refused, max 64 KB, names `[a-z0-9-]` unique per proxy) are stored in the database (`proxy_config_files`) and written to the proxy
  volume as `user-<name>.yml` through the same helper-container mechanism as custom certificates; the sweep only ever matches `user-*.yml`, so
  `certs.yml` and certificate files are never touched (and certificate sync never touches `user-` files). After writing, the API reads
  Traefik's log: an error about the file restores the previous content (database and volume) and answers 400 with Traefik's own message;
  a stopped or missing proxy only gives a warning. A proxy from an older aoox is recreated once to load the directory, and the API asks for
  consent first (`409 proxy-restart-required`, then `acceptProxyRestart: true`; `GET /proxy/config/status` tells the web beforehand).
  `POST /proxy/config/sync` writes everything again. `GET /proxy/config/presets` and `POST /proxy/config/presets/:preset` build YAML for basic
  auth (bcrypt hash only, the password is redacted in the audit log), security headers, rate limit, IP allowlist and www redirect.
  New dependency: `js-yaml` (CJS).
- **Per-domain middlewares.** `PATCH /applications/:id/domains/:domainId` takes `middlewares` (`name@file`, in order; both `certificateId` and
  `middlewares` are now optional, at least one is required) and domains answer with `middlewares`. Traefik labels give each distinct list its
  own router (`-m<hash>` suffix; domains without middlewares keep exactly the labels they had), on the https routers and the plain-http routers,
  never the redirect router. Names must exist in an enabled file on the application's proxy (400); disabling, deleting or rewriting away a
  middleware a domain uses is a 409 naming the domain. `GET /applications/:id/domain-middlewares` lists the choices for any project member.

### Changed

- `GET /compose-apps/:id` also returns `projectRole` (the caller's role in the owning project), like applications and databases, so the dashboard can hide actions from viewers.
- API messages are now English only: the host-port conflict error, template variable errors, template descriptions, variable labels and hints, the proxy config preset labels and hints, and the onboarding step titles and hints (step ids are unchanged). No response shape, id or status code changed; the web app translates the texts it shows.
- Remaining API messages (SQL import result, disk-low hint) are now English.
- Moving an application to another server (`PATCH /applications/:id` with a new `serverId`) now cleans the middlewares of its domains: only names defined by an enabled dynamic config file on the destination proxy are kept, the rest are dropped before the labels are rebuilt, with a warning per domain in the log. The answer gains `droppedMiddlewares: [{domain, names}]` only when something was dropped. Project export/import behavior is unchanged (files and domain middlewares are not exported; an import of a file that carries them still succeeds).

- The web terminal's "SSH authentication failed" message now says which account to run the authorize command as
  and, when the login is `root`, that sshd on cloud servers (Ubuntu and similar) often refuses root login
  (`PermitRootLogin`) — set the user under Infrastructure > Environment and run the command as that user instead.
  `GET /terminal/status` gains an additive `authorizeNote` with the same advice. The one-line authorize command and
  the socket `error` event shape are unchanged.

### Fixed

- Moving an application to another server (`PATCH /applications/:id` with a new `serverId`) now carries its custom SSL certificates along: when a domain of the application uses one, the certificate files are written to the destination proxy (host or remote) first and the files nothing uses any more are swept from the old one, through the existing per-daemon certificate sync. Before, such an https domain served Traefik's self-signed default on the new server until the domain or certificate was saved again. If writing to the destination fails the move still stands and the answer gains `certificateSyncError` (only then) suggesting to save the domain or certificate again; a failed cleanup on the old server is only logged.

## [0.1.0-alpha.6] - 2026-10-05

### Added

- **Custom SSL certificates for application domains.** Upload your own certificate and private key (company CA, a purchased wildcard, Cloudflare Origin CA, networks without Let's Encrypt access) and serve a domain with it instead of an automatic one. `POST/GET/PUT/DELETE /certificates` (owner/admin manage; every member can list names and expiry for the dropdown; the private key is stored encrypted and never returned). Input is validated with Node's crypto: PEM bundle (server certificate first, then the chain), unencrypted key that matches, not expired; `*.example.com` covers exactly one label. Assign it with `certificateId` on `POST /applications/:id/domains` or `PATCH /applications/:id/domains/:domainId` (`null` goes back to automatic); domain responses now include `certificateId` and `certificateName`. Domains with an uploaded certificate are always redirected from http to https and never ask Let's Encrypt. Certificates are written to a proxy volume (keys mode 0600, also on remote servers) and Traefik reloads them on change, so renewing one (`PUT`) needs no restart; a proxy created by an older aoox is recreated once, keeping its ports and ACME state. A certificate that expires within 14 days (or already has) triggers a certificate-failure notification; it never falls back to ACME. New tables/columns `custom_certificates`, `domains.certificate_id` (migration `CustomCertificates`). **Not yet run against a real Traefik or Postgres** (unit tests only).
- **Excalidraw template** (15th one-click template): the open source whiteboard as a static client on port 80, no database or secrets. Pinned by image digest because Docker Hub publishes no version tags for it. Live collaboration (excalidraw-room) is not included.
- **Database companion admin app.** One click installs an admin web UI next to a managed database, in its own container `aoox-dbadmin-<slug>` on the `aoox` network: Adminer or phpMyAdmin (MySQL/MariaDB), Adminer or pgAdmin (PostgreSQL and variants), Mongo Express (MongoDB), Redis Commander (Redis/Valkey), or DbGate (every engine), each on a pinned image tag. Reach it through a domain (proxy labels, proxy provisioned like add-domain) and/or a host port; Adminer and phpMyAdmin use the database login, the others get a generated login (stored encrypted, shown only to non-viewers through `GET /databases/:id/companion/credentials`). Endpoints: `GET/POST/DELETE /databases/:id/companion`, `GET .../companion/options`, `GET .../companion/credentials`; new table `database_companions` (migration `DatabaseCompanions`). The container is not attributed to the database in metrics, a crash sends no container-down notification, and deleting the database removes it. Not exported with projects. **Not yet run against real containers** (unit tests only).

### Fixed

- Creating a database with a host port that something else already publishes (another application, database, stack, an admin-app companion or any running container) is now rejected up front with a 400 instead of being accepted and ending in `error`.
- Replacing a custom SSL certificate no longer causes a transient "private key does not match public key" error in the proxy: certificate files are named after their content, the new pair is written first, the config that points at it last, and the old files are removed afterwards.
- Changing application settings (name, env, health check, previews, …) while a deployment is running is no longer silently reverted when the deployment finishes: the runner now writes only its own columns (`status`, `currentImage`, image digest baseline) instead of saving its stale copy of the whole application, and a settings save no longer overwrites a deployment that finished meanwhile. Host port and secret source still return 409 during a deployment.
- Deleting an application now also removes its pull-request preview containers (on the application's server) and their rows; a preview that cannot be removed is logged and does not block the delete.

## [0.1.0-alpha.5] - 2026-10-02

### Added

- **External secret source for application env (Infisical).** An owner or admin registers a connection once (`POST /secret-connections`: name, optional self-hosted URL, Universal Auth client id and secret, the secret stored encrypted and never returned; list for every member, delete, and a login test). A developer then points an application at it with `PUT /applications/:id/secret-source` (connection, project id, environment, path, sync) and can preview the **key names** (never values). When the container is created (deploy, config change, rollback, one-off jobs) aoox logs in, lists the folder and injects the secrets: priority is project env < Infisical (with `sync`) < application env, and `${{secret.KEY}}` works in project and application env (an unknown key is a 400 when saving env, or a failed deployment). aoox is only a client of an Infisical you already have (Cloud or self-hosted); there is no Infisical template. Nothing is stored or cached: the token and values live in memory for one call, and every value is registered for log redaction (deployment log, job output, app-error notifications, which withhold their log samples if the source is unreachable). A failing source fails the deployment with a short message and leaves the running container alone; **pull-request previews never inherit the source** (an application that references `${{secret.KEY}}` makes its preview fail with a clear message). `get-application` returns `secretSource` (or null), and project export/import carries the connection **name** and location without credentials (a missing connection on import leaves the source empty with a warning). New module `secret-source`, migration `SecretSource`. **Not tested against a real Infisical** (checked against a local stand-in that follows the documented endpoints, plus unit tests); the v3 fallback for older self-hosted versions and the order of imported folders are unverified.

- **Metrics, container-down and reachability for remote servers.** Applications on a remote server (`Application.serverId`) are now monitored like local ones. A sampler per server reads the managed containers through the cached SSH tunnel every 30 s (two `stats` per container, at most 3 at a time, each server's round independent and capped at 25 s, never stacked) into a cache of its own, so the application metrics endpoint, the 24 h/7 d/30 d rollups (`aoox.application/.database/.compose` labels) and the project resource usage card include them, while the host totals stay local. One `GET /events` (`die`) stream per server with its own backoff follows the `servers` table and restarts when a server's session is dropped; `ContainerDownNotifier` handles those events with the same rules as local ones (re-check on that server's daemon, message names the server). A minute health check (`servers.health_*`, migration `ServerHealthAndMonitorToggles`) records up/down/since/error/monitored containers on the server row (`ServerDto.health`, read without calling the server) and sends `serverDown` after two failed checks in a row, at most hourly while down, plus one "reachable again" message. Disk watcher, certificate watcher and disk retention stay local. The `on_server_down` toggle is on by default: it only matters to people who added servers.
- **Optional per-application HTTP monitor** (`/applications/:id/monitor`, module `http-monitor`, migration `HttpMonitors`). Config per application (path, interval 1–60 min, timeout, healthy status codes, failures in a row, internal-address switch), a once-a-minute scheduler that runs only the due monitors of running applications (five at a time, no overlap, quiet during a deploy and for 60 s after), results kept 7 days (status, latency, code — never the response body), down incidents, uptime 24 h/7 d and average/p95 latency, and `httpDown` notifications (one when the failure count is reached, a reminder at most every 6 h, one when healthy again with the downtime). **The host is never user input**: it is derived from the application (first domain, else host port, else the container name on the `aoox` network), only a validated path is accepted (single leading `/`, no `//`, `..`, control characters or spaces), redirects stay on the same host and port (max 3), the body is read to a 64 KB cap and dropped. State lives on the monitor row, so an API restart neither forgets an outage nor announces a healthy application as down. `PUT`/`check` are writes (viewers read only); project export/import carries the settings. The `on_http_down` toggle is on by default because the monitor itself is opt-in.
- Notification toggles are now guarded by a test that walks the entity's `on_*` columns and checks each one exists in the create DTO, the event map and what `create` really stores (the class of bug behind `onDnsIssue`).

- **Root directory for monorepos** (`Application.rootDirectory`, migration `ApplicationRootDirectory`): an application can build a **subfolder** of its repository instead of the
  root, for every git build type (Dockerfile, Nixpacks, Railpack, static site) and for pull request previews. Dockerfile builds use the Engine API git context with a
  subdirectory (`#branch:folder`); the Nixpacks, Railpack and static helpers clone and then build from `/src/<folder>`, so `dockerfilePath` and `staticOutputDir` are relative to
  the folder. Empty = repository root, exactly as before. The value is validated in the create and update DTOs and again right before use (letters, digits, `.` `_` `-` separated by `/`;
  no `..`, no leading or trailing `/`, no `.git`), and reaches the helper scripts through an env var, never spliced into the shell; a symlink that resolves outside the clone is
  refused. A folder missing on the branch fails the deployment with `Root directory "x" was not found in the repository` and leaves the running container alone. The first build log
  line names the folder. Project export/import carries the field (optional in older files). Limit: files outside the folder are not part of the build context.
  Tested with a real local git daemon: Dockerfile and static roots, wrong and empty roots, hostile paths (400), webhook and preview. **Not tested end to end:** Nixpacks and Railpack
  (the antivirus on the test machine intercepts their downloads inside containers), only the assembled scripts and env are unit-tested.
- **`watchRootOnly` webhook option** (default off): with a root directory set, a GitHub or GitLab push only deploys when a changed file lies under it (`commits[].added/modified/removed`).
  It answers `ignored` only when every commit provably stays outside; anything it cannot judge (no file lists, a merge commit without lists, 20 or more commits, a forced push, a new
  branch) deploys as usual. Pull request previews are not filtered.

- **Seven more one-click templates** (catalog is now 13): **Vaultwarden** 1.37, **Umami** 2.20 (PostgreSQL), **Grafana** 13.0, **Metabase** 0.63 (PostgreSQL), **Directus** 12.4 (PostgreSQL),
  **Mattermost** Team Edition 11.11 (PostgreSQL) and **Nextcloud** 32 (PostgreSQL, Redis and a separate cron container). Image tags are pinned to versions that exist in the registries
  (Docker Hub, GHCR), databases get a health check and the app waits for it (`depends_on: service_healthy`), data lives in named volumes, and every password, secret and key variable is
  generated. The catalog spec now also checks that every image carries an explicit tag. Each template was deployed through `POST /compose-apps/from-template` on a local stack behind
  the proxy and answered on its health or status endpoint (Directus login also checked); Grafana and Umami kept their data across a container recreate, and Nextcloud was confirmed to use
  PostgreSQL and Redis. Stacks, volumes and images were removed afterwards. Not tested: upgrades between template versions, real HTTPS/ACME, backups of the in-stack databases.

- **Odoo Community one-click template** (catalog is now 14): Odoo 19.0 (LGPLv3, Community only, no Enterprise modules) plus PostgreSQL 16. Decisions: the image is pinned to the dated tag
  `odoo:19.0-20260926` (the `19.0` tag moves every night; 19.0 is the middle of the three majors published on Docker Hub (18.0, 19.0, 20.0), a conservative pick over the newest 20.0), configuration comes from an inline compose `configs` entry
  mounted at `/etc/odoo/odoo.conf` (Odoo has no command-line or environment option for the master password, only the config file) with `proxy_mode = True`, `workers = 0` (one process,
  small installs) and `list_db = True` so the first database can be created from the web page; the database connection uses the image's `HOST`/`USER`/`PASSWORD` variables. The master password
  is a generated variable (`MASTER_PASSWORD`), never a default. The hint tells where to read it (stack page, Settings, environment, "Show values"). Both services have health checks
  (`/web/health` for Odoo, `pg_isready` for PostgreSQL). Deployed through `POST /compose-apps/from-template` behind the local proxy: healthy in about 16 s; the generated master password was
  accepted by `/web/database/create` (a wrong one was refused and created nothing), the first database took about 23 s, admin login worked, `proxy_mode` was confirmed (forwarded client
  address honoured), and after removing the containers and redeploying the database and login were still there. Measured once right after creating the database and logging in: about
  103 MiB for Odoo and 85 MiB for PostgreSQL (idle, not a sizing guide). Not built: multi-worker mode with a separate websocket route, automatic closing of the database manager, custom addons volume.

### Changed

- `GET /applications?projectId=` now also returns each application's `domains` (`[{host, https}]`, oldest first), so the project page can link to the running app. One extra
  `domains` query for the whole list (`id IN (...)`, none when the project has no applications), not one per app; no secrets involved. Covered by
  `list-applications.service.spec.ts`.

- Project metadata for discoverability (no behavior change): `package.json` gets `description`, `keywords`, `homepage` (https://aoox.dev), `repository` and `bugs`; the
  README links to the website, docs and changelog and to the other three repos; the runner image carries OCI labels
  (`title`, `description`, `url`, `documentation`, `source`, `licenses`, `vendor` — deliberately no `version`/`revision`,
  which would go stale in a static file). The labels are only in the Dockerfile (the publish workflow does not use
  `docker/metadata-action`, so there is one place). Not tested end to end: a full `docker build` fails on this
  machine (antivirus TLS interception during `npm ci`); the label block was validated on its own (`docker inspect`).

### Fixed

- `docker-compose.dist.yml` now forwards four variables to the `api` container that the code already read but the
  compose file never passed on, so they could not be set on a dist install without editing the compose file:
  `API_IMAGE`/`WEB_IMAGE` (defaults identical to the `image:` lines, so behavior is unchanged) — the panel uses
  `API_IMAGE` to tell whether the install follows `:latest` (pinned tags get no "update available" badge) — and the
  optional `WEBHOOK_VERIFY_GITHUB_IP` and `PREVIEW_DOMAIN` (empty by default = off/unset; both readers already treat an
  empty string that way, now covered by a test). **Existing installs only receive them through `aoox reinstall`**:
  `aoox update` and the dashboard's "Apply update" swap images but never rewrite the compose file, so an install
  created earlier keeps its old compose (and the badge falls back to reading the container's own image reference)
  until it is reinstalled. `.env.dist.example` documents the four variables.

## [0.1.0-alpha.4] - 2026-09-29

### Added

- **"Update available" signal for the dashboard sidebar.** The API now looks up the newest published
  `hideandseeklab/aoox-api` version on its own — once ~20-60 s after boot and every 6 hours (plus
  jitter), never per request — and caches it in two new nullable columns on `instance_update_state`
  (`latest_version`, `latest_checked_at`; migration `InstanceUpdateLatestVersion`, additive, tested up
  and down with data present). The source is the registry tag list (`GET /v2/<repo>/tags/list`, same
  Bearer flow as the digest check), compared with the running `package.json` version by a real
  semver comparator (`0.1.0-alpha.9 < 0.1.0-alpha.10`, a stable release outranks its pre-releases; a
  stable install is never offered a pre-release). Whether it counts as an update is derived on read,
  so it disappears the moment the running version catches up. Registry/network failures are silent
  (debug log only) and keep the previous cache: an install without internet access behaves as before.
  It only shows for installs that follow `:latest`: the tag is read from `API_IMAGE`, or, because the
  stock compose file does not pass that variable to the container, from the image the running container
  was created from (one Docker `inspect` per process); an exact version, another tag, a digest, or a tag
  that cannot be determined never produces a badge. `GET /auth/me` returns `updateAvailable: { version,
  applying }` **for the owner only** (from the cached row, no registry call); `GET /instance/update`
  now includes a `version` block and every manual "Check for updates" refreshes the cache, so the sidebar and
  the Update page cannot disagree. `INSTANCE_UPDATE_REGISTRY_URL` overrides the registry base URL
  (mirrors, tests).
- Static sites (`buildType: static`, SPA mode off) now serve the repo's own `404.html` for missing paths
  (`error_page 404 /404.html` + an `internal` location in the generated nginx conf); when the repo has no
  `404.html`, nginx falls back to its default 404 page as before. SPA mode is unchanged (everything falls back
  to `/index.html`). Found while testing a sample static site end to end against the dev stack.

- `GET /auth/me` now also returns `version`, the API version actually running (from `package.json`,
  read once), for every role. The web sidebar shows it under the logo; `GET /instance/update`, which
  also reports it, stays owner-only.
- `instance_update_state` gets two new columns, `apply_started_at`/`apply_from_version` (migration
  `InstanceUpdateApplyState`, additive), so
  `GET /instance/update` and a new lightweight `GET /instance/update/progress` (no registry calls —
  see below) can report `applying: boolean` for the "Apply update" flow on the dashboard: set by
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

- Changing an application's Port host in Settings did nothing to the running container: only the
  database row changed, so the port stayed closed until the next deploy or rollback (reported on a real
  VPS with a nixpacks app: `docker ps` showed `3000/tcp` with no `0.0.0.0:5434->3000`). `PATCH
  /applications/:id` now applies it right away, for a port added, changed or removed: the running
  container is recreated from `currentImage` (no build); a swarm service gets a queued `config`
  deployment; a stopped app is left stopped and `POST /applications/:id/start` recreates its container
  when the container's published port no longer matches (re-checking the port is free first, since the
  recreate removes the old container). While a deployment is active the change is refused with 409,
  because a deployment holds its own copy of the app and would both create its container with the old
  port and write the old port back on finishing. If recreating fails (e.g. the port was taken between
  the conflict check and the create), the previous port is restored in the database and on the daemon
  and the request fails with a 409 saying so, rather than leaving the app without a container.
- The web Terminal on installs made before the installer wrote `TERMINAL_SSH_USER=root` failed with
  `TERMINAL_SSH_USER is not set` even with `TERMINAL_SSH_HOST` filled in: those `.env.dist` files have
  no such line, and `aoox update` / "Apply update" only swap images, never `.env.dist`. The
  SSH-to-host backend now defaults to `root` when the variable is empty (the same default the
  installers use — the install itself needs root); remote servers keep their own `username`.
  `GET /terminal/status` no longer reports that error and gains `usernameSource: 'env' | 'default'`
  (null in local mode), `GET /instance/env` gains `terminalSshUserDefault`, and the Socket.IO `error`
  event carries an optional second argument `hint` (`'environment'` for the host, `'servers'` for a
  remote server) so the web app can link to the page that fixes a failed connection.
- The "Apply update" button's UX bug reported by a user upgrading a real VPS from alpha.2 to
  alpha.3: clicking it briefly showed a red "Could not reach the server" error (expected — the
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
  from the snippets. New per-application switch **Ignore error logs** (`ignoreErrorLogs`, Settings
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

[Unreleased]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.12...HEAD
[0.1.0-alpha.12]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.11...v0.1.0-alpha.12
[0.1.0-alpha.11]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.10...v0.1.0-alpha.11
[0.1.0-alpha.10]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.9...v0.1.0-alpha.10
[0.1.0-alpha.9]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.8...v0.1.0-alpha.9
[0.1.0-alpha.8]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.7...v0.1.0-alpha.8
[0.1.0-alpha.7]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.6...v0.1.0-alpha.7
[0.1.0-alpha.6]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.5...v0.1.0-alpha.6
[0.1.0-alpha.5]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.4...v0.1.0-alpha.5
[0.1.0-alpha.4]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.3...v0.1.0-alpha.4
[0.1.0-alpha.3]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.2...v0.1.0-alpha.3
[0.1.0-alpha.2]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.0...v0.1.0-alpha.1
[0.1.0-alpha.0]: https://github.com/hideandseeklab/aoox-api/releases/tag/v0.1.0-alpha.0
