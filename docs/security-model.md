# Local security model

Leeds Harvester is a single-workspace web data collector for one machine. It has no accounts or sign-in: everything stored belongs to the one local workspace. It does not execute uploaded code, install remote scrapers, reuse browser cookies, or bypass target access controls.

## Who can reach the workspace

- The server listens only on `127.0.0.1`.
- Requests must carry a `localhost` or `127.0.0.1` Host header on the app ports. This blocks DNS-rebinding pages that resolve their own hostname to loopback.
- Every request that changes data (`POST`, `PATCH`, `DELETE`) needs an allowlisted Origin (`http://localhost:4180/4181` or `http://127.0.0.1:4180/4181`). Requests also need a JSON content type, and there are no state-changing `GET` routes. Together these stop other websites from acting through the browser.
- In development, Vite refuses the `data/` directories and SQLite files, and allows cross-origin reads only from the app's own origins.

**Known limitation:** without sign-in, any process or OS user on the same machine can use the API, because a non-browser client can send any Origin header. The data directory is created with mode `0700`, but the API does not repeat that restriction. Run Leeds Harvester only on a machine you control. Before sharing it or exposing it on a network, add authentication and HTTPS.

## Crawl boundary

- URL parsing rejects embedded credentials, unsupported schemes and nonstandard ports.
- Only public IPv4 addresses are accepted. Every DNS answer is checked, and the connection uses the address that was checked. Every redirect is parsed and validated again.
- Each request has its own socket. Unused error and redirect bodies are discarded by closing that socket rather than being downloaded. IPv6-only sites are unsupported.
- HTML is parsed as data and scripts are never run. Email matching uses bounded patterns, so extraction time grows linearly with page size.

## Resource limits

| Resource | Limit |
| --- | --- |
| Concurrent runs | 2 |
| Pending runs | 20 |
| Pages per run | 20 |
| Run deadline | 60 s |
| HTML per page | 2 MB |
| Downloaded HTML per run | 20 MB |
| Stored, serialized results per run | 20 MB |
| Retained runs | Newest 200 |
| Tasks, schedules and integrations | 100 each |
| Request body | 32 KB |

Each extracted field is capped. A run that is cancelled but whose worker is still finishing is never removed by retention.

## Output

React renders extracted content as text. JSON and CSV exports keep source fields, and CSV neutralizes spreadsheet formula prefixes. Source URLs are kept as local evidence and are not treated as secrets. Avoid putting credentials in URLs: authenticated crawling is unsupported.
