"""Measure real uvicorn HTTP/WebSocket workloads with three-run medians.

Run using the project's Python environment: python -m backend.perf.benchmark
--output backend/perf/results/before.json. All data lives in a disposable /tmp
folder; no configuration or application database is read from the worktree.
"""

import argparse
import asyncio
import base64
import contextlib
import json
import os
import platform
import re
import shutil
import signal
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx
import websockets

from backend.perf.seed import environment, seed

REPOSITORY = Path(__file__).resolve().parents[2]
MIB = 1024 * 1024


def process_usage(process_id: int) -> tuple[float, float]:
    """Read process RSS in MiB and CPU seconds, including worker threads.

    Args:
        process_id: Linux child process ID.

    Returns:
        Resident memory and cumulative user plus system CPU.
    """
    status = Path(f"/proc/{process_id}/status").read_text()
    rss = next(
        float(line.split()[1]) / 1024
        for line in status.splitlines()
        if line.startswith("VmRSS:")
    )
    fields = Path(f"/proc/{process_id}/stat").read_text().split()
    cpu = (int(fields[13]) + int(fields[14])) / os.sysconf("SC_CLK_TCK")
    return rss, cpu


def percentile(values: list[float], fraction: float) -> float:
    """Interpolate the requested quantile of a nonempty sample.

    Args:
        values: Latency samples.
        fraction: Quantile in the interval zero to one.

    Returns:
        Interpolated latency.
    """
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (
        position - lower
    )


async def measure(
    name: str,
    concurrency: int,
    count: int,
    process: subprocess.Popen[bytes],
    operation: Callable[[int], Awaitable[int]],
) -> dict[str, Any]:
    """Measure complete operations at bounded concurrency, with sampled RSS.

    Args:
        name: Workload label.
        concurrency: Maximum simultaneous operations.
        count: Number of operations.
        process: Measured server.
        operation: Async request returning transferred payload bytes.

    Returns:
        Latency quantiles, operations/second, throughput, CPU and RSS.
    """
    latencies: list[float] = []
    sizes: list[int] = []
    semaphore = asyncio.Semaphore(concurrency)
    rss_start, cpu_start = process_usage(process.pid)
    peak_rss = rss_start
    sampling = True

    async def sample() -> None:
        """Sample server RSS throughout the workload."""
        nonlocal peak_rss
        while sampling:
            rss, _ = process_usage(process.pid)
            peak_rss = max(peak_rss, rss)
            await asyncio.sleep(0.02)

    async def execute(index: int) -> None:
        """Time a complete request after acquiring a concurrency slot."""
        async with semaphore:
            started = time.perf_counter()
            sizes.append(await operation(index))
            latencies.append((time.perf_counter() - started) * 1000)

    sampler = asyncio.create_task(sample())
    started = time.perf_counter()
    try:
        await asyncio.gather(*(execute(index) for index in range(count)))
    finally:
        sampling = False
        await sampler
    elapsed = time.perf_counter() - started
    rss_end, cpu_end = process_usage(process.pid)
    return {
        "workload": name,
        "concurrency": concurrency,
        "samples": count,
        "p50_ms": percentile(latencies, 0.50),
        "p95_ms": percentile(latencies, 0.95),
        "p99_ms": percentile(latencies, 0.99),
        "req_s": count / elapsed,
        "mib_s": sum(sizes) / MIB / elapsed,
        "bytes": statistics.median(sizes),
        "cpu_s": cpu_end - cpu_start,
        "rss_start_mib": rss_start,
        "rss_peak_mib": max(peak_rss, rss_end),
        "rss_end_mib": rss_end,
    }


async def start_server(
    data_dir: Path,
    port: int,
    profile: Path | None = None,
) -> tuple[subprocess.Popen[bytes], float, Any]:
    """Launch the real app with Docker CMD flags and wait for HTTP readiness.

    Args:
        data_dir: Isolated storage and working directory.
        port: Local server port.
        profile: Optional cProfile output for a separate diagnostic run.

    Returns:
        Process, startup milliseconds, and its open log file.
    """
    command = [sys.executable, "-m", "uvicorn"]
    if profile is not None:
        command = [
            sys.executable,
            "-m",
            "cProfile",
            "-o",
            str(profile),
            "-m",
            "uvicorn",
        ]
    command += [
        "backend.app:app",
        "--host",
        "0.0.0.0",
        "--port",
        str(port),
        "--proxy-headers",
        "--forwarded-allow-ips",
        "*",
        "--timeout-keep-alive",
        "60",
    ]
    log = (data_dir / "server.log").open("ab")
    started = time.perf_counter()
    process = subprocess.Popen(
        command,
        cwd=data_dir,
        env=environment(data_dir, REPOSITORY),
        stdout=log,
        stderr=log,
    )
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            async with asyncio.timeout(120):
                while True:
                    if process.poll() is not None:
                        raise RuntimeError(
                            (data_dir / "server.log").read_text()
                        )
                    try:
                        response = await client.get(
                            f"http://127.0.0.1:{port}/api/init"
                        )
                        response.raise_for_status()
                        break
                    except httpx.TransportError:
                        await asyncio.sleep(0.02)
    except BaseException:
        stop_server(process, log)
        raise
    return process, (time.perf_counter() - started) * 1000, log


