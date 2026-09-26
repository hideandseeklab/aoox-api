# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions below 1.0.0 may include breaking changes in a minor release.

## [Unreleased]

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

[Unreleased]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.0...v0.1.0-alpha.1
[0.1.0-alpha.0]: https://github.com/hideandseeklab/aoox-api/releases/tag/v0.1.0-alpha.0
