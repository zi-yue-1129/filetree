# FileNexus backend benchmarks

[Measured results and root causes](REPORT.md) include every required workload,
three-run medians, query plans, profiler evidence and red/green test summaries.

Run from the repository root with the backend's Python environment:

```bash
UV_CACHE_DIR=/tmp/filetree-uv-cache timeout 300 uv pip install \
  -p /home/ubuntu/.claude/jobs/a7fd3792/tmp/venv/bin/python \
  -r backend/perf/requirements-benchmark.txt

# Allow roughly two minutes, plus a separate diagnostic profile lifetime.
timeout 900 /home/ubuntu/.claude/jobs/a7fd3792/tmp/venv/bin/python \
  -m backend.perf.benchmark --output /tmp/backend-results.json --profile

/home/ubuntu/.claude/jobs/a7fd3792/tmp/venv/bin/python \
  -m backend.perf.profile_report /tmp/backend-results.prof \
  --output /tmp/backend-profile.md
```

`--runs` defaults to 3 and rejects fewer runs; `--requests` defaults to 60 and
rejects fewer than 20. `--port` defaults to 15168. The harness writes JSON raw
runs/medians/plans and a Markdown table. Profiling runs separately, so it never
contaminates the measured medians. Generated `.prof` binaries are ignored;
commit their focused Markdown exports. It requires Linux `/proc` for process
memory/CPU and uses no sudo, external service or production credential.

## Isolation and workload

Every run gets a `TemporaryDirectory`. All `PATHS__*` variables are redirected
before any backend import. The seed and server also use that directory as CWD,
which isolates the legacy relative `data/tus_metadata.db` path. Uvicorn imports
this checkout through PYTHONPATH, with precisely the Docker CMD flags:

```text
backend.app:app --host 0.0.0.0 --port 15168 --proxy-headers
--forwarded-allow-ips * --timeout-keep-alive 60
```

One worker, no reload. Rate limiting remains enabled; default/TUS quotas are
raised to 1,000,000/minute so successful work, rather than 429s, is measured.
The app retains its own middleware, authentication, lifespan, database and disk
operations. The seed bypasses APIs only to prepare volume efficiently.

There are five accounts: one locked heavy owner and four empty accounts. The
heavy owner has 200 file folders (20 roots with chains ten levels deep), 4,999
uniquely named files spread over those folders plus a 50 MiB root file. Every
fourth file is a valid 640×480 noisy JPEG; other files are 16 KiB binary content.
There are 2,000 long URL/note records, locked files/notes, and a locked subtree.
Payload bytes use Python Random with fixed seed 20261013. Credentials use normal
salt generation. The initial timestamp is fixed; subsequent reconciliation uses
actual file mtimes, as the real application does.

The owner uses a real session token obtained through password unlock. Dashboard
and thumbnail measurements therefore include locked content and normal owner
checks. `/api/init` is the actual public list; `/api/users` is absent on this
base. Downloads consume raw stream bytes, avoiding a 50 MiB client-side buffer.
Thumbnails are actual generated JPEGs, not placeholder 404 responses.

## Measurements

- Small HTTP workloads: 60 complete requests at each concurrency (1 and 20),
  per run. Each operation's latency begins after its concurrency slot is
  acquired; overall req/s includes scheduling and full response consumption.
- Cold thumbnails: delete the isolated disk cache, then request 60 distinct
  images. Warm thumbnails: revisit the first 20 generated images. This measures
  server disk-cache reuse, not browser caching or conditional 304s.
- Downloads and archives: three operations at C1, twenty at C20. Batch archives
  contain 200 files across nested folders; the folder archive contains 250 files
  beneath a ten-folder subtree. Their p95/p99 are small-sample interpolations.
- TUS: one 200 MiB upload at C1 and twenty at C20 per run; forty PATCH requests
  with 5 MiB bodies per upload. Upload bytes repeat a deterministic block, and
  normal background deduplication remains enabled. Latency includes create,
  PATCH acknowledgements, and dashboard polling until each import is indexed.
  Background SHA-256/audit work can continue after indexing; the subsequent
  one-second settling interval is excluded from latency/CPU. CPU is the measured
  interval's server-process CPU, not a claim about complete background work.
- REFRESH: one mutation at a time, with 1 or 20 authenticated WebSocket listeners.
  The C column denotes listener count for this workload. Time includes mutation,
  audit and receiving REFRESH on every socket. There are twenty events per run.
- Startup/readiness: process creation through successful `/api/init`, including
  Python imports, schema checks, reconciliation and immediate stale cleanup.
  Measure both an indexed dataset and a separately restarted server after
  removing all 5,000 heavy-owner index rows. Restore known folder placements and
  locks after that rebuild before the next request run.
- RSS: sample the server process every 20 ms; record start, peak and end values.
  CPU: `/proc/PID/stat` user + system seconds, including server worker threads.
  CPU excludes the load generator and any ffmpeg child. Peaks shorter than the
  sampling interval can be missed. `startup_runs.rss_end_mib` is the resident
  memory at the end of the HTTP workloads, not startup memory.
- Calculate p50/p95/p99 and rate for each run, then report the median of each
  metric across three runs. These are descriptive measurements, not confidence
  intervals or a production capacity prediction.

The recorded host is AMD Ryzen 9 9950X (16 cores), Python 3.12.13, Linux,
loopback and warm filesystem cache. [Environment versions](environment.json)
record the tested stack; benchmark requirements pin those versions. The
baseline app predates the added orjson runtime dependency. The final full suite
ran on the same host; shared-host scheduling noise remains possible. The fixed
workload order also carries allocations from earlier workloads into later RSS
observations. Use a controlled small host and real mobile networks for absolute
acceptance measurements.

Raw baseline JSON was reformatted to one measurement per line and its ambiguous
`rss_mib` lifetime-ending field renamed `rss_end_mib`; no numeric observations
were changed. [Iteration 1](results/iteration-1.json) preserves the first complete
optimization's measurements, including its dashboard latency regression.
