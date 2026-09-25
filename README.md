# aoox

Self-hosted PaaS. Two repos:

- **aoox-api** (this repo) — NestJS 11 + TypeORM + PostgreSQL
- [aoox-web](https://github.com/hideandseeklab/aoox-web) — Next.js 16 dashboard

## Run with Docker (distribution)

Requirements: Docker 24+ with Compose v2.

```bash
git clone https://github.com/hideandseeklab/aoox-api.git && cd aoox-api
cp .env.dist.example .env.dist
```

Edit `.env.dist` — at minimum:

| Variable | Notes |
|---|---|
| `POSTGRES_PASSWORD` | any strong password |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` (encrypts registry credentials) |
| `DOCKER_GID` | gid of `/var/run/docker.sock` on the host, so the api container may use Docker |
| `WEB_ORIGIN` / `PUBLIC_API_URL` | the URLs users will reach the web and API on (e.g. `http://192.168.1.10:3000` / `http://192.168.1.10:3001`) |

Then:

```bash
docker compose -f docker-compose.dist.yml --env-file .env.dist up -d
```

Open `WEB_ORIGIN` in a browser. On first run you are sent to **/setup** to create the owner account.
For non-interactive installs set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env.dist` instead; they are only
applied while the users table is empty and never overwrite an existing account.

Images are published to Docker Hub (`hideandseeklab/aoox-api`, `hideandseeklab/aoox-web`) on every
tagged release, tagged `latest` and `<version>`. To build from source instead, check out both repos
side by side and add `-f docker-compose.build.yml --build`.

### Web terminal (shell on the host)

A container cannot open a shell on its host directly, so the API connects to the host over SSH:

1. Run an SSH server on the host (Linux: `sshd`; Windows: the *OpenSSH Server* optional feature).
2. `ssh-keygen -t ed25519 -f ./secrets/terminal_ssh_key -N ""` and add `secrets/terminal_ssh_key.pub` to that user's `authorized_keys`.
3. Set `TERMINAL_SSH_HOST` (default `host.docker.internal`), `TERMINAL_SSH_USER` and keep `TERMINAL_SSH_PRIVATE_KEY_FILE` as in the example.

Leave `TERMINAL_SSH_HOST` empty and the terminal opens inside the api container instead. Only `owner`/`admin` users can use it.

### Local Docker registry

**Registry → Provision registry** starts `registry:3` on the host engine (container `aoox-registry`, data in the
`aoox_registry_data` volume) with htpasswd auth; the generated password is shown once. Push with

```bash
docker login localhost:5000 -u aoox
docker push localhost:5000/<name>:<tag>
```

`localhost:5000` works without TLS because Docker exempts localhost. To push from other machines, put the registry behind
a TLS reverse proxy and set `REGISTRY_PUBLIC_HOST` to that hostname (or add it to `insecure-registries` on each client).
Deleting a tag deletes its manifest (other tags on the same digest go with it); run **Garbage collect** to reclaim disk.
External registries (Docker Hub, GHCR, GitLab) can be added on the same page; credentials are stored AES-256-GCM encrypted.

### Domains and HTTPS for applications

**Settings → Provision proxy** starts Traefik (`aoox-proxy`) on `PROXY_HTTP_PORT`/`PROXY_HTTPS_PORT` (80/443).
Add hostnames on an application's **Domain** tab; the container is re-created with Traefik labels and joins the
`aoox` network, so no host port is needed. Point the DNS A record at the server. With `PROXY_ACME_EMAIL` set,
domains marked HTTPS get Let's Encrypt certificates (HTTP-01 challenge, so port 80 must be reachable from the internet;
`PROXY_ACME_STAGING=true` for testing).

### Data browser

Every managed database has a **Data** tab — a small phpMyAdmin: browse tables (paged, sortable), a **Struktur** view of
each table's columns and primary key, one SQL statement or Redis command at a time, and a **Riwayat** dropdown of your
own recent statements to re-run. Owners and admins can also edit or delete a single row (targeted by its primary key —
a table without one has to be edited with SQL) and export a table or a full database dump as CSV/SQL; members get a
read-only session. Every call spins up a short-lived container of the database's own image, so nothing needs a driver
installed in the API.

### Database backups

Every managed database (Postgres, MySQL, MariaDB, Redis) has a **Backup** section on its page: run a backup now, restore
one (overwrites the current data), download it, or schedule backups with a cron expression and a retention count
(old *scheduled* backups beyond that count are pruned; manual backups are kept). Dumps live in the `aoox_backups`
Docker volume, one folder per database, and are produced by the engine's own tools (`pg_dump`, `mysqldump`, `redis-cli --rdb`)
running in a throw-away container, so nothing extra needs to be installed. To move backups off the server, copy that volume
(e.g. `docker run --rm -v aoox_backups:/b -v "$PWD":/out busybox tar czf /out/backups.tgz -C /b .`).

### Mounts

An application's (or database's) **Mount** tab attaches persistent storage: a named Docker volume (survives redeploys), a host
directory (owner/admin only) or a small config file kept on the platform and mounted read-only. Changes re-create the
container immediately — no rebuild.

### Disk cleanup

**Settings → Disk Docker** shows what images, volumes, build cache and containers use, and **Bersihkan sekarang**
(also nightly at 04:30, `MAINTENANCE_NIGHTLY=false` to disable) prunes old deployment images beyond each
application's *Riwayat deployment* (default 10, the running image is always kept), dangling images, the build cache and
the local registry's orphaned blobs. If any local volumes are named like aoox's own but no longer belong to any
project (an app, database or compose stack deleted without its mounts, or a leftover from an older version), they are
listed too and can be removed with the same button via an extra "Sekalian hapus volume yatim" switch — off by default
and never included in the nightly run, since a volume can hold data nothing else backs up.

### Docker Swarm (optional)

**Settings → Infrastruktur → Docker Swarm** turns the host daemon into a (single-node) swarm manager. An application
can then choose **Mode deploy: Swarm service** with N replicas: the daemon does the rolling update (`start-first`,
automatic rollback on failure), Traefik load-balances the tasks, stop/start scale to 0 and back, logs and metrics come
from the tasks. Everything else (databases, compose stacks, previews) stays plain containers, and leaving the swarm is
refused while service-mode apps exist. Extra nodes can join with the shown `docker swarm join` command; a service can
then be pinned to a node (**Penempatan**) or placed anywhere, while apps with mounts always stay on the host where
their volumes live. Built images are pulled from the self-hosted registry, so for other nodes set `REGISTRY_PUBLIC_HOST`
to an address every node can reach (plus `insecure-registries` or TLS on each daemon) and re-provision the registry —
public images need nothing. Job exec and metrics only cover tasks running on the host; logs cover every node.

### Metrics history

The CPU/memory/network panel on an application or database keeps its live hour in memory as before, and now also
stores a rollup: one row per minute (kept 48 hours) and one per hour (kept `METRICS_RETENTION_DAYS`, default 30), so
the **24 jam / 7 hari / 30 hari** buttons work and history survives an API restart. Compose stacks get the same
buttons for any service that has a domain, host port, mount or resource limit configured — that is what tags its
containers for the rollup; a stack with none of those stays live-only, same as before.

### Container log rotation

Every container aoox starts (applications, databases, proxy, registry, and the panel itself in
`docker-compose.dist.yml`) uses the json-file log driver with rotation — `CONTAINER_LOG_MAX_SIZE` (default `10m`)
× `CONTAINER_LOG_MAX_FILE` (default `3`) — so a chatty app cannot fill the disk with logs. Existing containers pick it
up on their next deploy or re-provision. Compose stacks are not touched: set `logging:` in the compose file or
`log-opts` in the daemon's `daemon.json`.

### Volume backups

Volume mounts get the same treatment as databases: back up on demand or on a schedule (per application, all volumes),
keep N copies, optionally copy to an S3 destination, download, and restore — the container is stopped while the volume
is rewritten. Database and volume backups whose local file is gone (pruned, new disk) are pulled back from S3
automatically when you restore or download them.

### Project members

Platform owners/admins see every project. Other users only see projects they created or were added to: open a
project → **Anggota** and add an existing account by e-mail as admin, developer or viewer (project admins manage
members and may delete the project; developers do everything else; viewers can only read). Upgrading keeps everyone's
current access — existing members are added to every existing project.

### Account security

**Settings → Akun** lets every user change their password and turn on two-factor authentication (TOTP: scan the QR
with any authenticator app, keep the ten backup codes). Sign-in then asks for a code after the password. Owners can
reset a member's password or switch off their 2FA from the Members card. **Settings → Audit log** (owner/admin) lists
every state-changing request and sign-in attempt for 90 days: who, via session/API token/webhook, what, and the result.

### API tokens and OpenAPI docs

**Settings → API token** creates a personal access token (`aoox_…`, shown once) for CI or scripts; send it as
`Authorization: Bearer aoox_…` and it acts as your user. A token can be narrowed when you create it: **read only**
(every state-changing request is refused) and/or **limited to projects** — such a token sees only those projects
and cannot manage platform settings (registries, servers, proxy, swarm, notifications, members, audit log); the
read-only listings every member can see stay available. A scope never grants more
than the account itself has, and tokens cannot create or revoke tokens — sign in for that. The API documents itself at `http://<api>:3001/docs`
(Swagger UI, `/docs-json` for tooling). Example:

```bash
curl -X POST http://localhost:3001/applications/<id>/deploy -H "Authorization: Bearer aoox_..."
```

### Remote servers

Add a server (Settings → Servers) and deploy applications to it over SSH. **Proxy** on the server card provisions a
Traefik on that server (own ports, own ACME e-mail), so domains and HTTPS work there like on the host; volume backups
(including S3 copies) run on the server's daemon too.

### Notifications and outgoing webhooks

Channels (Telegram, Slack, Discord, e-mail, generic webhook) get deployment, backup, job and container-down events,
plus **disk almost full** (daily, `DISK_ALERT_PERCENT`, default 90), **certificate failures** (Traefik ACME errors,
checked every 10 minutes) and **DNS issues** (every registered domain re-checked every 15 minutes; a domain that
stays mismatched or unresolved for two checks in a row alerts once a day — this usually catches the cause of an
ACME failure before the certificate attempt itself fails). A generic webhook with a *secret* signs every delivery: verify
`X-Aoox-Signature` = `sha256=HMAC-SHA256(secret, raw body)`; `X-Aoox-Event` and `X-Aoox-Delivery`
identify the event and the delivery.

### Ready-made images

Choose **Image siap pakai** as the source to run an existing image (`nginx:1.27`, `ghcr.io/org/app:1.2`) without a
build: it is pulled on every deploy (so `latest` follows the registry) using the credentials of a registry from the
Registry page for private images. Env, mounts, domains, jobs and rollback work the same as for built apps.
Turn on **Update otomatis** to redeploy whenever the tag's digest changes in the registry (Watchtower-style: the
manifest is compared through the registry API every N minutes, no pull), or press **Cek update image** to check now.

