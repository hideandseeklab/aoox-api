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

All aoox issues, including bugs and feature requests for the dashboard ([aoox-web](https://github.com/hideandseeklab/aoox-web)), the CLI ([aoox-cli](https://github.com/hideandseeklab/aoox-cli)) and the docs/website, are tracked in this repository. Use the [issue forms](https://github.com/hideandseeklab/aoox-api/issues/new/choose) and give steps to reproduce, what you expected, and what happened instead.

## Contributing to other repositories

Issues go here, but pull requests go to the repository that holds the code: [aoox-web](https://github.com/hideandseeklab/aoox-web) for the dashboard, [aoox-cli](https://github.com/hideandseeklab/aoox-cli) for the CLI, [aoox-landing](https://github.com/hideandseeklab/aoox-landing) for the website and docs. Each repository has its own setup in its README.

## Reporting security issues

Please do not open a public issue for security vulnerabilities — see [SECURITY.md](SECURITY.md).