def stop_server(process: subprocess.Popen[bytes], log: Any) -> None:
    """Gracefully stop the measured server with explicit shutdown deadlines.

    Args:
        process: Child uvicorn process.
        log: Open server log.
    """
    process.send_signal(signal.SIGINT)
    try:
        process.wait(timeout=30)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)
    log.close()


async def workloads(
    data_dir: Path,
    manifest: dict[str, Any],
    port: int,
    process: subprocess.Popen[bytes],
    request_count: int,
) -> list[dict[str, Any]]:
    """Exercise dashboard, public list, media, archives, TUS and REFRESH.

    Args:
        data_dir: Workload storage.
        manifest: Seeded filenames.
        port: Server port.
        process: Measured server.
        request_count: Small-request sample count at each concurrency.

    Returns:
        All workload measurements for one server lifetime.
    """
    results: list[dict[str, Any]] = []
    async with httpx.AsyncClient(
        base_url=f"http://127.0.0.1:{port}",
        timeout=httpx.Timeout(120, connect=5),
        limits=httpx.Limits(max_connections=50, max_keepalive_connections=50),
        headers={"Accept-Encoding": "gzip"},
    ) as client:
        response = await client.post(
            "/api/user/perf-0/unlock", data={"password": "benchmark-password"}
        )
        response.raise_for_status()
        token = response.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        async def request(method: str, path: str, **kwargs: Any) -> int:
            """Consume a response without buffering large transfers in the client."""
            async with client.stream(
                method, path, headers=headers, **kwargs
            ) as response:
                response.raise_for_status()
                size = 0
                async for chunk in response.aiter_raw():
                    size += len(chunk)
                return size

        for concurrency in (1, 20):
            for name, path in (
                ("dashboard", "/api/user/perf-0"),
                ("public-list", "/api/init"),
            ):

                async def small_request(index: int, path: str = path) -> int:
                    """Issue the selected dashboard or public-list request."""
                    return await request("GET", path)

                results.append(
                    await measure(
                        name, concurrency, request_count, process, small_request
                    )
                )
            cache_dir = data_dir / "cache" / "thumbnails"
            if cache_dir.exists():
                shutil.rmtree(cache_dir)
            cache_dir.mkdir(parents=True)

            async def cold_thumbnail(index: int) -> int:
                """Request a distinct real image with an empty on-disk thumbnail cache."""
                return await request(
                    "GET", f"/api/thumbnail/perf-0/{manifest['images'][index]}"
                )

            async def warm_thumbnail(index: int) -> int:
                """Revisit images generated during the cold workload."""
                return await request(
                    "GET",
                    f"/api/thumbnail/perf-0/{manifest['images'][index % 20]}",
                )

            results.append(
                await measure(
                    "thumbnail-cold",
                    concurrency,
                    request_count,
                    process,
                    cold_thumbnail,
                )
            )
            results.append(
                await measure(
                    "thumbnail-warm",
                    concurrency,
                    request_count,
                    process,
                    warm_thumbnail,
                )
            )
            transfer_count = 3 if concurrency == 1 else 20

            async def download(index: int) -> int:
                """Stream a 50 MiB file through the download endpoint."""
                return await request(
                    "GET", "/api/download/perf-0/large-50mb.bin"
                )

            async def batch_zip(index: int) -> int:
                """Download an archive of 200 files across nested folders."""
                return await request(
                    "POST",
                    "/api/user/perf-0/batch-download",
                    data={"filenames": manifest["batch"]},
                )

            async def folder_zip(index: int) -> int:
                """Download a 250-file subtree with ten nested folders."""
                return await request(
                    "GET", "/api/user/perf-0/folders/f-000/download"
                )

            for name, operation in (
                ("download-50mb", download),
                ("batch-zip-200", batch_zip),
                ("folder-zip", folder_zip),
            ):
                results.append(
                    await measure(
                        name, concurrency, transfer_count, process, operation
                    )
                )
            chunk = bytes([37]) * (5 * MIB)

            async def upload(index: int) -> int:
                """Create and PATCH 200 MiB in forty 5 MiB chunks, then await finalization."""
                filename = f"upload-{concurrency}-{index}.bin"
                metadata = ",".join(
                    f"{key} {base64.b64encode(value.encode()).decode()}"
                    for key, value in {
                        "filename": filename,
                        "token": token,
                    }.items()
                )
                created = await client.post(
                    "/api/upload/tus",
                    headers={
                        **headers,
                        "Upload-Length": str(200 * MIB),
                        "Upload-Metadata": metadata,
                    },
                )
                created.raise_for_status()
                location = created.headers["Location"]
                for offset in range(0, 200 * MIB, len(chunk)):
                    patched = await client.patch(
                        location,
                        content=chunk,
                        headers={
                            **headers,
                            "Upload-Offset": str(offset),
                            "Content-Type": "application/offset+octet-stream",
                        },
                    )
                    patched.raise_for_status()
                    if int(patched.headers["Upload-Offset"]) != offset + len(
                        chunk
                    ):
                        raise RuntimeError(
                            "TUS server returned an incorrect offset"
                        )
                # Await the server's background import and hashing before measuring CPU.
                async with asyncio.timeout(120):
                    while True:
                        fetched = await client.get(
                            "/api/user/perf-0", headers=headers
                        )
                        fetched.raise_for_status()
                        if any(
                            item["name"] == filename
                            for item in fetched.json()["files"]
                        ):
                            break
                        await asyncio.sleep(0.02)
                return 200 * MIB

            results.append(
                await measure(
                    "tus-200mb",
                    concurrency,
                    1 if concurrency == 1 else 20,
                    process,
                    upload,
                )
            )
            # The final PATCH response precedes background SHA-256 processing.
            await asyncio.sleep(1)
            for index in range(1 if concurrency == 1 else 20):
                deleted = await client.post(
                    "/api/user/perf-0/delete",
                    data={"filename": f"upload-{concurrency}-{index}.bin"},
                    headers=headers,
                )
                deleted.raise_for_status()

            sockets: list[Any] = []
            async with contextlib.AsyncExitStack() as stack:
                for _ in range(concurrency):
                    sockets.append(
                        await stack.enter_async_context(
                            websockets.connect(
                                f"ws://127.0.0.1:{port}/api/ws/perf-0?token={token}",
                                open_timeout=5,
                                close_timeout=5,
                                ping_timeout=10,
                            )
                        )
                    )

                async def fanout(index: int) -> int:
                    """Time a mutation and receipt of REFRESH by every connected listener."""
                    response = await client.post(
                        "/api/user/update-profile",
                        headers=headers,
                        data={"username": "perf-0", "show_in_list": "true"},
                    )
                    response.raise_for_status()
                    async with asyncio.timeout(10):
                        messages = await asyncio.gather(
                            *(socket.recv() for socket in sockets)
                        )
                    if messages != ["REFRESH"] * len(sockets):
                        raise RuntimeError("Missing WebSocket refresh")
                    return 7 * len(sockets)

                row = await measure("ws-refresh-fanout", 1, 20, process, fanout)
                row["concurrency"] = concurrency
                results.append(row)
    return results


