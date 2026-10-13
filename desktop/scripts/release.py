"""Collect signed desktop installers and publish complete updater metadata."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
from typing import Any
from urllib.parse import quote


REPOSITORY = "zi-yue-1129/filetree"
REQUIRED_PLATFORMS = {"windows-x86_64", "darwin-x86_64", "darwin-aarch64", "linux-x86_64"}


def platform_manifest(root: Path, platform: str, version: str) -> dict[str, Any]:
    """Read actual updater bundles and signatures for one build platform.

    Args:
        root: Directory containing flattened build artifacts.
        platform: windows, macos, or linux.
        version: Release version without the tag prefix.

    Returns:
        An updater manifest fragment, mapping both Mac architectures to universal.

    Raises:
        ValueError: An updater bundle or its signature is missing or ambiguous.
    """
    formats = {
        "windows": [("*-setup.exe", ["windows-x86_64", "windows-x86_64-nsis"]),
                    ("*.msi", ["windows-x86_64-msi"])],
        "macos": [("*.app.tar.gz", ["darwin-x86_64", "darwin-aarch64",
                                    "darwin-x86_64-app", "darwin-aarch64-app"])],
        "linux": [("*.AppImage", ["linux-x86_64", "linux-x86_64-appimage"]),
                  ("*.deb", ["linux-x86_64-deb"])],
    }
    platforms: dict[str, Any] = {}
    for pattern, keys in formats[platform]:
        matches = list(root.glob(pattern))
        if len(matches) != 1:
            raise ValueError(f"Expected one {platform} {pattern} updater bundle, found {len(matches)}")
        bundle = matches[0]
        signature_path = bundle.with_name(bundle.name + ".sig")
        if not signature_path.is_file():
            raise ValueError(f"Missing updater signature: {signature_path.name}")
        signature = signature_path.read_text(encoding="utf-8").strip()
        if not signature:
            raise ValueError(f"Empty updater signature: {signature_path.name}")
        entry = {"url": f"https://github.com/{REPOSITORY}/releases/download/v{version}/{quote(bundle.name)}",
                 "signature": signature}
        platforms.update({key: entry for key in keys})
    return {"version": version, "platforms": platforms}


def merge_manifests(manifests: list[dict[str, Any]], version: str, notes: str) -> dict[str, Any]:
    """Merge verified fragments once, rejecting missing or duplicate platforms.

    Args:
        manifests: Per-OS updater fragments from the matrix artifacts.
        version: Expected release version.
        notes: Body of the integrator-created GitHub release.

    Returns:
        Complete latest.json metadata with release notes and publication date.

    Raises:
        ValueError: Versions differ or platform metadata is incomplete/conflicting.
    """
    platforms: dict[str, Any] = {}
    for manifest in manifests:
        if manifest["version"] != version:
            raise ValueError("Updater manifest version mismatch")
        for key, entry in manifest["platforms"].items():
            if key in platforms:
                raise ValueError(f"Duplicate updater platform: {key}")
            if not entry["url"].startswith("https://") or not entry["signature"].strip():
                raise ValueError(f"Invalid updater platform: {key}")
            platforms[key] = entry
    missing = REQUIRED_PLATFORMS - platforms.keys()
    if missing:
        raise ValueError(f"Missing updater platforms: {sorted(missing)}")
    return {"version": version, "notes": notes,
            "pub_date": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "platforms": platforms}


def collect(source: Path, destination: Path) -> None:
    """Copy distributable bundles without leaking intermediate build files.

    Args:
        source: Cargo target directory containing one bundle directory per target.
        destination: Flat workflow artifact directory.

    Raises:
        ValueError: No installers exist or filenames collide.
    """
    destination.mkdir(parents=True, exist_ok=True)
    extensions = (".msi", ".exe", ".dmg", ".app.tar.gz", ".AppImage", ".deb", ".sig")
    for path in source.rglob("*"):
        if (path.is_file() and "bundle" in path.parts
                and not any(part.endswith(".app") for part in path.parts)
                and path.name.endswith(extensions)):
            target = destination / path.name
            if target.exists():
                raise ValueError(f"Duplicate installer filename: {path.name}")
            shutil.copy2(path, target)
    if not any(destination.iterdir()):
        raise ValueError("No desktop installers were produced")


def main() -> None:
    """Collect matrix outputs or merge release manifests from downloaded artifacts."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["collect", "merge"])
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--platform", choices=["windows", "macos", "linux"])
    parser.add_argument("--signed", action="store_true")
    parser.add_argument("--notes", type=Path)
    arguments = parser.parse_args()
    if arguments.operation == "collect":
        collect(arguments.source, arguments.output)
        if arguments.signed:
            if not arguments.platform:
                parser.error("Signed collection requires --platform")
            manifest = platform_manifest(arguments.output, arguments.platform, arguments.version)
            (arguments.output / f"latest-{arguments.platform}.json").write_text(
                json.dumps(manifest, indent=2), encoding="utf-8")
    else:
        if arguments.notes is None:
            parser.error("Merge requires --notes")
        manifests = [json.loads(path.read_text(encoding="utf-8"))
                     for path in arguments.source.rglob("latest-*.json")]
        manifest = merge_manifests(manifests, arguments.version,
                                   arguments.notes.read_text(encoding="utf-8"))
        arguments.output.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
