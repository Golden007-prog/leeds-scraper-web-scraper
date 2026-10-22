# Contributing to Leeds Harvester

Thanks for helping. Bug reports, fixes, new scrapers, docs and design improvements are all welcome.

## Set up

```sh
git clone https://github.com/KritishX/Leeds-Harvester.git
cd Leeds-Harvester
nvm use          # Node 24.18.0 from .nvmrc; any Node ≥ 24.15 with node:sqlite works
npm ci
npm run dev      # UI at http://localhost:4180, API at http://localhost:4181
```

Before opening a pull request, run:

```sh
npm test         # node:test suites
npm run build    # TypeScript check + production build
```

## Where things live

| Path | Owns |
| --- | --- |
| `server/index.mjs` | HTTP API, run queue, retention, scheduler, static serving |
| `server/crawler.mjs` | URL safety checks, page fetching and extraction |
| `server/catalog.mjs` | The scraper catalog, which is the only source of scraper names and status |
| `src/main.tsx` | React UI, which reads the catalog from `/api/catalog` |
| `docs/` | API contract, security model and validation record |

## Adding a scraper

1. Add an entry to `server/catalog.mjs`. Mark it `status: "requires-provider"` until it really runs.
2. Add its extraction branch in `extractPage` (`server/crawler.mjs`). Every record must keep `sourceUrl` and `collectedAt`, and every extracted string must be capped.
3. Add a fixture test in `tests/crawler.test.mjs`.
4. Document it in the README's scraper table.

Never show sample or made-up records as if they were collected data. A scraper either collects real data or is labelled as unavailable.

## Ground rules for changes

- **Keep the crawl boundary intact.** Every fetched URL, including redirects, must pass `validateUrl` and the DNS check in `publicAddress`. Pull requests that weaken these checks won't be merged.
- **Respect the limits.** New work must stay within the run, page and byte limits listed in [docs/security-model.md](docs/security-model.md). Use bounded regular expressions. Unbounded patterns such as `+@` can freeze the server.
- **Test behaviour, not wiring.** Prefer tests through the public HTTP API (see `tests/api.test.mjs`). Bug fixes should include a test that fails without the fix.
- **Say only what the code does.** UI text and docs must not claim integrations, delivery or providers that aren't implemented.
- **Collect public data only.** Don't add features that bypass logins, paywalls, bot challenges or a site's access rules.

## Pull requests

- Keep each pull request focused on one change and describe what changed and how you tested it.
- Use [Conventional Commit](https://www.conventionalcommits.org/) titles, for example `fix(crawler): reject redirects to private hosts`.
- Update `docs/api-contract.md` when an endpoint changes, and `docs/security-model.md` when a boundary or limit changes.

## Reporting bugs and ideas

Open an issue using the bug report or feature request form. For security problems, follow [SECURITY.md](SECURITY.md) and don't open a public issue.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).
