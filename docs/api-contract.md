# Local API contract

All JSON responses use an object envelope. Errors use `{error: string}`. There is no sign-in: one local workspace owns every resource. Mutations require a JSON body and an allowlisted Origin; every request requires a loopback Host.

- `GET /api/health`: health/build mode.
- `GET /api/catalog`: `{actors}`. Actor fields: `id,name,slug,description,category,icon,color,status,owner`. Status `ready` or `requires-provider`.
- `GET /api/workspace`: `{workspace:{name}}`.
- `GET /api/dashboard`: `{stats:{totalRuns,succeededRuns,failedRuns,runningRuns,totalResults},recentRuns}`.
- `GET /api/runs`: `{runs}` as summaries: `id,actorId,actorName,status,createdAt,startedAt,finishedAt,resultCount,error`.
- `POST /api/runs`: `{actorId,input:{urls:string[],maxPages?:number}}` -> `{run}`. 1–20 URLs; `maxPages` (1–20) defaults to the URL count and must be at least that count.
- `GET /api/runs/:id`: `{run}` with every summary field plus `input,logs,results`.
- `POST /api/runs/:id/abort`: `{run}`.
- `GET /api/runs/:id/export?format=json|csv`: file download.
- `GET /api/tasks`: `{tasks}`.
- `POST /api/tasks`: `{name,actorId,input}` -> `{task}`.
- `DELETE /api/tasks/:id`: removes the task and its schedules.
- `POST /api/tasks/:id/run`: starts the saved task -> `{run}`.
- `GET /api/schedules`: `{schedules}`.
- `POST /api/schedules`: `{name,taskId,cron|intervalMinutes,enabled}` -> `{schedule}`. Cron uses five UTC fields; when both day fields are restricted, either may match.
- `PATCH /api/schedules/:id`: any of `{name,enabled,cron,intervalMinutes}` -> `{schedule}`.
- `DELETE /api/schedules/:id`: removes the schedule.
- `GET /api/storage`: `{datasets}` derived from actual retained run outputs.
- `GET /api/integrations`: `{integrations}`; local connection preferences only, no external dispatch.
- `POST /api/integrations`: `{name,type,url?}` -> `{integration}`; `url` must pass the public-URL check and is stored only.
- `DELETE /api/integrations/:id`.
- `PATCH /api/settings`: `{name}` -> `{workspace}`.

Run states: `QUEUED,RUNNING,SUCCEEDED,FAILED,ABORTED`. Terminal status is stable after cancellation. Partial failed-page outcomes retain their source-bound error rather than becoming successful fabricated results. Retention and resource limits are enforced by backend: the workspace keeps its newest 200 runs, and a run still held by a worker or the queue is never pruned, even after it is marked `ABORTED`.
