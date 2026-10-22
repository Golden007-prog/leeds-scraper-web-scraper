import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { actors } from "./catalog.mjs";
import { validateUrl, fetchPublicPage, extractPage } from "./crawler.mjs";
const now = () => new Date().toISOString();
const origins = new Set([
  "http://localhost:4180",
  "http://127.0.0.1:4180",
  "http://localhost:4181",
  "http://127.0.0.1:4181",
]);
const MAX_RUNS = 200,
  MAX_RESOURCES = 100,
  MAX_QUEUE = 20,
  PAGE_BYTES = 2 * 1024 * 1024,
  RUN_BYTES = 20 * 1024 * 1024;
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const reject = (status, message) => {
  throw new HttpError(status, message);
};
const text = (v, name, max = 120) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    reject(400, `${name} is required (maximum ${max} characters)`);
  return v.trim();
};
function inputValue(input) {
  if (
    !input ||
    typeof input !== "object" ||
    !Array.isArray(input.urls) ||
    !input.urls.length ||
    input.urls.length > 20
  )
    reject(400, "Provide 1–20 public website URLs");
  let urls;
  try {
    urls = [...new Set(input.urls.map((v) => validateUrl(v).href))];
  } catch (e) {
    reject(400, e.message);
  }
  // Start URLs count toward the page limit, so the limit must cover them all.
  const maxPages = input.maxPages ?? urls.length;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20)
    reject(400, "Maximum pages must be an integer from 1 to 20");
  if (maxPages < urls.length)
    reject(400, "Maximum pages must be at least the number of start URLs");
  return { urls, maxPages };
}
export function cronPlan(cron, intervalMinutes) {
  if (cron !== undefined) {
    const value = text(cron, "Cron expression", 80);
    const fields = value.split(/\s+/);
    if (fields.length !== 5)
      reject(400, "Use a five-field cron expression (UTC)");
    const limits = [
      [0, 59],
      [0, 23],
      [1, 31],
      [1, 12],
      [0, 6],
    ];
    const sets = fields.map((field, i) => {
      const set = new Set();
      for (const part of field.split(",")) {
        const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
        if (!m) reject(400, "Unsupported cron expression");
        const step = Number(m[2] || 1);
        if (step < 1 || step > 60) reject(400, "Invalid cron step");
        const [min, max] = limits[i];
        let low = min,
          high = max;
        if (m[1] !== "*") {
          const r = m[1].split("-").map(Number);
          low = r[0];
          high = r[1] ?? (m[2] ? max : low);
        }
        if (low < min || high > max || low > high)
          reject(400, "Cron field is out of range");
        for (let n = low; n <= high; n += step) set.add(n);
      }
      return set;
    });
    // Standard cron: when both day fields are restricted, either may match.
    const eitherDay = fields[2] !== "*" && fields[4] !== "*";
    const nextAfter = (date) => {
      let ts = Math.floor(date / 60000) * 60000 + 60000;
      for (let i = 0; i < 527040; i++, ts += 60000) {
        const d = new Date(ts);
        const dayOfMonth = sets[2].has(d.getUTCDate()),
          dayOfWeek = sets[4].has(d.getUTCDay());
        if (
          sets[0].has(d.getUTCMinutes()) &&
          sets[1].has(d.getUTCHours()) &&
          sets[3].has(d.getUTCMonth() + 1) &&
          (eitherDay ? dayOfMonth || dayOfWeek : dayOfMonth && dayOfWeek)
        )
          return ts;
      }
      reject(400, "Cron has no matching time within one year");
    };
    return { cron: value, intervalMinutes: null, nextAfter };
  }
  if (
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < 1 ||
    intervalMinutes > 525600
  )
    reject(400, "Interval must be 1–525600 minutes");
  return {
    cron: null,
    intervalMinutes,
    nextAfter: (date) => date + intervalMinutes * 60000,
  };
}
// One local workspace owns every resource: there are no accounts or sessions.
// The loopback bind, Host allowlist and Origin check are the access controls.
export function createApplication({
  dataDirectory = path.resolve("data"),
  port = 4181,
  fetchPage = fetchPublicPage,
  maxRuns = MAX_RUNS,
} = {}) {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDirectory, "leeds.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;",
  );
  db.exec(`CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK(id=1),name TEXT NOT NULL);
 INSERT OR IGNORE INTO workspace VALUES(1,'Local workspace');
 CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS resources_kind ON resources(kind);`);
  const getWorkspace = () =>
    db.prepare("SELECT name FROM workspace WHERE id=1").get();
  const list = (kind) =>
    db
      .prepare("SELECT data FROM resources WHERE kind=? ORDER BY rowid DESC")
      .all(kind)
      .map((v) => JSON.parse(v.data));
  // List views select only metadata inside SQLite; complete datasets stay on detail/export.
  const runSummaries = (limit = maxRuns) =>
    db
      .prepare(
        `
    SELECT id,
      json_extract(data,'$.actorId') AS actorId,
      json_extract(data,'$.actorName') AS actorName,
      json_extract(data,'$.status') AS status,
      json_extract(data,'$.createdAt') AS createdAt,
      json_extract(data,'$.startedAt') AS startedAt,
      json_extract(data,'$.finishedAt') AS finishedAt,
      json_extract(data,'$.resultCount') AS resultCount,
      json_extract(data,'$.error') AS error
    FROM resources WHERE kind='run' ORDER BY rowid DESC LIMIT ?
  `,
      )
      .all(limit);
  const countResources = (kind) =>
    db.prepare("SELECT COUNT(*) AS n FROM resources WHERE kind=?").get(kind).n;
  const find = (id, kind) => {
    const row = db
      .prepare("SELECT data FROM resources WHERE id=? AND kind=?")
      .get(id, kind);
    if (!row) reject(404, "Resource not found");
    return JSON.parse(row.data);
  };
  const save = (kind, data) =>
    db
      .prepare(
        "INSERT INTO resources(id,kind,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(data.id, kind, JSON.stringify(data));
  const remove = (id, kind) => {
    find(id, kind);
    db.prepare("DELETE FROM resources WHERE id=? AND kind=?").run(id, kind);
  };
  const capacity = (kind) => {
    if (countResources(kind) >= MAX_RESOURCES)
      reject(409, `Limit of ${MAX_RESOURCES} ${kind} resources reached`);
  };
  for (const row of db
    .prepare(
      "SELECT data FROM resources WHERE kind='run' AND json_extract(data,'$.status') IN ('QUEUED','RUNNING')",
    )
    .all()) {
    const run = JSON.parse(row.data);
    run.status = "FAILED";
    run.finishedAt = now();
    run.error = "Server stopped before this run completed";
    run.logs.push(`${now()} Server restart interrupted execution`);
    save("run", run);
  }
  const queue = [],
    active = new Map();
  let closing = false;
  const log = (run, message) => {
    if (run.logs.length < 100) run.logs.push(`${now()} ${message}`);
  };
  const actorFor = (id) => {
    const actor = actors.find((a) => a.id === id);
    if (!actor) reject(400, "Unknown Actor");
    if (actor.status !== "ready")
      reject(409, "This Actor requires a provider and cannot run");
    return actor;
  };
  function prune() {
    const runs = runSummaries();
    const excess = Math.max(0, runs.length - maxRuns + 1);
    // An aborted run is persisted as ABORTED before its worker finishes, so
    // retention follows worker ownership rather than the stored status alone.
    const held = new Set([...active.keys(), ...queue]);
    const removable = runs
      .toReversed()
      .filter(
        (r) => !held.has(r.id) && !["RUNNING", "QUEUED"].includes(r.status),
      );
    if (removable.length < excess)
      reject(429, "Run retention capacity reached");
    for (const r of removable.slice(0, excess))
      db.prepare("DELETE FROM resources WHERE id=? AND kind='run'").run(r.id);
  }
  function enqueue(actorId, input) {
    const actor = actorFor(actorId);
    const normalized = inputValue(input);
    if (closing) reject(503, "Server is shutting down");
    if (queue.length >= MAX_QUEUE)
      reject(429, `Run queue is full (${MAX_QUEUE} pending runs maximum)`);
    prune();
    const run = {
      id: randomUUID(),
      actorId,
      actorName: actor.name,
      status: "QUEUED",
      input: normalized,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      resultCount: 0,
      error: null,
      logs: [],
      results: [],
    };
    log(run, "Run queued");
    save("run", run);
    queue.push(run.id);
    setImmediate(pump);
    return run;
  }
  function pump() {
    if (closing) return;
    while (active.size < 2 && queue.length) {
      const id = queue.shift();
      const controller = new AbortController();
      active.set(id, controller);
      execute(id, controller)
        .catch((e) => console.error(`Run ${id} worker failed:`, e))
        .finally(() => {
          active.delete(id);
          pump();
        });
    }
  }
  async function execute(id, controller) {
    const run = find(id, "run");
    run.status = "RUNNING";
    run.startedAt = now();
    log(run, "Collection started");
    save("run", run);
    const timeout = setTimeout(
      () => controller.abort(new Error("Run exceeded 60-second deadline")),
      60000,
    );
    timeout.unref();
    try {
      const pending = [...run.input.urls],
        seen = new Set();
      // Downloaded HTML and stored (serialized) results have separate budgets;
      // reaching either one ends the run with the results collected so far.
      let bytes = 0,
        stored = 0,
        failures = 0,
        budget = null;
      while (!budget && pending.length && seen.size < run.input.maxPages) {
        if (controller.signal.aborted) throw controller.signal.reason;
        const url = pending.shift();
        if (seen.has(url)) continue;
        seen.add(url);
        try {
          const page = await fetchPage(url, {
            signal: controller.signal,
            maxBytes: Math.min(PAGE_BYTES, RUN_BYTES - bytes),
          });
          if (controller.signal.aborted) throw controller.signal.reason;
          if (
            !page ||
            typeof page.html !== "string" ||
            typeof page.url !== "string"
          )
            throw new Error("Collector returned an invalid page");
          const pageBytes = Buffer.byteLength(page.html);
          if (pageBytes > PAGE_BYTES) throw new Error("Page exceeds 2 MB limit");
          bytes += pageBytes;
          if (bytes >= RUN_BYTES) budget = "download";
          const { record, links } = extractPage(
            page.html,
            page.url,
            run.actorId,
          );
          stored += Buffer.byteLength(JSON.stringify(record));
          if (stored > RUN_BYTES) {
            budget = "stored result";
            break;
          }
          run.results.push(record);
          run.resultCount = run.results.length;
          log(run, `Collected ${page.url}`);
          const origin = new URL(page.url).origin;
          for (const link of links) {
            if (pending.length >= 100) break;
            try {
              const target = validateUrl(link);
              if (
                target.origin === origin &&
                !seen.has(target.href) &&
                !pending.includes(target.href)
              )
                pending.push(target.href);
            } catch {
              /* Unsafe links are never scheduled. */
            }
          }
        } catch (e) {
          if (controller.signal.aborted) throw controller.signal.reason;
          failures++;
          log(run, `Failed ${url}: ${String(e.message).slice(0, 200)}`);
        }
        save("run", run);
      }
      if (budget)
        log(run, `Stopped at the 20 MB ${budget} limit; results kept`);
      run.status = failures ? "FAILED" : "SUCCEEDED";
      if (failures)
        run.error = `${failures} page request(s) failed; partial results retained`;
    } catch (e) {
      const persisted = find(run.id, "run");
      run.status = persisted.status === "ABORTED" ? "ABORTED" : "FAILED";
      run.error =
        run.status === "ABORTED"
          ? "Run aborted"
          : String(e?.message || "Collection failed").slice(0, 300);
    } finally {
      clearTimeout(timeout);
      const persisted = find(run.id, "run");
      if (persisted.status === "ABORTED") {
        run.status = "ABORTED";
        run.error = "Run aborted";
      }
      run.finishedAt = now();
      log(run, `Run ${run.status.toLowerCase()}`);
      save("run", run);
    }
  }
  function abortRun(id, reason = "Abort requested") {
    const run = find(id, "run");
    if (["QUEUED", "RUNNING"].includes(run.status)) {
      run.status = "ABORTED";
      run.finishedAt = now();
      run.error = "Run aborted";
      log(run, reason);
      save("run", run);
      const i = queue.indexOf(id);
      if (i >= 0) queue.splice(i, 1);
      active.get(id)?.abort(new Error("Run aborted"));
    }
    return run;
  }
  function tick() {
    if (closing) return;
    const time = Date.now();
    for (const schedule of list("schedule")) {
      if (!schedule.enabled || Date.parse(schedule.nextRunAt) > time) continue;
      try {
        const task = find(schedule.taskId, "task");
        const run = enqueue(task.actorId, task.input);
        schedule.lastRunId = run.id;
        schedule.lastError = null;
      } catch (e) {
        schedule.lastError = String(e.message).slice(0, 300);
      }
      try {
        schedule.nextRunAt = new Date(
          cronPlan(
            schedule.cron ?? undefined,
            schedule.intervalMinutes,
          ).nextAfter(time),
        ).toISOString();
      } catch (e) {
        schedule.enabled = false;
        schedule.lastError = e.message;
      }
      save("schedule", schedule);
    }
  }
  const scheduler = setInterval(tick, 1000);
  scheduler.unref();
  async function body(req) {
    if (
      !(req.headers["content-type"] || "")
        .toLowerCase()
        .startsWith("application/json")
    )
      reject(415, "JSON content type required");
    // A declared oversize body is refused before reading, so the client gets
    // the 413 instead of a reset connection.
    if (Number(req.headers["content-length"]) > 32768)
      reject(413, "Request body exceeds 32 KB");
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 32768) reject(413, "Request body exceeds 32 KB");
      chunks.push(chunk);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString());
      if (!value || typeof value !== "object" || Array.isArray(value))
        reject(400, "JSON object required");
      return value;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      reject(400, "Invalid JSON");
    }
  }
  const json = (res, value, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      const allowedHosts = new Set(
        ["localhost", "127.0.0.1"].flatMap((h) => [
          h,
          `${h}:4180`,
          `${h}:4181`,
          `${h}:${server.address()?.port || port}`,
        ]),
      );
      if (!allowedHosts.has(req.headers.host)) reject(403, "Unrecognized Host");
      const origin = req.headers.origin;
      if (origin && !origins.has(origin)) reject(403, "Origin is not allowed");
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
      }
      if (
        ["POST", "PATCH", "DELETE", "PUT"].includes(req.method) &&
        !origins.has(origin)
      )
        reject(403, "An allowlisted Origin is required");
      const url = new URL(req.url, "http://localhost");
      const p = url.pathname;
      const method = req.method;
      if (p === "/api/health" && method === "GET") {
        json(res, { ok: true, mode: "local", version: "0.1.0" });
        return;
      }
      if (p === "/api/catalog" && method === "GET") {
        json(res, { actors });
        return;
      }
      if (p === "/api/workspace" && method === "GET") {
        json(res, { workspace: getWorkspace() });
        return;
      }
      if (p === "/api/settings" && method === "PATCH") {
        const b = await body(req);
        db.prepare("UPDATE workspace SET name=? WHERE id=1").run(
          text(b.name, "Workspace name", 80),
        );
        json(res, { workspace: getWorkspace() });
        return;
      }
      if (p === "/api/dashboard" && method === "GET") {
        const stats = db
          .prepare(
            `SELECT COUNT(*) AS totalRuns,
          COALESCE(SUM(json_extract(data,'$.status')='SUCCEEDED'),0) AS succeededRuns,
          COALESCE(SUM(json_extract(data,'$.status')='FAILED'),0) AS failedRuns,
          COALESCE(SUM(json_extract(data,'$.status') IN ('RUNNING','QUEUED')),0) AS runningRuns,
          COALESCE(SUM(json_extract(data,'$.resultCount')),0) AS totalResults
          FROM resources WHERE kind='run'`,
          )
          .get();
        stats.tasks = countResources("task");
        json(res, { stats, recentRuns: runSummaries(5) });
        return;
      }
      if (p === "/api/runs" && method === "GET") {
        json(res, { runs: runSummaries() });
        return;
      }
      if (p === "/api/runs" && method === "POST") {
        const b = await body(req);
        json(res, { run: enqueue(b.actorId, b.input) }, 201);
        return;
      }
      const runMatch = p.match(/^\/api\/runs\/([^/]+)(?:\/(abort|export))?$/);
      if (runMatch) {
        const run = find(runMatch[1], "run");
        if (!runMatch[2] && method === "GET") {
          json(res, { run });
          return;
        }
        if (runMatch[2] === "abort" && method === "POST") {
          json(res, { run: abortRun(run.id) });
          return;
        }
        if (runMatch[2] === "export" && method === "GET") {
          const format = url.searchParams.get("format") || "json";
          if (!["json", "csv"].includes(format))
            reject(400, "Export format must be json or csv");
          let output;
          if (format === "json") output = JSON.stringify(run.results, null, 2);
          else {
            const keys = [...new Set(run.results.flatMap(Object.keys))];
            const cell = (v) => {
              let s =
                typeof v === "object" && v !== null
                  ? JSON.stringify(v)
                  : String(v ?? "");
              if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
              return '"' + s.replaceAll('"', '""') + '"';
            };
            output = [
              keys.map(cell).join(","),
              ...run.results.map((row) =>
                keys.map((k) => cell(row[k])).join(","),
              ),
            ].join("\r\n");
          }
          res.writeHead(200, {
            "Content-Type":
              format === "json"
                ? "application/json; charset=utf-8"
                : "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${run.id}.${format}"`,
          });
          res.end(output);
          return;
        }
      }
      if (p === "/api/storage" && method === "GET") {
        json(res, {
          datasets: runSummaries().map((r) => ({
            id: r.id,
            runId: r.id,
            actorId: r.actorId,
            createdAt: r.createdAt,
            resultCount: r.resultCount,
            status: r.status,
          })),
        });
        return;
      }
      if (p === "/api/tasks" && method === "GET") {
        json(res, { tasks: list("task") });
        return;
      }
      if (p === "/api/tasks" && method === "POST") {
        const b = await body(req);
        capacity("task");
        actorFor(b.actorId);
        const task = {
          id: randomUUID(),
          name: text(b.name, "Task name"),
          actorId: b.actorId,
          input: inputValue(b.input),
          createdAt: now(),
        };
        save("task", task);
        json(res, { task }, 201);
        return;
      }
      const taskMatch = p.match(/^\/api\/tasks\/([^/]+)(?:\/(run))?$/);
      if (taskMatch) {
        const task = find(taskMatch[1], "task");
        if (taskMatch[2] && method === "POST") {
          json(res, { run: enqueue(task.actorId, task.input) }, 201);
          return;
        }
        if (!taskMatch[2] && method === "DELETE") {
          remove(task.id, "task");
          for (const schedule of list("schedule").filter(
            (s) => s.taskId === task.id,
          ))
            remove(schedule.id, "schedule");
          json(res, { ok: true });
          return;
        }
      }
      if (p === "/api/schedules" && method === "GET") {
        json(res, { schedules: list("schedule") });
        return;
      }
      if (p === "/api/schedules" && method === "POST") {
        const b = await body(req);
        capacity("schedule");
        find(b.taskId, "task");
        const plan = cronPlan(b.cron, b.intervalMinutes);
        const schedule = {
          id: randomUUID(),
          name: text(b.name, "Schedule name"),
          taskId: b.taskId,
          cron: plan.cron,
          intervalMinutes: plan.intervalMinutes,
          enabled: b.enabled === true,
          timezone: "UTC",
          nextRunAt: new Date(plan.nextAfter(Date.now())).toISOString(),
          createdAt: now(),
          lastRunId: null,
          lastError: null,
        };
        save("schedule", schedule);
        json(res, { schedule }, 201);
        return;
      }
      const scheduleMatch = p.match(/^\/api\/schedules\/([^/]+)$/);
      if (scheduleMatch && method === "DELETE") {
        remove(scheduleMatch[1], "schedule");
        json(res, { ok: true });
        return;
      }
      if (scheduleMatch && method === "PATCH") {
        const schedule = find(scheduleMatch[1], "schedule"),
          b = await body(req);
        if (b.name !== undefined) schedule.name = text(b.name, "Schedule name");
        if (b.enabled !== undefined) {
          if (typeof b.enabled !== "boolean")
            reject(400, "Enabled must be boolean");
          schedule.enabled = b.enabled;
        }
        // Timing is replanned only when it changes; renaming or toggling keeps
        // the pending occurrence. An interval alone replaces a stored cron.
        if (b.cron !== undefined || b.intervalMinutes !== undefined) {
          const plan =
            b.cron !== undefined
              ? cronPlan(b.cron)
              : cronPlan(undefined, b.intervalMinutes);
          schedule.cron = plan.cron;
          schedule.intervalMinutes = plan.intervalMinutes;
          schedule.nextRunAt = new Date(
            plan.nextAfter(Date.now()),
          ).toISOString();
        } else if (Date.parse(schedule.nextRunAt) <= Date.now())
          schedule.nextRunAt = new Date(
            cronPlan(
              schedule.cron ?? undefined,
              schedule.intervalMinutes,
            ).nextAfter(Date.now()),
          ).toISOString();
        save("schedule", schedule);
        json(res, { schedule });
        return;
      }
      if (p === "/api/integrations" && method === "GET") {
        json(res, { integrations: list("integration") });
        return;
      }
      if (p === "/api/integrations" && method === "POST") {
        const b = await body(req);
        capacity("integration");
        let endpoint = null;
        if (b.url) {
          try {
            endpoint = validateUrl(b.url).href;
          } catch (e) {
            reject(400, e.message);
          }
        }
        const integration = {
          id: randomUUID(),
          name: text(b.name, "Integration name"),
          type: text(b.type, "Type", 40),
          enabled: false,
          mode: "local-preference",
          url: endpoint,
          createdAt: now(),
          notice:
            "Saved preference only. External webhook delivery is not implemented.",
        };
        save("integration", integration);
        json(res, { integration }, 201);
        return;
      }
      const integrationMatch = p.match(/^\/api\/integrations\/([^/]+)$/);
      if (integrationMatch && method === "DELETE") {
        remove(integrationMatch[1], "integration");
        json(res, { ok: true });
        return;
      }
      if (p.startsWith("/api/")) reject(404, "API route not found");
      if (method !== "GET" && method !== "HEAD")
        reject(405, "Method not allowed");
      const root = path.resolve(
        fileURLToPath(new URL("../dist/", import.meta.url)),
      );
      let decoded;
      try {
        decoded = decodeURIComponent(p);
      } catch {
        reject(400, "Malformed path");
      }
      let target = path.resolve(root, "." + decoded);
      if (!target.startsWith(root + path.sep) && target !== root)
        reject(403, "Path not allowed");
      if (!existsSync(target) || !statSync(target).isFile())
        target = path.join(root, "index.html");
      if (!existsSync(target))
        reject(503, "Frontend build is unavailable; run npm run build");
      const ext = path.extname(target);
      const mime =
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".ico": "image/x-icon",
        }[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      res.end(method === "HEAD" ? undefined : readFileSync(target));
    } catch (e) {
      if (!res.headersSent)
        json(
          res,
          {
            error:
              e instanceof HttpError
                ? e.message
                : e.message && /URL|network|HTTP/.test(e.message)
                  ? e.message
                  : "An internal server error occurred",
          },
          e instanceof HttpError ? e.status : 500,
        );
      else res.end();
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 50;
  server.keepAliveTimeout = 5000;
  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve(server.address()));
      }),
    address: () => server.address(),
    async close() {
      closing = true;
      clearInterval(scheduler);
      for (const id of [...queue, ...active.keys()])
        abortRun(id, "Server shutdown stopped this run");
      await new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(resolve);
        server.closeIdleConnections();
      });
      while (active.size)
        await new Promise((resolve) => setTimeout(resolve, 10));
      db.close();
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = createApplication({
    dataDirectory: process.env.LEEDS_DATA_DIR || path.resolve("data"),
    port: Number(process.env.PORT || 4181),
  });
  const address = await app.listen();
  console.log(`Leeds Harvester server: http://127.0.0.1:${address.port}`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
