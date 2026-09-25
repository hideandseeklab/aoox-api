# Contributing

Thanks for considering a contribution to aoox.

## Development setup

```bash
npm install
cp .env.example .env        # fill JWT_SECRET; ADMIN_* gives you a dev login
npm run db:up               # Postgres in Docker
npm run migration:run
npm run start:dev           # http://localhost:3001
```

## Before opening a pull request

- `npm run lint` and `npm run build` must be clean.
- `npm test` must pass. Add a spec next to the file you changed (`*.spec.ts`) for new behavior.
- Schema changes go through a migration: `npm run migration:generate -- src/modules/database/migrations/<Name>`.
- Keep pull requests focused — one change per PR is easier to review.

## Reporting bugs

Open an issue with steps to reproduce, what you expected, and what happened instead.

## Reporting security issues

Please do not open a public issue for security vulnerabilities — see [SECURITY.md](SECURITY.md).