def query_plans(data_dir: Path) -> dict[str, list[str]]:
    """Capture SQLite EXPLAIN QUERY PLAN evidence for hot lookups.

    Args:
        data_dir: Isolated database directory.

    Returns:
        Plan descriptions keyed by query.
    """
    queries = {
        "files-list": (
            "files.db",
            "SELECT * FROM files WHERE username=? ORDER BY filename",
            ("disk-0",),
        ),
        "files-folder": (
            "files.db",
            "SELECT * FROM files WHERE username=? AND folder_id=?",
            ("disk-0", "f-000"),
        ),
        "notes-list": (
            "notes.db",
            "SELECT * FROM urls WHERE username=? ORDER BY created DESC",
            ("perf-0",),
        ),
        "notes-folder": (
            "notes.db",
            "SELECT * FROM urls WHERE username=? AND folder_id=?",
            ("perf-0", "f-000"),
        ),
        "folders": (
            "users.db",
            "SELECT * FROM folders WHERE user_id=? AND parent_id=?",
            (1, "f-000"),
        ),
    }
    result = {}
    for name, (filename, query, parameters) in queries.items():
        with sqlite3.connect(data_dir / filename) as database:
            result[name] = [
                row[3]
                for row in database.execute(
                    "EXPLAIN QUERY PLAN " + query, parameters
                )
            ]
    return result


