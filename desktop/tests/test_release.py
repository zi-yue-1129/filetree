"""Exercise updater manifests with real installer files and signatures."""

import importlib.util
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).parents[1] / "scripts" / "release.py"


class ReleaseTests(unittest.TestCase):
    """Check release integrity and universal macOS platform selection."""

    def setUp(self) -> None:
        """Load the manifest implementation for each isolated test."""
        spec = importlib.util.spec_from_file_location("desktop_release", SCRIPT)
        if spec is None or spec.loader is None:
            raise RuntimeError("Cannot load desktop release module")
        self.release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.release)

    def test_universal_maps_both_architectures(self) -> None:
        """Both Mac architectures must download the same signed universal app."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "FileNexus.app.tar.gz").write_bytes(b"installer")
            (root / "FileNexus.app.tar.gz.sig").write_text("signed-content")
            manifest = self.release.platform_manifest(root, "macos", "1.2.3")
            self.assertEqual(set(manifest["platforms"]),
                             {"darwin-aarch64", "darwin-x86_64"})
            self.assertEqual(manifest["platforms"]["darwin-aarch64"],
                             manifest["platforms"]["darwin-x86_64"])

    def test_missing_signature_fails(self) -> None:
        """A release cannot publish an unsigned installer."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "FileNexus-setup.exe").write_bytes(b"installer")
            with self.assertRaisesRegex(ValueError, "signature"):
                self.release.platform_manifest(root, "windows", "1.2.3")

    def test_duplicate_platform_fails(self) -> None:
        """Merging must reject conflicting platform ownership."""
        manifest = {"version": "1.2.3", "platforms": {
            "windows-x86_64": {"url": "https://example.org/app.exe",
                               "signature": "signature"}}}
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            self.release.merge_manifests([manifest, manifest], "1.2.3", "notes")

    def test_incomplete_matrix_fails(self) -> None:
        """Publication requires Windows, both Mac architectures, and Linux."""
        with self.assertRaisesRegex(ValueError, "Missing"):
            self.release.merge_manifests([], "1.2.3", "notes")


if __name__ == "__main__":
    unittest.main()
