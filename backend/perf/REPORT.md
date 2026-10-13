# Backend performance evidence

Baseline application: `8e3a58947e9f9475813ce0b6c456f0e9e4012b6d`. Final measured implementation:
`ca43204481440049049849e24a8f0095d19a5960`. Three unprofiled runs per side; each displayed number is
its metric's median across runs. Raw observations: [before](results/before.json),
[after](results/after.json); [initial optimization](results/iteration-1.json).

## Ranked findings

1. **Archive construction blocked the event loop and recompressed media.**
   At C20, folder-zip p50 fell from 5,539.21 to 643.59 ms (8.6 times faster),
   batch-zip from 3,591.56 to 318.05 ms (11.3 times faster). Two bounded worker
   jobs create disk-backed zips; already-compressed formats use ZIP_STORED,
   remaining formats use deflate level 1. Batch output grew only 0.081 percent;
   folder output grew 0.085 percent. Folder traversal now uses a child map.
2. **TUS buffered whole chunks, repeatedly opened/checkpointed SQLite, and hashed
   in 4 KiB reads.** Streaming, serialized per-upload PATCHes, a locked persistent
   worker connection, and 1 MiB hash reads reduced C20 p50 from 8,277.48 to
   3,987.31 ms. CPU dropped 17.69 to 8.53 seconds; sampled peak RSS dropped
   328.62 to 180.41 MiB. Offsets remain committed per chunk. Short/mismatched or
   disconnected chunks roll back disk bytes; concurrent offsets return 409.
3. **Dashboard transfers were large and CPU-heavy.** The decoded response still
   contains all 5,000 files and 2,000 notes. Gzip level 1 reduces median wire
   bytes from 1,823,426 to 54,784 (97.0 percent; 33.3 times smaller). Pinned orjson,
   shared retention calculations and one folder-tree load reduce C20 p50 from
   717.91 to 526.98 ms and CPU from 2.63 to 2.07 seconds. An initial stdlib JSON
   plus gzip iteration regressed latency; [iteration 1](results/iteration-1.md)
   records it, and it prompted the serializer refinement.
4. **Missing-index reconciliation was quadratic and inserted one row per await.**
   A filename map and executemany rebuild 5,000 rows without single-row writes.
   Full process startup/readiness drops from 515.71 to 330.61 ms for that case.
   Unreadable files now raise, rather than silently deleting valid index rows.
5. **Nested media path resolution queried every ancestor.** Eight levels used
   eleven SQL queries; reuse of the loaded tree reduces that to three with a
   session credential, independent of depth. Warm C20 thumbnail p50 improves
   25.84 to 20.33 ms. Device-token authentication can add fixed database work.
   Thumbnail generation now coalesces same-image requests and limits distinct
   decoders to two. Cold C20 p50 trades 32.83 for 47.17 ms while peak RSS drops
   129.00 to 108.78 MiB; p95 is 52.80 versus 51.62 ms. This deliberate bound
   favors small hosts; tune LOGIC__THUMBNAIL_WORKERS if more CPU is available.

The public list and WebSocket fan-out were already cheap. Their small differences
are not claimed as optimization wins. Whole-lifetime ending RSS drops from
235.30 to 175.09 MiB.

## Latency, rate and memory medians