def encode_report(report: dict[str, Any]) -> str:
    """Keep raw measurements readable, with one compact JSON object per row.

    Args:
        report: Complete raw and aggregated benchmark evidence.

    Returns:
        Valid JSON with compact measurement rows and indented metadata.
    """

    def compact_measurement(match: re.Match[str]) -> str:
        """Compact a measurement object while preserving every numeric value."""
        return json.dumps(json.loads(match.group()))

    return (
        re.sub(
            r'{\n\s+"workload":.*?\n\s+}',
            compact_measurement,
            json.dumps(report, indent=2),
            flags=re.DOTALL,
        )
        + "\n"
    )


def markdown(rows: list[dict[str, Any]]) -> str:
    """Render median workload metrics as a markdown table.

    Args:
        rows: Aggregated workload measurements.

    Returns:
        Markdown table.
    """
    lines = [
        "| Workload | C | p50 ms | p95 ms | p99 ms | req/s | MiB/s | bytes | CPU s | peak RSS MiB |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in rows:
        lines.append(
            f"| {row['workload']} | {row['concurrency']} | {row['p50_ms']:.2f} | {row['p95_ms']:.2f} | {row['p99_ms']:.2f} | {row['req_s']:.2f} | {row['mib_s']:.2f} | {row['bytes']:.0f} | {row['cpu_s']:.2f} | {row['rss_peak_mib']:.2f} |"
        )
    return "\n".join(lines)


async def main() -> None:
    """Seed, run three independent server lifetimes and save raw plus median results."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--requests", type=int, default=60)
    parser.add_argument("--port", type=int, default=15168)
    parser.add_argument("--profile", action="store_true")
    arguments = parser.parse_args()
    if arguments.runs < 3 or arguments.requests < 20:
        raise ValueError(
            "Use at least three runs and twenty small-request samples"
        )
    output_path = arguments.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="filenexus-perf-") as temporary:
        data_dir = Path(temporary)
        os.environ.update(environment(data_dir, REPOSITORY))
        original_cwd = Path.cwd()
        os.chdir(data_dir)
        try:
            manifest = await seed(data_dir)
        finally:
            os.chdir(original_cwd)
        runs = []
        startup_rows = []
        for run in range(arguments.runs):
            process, startup_ms, log = await start_server(
                data_dir, arguments.port
            )
            try:
                rows = await workloads(
                    data_dir,
                    manifest,
                    arguments.port,
                    process,
                    arguments.requests,
                )
                startup_rows.append(
                    {
                        "indexed_ms": startup_ms,
                        "rss_end_mib": process_usage(process.pid)[0],
                    }
                )
                runs.append(rows)
                print(f"Run {run + 1}/{arguments.runs} completed", flush=True)
            finally:
                stop_server(process, log)
            with sqlite3.connect(data_dir / "files.db") as database:
                database.execute("DELETE FROM files WHERE username='disk-0'")
            process, rebuild_ms, log = await start_server(
                data_dir, arguments.port
            )
            startup_rows[-1]["rebuild_ms"] = rebuild_ms
            stop_server(process, log)
            with sqlite3.connect(data_dir / "files.db") as database:
                database.executemany(
                    "UPDATE files SET folder_id=? WHERE username='disk-0' AND filename=?",
                    manifest["placements"],
                )
                database.execute(
                    "UPDATE files SET is_locked=1 WHERE username='disk-0' AND CAST(substr(filename,6,5) AS INTEGER)%101=0 AND filename LIKE 'file-%'"
                )
        medians = []
        for index, first in enumerate(runs[0]):
            row = dict(first)
            for key in first:
                if key not in {"workload", "concurrency", "samples"}:
                    row[key] = statistics.median(
                        run[index][key] for run in runs
                    )
            medians.append(row)
        report = {
            "revision": subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=REPOSITORY,
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            ).stdout.strip(),
            "platform": platform.platform(),
            "python": sys.version,
            "runs": runs,
            "medians": medians,
            "startup_runs": startup_rows,
            "startup_medians": {
                key: statistics.median(row[key] for row in startup_rows)
                for key in startup_rows[0]
            },
            "query_plans": query_plans(data_dir),
            "dataset": {
                "users": 5,
                "files": 5000,
                "folders": 200,
                "notes": 2000,
                "seed": 20261013,
            },
        }
        output_path.write_text(encode_report(report))
        output_path.with_suffix(".md").write_text(
            markdown(medians)
            + "\n\n"
            + json.dumps(report["startup_medians"], indent=2)
            + "\n"
        )
        print(markdown(medians), flush=True)
        print(report["startup_medians"], flush=True)
        if arguments.profile:
            process, _, log = await start_server(
                data_dir, arguments.port, output_path.with_suffix(".prof")
            )
            try:
                await workloads(data_dir, manifest, arguments.port, process, 20)
            finally:
                stop_server(process, log)


if __name__ == "__main__":
    asyncio.run(main())
