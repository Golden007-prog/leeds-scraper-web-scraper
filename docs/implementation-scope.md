# Leeds Harvester implementation scope

A standalone local application inspired by the observed Apify console. It is built from scratch and contains no code taken from the reference.

Frontend first: marketing homepage, branded console, searchable Actor store, detail/input screens, dashboard, runs/results, reusable tasks, schedules, storage, integration preferences, workspace settings and explicit capability boundaries. Then connect the same screens to the local server. There is no sign-in: the homepage leads straight to the Store and dashboard.

Backend: Node.js HTTP server and persistent SQLite database; one local workspace guarded by loopback binding, a Host allowlist and Origin checks; bounded asynchronous website extraction; cancellation; JSON/CSV export; saved tasks and interval schedules. Website content, links, metadata and public contacts are built in. Social network, maps, paid proxies, hosted Actor publishing, billing, AI chat and third-party integrations require separate provider implementations and are not represented as operational.

This is an independently implemented local product, not recovered Apify server source. Public JavaScript and visible browser behavior establish only their examined scope. A backend technology described by vendor documentation is attributed to that documentation rather than inferred from a screenshot.

Production deployment, payment processing, distributed containers, cloud autoscaling, transactional email, managed secret storage, arbitrary user code execution, and provider account connections are outside this local delivery. Keep the service bound to loopback. Do not expose it publicly without deployment-specific review.
