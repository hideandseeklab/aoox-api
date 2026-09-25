# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions below 1.0.0 may include breaking changes in a minor release.

## [Unreleased]

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

[Unreleased]: https://github.com/hideandseeklab/aoox-api/compare/v0.1.0-alpha.0...HEAD
[0.1.0-alpha.0]: https://github.com/hideandseeklab/aoox-api/releases/tag/v0.1.0-alpha.0
