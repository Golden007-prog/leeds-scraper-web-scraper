# Validation record

This record lists checks that were actually run, with their scope and limits. Last updated 2026-10-23.

## Automated tests

`npm test` runs 9 `node:test` tests (Node 26.7.0 locally; `.nvmrc` pins 24.18.0). All pass.

| Test | Establishes |
| --- | --- |
| Local workspace workflow | Workspace works with no sign-in; Origin and Host guards (403); private-URL rejection; provider templates refuse to run; real worker run with a fixture page; CSV formula neutralization; tasks, cron schedules, integration preferences; abort during a run; persistence across a server restart; deleting a task deletes its schedules; start URLs above `maxPages` are rejected |
| Retention vs. abort | A run marked `ABORTED` while its worker is still running is never pruned. **Without the fix this test fails** (checked by temporarily reverting it). |
| Schedule edits | Rename/toggle keeps the pending run time; cron can switch to an interval |
| Cron semantics | UTC planning, malformed or impossible expressions rejected, day-of-month OR day-of-week |
| Extractors | Source URL and timestamp on every record; fields per scraper; scripts removed |
| URL boundary | Loopback, private, encoded IPv4, IPv6, credentials, non-HTTP and nonstandard ports rejected |
| Email extraction | 200,000 address characters handled in under 1 s (the former pattern grew quadratically) |
| Field caps | Title and description are truncated to their caps |

`npm run build` (TypeScript check plus Vite production build) passes. `tsc --noUnusedLocals` is clean.

## Manual and live checks

- **Crawler sockets (live network):** after a 404, a non-HTML response and a redirect, no TCP or TLS handles stayed open.
- **Email pattern timing:** the old pattern took 50, 166 and 655 ms on 10k, 20k and 40k characters. The bounded pattern took 1.4, 3.0 and 5.7 ms, and 264 ms on 2 MB.
- **Dev server (fresh processes):** all four returned 403: `/data/leeds.sqlite`, `/data/leeds.sqlite-wal`, a backup database and the `/@fs/…` path. A foreign `http://localhost:3000` origin got no CORS header. A declared 40 KB body got a 413 response instead of a connection reset.
- **End to end:** four real runs against `example.com` and `www.iana.org` pages succeeded through the API (1–3 pages each). Screenshots of the homepage, Store, dashboard and run detail were taken with headless Chrome against that workspace. They are in [`screenshots/`](screenshots/).

## Security review

The review followed Cloudflare's `security-audit` skill in guidance mode, a focused review as agreed with the owner. Two independent read-only reviewers (backend and frontend) and the implementer did source review. No full six-phase audit artifacts were produced, and the reviewers ran none of the app's code.

| Finding | Outcome |
| --- | --- |
| Email regex, quadratic time; one crafted page could block the server | Fixed (bounded pattern) and regression-tested |
| Vite dev server could serve the SQLite files to other localhost origins | Fixed (`fs.deny`, CORS limited to the app's own origins) and checked live |
| Stored results unbounded: no field caps, serialized size not counted, the 20 MB error was swallowed per page | Fixed (field caps, stored-result budget that stops the run) |
| Aborted run pruned while its worker was active, crashing the process | Fixed and regression-tested |
| Error and redirect bodies drained on pooled sockets | Fixed (`agent: false`, discard by closing the socket) and checked live |
| Start URLs beyond `maxPages` silently dropped | Fixed (rejected with a message; the UI raises the limit to match) |
| Oversize body produced a connection reset | Fixed for bodies with a declared length |
| Run detail kept polling finished runs with their full dataset | Fixed (polls only while a run is queued or running) |
| Tab could keep another account's data after logout | No longer applicable: accounts were removed |
| Other local OS users and processes can use the API | Accepted with no sign-in; documented in the [security model](security-model.md) |

Checked and rejected by the reviewers: SSRF bypasses (shorthand IPv4, IPv6 literals, DNS answers, redirects, trailing-dot hosts), static path traversal, CSV injection, DNS rebinding, CSRF, XSS from scraped content, and cron CPU cost.

## Not verified

- Behaviour under Node 24.18.0 specifically after these changes (tests ran on Node 26.7.0).
- Mobile layouts after these changes. Earlier desktop and mobile checks predate the no-sign-in change.
- Load or soak behaviour, long-running schedules, and crawling sites other than those listed above.
