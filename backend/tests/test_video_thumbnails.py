"""Video thumbnails must work for short clips and QuickTime files.

Fixtures are rendered with the real ffmpeg binary, which the thumbnail
service itself requires.
"""

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.services.thumbnail_service import thumbnail_service

REPO_ROOT = Path(__file__).resolve().parents[2]

# ffmpeg is an external binary dependency of video thumbnails; without it the
# fixtures cannot be rendered and the feature is disabled by design.
requires_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="ffmpeg binary not installed"
)


def _render_clip(target: Path, seconds: float) -> None:
    """Render a small test-pattern clip with ffmpeg.

    Args:
        target: Output file; the extension selects the container.
        seconds: Clip duration.
    """
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", f"testsrc=size=320x240:rate=10:duration={seconds}",
            "-pix_fmt", "yuv420p", str(target),
        ],
        check=True,
        timeout=60,
    )


def _assert_valid_jpeg(thumbnail: str | None) -> None:
    """Assert the service returned a decodable, non-empty JPEG thumbnail.

    Args:
        thumbnail: Path returned by ``get_thumbnail``.
    """
    assert thumbnail is not None, "no thumbnail generated"
    path = Path(thumbnail)
    assert path.suffix == ".jpg"
    assert path.stat().st_size > 0, "empty thumbnail was cached"
    with Image.open(path) as image:
        assert (image.format, image.width) == ("JPEG", 300)


@requires_ffmpeg
def test_clip_shorter_than_one_second_gets_thumbnail(
    client: TestClient, tmp_path: Path
) -> None:
    """A 0.5 s clip has no frame at 00:00:01 but still needs a preview."""
    clip = tmp_path / "short.mp4"
    _render_clip(clip, 0.5)

    _assert_valid_jpeg(client.portal.call(thumbnail_service.get_thumbnail, clip))


@requires_ffmpeg
def test_quicktime_without_leading_ftyp_atom_gets_thumbnail(
    client: TestClient, tmp_path: Path
) -> None:
    """Older QuickTime files start with free/wide/mdat atoms, not ftyp."""
    clip = tmp_path / "legacy.mov"
    _render_clip(clip, 2)
    data = bytearray(clip.read_bytes())
    assert data[4:8] == b"ftyp"
    # Same size, so every absolute chunk offset in moov stays valid.
    data[4:8] = b"free"
    clip.write_bytes(bytes(data))

    _assert_valid_jpeg(client.portal.call(thumbnail_service.get_thumbnail, clip))


@requires_ffmpeg
def test_regular_mov_gets_thumbnail(client: TestClient, tmp_path: Path) -> None:
    """A normal multi-second .mov produces a thumbnail."""
    clip = tmp_path / "clip.mov"
    _render_clip(clip, 3)

    _assert_valid_jpeg(client.portal.call(thumbnail_service.get_thumbnail, clip))


@requires_ffmpeg
def test_empty_cached_thumbnail_is_regenerated(
    client: TestClient, tmp_path: Path
) -> None:
    """A blank cache entry left by older versions must not be served forever."""
    clip = tmp_path / "stale.mp4"
    _render_clip(clip, 2)
    cache_path = thumbnail_service._get_cache_path(clip)
    cache_path.write_bytes(b"")

    _assert_valid_jpeg(client.portal.call(thumbnail_service.get_thumbnail, clip))


def test_docker_image_installs_ffmpeg() -> None:
    """Video thumbnails are disabled when the backend image lacks ffmpeg."""
    dockerfile = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
    install_lines = [
        line for line in dockerfile.splitlines() if "apt-get install" in line
    ]
    assert any("ffmpeg" in line for line in install_lines), install_lines
