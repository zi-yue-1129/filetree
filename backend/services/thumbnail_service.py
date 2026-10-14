"""Generate atomic on-disk thumbnails with bounded, coalesced media work."""

import asyncio
import hashlib
import logging
import shutil
import tempfile
import weakref
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from backend.config import settings

logger = logging.getLogger(__name__)

# ISO-BMFF / QuickTime top-level atom types that may open an .mp4/.mov file.
# Older QuickTime and some camera files start with free/wide/mdat/moov
# instead of ftyp.
_QUICKTIME_LEADING_ATOMS = frozenset(
    {b"ftyp", b"moov", b"mdat", b"free", b"wide", b"skip", b"pnot", b"uuid"}
)
# Frame offsets tried in order: 1 s avoids black intro frames, 0 s covers
# clips shorter than one second.
_VIDEO_SEEK_SECONDS = ("1", "0")


class ThumbnailService:
    """Cache thumbnails by source identity and limit expensive decoder work."""

    def __init__(self) -> None:
        """Create the cache and configure worker and same-image concurrency limits."""
        self.cache_dir = (
            settings.paths.tus_temp_folder.parent / "cache" / "thumbnails"
        )
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.thumb_size = (300, 300)
        self._ffmpeg_available = shutil.which("ffmpeg") is not None
        self._slots = asyncio.Semaphore(settings.logic.thumbnail_workers)
        self._locks: weakref.WeakValueDictionary[str, asyncio.Lock] = (
            weakref.WeakValueDictionary()
        )
        if not self._ffmpeg_available:
            logger.warning("ffmpeg not found; video thumbnails are unavailable")

    def _is_valid_media(self, file_path: Path) -> bool:
        """Validate image or video magic bytes before invoking a decoder."""
        with file_path.open("rb") as source:
            header = source.read(16)
        extension = file_path.suffix.lower()
        if extension in {".jpg", ".jpeg"}:
            return header.startswith(b"\xff\xd8\xff")
        if extension == ".png":
            return header.startswith(b"\x89PNG\r\n\x1a\n")
        if extension == ".gif":
            return header.startswith((b"GIF87a", b"GIF89a"))
        if extension == ".bmp":
            return header.startswith(b"BM")
        if extension == ".webp":
            return header.startswith(b"RIFF") and b"WEBP" in header
        if extension in {".mp4", ".mov"}:
            return header[4:8] in _QUICKTIME_LEADING_ATOMS
        if extension in {".avi", ".mkv", ".webm"}:
            return header.startswith((b"RIFF", b"\x1a\x45\xdf\xa3"))
        return False

    def _get_cache_path(self, file_path: Path) -> Path:
        """Key cached bytes by physical path, nanosecond mtime and source size."""
        stat = file_path.stat()
        identity = f"{file_path.absolute()}_{stat.st_mtime_ns}_{stat.st_size}"
        cache_key = hashlib.sha256(identity.encode()).hexdigest()
        extension = ".gif" if file_path.suffix.lower() == ".gif" else ".jpg"
        return self.cache_dir / f"{cache_key}{extension}"

    @staticmethod
    def _is_usable_cache(cache_path: Path) -> bool:
        """Return whether a non-empty cached thumbnail exists.

        Empty files left by older versions (ffmpeg emitting no frame) are
        treated as a miss so they get regenerated instead of served forever.
        """
        try:
            return cache_path.is_file() and cache_path.stat().st_size > 0
        except FileNotFoundError:
            return False

    async def get_thumbnail(self, file_path: Path) -> str | None:
        """Get a cached thumbnail or generate one shared by concurrent callers.

        Args:
            file_path: Authorized physical source file.

        Returns:
            Thumbnail path, original animated GIF on decoder failure, or None
            for missing, invalid or unsupported media.
        """
        try:
            cache_path = await run_in_threadpool(
                self._get_cache_path, file_path
            )
        except FileNotFoundError:
            return None
        key = str(cache_path)
        lock = self._locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[key] = lock
        async with lock:
            if await run_in_threadpool(self._is_usable_cache, cache_path):
                return str(cache_path)
            async with self._slots:
                if not await run_in_threadpool(self._is_valid_media, file_path):
                    return None
                extension = file_path.suffix.lower()
                image_extensions = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
                if (
                    extension not in image_extensions
                    and not self._ffmpeg_available
                ):
                    return str(file_path) if extension == ".gif" else None
                with tempfile.NamedTemporaryFile(
                    dir=self.cache_dir, suffix=cache_path.suffix, delete=False
                ) as temporary:
                    temporary_path = Path(temporary.name)
                try:
                    if extension in image_extensions:
                        await run_in_threadpool(
                            self._process_image, file_path, temporary_path
                        )
                    else:
                        await self._process_video(
                            file_path, temporary_path, extension == ".gif"
                        )
                    await run_in_threadpool(temporary_path.replace, cache_path)
                except (
                    OSError,
                    UnidentifiedImageError,
                    ValueError,
                    RuntimeError,
                    TimeoutError,
                ):
                    logger.warning(
                        "Thumbnail generation failed for %s",
                        file_path,
                        exc_info=True,
                    )
                    return str(file_path) if extension == ".gif" else None
                finally:
                    await run_in_threadpool(
                        temporary_path.unlink, missing_ok=True
                    )
        return str(cache_path)

    def _process_image(self, input_path: Path, output_path: Path) -> None:
        """Decode, crop and encode an image in a worker thread."""
        with Image.open(input_path) as source:
            image = ImageOps.fit(
                source.convert("RGB"),
                self.thumb_size,
                method=Image.Resampling.LANCZOS,
            )
            image.save(output_path, "JPEG", quality=80)

    async def _process_video(
        self, input_path: Path, output_path: Path, animated: bool
    ) -> None:
        """Render a video frame (or an animated GIF) into ``output_path``.

        Still frames seek before decoding (keyframe seek, fast even for long
        4K/HEVC files) and fall back to the first frame for clips shorter
        than the preferred offset.

        Raises:
            RuntimeError: ffmpeg failed or produced no image.
            TimeoutError: ffmpeg exceeded its time budget.
        """
        scale = ["-vf", f"scale={self.thumb_size[0]}:-1:flags=lanczos"]
        if animated:
            await self._run_ffmpeg(
                ["-i", str(input_path), *scale, str(output_path)], timeout=30
            )
            self._require_output(output_path, input_path)
            return
        for seek_seconds in _VIDEO_SEEK_SECONDS:
            await self._run_ffmpeg(
                [
                    "-ss", seek_seconds, "-i", str(input_path),
                    "-frames:v", "1", *scale, str(output_path),
                ],
                timeout=15,
            )
            if output_path.stat().st_size > 0:
                return
        self._require_output(output_path, input_path)

    @staticmethod
    def _require_output(output_path: Path, input_path: Path) -> None:
        """Reject an empty render so it is never cached as a thumbnail.

        Raises:
            RuntimeError: ``output_path`` is empty.
        """
        if output_path.stat().st_size == 0:
            raise RuntimeError(f"ffmpeg produced no frame for {input_path}")

    async def _run_ffmpeg(self, arguments: list[str], timeout: float) -> None:
        """Run single-threaded ffmpeg with bounded launch and execution time.

        Args:
            arguments: ffmpeg arguments after the global options.
            timeout: Seconds allowed for the decode.

        Raises:
            RuntimeError: ffmpeg exited non-zero (stderr tail included).
            TimeoutError: ffmpeg exceeded ``timeout``.
        """
        process = await asyncio.wait_for(
            asyncio.create_subprocess_exec(
                "ffmpeg", "-y", "-loglevel", "error", "-threads", "1",
                *arguments,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            ),
            timeout=5,
        )
        try:
            _, stderr = await asyncio.wait_for(
                process.communicate(), timeout=timeout
            )
        except BaseException:
            process.kill()
            await asyncio.wait_for(process.wait(), timeout=5)
            raise
        if process.returncode != 0:
            detail = stderr.decode(errors="replace").strip()[-500:]
            raise RuntimeError(
                f"ffmpeg exited with status {process.returncode}: {detail}"
            )


thumbnail_service = ThumbnailService()