| Workload | C | p50 ms before → after | p95 ms before → after | p99 ms before → after | req/s before → after | Peak RSS MiB before → after |
|---|---:|---:|---:|---:|---:|---:|
| dashboard | 1 | 24.04 → 19.39 | 45.62 → 40.30 | 50.10 → 41.33 | 36.45 → 45.95 | 88.45 → 86.61 |
| public-list | 1 | 0.64 → 0.64 | 0.92 → 0.80 | 1.37 → 1.28 | 978.13 → 986.45 | 88.45 → 86.61 |
| thumbnail-cold | 1 | 5.18 → 5.08 | 6.06 → 5.44 | 10.00 → 8.18 | 171.39 → 183.36 | 91.62 → 90.65 |
| thumbnail-warm | 1 | 1.23 → 1.26 | 1.45 → 1.48 | 1.75 → 1.64 | 728.60 → 728.99 | 91.62 → 90.66 |
| download-50mb | 1 | 30.50 → 25.90 | 42.65 → 27.09 | 43.82 → 27.10 | 24.00 → 36.99 | 91.68 → 90.66 |
| batch-zip-200 | 1 | 181.95 → 27.69 | 184.15 → 28.72 | 184.31 → 28.97 | 5.28 → 29.16 | 91.94 → 90.75 |
| folder-zip | 1 | 286.64 → 54.13 | 309.27 → 71.04 | 311.28 → 72.54 | 3.36 → 16.20 | 92.61 → 91.64 |
| tus-200mb | 1 | 418.55 → 229.17 | 418.55 → 229.17 | 418.55 → 229.17 | 2.39 → 4.36 | 101.77 → 94.40 |
| ws-refresh-fanout | 1 | 1.53 → 1.37 | 2.08 → 1.69 | 2.56 → 2.28 | 489.40 → 487.39 | 90.23 → 94.47 |
| dashboard | 20 | 717.91 → 526.98 | 807.15 → 583.35 | 848.20 → 585.55 | 26.91 → 36.71 | 107.45 → 98.70 |
| public-list | 20 | 12.08 → 10.56 | 33.85 → 34.42 | 44.28 → 40.74 | 940.26 → 951.15 | 105.37 → 98.70 |
| thumbnail-cold | 20 | 32.83 → 47.17 | 52.80 → 51.62 | 56.81 → 58.59 | 484.49 → 364.88 | 129.00 → 108.78 |
| thumbnail-warm | 20 | 25.84 → 20.33 | 41.71 → 33.19 | 46.62 → 36.79 | 586.94 → 731.78 | 129.09 → 108.79 |
| download-50mb | 20 | 571.45 → 472.07 | 723.65 → 624.93 | 725.99 → 626.90 | 27.43 → 30.96 | 131.44 → 110.73 |
| batch-zip-200 | 20 | 3591.56 → 318.05 | 3596.64 → 486.91 | 3597.03 → 486.94 | 5.55 → 40.41 | 135.23 → 110.92 |
| folder-zip | 20 | 5539.21 → 643.59 | 5544.33 → 1127.47 | 5545.43 → 1144.73 | 3.60 → 17.17 | 163.62 → 115.89 |
| tus-200mb | 20 | 8277.48 → 3987.31 | 10748.00 → 4041.97 | 10776.82 → 4045.29 | 1.85 → 4.93 | 328.62 → 180.41 |
| ws-refresh-fanout | 20 | 2.42 → 2.21 | 2.72 → 2.72 | 3.05 → 2.94 | 320.78 → 325.23 | 236.28 → 175.09 |

| Startup/readiness | Before ms | After ms |
|---|---:|---:|
| Indexed 5,000 files | 333.87 | 315.58 |
| Rebuild missing 5,000-file index | 515.71 | 330.61 |


| Workload | C | MiB/s before → after | Server CPU seconds before → after |
|---|---:|---:|---:|
| download-50mb | 1 | 1200.08 → 1849.54 | 0.10 → 0.08 |
| batch-zip-200 | 1 | 59.17 → 327.13 | 0.55 → 0.08 |
| folder-zip | 1 | 53.77 → 259.75 | 0.87 → 0.18 |
| tus-200mb | 1 | 477.71 → 872.41 | 0.31 → 0.18 |
| download-50mb | 20 | 1371.44 → 1547.99 | 0.92 → 0.78 |
| batch-zip-200 | 20 | 62.21 → 453.44 | 3.66 → 0.79 |
| folder-zip | 20 | 57.67 → 275.39 | 5.72 → 1.83 |
| tus-200mb | 20 | 370.87 → 985.87 | 17.69 → 8.53 |


## Query plans and profiling