### Railpack builds (with cache)

Besides a Dockerfile, Nixpacks and static sites, an application can build with **Railpack** (Railway's builder).
Railpack compiles the repo into a BuildKit plan, so dependency layers are cached between deploys — measured here:
284 s cold, 8 s for a redeploy with no source change. It starts a shared `moby/buildkit` container (own volume) on
first use; the nightly cleanup trims that cache to `BUILDKIT_CACHE_KEEP_GB` (default 10). Railpack images listen on
`$PORT`, which aoox sets to the app's container port. Host only — applications on a remote server keep using
Dockerfile or Nixpacks.

### Static sites

Pick **Situs statis (nginx)** as the build type for plain HTML or SPA repos: an optional build command runs in
`node:22-alpine`, the output folder (`dist`, `build`, `out` or `.`) is served by nginx on port 80, with an SPA fallback
to `index.html` when enabled.

### Compose stacks

A stack is a `docker-compose.yml` from a repository (or a template): deploy, stop, start and tear down from the panel.
The **Riwayat** tab keeps the last 20 runs with their output — what was run, when, and whether a push triggered it —
and the **Webhook auto-deploy** card on Pengaturan gives a URL to paste into GitHub/GitLab, with an optional shared
secret that every delivery must prove. Stack containers now also show live CPU/RAM per service, and a service that
dies outside a deploy raises the same "container down" notification applications get.

Incoming webhooks (application and compose alike) with a secret set can optionally also require the delivery to come
from one of GitHub's own published IP ranges — `WEBHOOK_VERIFY_GITHUB_IP=true` — as a second layer on top of the
signature. Off by default, and GitHub.com only: GitLab does not publish a stable set of source IPs, and a self-hosted
GitHub Enterprise Server sends deliveries from its own network, not GitHub's, so this would reject real pushes there.

The **Mount** tab attaches a volume, a host bind (owner/admin) or a small config file to one named service in the
stack — same three kinds an application gets, just pointed at a service instead of a single container. **Pengaturan**
also has a per-service CPU/RAM cap. Both take effect on the stack's next deploy, the same as domains and ports.

### Scheduled jobs

The **Jobs** tab (applications, databases and compose stacks) runs a command on a cron schedule (or on demand), either
inside the running container or in a throwaway container from the same image with the same env and mounts. Each run keeps its exit code and output;
failures and timeouts trigger notifications.

### One-click templates

**Templates** lists ready-made stacks (WordPress, Ghost, n8n, Uptime Kuma, MinIO, Gitea). Pick a project, optionally a
hostname per exposed service (routed by the proxy, HTTPS when ACME is configured) and fill the few variables — passwords
left empty are generated. The result is an ordinary compose stack: its `docker-compose.yml` and env can be edited on the
stack's page and redeployed.

### HTTPS

Put a reverse proxy (Traefik, Caddy, nginx) in front of ports 3000/3001 and set `WEB_ORIGIN`/`PUBLIC_API_URL` to the `https://` URLs.
The session cookie gets the `Secure` flag automatically when `WEB_ORIGIN` is `https://` (override with `COOKIE_SECURE`).

### Project export and import

**Ekspor** on a project page downloads its definition as `<name>.aoox.json`: applications (source, build, env,
domains, mounts, jobs, backup schedule), databases and compose stacks. Registries, git credentials, backup destinations
and servers are referenced by *name*; owners can include database passwords. **Impor** on the projects page creates a
new project from such a file on this or another instance: nothing is deployed, databases are provisioned empty
(imported or fresh password), webhook tokens are regenerated, and a report lists what could not be matched (renamed
slugs, missing references, host ports or domains already in use).

### Instance backup and restore

**Settings → Infrastruktur → Backup instance** (owner) snapshots the panel's own database — projects, applications,
databases, users, servers, notifications, schedules — into `aoox_backups/_instance/<stamp>.json.gz`, on demand
or on a cron, with an optional S3 copy and retention. Secrets stay encrypted. To move to a new server: install the
same aoox version with the same `ENCRYPTION_KEY` (and `JWT_SECRET`), then **Restore dari file** with the
downloaded snapshot; running containers are untouched, and a restore never mixes versions (the migration list must
match). App/database data itself is covered by the database, volume and S3 backups above.

## Development

```bash
npm install
cp .env.example .env        # fill JWT_SECRET; ADMIN_* gives you a dev login
npm run db:up               # Postgres in Docker
npm run migration:run
npm run start:dev           # http://localhost:3001
```

Schema changes go through migrations (`npm run migration:generate -- src/modules/database/migrations/<Name>`).
`npm test` runs the unit specs; `npm run lint` and `npm run build` must be clean.

## Versioning

This repo follows [Semantic Versioning](https://semver.org/) independently from `aoox-web`,
`aoox-landing`, and `aoox-cli` — each has its own version number and release cadence. Below
1.0.0, a minor bump may include breaking changes. See [CHANGELOG.md](CHANGELOG.md).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache 2.0](LICENSE)