| Query | Before EXPLAIN QUERY PLAN | After EXPLAIN QUERY PLAN |
|---|---|---|
| files-list | SEARCH files USING INDEX idx_files_username_filename (username=?) | SEARCH files USING INDEX idx_files_username_filename (username=?) |
| files-folder | SEARCH files USING INDEX idx_files_username_filename (username=?) | SEARCH files USING INDEX idx_files_username_folder (username=? AND folder_id=?) |
| notes-list | SEARCH urls USING INDEX idx_urls_username (username=?); USE TEMP B-TREE FOR ORDER BY | SEARCH urls USING INDEX idx_urls_username_created (username=?) |
| notes-folder | SEARCH urls USING INDEX idx_urls_username (username=?) | SEARCH urls USING INDEX idx_urls_username_folder (username=? AND folder_id=?) |
| folders | SEARCH folders USING INDEX idx_folders_user_id (user_id=?) | SEARCH folders USING INDEX idx_folders_user_parent (user_id=? AND parent_id=?) |

Files already had username/filename indexes, and folders already had independent
user/parent indexes. Added composite folder filters and username/created ordering
for notes. No synchronous, cache_size, temp_store or mmap PRAGMA was changed:
performance improved without a durability or fixed-memory-budget tradeoff.
First-upgrade index creation is not represented by the seeded startup numbers.

Separate cProfile runs: [before](results/profile-before.md),
[after](results/profile-after.md). Diagnostics identify zlib compression, SQLite
commit/close churn, hashing reads and file-response formatting. Baseline zlib
self time is 8.571 s; final diagnostics are reported in the linked artifact.
Hash read-loop calls shrink from 1,075,221 to 4,221 in the diagnostic workload.
Async/threaded cumulative stacks overlap and are deliberately not used as latency
or CPU totals. CPU evidence above comes from /proc, with profiling disabled.

## Test evidence (verbatim pytest summaries)

```text
90 passed, 77 warnings in 58.59s
11 failed, 1 passed, 24 warnings in 1.82s
5 failed, 12 deselected, 1 warning in 0.68s
1 failed, 17 deselected, 2 warnings in 0.35s
1 failed, 18 deselected, 2 warnings in 0.37s
1 failed, 21 deselected, 1 warning in 0.11s
2 failed, 22 deselected, 1 warning in 0.57s
17 passed, 14 warnings in 1.64s
21 passed, 1 warning in 2.28s
70 passed, 1 warning in 4.80s
114 passed, 1 warning in 61.38s (0:01:01)
```

The red phases cover compression, authorized conditional media, coalescing, push
configuration, aware/legacy TUS timestamps, streaming/length rollback, archive
worker execution, batched reconciliation, query indexes, hash block size,
dashboard tree reuse, CORS visibility, permission failures, and nested queries.
Later green phases retain range bytes and lock/share/device-token assertions,
and also exercise concurrent and disconnected PATCH requests. The remaining
warning is Starlette's upstream TestClient/httpx deprecation.

Push now reads PUSH__DEBOUNCE_SECONDS (default 30 s; positive). Tests use 0.02 s
through that configuration without weakening counts/exclusion assertions. This
checkout already used short push timers: full-suite time is dominated by other
work, and no reduction in suite sleep time is claimed. New metadata timestamps
are explicitly serialized aware UTC strings; legacy naive adapter strings still
load unchanged and SQLite julianday handles both during cleanup.

## Limits and deliberate follow-ups

- One Linux Ryzen 9 9950X host, loopback, warm OS page cache, fixed dataset/order;
  these are backend comparisons, not low-end-device or WAN acceptance numbers.
  Full methodology and sample limits are in [README](README.md).
- Keep one uvicorn worker: owner tokens, WebSocket subscribers and push batches
  are process-local. Multi-worker needs shared token state, fan-out and debounce.
- Pagination was not added: gzip and faster rendering improve the existing
  contract; frontend virtualization/lazy fetching belongs to the parallel stream.
  Decoded JSON size and client parsing cost still need attention.
- Zips remain temporary files so Content-Length/ranges and standard clients
  keep working. Streaming zips need separate cancellation/error/range design;
  worker bounds and compression changes already remove the measured bottleneck.
- Disk thumbnail eviction and real video/ffmpeg workloads need a cache-budget
  policy and representative media. Long private caching is opt-in via version;
  ordinary URLs revalidate after authentication.
- SQL connection caches, mmap and relaxed synchronous settings were not tuned;
  they need production-disk and durability measurements, especially on small hosts.
